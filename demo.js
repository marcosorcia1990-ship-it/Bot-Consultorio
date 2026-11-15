// ============================================================
// Modo demostración (MODO_DEMO=true) — candados para el servidor bot-consultorio-demo.
// Garantizan, aunque alguna variable se configure mal, que la demo:
//   1. no use un calendario principal (como el Gmail del consultorio): solo calendarios
//      secundarios creados para la demo (…@group.calendar.google.com);
//   2. no envíe recordatorios automáticos;
//   3. solo envíe desde un número de prueba de Meta (+1 555…), comprobado al arrancar;
//   4. solo envíe mensajes a los teléfonos de prueba de DEMO_DESTINATARIOS.
// Si algo no cumple, el servidor NO arranca o NO envía.
// ============================================================

const MODO_DEMO = String(process.env.MODO_DEMO || "").trim().toLowerCase() === "true";

function ultimos10(n) {
  return String(n || "").replace(/\D/g, "").slice(-10);
}

function destinatariosPermitidos(env = process.env) {
  return String(env.DEMO_DESTINATARIOS || "").split(",").map(ultimos10).filter(x => x.length === 10);
}

// Revisa la configuración. Devuelve la lista de problemas (vacía = todo bien).
function validarConfiguracionDemo(env = process.env) {
  const errores = [];
  const calendarios = [env.CALENDAR_ID, ...String(env.CALENDARS_BUSY || "").split(",")]
    .map(c => String(c || "").trim()).filter(Boolean);

  if (String(env.AGENDA_ACTIVA || "").trim().toLowerCase() === "true") {
    if (!env.CALENDAR_ID) errores.push("Falta CALENDAR_ID (calendario de demo).");
    for (const c of calendarios) {
      if (!c.endsWith("@group.calendar.google.com")) {
        errores.push(`El calendario "${c}" no es un calendario secundario de demo (debe terminar en @group.calendar.google.com).`);
      }
    }
  }
  const prohibidos = String(env.CALENDARIOS_PROHIBIDOS || "").split(",").map(c => c.trim()).filter(Boolean);
  for (const c of calendarios) if (prohibidos.includes(c)) errores.push(`El calendario "${c}" está en CALENDARIOS_PROHIBIDOS.`);

  if (String(env.RECORDATORIOS_ACTIVOS || "").trim().toLowerCase() === "true") {
    errores.push("RECORDATORIOS_ACTIVOS debe estar apagado en la demo.");
  }
  if (!destinatariosPermitidos(env).length) {
    errores.push("Falta DEMO_DESTINATARIOS (los teléfonos de prueba, separados por comas).");
  }
  if (!env.PHONE_NUMBER_ID) errores.push("Falta PHONE_NUMBER_ID (el del número de prueba).");
  return errores;
}

// Los números de prueba que da Meta son +1 555 XXX XXXX
function esNumeroDePrueba(displayPhoneNumber) {
  const d = String(displayPhoneNumber || "").replace(/\D/g, "");
  return d.length === 11 && d.startsWith("1555");
}

function destinoPermitido(numero, env = process.env) {
  return destinatariosPermitidos(env).includes(ultimos10(numero));
}

module.exports = { MODO_DEMO, validarConfiguracionDemo, esNumeroDePrueba, destinoPermitido, destinatariosPermitidos };
