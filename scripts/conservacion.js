#!/usr/bin/env node
// ============================================================
// Conservación de citas creadas por el bot (uso del personal autorizado).
// NO tiene un plazo predeterminado: el plazo lo decide el responsable con asesoría
// jurídica (ver docs/POLITICA-CONSERVACION.md). Mientras no se decida, solo se usa
// el modo "reporte".
//
//   node scripts/conservacion.js reporte    --dias 365
//   node scripts/conservacion.js anonimizar --dias 365 --folio CONS-2026-001 [--confirmar]
//
// "anonimizar" quita los datos personales de las citas que terminaron hace más de
// N días (no borra el evento). Las citas capturadas a mano por el equipo no se tocan.
// ============================================================

const { leerArgs } = require("./arco");
const DIA_MS = 24 * 60 * 60 * 1000;
const FOLIO_VALIDO = /^CONS-\d{4}-\d{3,}$/;

async function ejecutar(argv, { cal = require("../calendar"), salida = console.log, ahora = Date.now() } = {}) {
  const args = leerArgs(argv);
  const comando = args._[0];
  const dias = parseInt(args.dias, 10);

  if (!["reporte", "anonimizar"].includes(comando) || !(dias > 0)) {
    salida("Uso: node scripts/conservacion.js <reporte|anonimizar> --dias N [--folio CONS-AAAA-NNN] [--confirmar]");
    salida("No hay un plazo predeterminado: N lo decide el responsable (ver docs/POLITICA-CONSERVACION.md).");
    return { ok: false, motivo: "uso" };
  }

  const limite = new Date(ahora - dias * DIA_MS);
  const citas = await cal.citasDelBotAnterioresA(limite);
  salida(`Citas creadas por el bot, anteriores al ${limite.toISOString().slice(0, 10)}, con datos personales: ${citas.length}`);
  if (citas.length) salida(`La más antigua: ${citas[0].inicio}`);

  if (comando === "reporte") return { ok: true, total: citas.length };

  const folio = String(args.folio || "");
  if (!FOLIO_VALIDO.test(folio)) {
    salida("Indique --folio con el formato CONS-AAAA-NNN (registro de la depuración autorizada).");
    return { ok: false, motivo: "folio" };
  }
  if (!args.confirmar) {
    salida("MODO DE PRUEBA: no se modificó nada. Repita con --confirmar para aplicar.");
    return { ok: true, prueba: true, total: citas.length };
  }
  for (const c of citas) await cal.anonimizarEvento(c.id, folio);
  salida("REGISTRO: " + JSON.stringify({
    folio, fecha: new Date(ahora).toISOString(), accion: "depuracion_por_conservacion",
    plazo_dias: dias, eventos_anonimizados: citas.length
  }));
  return { ok: true, anonimizados: citas.length };
}

module.exports = { ejecutar };

if (require.main === module) {
  ejecutar(process.argv.slice(2))
    .then(r => process.exit(r.ok ? 0 : 1))
    .catch(e => { console.error("Error:", e.message); process.exit(1); });
}
