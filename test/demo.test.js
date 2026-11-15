// Candados del modo demo: la demo no puede usar el calendario real, enviar recordatorios,
// enviar desde un número que no sea de prueba ni escribir a teléfonos fuera de la lista.
const { test } = require("node:test");
const assert = require("node:assert");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const demo = require("../demo");

const RAIZ = path.join(__dirname, "..");

// El simulador escribe el archivo mientras la prueba lo lee: una línea a medio escribir se ignora
// (se leerá completa en la siguiente consulta).
function leerLinea(l) {
  try { return JSON.parse(l); } catch { return null; }
}
const BASE_OK = {
  MODO_DEMO: "true",
  PHONE_NUMBER_ID: "1502573929596107",
  AGENDA_ACTIVA: "true",
  CALENDAR_ID: "abc123@group.calendar.google.com",
  CALENDARS_BUSY: "abc123@group.calendar.google.com",
  RECORDATORIOS_ACTIVOS: "false",
  DEMO_DESTINATARIOS: "5212711111111,5212712222222"
};

test("configuración de demo correcta: sin errores", () => {
  assert.deepStrictEqual(demo.validarConfiguracionDemo(BASE_OK), []);
});

test("rechaza el calendario principal del consultorio (Gmail)", () => {
  const e = demo.validarConfiguracionDemo({ ...BASE_OK, CALENDAR_ID: "internista.marco@gmail.com" });
  assert.ok(e.some(x => x.includes("internista.marco@gmail.com")));
});

test("rechaza el calendario real aunque solo esté en CALENDARS_BUSY", () => {
  const e = demo.validarConfiguracionDemo({ ...BASE_OK, CALENDARS_BUSY: "abc123@group.calendar.google.com,internista.marco@gmail.com" });
  assert.ok(e.length > 0);
});

test("rechaza calendarios de la lista prohibida", () => {
  const e = demo.validarConfiguracionDemo({ ...BASE_OK, CALENDARIOS_PROHIBIDOS: "abc123@group.calendar.google.com" });
  assert.ok(e.length > 0);
});

test("rechaza recordatorios activos y la falta de destinatarios", () => {
  assert.ok(demo.validarConfiguracionDemo({ ...BASE_OK, RECORDATORIOS_ACTIVOS: "true" }).length > 0);
  assert.ok(demo.validarConfiguracionDemo({ ...BASE_OK, DEMO_DESTINATARIOS: "" }).length > 0);
});

test("solo los números +1 555 cuentan como número de prueba", () => {
  assert.ok(demo.esNumeroDePrueba("+1 555-184-4654"));
  assert.ok(!demo.esNumeroDePrueba("+52 271 116 1448"));
  assert.ok(!demo.esNumeroDePrueba("+1 650-555-1234"));
  assert.ok(!demo.esNumeroDePrueba(""));
});

test("destinoPermitido compara los últimos 10 dígitos (521/52)", () => {
  assert.ok(demo.destinoPermitido("522711111111", BASE_OK));
  assert.ok(!demo.destinoPermitido("5212719999999", BASE_OK));
});

// ---------- Servidor real con fetch simulado ----------
function arrancar(envExtra) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-demo-"));
  const MOCK_LOG = path.join(dir, "llamadas.jsonl");
  const PORT = String(40000 + Math.floor(Math.random() * 1000));
  const proc = spawn(process.execPath, ["--import", path.join(__dirname, "mock-fetch.mjs"), "server.js"], {
    cwd: RAIZ,
    env: {
      ...process.env, PORT, MOCK_LOG, LOG_SALT: "s",
      VERIFY_TOKEN: "x", WHATSAPP_TOKEN: "t", OPENAI_API_KEY: "k",
      INTERNAL_ALERT_NUMBER: "", ...envExtra
    }
  });
  let salida = "";
  proc.stdout.on("data", d => { salida += d; });
  proc.stderr.on("data", d => { salida += d; });
  const termino = new Promise(r => proc.on("exit", code => r(code)));
  const llamadas = () => fs.existsSync(MOCK_LOG)
    ? fs.readFileSync(MOCK_LOG, "utf8").trim().split("\n").filter(Boolean).map(leerLinea).filter(Boolean) : [];
  return { proc, PORT, termino, llamadas, salida: () => salida };
}

async function esperar(cond, ms = 5000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) { if (cond()) return true; await new Promise(r => setTimeout(r, 25)); }
  return false;
}

test("servidor demo NO arranca con el calendario real", async () => {
  const s = arrancar({ ...BASE_OK, CALENDAR_ID: "internista.marco@gmail.com", CALENDARS_BUSY: "" });
  const code = await s.termino;
  assert.strictEqual(code, 1);
  assert.match(s.salida(), /configuración insegura/);
});

test("servidor demo NO arranca con recordatorios activos", async () => {
  const s = arrancar({ ...BASE_OK, RECORDATORIOS_ACTIVOS: "true" });
  assert.strictEqual(await s.termino, 1);
});

test("servidor demo se detiene si PHONE_NUMBER_ID no es un número de prueba, sin enviar nada", async () => {
  const s = arrancar({ ...BASE_OK, AGENDA_ACTIVA: "false", MOCK_DISPLAY: "+52 271 116 1448" });
  const code = await s.termino;
  assert.strictEqual(code, 1);
  assert.match(s.salida(), /no es un número de prueba/);
  assert.strictEqual(s.llamadas().filter(l => l.destino === "whatsapp_envio").length, 0);
});

test("servidor demo: responde a un teléfono permitido y bloquea cualquier otro", async () => {
  const s = arrancar({ ...BASE_OK, AGENDA_ACTIVA: "false" });
  try {
    assert.ok(await esperar(() => /número de origen verificado/.test(s.salida())), s.salida());
    const enviar = (from, id, phoneId = "1502573929596107") => fetch(`http://127.0.0.1:${s.PORT}/webhook`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entry: [{ changes: [{ value: {
        metadata: { phone_number_id: phoneId },
        messages: [{ id, from, type: "text", text: { body: "Hola, quiero una cita" } }] } }] }] })
    });
    await enviar("5212711111111", "w1");
    assert.ok(await esperar(() => s.llamadas().filter(l => l.destino === "whatsapp_envio").length >= 2));
    const iaAntes = s.llamadas().filter(l => l.destino.startsWith("openai")).length;

    // Teléfono no autorizado: ni se procesa ni llega a OpenAI
    await enviar("5212719999999", "w2");
    assert.ok(await esperar(() => /descartado \(no está en DEMO_DESTINATARIOS\)/.test(s.salida())));
    // Evento de otro número de negocio (por ejemplo, el real): se descarta completo
    await enviar("5212711111111", "w3", "1177667488770694");
    assert.ok(await esperar(() => /evento de otro número descartado/.test(s.salida())));
    await new Promise(r => setTimeout(r, 300));

    assert.strictEqual(s.llamadas().filter(l => l.destino.startsWith("openai")).length, iaAntes, "nada nuevo a OpenAI");
    const envios = s.llamadas().filter(l => l.destino === "whatsapp_envio");
    assert.ok(envios.every(e => e.cuerpo.to.endsWith("2711111111")), "solo al teléfono permitido");
    // Los recordatorios no se programan en modo demo
    assert.doesNotMatch(s.salida(), /Recordatorios automáticos ACTIVOS/);
  } finally {
    s.proc.kill();
  }
});
