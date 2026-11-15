// ============================================================
// Alta de un número con Embedded Signup (v4) — /alta
// Requiere sesión de administrador (/admin/entrar). Se usa una sola vez por número.
//
// ALTA_MODO:
//   "coexistencia" (predeterminado): conecta un número que YA usa la app WhatsApp Business
//      (featureType whatsapp_business_app_onboarding). No se llama a /register: el número
//      sigue activo en la app. Después se piden las sincronizaciones de contactos e historial.
//   "normal": alta de un número nuevo solo para la API (requiere ALTA_PIN de 6 dígitos para
//      /register). Sirve, por ejemplo, para la evidencia con un número de repuesto.
//
// Variables: META_APP_ID, META_APP_SECRET, META_CONFIG_ID (configuración v4 de Facebook Login
// for Business), ALTA_MODO, ALTA_PIN (solo modo normal).
//
// Requisito de Meta para coexistence: la app debe ser Tech Provider / Solution Partner
// (ver docs/META-REVISION-PERMISOS.md).
// ============================================================

const meta = require("./meta");
const { requiereAdmin } = require("./admin");

const APP_ID = process.env.META_APP_ID || "";
const APP_SECRET = process.env.META_APP_SECRET || "";
const CONFIG_ID = process.env.META_CONFIG_ID || "";
const MODO = (process.env.ALTA_MODO || "coexistencia").trim().toLowerCase();
const PIN = process.env.ALTA_PIN || "";

// Muestra solo el inicio y el final del token
function enmascarar(token) {
  const t = String(token || "");
  return t.length > 12 ? `${t.slice(0, 4)}…${t.slice(-4)}` : "****";
}

function extrasPara(modo) {
  const extras = { setup: {}, sessionInfoVersion: "3" };
  if (modo === "coexistencia") extras.featureType = "whatsapp_business_app_onboarding";
  return extras;
}

// Interpreta el mensaje de sesión de Embedded Signup (window.postMessage)
function interpretarSesion(d) {
  if (!d || d.type !== "WA_EMBEDDED_SIGNUP") return null;
  const evento = String(d.event || "");
  const datos = d.data || {};
  if (evento === "CANCEL") return { estado: "cancelado", paso: datos.current_step || "" };
  if (evento === "ERROR") return { estado: "error", mensaje: datos.error_message || "error" };
  if (evento.startsWith("FINISH")) {
    return { estado: "terminado", evento, waba_id: datos.waba_id || "", phone_number_id: datos.phone_number_id || "" };
  }
  return { estado: "otro", evento };
}

function paginaAlta() {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Conectar WhatsApp</title>
<style>body{font-family:system-ui,sans-serif;max-width:560px;margin:40px auto;padding:0 16px;line-height:1.5}
button{font-size:18px;padding:12px 20px;border-radius:8px;border:0;background:#1877f2;color:#fff;cursor:pointer;margin:6px 0}
pre{white-space:pre-wrap;background:#f3f3f3;padding:12px;border-radius:8px}</style></head><body>
<h1>Conectar el número del consultorio</h1>
<p>Modo: <b>${MODO === "coexistencia" ? "coexistencia (la app WhatsApp Business sigue funcionando)" : "alta normal solo para la API"}</b></p>
${MODO === "coexistencia" ? `<p>1. Tenga a la mano el teléfono con la app <b>WhatsApp Business</b> (versión 2.24.17 o superior).</p>
<p>2. Pulse el botón, inicie sesión con Facebook y elija conectar la app WhatsApp Business existente.</p>
<p>3. Escanee el código QR desde la app y acepte compartir el historial.</p>` : `<p>Pulse el botón y siga los pasos de Meta para registrar el número.</p>`}
<button id="btn">Conectar WhatsApp</button>
<pre id="estado"></pre>
<script>
  const estado = document.getElementById("estado");
  let sesion = null;
  window.addEventListener("message", (ev) => {
    let host = "";
    try { host = new URL(ev.origin).hostname; } catch (e) { return; }
    if (!/(^|\\.)facebook\\.com$/.test(host)) return;
    try {
      const d = typeof ev.data === "string" ? JSON.parse(ev.data) : ev.data;
      if (d && d.type === "WA_EMBEDDED_SIGNUP") {
        sesion = d;
        if (d.event === "CANCEL") estado.textContent = "Proceso cancelado en el paso: " + ((d.data && d.data.current_step) || "?");
        else if (d.event === "ERROR") estado.textContent = "Meta reportó un error: " + ((d.data && d.data.error_message) || "?");
        else estado.textContent = "Meta confirmó el paso: " + d.event;
      }
    } catch (e) {}
  });
  window.fbAsyncInit = function () {
    FB.init({ appId: ${JSON.stringify(APP_ID)}, autoLogAppEvents: true, xfbml: true, version: ${JSON.stringify(meta.GRAPH_VERSION)} });
  };
  document.getElementById("btn").onclick = function () {
    FB.login(function (resp) {
      if (!resp.authResponse || !resp.authResponse.code) {
        estado.textContent = "No se completó el inicio de sesión.";
        return;
      }
      estado.textContent = "Conectando...";
      fetch("/alta/terminar", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
        body: JSON.stringify({ code: resp.authResponse.code, sesion })
      }).then(async r => {
        const tipo = r.headers.get("content-type") || "";
        if (!tipo.includes("json")) { estado.textContent = await r.text(); return; }
        const d = await r.json();
        estado.textContent = d.texto;
        if (d.token) {
          const copiar = document.createElement("button");
          copiar.textContent = "Copiar token";
          copiar.onclick = () => navigator.clipboard.writeText(d.token).then(() => { copiar.textContent = "Token copiado"; });
          estado.after(copiar);
        }
      });
    }, {
      config_id: ${JSON.stringify(CONFIG_ID)},
      response_type: "code",
      override_default_response_type: true,
      extras: ${JSON.stringify(extrasPara(MODO))}
    });
  };
</script>
<script async defer crossorigin="anonymous" src="https://connect.facebook.net/es_LA/sdk.js"></script>
</body></html>`;
}

// Proceso del servidor tras Embedded Signup. `graph` se inyecta en las pruebas.
async function completarAlta({ code, sesion }, { graph = meta.graph, modo = MODO, pin = PIN } = {}) {
  const pasos = [];
  const s = interpretarSesion(sesion);
  if (!code) return { ok: false, status: 400, texto: "Falta el código de Facebook. Repita el proceso." };
  if (s && s.estado === "cancelado") return { ok: false, status: 400, texto: "El proceso se canceló en Meta; no se conectó nada." };
  if (s && s.estado === "error") return { ok: false, status: 400, texto: "Meta reportó un error: " + s.mensaje };
  if (!s || s.estado !== "terminado" || !s.waba_id) {
    return { ok: false, status: 400, texto: "Meta no confirmó el final del proceso (falta waba_id). No cierre la ventana de Facebook antes de terminar." };
  }

  // 1. Código -> token del negocio
  const tk = await graph(`oauth/access_token?client_id=${encodeURIComponent(APP_ID)}` +
    `&client_secret=${encodeURIComponent(APP_SECRET)}&code=${encodeURIComponent(code)}`);
  const token = tk.access_token;
  pasos.push("Token del negocio obtenido.");

  // 2. Número: en v4 el evento puede traer solo waba_id; se consulta la cuenta
  let phoneNumberId = s.phone_number_id;
  if (!phoneNumberId) {
    const lista = await graph(`${s.waba_id}/phone_numbers?fields=id,display_phone_number`, { token });
    const nums = lista.data || [];
    if (nums.length !== 1) {
      return { ok: false, status: 409, texto: `La cuenta tiene ${nums.length} números; no se puede elegir automáticamente. ` +
        nums.map(n => `${n.display_phone_number} (${n.id})`).join(", ") };
    }
    phoneNumberId = nums[0].id;
  }
  pasos.push("Número identificado.");

  // 3. Alta normal: registrar el número en la API (en coexistencia NO se registra)
  if (modo === "normal") {
    if (!/^\d{6}$/.test(String(pin))) return { ok: false, status: 400, texto: pasos.concat("Falta ALTA_PIN (6 dígitos) para registrar el número.").join("\n") };
    await graph(`${phoneNumberId}/register`, { method: "POST", token, body: { messaging_product: "whatsapp", pin: String(pin) } });
    pasos.push("Número registrado en la API.");
  }

  // 4. Suscribir la app a los webhooks de la cuenta
  await graph(`${s.waba_id}/subscribed_apps`, { method: "POST", token });
  pasos.push("App suscrita a los webhooks de la cuenta.");

  // 5. Coexistencia: sincronizar contactos y luego historial (Meta da 24 h para hacerlo)
  if (modo === "coexistencia") {
    for (const sync_type of ["smb_app_state_sync", "history"]) {
      try {
        await graph(`${phoneNumberId}/smb_app_data`, { method: "POST", token, body: { messaging_product: "whatsapp", sync_type } });
        pasos.push(`Sincronización "${sync_type}" solicitada.`);
      } catch (e) {
        pasos.push(`Aviso: no se pudo solicitar "${sync_type}": ${e.message}. Repítala antes de 24 h.`);
      }
    }
  }

  return {
    ok: true, status: 200, token,
    waba_id: s.waba_id, phone_number_id: phoneNumberId,
    texto: pasos.join("\n") + "\n\n" +
      "LISTO. Valores para Render (reinicie el servicio después):\n\n" +
      `WABA_ID=${s.waba_id}\nPHONE_NUMBER_ID=${phoneNumberId}\n` +
      `WHATSAPP_TOKEN=${enmascarar(token)}  (use el botón "Copiar token")\n\n` +
      "No comparta este token con nadie. Cierre esta página al terminar."
  };
}

function registrarRutas(app) {
  const configurado = (req, res, next) => {
    if (!APP_ID || !APP_SECRET || !CONFIG_ID) {
      return res.status(500).send("Faltan META_APP_ID, META_APP_SECRET o META_CONFIG_ID en Render.");
    }
    next();
  };

  app.get("/alta", requiereAdmin, configurado, (req, res) => res.type("html").send(paginaAlta()));

  app.post("/alta/terminar", requiereAdmin, configurado, async (req, res) => {
    try {
      const r = await completarAlta(req.body || {});
      if (r.ok) console.log("✅ Alta completada (WABA y número registrados en el panel)");
      res.status(r.status).json({ texto: r.texto, token: r.ok ? r.token : undefined });
    } catch (e) {
      console.error("Error en el alta:", e.message);
      res.status(500).json({ texto: "ERROR: " + e.message });
    }
  });
}

module.exports = { registrarRutas, enmascarar, interpretarSesion, completarAlta, extrasPara };
