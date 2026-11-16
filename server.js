// ============================================================
// Bot de WhatsApp — Consultorio Dr. Marco A. Mixteco
// Respuestas administrativas con IA, agenda en Google Calendar, recordatorios,
// filtros de privacidad y silencio automático cuando contesta una persona.
// ============================================================

const express = require("express");
const fs = require("fs");
const path = require("path");
const { TOOLS, ejecutarHerramienta } = require("./tools");
const recordatorios = require("./recordatorios");
const cal = require("./calendar");
const priv = require("./privacidad");
const demo = require("./demo");
const numeros = require("./numeros");
const { crearEstado } = require("./estado");
const admin = require("./admin");

// Modo demostración: si la configuración no es segura, el servidor no arranca.
if (demo.MODO_DEMO) {
  const errores = demo.validarConfiguracionDemo();
  if (errores.length) {
    console.error("⛔ MODO DEMO: configuración insegura, el servidor NO arranca:\n- " + errores.join("\n- "));
    process.exit(1);
  }
}

// En modo demo nada sale hasta confirmar que PHONE_NUMBER_ID es un número de prueba (+1 555…)
let demoNumeroVerificado = false;

function envioBloqueadoPorDemo(to) {
  if (!demo.MODO_DEMO) return false;
  if (!demoNumeroVerificado) {
    console.error("⛔ MODO DEMO: envío bloqueado, el número de origen aún no se verifica como número de prueba.");
    return true;
  }
  if (!demo.destinoPermitido(to)) {
    console.error(`⛔ MODO DEMO: envío bloqueado a ${priv.idPaciente(to)} (no está en DEMO_DESTINATARIOS).`);
    return true;
  }
  return false;
}
const alta = require("./alta");

const app = express();
app.set("trust proxy", 1);                         // Render está detrás de un proxy HTTPS
app.use(express.json());
app.use(express.urlencoded({ extended: false })); // formularios del panel /admin

// ---------- Configuración (variables de entorno en Render) ----------
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;          // Token de acceso de Meta
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;              // Palabra secreta que tú inventas
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;        // Identificador del número (de Meta)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;         // Clave de la API de OpenAI
const MODEL = process.env.MODEL || "gpt-4o-mini";
const GRAPH_VERSION = process.env.GRAPH_VERSION || "v25.0";

// Notas de voz: el bot las transcribe y las contesta por escrito.
// Se puede apagar poniendo AUDIO_ACTIVO en "false" (entonces pide el mensaje por texto).
const AUDIO_ACTIVO = String(process.env.AUDIO_ACTIVO ?? "true").trim().toLowerCase() === "true";
const MODELO_TRANSCRIPCION = process.env.MODELO_TRANSCRIPCION || "whisper-1";

// Activa el agendado automático con Google Calendar (fase 2).
// Ponlo en "true" en Render SOLO cuando ya configuraste CALENDAR_ID y GOOGLE_CREDENTIALS_JSON.
// Se aceptan variantes con espacios o mayúsculas (TRUE, " true ", etc.)
const AGENDA_ACTIVA = String(process.env.AGENDA_ACTIVA || "").trim().toLowerCase() === "true";

// Números personales protegidos (el bot JAMÁS les responde).
// Formato: últimos 10 dígitos, separados por comas. Ej: "2202355440,2717493381"
const PERSONAL_NUMBERS = (process.env.PERSONAL_NUMBERS || "")
  .split(",").map(n => n.trim().slice(-10)).filter(Boolean);

// Número interno para alertas (urgencias / pendientes). Opcional.
const INTERNAL_ALERT_NUMBER = process.env.INTERNAL_ALERT_NUMBER || "";
// Plantilla aprobada para avisar al equipo cuando su chat lleva más de 24 h sin
// actividad (fuera de esa ventana WhatsApp no permite texto libre). Opcional.
const TPL_AVISO_EQUIPO = process.env.TPL_AVISO_EQUIPO || "";
const TPL_LANG = process.env.TPL_LANG || "es_MX";

// Interruptor: con el bot pausado no contesta a nadie (sigue registrando cuando el equipo
// toma un chat). Fuera de la demo, el bot arranca PAUSADO salvo BOT_PAUSADO=false explícito:
// así ningún despliegue ni la conexión inicial lo encienden por accidente.
const valorPausa = String(process.env.BOT_PAUSADO ?? "").trim().toLowerCase();
const BOT_PAUSADO = valorPausa === "true" || (valorPausa !== "false" && !demo.MODO_DEMO);

// Cuánto calla el bot después de que una persona del equipo escribe en el chat
const HUMANO_MS = (parseFloat(process.env.HUMANO_HORAS) || 24) * 60 * 60 * 1000;

// Mensajes con más antigüedad que esto no se contestan automáticamente: llegan tarde
// (por ejemplo, tras una caída o un reinicio) y el equipo pudo haberlos atendido ya.
const MAX_ANTIGUEDAD_MS = (parseFloat(process.env.MAX_ANTIGUEDAD_MIN) || 15) * 60 * 1000;

// Estado persistente de los chats atendidos por personas (ver estado.js)
const ESTADO_CALENDAR_ID = process.env.ESTADO_CALENDAR_ID || "";
let estadoChats = crearEstado(); // en memoria hasta que se conecte el calendario de estado

// ---------- Cerebro del bot ----------
const SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, "system-prompt.md"), "utf8");

// ---------- Estado en memoria ----------
// chats: por cada número → historial temporal de la conversación
const chats = new Map();
const processedIds = new Set(); // para no procesar dos veces el mismo mensaje

// La clave son los últimos 10 dígitos: en México el mismo número llega a veces como
// 521XXXXXXXXXX (mensajes del paciente) y a veces como 52XXXXXXXXXX (ecos de la app).
function getChat(numero) {
  const clave = numeros.clave10(numero);
  if (!chats.has(clave)) {
    chats.set(clave, { history: [], lastActivity: 0 });
  }
  return chats.get(clave);
}

// Cola por chat: los mensajes de un mismo paciente se atienden de uno en uno.
// Evita respuestas cruzadas y citas duplicadas cuando escribe varios mensajes seguidos.
const colas = new Map();
function enCola(clave, tarea) {
  const anterior = colas.get(clave) || Promise.resolve();
  const actual = anterior.catch(() => {}).then(tarea);
  colas.set(clave, actual);
  actual.catch(() => {}).finally(() => { if (colas.get(clave) === actual) colas.delete(clave); });
  return actual;
}

// ---------- Utilidades ----------
function nowInCordoba() {
  const fecha = new Date().toLocaleString("es-MX", {
    timeZone: "America/Mexico_City",
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true
  });
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Mexico_City" }));
  const abierto = d.getDay() >= 1 && d.getDay() <= 6 && d.getHours() >= 8 && d.getHours() < 20;
  return { fecha, abierto };
}

// Devuelve { ok, codigo } para que quien llama sepa si el mensaje salió.
async function sendWhatsAppText(to, body) {
  if (envioBloqueadoPorDemo(to)) return { ok: false, codigo: "demo" };
  // Números mexicanos: se envía como 52XXXXXXXXXX (ver numeros.js)
  const dest = numeros.aDestinoWhatsApp(to);

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: dest,
      type: "text",
      text: { body, preview_url: true }
    })
  });
  if (!res.ok) {
    const detalle = await res.text();
    let codigo = res.status;
    try { codigo = JSON.parse(detalle).error.code || codigo; } catch {}
    console.error("Error al enviar mensaje:", res.status, priv.sanitizarLog(detalle));
    return { ok: false, codigo };
  }
  return { ok: true };
}

// Envía una plantilla aprobada por Meta (necesaria para mensajes que inicia el negocio)
async function sendTemplate(to, nombrePlantilla, parametros = [], idioma = "es_MX") {
  if (envioBloqueadoPorDemo(to)) throw new Error("Envío bloqueado por el modo demo");
  const dest = numeros.aDestinoWhatsApp(to);

  const componentes = parametros.length
    ? [{ type: "body", parameters: parametros.map(p => ({ type: "text", text: String(p) })) }]
    : [];

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: dest,
      type: "template",
      template: {
        name: nombrePlantilla,
        language: { code: idioma },
        components: componentes
      }
    })
  });
  if (!res.ok) {
    const detalle = await res.text();
    console.error(`Error enviando plantilla "${nombrePlantilla}":`, res.status, priv.sanitizarLog(detalle));
    throw new Error(`Plantilla ${nombrePlantilla} falló: ${res.status}`);
  }
  return true;
}

// `text` va al WhatsApp interno del equipo; `motivoLog` es lo único que queda en los logs.
async function alertTeam(text, motivoLog = "aviso al equipo") {
  console.log(`🔔 Alerta interna: ${motivoLog}`);
  if (!INTERNAL_ALERT_NUMBER) return;
  try {
    const r = await sendWhatsAppText(INTERNAL_ALERT_NUMBER, `🔔 Aviso del bot:\n${text}`);
    if (r.ok) return;
    // Fuera de la ventana de 24 h WhatsApp no deja enviar texto libre: se usa la plantilla
    if (TPL_AVISO_EQUIPO) {
      const parametro = String(text).replace(/\s*\n+\s*/g, " · ").slice(0, 900);
      await sendTemplate(INTERNAL_ALERT_NUMBER, TPL_AVISO_EQUIPO, [parametro], TPL_LANG);
      console.log("🔔 Alerta interna enviada con plantilla");
    } else {
      console.error("No se pudo enviar la alerta interna y no hay TPL_AVISO_EQUIPO configurada.");
    }
  } catch (e) {
    console.error("No se pudo enviar la alerta interna:", e.message);
  }
}

// Llama a OpenAI reintentando si responde 429 (límite de uso por minuto) o un
// error temporal del servidor. Sin esto, un rechazo momentáneo dejaba al
// paciente sin respuesta aunque la cita ya se hubiera movido correctamente.
async function llamarOpenAI(body) {
  const MAX_INTENTOS = 4;
  let ultimoError = "";

  for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    if (res.ok) return res.json();

    ultimoError = await res.text();
    const recuperable = res.status === 429 || res.status >= 500;
    if (!recuperable || intento === MAX_INTENTOS) {
      throw new Error(`API de OpenAI respondió ${res.status}: ${ultimoError}`);
    }

    // Respeta el tiempo que sugiere OpenAI; si no lo indica, espera cada vez más
    const sugerido = parseFloat(res.headers.get("retry-after") || "");
    const espera = !isNaN(sugerido) ? sugerido * 1000 : Math.min(2000 * intento, 8000);
    console.warn(`⏳ OpenAI respondió ${res.status}; reintentando en ${Math.round(espera / 1000)}s (intento ${intento} de ${MAX_INTENTOS})`);
    await new Promise(r => setTimeout(r, espera));
  }
  throw new Error(`API de OpenAI no respondió tras ${MAX_INTENTOS} intentos: ${ultimoError}`);
}

// ---------- Notas de voz ----------

// Descarga el archivo de audio que el paciente envió por WhatsApp.
// Son dos pasos: primero WhatsApp da una liga temporal, luego se baja el archivo.
async function descargarAudioWhatsApp(mediaId) {
  const infoRes = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}`, {
    headers: { "Authorization": `Bearer ${WHATSAPP_TOKEN}` }
  });
  if (!infoRes.ok) throw new Error(`WhatsApp no dio la liga del audio (${infoRes.status})`);
  const info = await infoRes.json();
  if (!info.url) throw new Error("WhatsApp no devolvió la liga del audio");

  const archivoRes = await fetch(info.url, {
    headers: { "Authorization": `Bearer ${WHATSAPP_TOKEN}` }
  });
  if (!archivoRes.ok) throw new Error(`No se pudo bajar el audio (${archivoRes.status})`);

  return {
    datos: Buffer.from(await archivoRes.arrayBuffer()),
    tipo: info.mime_type || "audio/ogg"
  };
}

// Convierte el audio en texto usando OpenAI. Devuelve "" si no se entendió nada.
async function transcribirAudio(datos, tipo) {
  // WhatsApp manda las notas de voz en .ogg; la extensión debe coincidir con el formato
  const extension = String(tipo).includes("mp4") ? "mp4"
    : String(tipo).includes("mpeg") ? "mp3"
    : String(tipo).includes("wav") ? "wav" : "ogg";

  const formulario = new FormData();
  formulario.append("file", new Blob([datos], { type: tipo }), `nota-de-voz.${extension}`);
  formulario.append("model", MODELO_TRANSCRIPCION);
  formulario.append("language", "es"); // los pacientes hablan español: mejora la precisión

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENAI_API_KEY}` },
    body: formulario
  });
  if (!res.ok) throw new Error(`Transcripción falló (${res.status}): ${await res.text()}`);

  const data = await res.json();
  return String(data.text || "").trim();
}

async function askAI(chat, userText, telefonoPaciente = null) {
  const { fecha, abierto } = nowInCordoba();
  const runtimeContext =
    `\n\n---\nContexto en tiempo real: hoy es ${fecha} (hora de Córdoba, Veracruz). ` +
    (abierto
      ? "El consultorio está en horario hábil."
      : "Es FUERA del horario de atención: en respuestas que requieran acción humana, ajusta expectativas (ej. 'le confirmamos mañana por la mañana 🙏').");

  const messages = [
    { role: "system", content: SYSTEM_PROMPT + runtimeContext },
    ...chat.history,
    { role: "user", content: userText }
  ];

  // Cuerpo base de la petición; si la agenda está activa, se añaden las herramientas.
  const bodyBase = { model: MODEL, max_tokens: 700, messages };
  if (AGENDA_ACTIVA) bodyBase.tools = TOOLS;

  // Ciclo de function calling: la IA puede pedir herramientas hasta 5 veces por turno.
  for (let vuelta = 0; vuelta < 5; vuelta++) {
    const data = await llamarOpenAI(bodyBase);
    const msg = data.choices?.[0]?.message;
    if (!msg) return "";

    // ¿La IA quiere usar una herramienta?
    if (msg.tool_calls && msg.tool_calls.length) {
      messages.push(msg); // registrar la petición de herramienta
      for (const tc of msg.tool_calls) {
        let args = {};
        try { args = JSON.parse(tc.function.arguments || "{}"); } catch {}
        const resultado = await ejecutarHerramienta(tc.function.name, args, telefonoPaciente, chat);
        // Log mínimo: nombre de la herramienta y resultado, sin argumentos ni datos del paciente
        let estado = "?";
        try { const r = JSON.parse(resultado); estado = r.ok ? "ok" : `falló (${r.motivo || r.error || "sin motivo"})`; } catch {}
        console.log(`🔧 Herramienta ${tc.function.name}: ${estado}`);
        messages.push({ role: "tool", tool_call_id: tc.id, content: resultado });
      }
      continue; // volver a preguntar a la IA con el resultado de la herramienta
    }

    // Respuesta final de texto
    return (msg.content || "").trim();
  }
  return "En breve le confirmamos por este medio 🙏"; // salvaguarda si algo se cicla
}

// ---------- Envío al paciente ----------
// En el primer mensaje de cada conversación se envía el aviso de privacidad simplificado.
// En urgencias va DESPUÉS de la indicación de acudir a urgencias, que tiene prioridad.
async function enviarAlPaciente(chat, to, texto, { avisoDespues = false } = {}) {
  if (!chat.avisoEnviado && !avisoDespues) {
    await sendWhatsAppText(to, priv.MENSAJES.avisoSimplificado);
    chat.avisoEnviado = true;
  }
  await sendWhatsAppText(to, texto);
  if (!chat.avisoEnviado) {
    await sendWhatsAppText(to, priv.MENSAJES.avisoSimplificado);
    chat.avisoEnviado = true;
  }
}

// Respuesta fija (no pasa por la IA) + aviso al equipo sin el contenido del mensaje.
async function responderFijo(chat, from, clave, motivo, opciones = {}) {
  const id = priv.idPaciente(from);
  await enviarAlPaciente(chat, from, priv.MENSAJES[clave], opciones);
  console.log(`🛡️ Respuesta fija "${clave}" a ${id} (sin IA)`);
  if (motivo) {
    await alertTeam(
      `${motivo}.\nChat: +${from}\nRevise y responda desde la app de WhatsApp Business.`,
      `${motivo} (${id})`);
  }
}

async function manejarBaja(chat, from) {
  let marcadas = 0;
  if (AGENDA_ACTIVA) {
    try { marcadas = await cal.marcarSinAutomaticos(from); }
    catch (e) { console.error("No se pudo registrar la baja:", e.message); }
  }
  if (marcadas > 0) {
    console.log(`🔕 Baja de mensajes automáticos registrada en ${marcadas} cita(s) de ${priv.idPaciente(from)}`);
    await enviarAlPaciente(chat, from, priv.MENSAJES.bajaRegistrada);
  } else {
    await responderFijo(chat, from, "bajaPendiente",
      "El paciente pidió no recibir mensajes automáticos y no se pudo registrar sola (no tiene citas del bot). Regístrela a mano");
  }
}

// ---------- Lógica principal por mensaje ----------
async function processMessage(msg, value) {
  const from = msg.from; // número del paciente (con lada de país)
  const chat = getChat(from);
  const now = Date.now();
  const id = priv.idPaciente(from);

  // Log mínimo: tipo de mensaje y seudónimo del número, nunca el contenido
  console.log(`📩 Mensaje (${msg.type}) de ${id}`);

  // Regla: números personales protegidos → silencio total
  if (PERSONAL_NUMBERS.includes(String(from).slice(-10))) {
    console.log(`(silencio) Número protegido`);
    return;
  }

  // Mensajes atrasados (llegan tarde tras una caída o reinicio): no se contestan solos
  const enviadoEn = parseInt(msg.timestamp, 10) * 1000;
  if (enviadoEn && now - enviadoEn > MAX_ANTIGUEDAD_MS) {
    console.log(`(silencio) Mensaje atrasado de ${id} (${Math.round((now - enviadoEn) / 60000)} min): lo atiende el equipo`);
    return;
  }

  // Reinicio de conversación: más de 24 h sin actividad → conversación nueva
  if (now - chat.lastActivity > priv.HISTORIAL_TTL_MS) {
    chat.history = [];
    chat.avisoEnviado = false;
    chat.citaLocalizada = null;
  }
  chat.lastActivity = now;

  // Regla: conversación en manos humanas (persistente: sobrevive reinicios)
  if (await estadoChats.enManosHumanas(from)) {
    console.log(`(silencio) Chat en manos humanas: ${id}`);
    return;
  }

  // Interruptor de emergencia
  if (BOT_PAUSADO) {
    console.log(`(silencio) Bot en pausa (BOT_PAUSADO): ${id}`);
    return;
  }

  // ---- Respuestas a los botones de confirmación de cita ----
  // Llegan como type "button" (plantillas) o "interactive" (botones de respuesta).
  let textoBoton = null;
  if (msg.type === "button" && msg.button) {
    textoBoton = msg.button.text || msg.button.payload || "";
  } else if (msg.type === "interactive") {
    textoBoton = msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || "";
  }

  if (textoBoton && AGENDA_ACTIVA) {
    try {
      const respuesta = await recordatorios.procesarRespuestaBoton(from, textoBoton);
      if (respuesta) {
        console.log(`🔘 Respuesta a confirmación de ${id}`);
        await enviarAlPaciente(chat, from, respuesta);
        chat.history.push(
          { role: "user", content: `[El paciente respondió "${textoBoton}" al mensaje de confirmación]` },
          { role: "assistant", content: respuesta }
        );
        return;
      }
    } catch (e) {
      console.error("Error procesando respuesta de botón:", e.message);
      return;
    }
    // Si no era Sí/No, se atiende como texto normal (abajo)
  }

  let userText = null;   // lo que recibiría la IA
  let textoRevisar = ""; // lo que se revisa con los filtros de privacidad

  // ---- Clasificación por tipo de mensaje ----
  if (msg.type === "text") {
    userText = textoRevisar = msg.text.body;

  } else if (textoBoton) {
    userText = textoRevisar = textoBoton;

  } else if (msg.type === "audio") {
    // Las notas de voz suelen contener información clínica y no se pueden revisar
    // antes de transcribirlas (transcribir ya es enviarlas a OpenAI). Mientras no haya
    // un mecanismo de consentimiento validado, NO se descargan ni se transcriben.
    if (!AUDIO_ACTIVO || !priv.PERMITIR_DATOS_SENSIBLES_IA) {
      await responderFijo(chat, from, "audio", "Nota de voz para revisión del personal");
      return;
    }

    try {
      const { datos, tipo } = await descargarAudioWhatsApp(msg.audio.id);
      const transcripcion = await transcribirAudio(datos, tipo);

      if (!transcripcion || transcripcion.length < 2) {
        console.log(`🎙️ Audio sin contenido entendible de ${id}`);
        await enviarAlPaciente(chat, from,
          "Disculpe, no logramos escuchar con claridad su mensaje de voz. " +
          "¿Podría repetirlo o escribirnos por texto?");
        return;
      }

      console.log(`🎙️ Nota de voz de ${id} transcrita (${transcripcion.length} caracteres)`);
      // Se marca como nota de voz para que el asistente sepa que puede venir con
      // errores de dictado y confirme los datos importantes (nombres, fechas).
      userText = `[Nota de voz del paciente, transcrita automáticamente]: ${transcripcion}`;
      textoRevisar = transcripcion;

    } catch (e) {
      console.error("🎙️ No se pudo transcribir el audio:", e.message);
      await enviarAlPaciente(chat, from,
        "Recibimos su mensaje de voz, pero no pudimos escucharlo en este momento. " +
        "¿Podría escribirnos por texto lo que necesita?");
      return;
    }

  } else if (msg.type === "image" || msg.type === "document" || msg.type === "video") {
    // El bot nunca descarga ni analiza el archivo; solo considera el texto que lo acompaña.
    const caption = (msg[msg.type] && msg[msg.type].caption || "").trim();
    if (!caption || caption.length < 15) {
      // Documento/foto sin texto relevante → silencio (Ade los organiza)
      console.log(`(silencio) ${msg.type} sin texto de ${id}`);
      return;
    }
    userText = `[El paciente envió un(a) ${msg.type} acompañado de este texto]: ${caption}`;
    textoRevisar = caption;

  } else {
    // Stickers, reacciones, ubicaciones, contactos, etc. → silencio
    console.log(`(silencio) Tipo no atendido (${msg.type}) de ${id}`);
    return;
  }

  // ---- Filtros de privacidad (ANTES de cualquier envío a OpenAI) ----
  // Nada de lo que se ataja aquí se guarda en el historial ni se envía a la IA.
  if (priv.esUrgencia(textoRevisar)) {
    await responderFijo(chat, from, "urgencia", "Posible URGENCIA: se le indicó acudir a urgencias", { avisoDespues: true });
    return;
  }
  if (priv.esBaja(textoRevisar)) {
    await manejarBaja(chat, from);
    return;
  }
  if (priv.esSolicitudPrivacidad(textoRevisar)) {
    await responderFijo(chat, from, "privacidad", "Solicitud sobre datos personales (ARCO/privacidad). Atender según el procedimiento ARCO");
    return;
  }
  if (!priv.PERMITIR_DATOS_SENSIBLES_IA && priv.contieneInformacionClinica(textoRevisar)) {
    await responderFijo(chat, from, "clinico", "Mensaje con posible información de salud, para respuesta personal");
    return;
  }

  // ---- Consultar a la IA (solo temas administrativos) ----
  let reply;
  try {
    reply = await askAI(chat, userText, from);
  } catch (e) {
    // Regla de oro: ante cualquier falla, mejor silencio que una respuesta rota
    console.error("Error consultando a la IA:", e.message);
    return;
  }

  // ---- Marcadores especiales ----
  if (reply.includes("[AVISAR_EQUIPO]")) {
    reply = reply.replace(/\[AVISAR_EQUIPO\]/g, "").trim();
    await alertTeam(
      `Mensaje que requiere atención humana.\nChat: +${from}\nRevíselo en la app de WhatsApp Business.`,
      `atención humana solicitada por la IA (${id})`);
  }

  if (reply.includes("[NO_RESPONDER]") || reply === "") {
    console.log(`(silencio por decisión de la IA) ${id}`);
    chat.history.push({ role: "user", content: userText });
    trimHistory(chat);
    return;
  }

  // ---- Responder ----
  // Si una persona contestó mientras la IA pensaba, la respuesta automática se descarta
  if (await estadoChats.enManosHumanas(from)) {
    console.log(`(silencio) El equipo tomó el chat mientras se preparaba la respuesta: ${id}`);
    return;
  }
  console.log(`💬 Respuesta de la IA enviada a ${id} (${reply.length} caracteres)`);
  await enviarAlPaciente(chat, from, reply);
  chat.history.push({ role: "user", content: userText }, { role: "assistant", content: reply });
  trimHistory(chat);
}

function trimHistory(chat) {
  // Historial corto: en cada vuelta de herramientas se reenvía completo a OpenAI,
  // así que mantenerlo breve evita agotar el límite de consumo por minuto.
  if (chat.history.length > 8) chat.history = chat.history.slice(-8);
}

// ---------- Webhook de Meta ----------
// Verificación inicial (Meta manda un reto y hay que devolverlo)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verificado por Meta");
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Recepción de eventos
app.post("/webhook", (req, res) => {
  res.sendStatus(200); // responder rápido a Meta; procesamos después

  try {
    const entries = req.body.entry || [];
    for (const entry of entries) {
      for (const change of (entry.changes || [])) {
        const value = change.value || {};

        const echoes = value.message_echoes || value.smb_message_echoes || [];

        // Modo demo: solo se procesan eventos del número de prueba configurado.
        // Cualquier otro (por ejemplo, de un número real) se descarta sin leerlo.
        if (demo.MODO_DEMO && ((value.messages || []).length || echoes.length) &&
            String(value.metadata && value.metadata.phone_number_id) !== String(PHONE_NUMBER_ID)) {
          console.error("⛔ MODO DEMO: evento de otro número descartado sin procesar.");
          continue;
        }

        // Ecos de mensajes enviados desde la app WhatsApp Business (coexistence):
        // si el doctor o Ade escriben, el bot calla en ese chat (HUMANO_HORAS, 24 h por omisión).
        // Se guarda de forma persistente para que sobreviva a reinicios.
        for (const echo of echoes) {
          const to = echo.to;
          if (!to) continue;
          const desde = (parseInt(echo.timestamp, 10) * 1000) || Date.now();
          const hasta = desde + HUMANO_MS;
          if (hasta <= Date.now()) continue; // eco viejo: ya no aplica
          getChat(to).lastActivity = Date.now();
          estadoChats.marcarHumano(to, desde, hasta)
            .catch(e => console.error("No se pudo guardar que el equipo tomó el chat:", e.message));
          console.log(`👤 Chat tomado por el equipo: ${priv.idPaciente(to)}`);
        }

        // Sincronización de contactos e historial de la app (coexistence): no se procesa
        // como mensajes nuevos; el bot nunca contesta mensajes del historial.
        if (change.field === "history" || value.history) console.log("📚 Historial de la app recibido (no se procesa)");
        if (change.field === "smb_app_state_sync" || value.state_sync) console.log("📇 Sincronización de contactos recibida (no se procesa)");

        // Mensajes entrantes de pacientes
        for (const msg of (value.messages || [])) {
          // Modo demo: solo teléfonos de prueba autorizados; el resto no se procesa ni va a OpenAI
          if (demo.MODO_DEMO && !demo.destinoPermitido(msg.from)) {
            console.error(`⛔ MODO DEMO: mensaje de ${priv.idPaciente(msg.from)} descartado (no está en DEMO_DESTINATARIOS).`);
            continue;
          }
          if (processedIds.has(msg.id)) continue;
          processedIds.add(msg.id);
          if (processedIds.size > 1000) {
            processedIds.delete(processedIds.values().next().value);
          }
          enCola(numeros.clave10(msg.from), () => processMessage(msg, value))
            .catch(e => console.error("Error procesando mensaje:", priv.sanitizarLog(e && e.stack, 1000)));
        }
      }
    }
  } catch (e) {
    console.error("Error en webhook:", e);
  }
});

// Panel de administración y alta del número (Embedded Signup)
admin.registrarRutas(app);
alta.registrarRutas(app);

// Revisión manual de recordatorios (para pruebas y diagnóstico).
// Protegida con el mismo token secreto del webhook: sin él, no hace nada.
app.get("/revisar-recordatorios", async (req, res) => {
  if (req.query.token !== VERIFY_TOKEN) {
    return res.status(403).send("Token incorrecto.");
  }
  if (demo.MODO_DEMO || !RECORDATORIOS_ACTIVOS || !AGENDA_ACTIVA) {
    return res.send("Los recordatorios están apagados. Revise RECORDATORIOS_ACTIVOS y AGENDA_ACTIVA en Render.");
  }
  const prudente = recordatorios.horaPrudente();
  console.log(`🔔 Revisión manual de recordatorios solicitada (hora prudente: ${prudente})`);
  try {
    await recordatorios.revisarYEnviar({ sendTemplate, alertTeam });
    res.send(
      `Revisión ejecutada.\n` +
      `Hora prudente (7:30 am - 9:00 pm): ${prudente ? "SÍ" : "NO — a esta hora no se envía nada"}\n` +
      `Vea los registros de Render para el detalle.`
    );
  } catch (e) {
    console.error("Error en la revisión manual:", e.message);
    res.status(500).send("Error: " + e.message);
  }
});

// Página de salud (para saber que el servidor vive)
app.get("/", (req, res) => res.send("Bot del consultorio: en línea ✅"));

// ---------- Temporizador de recordatorios ----------
// Revisa cada 15 minutos si toca enviar confirmaciones, recordatorios o reseñas.
// Se activa solo si RECORDATORIOS_ACTIVOS=true (requiere plantillas aprobadas en Meta).
const RECORDATORIOS_ACTIVOS = String(process.env.RECORDATORIOS_ACTIVOS || "").trim().toLowerCase() === "true";

function iniciarRecordatorios() {
  if (demo.MODO_DEMO || !RECORDATORIOS_ACTIVOS || !AGENDA_ACTIVA) return;
  const CADA = 15 * 60 * 1000;
  const correr = () => {
    recordatorios.revisarYEnviar({ sendTemplate, alertTeam })
      .catch(e => console.error("Error en el ciclo de recordatorios:", e.message));
  };
  setTimeout(correr, 60 * 1000); // primera ronda al minuto de arrancar
  setInterval(correr, CADA);
  console.log("🔔 Recordatorios automáticos ACTIVOS (revisión cada 15 minutos)");
}

// ---------- Estado persistente de chats atendidos por personas ----------
async function iniciarEstado() {
  if (!ESTADO_CALENDAR_ID) {
    console.warn("⚠️ Sin ESTADO_CALENDAR_ID: el silencio por intervención humana solo vive en memoria (se pierde al reiniciar).");
    return;
  }
  if (!process.env.LOG_SALT) {
    console.warn("⚠️ Sin LOG_SALT: no se puede identificar el chat entre reinicios; el silencio humano queda solo en memoria.");
    return;
  }
  try {
    estadoChats = crearEstado({ calendario: cal.initCalendar(), calendarId: ESTADO_CALENDAR_ID, sal: process.env.LOG_SALT });
    const n = await estadoChats.recuperar();
    console.log(`💾 Estado persistente activo: ${n} chat(s) en manos del equipo recuperados`);
    const depurar = setInterval(() => {
      estadoChats.depurar().then(k => { if (k) console.log(`🧹 ${k} registro(s) de estado vencidos eliminados`); })
        .catch(e => console.error("No se pudo depurar el estado:", e.message));
    }, 6 * 60 * 60 * 1000);
    depurar.unref();
  } catch (e) {
    console.error("⚠️ No se pudo activar el estado persistente; queda en memoria:", e.message);
  }
}

// ---------- Conservación del historial temporal ----------
// Cada 15 minutos se borran de memoria las conversaciones con más de 24 h sin actividad.
const purgaHistorial = setInterval(() => {
  const n = priv.purgarConversacionesInactivas(chats);
  if (n) console.log(`🧹 ${n} conversación(es) inactiva(s) eliminada(s) de memoria`);
}, 15 * 60 * 1000);
purgaHistorial.unref();

// Comprueba con Meta que PHONE_NUMBER_ID es un número de prueba (+1 555…).
// Si no lo es, o no se puede comprobar, el servidor se detiene sin enviar nada.
async function verificarNumeroDemo() {
  try {
    const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}?fields=display_phone_number`, {
      headers: { "Authorization": `Bearer ${WHATSAPP_TOKEN}` }
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && demo.esNumeroDePrueba(data.display_phone_number)) {
      demoNumeroVerificado = true;
      console.log(`🧪 MODO DEMO: número de origen verificado como número de prueba (${data.display_phone_number}). Destinatarios permitidos: ${demo.destinatariosPermitidos().length}`);
      return;
    }
    console.error(`⛔ MODO DEMO: PHONE_NUMBER_ID no es un número de prueba o no se pudo comprobar (HTTP ${res.status}). El servidor se detiene.`);
  } catch (e) {
    console.error("⛔ MODO DEMO: no se pudo comprobar el número de origen:", e.message);
  }
  process.exit(1);
}

const PORT = process.env.PORT || 3000;
const servidor = app.listen(PORT, () => {
  console.log(`🩺 Bot del consultorio escuchando en el puerto ${servidor.address().port}`);
  console.log(`⚙️  Modelo: ${MODEL} | Agenda: ${AGENDA_ACTIVA ? "ACTIVA ✅" : "INACTIVA ❌"} | Herramientas: ${AGENDA_ACTIVA ? TOOLS.length : 0} | Recordatorios: ${RECORDATORIOS_ACTIVOS ? "ACTIVOS ✅" : "INACTIVOS ❌"} | Notas de voz: ${AUDIO_ACTIVO && priv.PERMITIR_DATOS_SENSIBLES_IA ? "ACTIVAS ✅" : "NO SE TRANSCRIBEN 🛡️"} | Datos de salud a la IA: ${priv.PERMITIR_DATOS_SENSIBLES_IA ? "PERMITIDOS ⚠️" : "BLOQUEADOS 🛡️"} | Reseñas: ${recordatorios.RESENAS_ACTIVAS ? "ACTIVAS" : "APAGADAS"}`);
  iniciarRecordatorios();
  iniciarEstado();
  if (demo.MODO_DEMO) verificarNumeroDemo();
  if (BOT_PAUSADO) console.warn("⏸️ Bot PAUSADO: no contestará a nadie. Para encenderlo: BOT_PAUSADO=false en Render.");
  else console.log("▶️ Bot ENCENDIDO (contesta a pacientes).");
  const faltantes = ["WHATSAPP_TOKEN", "VERIFY_TOKEN", "PHONE_NUMBER_ID", "OPENAI_API_KEY"]
    .filter(v => !process.env[v]);
  if (faltantes.length) console.warn("⚠️ Faltan variables de entorno:", faltantes.join(", "));
});
