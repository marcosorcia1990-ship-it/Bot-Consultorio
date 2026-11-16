process.env.CALENDAR_ID = "cal-prueba";
delete process.env.RESENAS_ACTIVAS;
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const cal = require("../calendar");
const recordatorios = require("../recordatorios");

const H = 60 * 60 * 1000;
// 12:00 del mediodía en Córdoba (UTC-6): dentro del horario prudente
const AHORA = Date.parse("2026-11-16T18:00:00Z");

let citas, sinAutomaticos, enviados, marcas;
beforeEach(() => {
  enviados = []; marcas = [];
  sinAutomaticos = new Set();
  cal.listarCitasDelBot = async () => citas;
  cal.telefonosSinAutomaticos = async () => sinAutomaticos;
  cal.marcarEnCita = async (id, campos) => { marcas.push({ id, campos }); };
  cal.actualizarEstadoCita = async () => ({ ok: true });
});

const enviar = { sendTemplate: async (to, plantilla) => { enviados.push({ to, plantilla }); }, alertTeam: async () => {} };

function cita(id, tel, faltanHoras, extra = {}) {
  return { id, nombre: "Paciente", cuando: "x", telefono: tel, telefonoWa: "521" + tel,
    inicio: new Date(AHORA + faltanHoras * H), estado: "nueva", ...extra };
}

test("envía la confirmación 2 días antes", async () => {
  citas = [cita("c1", "2711111111", 48)];
  await recordatorios.revisarYEnviar({ ...enviar, ahora: AHORA });
  assert.deepStrictEqual(enviados.map(e => e.plantilla), ["confirmacion_cita"]);
});

test("respeta la BAJA: no envía nada a ese paciente", async () => {
  citas = [cita("c1", "2711111111", 48), cita("c2", "2712222222", 10)];
  sinAutomaticos = new Set(["2711111111"]);
  await recordatorios.revisarYEnviar({ ...enviar, ahora: AHORA });
  assert.deepStrictEqual(enviados.map(e => e.to), ["5212712222222"]);
});

test("respeta la baja marcada en la propia cita", async () => {
  citas = [cita("c1", "2711111111", 48, { sinAutomaticos: true })];
  await recordatorios.revisarYEnviar({ ...enviar, ahora: AHORA });
  assert.strictEqual(enviados.length, 0);
});

test("la solicitud de reseña está apagada por omisión", async () => {
  citas = [cita("c1", "2711111111", -20)];
  await recordatorios.revisarYEnviar({ ...enviar, ahora: AHORA });
  assert.strictEqual(recordatorios.RESENAS_ACTIVAS, false);
  assert.strictEqual(enviados.length, 0);
});

test("fuera del horario prudente no envía nada", async () => {
  citas = [cita("c1", "2711111111", 48)];
  await recordatorios.revisarYEnviar({ ...enviar, ahora: Date.parse("2026-11-16T08:00:00Z") }); // 2:00 am
  assert.strictEqual(enviados.length, 0);
});

test("recordatorio: NO sale la noche anterior (caso real del 12 de agosto de 2026)", async () => {
  // Cita: jueves 13 de agosto, 10:00 (México). Revisión: miércoles 12, 20:07 (México).
  const cita13 = Date.parse("2026-08-13T16:00:00Z");
  citas = [{ id: "r1", nombre: "Paciente", cuando: "x", telefono: "2711111111", telefonoWa: "5212711111111",
    inicio: new Date(cita13), estado: "confirmada", confirmacionEnviada: true }];
  await recordatorios.revisarYEnviar({ ...enviar, ahora: Date.parse("2026-08-13T02:07:00Z") });
  assert.strictEqual(enviados.length, 0);
  // El mismo jueves a las 7:45 (México) sí sale
  await recordatorios.revisarYEnviar({ ...enviar, ahora: Date.parse("2026-08-13T13:45:00Z") });
  assert.deepStrictEqual(enviados.map(e => e.plantilla), ["recordatorio_cita"]);
});
