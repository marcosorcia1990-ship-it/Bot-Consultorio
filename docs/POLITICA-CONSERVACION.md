# Política de conservación de datos del bot

Este documento distingue entre lo que ya está **implementado** y lo que requiere
**decisión del responsable con asesoría jurídica**. No se fijaron plazos sin justificación.

## 1. Historial temporal de conversación: IMPLEMENTADO — 24 horas

- **Qué es:** los últimos 8 mensajes administrativos de cada conversación, la cita localizada y la marca de "chat tomado por el equipo". Solo en la memoria del servidor.
- **Plazo:** se borra a las 24 h de la última actividad (revisión cada 15 minutos, así que el máximo real es 24 h 15 min), o antes si el servidor se reinicia.
- **Justificación:**
  - Necesidad: dar continuidad a una conversación en curso (por ejemplo, el paciente elige un horario varios mensajes después de pedirlo).
  - 24 h coincide con la ventana de atención de WhatsApp: pasado ese tiempo el bot ya no puede contestar libremente al paciente, así que el historial deja de ser útil.
  - Excepción: si el equipo tomó el chat, se conserva mientras dure esa marca (24 h desde la última intervención humana), para que el bot no vuelva a hablar.
- **No contiene** mensajes clínicos ni notas de voz: esos no entran al historial.

## 2. Citas en Google Calendar: PENDIENTE DE DECISIÓN

- **Situación actual:** se conservan indefinidamente. Las canceladas tampoco se borran.
- **Herramienta lista:** `node scripts/conservacion.js reporte --dias N` informa cuántas citas del bot superan N días. `anonimizar ... --folio CONS-AAAA-NNN --confirmar` les quita los datos personales. No tiene un plazo predeterminado.
- **Elementos para decidir el plazo (los valora el abogado):**
  - La agenda **no es el expediente clínico.** El expediente (NOM-004-SSA3-2012, conservación mínima de 5 años) se lleva en el sistema de expedientes. Esta herramienta solo toca Google Calendar y no debe usarse como sustituto de esa obligación.
  - Necesidades administrativas: aclarar cobros o facturas de una consulta, dar seguimiento a inasistencias y reprogramaciones, estadística de la agenda.
  - Obligaciones fiscales: verificar si alguna cita sirve de soporte de comprobantes fiscales. En principio el soporte es el CFDI, no la agenda.
  - Principio de proporcionalidad de la ley de datos personales: conservar solo el tiempo necesario para la finalidad.
  - La preferencia BAJA vive en las citas: al anonimizarlas, se pierde.
- **Pregunta concreta para el abogado:** ¿cuánto tiempo después de la cita se necesita conservar el nombre y el teléfono del paciente en la agenda, y para qué?

## 3. Registros técnicos (logs de Render): IMPLEMENTADO EL CONTENIDO, PLAZO DEL PROVEEDOR

- **Contenido:** mínimo. Tipo de evento, seudónimo del paciente, identificador corto de la cita, códigos de error. Sin textos, nombres, fechas de citas ni teléfonos.
- **Plazo:** lo fija el plan de Render. El código no puede borrar logs. **[VERIFICAR en el panel de Render cuántos días se conservan en el plan contratado.]**
- **Justificación:** diagnosticar fallas (mensajes que no se enviaron, errores de la agenda o de OpenAI) durante el periodo en que normalmente se detectan.
- **Pendiente:** los logs generados por la versión anterior contienen fragmentos de mensajes. Caducan con el plazo de Render.

## 4. Datos en proveedores: FUERA DE NUESTRO CONTROL DIRECTO

| Proveedor | Qué conserva | Plazo |
|---|---|---|
| Meta / WhatsApp | Mensajes y archivos en tránsito por la API | Según la política de Meta **[VERIFICAR]** |
| App WhatsApp Business (coexistence) | Historial completo de los chats en el teléfono y sus respaldos | Hasta que el personal borre el chat |
| OpenAI | Mensajes administrativos enviados al modelo | Según la política de la API, hasta 30 días para vigilar abusos **[VERIFICAR en la cuenta]** |
| WhatsApp interno de alertas | Alertas (ya sin contenido del paciente; sí con su número) | Hasta que el personal borre el chat |

## 5. Solicitudes ARCO
El registro de solicitudes lo lleva el personal **fuera de este repositorio** (ver `PROCEDIMIENTO-ARCO.md`). Su plazo de conservación también lo define el abogado.
