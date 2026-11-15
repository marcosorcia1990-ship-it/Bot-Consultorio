# Demo para la revisión de Meta: verificación, entorno y evidencia

Complementa `DEMO-REVISION-META.md`. Va en fases. **No avance a la siguiente sin terminar la anterior.**

## Datos conocidos (15 de noviembre de 2026)
| Dato | Valor |
|---|---|
| App | Bot Consultorio DrMixteco (ID 2779152412484703) |
| Portafolio | 346101355218916 (verificado) |
| Número de prueba | +1 555 184 4654 |
| Phone Number ID de prueba | 1502573929596107 |
| WABA de prueba | 1472438634813201 |
| Números de producción en la app | 0 |
| Webhook de la app | https://bot-consultorio-1ggd.onrender.com/webhook (`messages` suscrito, v25.0) |

No pude comprobar nada de esto directamente: esta sesión no tiene acceso de red a Meta ni a Render.
Las comprobaciones las hace usted con las instrucciones de la fase 1.

---

## Fase 1. Comprobaciones de solo lectura (no cambian nada)

### 1A. Asociaciones y suscripciones en Meta (Explorador de la API Graph)
1. Abra https://developers.facebook.com/tools/explorer
2. A la derecha:
   - **Meta App:** Bot Consultorio DrMixteco
   - **Usuario o página:** Token de usuario
   - **Permisos:** `whatsapp_business_management` y `business_management`
3. Pulse **Generate Access Token**. **No comparta ni capture ese token.** Recorte las capturas para que no se vea.
4. Deje el método en **GET** y ejecute, una por una:

| # | Consulta | Qué debe salir |
|---|---|---|
| 1 | `1472438634813201/phone_numbers?fields=display_phone_number,verified_name,platform_type,status` | Solo el +1 555 184 4654 |
| 2 | `1472438634813201/subscribed_apps` | Su app; anote si aparece `override_callback_uri` |
| 3 | `1502573929596107?fields=display_phone_number,webhook_configuration` | Hacia dónde van hoy los webhooks del número de prueba |
| 4 | `346101355218916/owned_whatsapp_business_accounts?fields=id,name` | Las cuentas de WhatsApp del portafolio (en el portafolio se veían 3) |
| 5 | Para **cada** id de la consulta 4: `ID/phone_numbers?fields=display_phone_number,platform_type,status` y `ID/subscribed_apps` | Ver la regla de abajo |

**Regla de paro.** Si en la consulta 5 alguna cuenta tiene el **271 116 1448** (u otro número real)
**y** además está suscrita a esta app (Bot Consultorio DrMixteco aparece en `subscribed_apps`),
**no cambie el webhook de la app.** Mándeme captura y lo resolvemos con un desvío solo para el
número de prueba (opción B de la fase 3).

### 1B. El servicio actual de Render (bot-consultorio-1ggd)
En Render → servicio **bot-consultorio-1ggd** → **Environment**. **No me mande captura de esta
pantalla** (tiene claves). Solo dígame:
1. ¿`PHONE_NUMBER_ID` termina en **6107**, que es el número de prueba?
2. ¿Cuánto vale `AGENDA_ACTIVA`? Si vale `true`, ¿`CALENDAR_ID` es el **calendario real** del consultorio?
3. ¿Cuánto vale `RECORDATORIOS_ACTIVOS`?
4. ¿Qué rama despliega (Settings → Branch)?

**Por qué importa la pregunta 2:** si el servicio actual tiene la agenda activa con el calendario
real y recibe los mensajes del número de prueba, **cualquier prueba crea citas en la agenda real**.
Eso ya es un riesgo hoy, aunque no haya demo.

---

## Fase 2. Preparación segura (no recibe tráfico ni toca producción)

Nada de esto cambia el webhook ni el servicio actual.

### 2A. Calendario ficticio
Google Calendar → **Otros calendarios → +** → **Crear calendario** → nombre **"Demo bot (pruebas)"**.
No le agregue eventos reales.

### 2B. Credencial de Google exclusiva para la demo (recomendado)
La cuenta de servicio actual tiene acceso al **calendario real con datos de pacientes**. Para que
la demo no use credenciales con acceso a pacientes:
1. Google Cloud Console → el mismo proyecto → **IAM y administración → Cuentas de servicio → Crear cuenta de servicio** → nombre `bot-demo`. No le dé roles.
2. Entre a `bot-demo` → **Claves → Agregar clave → JSON**. Se descarga un archivo: guárdelo, no lo comparta y no lo suba a GitHub.
3. En el calendario "Demo bot (pruebas)" → **Compartir con personas específicas** → agregue el correo de `bot-demo` (termina en `.iam.gserviceaccount.com`) con **"Hacer cambios en los eventos"**.
4. Copie el **ID del calendario** (Configuración → Integrar calendario).

### 2C. Clave de OpenAI exclusiva para la demo (recomendado)
En platform.openai.com → API keys → **Create new secret key** → nombre `demo-meta`. Así se puede
revocar al terminar sin afectar nada más.

### 2D. Servicio nuevo en Render
**New → Web Service** → el mismo repositorio → rama `ccr-aa25d197-be722x` → nombre
`bot-consultorio-demo` → plan gratuito → **Start command:** `npm start`.

| Variable | Valor |
|---|---|
| `PHONE_NUMBER_ID` | `1502573929596107` |
| `WHATSAPP_TOKEN` | Token temporal de "Configuración de la API" (dura 24 h: genérelo el día de la grabación) |
| `VERIFY_TOKEN` | Una palabra nueva, distinta de la del servicio actual |
| `OPENAI_API_KEY` | La clave `demo-meta` |
| `GOOGLE_CREDENTIALS_JSON` | El contenido del JSON de `bot-demo` |
| `CALENDAR_ID` y `CALENDARS_BUSY` | El ID de "Demo bot (pruebas)" |
| `AGENDA_ACTIVA` | `true` |
| `RECORDATORIOS_ACTIVOS` | `false` |
| `INTERNAL_ALERT_NUMBER` | El teléfono "Equipo" (52 + 10 dígitos) |
| `PERSONAL_NUMBERS` | El mismo teléfono "Equipo" (10 dígitos) |
| `LOG_SALT` | Una cadena aleatoria |
| `MODO_DEMO` | `true` (activa los candados; ver `DIAGNOSTICO-PRODUCCION-Y-DEMO.md`) |
| `DEMO_DESTINATARIOS` | Los teléfonos "Paciente demo" y "Equipo", separados por comas |
| `CALENDARIOS_PROHIBIDOS` | `internista.marco@gmail.com` |

En **Settings → Auto-Deploy**, póngalo en **No**: así la demo no se vuelve a desplegar sola con cada cambio en la rama.

Al terminar el despliegue, abra `https://bot-consultorio-demo….onrender.com/`. Debe decir
"Bot del consultorio: en línea". En **Logs** deben aparecer `Datos de salud a la IA: BLOQUEADOS` y
`🧪 MODO DEMO: número de origen verificado como número de prueba (+1 555…)`. Si aparece `⛔ MODO DEMO`,
el servidor se detuvo a propósito: lea el motivo en el log.
**Todavía no recibe mensajes:** el webhook sigue apuntando al servicio actual.

### 2E. Números de prueba
En **WhatsApp → Configuración de la API → Para → Administrar lista de números**, agregue y verifique
los teléfonos "Paciente demo" y "Equipo". No grabe esta pantalla.

---

## Fase 3. Desvío de los webhooks a la demo (SOLO después de la fase 1)

Hay dos maneras. Elegimos según los resultados de la fase 1.

### Opción A: cambiar la URL del webhook de la app
WhatsApp → Configuración → Webhook → Editar → la URL de la demo y su `VERIFY_TOKEN`.

- **Efecto:** todas las cuentas de WhatsApp suscritas a esta app mandan sus eventos a la demo. El servicio actual deja de recibir mensajes.
- **Cuándo es seguro:** si la fase 1 confirma que la única cuenta suscrita con números es la de prueba. En ese caso el servicio actual hoy solo recibe tráfico de prueba, y no se pierde nada real.
- **Ventaja:** se hace desde la pantalla, sin comandos.
- **Para revertirlo:** volver a pegar `https://bot-consultorio-1ggd.onrender.com/webhook` con el `VERIFY_TOKEN` del servicio actual. Si no lo recuerda, está en el Environment de ese servicio.
- **Si la URL nueva falla la verificación,** Meta no guarda el cambio y todo sigue como estaba.

### Opción B: desvío solo para el número de prueba (la más aislada)
Con el Explorador de la API Graph, método **POST** sobre `1502573929596107`, cuerpo:
```
{"webhook_configuration": {"override_callback_uri": "https://bot-consultorio-demo….onrender.com/webhook", "verify_token": "SU_VERIFY_TOKEN_DE_DEMO"}}
```
- **Efecto:** solo los eventos del número de prueba van a la demo. La URL de la app y cualquier otra cuenta no cambian.
- **Cuándo usarla:** si la fase 1 encuentra otra cuenta suscrita a la app, o si prefiere no tocar la configuración general.
- **Para revertirla:** repetir el POST con la URL del servicio actual. Confirme con la consulta 3 de la fase 1 que `webhook_configuration` muestra la URL correcta.
- **[VERIFICAR]:** no pude consultar la documentación de Meta desde aquí. Si el Explorador rechaza el campo, me manda el mensaje de error.

**En cualquiera de las dos opciones**, el servicio de demo tiene que estar en línea **antes** del
cambio, porque Meta verifica la URL en ese momento.

---

## Fase 4. Grabación del permiso `whatsapp_business_messaging`
Siga la parte 3 de `DEMO-REVISION-META.md` (escenas 1 a 7).

---

## Fase 5. Evidencia del permiso `whatsapp_business_management`

### Para qué usa la app este permiso (dígalo así en el formulario)
Nuestra app lo usa en su flujo de alta, la página `/alta` con Embedded Signup y la opción de coexistence, para:
1. obtener la cuenta de WhatsApp (WABA) y el número que el negocio conecta;
2. suscribir la app a los webhooks de esa cuenta (`POST /{waba}/subscribed_apps`);
3. solicitar la sincronización de contactos e historial de la app WhatsApp Business (`POST /{phone_number_id}/smb_app_data`).

### Qué se puede grabar
- **M1 (evidencia completa, requiere una decisión suya):** ejecutar `/alta` en el servicio de demo con un **teléfono de repuesto que tenga la app WhatsApp Business y que NO sea el del consultorio**. Se grabaría el inicio de sesión con Facebook, la selección del negocio, el código QR desde la app y el resultado. El token ya sale enmascarado en pantalla (corregido en este commit).
  - **Consecuencia:** ese número de repuesto queda conectado a la app como número de producción. Se puede desconectar después.
  - **Requisitos:** `META_APP_ID`, `META_APP_SECRET` y `META_CONFIG_ID` en el servicio de demo, y una configuración de Facebook Login for Business con la plantilla de Embedded Signup.
  - **[VERIFICAR]:** es posible que Meta no permita la opción de coexistence en Embedded Signup hasta aprobar el acceso avanzado. Si la ventana de Facebook no ofrece "Conectar la app WhatsApp Business existente", se graba hasta donde llegue y se pasa a M2.
- **M2 (mínima):** grabar la página `/alta` abriendo Embedded Signup hasta la selección del negocio, y explicar en el formulario que la conexión del número real se hará después de la aprobación. Es más débil: Meta puede pedir más evidencia.

### Texto sugerido para el formulario (whatsapp_business_management)
> Our app uses whatsapp_business_management only during onboarding of our own medical practice's WhatsApp Business account. Through Embedded Signup (WhatsApp Business app coexistence), the app retrieves the connected WABA and phone number, subscribes our app to the WABA's webhooks (POST /{waba-id}/subscribed_apps) and requests the synchronization of contacts and chat history from the WhatsApp Business app (POST /{phone-number-id}/smb_app_data). We do not manage templates, phone numbers or accounts of other businesses. The video shows the onboarding flow with a test number and fictitious data; access tokens are masked on screen.

---

## Fase 6. Al terminar
1. Revierta el desvío de la fase 3.
2. Revoque la clave `demo-meta` de OpenAI y la clave JSON de `bot-demo`.
3. Suspenda el servicio `bot-consultorio-demo` (Settings → Suspend).
4. Borre el calendario "Demo bot (pruebas)" o los eventos de "Juan Prueba Demo".
