# Procedimiento para solicitudes ARCO y de eliminación de datos

**Es un procedimiento manual con revisión humana.** El bot solo reconoce la solicitud, responde con
un texto fijo que remite al correo y avisa al equipo. **El bot nunca elimina ni modifica datos por
una solicitud.** Este procedimiento debe revisarlo el abogado antes de usarse.

## Quién participa
- **Responsable:** Dr. Marco A. Mixteco (MARCO ANTONIO MIXTECO SORCIA). Aprueba cada eliminación.
- **Personal autorizado:** registra la solicitud, verifica la identidad y ejecuta los pasos técnicos.

## Paso 1. Recepción
- **Canal oficial:** contacto@internistamarco.com.
- Si la solicitud llega por WhatsApp o en persona, se le pide al titular enviarla por correo (el bot ya contesta así) o se levanta por escrito en el consultorio.
- Se asigna un **folio** con el formato `ARCO-AAAA-NNN` (por ejemplo, `ARCO-2026-001`).

## Paso 2. Registro
Se anota en el registro de solicitudes. Use `docs/plantilla-registro-arco.csv` como formato,
pero **guarde el registro fuera de este repositorio** (por ejemplo, en una hoja de cálculo privada
del consultorio): contiene datos personales.

## Paso 3. Verificación de identidad (antes de cualquier acción)
- El titular envía una identificación oficial vigente. Si actúa un representante: identificación de ambos y carta poder o documento que acredite la representación.
- Se comprueba que el nombre coincide con el de las citas y que el número de teléfono es el mismo con el que escribió o agendó.
- Si no se puede verificar, se le pide la información faltante y **no se ejecuta nada**.
- Se anota en el registro quién verificó y cuándo.

## Paso 4. Análisis y aprobación del responsable
Antes de eliminar, el responsable revisa:
- **No se eliminan expedientes clínicos.** El expediente (NOM-004-SSA3-2012) se conserva en su sistema propio durante el plazo legal. Este procedimiento solo cubre los datos del bot: agenda y chats.
- **No se elimina información sujeta a obligaciones legales**: comprobantes fiscales, información requerida por autoridades o necesaria para un litigio o una reclamación pendiente.
- Si procede total o parcialmente, se anota la decisión y su fundamento.

## Paso 5. Ejecución (solo con aprobación)
Con `CALENDAR_ID` y `GOOGLE_CREDENTIALS_JSON` disponibles, ya sea en una computadora del consultorio o en el Shell de Render:

1. **Buscar** (no modifica nada):
   `node scripts/arco.js buscar --telefono 2711234567`
2. **Simular** (no modifica nada):
   `node scripts/arco.js anonimizar --telefono 2711234567 --folio ARCO-2026-001`
3. **Aplicar**:
   `node scripts/arco.js anonimizar --telefono 2711234567 --folio ARCO-2026-001 --confirmar`
   - Por omisión solo toca las citas creadas por el bot. Las capturadas a mano por el equipo se tocan solo con `--incluir-manuales` y con autorización del responsable.
   - "Anonimizar" quita nombre, teléfono y descripción del evento y deja la fecha y la hora (para no liberar ni empalmar un horario por error) con el folio.
   - Copie la línea `REGISTRO: {...}` al registro de solicitudes.
4. **WhatsApp:** borrar a mano el chat del paciente en la app WhatsApp Business del consultorio y, si existen, las alertas sobre ese paciente en el WhatsApp interno.
5. **Memoria del servidor:** se borra sola a las 24 h de inactividad. Si se necesita de inmediato, reiniciar el servicio en Render.

**Lo que NO se puede borrar desde aquí** (se le informa al titular):
- Copias en Meta, OpenAI y los logs de Render: caducan según la política de cada proveedor.
- Respaldos del teléfono (Google Drive o iCloud) que contengan el chat: dependen de la configuración de respaldo del teléfono del consultorio.

## Paso 6. Respuesta al titular
Por correo, dentro del plazo legal **[PLAZO A CONFIRMAR POR EL ABOGADO]**, indicando qué se hizo, qué no y por qué. Se anota la fecha de respuesta.

## Solicitud de BAJA de mensajes automáticos
- Si el paciente responde BAJA por WhatsApp y tiene citas creadas por el bot, la baja se guarda sola.
- Si el equipo recibe la alerta de que **no se pudo registrar**, anotarla en el registro y, cuando el paciente tenga una cita creada por el bot, ejecutar:
  `node scripts/arco.js baja --telefono 2711234567`
