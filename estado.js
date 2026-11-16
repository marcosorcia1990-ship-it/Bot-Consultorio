// ============================================================
// Estado persistente de "chat atendido por una persona"
// Sobrevive reinicios del servidor (Render se duerme o se reinicia): si el equipo
// contestó desde la app, el bot sigue callado aunque el proceso haya arrancado de nuevo.
//
// Almacenamiento: un calendario de Google DEDICADO (ESTADO_CALENDAR_ID), sin datos
// personales. Cada intervención humana es un evento:
//   - inicio = momento en que contestó la persona; fin = hasta cuándo calla el bot;
//   - propiedad privada "chat" = HMAC del número (no el número).
// Se eligió así para no agregar otro proveedor ni otra base de datos.
// Sin ESTADO_CALENDAR_ID o sin LOG_SALT, funciona solo en memoria (se pierde al reiniciar).
// ============================================================

const crypto = require("crypto");
const { clave10 } = require("./numeros");

const TIPO = "chat-humano";
const CACHE_NEGATIVO_MS = 60 * 1000; // si no hay registro, se vuelve a consultar al minuto

function crearEstado({ calendario = null, calendarId = null, sal = null, ahora = () => Date.now() } = {}) {
  const persistente = Boolean(calendario && calendarId && sal);
  const cache = new Map(); // clave -> { hasta, consultado }

  function claveChat(numero) {
    const c = clave10(numero);
    if (!c) return "";
    return crypto.createHmac("sha256", String(sal || "memoria")).update("chat:" + c).digest("hex").slice(0, 32);
  }

  // Busca la intervención vigente de un chat en el calendario
  async function leerVigente(chat) {
    const { data } = await calendario.events.list({
      calendarId,
      timeMin: new Date(ahora()).toISOString(),
      singleEvents: true,
      maxResults: 10,
      privateExtendedProperty: [`tipo=${TIPO}`, `chat=${chat}`]
    });
    let mejor = null;
    for (const e of data.items || []) {
      const fin = Date.parse(e.end && e.end.dateTime);
      if (!mejor || fin > mejor.hasta) mejor = { id: e.id, hasta: fin };
    }
    return mejor;
  }

  // Marca que una persona atendió el chat: el bot calla hasta `hasta`.
  async function marcarHumano(numero, desde, hasta) {
    const chat = claveChat(numero);
    if (!chat) return;
    const previo = cache.get(chat);
    cache.set(chat, { hasta: Math.max(hasta, (previo && previo.hasta) || 0), consultado: ahora() });
    if (!persistente) return;

    const vigente = await leerVigente(chat);
    if (vigente && vigente.hasta >= hasta) return; // ya cubierto
    const cuerpo = {
      summary: "Chat atendido por el equipo (bot en silencio)",
      start: { dateTime: new Date(desde).toISOString() },
      end: { dateTime: new Date(hasta).toISOString() },
      transparency: "transparent",
      extendedProperties: { private: { tipo: TIPO, chat } }
    };
    if (vigente) {
      await calendario.events.patch({ calendarId, eventId: vigente.id, requestBody: { end: cuerpo.end } });
    } else {
      await calendario.events.insert({ calendarId, requestBody: cuerpo });
    }
  }

  // ¿El chat está en manos humanas? Ante un error de lectura, responde que SÍ:
  // es preferible que el bot calle a que conteste encima de una persona.
  async function enManosHumanas(numero) {
    const chat = claveChat(numero);
    if (!chat) return false;
    const t = ahora();
    const c = cache.get(chat);
    if (c && c.hasta > t) return true;
    if (!persistente) return false;
    if (c && t - c.consultado < CACHE_NEGATIVO_MS) return false;
    try {
      const vigente = await leerVigente(chat);
      cache.set(chat, { hasta: vigente ? vigente.hasta : 0, consultado: t });
      return Boolean(vigente && vigente.hasta > t);
    } catch (e) {
      console.error("No se pudo consultar el estado del chat; el bot calla por precaución:", e.message);
      return true;
    }
  }

  // Al arrancar: carga todas las intervenciones vigentes (recuperación tras reinicio)
  async function recuperar() {
    if (!persistente) return 0;
    let n = 0, pageToken;
    do {
      const { data } = await calendario.events.list({
        calendarId, timeMin: new Date(ahora()).toISOString(), singleEvents: true,
        maxResults: 250, pageToken, privateExtendedProperty: [`tipo=${TIPO}`]
      });
      for (const e of data.items || []) {
        const chat = e.extendedProperties && e.extendedProperties.private && e.extendedProperties.private.chat;
        const fin = Date.parse(e.end && e.end.dateTime);
        if (chat && fin > ahora()) { cache.set(chat, { hasta: fin, consultado: ahora() }); n++; }
      }
      pageToken = data.nextPageToken;
    } while (pageToken);
    return n;
  }

  // Conservación: borra los registros que terminaron hace más de `margenMs`
  async function depurar(margenMs = 24 * 60 * 60 * 1000) {
    if (!persistente) return 0;
    const limite = new Date(ahora() - margenMs);
    let n = 0, pageToken;
    do {
      const { data } = await calendario.events.list({
        calendarId, timeMin: new Date("2020-01-01T00:00:00Z").toISOString(), timeMax: limite.toISOString(),
        singleEvents: true, maxResults: 250, pageToken, privateExtendedProperty: [`tipo=${TIPO}`]
      });
      for (const e of data.items || []) {
        if (Date.parse(e.end && e.end.dateTime) < limite.getTime()) {
          await calendario.events.delete({ calendarId, eventId: e.id });
          n++;
        }
      }
      pageToken = data.nextPageToken;
    } while (pageToken);
    return n;
  }

  return { persistente, claveChat, marcarHumano, enManosHumanas, recuperar, depurar };
}

module.exports = { crearEstado, TIPO };
