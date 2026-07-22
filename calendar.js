// ============================================================
// Módulo de Google Calendar — Consultorio Dr. Marco A. Mixteco
// Maneja: disponibilidad real, creación de citas, y colores de estado.
// ============================================================

const { google } = require("googleapis");

const CALENDAR_ID = process.env.CALENDAR_ID;           // Calendario donde se CREAN las citas
// Calendarios que se REVISAN para detectar horarios ocupados (separados por comas).
// Debe incluir todos los calendarios donde puedan existir citas o compromisos.
const CALENDARS_BUSY = (process.env.CALENDARS_BUSY || process.env.CALENDAR_ID || "")
  .split(",").map(c => c.trim()).filter(Boolean);
const TIMEZONE = "America/Mexico_City";
const SLOT_STEP_MIN = 30;                              // resolución de la rejilla de horarios

// Etiqueta que marca los eventos creados por el bot (para no tocar los personales)
const BOT_TAG = "bot-consultorio";

// Colores de Google Calendar (por ID). 5=amarillo, 10=verde, 11=rojo, 9=azul
const COLOR = { PENDIENTE: "5", CONFIRMADA: "10", CANCELADA: "11", NUEVA: "9" };

// Rangos de atención por día de la semana (0=domingo ... 6=sábado)
// Cada rango es [horaInicio, minInicio, horaFin, minFin]
const RANGOS = {
  1: [[11, 0, 15, 0], [18, 0, 19, 30]],   // Lunes
  3: [[11, 0, 15, 0], [18, 0, 19, 30]],   // Miércoles
  5: [[11, 0, 15, 0], [18, 0, 19, 30]],   // Viernes
  2: [[9, 30, 14, 30]],                    // Martes
  4: [[9, 30, 14, 30]],                    // Jueves
  6: [[9, 30, 14, 30]],                    // Sábado
  0: []                                    // Domingo cerrado
};

const MIN_ANTICIPACION_MS = 60 * 60 * 1000; // 1 hora

let calendar = null;

function initCalendar() {
  if (calendar) return calendar;

  const raw = process.env.GOOGLE_CREDENTIALS_JSON;
  if (!raw) throw new Error("Falta la variable GOOGLE_CREDENTIALS_JSON");

  let creds;
  try {
    creds = JSON.parse(raw);
  } catch (e) {
    throw new Error("GOOGLE_CREDENTIALS_JSON no es un JSON válido (revisa que esté completo)");
  }

  if (!creds.client_email || !creds.private_key) {
    throw new Error("Las credenciales no tienen client_email o private_key");
  }

  // Normalizar la private_key: si los saltos de línea llegaron como texto "\n"
  // (en vez de saltos reales), convertirlos. Esto pasa seguido al pegar el JSON.
  let privateKey = creds.private_key;
  if (privateKey.includes("\\n")) {
    privateKey = privateKey.replace(/\\n/g, "\n");
  }

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: creds.client_email,
      private_key: privateKey
    },
    scopes: ["https://www.googleapis.com/auth/calendar"]
  });

  calendar = google.calendar({ version: "v3", auth });
  console.log("📅 Calendario conectado como:", creds.client_email);
  return calendar;
}

// ---------- Utilidades de fecha (en zona horaria de México) ----------
function partsInTZ(date) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, weekday: "short"
  });
  const p = {};
  for (const part of f.formatToParts(date)) p[part.type] = part.value;
  return p; // {year, month, day, hour, minute, weekday...}
}

// Construye un objeto Date que corresponde a una hora local de México
function mxDate(y, mo, d, h, mi) {
  // Usamos el truco de offset: creamos la fecha como si fuera UTC y ajustamos
  const asUTC = new Date(Date.UTC(y, mo - 1, d, h, mi, 0));
  const p = partsInTZ(asUTC);
  const localAsUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, 0);
  const diff = asUTC.getTime() - localAsUTC;
  return new Date(asUTC.getTime() + diff);
}

function dayOfWeekMX(date) {
  const wd = partsInTZ(date).weekday; // "Mon", "Tue"...
  return { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[wd];
}

// ---------- Disponibilidad ----------
// filtros: { fechaDeseada: "YYYY-MM-DD", desdeHora: "HH:MM", hastaHora: "HH:MM" }
async function buscarHorarios(duracionMin, diasVista = 14, maxOpciones = 3, filtros = {}) {
  const cal = initCalendar();
  const ahora = new Date();
  const finVentana = new Date(ahora.getTime() + diasVista * 24 * 60 * 60 * 1000);

  // Consultar ocupación en TODOS los calendarios configurados (freebusy)
  let ocupados = [];
  try {
    const fb = await cal.freebusy.query({
      requestBody: {
        timeMin: ahora.toISOString(),
        timeMax: finVentana.toISOString(),
        timeZone: TIMEZONE,
        items: CALENDARS_BUSY.map(id => ({ id }))
      }
    });
    const cals = fb.data.calendars || {};
    for (const [id, info] of Object.entries(cals)) {
      if (info.errors && info.errors.length) {
        console.warn(`⚠️ No se pudo leer el calendario "${id}":`, JSON.stringify(info.errors));
        continue;
      }
      for (const b of (info.busy || [])) {
        ocupados.push({ ini: new Date(b.start), fin: new Date(b.end) });
      }
    }
    console.log(`🗓️  Revisando ${CALENDARS_BUSY.length} calendario(s); ${ocupados.length} bloques ocupados encontrados`);
  } catch (e) {
    // Si freebusy falla, no arriesgamos empalmes: mejor no ofrecer horarios.
    console.error("Error consultando disponibilidad:", e.message);
    throw e;
  }

  // Convertir filtros de hora a minutos desde medianoche
  const aMinutos = (hhmm) => {
    const m = String(hhmm || "").match(/^(\d{1,2}):(\d{2})$/);
    return m ? (+m[1]) * 60 + (+m[2]) : null;
  };
  const desdeMin = aMinutos(filtros.desdeHora);
  const hastaMin = aMinutos(filtros.hastaHora);

  const libres = [];
  for (let d = 0; d < diasVista; d++) {
    const dia = new Date(ahora.getTime() + d * 24 * 60 * 60 * 1000);
    const p = partsInTZ(dia);
    const fechaISO = `${p.year}-${p.month}-${p.day}`;

    // Filtro por fecha específica solicitada
    if (filtros.fechaDeseada && filtros.fechaDeseada !== fechaISO) continue;

    const dow = dayOfWeekMX(dia);
    const rangos = RANGOS[dow] || [];

    for (const [h1, m1, h2, m2] of rangos) {
      let cursor = mxDate(+p.year, +p.month, +p.day, h1, m1);
      const finRango = mxDate(+p.year, +p.month, +p.day, h2, m2);

      while (cursor.getTime() + duracionMin * 60000 <= finRango.getTime() + 1) {
        const slotIni = cursor;
        const slotFin = new Date(cursor.getTime() + duracionMin * 60000);
        const pc = partsInTZ(slotIni);
        const minutoDelDia = (+pc.hour) * 60 + (+pc.minute);

        const suficienteAnticipacion = slotIni.getTime() - ahora.getTime() >= MIN_ANTICIPACION_MS;
        const chocaConAlgo = ocupados.some(o => slotIni < o.fin && slotFin > o.ini);
        const cumpleDesde = desdeMin === null || minutoDelDia >= desdeMin;
        const cumpleHasta = hastaMin === null || minutoDelDia < hastaMin;

        if (suficienteAnticipacion && !chocaConAlgo && cumpleDesde && cumpleHasta) {
          libres.push({ start: new Date(slotIni), label: etiquetaHora(slotIni), fecha: fechaISO });
        }
        cursor = new Date(cursor.getTime() + SLOT_STEP_MIN * 60000);
      }
    }
  }

  // Si se pidió una fecha específica, devolver varias opciones de ese día.
  // Si no, repartir entre días (hasta 2 por día) para dar variedad sin abrumar.
  const resultado = [];
  if (filtros.fechaDeseada) {
    resultado.push(...libres.slice(0, Math.max(maxOpciones, 6)));
  } else {
    const porDia = {};
    for (const l of libres) {
      porDia[l.fecha] = (porDia[l.fecha] || 0) + 1;
      if (porDia[l.fecha] <= 2) resultado.push(l);
      if (resultado.length >= maxOpciones) break;
    }
    if (resultado.length < maxOpciones) {
      for (const l of libres) {
        if (!resultado.includes(l)) resultado.push(l);
        if (resultado.length >= maxOpciones) break;
      }
    }
  }
  return resultado;
}

// Texto legible de los horarios de atención (para que el bot los explique correctamente)
function textoHorarioAtencion() {
  return "Lunes, miércoles y viernes de 11:00 a 15:00 y de 18:00 a 19:30. " +
         "Martes, jueves y sábado de 09:30 a 14:30. Domingo no hay consulta.";
}

function etiquetaHora(date) {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: TIMEZONE, weekday: "long", day: "numeric", month: "long",
    hour: "numeric", minute: "2-digit", hour12: true
  }).format(date);
}

// Valida que un horario propuesto caiga COMPLETO dentro de los rangos de atención.
// Salvaguarda crítica: impide crear citas de madrugada o fuera de horario por errores de zona horaria.
function estaDentroDeRango(start, duracionMin) {
  const p = partsInTZ(start);
  const dow = dayOfWeekMX(start);
  const rangos = RANGOS[dow] || [];
  const fin = new Date(start.getTime() + duracionMin * 60000);

  for (const [h1, m1, h2, m2] of rangos) {
    const ini = mxDate(+p.year, +p.month, +p.day, h1, m1);
    const finR = mxDate(+p.year, +p.month, +p.day, h2, m2);
    if (start >= ini && fin <= new Date(finR.getTime() + 1000)) return true;
  }
  return false;
}

// ---------- Crear cita ----------
// Convierte el texto de fecha recibido en un Date correcto.
// Si llega "2026-07-23T09:30:00" (sin Z ni offset), se interpreta como hora de MÉXICO,
// no como UTC. Sin esto, las citas se crean con 6 horas de desfase.
function parseFechaMX(texto) {
  const s = String(texto).trim();
  const tieneZona = /Z$|[+-]\d{2}:?\d{2}$/.test(s);
  if (tieneZona) return new Date(s);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return new Date(s);
  return mxDate(+m[1], +m[2], +m[3], +m[4], +m[5]);
}

async function crearCita({ nombre, telefono, tipo, primeraVez, startISO, duracionMin }) {
  const cal = initCalendar();
  const start = parseFechaMX(startISO);
  const end = new Date(start.getTime() + duracionMin * 60000);

  if (isNaN(start.getTime())) {
    return { ok: false, motivo: "fecha_invalida" };
  }

  // SALVAGUARDA 1: nunca crear citas fuera del horario de atención
  if (!estaDentroDeRango(start, duracionMin)) {
    console.error(`⛔ Intento de cita fuera de horario: ${start.toISOString()} (${etiquetaHora(start)})`);
    return { ok: false, motivo: "fuera_de_horario" };
  }

  // SALVAGUARDA 2: respetar la anticipación mínima
  if (start.getTime() - Date.now() < MIN_ANTICIPACION_MS) {
    return { ok: false, motivo: "muy_pronto" };
  }

  // Verificación final anti-choque en TODOS los calendarios (por si algo se ocupó en el ínterin)
  const fbCheck = await cal.freebusy.query({
    requestBody: {
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      timeZone: TIMEZONE,
      items: CALENDARS_BUSY.map(id => ({ id }))
    }
  });
  const choca = Object.values(fbCheck.data.calendars || {})
    .some(c => (c.busy || []).length > 0);
  if (choca) return { ok: false, motivo: "ocupado" };

  const evento = {
    summary: `Consulta – ${nombre} (${primeraVez ? "1ª vez" : "subsecuente"})`,
    description:
      `Paciente: ${nombre}\nTeléfono: ${telefono}\nTipo: ${tipo}\n` +
      `Agendado por: asistente virtual\n[${BOT_TAG}]`,
    start: { dateTime: start.toISOString(), timeZone: TIMEZONE },
    end: { dateTime: end.toISOString(), timeZone: TIMEZONE },
    colorId: COLOR.NUEVA,
    extendedProperties: { private: { creadoPor: BOT_TAG, telefono, estado: "nueva" } }
  };

  const res = await cal.events.insert({ calendarId: CALENDAR_ID, requestBody: evento });
  return { ok: true, eventId: res.data.id, cuando: etiquetaHora(start) };
}

// ---------- Cambiar color según estado (para recordatorios fase 2) ----------
async function actualizarEstadoCita(eventId, estado) {
  const cal = initCalendar();
  const colorId = COLOR[estado] || COLOR.NUEVA;
  await cal.events.patch({
    calendarId: CALENDAR_ID,
    eventId,
    requestBody: { colorId, extendedProperties: { private: { estado } } }
  });
  return { ok: true };
}

module.exports = { buscarHorarios, crearCita, actualizarEstadoCita, etiquetaHora, initCalendar, textoHorarioAtencion };
