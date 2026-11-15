// Se precarga con `node --import` en las pruebas del servidor: reemplaza fetch para que
// ninguna llamada salga a Meta ni a OpenAI, y registra cada llamada en MOCK_LOG.
import fs from "node:fs";

const LOG = process.env.MOCK_LOG;

function registrar(entrada) {
  fs.appendFileSync(LOG, JSON.stringify(entrada) + "\n");
}

function respuesta(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}

globalThis.fetch = async (url, opciones = {}) => {
  const u = String(url);
  let cuerpo = null;
  if (typeof opciones.body === "string") {
    try { cuerpo = JSON.parse(opciones.body); } catch { cuerpo = opciones.body; }
  } else if (opciones.body) {
    cuerpo = "(binario/formulario)";
  }

  if (u.includes("graph.facebook.com") && u.endsWith("/messages")) {
    registrar({ destino: "whatsapp_envio", cuerpo });
    return respuesta({ messages: [{ id: "wamid.prueba" }] });
  }
  // API de gestión (WABA): números y apps suscritas
  if (u.includes("graph.facebook.com") && u.includes("/phone_numbers")) {
    registrar({ destino: "meta_waba_numeros" });
    const nums = process.env.MOCK_WABA_NUMS
      ? JSON.parse(process.env.MOCK_WABA_NUMS)
      : [{ id: process.env.PHONE_NUMBER_ID || "123", display_phone_number: "+1 555-184-4654", verified_name: "Test Number" }];
    return respuesta({ data: nums });
  }
  if (u.includes("graph.facebook.com") && u.includes("/subscribed_apps")) {
    const metodo = (opciones.method || "GET").toUpperCase();
    registrar({ destino: "meta_subscribed_apps", metodo, cuerpo });
    return metodo === "GET" ? respuesta({ data: [] }) : respuesta({ success: true });
  }
  if (u.includes("graph.facebook.com") && u.includes("fields=display_phone_number")) {
    registrar({ destino: "whatsapp_consulta_numero" });
    return respuesta({
      display_phone_number: process.env.MOCK_DISPLAY || "+1 555-184-4654", id: "123",
      verified_name: "Test Number", webhook_configuration: { application: "https://produccion.ejemplo/webhook" }
    });
  }
  if (u.includes("graph.facebook.com")) {
    registrar({ destino: "whatsapp_media", url: u });
    return respuesta({ url: "https://lookaside.prueba/audio", mime_type: "audio/ogg" });
  }
  if (u.includes("lookaside.prueba")) {
    registrar({ destino: "whatsapp_descarga", url: u });
    return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
  }
  if (u.includes("api.openai.com/v1/chat/completions")) {
    registrar({ destino: "openai_chat", cuerpo });
    const ultimo = JSON.stringify((cuerpo && cuerpo.messages || []).slice(-1));
    const contenido = ultimo.includes("estacionamiento")
      ? "Gracias por su mensaje. En breve le respondemos personalmente por este medio. [AVISAR_EQUIPO]"
      : "Con gusto le ayudamos con su cita.";
    return respuesta({ choices: [{ message: { role: "assistant", content: contenido } }] });
  }
  if (u.includes("api.openai.com/v1/audio/transcriptions")) {
    registrar({ destino: "openai_transcripcion" });
    return respuesta({ text: "quiero una cita" });
  }
  registrar({ destino: "otro", url: u });
  return respuesta({ error: "no simulado" }, 404);
};
