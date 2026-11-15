# Evidencia de funcionamiento real (21 de julio a 14 de agosto de 2026)

Fuente: exportación de WhatsApp "Chat de WhatsApp con +1 (555) 188-9369" (267 mensajes),
entregada por el responsable el 15 de noviembre de 2026. **La exportación no se guarda en el repositorio**
porque contiene nombres y teléfonos.

## 1. Qué versión del código funcionaba
- `main` tiene 50 commits entre el 20 y el 27 de julio. El último es **`3de77fe`** (27 de julio, 12:22). Después no hubo commits, y la conversación sigue hasta el **14 de agosto**.
- **Del 27 de julio al 14 de agosto funcionó `3de77fe`**, la misma versión que hoy despliega producción (`main`).
- Del 21 al 27 de julio funcionaron versiones intermedias. Las fechas del historial cuadran con la conversación:

| En la conversación | En Git |
|---|---|
| 24 jul 22:10: reprogramación localizando la cita por nombre | `buscar_cita_por_nombre` agregado el 24 jul 20:37 (24f5d26) |
| 24 jul 23:29: multimedia contestado como texto (probable nota de voz transcrita) | `transcribirAudio` agregado el 24 jul 23:09 (801ddeb) |
| 24 jul 23:29: "Permítanos confirmar la disponibilidad del Dr. Constantino" | La regla para cuando piden otro médico llegó el 24 jul 23:50 (3f37296) |

## 2. ¿`1177667488770694` es el número de prueba anterior?
**Probable, no demostrado.**

A favor:
- Las respuestas del bot salen desde el número de `PHONE_NUMBER_ID` (`server.js`). Producción despliega `main` y hoy tiene `PHONE_NUMBER_ID=1177667488770694`. Si esa variable no cambió desde agosto, ese es el identificador de +1 555 188 9369.
- La consulta a Meta devuelve el error 100/33, que es lo esperado si ese número ya no existe o pertenece a una cuenta o app que su token no ve.
- La exportación termina el 29 de octubre con el aviso de "cifrado de extremo a extremo". Es compatible con que ese número haya dejado de estar en la Cloud API, pero no lo prueba.

Cómo confirmarlo **sin tocar producción**:
1. **Render → `bot-consultorio-1ggd` → Events:** ver si hubo cambios de variables de entorno después del 14 de agosto. Si no los hubo, el identificador de agosto es el actual.
2. **Explorador de la API Graph:** `346101355218916/owned_whatsapp_business_accounts`, y para cada cuenta `ID/phone_numbers`. Buscar +1 555 188 9369 y su `id`.

Para la decisión práctica no importa: ese número **ya no responde** y no se volverá a usar.

## 3. Qué quedó comprobado en real (con `3de77fe` o anteriores)
| Función | Evidencia | ¿Cambió el código desde entonces? |
|---|---|---|
| Recibir y contestar por Cloud API (webhook y envío) | Toda la conversación | El envío y el webhook cambiaron (normalización, candados, filtros) |
| IA con herramientas de agenda | Horarios con filtros ("después de las 5", "por la tarde", "el lunes") | **`tools.js` igual**, salvo la validación de nombre agregada hoy |
| Google Calendar real: crear citas | Varias "CITA CONFIRMADA" | **Núcleo de `calendar.js` igual**; solo funciones nuevas |
| Reprogramar, incluso localizando la cita por nombre | 23, 24 y 26 de julio | Igual |
| Cancelar | 24 y 27 de julio | Igual |
| Plantilla de **recordatorio** | 12 ago 20:07 | Igual en el envío; **cambió el momento** (fallo corregido hoy) |
| Plantilla de **reseña** | 14 ago 7:37 | Igual; ahora **apagada por omisión** |
| Protocolo de urgencias y canalización de preguntas médicas | 22, 24 y 25 de julio | **Cambió:** ahora es un filtro local sin IA |
| Información, costos, estudios y facturación | Varias | Prompt casi igual (+ regla de alcance administrativo) |

**No hay evidencia de:**
- la plantilla de **confirmación con botones** Sí/No (ninguna cita se agendó con más de 36 h de anticipación);
- las **alertas al número interno**;
- **coexistence o ecos**;
- **persistencia** tras un reinicio.

## 4. Problemas reales que muestra la conversación (y su estado)
| Problema observado | Estado en 4576db3 + este commit |
|---|---|
| "Recordatorio de su cita **de hoy**" enviado a las **8:07 p. m. del día anterior** | **Corregido hoy:** solo se envía el mismo día desde las 7:30 (prueba con el caso real) |
| Cita creada a nombre de **"[Paciente de seguimiento]"**, que se repitió en el recordatorio y en la reseña | **Corregido hoy:** `crear_cita` rechaza nombres provisionales o genéricos (prueba con el caso real) |
| Síntomas detallados ("heces color beige…", "cefalea intensa…") enviados a OpenAI | Corregido el 14 de noviembre: filtro clínico local |
| La IA anunciaba "un momento por favor" y no respondía (21 de julio) | Ya corregido en `3de77fe` (regla "nunca anuncies, ejecuta") |
| "Hello World" en el chat | Son envíos de prueba desde el panel de Meta, no del bot |
| Mensajes repetidos sin respuesta (21 jul 22:47) | Riesgo de duplicados y concurrencia: ahora hay cola por chat y control de duplicados |

## 5. Qué cambió entre `3de77fe` y hoy
`tools.js`: solo la validación de nombre. `calendar.js`: solo funciones nuevas (ARCO, BAJA, conservación, candado demo) y el filtro de citas anonimizadas.
El resto, en orden de impacto en lo ya demostrado:
1. **`server.js` (reescrito en gran parte):** filtros de privacidad antes de la IA, aviso simplificado, notas de voz sin transcribir, logs mínimos, normalización de números, ecos persistentes, cola por chat, mensajes atrasados, pausa, panel, alta v4, modo demo.
2. **`recordatorios.js`:** BAJA, reseñas apagadas, logs mínimos y, desde hoy, el recordatorio el mismo día.
3. **Nuevos:** `privacidad.js`, `demo.js`, `estado.js`, `numeros.js`, `admin.js`, `meta.js`, `alta.js`, scripts ARCO y de conservación, 83 pruebas.
