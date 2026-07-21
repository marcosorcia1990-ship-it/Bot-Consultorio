// ============================================================
// Herramientas de agendado (function calling) para la IA
// Conecta la conversación con el motor de calendar.js
// ============================================================

const cal = require("./calendar");

// Definición de las herramientas que la IA puede invocar (formato OpenAI)
const TOOLS = [
  {
    type: "function",
    function: {
      name: "buscar_horarios",
      description: "Consulta el calendario real y devuelve horarios LIBRES para agendar. Úsalo cuando el paciente quiere agendar y ya sabes si es primera vez o subsecuente. NUNCA inventes horarios: usa solo los que devuelve esta función.",
      parameters: {
        type: "object",
        properties: {
          primera_vez: {
            type: "boolean",
            description: "true si es primera consulta (dura 60 min), false si es subsecuente/seguimiento (dura 30 min)."
          },
          preferencia: {
            type: "string",
            description: "Opcional. Preferencia del paciente en texto libre, ej. 'el jueves', 'por la tarde', 'la próxima semana'. Déjalo vacío si no expresó preferencia."
          }
        },
        required: ["primera_vez"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "crear_cita",
      description: "Crea la cita en el calendario. SOLO llama a esto cuando tengas TODOS estos datos confirmados: nombre completo, teléfono, tipo de cita (consulta o valoración preoperatoria), si es primera vez o subsecuente, y el horario exacto que el paciente eligió de la lista que te dio buscar_horarios.",
      parameters: {
        type: "object",
        properties: {
          nombre: { type: "string", description: "Nombre completo del paciente." },
          telefono: { type: "string", description: "Teléfono de contacto del paciente." },
          tipo: { type: "string", enum: ["consulta", "valoración preoperatoria"], description: "Tipo de cita." },
          primera_vez: { type: "boolean", description: "true=primera vez (60min), false=subsecuente (30min)." },
          start_iso: { type: "string", description: "El campo 'start_iso' EXACTO del horario que el paciente eligió (te lo dio buscar_horarios). No lo inventes ni lo modifiques." }
        },
        required: ["nombre", "telefono", "tipo", "primera_vez", "start_iso"]
      }
    }
  }
];

// Ejecuta la herramienta que la IA pidió y devuelve el resultado (string JSON)
async function ejecutarHerramienta(nombre, args) {
  try {
    if (nombre === "buscar_horarios") {
      const dur = args.primera_vez ? 60 : 30;
      const opciones = await cal.buscarHorarios(dur, 14, 3);
      if (!opciones.length) {
        return JSON.stringify({
          ok: true, hay_horarios: false,
          mensaje: "No hay horarios libres en los próximos días dentro del horario de atención."
        });
      }
      return JSON.stringify({
        ok: true, hay_horarios: true, duracion_min: dur,
        opciones: opciones.map(o => ({ start_iso: o.start.toISOString(), texto: o.label }))
      });
    }

    if (nombre === "crear_cita") {
      const dur = args.primera_vez ? 60 : 30;
      const r = await cal.crearCita({
        nombre: args.nombre,
        telefono: args.telefono,
        tipo: args.tipo,
        primeraVez: args.primera_vez,
        startISO: args.start_iso,
        duracionMin: dur
      });
      if (!r.ok && r.motivo === "ocupado") {
        return JSON.stringify({ ok: false, motivo: "ocupado", mensaje: "Ese horario acaba de ocuparse. Ofrece buscar otro." });
      }
      return JSON.stringify({ ok: true, event_id: r.eventId, cuando: r.cuando });
    }

    return JSON.stringify({ ok: false, error: "Herramienta desconocida" });
  } catch (e) {
    console.error(`Error en herramienta ${nombre}:`, e.message);
    return JSON.stringify({ ok: false, error: "No se pudo consultar el calendario en este momento." });
  }
}

module.exports = { TOOLS, ejecutarHerramienta };
