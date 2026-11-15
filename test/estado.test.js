const { test } = require("node:test");
const assert = require("node:assert");
const { crearEstado } = require("../estado");
const numeros = require("../numeros");

// Calendario simulado que guarda eventos y respeta timeMin/timeMax y propiedades privadas
function calendarioFalso({ fallarLectura = false } = {}) {
  const eventos = [];
  let n = 0;
  const coincide = (e, p) => {
    const priv = (e.extendedProperties && e.extendedProperties.private) || {};
    const filtros = [].concat(p.privateExtendedProperty || []);
    if (!filtros.every(f => { const [k, v] = f.split("="); return priv[k] === v; })) return false;
    const fin = Date.parse(e.end.dateTime), ini = Date.parse(e.start.dateTime);
    if (p.timeMin && fin <= Date.parse(p.timeMin)) return false;
    if (p.timeMax && ini >= Date.parse(p.timeMax)) return false;
    return true;
  };
  return {
    eventos,
    events: {
      async list(p) { if (fallarLectura) throw new Error("Google no responde"); return { data: { items: eventos.filter(e => coincide(e, p)) } }; },
      async insert({ requestBody }) { const e = { id: "e" + (++n), ...JSON.parse(JSON.stringify(requestBody)) }; eventos.push(e); return { data: e }; },
      async patch({ eventId, requestBody }) { const e = eventos.find(x => x.id === eventId); Object.assign(e, requestBody); return { data: e }; },
      async delete({ eventId }) { eventos.splice(eventos.findIndex(x => x.id === eventId), 1); return {}; }
    }
  };
}

const H = 60 * 60 * 1000;

test("numeros: normalización de números mexicanos", () => {
  assert.strictEqual(numeros.aDestinoWhatsApp("5212711234567"), "522711234567");
  assert.strictEqual(numeros.aDestinoWhatsApp("522711234567"), "522711234567");
  assert.strictEqual(numeros.aDestinoWhatsApp("2711234567"), "522711234567");
  assert.strictEqual(numeros.aDestinoWhatsApp("+52 1 271 123 4567"), "522711234567");
  assert.strictEqual(numeros.aDestinoWhatsApp("15551844654"), "15551844654");
  assert.strictEqual(numeros.clave10("5212711234567"), numeros.clave10("522711234567"));
});

test("estado en memoria: marca y expira", async () => {
  let t = 1_000_000;
  const e = crearEstado({ ahora: () => t });
  assert.strictEqual(e.persistente, false);
  await e.marcarHumano("522711234567", t, t + H);
  assert.strictEqual(await e.enManosHumanas("5212711234567"), true, "521 y 52 son el mismo chat");
  t += 2 * H;
  assert.strictEqual(await e.enManosHumanas("5212711234567"), false);
});

test("estado persistente: sobrevive a un reinicio (instancia nueva, mismo calendario)", async () => {
  const t = Date.parse("2026-11-15T18:00:00Z");
  const cal = calendarioFalso();
  const antes = crearEstado({ calendario: cal, calendarId: "estado@group.calendar.google.com", sal: "s", ahora: () => t });
  await antes.marcarHumano("522711234567", t, t + 24 * H);

  // "Reinicio": se pierde la memoria; queda el calendario
  const despues = crearEstado({ calendario: cal, calendarId: "estado@group.calendar.google.com", sal: "s", ahora: () => t + H });
  assert.strictEqual(await despues.recuperar(), 1);
  assert.strictEqual(await despues.enManosHumanas("5212711234567"), true);
  assert.strictEqual(await despues.enManosHumanas("5212719999999"), false);
});

test("estado persistente: consulta el calendario aunque no se haya recuperado al arrancar", async () => {
  const t = Date.parse("2026-11-15T18:00:00Z");
  const cal = calendarioFalso();
  await crearEstado({ calendario: cal, calendarId: "x", sal: "s", ahora: () => t }).marcarHumano("2711234567", t, t + H);
  const otra = crearEstado({ calendario: cal, calendarId: "x", sal: "s", ahora: () => t + 1000 });
  assert.strictEqual(await otra.enManosHumanas("2711234567"), true);
});

test("estado persistente: no guarda el número, solo un HMAC", async () => {
  const t = Date.now();
  const cal = calendarioFalso();
  await crearEstado({ calendario: cal, calendarId: "x", sal: "s" }).marcarHumano("5212711234567", t, t + H);
  const texto = JSON.stringify(cal.eventos);
  assert.ok(!texto.includes("2711234567"));
  assert.ok(!texto.includes("1234567"));
});

test("estado persistente: intervenciones repetidas extienden el mismo registro", async () => {
  const t = Date.parse("2026-11-15T18:00:00Z");
  const cal = calendarioFalso();
  const e = crearEstado({ calendario: cal, calendarId: "x", sal: "s", ahora: () => t });
  await e.marcarHumano("2711234567", t, t + H);
  await e.marcarHumano("2711234567", t, t + 3 * H);
  assert.strictEqual(cal.eventos.length, 1);
  assert.strictEqual(Date.parse(cal.eventos[0].end.dateTime), t + 3 * H);
});

test("estado persistente: si Google falla, el bot calla por precaución", async () => {
  const e = crearEstado({ calendario: calendarioFalso({ fallarLectura: true }), calendarId: "x", sal: "s" });
  assert.strictEqual(await e.enManosHumanas("2711234567"), true);
});

test("estado persistente: depurar borra los registros vencidos", async () => {
  const t = Date.parse("2026-11-15T18:00:00Z");
  const cal = calendarioFalso();
  const e = crearEstado({ calendario: cal, calendarId: "x", sal: "s", ahora: () => t });
  await e.marcarHumano("2711111111", t - 72 * H, t - 48 * H); // vencido hace 2 días
  await e.marcarHumano("2712222222", t, t + H);               // vigente
  assert.strictEqual(await e.depurar(), 1);
  assert.strictEqual(cal.eventos.length, 1);
});
