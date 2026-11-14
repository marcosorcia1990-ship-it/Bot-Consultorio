const { test } = require("node:test");
const assert = require("node:assert");
const p = require("../privacidad");

// Mensajes administrativos reales que el bot DEBE seguir atendiendo
const ADMINISTRATIVOS = [
  "Hola, quiero agendar una cita",
  "¿Cuánto cuesta la consulta?",
  "Necesito una valoración preoperatoria",
  "Quiero cambiar mi cita porque aún no tengo mis resultados de laboratorio",
  "¿Dónde está el consultorio?",
  "¿Qué estudios debo llevar?",
  "¿La consulta es de medicina interna?",
  "Me llamo Alma Andrade",
  "Sí, confirmo",
  "¿Tienen espacio el 25/11 a las 10:30?",
  "Le envío mis datos para la factura",
  "Disculpe la molestia, ¿atienden el sábado?",
  "Buenas tardes Dr. Marco"
];

// Mensajes con información de salud que NO deben llegar a la IA
const CLINICOS = [
  "Tengo dolor de cabeza desde ayer",
  "mi glucosa salió en 250",
  "Me diagnosticaron diabetes el año pasado",
  "¿Puedo tomar metformina con alcohol?",
  "Tengo la presión alta",
  "Tengo fiebre y tos",
  "Mi colesterol salió alto",
  "Me recetaron un antibiótico y me cayó mal",
  "Estoy embarazada, ¿me puede atender?",
  "Me van a operar de la vesícula",
  "Mis triglicéridos están en 400 mg/dl",
  "Sufro de migraña"
];

test("no bloquea mensajes administrativos", () => {
  for (const m of ADMINISTRATIVOS) {
    assert.strictEqual(p.contieneInformacionClinica(m), false, `bloqueó por error: "${m}"`);
  }
});

test("detecta información clínica", () => {
  for (const m of CLINICOS) {
    assert.strictEqual(p.contieneInformacionClinica(m), true, `no detectó: "${m}"`);
  }
});

test("detecta urgencias", () => {
  for (const m of ["Me duele el pecho", "No puedo respirar", "Mi papá se desmayó", "Es una emergencia"]) {
    assert.strictEqual(p.esUrgencia(m), true, m);
  }
  assert.strictEqual(p.esUrgencia("Quiero una cita"), false);
});

test("detecta solicitudes ARCO sin confundir con datos de facturación", () => {
  for (const m of ["Quiero eliminar mis datos", "Borren mis datos personales", "¿Dónde está su aviso de privacidad?", "Quiero revocar mi consentimiento"]) {
    assert.strictEqual(p.esSolicitudPrivacidad(m), true, m);
  }
  for (const m of ["Le envío mis datos para la factura", "Mis datos son Alma Andrade", "Hola Marco"]) {
    assert.strictEqual(p.esSolicitudPrivacidad(m), false, m);
  }
});

test("detecta la baja de mensajes automáticos", () => {
  for (const m of ["BAJA", "baja", "Ya no me envíen mensajes", "No quiero recibir recordatorios"]) {
    assert.strictEqual(p.esBaja(m), true, m);
  }
  for (const m of ["La presión se me baja", "Quiero una cita"]) {
    assert.strictEqual(p.esBaja(m), false, m);
  }
});

test("el seudónimo es estable, no contiene el número y no distingue el formato 521/52", () => {
  const a = p.idPaciente("5212711234567");
  const b = p.idPaciente("522711234567");
  assert.strictEqual(a, b);
  assert.match(a, /^p-[0-9a-f]{8}$/);
  assert.ok(!a.includes("4567"));
  assert.notStrictEqual(a, p.idPaciente("5212719999999"));
});

test("sanitizarLog quita números de teléfono de los errores", () => {
  const r = p.sanitizarLog('{"error":"Recipient +52 271 123 4567 not allowed"}');
  assert.ok(!/4567/.test(r));
  assert.match(r, /\[número\]/);
});

test("purga: elimina conversaciones con más de 24 h sin actividad, salvo las tomadas por el equipo", () => {
  const ahora = 10 * p.HISTORIAL_TTL_MS;
  const chats = new Map([
    ["vieja", { lastActivity: ahora - p.HISTORIAL_TTL_MS - 1, humanUntil: 0, history: [{}] }],
    ["reciente", { lastActivity: ahora - 1000, humanUntil: 0, history: [{}] }],
    ["humano", { lastActivity: ahora - p.HISTORIAL_TTL_MS - 1, humanUntil: ahora + 1000, history: [] }]
  ]);
  assert.strictEqual(p.purgarConversacionesInactivas(chats, ahora), 1);
  assert.deepStrictEqual([...chats.keys()].sort(), ["humano", "reciente"]);
});

test("por omisión NO se permiten datos de salud en la IA", () => {
  assert.strictEqual(p.PERMITIR_DATOS_SENSIBLES_IA, false);
});

test("el aviso simplificado incluye responsable, finalidad, baja y enlace al aviso integral", () => {
  const a = p.MENSAJES.avisoSimplificado;
  assert.match(a, /MARCO ANTONIO MIXTECO SORCIA/);
  assert.match(a, /administrar la agenda/);
  assert.match(a, /BAJA/);
  assert.match(a, /https:\/\/internistamarco\.com\/privacidad/);
});
