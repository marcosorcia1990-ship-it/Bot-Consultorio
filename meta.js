// ============================================================
// Cliente mínimo de la API Graph de Meta (WhatsApp Business Management)
// Los tokens nunca se registran ni se devuelven al navegador.
// ============================================================

const GRAPH_VERSION = process.env.GRAPH_VERSION || "v25.0";

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
  if (!res.ok) {
    const err = data.error || {};
    const e = new Error(`${method} ${ruta.split("?")[0]}: ${res.status} ${err.message || ""} (código ${err.code || "?"}${err.error_subcode ? "/" + err.error_subcode : ""})`);
    e.status = res.status;
    e.codigo = err.code;
    throw e;
  }
  return data;
}

// Estado de un número y su cuenta (solo lectura)
async function diagnostico({ token, phoneNumberId, wabaId }) {
  const r = { numero: null, waba: null, errores: [] };
  if (phoneNumberId) {
    try {
      r.numero = await graph(`${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,platform_type,code_verification_status,webhook_configuration`, { token });
    } catch (e) { r.errores.push(e.message); }
  }
  if (wabaId) {
    try {
      const [numeros, apps] = await Promise.all([
        graph(`${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,platform_type`, { token }),
        graph(`${wabaId}/subscribed_apps`, { token })
      ]);
      r.waba = { numeros: numeros.data || [], apps: apps.data || [] };
    } catch (e) { r.errores.push(e.message); }
  }
  return r;
}

// Suscribe la app a la WABA con desvío del webhook SOLO para esa WABA.
// No cambia la URL general del webhook de la app.
async function suscribirConDesvio({ token, wabaId, urlWebhook, verifyToken }) {
  return graph(`${wabaId}/subscribed_apps`, {
    method: "POST", token,
    body: { override_callback_uri: urlWebhook, verify_token: verifyToken }
  });
}

async function desuscribir({ token, wabaId }) {
  return graph(`${wabaId}/subscribed_apps`, { method: "DELETE", token });
}

module.exports = { GRAPH_VERSION, graph, diagnostico, suscribirConDesvio, desuscribir };
