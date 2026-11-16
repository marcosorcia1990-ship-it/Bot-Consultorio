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
  },
  {
    type: "function",
    function: {
      name: "consultar_mi_cita",
      description: "Consulta si este paciente ya tiene una cita agendada próximamente. Úsalo SIEMPRE antes de reagendar o cancelar, y también cuando el paciente pregunte '¿cuándo es mi cita?' o '¿a qué hora tengo que venir?'.",
      parameters: { type: "object", properties: {}, required: [] }
    }
  },
  {
    type: "function",
    function: {
      name: "reagendar_cita",
      description: "Mueve la cita existente del paciente a un nuevo horario. Úsalo cuando pida cambiar, mover, posponer o reprogramar su cita. NO uses crear_cita para esto: crearía una cita duplicada y dejaría el horario anterior ocupado. Antes de llamar aquí, usa consultar_mi_cita para verificar que tiene cita, y buscar_horarios para ofrecerle opciones reales.",
      parameters: {
        type: "object",
        properties: {
          nuevo_start_iso: {
            type: "string",
            description: "El campo start_iso EXACTO del nuevo horario que el paciente eligió de la lista que devolvió buscar_horarios."
          },
          event_id: {
            type: "string",
            description: "Opcional. Solo si la cita se localizó con buscar_cita_por_nombre: pega aquí el event_id que devolvió. Si la cita se encontró con consultar_mi_cita, omite este campo."
          }
        },
        required: ["nuevo_start_iso"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "buscar_cita_por_nombre",
      description: "Busca la cita de un paciente por su NOMBRE. Úsalo SOLO cuando consultar_mi_cita no encontró nada (tiene_cita: false) y el paciente insiste en que sí tiene cita. Antes de llamar aquí, pregúntale amablemente a nombre de quién quedó registrada la cita.",
      parameters: {
        type: "object",
        properties: {
          nombre: {
            type: "string",
            description: "El nombre completo del paciente tal como lo escribió, por ejemplo 'Alma Andrade'."
          }
        },
        required: ["nombre"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "cancelar_cita",
      description: "Cancela la cita del paciente y libera el horario para otros pacientes. Úsalo solo cuando el paciente diga claramente que ya no podrá asistir y NO quiera reagendar en ese momento. Si quiere cambiarla de fecha, usa reagendar_cita en su lugar.",
      parameters: {
        type: "object",
        properties: {
          event_id: {
            type: "string",
            description: "Opcional. Solo si la cita se localizó con buscar_cita_por_nombre: pega aquí el event_id que devolvió."
          }
        },
        required: []
      }
    }
  }
];

// Nombre aceptable para una cita: al menos nombre y apellido, sin marcadores ni genéricos
function nombreValido(nombre) {
  const n = String(nombre || "").trim();
  if (n.length < 5 || /[\[\]{}<>_]/.test(n) || /\d/.test(n)) return false;
  if (/\b(paciente|seguimiento|desconocido|nombre|cliente|usuario|sin nombre|n\/a)\b/i.test(n)) return false;
  const palabras = n.split(/\s+/).filter(p => /\p{L}{2,}/u.test(p));
  return palabras.length >= 2;
}

// Ejecuta la herramienta que la IA pidió y devuelve el resultado (string JSON)
// `sesion` es la conversación en curso: sirve para RECORDAR la cita que se localizó,
// de modo que si el paciente la busca en un mensaje y la mueve tres mensajes después,
// el sistema siga sabiendo cuál es (antes se perdía y se creaba una cita duplicada).
async function ejecutarHerramienta(nombre, args, telefonoPaciente = null, sesion = {}) {
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
          instruccion_interna: "No hay horarios libres que coincidan con lo que pidió el paciente. Explícale cuál es el horario de atención real y ofrécele las alternativas que se incluyen aquí. NO inventes horarios.",
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
      // La IA no debe inventar nombres provisionales: en la prueba real se creó una cita a
      // nombre de "[Paciente de seguimiento]" y así salió en el recordatorio y la reseña.
      if (!nombreValido(args.nombre)) {
        return JSON.stringify({
          ok: false, motivo: "nombre_invalido",
          instruccion_interna: "NO se creó la cita: falta el nombre completo real del paciente. Pídeselo (nombre y apellido) antes de volver a llamar a crear_cita. Nunca uses marcadores ni nombres genéricos."
        });
      }
      const dur = 30; // Todas las citas duran 30 minutos
      const r = await cal.crearCita({
        nombre: args.nombre,
        // Si la IA no da un teléfono real (p. ej. "[NÚMERO DEL PACIENTE]", visto en la prueba
        // real del 16 nov 2026), se usa el número de WhatsApp desde el que escribe el paciente.
        telefono: String(args.telefono || "").replace(/\D/g, "").length >= 10 ? args.telefono : (telefonoPaciente || ""),
        telefonoWa: telefonoPaciente || "",
        tipo: args.tipo,
        primeraVez: args.primera_vez,
        startISO: args.start_iso,
        duracionMin: dur
      });
      if (!r.ok) {
        const instrucciones = {
          ocupado: "Ese horario acaba de ocuparse. Discúlpate y llama a buscar_horarios de nuevo para ofrecer otras opciones.",
          fuera_de_horario: "Ese horario NO está dentro del horario de atención del consultorio. NO insistas: llama a buscar_horarios y ofrece solo las opciones que devuelva.",
          muy_pronto: "Ese horario ya pasó o es demasiado próximo (se requiere al menos 1 hora de anticipación). Llama a buscar_horarios para ofrecer opciones válidas.",
          fecha_invalida: "La fecha enviada no es válida. Llama a buscar_horarios y usa EXACTAMENTE el campo start_iso que devuelva."
        };
        return JSON.stringify({ ok: false, motivo: r.motivo, instruccion_interna: instrucciones[r.motivo] || "No se pudo crear la cita." });
      }
      return JSON.stringify({ ok: true, event_id: r.eventId, cuando: r.cuando });
    }

    if (nombre === "consultar_mi_cita") {
      if (!telefonoPaciente) return JSON.stringify({ ok: false, error: "No se pudo identificar el número del paciente." });
      const citas = await cal.buscarCitasPorTelefono(telefonoPaciente);

      if (!citas.length) {
        return JSON.stringify({ ok: true, tiene_cita: false, instruccion_interna: "Este paciente no tiene ninguna cita próxima registrada con su número de WhatsApp." });
      }

      // Varias citas con el mismo número: suele ser una familia que comparte
      // teléfono. NO se debe suponer cuál es: hay que preguntarle al paciente.
      if (citas.length > 1) {
        sesion.citaLocalizada = null;
        return JSON.stringify({
          ok: true, tiene_cita: true, varias: true,
          citas: citas.map(c => ({ event_id: c.id, nombre: c.nombre, cuando: c.cuando })),
          instruccion_interna: "Hay VARIAS citas registradas con este número (probablemente de distintos familiares). NO supongas cuál es la suya: menciónale los nombres y las fechas y pregúntale a cuál se refiere. Solo después de que confirme, usa el event_id correspondiente."
        });
      }

      const cita = citas[0];
      sesion.citaLocalizada = { id: cita.id, nombre: cita.nombre, cuando: cita.cuando };
      return JSON.stringify({
        ok: true, tiene_cita: true, cuando: cita.cuando, nombre: cita.nombre,
        estado: cita.estado, veces_reagendada: cita.reagendos || 0
      });
    }

    if (nombre === "reagendar_cita") {
      // Localiza la cita en este orden: el event_id que envíe el modelo, la cita que
      // ya se localizó antes en esta conversación, o el teléfono del paciente.
      let cita = null;
      const idRecordado = args.event_id || (sesion.citaLocalizada && sesion.citaLocalizada.id);
      if (idRecordado) {
        cita = await cal.buscarCitaPorId(idRecordado);
      }
      if (!cita && telefonoPaciente) {
        const candidatas = await cal.buscarCitasPorTelefono(telefonoPaciente);
        if (candidatas.length > 1) {
          return JSON.stringify({
            ok: false, motivo: "varias_citas",
            citas: candidatas.map(c => ({ event_id: c.id, nombre: c.nombre, cuando: c.cuando })),
            instruccion_interna: "NO se movió nada. Hay VARIAS citas con este número (probablemente de distintos familiares). Menciónale los nombres y fechas y pregúntale cuál desea mover. Solo entonces vuelve a llamar a reagendar_cita con el event_id correcto."
          });
        }
        cita = candidatas[0] || null;
      }
      if (!cita) {
        return JSON.stringify({ ok: false, motivo: "sin_cita", instruccion_interna: "NO se localizó la cita, así que NO se movió nada. NO crees una cita nueva sin avisarle: pregúntale primero a nombre de quién quedó registrada y usa buscar_cita_por_nombre." });
      }
      const anterior = cita.cuando;
      const r = await cal.reagendarCita(cita.id, args.nuevo_start_iso, 30);
      if (!r.ok) {
        const instrucciones = {
          ocupado: "Ese horario acaba de ocuparse. Llama a buscar_horarios y ofrece otras opciones.",
          fuera_de_horario: "Ese horario NO está dentro del horario de atención. Llama a buscar_horarios y ofrece solo lo que devuelva.",
          muy_pronto: "Ese horario ya pasó o es demasiado próximo (se requiere 1 hora de anticipación).",
          fecha_invalida: "La fecha no es válida. Usa EXACTAMENTE el start_iso que devolvió buscar_horarios."
        };
        return JSON.stringify({ ok: false, motivo: r.motivo, instruccion_interna: instrucciones[r.motivo] || "No se pudo mover la cita." });
      }
      return JSON.stringify({
        ok: true, anterior, nueva: r.cuando, veces_reagendada: r.veces,
        aviso_equipo: r.veces >= 3 ? "Esta cita ya se ha reprogramado 3 o más veces." : null
      });
    }

    if (nombre === "cancelar_cita") {
      let cita = null;
      const idRecordado = args.event_id || (sesion.citaLocalizada && sesion.citaLocalizada.id);
      if (idRecordado) {
        cita = await cal.buscarCitaPorId(idRecordado);
      }
      if (!cita && telefonoPaciente) {
        const candidatas = await cal.buscarCitasPorTelefono(telefonoPaciente);
        if (candidatas.length > 1) {
          return JSON.stringify({
            ok: false, motivo: "varias_citas",
            citas: candidatas.map(c => ({ event_id: c.id, nombre: c.nombre, cuando: c.cuando })),
            instruccion_interna: "NO se canceló nada. Hay VARIAS citas con este número (probablemente de distintos familiares). Pregúntale cuál desea cancelar mencionándole nombres y fechas, y confirma antes de proceder."
          });
        }
        cita = candidatas[0] || null;
      }
      if (!cita) {
        return JSON.stringify({ ok: false, motivo: "sin_cita", instruccion_interna: "NO se localizó la cita, así que no se canceló nada. Pregúntale a nombre de quién quedó registrada y usa buscar_cita_por_nombre." });
      }
      await cal.cancelarCita(cita.id);
      sesion.citaLocalizada = null;
      return JSON.stringify({ ok: true, cancelada: cita.cuando });
    }

    if (nombre === "buscar_cita_por_nombre") {
      const encontradas = await cal.buscarCitasPorNombre(args.nombre);
      const vigentes = encontradas.filter(c => c.estado !== "cancelada");
      const canceladas = encontradas.filter(c => c.estado === "cancelada");

      if (!encontradas.length) {
        return JSON.stringify({
          ok: true, encontradas: 0,
          instruccion_interna: "No hay ninguna cita registrada con ese nombre en los próximos 30 días. Pregúntale si pudo haber quedado a nombre de un familiar; si insiste en que sí la tiene, dile que el equipo lo verificará y agrega [AVISAR_EQUIPO]. También puedes ofrecerle agendar una nueva con buscar_horarios."
        });
      }

      if (!vigentes.length && canceladas.length) {
        return JSON.stringify({
          ok: true, encontradas: 0, habia_cancelada: true,
          canceladas: canceladas.map(c => ({ nombre: c.nombre, cuando: c.cuando })),
          instruccion_interna: "La cita de ese paciente aparece CANCELADA, por eso no se puede mover. Explícaselo con tacto y ofrécele agendar una nueva con buscar_horarios."
        });
      }

      // Si hay una sola, la recordamos: así seguirá disponible aunque el paciente
      // tarde varios mensajes en decidir la nueva fecha.
      if (vigentes.length === 1) {
        sesion.citaLocalizada = { id: vigentes[0].id, nombre: vigentes[0].nombre, cuando: vigentes[0].cuando };
      }

      return JSON.stringify({
        ok: true,
        encontradas: vigentes.length,
        citas: vigentes.map(c => ({ event_id: c.id, nombre: c.nombre, cuando: c.cuando })),
        instruccion_interna: vigentes.length === 1
          ? "Confírmale al paciente la fecha y hora encontradas antes de moverla o cancelarla. Ya quedó registrada: puedes llamar a reagendar_cita o cancelar_cita sin repetir la búsqueda."
          : "Hay varias citas con ese nombre: pregúntale al paciente cuál es la suya (menciónale las fechas) y luego usa el event_id de la que confirme."
      });
    }

    return JSON.stringify({ ok: false, error: "Herramienta desconocida" });
  } catch (e) {
    console.error(`Error en herramienta ${nombre}:`, e.message);
    return JSON.stringify({ ok: false, error: "No se pudo consultar el calendario en este momento." });
  }
}

module.exports = { TOOLS, ejecutarHerramienta, nombreValido };
