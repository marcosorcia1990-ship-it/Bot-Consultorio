// ============================================================
// Alta del número con COEXISTENCIA (app WhatsApp Business + API)
// Flujo "Embedded Signup" de Meta con featureType whatsapp_business_app_onboarding.
// Solo funciona cuando la app de Meta ya es Tech Provider (verificación de negocio
// y revisión de la app aprobadas). Se usa UNA vez para conectar el número.
//
// Variables necesarias en Render:
//   META_APP_ID        Identificador de la app en developers.facebook.com
//   META_APP_SECRET    Clave secreta de la app (Configuración > Básica)
//   META_CONFIG_ID     ID de la configuración de Embedded Signup (Facebook Login for Business)
//   VERIFY_TOKEN       El mismo del webhook: protege estas páginas
// ============================================================

const GRAPH_VERSION = process.env.GRAPH_VERSION || "v25.0";
const APP_ID = process.env.META_APP_ID || "";
const APP_SECRET = process.env.META_APP_SECRET || "";
const CONFIG_ID = process.env.META_CONFIG_ID || "";
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "";

async function graph(ruta, { method = "GET", token, body } = {}) {
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${ruta}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${ruta}: ${res.status} ${JSON.stringify(data.error || data)}`);
  return data;
}

function paginaAlta() {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Conectar WhatsApp</title>
<style>body{font-family:system-ui,sans-serif;max-width:560px;margin:40px auto;padding:0 16px;line-height:1.5}
button{font-size:18px;padding:12px 20px;border-radius:8px;border:0;background:#1877f2;color:#fff;cursor:pointer}
pre{white-space:pre-wrap;background:#f3f3f3;padding:12px;border-radius:8px}</style></head><body>
<h1>Conectar el número del consultorio</h1>
<p>1. Tenga a la mano el teléfono con la app <b>WhatsApp Business</b> (versión 2.24.17 o superior).</p>
<p>2. Pulse el botón, inicie sesión con Facebook y elija <b>"Conectar la app WhatsApp Business existente"</b>.</p>
<p>3. Escanee el código QR desde la app y acepte compartir el historial.</p>
<button id="btn">Conectar WhatsApp</button>
<pre id="estado"></pre>
<script>
  const estado = document.getElementById("estado");
  let datosSesion = {};
  window.addEventListener("message", (ev) => {
    if (!/facebook\\.com$/.test(new URL(ev.origin).hostname)) return;
    try {
      const d = JSON.parse(ev.data);
      if (d.type === "WA_EMBEDDED_SIGNUP") {
        datosSesion = d.data || {};
        estado.textContent = "Sesión: " + JSON.stringify(d);
      }
    } catch (e) {}
  });
  window.fbAsyncInit = function () {
    FB.init({ appId: ${JSON.stringify(APP_ID)}, autoLogAppEvents: true, xfbml: true, version: ${JSON.stringify(GRAPH_VERSION)} });
  };
  document.getElementById("btn").onclick = function () {
    FB.login(function (resp) {
      if (!resp.authResponse || !resp.authResponse.code) {
        estado.textContent = "No se completó el inicio de sesión.";
        return;
      }
      estado.textContent = "Conectando...";
      fetch(location.pathname + "/terminar" + location.search, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: resp.authResponse.code, ...datosSesion })
      }).then(r => r.text()).then(t => { estado.textContent = t; });
    }, {
      config_id: ${JSON.stringify(CONFIG_ID)},
      response_type: "code",
      override_default_response_type: true,
      extras: { setup: {}, featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3" }
    });
  };
</script>
<script async defer crossorigin="anonymous" src="https://connect.facebook.net/es_LA/sdk.js"></script>
</body></html>`;
}

function registrarRutas(app) {
  const autorizado = (req, res) => {
    if (!VERIFY_TOKEN || req.query.token !== VERIFY_TOKEN) {
      res.status(403).send("Token incorrecto.");
      return false;
    }
    if (!APP_ID || !APP_SECRET || !CONFIG_ID) {
      res.status(500).send("Faltan META_APP_ID, META_APP_SECRET o META_CONFIG_ID en Render.");
      return false;
    }
    return true;
  };

  app.get("/alta", (req, res) => {
    if (!autorizado(req, res)) return;
    res.type("html").send(paginaAlta());
  });

  app.post("/alta/terminar", async (req, res) => {
    if (!autorizado(req, res)) return;
    const { code, waba_id, phone_number_id } = req.body || {};
    if (!code || !waba_id || !phone_number_id) {
      return res.status(400).send(
        "Faltan datos de la sesión (code, waba_id o phone_number_id). " +
        "Repita el proceso sin cerrar la ventana de Facebook antes de terminar.");
    }
    const pasos = [];
    try {
      // 1. Cambiar el código por el token del negocio
      const tk = await graph(
        `oauth/access_token?client_id=${encodeURIComponent(APP_ID)}` +
        `&client_secret=${encodeURIComponent(APP_SECRET)}&code=${encodeURIComponent(code)}`);
      const token = tk.access_token;
      pasos.push("Token del negocio obtenido.");

      // 2. Suscribir la app a la cuenta de WhatsApp para recibir los webhooks
      await graph(`${waba_id}/subscribed_apps`, { method: "POST", token });
      pasos.push("Webhooks suscritos.");

      // 3. Sincronizar contactos e historial de la app (debe hacerse en las primeras 24 h).
      //    En coexistencia NO se llama a /register: el número ya está activo en la app.
      for (const sync_type of ["smb_app_state_sync", "history"]) {
        try {
          await graph(`${phone_number_id}/smb_app_data`, {
            method: "POST", token, body: { messaging_product: "whatsapp", sync_type }
          });
          pasos.push(`Sincronización "${sync_type}" solicitada.`);
        } catch (e) {
          pasos.push(`Aviso: no se pudo solicitar "${sync_type}": ${e.message}`);
        }
      }

      console.log(`✅ Alta con coexistencia completada. WABA ${waba_id}, número ${phone_number_id}`);
      res.send(
        pasos.join("\n") + "\n\n" +
        "LISTO. Copie estos valores en las variables de entorno de Render y reinicie el servicio:\n\n" +
        `PHONE_NUMBER_ID=${phone_number_id}\n` +
        `WHATSAPP_TOKEN=${token}\n\n` +
        "No comparta este token con nadie. Cierre esta página al terminar.");
    } catch (e) {
      console.error("Error en el alta:", e.message);
      res.status(500).send(pasos.concat(`ERROR: ${e.message}`).join("\n"));
    }
  });
}

module.exports = { registrarRutas };
