# Guía: conectar el bot sin dejar la app WhatsApp Business

Objetivo: el número del consultorio sigue en la app de su teléfono (usted y Ade ven todo y
pueden contestar) y el bot responde automáticamente. Si usted escribe en un chat desde la app,
el bot se calla en ese chat durante 24 h.

Para esto la app de Meta debe ser **Tech Provider**. Es gratis, pero requiere trámites
que solo usted puede hacer con su cuenta de Facebook.

## Fase 1 — Verificar el negocio (usted, 15 min + espera de días)
1. Entre a https://business.facebook.com → Configuración → Centro de seguridad → **Iniciar verificación**.
2. Datos: nombre legal **exactamente como aparece en su constancia de situación fiscal**, RFC,
   domicilio fiscal, teléfono y un sitio web o correo con dominio propio, si lo tiene.
3. Suba la constancia de situación fiscal. Si se la piden, agregue un comprobante de domicilio
   con el mismo nombre y dirección.
4. Espere la aprobación. Mientras tanto puede avanzar con la fase 2.

## Fase 2 — Configurar la app (usted, ~30 min)
En https://developers.facebook.com → su app:
1. **Configuración > Básica**: copie el *Identificador de la app* (META_APP_ID) y la
   *Clave secreta* (META_APP_SECRET). Agregue una URL de política de privacidad.
2. **Facebook Login for Business > Configuraciones > Crear**: elija la plantilla
   *WhatsApp Embedded Signup*. Copie el **ID de configuración** (META_CONFIG_ID).
3. En Facebook Login for Business > Configuración, agregue su dominio de Render
   (ej. `https://su-bot.onrender.com`) en **Dominios permitidos para el SDK de JavaScript**
   y en **URI de redireccionamiento de OAuth válidos**.
4. **WhatsApp > Configuración > Webhooks**: además de `messages`, suscriba los campos
   **`smb_message_echoes`**, `smb_app_state_sync` y `history`.
5. **Revisión de la app > Permisos**: solicite acceso avanzado a
   `whatsapp_business_management` y `whatsapp_business_messaging`. Le pedirán un video corto
   donde se ve el bot respondiendo a un mensaje de prueba.
6. Complete la **verificación de acceso como Tech Provider** cuando aparezca en el panel.

## Fase 3 — Variables en Render
Agregue `META_APP_ID`, `META_APP_SECRET` y `META_CONFIG_ID`. Reinicie el servicio.

## Fase 4 — Conectar el número (usted, 5 min, con el teléfono en mano)
1. Actualice la app WhatsApp Business (versión 2.24.17 o superior).
2. Abra en la computadora: `https://SU-BOT.onrender.com/alta?token=SU_VERIFY_TOKEN`
3. Pulse **Conectar WhatsApp**, elija conectar la app existente, escanee el QR desde la app
   y acepte compartir el historial.
4. La página le mostrará `PHONE_NUMBER_ID` y `WHATSAPP_TOKEN`. Cópielos en Render
   (reemplazando los anteriores) y reinicie.

## Fase 5 — Prueba
- Desde otro teléfono escriba "Hola, ¿cuánto cuesta la consulta?" → el bot debe contestar,
  y usted debe ver esa respuesta en su app.
- Conteste usted algo en ese chat desde la app → escriba otra vez desde el otro teléfono:
  el bot **no** debe responder. En los registros de Render debe aparecer
  `👤 Chat tomado por el equipo`.

## Advertencias
- Abra la app WhatsApp Business al menos una vez cada 14 días; si no, Meta puede
  desconectar la coexistencia.
- Con coexistencia activa se desactivan los mensajes temporales, las fotos de "ver una vez"
  y la ubicación en tiempo real.
- La marca de "chat tomado por el equipo" vive en la memoria del servidor: si Render se
  reinicia, se pierde. Mantenga el servicio despierto (UptimeRobot gratuito visitando `/`
  cada 10 minutos).
