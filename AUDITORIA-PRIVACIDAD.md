# Auditoría de privacidad del bot — 14 de noviembre de 2026

> **Nota:** esta auditoría describe el código ANTES de los cambios de privacidad.
> Para el estado actual ver `docs/PRIVACIDAD-CAMBIOS.md`.

Revisión del código en la rama `ccr-aa25d197-be722x` (server.js, tools.js, calendar.js,
recordatorios.js, alta.js, system-prompt.md). Describe lo que el código **hace hoy**, no
lo que debería hacer. Lo que depende de proveedores externos o de la configuración de
Render está marcado como **[VERIFICAR]**.

## 1. Qué datos de pacientes se guardan y dónde

| Dato | Dónde | Archivo |
|---|---|---|
| Últimos 8 mensajes de la conversación (texto del paciente, notas de voz transcritas, textos de imágenes, respuestas del bot) | Memoria RAM del servidor en Render. No se escribe en disco ni en base de datos. | server.js `chats`, `trimHistory` |
| Cita localizada en la conversación (id del evento, nombre, fecha) | Memoria RAM | tools.js `sesion.citaLocalizada` |
| Marca de "chat tomado por el equipo" y hora de última actividad, por número | Memoria RAM | server.js `getChat` |
| IDs de los últimos 1,000 mensajes (sin contenido), para no procesarlos dos veces | Memoria RAM | server.js `processedIds` |
| **Citas**: nombre, teléfono dictado, número de WhatsApp, tipo de cita (consulta o preoperatoria), primera vez o subsecuente, fecha y hora, estado (nueva, pendiente, confirmada, cancelada), número de reprogramaciones, si ya se enviaron la confirmación, el recordatorio y la solicitud de reseña | **Google Calendar** del consultorio (título, descripción y propiedades privadas del evento) | calendar.js `crearCita`, `marcarEnCita`, `reagendarCita` |
| Registros técnicos: número del paciente, primeros 80 caracteres de cada mensaje de texto, primeros 120 de cada nota de voz transcrita, primeros 80 de cada respuesta, argumentos completos de las herramientas (nombre y teléfono al agendar), nombres y fechas de citas al buscar, confirmar, cancelar o enviar recordatorios | **Registros (logs) de Render** | server.js, calendar.js, recordatorios.js |
| Avisos al equipo: número del paciente y hasta 300 caracteres de su mensaje | Chat de WhatsApp del número interno (`INTERNAL_ALERT_NUMBER`) y logs | server.js `alertTeam` |

**Lo que NO se guarda:**
- **Audios:** se descargan a memoria, se mandan a OpenAI para transcribirlos y se descartan. No se escriben en disco.
- **Imágenes, documentos y videos:** el bot no los descarga ni los analiza. Solo usa el texto que los acompaña si tiene 15 caracteres o más. Si no, los ignora.

## 2. Cuánto tiempo se conservan

| Dato | Plazo real |
|---|---|
| Historial de conversación (memoria) | **No hay borrado programado.** Se descarta cuando el servidor se reinicia, o cuando el paciente vuelve a escribir después de más de 24 h sin actividad. Si el paciente no vuelve a escribir y el servidor no se reinicia, sigue en memoria. Solo se guardan los últimos 8 mensajes. |
| Audios | Segundos (lo que tarda la transcripción). En OpenAI: según su política **[VERIFICAR]**. |
| Citas en Google Calendar | **Indefinido.** El código nunca borra eventos. Las citas canceladas no se borran: quedan en rojo, marcadas como canceladas. |
| Logs de Render | Según el plan de Render **[VERIFICAR en el panel]**. El código no los borra. |
| Avisos en el WhatsApp interno | Hasta que alguien borre el chat. |

## 3. OpenAI

**Sí.** Recibe:
- Cada mensaje de texto, junto con el historial reciente y las instrucciones del bot (modelo `gpt-4o-mini`, configurable con `MODEL`).
- **Cada nota de voz**, que se transcribe con `whisper-1`.
- El texto que acompaña imágenes y documentos.
- Los resultados de las herramientas de agenda: nombres, fechas y horas de citas, y nombres de familiares que comparten el mismo número.

Los mensajes que el bot no atiende (números personales protegidos, chats tomados por el equipo, stickers, imágenes sin texto) **no** se mandan a OpenAI.

Retención en OpenAI **[VERIFICAR]**: según la política pública de la API, los datos se conservan hasta 30 días para vigilar abusos y no se usan para entrenar modelos. Confírmalo en la configuración de tu cuenta de OpenAI.

## 4. Google Calendar

**Sí**, cuando `AGENDA_ACTIVA=true`:
- Consulta los horarios ocupados en todos los calendarios de `CALENDARS_BUSY`.
- Crea, mueve y marca citas en `CALENDAR_ID`.
- **Lee también las citas que el equipo captura a mano** (las que tienen un teléfono en el título o en la descripción) para buscar a un paciente por número o por nombre.
- Los recordatorios usan los datos del evento y solo se envían para las citas que creó el bot.

## 5. ¿Existe un procedimiento real para eliminar datos?

**No en el código.** No existe ninguna función que borre los datos de un paciente:
- `cancelar_cita` solo marca la cita como cancelada. No la borra.
- El bot no reconoce una solicitud de eliminación. Si un paciente escribe "Eliminar mis datos", lo atiende el modelo de IA según las instrucciones generales: puede contestar con una respuesta genérica y avisar al equipo, pero no hace nada más.
- **El borrador anterior del aviso decía que bastaba con mandar "Eliminar mis datos" por WhatsApp. Eso era falso y se corrigió.**

Por eso, la eliminación tiene que ser **manual**:
1. Borrar los eventos del paciente en Google Calendar, incluidas las citas canceladas.
2. Borrar el chat en la app WhatsApp Business y, si lo hay, el aviso en el WhatsApp interno.
3. La memoria del servidor se vacía al reiniciar el servicio en Render.
4. Los logs de Render, las copias en OpenAI y lo que guarda Meta **no se pueden borrar de forma selectiva** desde aquí. Caducan según la política de cada proveedor.

## 6. Datos en Meta, Render y otros proveedores

| Proveedor | Qué tiene |
|---|---|
| **Meta (WhatsApp)** | Todos los mensajes que entran y salen, los archivos (audios, fotos, documentos) y los números. Con coexistence activa, **el historial completo también queda en la app WhatsApp Business del teléfono del consultorio** y en sus respaldos. Retención de los archivos en los servidores de la API **[VERIFICAR]**. |
| **Render** | Logs (punto 1), memoria del proceso, variables de entorno (claves de acceso; no contienen datos de pacientes). |
| **OpenAI** | Punto 3. |
| **Google** | Citas en Calendar (punto 4). |
| **Hostinger** | El correo contacto@internistamarco.com, donde llegarían las solicitudes ARCO, y el sitio web. El sitio no recibe datos del bot. |

Todos estos proveedores procesan los datos en servidores **fuera de México**, en general en Estados Unidos **[VERIFICAR la región de Render]**.

## Diferencias corregidas respecto al borrador anterior del aviso

1. "El historial se borra de forma automática": inexacto. No hay borrado programado. Se corrigió a "se guarda solo en memoria y se descarta al reiniciar o al reanudar la conversación después de 24 h".
2. "Escriba 'Eliminar mis datos' por WhatsApp": falso. El bot no tiene esa función. Ahora el canal es el correo electrónico y la solicitud se atiende a mano.
3. "Los datos de su cita se conservan mientras sean necesarios": no hay ningún plazo definido. Ahora dice la verdad: no hay borrado automático.
4. No mencionaba los logs técnicos de Render, que guardan fragmentos de los mensajes.
5. No mencionaba que el historial queda en la app WhatsApp Business (coexistence), ni los avisos al número interno.
6. No mencionaba la solicitud de reseña ni las confirmaciones con botones.
7. "Le pedimos no enviar información de salud": puede pedirse, pero en la práctica el bot sí manda a OpenAI todo lo que el paciente escribe o dicta. Ahora se dice claramente.
8. No mencionaba las transferencias a servidores en el extranjero.
9. No aclaraba que el bot no analiza imágenes ni documentos.

## Recomendaciones (no implementadas: piden cambios de código)
- Reducir lo que se escribe en los logs: quitar el texto de los mensajes y las transcripciones, y dejar solo los últimos 4 dígitos del teléfono.
- Agregar una regla al `system-prompt.md` para que "eliminar mis datos" o "aviso de privacidad" se respondan con el enlace al aviso y avisen al equipo.
- Decidir cuánto tiempo se guardan las citas en Calendar y depurarlas periódicamente.
