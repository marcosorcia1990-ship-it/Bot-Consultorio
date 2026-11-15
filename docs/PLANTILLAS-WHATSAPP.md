# Plantillas de WhatsApp que usa el bot

Se crean en **WhatsApp Manager → Plantillas de mensajes** de la WABA **del consultorio**, después de
conectar el número. Los nombres deben coincidir **exactamente** con las variables (o con los valores
por omisión). Categoría: **Utilidad**. Idioma: **Español (MEX)** (`es_MX`).

## 1. `confirmacion_cita` (variable `TPL_CONFIRMACION`)
- **Cuerpo:** `Hola {{1}}, le recordamos su cita con el Dr. Marco A. Mixteco, Medicina Interna, el {{2}} en el Sanatorio Santa Rita, Consultorio #5. ¿Nos confirma su asistencia?`
- **Botones de respuesta rápida:** `Sí, confirmo` · `No podré asistir`
- **Pie:** `Responda BAJA para no recibir más recordatorios.`
- **Variables:** {{1}} = nombre del paciente; {{2}} = fecha y hora (las llena `recordatorios.js`).
- Los botones deben empezar con "Sí" y "No": `procesarRespuestaBoton` los reconoce así.

## 2. `recordatorio_cita` (variable `TPL_RECORDATORIO`)
- **Cuerpo:** `Hola {{1}}, le esperamos hoy, {{2}}, en el Sanatorio Santa Rita, Consultorio #5. Le pedimos llegar 15 minutos antes.`
- **Pie:** `Responda BAJA para no recibir más recordatorios.`

## 3. `aviso_equipo` (variable `TPL_AVISO_EQUIPO`, opcional pero recomendada)
Sirve para avisarle a usted o a Ade cuando su chat con el número del consultorio lleva más de 24 h sin actividad.
- **Cuerpo:** `Aviso del asistente del consultorio: {{1}}`
- **Variable:** {{1}} = motivo y número del paciente, en una línea.
- **Riesgo de rechazo:** Meta puede considerar este texto demasiado genérico. Si lo rechaza, use un texto más específico, por ejemplo: `Hay un mensaje de paciente pendiente de respuesta personal: {{1}}`.

## 4. `seguimiento_resena` (variable `TPL_RESENA`)
**No la cree por ahora.** `RESENAS_ACTIVAS` está apagado y el aviso de privacidad dice que no se piden reseñas.
