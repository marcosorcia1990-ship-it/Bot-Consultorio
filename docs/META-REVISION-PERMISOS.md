# Revisión de Meta: `whatsapp_business_messaging` y `whatsapp_business_management`

Reemplaza los textos de `DEMO-REVISION-META.md`. Los guiones de grabación de ese documento
siguen sirviendo como referencia visual.

## 1. ¿Hace falta la ruta Tech Provider para conectar solo nuestro negocio?

**Sí, según la documentación vigente.**
- La página oficial de Meta para conectar usuarios de la app WhatsApp Business (coexistence) exige **ser Solution Partner o Tech Provider**, usar **Embedded Signup con registro de sesión** y enviar `featureType: "whatsapp_business_app_onboarding"`. La app del negocio debe tener la versión **2.24.17 o superior**. ([Meta: Onboard WhatsApp Business app users](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users/))
- No encontré una vía oficial para que un negocio se conecte a sí mismo sin esa condición. Hay una pregunta abierta en la comunidad de desarrolladores de Meta sobre exactamente este caso, sin respuesta concluyente en lo que pude consultar. ([hilo de la comunidad](https://developers.facebook.com/community/threads/1866465831217430/))
- Los proveedores que ofrecen coexistence (360dialog y otros) lo hacen precisamente porque son partners. ([360dialog: Coexistence](https://docs.360dialog.com/docs/resources/phone-numbers/coexistence))

**Conclusión:** las alternativas son (a) hacerse Tech Provider (sin costo, con revisión de la app) o (b) pagar a un proveedor. Usted eligió (a). Por eso **la revisión de los dos permisos es obligatoria**.

**Embedded Signup v2/v3 se retiró en octubre de 2026** (Meta da el 8 o el 15 de octubre según la página). Hay que crear la configuración con **v4**. `featureType: "whatsapp_business_app_onboarding"` sigue siendo el selector de coexistence en v4. ([versiones de Embedded Signup](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/versions/), [registro de cambios](https://developers.facebook.com/documentation/business-messaging/whatsapp/changelog))
- En v4, el evento final (`FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING`) puede traer solo `waba_id`. `alta.js` ya lo maneja consultando los números de la cuenta.

**[VERIFICAR antes de grabar]:**
- si Meta permite abrir Embedded Signup con la opción de coexistence **antes** de aprobar el acceso avanzado (en modo desarrollo, con usuarios de la app);
- el objeto exacto `extras` de v4. No encontré un ejemplo oficial completo; el código usa `{setup:{}, sessionInfoVersion:"3", featureType:"whatsapp_business_app_onboarding"}`.

## 2. `whatsapp_business_messaging`

### Descripción para el formulario (inglés)
> Our app is the WhatsApp assistant of a single internal medicine practice in Mexico (Dr. Marco A. Mixteco). It uses the WhatsApp Cloud API to receive messages that patients send to the practice and to reply on the practice's behalf. The assistant only handles administrative tasks: office information (prices, address, hours), booking, rescheduling and cancelling appointments in the practice's Google Calendar, and appointment confirmations and reminders with approved templates. It never gives medical advice: messages that contain health information, medical questions or voice notes are not processed by the AI and are handed over to the office staff, who reply personally. The first message of each conversation includes a short privacy notice with a link to the full privacy policy. When a staff member replies from the WhatsApp Business app (coexistence), the assistant stops replying in that chat.
>
> The screencast uses Meta's test phone number (+1 555 184 4654) and fictitious data. It shows: (1) an incoming message and the automatic administrative reply, (2) an appointment request handled end to end and the event created in a test calendar, (3) a medical question escalated to the staff phone, and (4) the server logs showing the webhook events were received, with no personal data logged.

### Guion del video (3 a 4 minutos)
Siga las escenas 1 a 7 de `DEMO-REVISION-META.md` con estos ajustes:
- **Escena 1:** muestre `/admin/whatsapp` de la demo (número +1 555, desvío de la WABA a la demo), en lugar de la pantalla de configuración de Meta.
- La prueba real R2 a R5 de `RENDER-DEMO.md` **es** el contenido del video. Grabe solo después de haberla hecho completa una vez sin grabar.

## 3. `whatsapp_business_management`

### Qué hace realmente la app con este permiso (todo implementado)
| Función | Llamada | Dónde | ¿Se puede demostrar hoy con el número de prueba? |
|---|---|---|---|
| Ver el número, su calidad y a dónde van sus webhooks | `GET /{phone-number-id}?fields=…,webhook_configuration` | `/admin/whatsapp` | **Sí** |
| Ver los números y las apps suscritas de la WABA | `GET /{waba-id}/phone_numbers`, `GET /{waba-id}/subscribed_apps` | `/admin/whatsapp` | **Sí** |
| Suscribir la app a la WABA con desvío del webhook | `POST /{waba-id}/subscribed_apps` (`override_callback_uri`, `verify_token`) | `/admin/whatsapp` | **Sí** |
| Quitar la suscripción | `DELETE /{waba-id}/subscribed_apps` | `/admin/whatsapp` | **Sí** |
| Conectar el número de la app WhatsApp Business (coexistence) | Embedded Signup v4 → `POST /{waba-id}/subscribed_apps`, `POST /{phone-number-id}/smb_app_data` (contactos e historial) | `/alta` | **Depende de Meta** (ver la [VERIFICACIÓN] de la sección 1) |

### Descripción para el formulario (inglés)
> Our app uses whatsapp_business_management only to manage our own medical practice's WhatsApp Business Account. In the app's admin panel, the practice's administrator can (1) view the phone number's status, quality rating and webhook routing (GET phone number fields including webhook_configuration), (2) view the account's phone numbers and subscribed apps, and (3) subscribe or unsubscribe our app to the account's webhooks, with a callback override pointing to our server (POST/DELETE /{waba-id}/subscribed_apps). In addition, our onboarding page uses Embedded Signup (WhatsApp Business app coexistence) to connect the practice's existing WhatsApp Business app number: after the flow, the app subscribes to the WABA's webhooks and requests contacts and history synchronization (POST /{phone-number-id}/smb_app_data). We do not manage other businesses' accounts, templates or phone numbers. The screencast uses Meta's test WABA and fictitious data; access tokens are never shown on screen.

### Guion del video (2 a 3 minutos)
1. **`/admin/entrar`:** se escribe la contraseña (campo oculto). Subtítulo: *"Admin panel of our app (password protected)."*
2. **`/admin/whatsapp`:** se recorre la pantalla (número de prueba, números de la cuenta, apps suscritas, comprobaciones de aislamiento). Subtítulo: *"The app reads the WABA's phone numbers, subscribed apps and webhook routing using whatsapp_business_management."*
3. Pulse **"Quitar la suscripción"**, recargue: "Apps suscritas: Ninguna". Pulse **"Suscribir…"**, recargue: aparece el desvío a la URL del servidor. Subtítulo: *"The app subscribes itself to the WABA's webhooks with a callback override."*
4. Teléfono "Paciente demo": envíe "Hola", llega la respuesta. Subtítulo: *"Webhooks now reach our server."*
5. **`/alta`:** pulse "Conectar WhatsApp" y grabe la ventana real de Meta **hasta donde Meta lo permita**:
   - Si permite completar la coexistence con un **teléfono de repuesto** con la app WhatsApp Business (nunca el del consultorio), grabe todo el flujo y la pantalla de resultado (token enmascarado).
   - Si no lo permite antes de la aprobación, deténgase en la pantalla de Meta y diga en el subtítulo: *"Embedded Signup (coexistence) will be used to connect our own WhatsApp Business app number once access is approved."*

   **No simule pasos que no ocurrieron.**

## 4. Requisitos previos en Meta (lista)
- [x] Negocio verificado.
- [x] Configuración básica de la app (íconos, política de privacidad, categoría).
- [ ] La política de privacidad publicada en `https://internistamarco.com/privacidad`, con la versión que corresponde al código desplegado.
- [ ] Configuración de Facebook Login for Business con plantilla **WhatsApp Embedded Signup v4**: anote el `META_CONFIG_ID`. El dominio de la demo va en "Dominios permitidos para el SDK de JavaScript".
- [ ] Videos grabados.
- [ ] Solicitud de acceso avanzado a los dos permisos.
- [ ] Verificación de acceso como Tech Provider, cuando el panel la pida.
