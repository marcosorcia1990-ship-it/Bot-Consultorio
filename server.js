// ============================================================
// Bot de WhatsApp — Consultorio Dr. Marco A. Mixteco
// Fase 1: respuestas automáticas con IA (Claude) + reglas de silencio
// ============================================================

const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

// ---------- Configuración (variables de entorno en Render) ----------
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;          // Token de acceso de Meta
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;              // Palabra secreta que tú inventas
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;        // Identificador del número (de Meta)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;         // Clave de la API de OpenAI
const MODEL = process.env.MODEL || "gpt-4o-mini";
const GRAPH_VERSION = process.env.GRAPH_VERSION || "v25.0";

// Números personales protegidos (el bot JAMÁS les responde).
// Formato: últimos 10 dígitos, separados por comas. Ej: "2202355440,2717493381"
const PERSONAL_NUMBERS = (process.env.PERSONAL_NUMBERS || "")
  .split(",").map(n => n.trim().slice(-10)).filter(Boolean);

// Número interno para alertas (urgencias / pendientes). Opcional.
const INTERNAL_ALERT_NUMBER = process.env.INTERNAL_ALERT_NUMBER || "";

// ---------- Cerebro del bot ----------
const SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, "system-prompt.md"), "utf8");

// ---------- Estado en memoria ----------
// chats: por cada número → historial de conversación y banderas
const chats = new Map();
const processedIds = new Set(); // para no procesar dos veces el mismo mensaje
const DAY_MS = 24 * 60 * 60 * 1000;

function getChat(from) {
  if (!chats.has(from)) {
    chats.set(from, { history: [], lastActivity: 0, humanUntil: 0 });
  }
  return chats.get(from);
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

async function sendWhatsAppText(to, body) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body, preview_url: true }
    })
  });
  if (!res.ok) {
    console.error("Error al enviar mensaje:", res.status, await res.text());
  }
}

async function alertTeam(text) {
  console.log("🔔 ALERTA INTERNA:", text);
  if (!INTERNAL_ALERT_NUMBER) return;
  try {
    await sendWhatsAppText(INTERNAL_ALERT_NUMBER, `🔔 Aviso del bot:\n${text}`);
  } catch (e) {
    console.error("No se pudo enviar la alerta interna (probablemente fuera de ventana de 24h):", e.message);
  }
}

async function askAI(chat, userText) {
  const { fecha, abierto } = nowInCordoba();
  const runtimeContext =
    `\n\n---\nContexto en tiempo real: hoy es ${fecha} (hora de Córdoba, Veracruz). ` +
    (abierto
      ? "El consultorio está en horario hábil."
      : "Es FUERA del horario de atención: en respuestas que requieran acción humana, ajusta expectativas (ej. 'le confirmamos mañana por la mañana 🙏').");

  // OpenAI usa un mensaje "system" al inicio + el historial
  const messages = [
    { role: "system", content: SYSTEM_PROMPT + runtimeContext },
    ...chat.history,
    { role: "user", content: userText }
  ];

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 600,
      messages
    })
  });

  if (!res.ok) {
    throw new Error(`API de OpenAI respondió ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  return (data.choices?.[0]?.message?.content || "").trim();
}

// ---------- Lógica principal por mensaje ----------
async function processMessage(msg, value) {
  const from = msg.from; // número del paciente (con lada de país)
  const chat = getChat(from);
  const now = Date.now();

  // Regla: números personales protegidos → silencio total
  if (PERSONAL_NUMBERS.includes(String(from).slice(-10))) {
    console.log(`(silencio) Número protegido: ${from}`);
    return;
  }

  // Reinicio de conversación: más de 24 h sin actividad → conversación nueva
  if (now - chat.lastActivity > DAY_MS) {
    chat.history = [];
    chat.humanUntil = 0;
  }
  chat.lastActivity = now;

  // Regla: conversación en manos humanas (la última palabra manda)
  if (chat.humanUntil > now) {
    console.log(`(silencio) Chat en manos humanas: ${from}`);
    return;
  }

  // ---- Clasificación por tipo de mensaje ----
  let userText = null;

  if (msg.type === "text") {
    userText = msg.text.body;

  } else if (msg.type === "audio") {
    // Fase 1: sin transcripción → respuesta fija, sin gastar IA
    await sendWhatsAppText(from,
      "¡Gracias por su mensaje de voz! 🎙️ Para atenderle más rápido, ¿me lo podría escribir en un mensaje de texto? " +
      "Si prefiere no escribir, no se preocupe: escucharemos su mensaje con atención y le responderemos en cuanto nos sea posible 🙏");
    chat.history.push(
      { role: "user", content: "[El paciente envió un mensaje de voz]" },
      { role: "assistant", content: "[Se le pidió amablemente el mensaje por texto]" }
    );
    return;

  } else if (msg.type === "image" || msg.type === "document" || msg.type === "video") {
    const caption = (msg[msg.type] && msg[msg.type].caption || "").trim();
    if (!caption || caption.length < 15) {
      // Documento/foto sin texto relevante → silencio (Ade los organiza)
      console.log(`(silencio) ${msg.type} sin contexto de: ${from}`);
      return;
    }
    userText = `[El paciente envió un(a) ${msg.type} acompañado de este texto]: ${caption}`;

  } else {
    // Stickers, reacciones, ubicaciones, contactos, etc. → silencio
    console.log(`(silencio) Tipo no atendido (${msg.type}) de: ${from}`);
    return;
  }

  // ---- Consultar a la IA ----
  let reply;
  try {
    reply = await askAI(chat, userText);
  } catch (e) {
    // Regla de oro: ante cualquier falla, mejor silencio que una respuesta rota
    console.error("Error consultando a la IA:", e.message);
    return;
  }

  // ---- Marcadores especiales ----
  if (reply.includes("[AVISAR_EQUIPO]")) {
    reply = reply.replace(/\[AVISAR_EQUIPO\]/g, "").trim();
    await alertTeam(`Mensaje que requiere atención humana.\nDe: +${from}\nDijo: "${String(userText).slice(0, 300)}"`);
  }

  if (reply.includes("[NO_RESPONDER]") || reply === "") {
    console.log(`(silencio por decisión de la IA) ${from}`);
    chat.history.push({ role: "user", content: userText });
    trimHistory(chat);
    return;
  }

  // ---- Responder ----
  await sendWhatsAppText(from, reply);
  chat.history.push({ role: "user", content: userText }, { role: "assistant", content: reply });
  trimHistory(chat);
}

function trimHistory(chat) {
  if (chat.history.length > 14) chat.history = chat.history.slice(-14);
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

        // Ecos de mensajes enviados manualmente desde la app (Coexistence):
        // si el doctor o Ade escriben, ese chat queda en manos humanas 24 h.
        const echoes = value.message_echoes || value.smb_message_echoes || [];
        for (const echo of echoes) {
          const to = echo.to;
          if (to) {
            const chat = getChat(to);
            chat.humanUntil = Date.now() + DAY_MS;
            console.log(`👤 Chat tomado por el equipo: ${to}`);
          }
        }

        // Mensajes entrantes de pacientes
        for (const msg of (value.messages || [])) {
          if (processedIds.has(msg.id)) continue;
          processedIds.add(msg.id);
          if (processedIds.size > 1000) {
            processedIds.delete(processedIds.values().next().value);
          }
          processMessage(msg, value).catch(e => console.error("Error procesando mensaje:", e));
        }
      }
    }
  } catch (e) {
    console.error("Error en webhook:", e);
  }
});

// Página de salud (para saber que el servidor vive)
app.get("/", (req, res) => res.send("Bot del consultorio: en línea ✅"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🩺 Bot del consultorio escuchando en el puerto ${PORT}`);
  const faltantes = ["WHATSAPP_TOKEN", "VERIFY_TOKEN", "PHONE_NUMBER_ID", "OPENAI_API_KEY"]
    .filter(v => !process.env[v]);
  if (faltantes.length) console.warn("⚠️ Faltan variables de entorno:", faltantes.join(", "));
});
