> **Documento reemplazado** (15 de noviembre de 2026). Para la operación vigente ver `docs/RENDER-DEMO.md`, `docs/META-REVISION-PERMISOS.md`, `docs/COEXISTENCIA-PRODUCCION.md` e `INFORME-EJECUTIVO.md`. Se conserva como historial.

# Video para la revisión de Meta: permiso `whatsapp_business_messaging`

Objetivo: grabar el funcionamiento real del bot con el **número de prueba de WhatsApp Cloud API**,
con datos ficticios, sin mostrar pacientes, tokens ni credenciales, y **sin tocar el número
real del consultorio**.

---

## Parte 0. Comprobaciones de seguridad (NO se graban)

### 0.1 Que el número real no esté conectado a esta app
En developers.facebook.com → app **Bot Consultorio DrMixteco** → **WhatsApp → Configuración de la API**
(API Setup), abra la lista **"De" (From)**.
- Si solo aparece el **número de prueba** ("Test number", con un número +1 555…): continúe.
- **Si aparece el número del consultorio (271 116 1448): DETÉNGASE** y no cambie nada. Cambiar el webhook de la app podría desviar los mensajes del número real. Hay que resolverlo antes.

### 0.2 No tocar el servicio actual de Render
El bot responde **siempre** desde el número configurado en `PHONE_NUMBER_ID`. Por eso la demo
corre en un **servicio nuevo e independiente**. El servicio que ya existe no se modifica.

---

## Parte 1. Preparación (NO se graba, unos 45 minutos)

### 1.1 Dos teléfonos de prueba
El entorno de prueba solo envía mensajes a números verificados (máximo 5). Necesita dos:
- **Teléfono "Paciente demo":** un teléfono **sin chats de pacientes**, por ejemplo un celular personal de la familia. Aquí se verá la conversación.
- **Teléfono "Equipo":** otro teléfono que hará de recepción y recibirá las alertas.

En **Configuración de la API → Para (To) → Administrar lista de números**, agregue los dos y
verifíquelos con el código que les llega. Esta pantalla muestra los números: **no la grabe.**

### 1.2 Calendario de demostración
1. En Google Calendar, cree un calendario nuevo llamado **"Demo bot (pruebas)"**.
2. En su configuración → **Compartir con personas específicas** → agregue el correo de la cuenta de servicio (el que aparece en `GOOGLE_CREDENTIALS_JSON` como `client_email`) con permiso **"Hacer cambios en los eventos"**.
3. En **Integrar calendario**, copie el **ID del calendario**.
4. **No use** el calendario real del consultorio.

### 1.3 Servicio de demostración en Render
En Render → **New → Web Service** → el mismo repositorio:
- **Nombre:** `bot-consultorio-demo`
- **Rama:** `ccr-aa25d197-be722x`, la que tiene los cambios de privacidad y el aviso simplificado.
- **Comando de inicio:** `npm start`
- **Variables de entorno:**

| Variable | Valor |
|---|---|
| `PHONE_NUMBER_ID` | El **identificador del número de prueba** (Configuración de la API, debajo de "De") |
| `WHATSAPP_TOKEN` | El token temporal de Configuración de la API (dura 24 h; genérelo el mismo día de la grabación) |
| `VERIFY_TOKEN` | Una palabra nueva inventada solo para la demo |
| `OPENAI_API_KEY` | La clave de OpenAI |
| `GOOGLE_CREDENTIALS_JSON` | La misma de la cuenta de servicio |
| `CALENDAR_ID` y `CALENDARS_BUSY` | El ID del calendario **"Demo bot (pruebas)"** (en las dos) |
| `AGENDA_ACTIVA` | `true` |
| `RECORDATORIOS_ACTIVOS` | `false` |
| `INTERNAL_ALERT_NUMBER` | El número del teléfono **"Equipo"**, con 52 y 10 dígitos |
| `PERSONAL_NUMBERS` | El mismo número del teléfono **"Equipo"**, para que el bot no le conteste como si fuera paciente |
| `LOG_SALT` | Una cadena aleatoria |

No defina `PERMITIR_DATOS_SENSIBLES_IA` ni `RESENAS_ACTIVAS`.

### 1.4 Webhook hacia el servicio de demostración
Solo si la comprobación 0.1 salió bien:
1. Vaya a **WhatsApp → Configuración → Webhook → Editar**.
2. **URL de devolución de llamada:** `https://bot-consultorio-demo.onrender.com/webhook` (use la dirección real que le dé Render).
3. **Token de verificación:** el `VERIFY_TOKEN` de la demo. Pulse **Verificar y guardar**.
4. En **Campos del webhook**, suscriba **`messages`**.

Anote la URL anterior para restaurarla al terminar (parte 4).

### 1.5 Abrir la ventana de 24 horas del teléfono "Equipo"
Desde el teléfono "Equipo", envíe "hola" al número de prueba. El bot no le contesta, porque es
un número protegido, pero así se abre la ventana de 24 horas para que pueda recibir alertas.

### 1.6 Ensayo completo
Haga **todo el guion de la parte 3 al menos una vez sin grabar**. Las respuestas de la IA varían un
poco entre intentos. Después, en Google Calendar, borre la cita de ensayo del calendario de demo.

### 1.7 Limpiar la pantalla
- **Oculte la barra de marcadores del navegador** (Ctrl + Shift + B). En sus capturas aparecen "Expediente Clínico", "HISTORIAS CLÍNICAS" y otros.
- Cierre las pestañas de WhatsApp Business Web, Gmail, Hostinger y Render (Environment).
- Active **"No molestar"** en Windows y en los dos teléfonos, para que no aparezcan notificaciones de pacientes reales.
- En el teléfono "Paciente demo", deje abierto **solo el chat con el número de prueba** antes de empezar a grabar, para que no se vea la lista de chats.

### 1.8 Cómo grabar
- **Computadora:** Barra de juegos de Windows (Win + Alt + R) u OBS.
- **Teléfonos:** la grabación de pantalla integrada de Android o iPhone.
- **Unir los clips:** Clipchamp, que viene con Windows. Ahí agregue los subtítulos y tape con un rectángulo lo indicado en la parte 3.
- Los subtítulos conviene ponerlos **en inglés** (los revisores de Meta pueden no hablar español), con la traducción entre paréntesis si quiere.

---

## Parte 2. Qué NO debe aparecer nunca en el video
- Tokens: el campo **"Token de acceso temporal"** de Configuración de la API, el `VERIFY_TOKEN` y la pestaña Environment de Render.
- Los números de los teléfonos de prueba: la lista "Para (To)" y la línea `Chat: +52…` de la alerta (táchela en la edición).
- Cualquier chat, nombre o cita de pacientes reales, y el calendario real del consultorio.
- Las claves de OpenAI o de Google.

---

## Parte 3. Guion de grabación (en este orden)

### Escena 1: La app y su conexión con WhatsApp (computadora, 20 s)
1. developers.facebook.com → app **Bot Consultorio DrMixteco** → **WhatsApp → Configuración**.
2. Muestre la **URL de devolución de llamada** y el campo **`messages` suscrito**. No haga clic en "Editar" mientras graba.
3. Subtítulo: *"Our app receives WhatsApp messages through the Cloud API webhook (messages field) and replies automatically with administrative information for a medical office."*

### Escena 2: Recepción de un mensaje y respuesta automática administrativa (teléfono "Paciente demo", 40 s)
1. Escriba: **`Hola, ¿cuánto cuesta la consulta?`**
2. Llegan dos mensajes del bot:
   - el **aviso de privacidad simplificado**;
   - la respuesta con **costos, horarios y ubicación**.
3. Subtítulo: *"A customer sends a message. The app receives it and sends an automatic administrative reply (prices and location). The first message includes a short privacy notice."*

### Escena 3 (opcional, 15 s): El servidor recibió el mensaje (computadora)
Render → servicio **bot-consultorio-demo** → **Logs** (no Environment). Se ven las líneas
`📩 Mensaje (text) de p-…` y `💬 Respuesta de la IA enviada…`. No muestran texto ni números.
Subtítulo: *"Server logs show the webhook event was received and processed (no personal data is logged)."*

### Escena 4: Solicitud de cita (teléfono "Paciente demo", 1 a 2 min)
Escriba, esperando cada respuesta:
1. **`Quiero agendar una cita`**. El bot pregunta si es la primera vez y el tipo de cita.
2. **`Es mi primera vez, consulta de medicina interna`**. El bot ofrece **horarios disponibles reales** del calendario de demo.
3. **`La primera opción, por favor`**. El bot pide nombre completo y teléfono.
4. **`Juan Prueba Demo, a este mismo número`**. El bot confirma los datos.
5. **`Sí, es correcto`**. Llega el mensaje **CITA CONFIRMADA**.

Si el bot hace las preguntas en otro orden, conteste con los mismos datos. Usted no dicta las
respuestas del bot: solo los mensajes del paciente.

Subtítulo: *"The customer requests an appointment. The app checks real availability and books it."*

### Escena 5: La cita creada (computadora, 15 s)
Google Calendar → muestre **solo el calendario "Demo bot (pruebas)"** (desmarque los demás).
Abra el evento **"Consulta – Juan Prueba Demo (1ª vez)"**.
Subtítulo: *"The appointment was created in the office calendar."*

### Escena 6: Intervención humana (los dos teléfonos, 40 s)
1. En el teléfono **"Paciente demo"** escriba: **`Tengo fiebre, ¿qué medicamento puedo tomar?`**
2. El bot **no responde la pregunta médica**: contesta con un texto fijo de que el personal le responderá personalmente.
3. En el teléfono **"Equipo"** llega la alerta **"🔔 Aviso del bot: Mensaje con posible información de salud, para respuesta personal…"**. **Tache la línea `Chat: +52…` en la edición.**
4. Subtítulo: *"Medical questions are never answered by the automated assistant. The app escalates the conversation to the office staff for a personal reply."*

### Escena 7: Cierre (5 s)
Subtítulo: *"In production, office staff reply personally from the WhatsApp Business app; the assistant stays silent in conversations taken over by a human."*

**Duración total:** de 3 a 4 minutos.

---

## Lo que NO se puede demostrar en el entorno de prueba (dígalo con honestidad)
- **La respuesta humana desde la app WhatsApp Business y el silencio del bot cuando el equipo toma el chat (coexistence).** El número de prueba pertenece a Meta y no se puede usar en la app WhatsApp Business, así que no se puede grabar a una persona contestando desde ese número. Por eso la escena 6 muestra la **escalada** al equipo, no la respuesta humana. Se aclara en el subtítulo de cierre y en el texto de la solicitud.
- **Los recordatorios automáticos** requieren plantillas aprobadas. Están apagados en la demo y no forman parte de este video.

---

## Parte 4. Al terminar (NO se graba)
1. Regrese la **URL del webhook** de la app a la que tenía antes (la que anotó en el paso 1.4), o déjela en la demo si Meta puede volver a probar. Decídalo según la respuesta de la comprobación 0.1.
2. En el servicio `bot-consultorio-demo`, borre la variable `WHATSAPP_TOKEN` o suspenda el servicio.
3. Borre la cita de "Juan Prueba Demo" del calendario de demo, o el calendario completo.

---

## Texto sugerido para el formulario de revisión
**How will your app use whatsapp_business_messaging?**

> Our app is the WhatsApp assistant of a single internal medicine practice in Mexico. It uses the WhatsApp Cloud API to receive messages from patients who write to the practice and to send replies on the practice's behalf. The assistant only handles administrative tasks: office information (prices, address, hours), booking, rescheduling and cancelling appointments in the practice's calendar, and appointment confirmations. It does not provide medical advice: messages containing health information or medical questions are not processed by the assistant and are escalated to the office staff, who reply personally. The first message of each conversation includes a short privacy notice with a link to the full privacy policy. The video shows: (1) the webhook configuration, (2) an incoming message and the automatic administrative reply, (3) an appointment request handled end to end, including the event created in the calendar, and (4) a medical question escalated to the staff. The video uses Meta's test phone number and fictitious data.
