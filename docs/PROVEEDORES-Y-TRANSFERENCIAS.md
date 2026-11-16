# Proveedores, acuerdos de tratamiento y transferencias internacionales

**Esto no es código. Son trámites que hace el responsable y que revisa el abogado.**
No pude consultar las páginas oficiales desde la sesión de trabajo (el acceso a esos sitios
estaba bloqueado), así que todo lo marcado **[VERIFICAR]** sale de conocimiento general y
hay que confirmarlo en la cuenta o el sitio de cada proveedor.

## Marco general (para el abogado)
- Los proveedores que tratan datos **por cuenta del consultorio** son, en principio, *encargados*. Comunicarles datos sería una *remisión*, que normalmente no requiere consentimiento del titular, pero sí un instrumento jurídico (contrato o cláusulas) que los obligue a tratarlos solo según las instrucciones del responsable. **[VERIFICAR tras la reforma de 2025.]**
- Todos procesan datos **fuera de México**. Hay que confirmar los requisitos para remisiones internacionales y si el aviso debe detallarlas más.
- Si algún proveedor usa los datos para fines propios (por ejemplo, para entrenar modelos), dejaría de ser encargado: sería una *transferencia* y podría requerir consentimiento.

## Por proveedor

| Proveedor | Datos que recibe | Acuerdo de tratamiento | Acción concreta | Ubicación |
|---|---|---|---|---|
| **Meta (WhatsApp Cloud API)** | Todos los mensajes, archivos y números; plantillas | Términos de WhatsApp Business y términos de tratamiento de datos de la API **[VERIFICAR que se aceptaron en el portafolio]** | Confirmar en Business Manager que los términos de la API están aceptados y guardar una copia | EE. UU. y otros **[VERIFICAR]** |
| **App WhatsApp Business (coexistence)** | Historial completo en el teléfono del consultorio | Términos de la app; el teléfono queda bajo control del consultorio | Proteger el teléfono con bloqueo, decidir si los respaldos en la nube se cifran o se desactivan, y definir quién tiene acceso | Teléfono y su respaldo en la nube |
| **OpenAI (API)** | Mensajes administrativos, nombres, fechas de cita | DPA disponible para clientes de la API **[VERIFICAR y firmar]** | 1) Firmar el DPA. 2) Confirmar que los datos de la API no se usan para entrenar. 3) Valorar solicitar *Zero Data Retention*. | EE. UU. **[VERIFICAR opciones de residencia de datos]** |
| **Google (Calendar)** | Citas: nombre, teléfonos, tipo de cita | **Si la agenda está en una cuenta personal de Gmail, aplican los términos de consumidor y no hay acuerdo de tratamiento.** Google Workspace sí ofrece un anexo de tratamiento de datos. | Decidir si se migra la agenda a Google Workspace (tiene costo mensual) o si el abogado acepta la cuenta actual | EE. UU. y otros |
| **Render** | Logs mínimos, memoria del proceso | DPA del proveedor **[VERIFICAR disponibilidad según el plan]** | Aceptar el DPA si existe; anotar la región del servicio y el plazo de los logs | Región elegida al crear el servicio (EE. UU. o Europa) **[VERIFICAR]** |
| **Hostinger** | Correo contacto@ (solicitudes ARCO con identificaciones) y sitio web | DPA del proveedor **[VERIFICAR]** | Renovar el dominio y el correo (el correo vence el 11 de diciembre de 2026) y aceptar el DPA si existe | Según el centro de datos contratado **[VERIFICAR]** |

## Riesgos que conviene que el abogado priorice
1. **Google Calendar en una cuenta personal:** probablemente es el eslabón más débil en lo contractual.
2. **El correo de privacidad vence en diciembre:** si vence, el canal oficial ARCO deja de funcionar.
3. **Respaldos del teléfono:** el historial completo de los chats puede terminar en Google Drive o iCloud.
4. **OpenAI:** sin DPA firmado, la remisión no está documentada.
