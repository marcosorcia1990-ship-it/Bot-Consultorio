process.env.CALENDAR_ID = "cal-prueba";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const cal = require("../calendar");

// Calendario simulado en memoria, con paginación de 2 eventos por página
let eventos, llamadas;
function calendarioFalso() {
  return {
    events: {
      async list(params) {
        llamadas.push({ op: "list", params });
        let items = eventos.filter(e => {
          const priv = (e.extendedProperties && e.extendedProperties.private) || {};
          const filtros = [].concat(params.privateExtendedProperty || []);
          return filtros.every(f => { const [k, v] = f.split("="); return priv[k] === v; });
        });
        const ini = params.pageToken ? Number(params.pageToken) : 0;
        const pagina = items.slice(ini, ini + 2);
        return { data: { items: pagina, nextPageToken: ini + 2 < items.length ? String(ini + 2) : undefined } };
      },
      async get({ eventId }) {
        llamadas.push({ op: "get", eventId });
        return { data: JSON.parse(JSON.stringify(eventos.find(e => e.id === eventId))) };
      },
      async update({ eventId, requestBody }) {
        llamadas.push({ op: "update", eventId, requestBody });
        const i = eventos.findIndex(e => e.id === eventId);
        eventos[i] = { id: eventId, ...requestBody };
        return { data: eventos[i] };
      },
      async patch({ eventId, requestBody }) {
        llamadas.push({ op: "patch", eventId, requestBody });
        const e = eventos.find(x => x.id === eventId);
        if (requestBody.extendedProperties) e.extendedProperties = requestBody.extendedProperties;
        return { data: e };
      }
    }
  };
}

function eventoBot(id, tel, extra = {}) {
  return {
    id, summary: "Consulta – Alma Andrade (1ª vez)",
    description: `Paciente: Alma Andrade\nTeléfono: ${tel}\n[bot-consultorio]`,
    start: { dateTime: "2026-12-01T17:00:00Z" }, end: { dateTime: "2026-12-01T17:30:00Z" },
    colorId: "9",
    extendedProperties: { private: { creadoPor: "bot-consultorio", telefono: tel, telefonoWa: "521" + tel, nombre: "Alma Andrade", estado: "nueva", ...extra } }
  };
}

beforeEach(() => {
  llamadas = [];
  eventos = [
    eventoBot("a1", "2711234567"),
    eventoBot("a2", "2711234567"),
    eventoBot("b1", "2719999999"),
    { id: "m1", summary: "Alma Andrade 271 123 4567", start: { dateTime: "2026-12-02T17:00:00Z" }, end: { dateTime: "2026-12-02T17:30:00Z" } },
    { id: "p1", summary: "Junta personal", start: { dateTime: "2026-12-03T17:00:00Z" }, end: { dateTime: "2026-12-03T18:00:00Z" } }
  ];
  cal._setCalendarParaPruebas(calendarioFalso());
});

test("coincideTelefono reconoce número dictado, de WhatsApp y escrito a mano", () => {
  assert.ok(cal.coincideTelefono(eventos[0], "2711234567"));
  assert.ok(cal.coincideTelefono(eventos[0], "5212711234567"));
  assert.ok(cal.coincideTelefono(eventos[3], "2711234567"));
  assert.ok(!cal.coincideTelefono(eventos[4], "2711234567"));
  assert.ok(!cal.coincideTelefono(eventos[0], "123"));
});

test("buscarEventosDePaciente recorre todas las páginas e incluye citas capturadas a mano", async () => {
  const r = await cal.buscarEventosDePaciente("2711234567", new Date("2026-01-01"), new Date("2027-01-01"));
  assert.deepStrictEqual(r.map(e => e.id).sort(), ["a1", "a2", "m1"]);
  assert.ok(llamadas.filter(l => l.op === "list").length >= 3, "debe paginar");
  assert.strictEqual(r.find(e => e.id === "m1").creadaPorBot, false);
});

test("construirEventoAnonimizado no conserva ningún dato personal", () => {
  const limpio = cal.construirEventoAnonimizado(eventos[0], "ARCO-2026-001", "2026-11-14T00:00:00Z");
  const texto = JSON.stringify(limpio);
  for (const dato of ["Alma", "Andrade", "2711234567", "telefono", "nombre"]) {
    assert.ok(!texto.includes(dato), `quedó "${dato}" en el evento`);
  }
  assert.deepStrictEqual(limpio.start, eventos[0].start, "conserva la fecha para no liberar el horario por error");
  assert.strictEqual(limpio.extendedProperties.private.folio, "ARCO-2026-001");
  assert.strictEqual(limpio.extendedProperties.private.anonimizado, "si");
});

test("anonimizarEvento usa update (no patch) para no dejar propiedades viejas", async () => {
  await cal.anonimizarEvento("a1", "ARCO-2026-001");
  const upd = llamadas.find(l => l.op === "update");
  assert.ok(upd);
  assert.ok(!llamadas.some(l => l.op === "patch"));
  assert.ok(!JSON.stringify(eventos.find(e => e.id === "a1")).includes("2711234567"));
});

test("las citas anonimizadas ya no aparecen en las búsquedas del bot", async () => {
  await cal.anonimizarEvento("a1", "ARCO-2026-001");
  const todas = await cal.listarTodasLasCitas(new Date("2026-01-01"), new Date("2027-01-01"));
  assert.ok(!todas.some(c => c.id === "a1"));
});

test("marcarSinAutomaticos marca solo las citas del bot de ese teléfono y se pueden consultar después", async () => {
  const n = await cal.marcarSinAutomaticos("5212711234567");
  assert.strictEqual(n, 2);
  const tels = await cal.telefonosSinAutomaticos();
  assert.ok(tels.has("2711234567"));
  assert.ok(!tels.has("2719999999"));
  // no conserva datos ajenos ni borra los existentes
  assert.strictEqual(eventos.find(e => e.id === "a1").extendedProperties.private.nombre, "Alma Andrade");
});

test("citasDelBotAnterioresA excluye manuales y anonimizadas", async () => {
  await cal.anonimizarEvento("a2", "CONS-2026-001");
  const r = await cal.citasDelBotAnterioresA(new Date("2027-01-01"));
  assert.deepStrictEqual(r.map(e => e.id).sort(), ["a1", "b1"]);
});

test("crear_cita rechaza nombres inventados o provisionales (caso real del 12 de agosto de 2026)", () => {
  const { nombreValido } = require("../tools");
  for (const n of ["[Paciente de seguimiento]", "Paciente", "paciente nuevo", "Nombre Apellido", "Juan", "", "Alma 2711403390"]) {
    assert.strictEqual(nombreValido(n), false, n);
  }
  for (const n of ["Alma Andrade", "Juan Prueba Demo", "María José Núñez Ruiz", "Lolis Loliana"]) {
    assert.strictEqual(nombreValido(n), true, n);
  }
});

test("un solo calendario de demo: los registros de estado no cuentan como citas ni ocupan horario", async () => {
  eventos.push({
    id: "est1", summary: "Chat atendido por el equipo (bot en silencio)", transparency: "transparent",
    start: { dateTime: "2026-12-01T17:00:00Z" }, end: { dateTime: "2026-12-02T17:00:00Z" },
    extendedProperties: { private: { tipo: "chat-humano", chat: "abc123" } }
  });
  const todas = await cal.listarTodasLasCitas(new Date("2026-01-01"), new Date("2027-01-01"));
  assert.ok(!todas.some(c => c.id === "est1"));
  const delBot = await cal.citasDelBotAnterioresA(new Date("2027-01-01"));
  assert.ok(!delBot.some(c => c.id === "est1"));
});

test("crear_cita: un teléfono marcador se reemplaza por el WhatsApp del paciente (prueba real 16 nov 2026)", async () => {
  const { ejecutarHerramienta } = require("../tools");
  const original = cal.crearCita;
  let recibido = null;
  cal.crearCita = async (datos) => { recibido = datos; return { ok: true, eventId: "x", cuando: "lunes" }; };
  try {
    await ejecutarHerramienta("crear_cita", { nombre: "Juan Flores", telefono: "[NÚMERO DEL PACIENTE]", tipo: "consulta", primera_vez: true, start_iso: "2026-11-16T17:00:00Z" }, "5212711111111", {});
    assert.strictEqual(recibido.telefono, "5212711111111");
    await ejecutarHerramienta("crear_cita", { nombre: "Juan Flores", telefono: "271 222 3333", tipo: "consulta", primera_vez: true, start_iso: "2026-11-16T17:00:00Z" }, "5212711111111", {});
    assert.strictEqual(recibido.telefono, "271 222 3333");
  } finally { cal.crearCita = original; }
});
