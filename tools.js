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
      description: "Consulta el calendario real y devuelve horarios LIBRES para agendar. Úsalo SIEMPRE que el paciente quiera agendar o pregunte por disponibilidad, incluso si ya lo llamaste antes y el paciente pidió otro día u otra hora. NUNCA ofrezcas un horario que no venga de esta función.",
      parameters: {
        type: "object",
        properties: {
          primera_vez: {
            type: "boolean",
            description: "true si es su primera consulta con el doctor, false si es paciente de seguimiento. Todas las citas duran 30 minutos; este dato solo se registra en el evento."
          },
          fecha_deseada: {
            type: "string",
            description: "Opcional. Fecha específica que pidió el paciente, en formato YYYY-MM-DD. Úsalo cuando diga 'el jueves', 'mañana', 'el 25', etc. Calcúlala a partir de la fecha de hoy que aparece en el contexto."
          },
          desde_hora: {
            type: "string",
            description: "Opcional. Hora mínima solicitada en formato 24h 'HH:MM'. Ej: si pide 'después de las 5 de la tarde' usa '17:00'; si pide 'por la tarde' usa '14:00'."
          },
          hasta_hora: {
            type: "string",
            description: "Opcional. Hora máxima solicitada en formato 24h 'HH:MM'. Ej: si pide 'por la mañana' usa '12:00'; si pide 'antes de las 2' usa '14:00'."
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
          primera_vez: { type: "boolean", description: "true si es primera vez, false si es subsecuente. Sirve para el registro de la cita." },
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
      const dur = 30; // Todas las citas duran 30 minutos
      const filtros = {
        fechaDeseada: args.fecha_deseada || null,
        desdeHora: args.desde_hora || null,
        hastaHora: args.hasta_hora || null
      };
      const opciones = await cal.buscarHorarios(dur, 14, 6, filtros);

      if (!opciones.length) {
        // Buscar sin filtros para poder ofrecer alternativas reales
        const alternativas = await cal.buscarHorarios(dur, 14, 6, {});
        return JSON.stringify({
          ok: true,
          hay_horarios: false,
          mensaje: "No hay horarios libres que coincidan con lo que pidió el paciente. Explícale cuál es el horario de atención real y ofrécele las alternativas que se incluyen aquí. NO inventes horarios.",
          horario_atencion: cal.textoHorarioAtencion(),
          alternativas: alternativas.map(o => ({ start_iso: o.start.toISOString(), texto: o.label }))
        });
      }

      return JSON.stringify({
        ok: true, hay_horarios: true, duracion_min: dur,
        horario_atencion: cal.textoHorarioAtencion(),
        opciones: opciones.map(o => ({ start_iso: o.start.toISOString(), texto: o.label }))
      });
    }

    if (nombre === "crear_cita") {
      const dur = 30; // Todas las citas duran 30 minutos
      const r = await cal.crearCita({
        nombre: args.nombre,
        telefono: args.telefono,
        tipo: args.tipo,
        primeraVez: args.primera_vez,
        startISO: args.start_iso,
        duracionMin: dur
      });
      if (!r.ok) {
        const mensajes = {
          ocupado: "Ese horario acaba de ocuparse. Discúlpate y llama a buscar_horarios de nuevo para ofrecer otras opciones.",
          fuera_de_horario: "Ese horario NO está dentro del horario de atención del consultorio. NO insistas: llama a buscar_horarios y ofrece solo las opciones que devuelva.",
          muy_pronto: "Ese horario ya pasó o es demasiado próximo (se requiere al menos 1 hora de anticipación). Llama a buscar_horarios para ofrecer opciones válidas.",
          fecha_invalida: "La fecha enviada no es válida. Llama a buscar_horarios y usa EXACTAMENTE el campo start_iso que devuelva."
        };
        return JSON.stringify({ ok: false, motivo: r.motivo, mensaje: mensajes[r.motivo] || "No se pudo crear la cita." });
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
