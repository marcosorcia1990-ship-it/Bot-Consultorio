// ============================================================
// Privacidad — Consultorio Dr. Marco A. Mixteco
// - Filtros locales que se aplican ANTES de enviar nada a OpenAI:
//   información clínica, urgencias, solicitudes ARCO y bajas de mensajes automáticos.
// - Mensajes fijos (no generados por IA) para esos casos y el aviso simplificado.
// - Seudónimos para los registros técnicos (logs) y purga del historial temporal.
//
// El filtro clínico es por palabras clave: reduce mucho el riesgo, pero NO garantiza
// detectar todos los casos. Ver docs/PRIVACIDAD-CAMBIOS.md.
// ============================================================

const crypto = require("crypto");

const AVISO_URL = process.env.AVISO_PRIVACIDAD_URL || "https://internistamarco.com/privacidad";
const CORREO_PRIVACIDAD = process.env.CORREO_PRIVACIDAD || "contacto@internistamarco.com";

// Mientras no exista un mecanismo de consentimiento expreso validado jurídicamente,
// la información de salud NO se envía a OpenAI. Solo debe ponerse en "true" cuando
// ese mecanismo esté implementado y aprobado.
const PERMITIR_DATOS_SENSIBLES_IA =
  String(process.env.PERMITIR_DATOS_SENSIBLES_IA || "").trim().toLowerCase() === "true";

// Historial temporal: se descarta 24 h después del último mensaje. Coincide con la
// ventana de atención de WhatsApp (pasadas 24 h el bot ya no puede contestar
// libremente) y es lo mínimo necesario para dar continuidad a una conversación.
const HISTORIAL_TTL_MS = 24 * 60 * 60 * 1000;

// ---------- Normalización ----------
function normalizar(texto) {
  return " " + String(texto || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9/%\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim() + " ";
}

// ---------- Detección ----------
// Síntomas o situaciones que activan directamente el protocolo de urgencias.
const PATRONES_URGENCIA = [
  /\bdolor (de|en el) pecho\b/, /\bme duele (el|mucho el) pecho\b/,
  /\bno puedo respirar\b/, /\bfalta de aire\b/, /\bdificultad para respirar\b/, /\bme ahogo\b/,
  /\bdesmay/, /\bperdi(o)? el conocimiento\b/, /\bconvuls/,
  /\bsangrado abundante\b/, /\bno (puedo|puede) mover\b/, /\bparalis/,
  /\bse le (cayo|chueco) la cara\b/, /\burgencia\b/, /\bemergencia\b/
];

// Términos clínicos: síntomas, padecimientos, medicamentos, resultados con valores.
const PATRONES_CLINICOS = [
  // síntomas y molestias
  /\bdolor\b/, /\bduele\b/, /\bdolio\b/, /\bfiebre\b/, /\bcalentura\b/, /\btos\b/, /\bgripa\b/,
  /\bvomit/, /\bnausea/, /\bdiarrea\b/, /\bestrenimiento\b/, /\bmareo/, /\bsangr/,
  /\binflamad/, /\bhinchad/, /\bcomezon\b/, /\bardor\b/, /\bpalpitacion/, /\bcansancio\b/,
  /\bme siento mal\b/, /\bestoy enferm/, /\bsintoma/,
  // padecimientos
  /\bdiabet/, /\bhipertens/, /\bpresion (alta|baja|arterial)\b/, /\bla presion\b/,
  /\bcancer\b/, /\btumor/, /\binfeccion/, /\bcovid\b/, /\basma\b/, /\bepoc\b/,
  /\btiroid/, /\bhipotiroid/, /\bhipertiroid/, /\bhashimoto\b/, /\bgastritis\b/, /\bcolitis\b/,
  /\breflujo\b/, /\bhigado\b/, /\bhigado graso\b/, /\brinon/, /\brenal\b/, /\bvesicula\b/,
  /\bartritis\b/, /\bgota\b/, /\blupus\b/, /\bfibromialgia\b/, /\banemia\b/, /\bembaraz/,
  /\bdepresion\b/, /\bansiedad\b/, /\bvih\b/, /\bhepatitis\b/, /\bneumonia\b/, /\bepilep/,
  /\binfarto\b/, /\bembolia\b/, /\bmigran/, /\bcolesterol\b/, /\btriglicerid/, /\bglucosa\b/,
  /\bazucar\b/, /\bobesidad\b/, /\barritmia/, /\binsuficiencia\b/, /\bprostata\b/,
  /\bdiagnostic/, /\bpadezco\b/, /\bsufro de\b/, /\bme detectaron\b/,
  // medicamentos y tratamiento
  /\bmedicamento/, /\bpastilla/, /\btableta/, /\bcapsula/, /\bdosis\b/, /\breceta/,
  /\bjarabe\b/, /\binyeccion/, /\binsulina\b/, /\bmetformina\b/, /\bantibiotico/,
  /\btratamiento\b/, /\bme recetaron\b/, /\bestoy tomando\b/,
  // resultados con interpretación o valores
  // (no se usa "120/80" como patrón: chocaría con fechas como "25/11")
  /\bsali(o|eron) (alt|baj|mal|positiv|negativ)/, /\b\d+\s*(mg|mg\/dl|mmhg|ml)\b/
];

// Expresiones administrativas que contienen palabras de las listas anteriores pero
// no revelan información de salud del paciente.
const EXCEPCIONES_ADMIN = [/\bmedicina interna\b/g];

function limpiarExcepciones(t) {
  let r = t;
  for (const e of EXCEPCIONES_ADMIN) r = r.replace(e, " ");
  return r;
}

function esUrgencia(texto) {
  const t = normalizar(texto);
  return PATRONES_URGENCIA.some(p => p.test(t));
}

function contieneInformacionClinica(texto) {
  const t = limpiarExcepciones(normalizar(texto));
  return esUrgencia(texto) || PATRONES_CLINICOS.some(p => p.test(t));
}

// Solicitudes sobre datos personales (derechos ARCO / privacidad)
const PATRONES_ARCO = [
  /\baviso de privacidad\b/, /\bprivacidad\b/, /\bderechos arco\b/, /\barco\b/,
  // cualquier conjugación: eliminar, eliminen, borren, quiten, corrijan...
  /\b(elimin|borr|cancel|suprim|quit|corrig|rectific)[a-z]* (todos )?(mis|los) datos\b/,
  /\b(acceder a|consultar|conocer|ver) (todos )?(mis|los) datos( personales)?\b/,
  /\b(elimin|borr|suprim|quit)[a-z]* (toda )?mi informacion\b/,
  /\bme opongo\b/, /\brevocar (mi )?consentimiento\b/, /\bque hacen con mis datos\b/
];

function esSolicitudPrivacidad(texto) {
  const t = normalizar(texto);
  return PATRONES_ARCO.some(p => p.test(t));
}

// Baja de mensajes automáticos (confirmación, recordatorio, reseña)
function esBaja(texto) {
  const t = normalizar(texto).trim();
  if (t === "baja" || t === "dar de baja" || t === "stop") return true;
  return /\b(no quiero recibir|dejar de recibir|ya no (me )?(envien|manden|mande|envie)|no me (envien|manden) (mas )?(mensajes|recordatorios))\b/.test(" " + t + " ");
}

// ---------- Mensajes fijos (no pasan por la IA) ----------
const MENSAJES = {
  avisoSimplificado:
    "Aviso de privacidad simplificado: MARCO ANTONIO MIXTECO SORCIA (Dr. Marco A. Mixteco Internista) " +
    "utiliza sus datos de contacto y los de su cita para atender sus mensajes y administrar la agenda del consultorio. " +
    "Algunos mensajes los responde un asistente digital y el personal del consultorio puede intervenir en cualquier momento. " +
    "Por su privacidad, no envíe información de salud por este medio. " +
    "Si no desea recibir recordatorios automáticos, responda BAJA. " +
    `Aviso de privacidad integral: ${AVISO_URL}`,

  clinico:
    "Por su privacidad, este asistente solo atiende temas administrativos (citas, costos, ubicación y requisitos) " +
    "y no puede recibir ni revisar información de salud. Su mensaje quedó para revisión del personal del consultorio, " +
    "que le responderá personalmente.\n\n" +
    "Si desea agendar, cambiar o cancelar una cita, escríbanos solo eso, por ejemplo: \"Quiero agendar una cita\".\n\n" +
    "Si se trata de una urgencia, acuda al servicio de urgencias más cercano o llame al 911.",

  urgencia:
    "⚠️ Si presenta síntomas graves como dolor de pecho, dificultad para respirar o pérdida del conocimiento, " +
    "acuda de inmediato al servicio de urgencias más cercano o llame al 911.\n\n" +
    "La consulta del Dr. Mixteco no brinda atención de urgencias ni disponibilidad inmediata. " +
    "Puede acudir al servicio de urgencias de cualquier hospital, por ejemplo:\n\n" +
    "- Hospital General de Zona No. 8 del IMSS (Avenida 11), Córdoba, Ver.\n" +
    "- Hospital General Yanga, Córdoba, Ver.\n" +
    "- De forma privada, el Sanatorio Santa Rita (disponible las 24 horas)\n\n" +
    "Si acude al Sanatorio Santa Rita, puede solicitar la valoración de:\n\n" +
    "Dr. Jaime Omar Bravo — 272 183 3588\n" +
    "Dra. Ana Rodríguez — 563 514 1892\n\n" +
    "Ambos especialistas en Medicina de Emergencias. Gracias por su comprensión.",

  audio:
    "Por su privacidad, este asistente no escucha notas de voz. El personal del consultorio la revisará " +
    "y le responderá personalmente. Si su mensaje es para agendar, cambiar o cancelar una cita, " +
    "puede escribirlo por texto, sin incluir información de salud.",

  privacidad:
    "Las solicitudes sobre sus datos personales (acceso, corrección, eliminación u oposición) se atienden " +
    `personalmente y por escrito. Envíe su solicitud a ${CORREO_PRIVACIDAD} con su nombre completo, ` +
    "el número con el que nos escribe y una identificación oficial. El personal del consultorio la revisará " +
    "y le responderá dentro del plazo legal.\n\n" +
    `Aviso de privacidad: ${AVISO_URL}`,

  bajaRegistrada:
    "Listo. No le enviaremos más mensajes automáticos de confirmación, recordatorio u opinión sobre sus citas. " +
    "Sus citas siguen vigentes. Si cambia de opinión, escríbanos por este medio.",

  bajaPendiente:
    "Recibimos su solicitud para no recibir mensajes automáticos. El personal del consultorio la registrará en breve. " +
    "Sus citas siguen vigentes."
};

// ---------- Registros técnicos (logs) ----------
// Seudónimo estable del número: permite seguir un caso en los logs sin exponer el número.
// Con LOG_SALT definido en Render, el seudónimo es el mismo entre reinicios.
const SAL_LOG = process.env.LOG_SALT || crypto.randomBytes(16).toString("hex");

function idPaciente(numero) {
  const ultimos10 = String(numero || "").replace(/\D/g, "").slice(-10);
  if (!ultimos10) return "p-desconocido";
  return "p-" + crypto.createHmac("sha256", SAL_LOG).update(ultimos10).digest("hex").slice(0, 8);
}

// Quita números largos (teléfonos) de textos de error de proveedores antes de registrarlos
function sanitizarLog(texto, max = 300) {
  return String(texto || "").replace(/\+?\d[\d\s-]{6,}\d/g, "[número]").slice(0, max);
}

// Identificador corto de un evento de calendario para los logs
function idEvento(eventId) {
  return "ev-" + String(eventId || "").slice(0, 8);
}

// ---------- Conservación del historial temporal ----------
// Borra de memoria las conversaciones sin actividad en las últimas 24 h, salvo las que
// siguen marcadas como "en manos humanas". Devuelve cuántas se eliminaron.
function purgarConversacionesInactivas(chats, ahora = Date.now(), ttlMs = HISTORIAL_TTL_MS) {
  let eliminadas = 0;
  for (const [clave, chat] of chats) {
    if (ahora - (chat.lastActivity || 0) > ttlMs && (chat.humanUntil || 0) <= ahora) {
      chats.delete(clave);
      eliminadas++;
    }
  }
  return eliminadas;
}

module.exports = {
  AVISO_URL, CORREO_PRIVACIDAD, PERMITIR_DATOS_SENSIBLES_IA, HISTORIAL_TTL_MS, MENSAJES,
  normalizar, esUrgencia, contieneInformacionClinica, esSolicitudPrivacidad, esBaja,
  idPaciente, idEvento, sanitizarLog, purgarConversacionesInactivas
};
