// ============================================================
// Módulo de Google Calendar — Consultorio Dr. Marco A. Mixteco
// Maneja: disponibilidad real, creación de citas, y colores de estado.
// ============================================================

const { google } = require("googleapis");

const CALENDAR_ID = process.env.CALENDAR_ID;           // ej. internista.marco@gmail.com
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
// Devuelve lista de {start: Date, label: string} con huecos libres para una duración dada.
async function buscarHorarios(duracionMin, diasVista = 14, maxOpciones = 3) {
  const cal = initCalendar();
  const ahora = new Date();
  const finVentana = new Date(ahora.getTime() + diasVista * 24 * 60 * 60 * 1000);

  // Traer eventos existentes en la ventana (para saber qué está ocupado)
  const { data } = await cal.events.list({
    calendarId: CALENDAR_ID,
    timeMin: ahora.toISOString(),
    timeMax: finVentana.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 2500
  });
  const ocupados = (data.items || [])
    .filter(e => e.start && e.start.dateTime) // ignorar eventos de día completo
    .map(e => ({ ini: new Date(e.start.dateTime), fin: new Date(e.end.dateTime) }));

  const libres = [];
  for (let d = 0; d < diasVista && libres.length < maxOpciones * 4; d++) {
    const dia = new Date(ahora.getTime() + d * 24 * 60 * 60 * 1000);
    const p = partsInTZ(dia);
    const dow = dayOfWeekMX(dia);
    const rangos = RANGOS[dow] || [];

    for (const [h1, m1, h2, m2] of rangos) {
      let cursor = mxDate(+p.year, +p.month, +p.day, h1, m1);
      const finRango = mxDate(+p.year, +p.month, +p.day, h2, m2);

      while (cursor.getTime() + duracionMin * 60000 <= finRango.getTime() + 1) {
        const slotIni = cursor;
        const slotFin = new Date(cursor.getTime() + duracionMin * 60000);

        const suficienteAnticipacion = slotIni.getTime() - ahora.getTime() >= MIN_ANTICIPACION_MS;
        const chocaConAlgo = ocupados.some(o => slotIni < o.fin && slotFin > o.ini);

        if (suficienteAnticipacion && !chocaConAlgo) {
          libres.push({ start: new Date(slotIni), label: etiquetaHora(slotIni) });
        }
        cursor = new Date(cursor.getTime() + SLOT_STEP_MIN * 60000);
      }
    }
  }

  // Repartir opciones en días distintos para no ofrecer 3 horas del mismo día
  const porDia = {};
  const resultado = [];
  for (const l of libres) {
    const clave = l.label.split(" ").slice(0, 3).join(" ");
    porDia[clave] = (porDia[clave] || 0) + 1;
    if (porDia[clave] <= 1) resultado.push(l);
    if (resultado.length >= maxOpciones) break;
  }
  // Si no se llenó, completar con lo que haya
  if (resultado.length < maxOpciones) {
    for (const l of libres) {
      if (!resultado.includes(l)) resultado.push(l);
      if (resultado.length >= maxOpciones) break;
    }
  }
  return resultado;
}

function etiquetaHora(date) {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: TIMEZONE, weekday: "long", day: "numeric", month: "long",
    hour: "numeric", minute: "2-digit", hour12: true
  }).format(date);
}

// ---------- Crear cita ----------
async function crearCita({ nombre, telefono, tipo, primeraVez, startISO, duracionMin }) {
  const cal = initCalendar();
  const start = new Date(startISO);
  const end = new Date(start.getTime() + duracionMin * 60000);

  // Verificación final anti-choque (por si alguien agendó en el ínterin)
  const { data } = await cal.events.list({
    calendarId: CALENDAR_ID,
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: true
  });
  const choca = (data.items || []).some(e => e.start && e.start.dateTime);
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

module.exports = { buscarHorarios, crearCita, actualizarEstadoCita, etiquetaHora, initCalendar };
