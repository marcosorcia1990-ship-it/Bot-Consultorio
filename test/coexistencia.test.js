// Comportamiento de coexistencia en el servidor real (con fetch simulado):
// ecos de la app, mensajes atrasados, pausa, cola por chat y panel de administración.
const { test, after } = require("node:test");
const assert = require("node:assert");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const RAIZ = path.join(__dirname, "..");
function leerLinea(l) { try { return JSON.parse(l); } catch { return null; } }
const procesos = [];
after(() => procesos.forEach(p => p.kill()));

async function esperar(cond, ms = 5000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) { if (await cond()) return true; await new Promise(r => setTimeout(r, 25)); }
  return false;
}

async function arrancar(envExtra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-coex-"));
  const MOCK_LOG = path.join(dir, "llamadas.jsonl");
  const PORT = "0";
  const proc = spawn(process.execPath, ["--import", path.join(__dirname, "mock-fetch.mjs"), "server.js"], {
    cwd: RAIZ,
    env: { ...process.env, PORT, MOCK_LOG, LOG_SALT: "s", VERIFY_TOKEN: "vt", WHATSAPP_TOKEN: "t",
      PHONE_NUMBER_ID: "1502573929596107", OPENAI_API_KEY: "k", INTERNAL_ALERT_NUMBER: "", AGENDA_ACTIVA: "false", BOT_PAUSADO: "false", ...envExtra }
  });
  procesos.push(proc);
  let salida = "";
  proc.stdout.on("data", d => { salida += d; });
  proc.stderr.on("data", d => { salida += d; });
  const s = {
    proc, salida: () => salida,
    llamadas: () => fs.existsSync(MOCK_LOG) ? fs.readFileSync(MOCK_LOG, "utf8").trim().split("\n").filter(Boolean).map(leerLinea).filter(Boolean) : [],
    url: (p) => `http://127.0.0.1:${salida.match(/escuchando en el puerto (\d+)/)[1]}${p}`,
    async webhook(value) {
      await fetch(s.url("/webhook"), { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "1502573929596107" }, ...value } }] }] }) });
    }
  };
  assert.ok(await esperar(() => salida.includes("escuchando en el puerto")), salida);
  return s;
}

const ahoraSeg = () => String(Math.floor(Date.now() / 1000));
let id = 0;
const mensaje = (from, body, extra = {}) => ({ messages: [{ id: "m" + (++id), from, timestamp: ahoraSeg(), type: "text", text: { body }, ...extra }] });
const openai = (s) => s.llamadas().filter(l => l.destino === "openai_chat").length;

test("eco de la app (formato 52) silencia al paciente que escribe como 521", async () => {
  const s = await arrancar();
  await s.webhook({ message_echoes: [{ from: "15551844654", to: "522711112222", id: "e1", timestamp: ahoraSeg(), type: "text", text: { body: "Hola, soy Ade" } }] });
  assert.ok(await esperar(() => /Chat tomado por el equipo/.test(s.salida())));
  await s.webhook(mensaje("5212711112222", "Gracias, ¿a qué hora es mi cita?"));
  assert.ok(await esperar(() => /Chat en manos humanas/.test(s.salida())));
  assert.strictEqual(openai(s), 0, "no consulta a la IA");
  // otro paciente sí recibe respuesta
  await s.webhook(mensaje("5212713333333", "Quiero agendar una cita"));
  assert.ok(await esperar(() => openai(s) === 1));
});

test("un eco viejo (más antiguo que HUMANO_HORAS) no silencia el chat", async () => {
  const s = await arrancar();
  const hace2dias = String(Math.floor(Date.now() / 1000) - 48 * 3600);
  await s.webhook({ message_echoes: [{ to: "522714444444", id: "e2", timestamp: hace2dias, type: "text" }] });
  await s.webhook(mensaje("5212714444444", "Quiero una cita"));
  assert.ok(await esperar(() => openai(s) === 1));
});

test("mensajes atrasados (por ejemplo tras una caída) no se contestan solos", async () => {
  const s = await arrancar();
  const hace1h = String(Math.floor(Date.now() / 1000) - 3600);
  await s.webhook(mensaje("5212715555555", "Hola", { timestamp: hace1h }));
  assert.ok(await esperar(() => /Mensaje atrasado/.test(s.salida())));
  assert.strictEqual(openai(s), 0);
  assert.strictEqual(s.llamadas().filter(l => l.destino === "whatsapp_envio").length, 0);
});

test("mensajes duplicados (Meta reintenta el mismo id) se procesan una sola vez", async () => {
  const s = await arrancar();
  const m = mensaje("5212716666666", "Quiero una cita");
  await s.webhook(m);
  await s.webhook(m);
  await esperar(() => openai(s) >= 1);
  await new Promise(r => setTimeout(r, 400));
  assert.strictEqual(openai(s), 1);
});

test("varios mensajes seguidos del mismo paciente se atienden en orden, uno a la vez", async () => {
  const s = await arrancar();
  await s.webhook({ messages: [
    { id: "q1", from: "5212717777777", timestamp: ahoraSeg(), type: "text", text: { body: "Hola" } },
    { id: "q2", from: "5212717777777", timestamp: ahoraSeg(), type: "text", text: { body: "Quiero una cita" } }
  ] });
  assert.ok(await esperar(() => openai(s) === 2));
  const chats = s.llamadas().filter(l => l.destino === "openai_chat");
  // la segunda consulta ya incluye la primera en el historial
  assert.match(JSON.stringify(chats[1].cuerpo.messages), /"Hola"/);
});

test("BOT_PAUSADO: no contesta a nadie, pero sigue registrando intervenciones del equipo", async () => {
  const s = await arrancar({ BOT_PAUSADO: "true" });
  await s.webhook(mensaje("5212718888888", "Quiero una cita"));
  assert.ok(await esperar(() => /Bot en pausa/.test(s.salida())));
  await s.webhook({ message_echoes: [{ to: "522718888888", id: "e3", timestamp: ahoraSeg(), type: "text" }] });
  assert.ok(await esperar(() => /Chat tomado por el equipo/.test(s.salida())));
  assert.strictEqual(openai(s), 0);
  assert.strictEqual(s.llamadas().filter(l => l.destino === "whatsapp_envio").length, 0);
});

test("historial y sincronización de contactos de la app no se contestan", async () => {
  const s = await arrancar();
  await fetch(s.url("/webhook"), { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entry: [{ changes: [{ field: "history", value: { metadata: { phone_number_id: "1502573929596107" }, history: [{ threads: [] }] } }] }] }) });
  assert.ok(await esperar(() => /Historial de la app recibido/.test(s.salida())));
  assert.strictEqual(openai(s), 0);
});

test("panel /admin: sin sesión redirige; contraseña incorrecta se rechaza; la correcta entra", async () => {
  const s = await arrancar({ ADMIN_TOKEN: "clave-admin-larga", WABA_ID: "1472438634813201", PUBLIC_URL: "https://demo.ejemplo" });
  let r = await fetch(s.url("/admin/whatsapp"), { redirect: "manual" });
  assert.strictEqual(r.status, 302);
  r = await fetch(s.url("/admin/entrar"), { method: "POST", redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "clave=mala" });
  assert.strictEqual(r.status, 403);
  r = await fetch(s.url("/admin/entrar"), { method: "POST", redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "clave=clave-admin-larga" });
  assert.strictEqual(r.status, 302);
  const cookie = r.headers.get("set-cookie").split(";")[0];
  r = await fetch(s.url("/admin/whatsapp"), { headers: { cookie } });
  const html = await r.text();
  assert.strictEqual(r.status, 200);
  assert.match(html, /\+1 555-184-4654/);
  assert.ok(!html.includes("clave-admin-larga") && !html.includes("vt\"") , "no muestra secretos");
});

async function entrar(s) {
  const r = await fetch(s.url("/admin/entrar"), { method: "POST", redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "clave=clave-admin-larga" });
  return r.headers.get("set-cookie").split(";")[0];
}

test("panel /admin (demo): suscribe la WABA de prueba con desvío a este servidor", async () => {
  const s = await arrancar({ ADMIN_TOKEN: "clave-admin-larga", WABA_ID: "1472438634813201", PUBLIC_URL: "https://demo.ejemplo",
    MODO_DEMO: "true", DEMO_DESTINATARIOS: "5212711111111" });
  assert.ok(await esperar(() => /número de origen verificado/.test(s.salida())), s.salida());
  const cookie = await entrar(s);
  await fetch(s.url("/admin/whatsapp/suscribir"), { method: "POST", redirect: "manual", headers: { cookie } });
  const post = s.llamadas().find(l => l.destino === "meta_subscribed_apps" && l.metodo === "POST");
  assert.ok(post, "debe suscribir");
  assert.strictEqual(post.cuerpo.override_callback_uri, "https://demo.ejemplo/webhook", "con desvío, no a la URL general");
  assert.strictEqual(post.cuerpo.verify_token, "vt");
});

test("panel /admin (demo): NO suscribe si la cuenta tiene un número real", async () => {
  const s = await arrancar({ ADMIN_TOKEN: "clave-admin-larga", WABA_ID: "W", PUBLIC_URL: "https://demo.ejemplo",
    MODO_DEMO: "true", DEMO_DESTINATARIOS: "5212711111111",
    MOCK_WABA_NUMS: JSON.stringify([{ id: "1502573929596107", display_phone_number: "+1 555-184-4654" }, { id: "9", display_phone_number: "+52 271 116 1448" }]) });
  assert.ok(await esperar(() => /número de origen verificado/.test(s.salida())));
  const cookie = await entrar(s);
  await fetch(s.url("/admin/whatsapp/suscribir"), { method: "POST", redirect: "manual", headers: { cookie } });
  await new Promise(r => setTimeout(r, 300));
  assert.ok(!s.llamadas().some(l => l.destino === "meta_subscribed_apps" && l.metodo === "POST"));
});

test("alta: sin sesión de administrador no se puede abrir", async () => {
  const s = await arrancar({ ADMIN_TOKEN: "clave-admin-larga", META_APP_ID: "1", META_APP_SECRET: "x", META_CONFIG_ID: "2" });
  const r = await fetch(s.url("/alta?token=vt"), { redirect: "manual" });
  assert.strictEqual(r.status, 302, "el token en la URL ya no sirve");
});

test("fuera de la demo, el bot arranca PAUSADO si no se indica BOT_PAUSADO=false", async () => {
  const s = await arrancar({ BOT_PAUSADO: "" });
  assert.match(s.salida(), /Bot PAUSADO/);
  await s.webhook(mensaje("5212719090909", "Quiero una cita"));
  assert.ok(await esperar(() => /Bot en pausa/.test(s.salida())));
  assert.strictEqual(openai(s), 0);
});

test("acceso de revisor: ve el panel en solo lectura, no puede ejecutar acciones ni abrir /alta", async () => {
  const s = await arrancar({ ADMIN_TOKEN: "clave-admin-larga", REVISOR_TOKEN: "revisor-meta-clave-muy-larga-123",
    WABA_ID: "1472438634813201", PUBLIC_URL: "https://demo.ejemplo", META_APP_ID: "1", META_APP_SECRET: "x", META_CONFIG_ID: "2" });
  const r = await fetch(s.url("/admin/entrar"), { method: "POST", redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "clave=revisor-meta-clave-muy-larga-123" });
  assert.strictEqual(r.status, 302);
  const cookie = r.headers.get("set-cookie").split(";")[0];
  const panel = await (await fetch(s.url("/admin/whatsapp"), { headers: { cookie } })).text();
  assert.match(panel, /solo lectura/);
  assert.match(panel, /\+1 555-184-4654/);
  assert.ok(!panel.includes('action="/admin/whatsapp/suscribir"'), "sin botones de acción");
  for (const ruta of ["/admin/whatsapp/suscribir", "/admin/whatsapp/desuscribir"]) {
    const x = await fetch(s.url(ruta), { method: "POST", redirect: "manual", headers: { cookie } });
    assert.strictEqual(x.status, 403);
  }
  assert.ok(!s.llamadas().some(l => l.destino === "meta_subscribed_apps" && l.metodo !== "GET"));
  const alta = await fetch(s.url("/alta"), { redirect: "manual", headers: { cookie } });
  assert.strictEqual(alta.status, 403);
});

test("acceso de revisor: una contraseña de revisor corta no se acepta", async () => {
  const s = await arrancar({ ADMIN_TOKEN: "clave-admin-larga", REVISOR_TOKEN: "corta" });
  const r = await fetch(s.url("/admin/entrar"), { method: "POST", redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "clave=corta" });
  assert.strictEqual(r.status, 403);
});
