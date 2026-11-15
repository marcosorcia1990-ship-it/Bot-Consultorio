// ============================================================
// Panel de administración (/admin): sesión con contraseña y panel de WhatsApp.
// - La contraseña (ADMIN_TOKEN) se escribe en un formulario, nunca en la URL,
//   para que no aparezca en grabaciones de pantalla ni en el historial.
// - El panel usa la API de gestión de WhatsApp (whatsapp_business_management) para:
//     · ver el número configurado, su cuenta (WABA) y a dónde van sus webhooks;
//     · comprobar que la cuenta solo tiene números de prueba (modo demo);
//     · suscribir la app a esa cuenta con desvío del webhook hacia ESTE servidor,
//       sin tocar la URL general de la app; y quitar la suscripción.
// Sin ADMIN_TOKEN, el panel está desactivado.
// ============================================================

const crypto = require("crypto");
const meta = require("./meta");
const demo = require("./demo");

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const SESION_MS = 2 * 60 * 60 * 1000;
const sesiones = new Map();   // sid -> vence
const intentos = new Map();   // ip -> { n, desde }

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function leerCookie(req, nombre) {
  const m = String(req.headers.cookie || "").match(new RegExp(`(?:^|;\\s*)${nombre}=([^;]+)`));
  return m ? m[1] : "";
}

function sesionValida(req) {
  const sid = leerCookie(req, "bot_admin");
  const vence = sid && sesiones.get(sid);
  if (!vence || vence < Date.now()) { if (sid) sesiones.delete(sid); return false; }
  return true;
}

// Middleware: exige sesión de administrador
function requiereAdmin(req, res, next) {
  if (!ADMIN_TOKEN) return res.status(503).send("Panel desactivado: falta ADMIN_TOKEN.");
  if (sesionValida(req)) return next();
  return res.redirect(`/admin/entrar?volver=${encodeURIComponent(req.originalUrl)}`);
}

function igualSeguro(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function pagina(titulo, cuerpo) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(titulo)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:860px;margin:32px auto;padding:0 16px;line-height:1.5}
table{border-collapse:collapse;width:100%;margin:8px 0}td,th{border:1px solid #ccc;padding:6px;text-align:left;vertical-align:top}
.ok{color:#0a7d27;font-weight:600}.mal{color:#b00020;font-weight:600}button{font-size:16px;padding:8px 14px;margin:4px 0}
code{background:#f3f3f3;padding:1px 4px}</style></head><body>${cuerpo}</body></html>`;
}

function datosConfig() {
  return {
    token: process.env.WHATSAPP_TOKEN,
    phoneNumberId: process.env.PHONE_NUMBER_ID,
    wabaId: process.env.WABA_ID,
    verifyToken: process.env.VERIFY_TOKEN,
    urlPublica: (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/+$/, "")
  };
}

// Evalúa si es seguro conectar la cuenta a este servidor
function evaluarAislamiento(diag, cfg) {
  const checks = [];
  const numeros = (diag.waba && diag.waba.numeros) || [];
  checks.push({ ok: Boolean(cfg.wabaId), texto: "WABA_ID configurado" });
  checks.push({ ok: numeros.length > 0, texto: "La cuenta tiene números visibles con este token" });
  checks.push({
    ok: numeros.some(n => String(n.id) === String(cfg.phoneNumberId)),
    texto: "PHONE_NUMBER_ID pertenece a esta cuenta"
  });
  if (demo.MODO_DEMO) {
    checks.push({
      ok: numeros.length > 0 && numeros.every(n => demo.esNumeroDePrueba(n.display_phone_number)),
      texto: "MODO DEMO: todos los números de la cuenta son de prueba (+1 555)"
    });
  }
  checks.push({ ok: /^https:\/\//.test(cfg.urlPublica), texto: "URL pública HTTPS de este servidor conocida" });
  return { checks, seguro: checks.every(c => c.ok) };
}

function registrarRutas(app) {
  app.get("/admin/entrar", (req, res) => {
    if (!ADMIN_TOKEN) return res.status(503).send("Panel desactivado: falta ADMIN_TOKEN.");
    const volver = String(req.query.volver || "/admin/whatsapp");
    res.type("html").send(pagina("Entrar", `<h1>Panel del bot</h1>
<form method="post" action="/admin/entrar"><input type="hidden" name="volver" value="${esc(volver)}">
<label>Contraseña de administrador<br><input type="password" name="clave" autocomplete="current-password" required></label><br>
<button type="submit">Entrar</button></form>`));
  });

  app.post("/admin/entrar", (req, res) => {
    if (!ADMIN_TOKEN) return res.status(503).send("Panel desactivado.");
    const ip = req.ip || "?";
    const i = intentos.get(ip) || { n: 0, desde: Date.now() };
    if (Date.now() - i.desde > 15 * 60 * 1000) { i.n = 0; i.desde = Date.now(); }
    if (i.n >= 10) return res.status(429).send("Demasiados intentos. Espere 15 minutos.");
    if (!igualSeguro((req.body && req.body.clave) || "", ADMIN_TOKEN)) {
      i.n++; intentos.set(ip, i);
      return res.status(403).send("Contraseña incorrecta.");
    }
    intentos.delete(ip);
    const sid = crypto.randomBytes(24).toString("hex");
    sesiones.set(sid, Date.now() + SESION_MS);
    const seguro = req.secure ? "; Secure" : "";
    res.setHeader("Set-Cookie", `bot_admin=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESION_MS / 1000}${seguro}`);
    const volver = String((req.body && req.body.volver) || "/admin/whatsapp");
    res.redirect(volver.startsWith("/admin") || volver.startsWith("/alta") ? volver : "/admin/whatsapp");
  });

  app.get("/admin/whatsapp", requiereAdmin, async (req, res) => {
    const cfg = datosConfig();
    const diag = await meta.diagnostico(cfg);
    const { checks, seguro } = evaluarAislamiento(diag, cfg);
    const n = diag.numero || {};
    const wc = n.webhook_configuration || {};
    const numeros = (diag.waba && diag.waba.numeros) || [];
    const apps = (diag.waba && diag.waba.apps) || [];
    const fila = (k, v) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`;
    const aviso = req.query.r ? `<p><b>${esc(req.query.r)}</b></p>` : "";

    res.type("html").send(pagina("WhatsApp — panel", `
<h1>Conexión con WhatsApp</h1>${aviso}
<p>Modo: <b>${demo.MODO_DEMO ? "DEMOSTRACIÓN (número de prueba)" : "normal"}</b></p>
<h2>Número configurado</h2><table>
${fila("Número", n.display_phone_number || "—")}${fila("Nombre verificado", n.verified_name || "—")}
${fila("Plataforma", n.platform_type || "—")}${fila("Calidad", n.quality_rating || "—")}
${fila("Es número de prueba de Meta", demo.esNumeroDePrueba(n.display_phone_number) ? "sí" : "no")}
</table>
<h2>A dónde van los webhooks de este número</h2><table>
${fila("Desvío del número", wc.phone_number || "—")}${fila("Desvío de la cuenta (WABA)", wc.whatsapp_business_account || "—")}
${fila("URL general de la app", wc.application || "—")}${fila("Este servidor", cfg.urlPublica ? cfg.urlPublica + "/webhook" : "desconocida")}
</table>
<h2>Cuenta de WhatsApp (WABA)</h2>
<table><tr><th>Números de la cuenta</th><th>Tipo</th></tr>
${numeros.map(x => `<tr><td>${esc(x.display_phone_number)} — ${esc(x.verified_name || "")}</td><td>${demo.esNumeroDePrueba(x.display_phone_number) ? "prueba" : "<span class=mal>REAL</span>"}</td></tr>`).join("") || "<tr><td colspan=2>—</td></tr>"}
</table>
<table><tr><th>Apps suscritas a la cuenta</th><th>Desvío</th></tr>
${apps.map(a => { const d = a.whatsapp_business_api_data || a; return `<tr><td>${esc(d.name || d.id || "app")}</td><td>${esc(a.override_callback_uri || "sin desvío (URL general de la app)")}</td></tr>`; }).join("") || "<tr><td colspan=2>Ninguna</td></tr>"}
</table>
<h2>Comprobación de aislamiento</h2><ul>
${checks.map(c => `<li class="${c.ok ? "ok" : "mal"}">${c.ok ? "✔" : "✘"} ${esc(c.texto)}</li>`).join("")}
</ul>
${diag.errores.length ? `<p class=mal>Errores de Meta:</p><ul>${diag.errores.map(e => `<li>${esc(e)}</li>`).join("")}</ul>` : ""}
<h2>Acciones</h2>
<form method="post" action="/admin/whatsapp/suscribir">
${demo.MODO_DEMO ? "" : `<label><input type="checkbox" name="confirmar" value="si"> Confirmo que esta cuenta debe enviar sus mensajes a este servidor</label><br>`}
<button type="submit" ${seguro ? "" : "disabled"}>Suscribir la app a esta cuenta con desvío a este servidor</button>
${seguro ? "" : "<br><small>Desactivado: no se cumplen todas las comprobaciones.</small>"}
</form>
<form method="post" action="/admin/whatsapp/desuscribir"><button type="submit">Quitar la suscripción de la app a esta cuenta</button></form>
<p><small>Ninguna de estas acciones cambia la URL general del webhook de la app.</small></p>`));
  });

  app.post("/admin/whatsapp/suscribir", requiereAdmin, async (req, res) => {
    const cfg = datosConfig();
    if (!demo.MODO_DEMO && (req.body && req.body.confirmar) !== "si") {
      return res.redirect("/admin/whatsapp?r=" + encodeURIComponent("Marque la confirmación para continuar."));
    }
    const diag = await meta.diagnostico(cfg);
    const { seguro } = evaluarAislamiento(diag, cfg);
    if (!seguro) {
      return res.redirect("/admin/whatsapp?r=" + encodeURIComponent("No se suscribió: no se cumplen las comprobaciones de aislamiento."));
    }
    try {
      await meta.suscribirConDesvio({ token: cfg.token, wabaId: cfg.wabaId, urlWebhook: cfg.urlPublica + "/webhook", verifyToken: cfg.verifyToken });
      console.log("🔗 Panel: app suscrita a la WABA con desvío a este servidor");
      res.redirect("/admin/whatsapp?r=" + encodeURIComponent("Suscripción hecha. Compruebe arriba que el desvío apunta a este servidor ANTES de enviar mensajes."));
    } catch (e) {
      console.error("Panel: no se pudo suscribir:", e.message);
      res.redirect("/admin/whatsapp?r=" + encodeURIComponent("Error de Meta: " + e.message));
    }
  });

  app.post("/admin/whatsapp/desuscribir", requiereAdmin, async (req, res) => {
    const cfg = datosConfig();
    try {
      await meta.desuscribir({ token: cfg.token, wabaId: cfg.wabaId });
      console.log("🔌 Panel: suscripción de la app a la WABA eliminada");
      res.redirect("/admin/whatsapp?r=" + encodeURIComponent("Suscripción eliminada."));
    } catch (e) {
      res.redirect("/admin/whatsapp?r=" + encodeURIComponent("Error de Meta: " + e.message));
    }
  });
}

module.exports = { registrarRutas, requiereAdmin, evaluarAislamiento, _sesiones: sesiones };
