#!/usr/bin/env node
// ============================================================
// Herramienta para atender solicitudes ARCO (uso EXCLUSIVO del personal autorizado).
// No se ejecuta sola ni la puede usar el bot: la corre una persona, después de
// verificar la identidad del solicitante y registrar la solicitud.
// Ver docs/PROCEDIMIENTO-ARCO.md
//
//   node scripts/arco.js buscar     --telefono 2711234567
//   node scripts/arco.js anonimizar --telefono 2711234567 --folio ARCO-2026-001 [--incluir-manuales] [--confirmar]
//   node scripts/arco.js baja       --telefono 2711234567
//
// Sin --confirmar, "anonimizar" solo muestra lo que haría (no cambia nada).
// Requiere CALENDAR_ID y GOOGLE_CREDENTIALS_JSON en el entorno.
// ============================================================

const AÑO_MS = 365 * 24 * 60 * 60 * 1000;
const FOLIO_VALIDO = /^ARCO-\d{4}-\d{3,}$/;

function leerArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const clave = a.slice(2);
      const sig = argv[i + 1];
      if (sig === undefined || sig.startsWith("--")) args[clave] = true;
      else { args[clave] = sig; i++; }
    } else args._.push(a);
  }
  return args;
}

async function ejecutar(argv, { cal = require("../calendar"), salida = console.log, ahora = Date.now() } = {}) {
  const args = leerArgs(argv);
  const comando = args._[0];
  const telefono = String(args.telefono || "").replace(/\D/g, "").slice(-10);

  if (!["buscar", "anonimizar", "baja"].includes(comando)) {
    salida("Uso: node scripts/arco.js <buscar|anonimizar|baja> --telefono 2711234567 [--folio ARCO-AAAA-NNN] [--incluir-manuales] [--confirmar]");
    return { ok: false, motivo: "comando" };
  }
  if (telefono.length !== 10) {
    salida("Indique --telefono con 10 dígitos.");
    return { ok: false, motivo: "telefono" };
  }

  if (comando === "baja") {
    const n = await cal.marcarSinAutomaticos(telefono);
    salida(n > 0
      ? `Baja registrada en ${n} cita(s). No recibirá confirmaciones, recordatorios ni reseñas automáticas.`
      : "No hay citas del bot con ese número: la baja NO quedó guardada. Anótela en el registro y vuelva a correr este comando cuando el paciente tenga una cita.");
    return { ok: n > 0, marcadas: n };
  }

  // Ventana amplia: 3 años hacia atrás y 1 hacia adelante
  const desde = args.desde ? new Date(args.desde) : new Date(ahora - 3 * AÑO_MS);
  const hasta = new Date(ahora + AÑO_MS);
  const eventos = await cal.buscarEventosDePaciente(telefono, desde, hasta);

  if (comando === "buscar") {
    salida(`Eventos encontrados: ${eventos.length} (del ${desde.toISOString().slice(0, 10)} en adelante)`);
    for (const e of eventos) {
      salida(`- ${e.id} | ${e.cuando} | ${e.creadaPorBot ? "creada por el bot" : "capturada a mano"} | estado: ${e.estado || "-"}${e.anonimizado ? " | YA ANONIMIZADA" : ""}`);
    }
    return { ok: true, eventos };
  }

  // anonimizar
  const folio = String(args.folio || "");
  if (!FOLIO_VALIDO.test(folio)) {
    salida("Indique --folio con el formato ARCO-AAAA-NNN (el folio del registro de solicitudes).");
    return { ok: false, motivo: "folio" };
  }
  const objetivo = eventos.filter(e => !e.anonimizado && (e.creadaPorBot || args["incluir-manuales"]));
  const excluidos = eventos.filter(e => !e.anonimizado && !e.creadaPorBot && !args["incluir-manuales"]);

  salida(`Folio ${folio}: ${objetivo.length} evento(s) por anonimizar.`);
  for (const e of objetivo) salida(`- ${e.id} | ${e.cuando} | ${e.creadaPorBot ? "bot" : "manual"}`);
  if (excluidos.length) {
    salida(`${excluidos.length} evento(s) capturados a mano NO se tocarán (use --incluir-manuales solo si el responsable lo autorizó).`);
  }

  if (!args.confirmar) {
    salida("MODO DE PRUEBA: no se modificó nada. Repita con --confirmar para aplicar.");
    return { ok: true, prueba: true, objetivo };
  }

  const hechos = [];
  for (const e of objetivo) {
    await cal.anonimizarEvento(e.id, folio);
    hechos.push(e.id);
  }
  // Línea para copiar al registro de solicitudes (no contiene el teléfono ni el nombre)
  salida("REGISTRO: " + JSON.stringify({
    folio, fecha: new Date(ahora).toISOString(), accion: "anonimizar_agenda",
    eventos_anonimizados: hechos.length, ids: hechos
  }));
  return { ok: true, anonimizados: hechos };
}

module.exports = { ejecutar, leerArgs };

if (require.main === module) {
  ejecutar(process.argv.slice(2))
    .then(r => process.exit(r.ok ? 0 : 1))
    .catch(e => { console.error("Error:", e.message); process.exit(1); });
}
