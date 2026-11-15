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

## 5. Prueba real: una sola conversación (es también el video)
Desde el teléfono "Paciente demo", con la grabación de pantalla encendida:
1. `Hola, ¿cuánto cuesta la consulta?` → llegan el aviso de privacidad y los costos (**recibe y responde**).
2. `Quiero agendar una cita` → `Es mi primera vez, consulta de medicina interna` → elija un horario → `Juan Prueba Demo, a este mismo número` → confirme → **CITA CONFIRMADA**.
3. Abra Google Calendar (solo "Demo bot (pruebas)") y muestre el evento creado (**agenda correctamente**).

Haga una pasada sin grabar y luego la grabada. Lo demás (filtro de salud, candados, ecos, duplicados, reinicios) lo cubren las 84 pruebas automáticas.

## 6. Al terminar o ante cualquier duda
- **Desconectar la demo:** `/admin/whatsapp` → "Quitar la suscripción". El número de prueba deja de enviar eventos a la demo.
- **Apagar:** Render → `bot-consultorio-demo` → Settings → Suspend.
- **Revocar:** la clave `demo-meta` de OpenAI y la clave JSON de `bot-demo`.
