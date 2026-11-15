// Pruebas de extremo a extremo del servidor: se levanta server.js con fetch simulado
// (test/mock-fetch.mjs), se le mandan webhooks como los de Meta y se revisa qué se envió
// a WhatsApp y a OpenAI y qué quedó en los logs.
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const RAIZ = path.join(__dirname, "..");

// El simulador escribe el archivo mientras la prueba lo lee: una línea a medio escribir se ignora
// (se leerá completa en la siguiente consulta).
function leerLinea(l) {
  try { return JSON.parse(l); } catch { return null; }
}
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "bot-prueba-"));
const MOCK_LOG = path.join(DIR, "llamadas.jsonl");
const PUERTO = 39000 + Math.floor(Math.random() * 1000);
const ALERTAS = "5212710000000";

let servidor;
let salida = "";

// Todo lo que pacientes simulados "escriben": nada de esto debe aparecer en los logs.
const TEXTOS_PRIVADOS = [];

function llamadas() {
  if (!fs.existsSync(MOCK_LOG)) return [];
  return fs.readFileSync(MOCK_LOG, "utf8").trim().split("\n").filter(Boolean).map(leerLinea).filter(Boolean);
}

async function esperar(cond, ms = 4000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (cond()) return true;
    await new Promise(r => setTimeout(r, 25));
  }
  return false;
}

let contadorId = 0;
async function webhook(mensaje) {
  const antes = llamadas().length;
  const res = await fetch(`http://127.0.0.1:${PUERTO}/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ id: `wamid.${++contadorId}`, ...mensaje }] } }] }] })
  });
  assert.strictEqual(res.status, 200);
  // Espera a que el servidor termine de responder (no hay más llamadas en 300 ms)
  let ultimo = -1;
  await esperar(() => {
    const n = llamadas().length;
    const estable = n === ultimo && n >= antes;
    ultimo = n;
    return estable && n > antes;
  }, 3000);
  await new Promise(r => setTimeout(r, 300));
  return llamadas().slice(antes);
}

const texto = (from, body) => { TEXTOS_PRIVADOS.push(body); return { from, type: "text", text: { body } }; };
const envios = (ll) => ll.filter(l => l.destino === "whatsapp_envio");
const alPaciente = (ll, num) => envios(ll).filter(l => l.cuerpo.to.endsWith(num.slice(-10)));
const aAlertas = (ll) => envios(ll).filter(l => l.cuerpo.to.endsWith(ALERTAS.slice(-10)));
const aOpenAI = (ll) => ll.filter(l => l.destino.startsWith("openai"));

before(async () => {
  servidor = spawn(process.execPath, ["--import", path.join(__dirname, "mock-fetch.mjs"), "server.js"], {
    cwd: RAIZ,
    env: {
      ...process.env,
      PORT: String(PUERTO), MOCK_LOG, LOG_SALT: "sal-de-prueba",
      VERIFY_TOKEN: "x", WHATSAPP_TOKEN: "t", PHONE_NUMBER_ID: "123", OPENAI_API_KEY: "k",
      INTERNAL_ALERT_NUMBER: ALERTAS, AGENDA_ACTIVA: "false", RECORDATORIOS_ACTIVOS: "false",
      AUDIO_ACTIVO: "true", PERMITIR_DATOS_SENSIBLES_IA: ""
    }
  });
  servidor.stdout.on("data", d => { salida += d; });
  servidor.stderr.on("data", d => { salida += d; });
  const listo = await esperar(() => salida.includes("escuchando en el puerto"), 8000);
  assert.ok(listo, "el servidor no arrancó:\n" + salida);
});

after(() => { if (servidor) servidor.kill(); });

test("mensaje administrativo: va a la IA y el primer mensaje lleva el aviso simplificado", async () => {
  const num = "5212711111111";
  const ll = await webhook(texto(num, "Hola, quiero agendar una cita por favor"));
  const chat = aOpenAI(ll);
  assert.strictEqual(chat.length, 1, "debe consultar a la IA una vez");
  assert.match(JSON.stringify(chat[0].cuerpo.messages), /quiero agendar una cita/);

  const env = alPaciente(ll, num);
  assert.strictEqual(env.length, 2, "aviso + respuesta");
  assert.match(env[0].cuerpo.text.body, /Aviso de privacidad simplificado/);
  assert.match(env[0].cuerpo.text.body, /internistamarco\.com\/privacidad/);
  assert.match(env[1].cuerpo.text.body, /Con gusto/);
});

test("el aviso simplificado no se repite dentro de la misma conversación", async () => {
  const num = "5212711111111";
  const ll = await webhook(texto(num, "¿Cuánto cuesta la consulta?"));
  const env = alPaciente(ll, num);
  assert.strictEqual(env.length, 1);
  assert.doesNotMatch(env[0].cuerpo.text.body, /Aviso de privacidad simplificado/);
});

test("mensaje con información clínica: NO se envía a OpenAI, respuesta fija y aviso al equipo sin contenido", async () => {
  const num = "5212712222222";
  const body = "Tengo fiebre y mi glucosa salió alta, ¿qué hago?";
  const ll = await webhook(texto(num, body));
  assert.strictEqual(aOpenAI(ll).length, 0, "no debe llegar nada a OpenAI");

  const env = alPaciente(ll, num);
  assert.ok(env.some(e => /solo atiende temas administrativos/.test(e.cuerpo.text.body)));
  assert.ok(env.some(e => /Aviso de privacidad simplificado/.test(e.cuerpo.text.body)));

  const alertas = aAlertas(ll);
  assert.strictEqual(alertas.length, 1);
  assert.doesNotMatch(alertas[0].cuerpo.text.body, /fiebre|glucosa/i, "la alerta no lleva el contenido");
});

test("el mensaje clínico tampoco entra al historial que se manda después a la IA", async () => {
  const num = "5212712222222";
  const ll = await webhook(texto(num, "Quiero agendar una cita"));
  const chat = aOpenAI(ll);
  assert.strictEqual(chat.length, 1);
  assert.doesNotMatch(JSON.stringify(chat[0].cuerpo.messages), /fiebre|glucosa/i);
});

test("urgencia: indicación de urgencias primero, sin IA, y alerta al equipo", async () => {
  const num = "5212713333333";
  const ll = await webhook(texto(num, "Me duele el pecho y no puedo respirar"));
  assert.strictEqual(aOpenAI(ll).length, 0);
  const env = alPaciente(ll, num);
  assert.match(env[0].cuerpo.text.body, /911/);
  assert.match(env[1].cuerpo.text.body, /Aviso de privacidad simplificado/);
  assert.strictEqual(aAlertas(ll).length, 1);
});

test("nota de voz: no se descarga ni se transcribe; se pide revisión humana", async () => {
  const num = "5212714444444";
  const ll = await webhook({ from: num, type: "audio", audio: { id: "media-1" } });
  assert.strictEqual(ll.filter(l => l.destino === "whatsapp_media" || l.destino === "whatsapp_descarga").length, 0);
  assert.strictEqual(aOpenAI(ll).length, 0);
  assert.ok(alPaciente(ll, num).some(e => /no escucha notas de voz/.test(e.cuerpo.text.body)));
  assert.strictEqual(aAlertas(ll).length, 1);
});

test("solicitud de eliminación de datos: respuesta fija con el correo, sin IA, y alerta", async () => {
  const num = "5212715555555";
  const ll = await webhook(texto(num, "Quiero eliminar mis datos personales"));
  assert.strictEqual(aOpenAI(ll).length, 0);
  assert.ok(alPaciente(ll, num).some(e => /contacto@internistamarco\.com/.test(e.cuerpo.text.body)));
  assert.strictEqual(aAlertas(ll).length, 1);
});

test("BAJA sin agenda activa: no pasa por la IA y el equipo recibe el aviso para registrarla", async () => {
  const num = "5212716666666";
  const ll = await webhook(texto(num, "BAJA"));
  assert.strictEqual(aOpenAI(ll).length, 0);
  assert.ok(alPaciente(ll, num).some(e => /registrará en breve/.test(e.cuerpo.text.body)));
  assert.strictEqual(aAlertas(ll).length, 1);
});

test("imagen: el archivo nunca se descarga; un pie de foto clínico no llega a la IA", async () => {
  const num = "5212717777777";
  const caption = "Le mando mis resultados, el colesterol salió alto";
  TEXTOS_PRIVADOS.push(caption);
  const ll = await webhook({ from: num, type: "image", image: { id: "img-1", caption } });
  assert.strictEqual(ll.filter(l => l.destino.startsWith("whatsapp_media")).length, 0);
  assert.strictEqual(aOpenAI(ll).length, 0);
});

test("la IA marca [AVISAR_EQUIPO]: se quita el marcador y la alerta no incluye el texto del paciente", async () => {
  const num = "5212718888888";
  const ll = await webhook(texto(num, "Tengo una queja sobre el estacionamiento del sanatorio"));
  assert.strictEqual(aOpenAI(ll).length, 1);
  const env = alPaciente(ll, num);
  assert.ok(env.every(e => !e.cuerpo.text.body.includes("[AVISAR_EQUIPO]")));
  const alertas = aAlertas(ll);
  assert.strictEqual(alertas.length, 1);
  assert.doesNotMatch(alertas[0].cuerpo.text.body, /estacionamiento|queja/);
});

test("los logs no contienen textos de pacientes ni números completos", async () => {
  for (const t of TEXTOS_PRIVADOS) {
    assert.ok(!salida.includes(t), `el log contiene el texto: "${t}"`);
    // ni siquiera fragmentos de 20 caracteres
    assert.ok(!salida.includes(t.slice(0, 20)), `el log contiene un fragmento de: "${t}"`);
  }
  for (const n of ["2711111111", "2712222222", "2713333333", "2714444444", "2715555555", "2716666666", "2717777777", "2718888888"]) {
    assert.ok(!salida.includes(n), `el log contiene el número ${n}`);
  }
  assert.match(salida, /p-[0-9a-f]{8}/, "usa seudónimos");
  assert.match(salida, /Datos de salud a la IA: BLOQUEADOS/);
});
