# Servicio `bot-consultorio-demo`: creación, conexión y prueba real

Este documento reemplaza la parte operativa de `DEMO-VERIFICACION-Y-ENTORNO.md`.
Commit a desplegar: el que se indique en `INFORME-EJECUTIVO.md` (rama `ccr-aa25d197-be722x`).

## Por qué conectar la demo no afecta a producción
- Según su consulta, la WABA de prueba (1472438634813201) **no tiene ninguna app suscrita** (`subscribed_apps` → `{"data":[]}`). Hoy los mensajes al número de prueba **no llegan a ningún servidor**, tampoco a producción.
- La demo se conecta con **`POST /1472438634813201/subscribed_apps` con `override_callback_uri`**. Es un **desvío a nivel de WABA** documentado por Meta: los eventos de **esa** WABA van a la demo, y la **URL general del webhook de la app (la de producción) no cambia**.
- El panel `/admin/whatsapp` de la demo **se niega a suscribir** si la WABA tiene algún número que no sea de prueba (+1 555), si el `PHONE_NUMBER_ID` no pertenece a esa WABA o si la URL pública no es HTTPS.
- **Riesgo residual:** si Meta ignorara el desvío, los eventos del número de prueba irían a la URL general (producción, código viejo y calendario real). Por eso el paso 4.3 obliga a **comprobar el desvío antes de enviar cualquier mensaje** y, si no aparece, a quitar la suscripción de inmediato.

## 1. Preparación en Google (unos 15 minutos)
1. **Un calendario nuevo** en Google Calendar (Otros calendarios → + → Crear calendario): `Demo bot (pruebas)`. Sirve para las citas ficticias **y** para el registro de estado. Está comprobado que los registros de estado no cuentan como citas ni ocupan horario.
2. **Cuenta de servicio nueva** `bot-demo` en Google Cloud (IAM → Cuentas de servicio). Sin roles. Claves → Agregar clave → JSON.
3. **Compartir el calendario** con el correo de `bot-demo`, con permiso "Hacer cambios en los eventos".
4. Copiar su **ID** (Configuración → Integrar calendario). Debe terminar en `@group.calendar.google.com`. Va en `CALENDAR_ID`, `CALENDARS_BUSY` y `ESTADO_CALENDAR_ID`.
5. **Comprobación obligatoria:** en `internista.marco@gmail.com` → Configuración → Compartir con personas específicas, `bot-demo` **no** debe aparecer.

## 2. Preparación en OpenAI y Meta (5 minutos)
1. **OpenAI:** platform.openai.com → API keys → nueva clave `demo-meta`.
2. **Meta (WhatsApp → Configuración de la API):** agregue y verifique los teléfonos "Paciente demo" y "Equipo" en la lista "Para".
3. **Meta (Configuración de la API):** genere el **token temporal**. Dura unas 24 horas, así que genérelo el mismo día de la prueba.

## 3. Crear el servicio en Render (10 minutos)
1. **New → Web Service** → repositorio `marcosorcia1990-ship-it/Bot-Consultorio` → rama `ccr-aa25d197-be722x`.
2. **Nombre:** `bot-consultorio-demo`. **Build:** `npm install`. **Start:** `npm start`. **Plan:** gratuito.
3. **Settings → Auto-Deploy: No.**
4. **Environment:** copie las variables de `.env.demo.example` y llene los valores entre `<>`.
5. **Deploy.** En **Logs** deben aparecer, en este orden:
   - `Datos de salud a la IA: BLOQUEADOS 🛡️`
   - `🧪 MODO DEMO: número de origen verificado como número de prueba (+1 555 …)`
   - `💾 Estado persistente activo: 0 chat(s)…`

   Si aparece `⛔ MODO DEMO`, el servidor se detuvo a propósito. El log dice por qué; corrija la variable indicada.
6. En **Events**, compruebe que el commit desplegado es el indicado.

## 4. Conectar el número de prueba (sin tocar el webhook de la app)
1. Abra `https://<servicio>.onrender.com/admin/whatsapp` → contraseña `ADMIN_TOKEN`.
2. **Revise la pantalla:**
   - Número: +1 555 184 4654, "Es número de prueba: sí".
   - Números de la cuenta: solo uno, marcado "prueba".
   - Apps suscritas: "Ninguna".
   - Todas las comprobaciones en verde.
3. Pulse **"Suscribir la app a esta cuenta con desvío a este servidor"**. Al recargar, compruebe **antes de enviar ningún mensaje**:
   - en "Apps suscritas", el desvío debe ser `https://<servicio>.onrender.com/webhook`;
   - en "A dónde van los webhooks", "Desvío de la cuenta (WABA)" debe mostrar la misma URL.
   - **Si no aparece el desvío: pulse "Quitar la suscripción" y avíseme.** No envíe mensajes.
4. En los logs de la demo debe aparecer `✅ Webhook verificado por Meta`, porque Meta comprueba la URL del desvío.

## 5. Prueba real mínima (y grabación en la misma sesión)
Entre julio y agosto ya quedó comprobado en real que el bot agenda, reprograma, cancela, consulta Google Calendar y envía plantillas (`docs/EVIDENCIA-JULIO-AGOSTO-2026.md`). Ese código (`tools.js` y el núcleo de `calendar.js`) **no cambió**, así que **no se repite**. Solo se prueba lo nuevo o lo modificado.

| # | Qué se prueba (y por qué) | Acción | Resultado esperado |
|---|---|---|---|
| P1 | Desvío por WABA (nuevo) | Paso 4 completo | El desvío aparece en el panel y Meta verifica la URL |
| P2 | Flujo de mensajes reescrito + aviso simplificado | "Paciente demo": "Hola, ¿cuánto cuesta la consulta?" | Aviso + costos; en los logs `📩` y `💬` sin texto |
| P3 | Agenda con el flujo nuevo y la validación de nombre | "Quiero agendar una cita" → primera vez, medicina interna → horario → "Juan Prueba Demo, a este mismo número" | CITA CONFIRMADA y el evento en el calendario de demo |
| P4 | Filtro clínico y alerta al equipo (nunca probada en real) | Antes, "Equipo" escribe "hola" (abre la ventana de 24 h). Luego "Paciente demo": "Tengo fiebre, ¿qué medicamento puedo tomar?" | Texto fijo sin IA y alerta en "Equipo" |
| P5 | Candado de remitentes (nuevo) | Un tercer teléfono que no esté en la lista: "Hola" | Sin respuesta; log `⛔ … descartado` |
| P6 | Estado persistente tras reiniciar (nuevo) | Render → Restart | Vuelven las 3 líneas del paso 3.5, incluida `💾 Estado persistente activo` |

**Para no hacer dos veces el trabajo:** haga P1 a P6 una vez sin grabar. Si todo sale bien, **grabe en la misma sesión** P2 a P4 para el video de `whatsapp_business_messaging`, y el panel (P1) para `whatsapp_business_management` (guiones en `docs/META-REVISION-PERMISOS.md`).

**No se repite:** reprogramar, cancelar ni buscar por nombre (código sin cambios y comprobado en julio). Si quiere más seguridad, una reprogramación más toma 1 minuto.

**No se puede probar aquí:** los ecos de coexistence y la plantilla de confirmación con botones. Se prueban después de conectar el número real, en el **modo sombra** (`docs/COEXISTENCIA-PRODUCCION.md`).

## 6. Al terminar o ante cualquier duda
- **Desconectar la demo:** `/admin/whatsapp` → "Quitar la suscripción". El número de prueba deja de enviar eventos a la demo.
- **Apagar:** Render → `bot-consultorio-demo` → Settings → Suspend.
- **Revocar:** la clave `demo-meta` de OpenAI y la clave JSON de `bot-demo`.
