# Informe ejecutivo — Bot del consultorio Dr. Marco A. Mixteco

Fecha: 15 de noviembre de 2026. Rama: `ccr-aa25d197-be722x`. Producción (`main` y Render
`bot-consultorio-1ggd`) **no se modificó**.

## Hallazgos que cambian el plan
1. **La coexistence exige ser Tech Provider** (o pagar a un proveedor). La revisión de `whatsapp_business_messaging` y `whatsapp_business_management` es obligatoria (`docs/META-REVISION-PERMISOS.md`).
2. **Embedded Signup v2/v3 se retiró en octubre de 2026.** La configuración debe ser v4. El código ya maneja el evento v4, que puede traer solo `waba_id`.
3. **La WABA de prueba no tiene apps suscritas**, así que hoy el número de prueba no entrega mensajes a ningún servidor. La demo se conecta con un **desvío a nivel de WABA**, sin tocar el webhook de la app ni producción.
4. **Producción hoy:** código viejo con `RECORDATORIOS_ACTIVOS=true` sobre el calendario real, enviando desde `1177667488770694`, que su token no puede consultar (error 100/33). Lo más probable es que todos sus envíos fallen. Aun así, se recomienda poner `RECORDATORIOS_ACTIVOS=false` en producción (decisión suya).

## 1. Qué funciona y está probado
Solo pruebas automáticas (`npm test`): **80 de 80**, repetidas 12 veces sin fallos intermitentes. Meta, Google y OpenAI están **simulados**: esto prueba la lógica del bot, no la integración real.

| Área | Pruebas |
|---|---|
| Filtros de privacidad: salud, urgencias, ARCO, BAJA; aviso simplificado; logs sin datos personales | privacidad (11), servidor (11) |
| Candados de la demo: calendario real, recordatorios, número no de prueba, destinatarios y remitentes no autorizados, acceso a calendarios no permitidos | demo (11), alta-admin (2) |
| Coexistence: ecos 521/52, ecos viejos, mensajes atrasados, duplicados, cola por chat, pausa, historial no procesado | coexistencia (8) |
| Estado persistente: reinicio simulado, HMAC sin número, error de Google → silencio, depuración | estado (8) |
| Embedded Signup v4 y panel `/admin` (sesión, suscripción con desvío, rechazo si hay un número real) | alta-admin (6), coexistencia (3) |
| Agenda: anonimización, BAJA, conservación, scripts ARCO; recordatorios con BAJA y reseñas apagadas | calendario (7), scripts (8), recordatorios (5) |

## 2. Implementado pero no probado con Meta (falta la prueba real)
- Conversación real con el número de prueba, agenda en un calendario real de Google y respuestas reales de OpenAI (prueba R1 a R10 de `docs/RENDER-DEMO.md`).
- La suscripción con desvío desde `/admin/whatsapp`, y que Meta respete el desvío.
- Embedded Signup v4 con coexistence (`/alta`).
- Los ecos reales de la app WhatsApp Business y el silencio persistente con el calendario de estado real.
- El aviso al equipo con plantilla fuera de la ventana de 24 h.

## 3. Bloqueado por permisos o aprobaciones de Meta
- **La coexistence con el número real:** requiere aprobar los dos permisos y la verificación como Tech Provider.
- **Embedded Signup con coexistence:** no se sabe si Meta lo deja probar antes de aprobar el acceso. Se comprueba al grabar.
- **Las plantillas** (confirmación, recordatorio, aviso al equipo): se crean después de conectar el número real y requieren aprobación.

## 4. Lo que puedo hacer sin usted
- Ajustes de código, documentación y pruebas automáticas.
- Revisar logs o capturas que usted me comparta.
- Corregir lo que salga mal en la prueba real.
- Preparar el pull request a `main` cuando usted lo pida (no lo hago sin su orden).

**No puedo:** entrar a Meta, Render ni Google, porque esta sesión no tiene acceso de red a esos servicios. Tampoco crear credenciales, grabar videos ni conectar números.

## 5. Lo que necesita hacer usted
**En Google (15 min):** dos calendarios de demo, la cuenta de servicio `bot-demo` y compartirlos (`docs/RENDER-DEMO.md` §1).
**En OpenAI (2 min):** la clave `demo-meta`.
**En Meta:**
- verificar los dos teléfonos de prueba y generar el token temporal (§2);
- crear la configuración de Embedded Signup v4 y anotar el `META_CONFIG_ID`;
- grabar los dos videos y enviar la solicitud con los textos de `docs/META-REVISION-PERMISOS.md`.

**En Render (10 min):** crear `bot-consultorio-demo` con `.env.demo.example` (§3) y conectar el número desde `/admin/whatsapp` (§4).
**Prueba real:** R1 a R10 (§5). Mándeme los resultados.
**Opcional, recomendado:** `RECORDATORIOS_ACTIVOS=false` en producción.

## 6. Camino más corto y seguro
1. **Hoy:** preparar Google, OpenAI y Render y conectar la demo (unos 45 minutos de su tiempo).
2. **Hoy o mañana:** prueba real R1 a R10. Si algo falla, lo corrijo con los logs.
3. **Grabar los dos videos** y enviar la revisión de los dos permisos y la verificación Tech Provider.
4. **Mientras Meta revisa:** publicar el aviso de privacidad (con los espacios llenos) y resolver con el abogado la base jurídica de los datos de salud.
5. **Con la aprobación:** pull request a `main` con `BOT_PAUSADO=true` → `/alta` con la app WhatsApp Business del consultorio → 1 o 2 días en modo sombra → encender → plantillas → recordatorios (`docs/COEXISTENCIA-PRODUCCION.md`).

**Reversión inmediata en cualquier momento:** `BOT_PAUSADO=true`, o "Quitar la suscripción" en `/admin/whatsapp`. La app WhatsApp Business sigue funcionando en los dos casos.

## Documentos vigentes
| Documento | Para qué |
|---|---|
| `docs/RENDER-DEMO.md` | Crear, conectar y probar la demo |
| `.env.demo.example` | Variables de la demo |
| `docs/META-REVISION-PERMISOS.md` | Textos y guiones para Meta; análisis de Tech Provider |
| `docs/COEXISTENCIA-PRODUCCION.md` | Conexión definitiva y reversión |
| `docs/PLANTILLAS-WHATSAPP.md` | Plantillas a crear |
| `docs/PRIVACIDAD-CAMBIOS.md`, `docs/POLITICA-CONSERVACION.md`, `docs/PROCEDIMIENTO-ARCO.md`, `POLITICA-PRIVACIDAD.md` | Privacidad |
