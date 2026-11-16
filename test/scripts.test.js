const { test } = require("node:test");
const assert = require("node:assert");
const arco = require("../scripts/arco");
const conservacion = require("../scripts/conservacion");

function calFalso(eventos) {
  const anonimizados = [];
  return {
    anonimizados,
    async buscarEventosDePaciente() { return eventos; },
    async anonimizarEvento(id, folio) { anonimizados.push({ id, folio }); return { ok: true }; },
    async marcarSinAutomaticos() { return 0; },
    async citasDelBotAnterioresA() { return eventos.filter(e => e.creadaPorBot); }
  };
}

const EVENTOS = [
  { id: "a1", cuando: "lunes", creadaPorBot: true, estado: "nueva", anonimizado: false, inicio: "2025-01-01" },
  { id: "m1", cuando: "martes", creadaPorBot: false, estado: "", anonimizado: false, inicio: "2025-02-01" },
  { id: "z1", cuando: "miércoles", creadaPorBot: true, estado: "", anonimizado: true, inicio: "2025-03-01" }
];

function correr(mod, argv, eventos = EVENTOS) {
  const lineas = [];
  const cal = calFalso(eventos);
  return mod.ejecutar(argv, { cal, salida: l => lineas.push(l) }).then(r => ({ r, lineas, cal }));
}

test("ARCO: sin --confirmar es modo de prueba y no modifica nada", async () => {
  const { r, cal, lineas } = await correr(arco, ["anonimizar", "--telefono", "2711234567", "--folio", "ARCO-2026-001"]);
  assert.strictEqual(r.prueba, true);
  assert.strictEqual(cal.anonimizados.length, 0);
  assert.ok(lineas.some(l => /MODO DE PRUEBA/.test(l)));
});

test("ARCO: exige un folio del registro", async () => {
  const { r, cal } = await correr(arco, ["anonimizar", "--telefono", "2711234567", "--confirmar"]);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.motivo, "folio");
  assert.strictEqual(cal.anonimizados.length, 0);
});

test("ARCO: con --confirmar anonimiza solo citas del bot, no las manuales ni las ya anonimizadas", async () => {
  const { r, cal, lineas } = await correr(arco, ["anonimizar", "--telefono", "2711234567", "--folio", "ARCO-2026-001", "--confirmar"]);
  assert.deepStrictEqual(cal.anonimizados.map(a => a.id), ["a1"]);
  assert.ok(r.ok);
  const registro = lineas.find(l => l.startsWith("REGISTRO: "));
  assert.ok(registro);
  assert.ok(!registro.includes("2711234567"), "el registro no lleva el teléfono");
});

test("ARCO: las citas capturadas a mano solo se tocan con autorización expresa", async () => {
  const { cal } = await correr(arco, ["anonimizar", "--telefono", "2711234567", "--folio", "ARCO-2026-001", "--incluir-manuales", "--confirmar"]);
  assert.deepStrictEqual(cal.anonimizados.map(a => a.id).sort(), ["a1", "m1"]);
});

test("ARCO: rechaza teléfonos incompletos", async () => {
  const { r } = await correr(arco, ["buscar", "--telefono", "123"]);
  assert.strictEqual(r.motivo, "telefono");
});

test("ARCO: la baja sin citas del bot avisa que NO quedó guardada", async () => {
  const { r, lineas } = await correr(arco, ["baja", "--telefono", "2711234567"]);
  assert.strictEqual(r.ok, false);
  assert.ok(lineas.some(l => /NO quedó guardada/.test(l)));
});

test("Conservación: no hay plazo predeterminado", async () => {
  const { r } = await correr(conservacion, ["reporte"]);
  assert.strictEqual(r.ok, false);
});

test("Conservación: reporte no modifica; anonimizar exige folio y --confirmar", async () => {
  let x = await correr(conservacion, ["reporte", "--dias", "365"]);
  assert.strictEqual(x.cal.anonimizados.length, 0);
  x = await correr(conservacion, ["anonimizar", "--dias", "365", "--confirmar"]);
  assert.strictEqual(x.r.motivo, "folio");
  x = await correr(conservacion, ["anonimizar", "--dias", "365", "--folio", "CONS-2026-001"]);
  assert.strictEqual(x.r.prueba, true);
  assert.strictEqual(x.cal.anonimizados.length, 0);
  x = await correr(conservacion, ["anonimizar", "--dias", "365", "--folio", "CONS-2026-001", "--confirmar"]);
  assert.strictEqual(x.cal.anonimizados.length, 2);
});
