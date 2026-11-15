const { test } = require("node:test");
const assert = require("node:assert");
const alta = require("../alta");
const demo = require("../demo");

function graphFalso(respuestas = {}) {
  const llamadas = [];
  const fn = async (ruta, opciones = {}) => {
    llamadas.push({ ruta: ruta.split("?")[0], metodo: opciones.method || "GET", body: opciones.body });
    if (ruta.startsWith("oauth/access_token")) return { access_token: "EAAGtokendelnegocio123456" };
    if (ruta.includes("/phone_numbers")) return respuestas.numeros || { data: [{ id: "PN1", display_phone_number: "+52 271 000 0000" }] };
    return { success: true };
  };
  fn.llamadas = llamadas;
  return fn;
}

const fin = (data) => ({ type: "WA_EMBEDDED_SIGNUP", event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING", version: 3, data });

test("alta: extras de Embedded Signup para coexistencia y normal", () => {
  assert.strictEqual(alta.extrasPara("coexistencia").featureType, "whatsapp_business_app_onboarding");
  assert.strictEqual(alta.extrasPara("normal").featureType, undefined);
});

test("alta v4: el evento solo trae waba_id; el número se obtiene de la cuenta", async () => {
  const g = graphFalso();
  const r = await alta.completarAlta({ code: "c", sesion: fin({ waba_id: "W1" }) }, { graph: g, modo: "coexistencia" });
  assert.ok(r.ok, r.texto);
  assert.strictEqual(r.phone_number_id, "PN1");
  assert.ok(!r.texto.includes("tokendelnegocio"), "el texto no muestra el token completo");
});

test("alta coexistencia: suscribe webhooks y pide sincronizaciones, sin registrar el número", async () => {
  const g = graphFalso();
  await alta.completarAlta({ code: "c", sesion: fin({ waba_id: "W1", phone_number_id: "PN1" }) }, { graph: g, modo: "coexistencia" });
  const rutas = g.llamadas.map(l => `${l.metodo} ${l.ruta}`);
  assert.ok(rutas.includes("POST W1/subscribed_apps"));
  assert.ok(!rutas.some(r => r.includes("/register")), "en coexistencia no se llama a /register");
  const syncs = g.llamadas.filter(l => l.ruta === "PN1/smb_app_data").map(l => l.body.sync_type);
  assert.deepStrictEqual(syncs, ["smb_app_state_sync", "history"]);
});

test("alta normal: exige PIN de 6 dígitos y registra el número", async () => {
  let r = await alta.completarAlta({ code: "c", sesion: fin({ waba_id: "W1", phone_number_id: "PN1" }) }, { graph: graphFalso(), modo: "normal", pin: "" });
  assert.strictEqual(r.ok, false);
  const g = graphFalso();
  r = await alta.completarAlta({ code: "c", sesion: fin({ waba_id: "W1", phone_number_id: "PN1" }) }, { graph: g, modo: "normal", pin: "123456" });
  assert.ok(r.ok);
  assert.ok(g.llamadas.some(l => l.ruta === "PN1/register"));
  assert.ok(!g.llamadas.some(l => l.ruta === "PN1/smb_app_data"));
});

test("alta: cancelación, error y sesión incompleta no hacen ninguna llamada a Meta", async () => {
  for (const sesion of [
    { type: "WA_EMBEDDED_SIGNUP", event: "CANCEL", data: { current_step: "PHONE_NUMBER_SETUP" } },
    { type: "WA_EMBEDDED_SIGNUP", event: "ERROR", data: { error_message: "x" } },
    null
  ]) {
    const g = graphFalso();
    const r = await alta.completarAlta({ code: "c", sesion }, { graph: g });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(g.llamadas.length, 0);
  }
});

test("alta: si la cuenta tiene varios números, no elige al azar", async () => {
  const g = graphFalso({ numeros: { data: [{ id: "A", display_phone_number: "1" }, { id: "B", display_phone_number: "2" }] } });
  const r = await alta.completarAlta({ code: "c", sesion: fin({ waba_id: "W1" }) }, { graph: g });
  assert.strictEqual(r.ok, false);
  assert.ok(!g.llamadas.some(l => l.ruta.endsWith("subscribed_apps")));
});

test("demo: el candado del calendario bloquea calendarios no autorizados antes de llamar a Google", async () => {
  const llamadas = [];
  const cliente = {
    events: { list: async (p) => { llamadas.push(p.calendarId); return { data: { items: [] } }; } },
    freebusy: { query: async () => ({ data: {} }) }
  };
  const p = demo.protegerCalendario(cliente, ["demo@group.calendar.google.com"]);
  await p.events.list({ calendarId: "demo@group.calendar.google.com" });
  await assert.rejects(p.events.list({ calendarId: "internista.marco@gmail.com" }), /bloqueado/);
  await assert.rejects(p.freebusy.query({ requestBody: { items: [{ id: "internista.marco@gmail.com" }] } }), /bloqueado/);
  assert.deepStrictEqual(llamadas, ["demo@group.calendar.google.com"]);
});

test("demo: el calendario de estado también debe ser secundario", () => {
  const e = demo.validarConfiguracionDemo({
    PHONE_NUMBER_ID: "1", DEMO_DESTINATARIOS: "5212711111111", CALENDAR_ID: "a@group.calendar.google.com",
    ESTADO_CALENDAR_ID: "internista.marco@gmail.com"
  });
  assert.ok(e.length > 0);
});
