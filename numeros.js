// ============================================================
// Normalización de números de teléfono (México y otros)
// WhatsApp entrega los números mexicanos como 521XXXXXXXXXX (con el "1" histórico de
// celulares), pero en los ecos de la app y al enviar se usan como 52XXXXXXXXXX.
// Regla única para todo el bot:
//   - clave10():        últimos 10 dígitos, para comparar e identificar chats.
//   - aDestinoWhatsApp(): formato para enviar por la API.
// ============================================================

function soloDigitos(n) {
  return String(n || "").replace(/\D/g, "");
}

function clave10(n) {
  return soloDigitos(n).slice(-10);
}

function aDestinoWhatsApp(n) {
  let d = soloDigitos(n);
  if (d.startsWith("521") && d.length === 13) d = "52" + d.slice(3); // celular MX con "1"
  else if (d.length === 10) d = "52" + d;                            // número nacional MX
  return d;
}

module.exports = { soloDigitos, clave10, aDestinoWhatsApp };
