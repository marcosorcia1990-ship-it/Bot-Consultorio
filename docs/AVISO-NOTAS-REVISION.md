# Notas para publicar el aviso de privacidad (POLITICA-PRIVACIDAD.md)

## Condición para publicarlo
El aviso describe el funcionamiento de la versión de esta rama (filtro clínico, notas de voz
sin transcribir, logs mínimos, reseñas apagadas, BAJA). **Si se publica mientras Render sigue
con la versión anterior, varias afirmaciones serían falsas**: en la versión anterior, OpenAI
transcribe los audios y los logs guardan fragmentos de los mensajes. Debe publicarse cuando
esta versión esté desplegada, o antes de que el bot atienda a pacientes reales.

## Espacios por llenar (no publicar con corchetes)
| Espacio | Quién decide |
|---|---|
| `[FECHA DE PUBLICACIÓN]` | Responsable |
| `[DOMICILIO DEL RESPONSABLE]` | Abogado: domicilio fiscal (Fortín) o del consultorio |
| `[PLAZO DE CONSERVACIÓN DEFINIDO POR EL RESPONSABLE]` | Responsable y abogado (ver docs/POLITICA-CONSERVACION.md) |
| `[PLAZO LEGAL]` | Abogado, según la ley vigente |

## Procedimientos que siguen siendo manuales
1. Atención de solicitudes ARCO: registro, verificación de identidad, aprobación y respuesta (docs/PROCEDIMIENTO-ARCO.md).
2. Eliminación de datos: el script anonimiza la agenda, pero lo ejecuta una persona. El chat de WhatsApp lo borra una persona.
3. BAJA de pacientes sin citas creadas por el bot: la registra una persona.
4. Depuración de citas por conservación: no hay plazo; cuando se defina, la ejecuta una persona.
5. Respuesta a mensajes clínicos y notas de voz: la da el personal.

## Puntos pendientes de revisión jurídica
1. **Base jurídica para los datos de salud** que llegan sin que se pidan (docs/CONSENTIMIENTO-DATOS-SENSIBLES.md). Es el punto principal.
2. Si "valoración preoperatoria" es un dato sensible y si puede seguir enviándose a OpenAI.
3. Si el aviso simplificado enviado en el primer mensaje cumple la obligación de ponerlo a disposición, y si su contenido es suficiente.
4. Remisiones internacionales a proveedores: si basta lo que dice el aviso y qué instrumentos contractuales hacen falta (docs/PROVEEDORES-Y-TRANSFERENCIAS.md), en especial Google Calendar en una cuenta personal.
5. Ley y autoridad vigentes tras la reforma de 2025: si el aviso debe mencionar ante qué autoridad presentar quejas.
6. Plazo de respuesta ARCO, requisitos de identificación y plazo de conservación del registro de solicitudes.
7. Plazo de conservación de las citas en la agenda.
8. Redacción de la sección de eliminación: que la limitación sobre las copias en los proveedores sea aceptable.
9. Si las confirmaciones y los recordatorios son finalidades primarias (necesarias) o secundarias.
