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
  // Modo demo: solo los calendarios configurados (y validados al arrancar) son accesibles
  const demo = require("./demo");
  if (demo.MODO_DEMO) calendar = demo.protegerCalendario(calendar, demo.calendariosConfigurados());
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

async function crearCita({ nombre, telefono, telefonoWa, tipo, primeraVez, startISO, duracionMin }) {
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
    extendedProperties: { private: { creadoPor: BOT_TAG, telefono, telefonoWa: telefonoWa || "", nombre, estado: "nueva" } }
  };

  const res = await cal.events.insert({ calendarId: CALENDAR_ID, requestBody: evento });
  return { ok: true, eventId: res.data.id, cuando: etiquetaHora(start) };
}

// ---------- Funciones para el módulo de recordatorios ----------

// Lista las citas creadas por el bot en un rango de tiempo.
// Devuelve solo las que tienen teléfono registrado (las que el bot puede contactar).
async function listarCitasDelBot(desde, hasta) {
  const cal = initCalendar();
  const { data } = await cal.events.list({
    calendarId: CALENDAR_ID,
    timeMin: desde.toISOString(),
    timeMax: hasta.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 250,
    privateExtendedProperty: `creadoPor=${BOT_TAG}`
  });
  return (data.items || [])
    .filter(e => e.start && e.start.dateTime)
    .map(e => {
      const priv = (e.extendedProperties && e.extendedProperties.private) || {};
      return {
        id: e.id,
        titulo: e.summary || "",
        inicio: new Date(e.start.dateTime),
        cuando: etiquetaHora(new Date(e.start.dateTime)),
        telefono: priv.telefono || "",
        telefonoWa: priv.telefonoWa || "",
        estado: priv.estado || "nueva",
        confirmacionEnviada: priv.confirmacionEnviada === "si",
        recordatorioEnviado: priv.recordatorioEnviado === "si",
        resenaEnviada: priv.resenaEnviada === "si",
        sinAutomaticos: priv.sinAutomaticos === "si",
        reagendos: parseInt(priv.reagendos || "0", 10) || 0,
        nombre: (priv.nombre || (e.summary || "").replace(/^Consulta – /, "").replace(/\s*\(.*\)$/, "")).trim()
      };
    })
    .filter(c => c.telefono || c.telefonoWa);
}

// Marca una bandera en la cita (confirmacionEnviada, recordatorioEnviado, resenaEnviada).
// Lee primero las propiedades existentes para NO borrar las demás banderas:
// perder una bandera significaría reenviar mensajes al paciente.
async function marcarEnCita(eventId, campos) {
  const cal = initCalendar();
  const { data } = await cal.events.get({ calendarId: CALENDAR_ID, eventId });
  const priv = (data.extendedProperties && data.extendedProperties.private) || {};
  await cal.events.patch({
    calendarId: CALENDAR_ID,
    eventId,
    requestBody: { extendedProperties: { private: { ...priv, ...campos } } }
  });
}

// Extrae un teléfono de un texto libre (título o descripción del evento).
// Devuelve los últimos 10 dígitos, que es como se comparan los números.
function extraerTelefono(texto) {
  const candidatos = String(texto || "").match(/\+?\d[\d\s\-().]{7,}/g) || [];
  for (const c of candidatos) {
    const digitos = c.replace(/\D/g, "");
    if (digitos.length >= 10) return digitos.slice(-10);
  }
  return "";
}

// Limpia el título de un evento para quedarse solo con el nombre del paciente.
// Sirve tanto para "Consulta – Alma Andrade (1ª vez)" como para "Alma Andrade 2711403390".
function nombreDesdeTitulo(titulo) {
  return String(titulo || "")
    .replace(/^consulta\s*[–—-]\s*/i, "")
    .replace(/\((1ª|1a|primera)\s*vez\)/gi, "")
    .replace(/\(subsecuente\)/gi, "")
    .replace(/\+?\d[\d\s\-().]{6,}/g, " ")   // quita los teléfonos del título
    .replace(/\s+/g, " ")
    .trim();
}

// Lee TODAS las citas del calendario en un rango: las que creó el bot Y las que
// el equipo capturó a mano. Para distinguir una cita de paciente de un evento
// personal del doctor, exige que tenga un teléfono en el título o la descripción
// (así es como el equipo las registra) o que la haya creado el bot.
async function listarTodasLasCitas(desde, hasta) {
  const cal = initCalendar();
  const { data } = await cal.events.list({
    calendarId: CALENDAR_ID,
    timeMin: desde.toISOString(),
    timeMax: hasta.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 250
  });

  return (data.items || [])
    .filter(e => e.start && e.start.dateTime) // ignora eventos de todo el día (pagos, avisos)
    .map(e => {
      const priv = (e.extendedProperties && e.extendedProperties.private) || {};
      const creadaPorBot = priv.creadoPor === BOT_TAG;
      const telTexto = extraerTelefono(e.summary) || extraerTelefono(e.description);
      return {
        id: e.id,
        titulo: e.summary || "",
        inicio: new Date(e.start.dateTime),
        cuando: etiquetaHora(new Date(e.start.dateTime)),
        telefono: priv.telefono || telTexto,
        telefonoWa: priv.telefonoWa || "",
        estado: priv.estado || "nueva",
        creadaPorBot,
        anonimizado: priv.anonimizado === "si",
        nombre: (priv.nombre || nombreDesdeTitulo(e.summary)).trim()
      };
    })
    .filter(c => !c.anonimizado)                // citas cuyos datos ya se eliminaron (ARCO)
    .filter(c => c.creadaPorBot || c.telefono); // descarta eventos que no son citas de pacientes
}

// Devuelve TODAS las citas vigentes asociadas a un teléfono, de la más próxima
// a la más lejana. Importante en familias que comparten el mismo WhatsApp.
async function buscarCitasPorTelefono(telefono) {
  const ahora = new Date();
  const hasta = new Date(ahora.getTime() + 30 * 24 * 60 * 60 * 1000);
  const citas = await listarTodasLasCitas(ahora, hasta);
  const ultimos10 = String(telefono).replace(/\D/g, "").slice(-10);
  if (!ultimos10) return [];
  return citas.filter(c => {
    if (c.estado === "cancelada") return false;
    const dictado = String(c.telefono).replace(/\D/g, "").slice(-10);
    const whats = String(c.telefonoWa).replace(/\D/g, "").slice(-10);
    return dictado === ultimos10 || whats === ultimos10;
  });
}

// Busca la cita más próxima de un teléfono.
// Compara contra AMBOS números: el que el paciente dictó al agendar y el de WhatsApp
// desde el que escribe (suelen ser distintos: dicta el fijo del consultorio, escribe del celular).
async function buscarCitaPorTelefono(telefono) {
  const ahora = new Date();
  const hasta = new Date(ahora.getTime() + 30 * 24 * 60 * 60 * 1000);
  const citas = await listarTodasLasCitas(ahora, hasta);
  const ultimos10 = String(telefono).replace(/\D/g, "").slice(-10);
  if (!ultimos10) return null;
  return citas.find(c => {
    const dictado = String(c.telefono).replace(/\D/g, "").slice(-10);
    const whats = String(c.telefonoWa).replace(/\D/g, "").slice(-10);
    return dictado === ultimos10 || whats === ultimos10;
  }) || null;
}

// Busca una cita concreta por su identificador de evento (la usa el asistente
// cuando localizó la cita por nombre y necesita moverla o cancelarla)
async function buscarCitaPorId(eventId) {
  const ahora = new Date();
  const hasta = new Date(ahora.getTime() + 30 * 24 * 60 * 60 * 1000);
  const citas = await listarTodasLasCitas(ahora, hasta);
  return citas.find(c => c.id === eventId) || null;
}

// Normaliza un nombre para comparar: minúsculas, sin acentos y sin espacios de más
function normalizarNombre(txt) {
  return String(txt || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Busca citas por el nombre del paciente (respaldo cuando el teléfono no coincide).
// Devuelve TODAS las coincidencias, incluidas las canceladas (marcadas como tal),
// para que el asistente pueda explicarle al paciente qué ocurrió con su cita.
async function buscarCitasPorNombre(nombreBuscado) {
  const ahora = new Date();
  const hasta = new Date(ahora.getTime() + 30 * 24 * 60 * 60 * 1000);
  const citas = await listarTodasLasCitas(ahora, hasta);
  const buscado = normalizarNombre(nombreBuscado);

  // Diagnóstico mínimo: solo cuántas citas se revisaron (sin nombres ni fechas)
  console.log(`🔎 Búsqueda por nombre entre ${citas.length} cita(s)`);

  if (buscado.length < 3) return [];
  const palabras = buscado.split(" ").filter(p => p.length > 2);
  const conNombre = citas.filter(c => normalizarNombre(c.nombre));

  // Primero busca coincidencias claras (un nombre contiene al otro)
  const exactas = conNombre.filter(c => {
    const registrado = normalizarNombre(c.nombre);
    return registrado.includes(buscado) || buscado.includes(registrado);
  });
  if (exactas.length) return exactas;

  // Si no hubo, acepta coincidencias parciales (comparten alguna palabra larga)
  return conNombre.filter(c => {
    const partes = normalizarNombre(c.nombre).split(" ");
    return palabras.some(p => partes.includes(p));
  });
}

// Cancela una cita: la marca en rojo y libera el horario
async function cancelarCita(eventId) {
  const cal = initCalendar();
  await cal.events.patch({
    calendarId: CALENDAR_ID,
    eventId,
    requestBody: {
      colorId: COLOR.CANCELADA,
      summary: undefined,
      transparency: "transparent", // libera el horario: deja de contar como ocupado
      extendedProperties: { private: { estado: "cancelada" } }
    }
  });
}


// Verifica si un horario choca con algo, pudiendo excluir un evento (el que se está moviendo)
async function hayChoque(start, end, excluirEventId = null) {
  const cal = initCalendar();
  for (const calId of CALENDARS_BUSY) {
    try {
      const { data } = await cal.events.list({
        calendarId: calId,
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
        singleEvents: true,
        maxResults: 50
      });
      const conflicto = (data.items || []).some(e =>
        e.start && e.start.dateTime &&
        e.id !== excluirEventId &&
        e.transparency !== "transparent" // las canceladas no cuentan
      );
      if (conflicto) return true;
    } catch (e) {
      console.warn(`No se pudo revisar choques en "${calId}":`, e.message);
      return true; // ante la duda, no arriesgamos empalmar
    }
  }
  return false;
}

// Mueve una cita existente a un nuevo horario (conserva paciente, teléfono y datos)
async function reagendarCita(eventId, nuevoStartISO, duracionMin = 30) {
  const cal = initCalendar();
  const start = parseFechaMX(nuevoStartISO);
  const end = new Date(start.getTime() + duracionMin * 60000);

  if (isNaN(start.getTime())) return { ok: false, motivo: "fecha_invalida" };
  if (start.getTime() - Date.now() < MIN_ANTICIPACION_MS) return { ok: false, motivo: "muy_pronto" };
  if (!estaDentroDeRango(start, duracionMin)) return { ok: false, motivo: "fuera_de_horario" };
  if (await hayChoque(start, end, eventId)) return { ok: false, motivo: "ocupado" };

  const { data } = await cal.events.get({ calendarId: CALENDAR_ID, eventId });
  const priv = (data.extendedProperties && data.extendedProperties.private) || {};
  const veces = (parseInt(priv.reagendos || "0", 10) || 0) + 1;

  await cal.events.patch({
    calendarId: CALENDAR_ID,
    eventId,
    requestBody: {
      start: { dateTime: start.toISOString(), timeZone: TIMEZONE },
      end: { dateTime: end.toISOString(), timeZone: TIMEZONE },
      colorId: COLOR.NUEVA,
      transparency: "opaque", // vuelve a ocupar el horario
      extendedProperties: {
        private: {
          ...priv,
          estado: "nueva",
          reagendos: String(veces),
          // Se reinician las banderas: los mensajes deben enviarse para la nueva fecha
          confirmacionEnviada: "",
          recordatorioEnviado: "",
          resenaEnviada: ""
        }
      }
    }
  });

  return { ok: true, cuando: etiquetaHora(start), veces };
}

async function actualizarEstadoCita(eventId, estado) {
  const cal = initCalendar();
  const colorId = COLOR[estado] || COLOR.NUEVA;
  const { data } = await cal.events.get({ calendarId: CALENDAR_ID, eventId });
  const priv = (data.extendedProperties && data.extendedProperties.private) || {};
  await cal.events.patch({
    calendarId: CALENDAR_ID,
    eventId,
    requestBody: {
      colorId,
      extendedProperties: { private: { ...priv, estado: String(estado).toLowerCase() } }
    }
  });
  return { ok: true };
}

// ============================================================
// Funciones de privacidad: procedimiento ARCO, baja de mensajes automáticos
// y conservación. Ver docs/PROCEDIMIENTO-ARCO.md y docs/POLITICA-CONSERVACION.md
// ============================================================

// Solo para pruebas automáticas: permite usar un calendario simulado.
function _setCalendarParaPruebas(falso) { calendar = falso; }

// Lista eventos de CALENDAR_ID con paginación (events.list devuelve máximo 250 por página).
async function listarEventosPaginado({ desde, hasta, filtrosPrivados = [] }) {
  const cal = initCalendar();
  const eventos = [];
  let pageToken;
  do {
    const params = {
      calendarId: CALENDAR_ID,
      timeMin: desde.toISOString(),
      timeMax: hasta.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 250,
      pageToken
    };
    if (filtrosPrivados.length) params.privateExtendedProperty = filtrosPrivados;
    const { data } = await cal.events.list(params);
    eventos.push(...(data.items || []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return eventos;
}

function ultimos10(numero) {
  return String(numero || "").replace(/\D/g, "").slice(-10);
}

// ¿El evento pertenece a este teléfono? Compara el número dictado, el de WhatsApp
// y los teléfonos escritos a mano en el título o la descripción.
function coincideTelefono(evento, telefono) {
  const buscado = ultimos10(telefono);
  if (buscado.length < 10) return false;
  const priv = (evento.extendedProperties && evento.extendedProperties.private) || {};
  const candidatos = [
    priv.telefono, priv.telefonoWa,
    extraerTelefono(evento.summary), extraerTelefono(evento.description)
  ].map(ultimos10);
  return candidatos.includes(buscado);
}

function resumenEvento(e) {
  const priv = (e.extendedProperties && e.extendedProperties.private) || {};
  const inicio = e.start && (e.start.dateTime || e.start.date);
  return {
    id: e.id,
    inicio,
    cuando: e.start && e.start.dateTime ? etiquetaHora(new Date(e.start.dateTime)) : String(inicio || ""),
    titulo: e.summary || "",
    creadaPorBot: priv.creadoPor === BOT_TAG,
    estado: priv.estado || "",
    anonimizado: priv.anonimizado === "si"
  };
}

// Todos los eventos (pasados y futuros, vigentes y cancelados) asociados a un teléfono.
async function buscarEventosDePaciente(telefono, desde, hasta) {
  const eventos = await listarEventosPaginado({ desde, hasta });
  return eventos.filter(e => coincideTelefono(e, telefono)).map(resumenEvento);
}

// Construye la versión del evento SIN datos personales. Conserva la fecha, la hora,
// el color y si ocupa el horario (para no liberar ni empalmar citas por error),
// y deja constancia del folio de la solicitud.
function construirEventoAnonimizado(evento, folio, fechaISO = new Date().toISOString()) {
  const priv = (evento.extendedProperties && evento.extendedProperties.private) || {};
  const limpio = {
    summary: `Cita — datos personales eliminados (${folio})`,
    description: `Datos personales eliminados por la solicitud ${folio} el ${fechaISO.slice(0, 10)}.`,
    start: evento.start,
    end: evento.end,
    colorId: evento.colorId,
    transparency: evento.transparency,
    extendedProperties: {
      private: {
        ...(priv.creadoPor ? { creadoPor: priv.creadoPor } : {}),
        estado: priv.estado || "",
        anonimizado: "si",
        folio
      }
    }
  };
  for (const k of Object.keys(limpio)) if (limpio[k] === undefined) delete limpio[k];
  return limpio;
}

// Reemplaza el evento completo (events.update) para que no quede ningún campo
// personal: un "patch" conservaría las propiedades privadas anteriores.
async function anonimizarEvento(eventId, folio) {
  const cal = initCalendar();
  const { data } = await cal.events.get({ calendarId: CALENDAR_ID, eventId });
  const requestBody = construirEventoAnonimizado(data, folio);
  await cal.events.update({ calendarId: CALENDAR_ID, eventId, requestBody });
  return { ok: true };
}

// Baja de mensajes automáticos: marca las citas del bot de ese teléfono
// (del último año y del próximo) para que no reciban confirmación, recordatorio
// ni solicitud de reseña. Devuelve cuántas citas se marcaron (0 = no había dónde guardarlo).
const VENTANA_PREFERENCIA_MS = 365 * 24 * 60 * 60 * 1000;

async function marcarSinAutomaticos(telefono) {
  const ahora = Date.now();
  const eventos = await listarEventosPaginado({
    desde: new Date(ahora - VENTANA_PREFERENCIA_MS),
    hasta: new Date(ahora + VENTANA_PREFERENCIA_MS),
    filtrosPrivados: [`creadoPor=${BOT_TAG}`]
  });
  const delPaciente = eventos.filter(e => coincideTelefono(e, telefono));
  for (const e of delPaciente) await marcarEnCita(e.id, { sinAutomaticos: "si" });
  return delPaciente.length;
}

// Teléfonos (últimos 10 dígitos) que pidieron no recibir mensajes automáticos.
async function telefonosSinAutomaticos() {
  const ahora = Date.now();
  const eventos = await listarEventosPaginado({
    desde: new Date(ahora - VENTANA_PREFERENCIA_MS),
    hasta: new Date(ahora + VENTANA_PREFERENCIA_MS),
    filtrosPrivados: [`creadoPor=${BOT_TAG}`, "sinAutomaticos=si"]
  });
  const tels = new Set();
  for (const e of eventos) {
    const priv = (e.extendedProperties && e.extendedProperties.private) || {};
    for (const t of [priv.telefono, priv.telefonoWa]) if (ultimos10(t).length === 10) tels.add(ultimos10(t));
  }
  return tels;
}

// Citas creadas por el bot que terminaron antes de `fecha` y aún tienen datos personales.
async function citasDelBotAnterioresA(fecha) {
  const eventos = await listarEventosPaginado({
    desde: new Date("2020-01-01T00:00:00Z"),
    hasta: fecha,
    filtrosPrivados: [`creadoPor=${BOT_TAG}`]
  });
  return eventos.map(resumenEvento).filter(e => !e.anonimizado);
}

module.exports = {
  _setCalendarParaPruebas, listarEventosPaginado, coincideTelefono, buscarEventosDePaciente,
  construirEventoAnonimizado, anonimizarEvento, marcarSinAutomaticos, telefonosSinAutomaticos,
  citasDelBotAnterioresA,
  buscarHorarios, crearCita, actualizarEstadoCita, etiquetaHora, initCalendar, textoHorarioAtencion,
  listarCitasDelBot, listarTodasLasCitas, marcarEnCita, buscarCitaPorTelefono, buscarCitasPorTelefono, buscarCitasPorNombre, buscarCitaPorId, cancelarCita, reagendarCita, hayChoque
};
