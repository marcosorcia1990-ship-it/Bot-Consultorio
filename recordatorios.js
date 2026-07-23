// ============================================================
// Módulo de recordatorios — Consultorio Dr. Marco A. Mixteco
// Reemplaza el flujo de Confirmafy:
//   1. Confirmación 2 días antes (botones Sí/No) -> código de colores
//   2. Recordatorio el día de la cita (~12 h antes, nunca antes de las 7:30 am)
//   3. Seguimiento y solicitud de reseña al día siguiente
// El estado se guarda en el propio evento de Google Calendar (sobrevive reinicios).
// ============================================================

const cal = require("./calendar");

const TIMEZONE = "America/Mexico_City";
const MAPS_LINK = "https://maps.app.goo.gl/Kzsq91rhYLpdCocv5";
const TEL_CONSULTORIO = "271 116 1448";

// Nombres de las plantillas aprobadas en Meta (deben coincidir EXACTAMENTE)
const PLANTILLAS = {
  confirmacion: process.env.TPL_CONFIRMACION || "confirmacion_cita",
  recordatorio: process.env.TPL_RECORDATORIO || "recordatorio_cita",
  resena: process.env.TPL_RESENA || "seguimiento_resena"
};
const IDIOMA_PLANTILLA = process.env.TPL_LANG || "es_MX";

const H = 60 * 60 * 1000;

// Regla heredada de Confirmafy: nunca enviar antes de las 7:30 am ni de noche.
function horaPrudente() {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit", hour12: false
  }).formatToParts(new Date());
  const h = +p.find(x => x.type === "hour").value;
  const m = +p.find(x => x.type === "minute").value;
  const minutos = h * 60 + m;
  return minutos >= 7 * 60 + 30 && minutos < 21 * 60; // 7:30 am - 9:00 pm
}

// ---------- Ciclo principal (se ejecuta cada 15 min) ----------
async function revisarYEnviar({ sendTemplate, alertTeam }) {
  if (!horaPrudente()) return;

  const ahora = Date.now();
  let citas;
  try {
    citas = await cal.listarCitasDelBot(new Date(ahora - 48 * H), new Date(ahora + 96 * H));
  } catch (e) {
    console.error("No se pudieron leer las citas para recordatorios:", e.message);
    return;
  }

  const sinConfirmar = [];

  for (const cita of citas) {
    const inicio = new Date(cita.inicio).getTime();
    const faltan = inicio - ahora;
    const pasaron = ahora - inicio;
    const cancelada = cita.estado === "cancelada";

    try {
      // --- 1. Confirmación: 2 días antes (ventana 36-60 h) ---
      if (!cita.confirmacionEnviada && !cancelada && faltan > 36 * H && faltan <= 60 * H) {
        await sendTemplate(cita.telefono, PLANTILLAS.confirmacion,
          [cita.nombre || "paciente", cita.cuando], IDIOMA_PLANTILLA);
        await cal.marcarEnCita(cita.id, { confirmacionEnviada: "si", estado: "pendiente" });
        await cal.actualizarEstadoCita(cita.id, "PENDIENTE"); // amarillo
        console.log(`📤 Confirmación enviada: ${cita.nombre} — ${cita.cuando}`);
        continue;
      }

      // --- 2. Recordatorio del día de la cita (ventana 0-14 h antes) ---
      if (!cita.recordatorioEnviado && !cancelada && faltan > 0 && faltan <= 14 * H) {
        await sendTemplate(cita.telefono, PLANTILLAS.recordatorio,
          [cita.nombre || "paciente", cita.cuando], IDIOMA_PLANTILLA);
        await cal.marcarEnCita(cita.id, { recordatorioEnviado: "si" });
        console.log(`📤 Recordatorio enviado: ${cita.nombre} — ${cita.cuando}`);
        continue;
      }

      // --- 3. Seguimiento y reseña al día siguiente (12-36 h después) ---
      if (!cita.resenaEnviada && !cancelada && pasaron > 12 * H && pasaron <= 36 * H) {
        await sendTemplate(cita.telefono, PLANTILLAS.resena,
          [cita.nombre || "paciente"], IDIOMA_PLANTILLA);
        await cal.marcarEnCita(cita.id, { resenaEnviada: "si" });
        console.log(`📤 Seguimiento y reseña enviados: ${cita.nombre}`);
        continue;
      }

      // Citas próximas que siguen en amarillo (sin respuesta del paciente)
      if (cita.confirmacionEnviada && cita.estado === "pendiente" && faltan > 0 && faltan <= 30 * H) {
        sinConfirmar.push(cita);
      }
    } catch (e) {
      console.error(`Error en recordatorio de ${cita.nombre}:`, e.message);
    }
  }

  // Aviso interno: citas próximas sin confirmar (el equipo decide si llama)
  if (sinConfirmar.length && alertTeam) {
    const lista = sinConfirmar.map(c => `- ${c.nombre}: ${c.cuando}`).join("\n");
    await alertTeam(`Citas próximas SIN confirmar (amarillas):\n${lista}\n\nEl horario sigue reservado. Conviene llamarles.`);
  }
}

// ---------- Respuestas a los botones de la confirmación ----------
// Devuelve el texto a enviar al paciente, o null si no era una confirmación.
async function procesarRespuestaBoton(telefono, textoBoton) {
  const t = String(textoBoton || "").trim().toLowerCase();
  const esSi = /^(s[ií]|confirmo|confirmar|s[ií].*(asistir|confirmo))/.test(t);
  const esNo = /^(no|cancelar|cancelo|no puedo|no podr)/.test(t);
  if (!esSi && !esNo) return null;

  let cita = null;
  try {
    cita = await cal.buscarCitaPorTelefono(telefono);
  } catch (e) {
    console.error("Error buscando la cita del paciente:", e.message);
  }

  if (!cita) {
    return "Gracias por su respuesta. No localizamos una cita próxima registrada con este número; " +
           "en breve le respondemos personalmente por este medio.";
  }

  if (esSi) {
    await cal.actualizarEstadoCita(cita.id, "CONFIRMADA"); // verde
    console.log(`✅ Cita CONFIRMADA: ${cita.nombre} — ${cita.cuando}`);
    return `Cita confirmada. Gracias por confirmar su cita con el Dr. Marco A. Mixteco.\n\n` +
           `Fecha y hora: ${cita.cuando}\n` +
           `Lugar: Sanatorio Santa Rita, Consultorio #5, Córdoba, Veracruz.\n` +
           `Ubicación: ${MAPS_LINK}\n\n` +
           `Le pedimos acudir 15 minutos antes.\n` +
           `Para cualquier duda: llamada o WhatsApp ${TEL_CONSULTORIO}.`;
  }

  // Cancelación: se marca en rojo y se LIBERA el horario para otro paciente
  await cal.cancelarCita(cita.id);
  console.log(`❌ Cita CANCELADA y horario liberado: ${cita.nombre} — ${cita.cuando}`);
  return `Gracias por avisarnos. Su cita del ${cita.cuando} quedó cancelada.\n\n` +
         `Si desea reagendar, con gusto le ayudamos: indíquenos qué día le conviene y ` +
         `le compartimos los horarios disponibles.`;
}

module.exports = { revisarYEnviar, procesarRespuestaBoton, PLANTILLAS, horaPrudente };
