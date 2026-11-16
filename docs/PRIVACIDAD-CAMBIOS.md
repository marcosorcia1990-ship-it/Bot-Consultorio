# Cambios de privacidad del bot

Fecha: 14 de noviembre de 2026. Rama: `ccr-aa25d197-be722x`.
**No está desplegado.** Render sigue ejecutando la versión anterior hasta que esta rama
se integre a la rama que despliega Render. No se modificó la conexión de WhatsApp.

## Resumen de lo que cambió

| # | Prioridad | Qué se hizo | Archivos |
|---|---|---|---|
| 1 | Logs mínimos | Los logs ya no contienen texto de mensajes, transcripciones, nombres, fechas de citas ni números de teléfono. El paciente aparece con un seudónimo estable (`p-1a2b3c4d`) y las citas con un identificador corto (`ev-xxxxxxxx`). Los errores de proveedores pasan por un filtro que quita los números largos. Las alertas al equipo ya no copian el mensaje del paciente. | server.js, calendar.js, recordatorios.js, privacidad.js |
| 2 | Conservación | El historial temporal se borra de memoria a las 24 h de inactividad (revisión cada 15 min). Para las citas y los logs no se fijó un plazo: queda pendiente de decisión jurídica y administrativa (ver `POLITICA-CONSERVACION.md`). Hay una herramienta para depurar citas cuando se decida el plazo. | privacidad.js, server.js, scripts/conservacion.js |
| 3 | ARCO | El bot reconoce las solicitudes sobre datos personales, responde con un texto fijo que remite al correo, no las pasa a la IA y avisa al equipo. Hay una herramienta para el personal que busca y anonimiza las citas de un paciente, con modo de prueba, folio obligatorio y línea de registro (ver `PROCEDIMIENTO-ARCO.md`). | privacidad.js, server.js, calendar.js, scripts/arco.js |
| 4 | Aviso simplificado | Se envía antes del primer mensaje de cada conversación (en urgencias, después de la indicación de acudir a urgencias). | privacidad.js, server.js |
| 5 | Datos sensibles | **Bloqueados para la IA por omisión** (`PERMITIR_DATOS_SENSIBLES_IA` apagado). Las notas de voz ya no se descargan ni se transcriben. Los mensajes con términos clínicos y las urgencias se responden con textos fijos, sin OpenAI y sin guardarlos en el historial. Las instrucciones de la IA la limitan a funciones administrativas. El diseño del consentimiento está en `CONSENTIMIENTO-DATOS-SENSIBLES.md`. | privacidad.js, server.js, system-prompt.md |
| 6 | Reseñas y baja | La solicitud de reseña queda **apagada por omisión** (`RESENAS_ACTIVAS`). El paciente puede responder BAJA para dejar de recibir confirmaciones, recordatorios y reseñas automáticas. | recordatorios.js, calendar.js, server.js |
| 7 | Proveedores | Revisión documental de los acuerdos de tratamiento y las transferencias (`PROVEEDORES-Y-TRANSFERENCIAS.md`). No es código: requiere trámites del responsable. | docs |

## Variables de entorno nuevas (Render)

| Variable | Valor recomendado | Efecto |
|---|---|---|
| `LOG_SALT` | Una cadena aleatoria larga y secreta | Mantiene el mismo seudónimo de cada paciente entre reinicios. Sin ella, el seudónimo cambia en cada reinicio (sigue siendo seguro, solo es menos útil para diagnosticar). |
| `PERMITIR_DATOS_SENSIBLES_IA` | **No definirla** | Solo `true` cuando exista el mecanismo de consentimiento aprobado jurídicamente. |
| `RESENAS_ACTIVAS` | **No definirla** | `true` activa la solicitud de reseña (respeta la BAJA). |
| `AVISO_PRIVACIDAD_URL` | `https://internistamarco.com/privacidad` (valor por omisión) | Enlace del aviso integral. |
| `CORREO_PRIVACIDAD` | `contacto@internistamarco.com` (valor por omisión) | Correo para solicitudes ARCO. |

`AUDIO_ACTIVO` se conserva, pero ya no basta: las notas de voz solo se transcriben si
además `PERMITIR_DATOS_SENSIBLES_IA=true`.

## Qué notará el paciente cuando se despliegue
- El primer mensaje de cada conversación llega precedido del aviso simplificado.
- Si menciona síntomas, padecimientos, medicamentos o resultados, recibe un texto fijo: el asistente solo atiende temas administrativos y el personal le responderá.
- Si manda una nota de voz, recibe un texto fijo: el asistente no escucha audios y el personal la revisará.
- **Consecuencia operativa:** el equipo recibirá más alertas para responder personalmente, sobre todo notas de voz y mensajes con síntomas. Conviene medirlo la primera semana.

## Límites conocidos (no ocultarlos)
1. **El filtro clínico es por palabras clave.** Detecta los casos comunes (hay 12 ejemplos clínicos y 13 administrativos en las pruebas), pero no detecta faltas de ortografía raras, otros idiomas ni descripciones indirectas ("me siento como la otra vez"). Lo que no detecte llega a OpenAI. Reduce el riesgo, no lo elimina.
2. **Falsos positivos:** un paciente que pregunta "¿atienden diabetes?" recibe el texto fijo en vez de la lista de padecimientos. Se prefirió bloquear de más.
3. **Meta sí recibe todo**, porque es el canal (mensajes, audios, fotos). Ningún filtro del bot puede evitarlo.
4. **La baja (BAJA) se guarda en las citas del paciente.** Si el paciente no tiene citas creadas por el bot, la baja no se puede guardar sola: el equipo recibe una alerta para registrarla (ver procedimiento ARCO). Si sus citas se anonimizan, la preferencia se pierde.
5. **Mensajes con "valoración preoperatoria"** siguen llegando a la IA porque son necesarios para agendar. Revelan indirectamente que habrá una cirugía: punto para revisión jurídica.
6. **Logs anteriores:** los logs que Render ya guardó con la versión anterior contienen fragmentos de mensajes y no se borran con este cambio. Caducan según el plan de Render.

## Observado y no corregido (fuera del alcance)
- La alerta "citas próximas sin confirmar" se reenvía en cada revisión (cada 15 min) mientras la cita siga sin confirmar. Es un comportamiento anterior; conviene limitarla a una vez al día.

## Pruebas
`npm test`: 41 pruebas (node:test, sin dependencias nuevas).
- `test/privacidad.test.js`: filtros clínico, urgencia, ARCO y BAJA con ejemplos reales; seudónimos; limpieza de errores; purga del historial; aviso simplificado.
- `test/calendario.test.js`: calendario simulado con paginación; búsqueda por teléfono; anonimización sin datos residuales y con `update` (no `patch`); baja; selección para conservación.
- `test/scripts.test.js`: modo de prueba, folio obligatorio, exclusión de citas manuales, registro sin teléfono, ausencia de plazo predeterminado.
- `test/recordatorios.test.js`: respeto de la BAJA, reseña apagada, horario prudente.
- `test/servidor.test.js`: levanta el servidor real con WhatsApp y OpenAI simulados y verifica qué recibe cada proveedor, el aviso simplificado, las alertas sin contenido y que **ningún texto ni número de paciente aparece en los logs**.
