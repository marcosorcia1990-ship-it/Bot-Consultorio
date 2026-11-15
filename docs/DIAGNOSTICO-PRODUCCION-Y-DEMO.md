> **Documento reemplazado** (15 de noviembre de 2026). Para la operación vigente ver `docs/RENDER-DEMO.md`, `docs/META-REVISION-PERMISOS.md`, `docs/COEXISTENCIA-PRODUCCION.md` e `INFORME-EJECUTIVO.md`. Se conserva como historial.

# Diagnóstico: producción (main) frente a la rama de trabajo, y entorno de demo seguro

Fecha: 15 de noviembre de 2026. Solo lectura: no se hizo merge, ni despliegue, ni cambio en producción.

## 1. Diferencias entre `main` y `ccr-aa25d197-be722x`

- `main` = commit **3de77fe** ("Update system-prompt.md", 27 de julio de 2026). Es el código original.
- La rama sale de ese mismo commit y **main no tiene nada que la rama no tenga**: no hay conflictos.
- La rama agrega estos commits (del más antiguo al más reciente):

| Commit | Contenido |
|---|---|
| 9f43c1f | `.gitignore` (node_modules) |
| 3245022 | Página `/alta` (coexistence), corrección del silencio cuando el equipo contesta (formatos 521/52 y chats sin actividad), botones duplicados, "Sí" que revivía citas canceladas |
| c72d75f, 268ffcb | Aviso de privacidad y auditoría |
| e24ab52 | Privacidad: logs mínimos, salud fuera de la IA, ARCO, conservación, aviso simplificado, reseñas apagadas, BAJA, pruebas |
| 155d5b8 | Procedimiento del video para Meta |
| 1f0a12a | Token enmascarado en `/alta` y guía de verificación |
| *(este commit)* | Modo demo con candados (`demo.js`) y este diagnóstico |

## 2. ¿Qué está en GitHub y qué está en main?
- **Todo está en GitHub** en la rama `ccr-aa25d197-be722x`, incluido 1f0a12a.
- **Nada de lo anterior está en `main`.** Producción (Render, rama `main`) corre el código original, con estas consecuencias **hoy**:
  - Los logs de Render guardan fragmentos de los mensajes y de las transcripciones.
  - Las notas de voz se transcriben con OpenAI y los mensajes con síntomas se mandan a OpenAI.
  - No se envía aviso de privacidad.
  - Con `RECORDATORIOS_ACTIVOS=true`, cada 15 minutos revisa el **calendario real** y, si encuentra citas creadas por el bot, envía confirmaciones, recordatorios y **solicitudes de reseña** sin opción de BAJA.
  - Persisten los fallos del silencio humano (formatos 521/52) y el "Sí" que revive citas canceladas.

## 3. ¿Qué número es `PHONE_NUMBER_ID = 1177667488770694`?
**No se puede saber desde aquí**: esta sesión no tiene acceso a Meta. Tampoco aparece en el historial
del repositorio. Lo que sí se sabe:
- **No** es el número de prueba (1502573929596107).
- Según Meta, la app tiene **0 números de producción**. Puede ser un número de otra cuenta de WhatsApp del portafolio (hay 3), un número dado de baja o un número de una app anterior.

**Consulta de solo lectura para identificarlo** (Explorador de la API Graph, GET):
```
1177667488770694?fields=display_phone_number,verified_name,platform_type,status,code_verification_status
```
- Si responde con **+52 271 116 1448**: producción está configurada para enviar **desde el número real del consultorio**. Hay que tratarla con cuidado (ver el punto 5).
- Si responde con otro +1 555…: es un número de prueba de otra cuenta.
- Si da error de permisos o "no existe": es un número que ya no está disponible para esta app, y producción no puede enviar nada.

## 4. Riesgos de producción hoy (no se tocó nada)
1. **El webhook de la app apunta a producción.** Si alguien escribe al número de prueba, el mensaje llega a producción, que:
   - lo procesa con la IA usando el **calendario real** (puede crear o mover citas reales);
   - y contesta **desde 1177667488770694**, no desde el número de prueba.

   **No escriba al número de prueba hasta separar los webhooks (fase 3).**
2. **Recordatorios activos sobre el calendario real.** Si 1177… es un número que funciona y existen citas creadas por el bot, producción ya podría estar enviando mensajes a pacientes.

   **Consulta de solo lectura:** en Render → bot-consultorio-1ggd → **Logs**, busque `📤`, `Error enviando plantilla` y `Error al enviar mensaje` de los últimos días. Los logs de esa versión contienen fragmentos de mensajes de pacientes: no los comparta ni los capture completos.
3. Si el token de producción es un token temporal de 24 h, probablemente ya expiró y todos los envíos fallan. Eso protege por accidente, pero no es un control.

Si la consulta del punto 3 confirma que 1177… es el número real o que hubo envíos, **la decisión de
apagar `RECORDATORIOS_ACTIVOS` o `AGENDA_ACTIVA` en producción es suya**. Yo no la tomé.

## 5. Rama y commit para la demo
- **Rama:** `ccr-aa25d197-be722x`.
- **Commit:** el de este diagnóstico, que incluye `demo.js`. Compruébelo en GitHub o en Render → **Events** después del primer despliegue: el hash debe coincidir.
- **Auto-Deploy: No**, para que la demo no cambie sola.

## 6. Por qué la demo no puede tocar producción

### Aislamiento por configuración
- Un **servicio de Render distinto**, con sus propias variables.
- Una **cuenta de servicio de Google nueva** (`bot-demo`) compartida **solo** con el calendario "Demo bot (pruebas)". Aunque el código intentara leer `internista.marco@gmail.com`, Google respondería "sin acceso".
- Una **clave de OpenAI propia**, revocable.

### Candados en el código (`MODO_DEMO=true`, `demo.js`), con pruebas en `test/demo.test.js`

| Riesgo | Candado | Qué pasa si se configura mal |
|---|---|---|
| Usar el calendario real | Solo acepta calendarios `…@group.calendar.google.com` y rechaza los de `CALENDARIOS_PROHIBIDOS`. El calendario principal de Gmail (`internista.marco@gmail.com`) no cumple. | El servidor **no arranca** |
| Enviar recordatorios a pacientes | `RECORDATORIOS_ACTIVOS=true` está prohibido. En modo demo nunca se programan recordatorios y `/revisar-recordatorios` no hace nada. | El servidor **no arranca** |
| Enviar desde el número real | Al arrancar, consulta a Meta el número de `PHONE_NUMBER_ID`. Si no es +1 555… (número de prueba) o no se puede comprobar, se detiene. Hasta esa comprobación, todo envío queda bloqueado. | El servidor **se detiene** sin haber enviado nada |
| Escribir a pacientes | Solo envía a los teléfonos de `DEMO_DESTINATARIOS`. | El envío **se bloquea** |
| Procesar mensajes de pacientes reales | Descarta, **antes de procesarlos y de enviarlos a OpenAI**, los eventos de cualquier otro número del negocio y los mensajes de teléfonos no autorizados. | Se descartan |

**Lo que el código no puede garantizar:** que la clave de Google de la demo sea de verdad la cuenta
nueva y no la de producción. Por eso, después de crearla, revise en el calendario real
(Configuración → Compartir con personas específicas) que `bot-demo` **no** aparezca.

## 7. Procedimiento seguro (orden)
1. **Solo lectura:** la consulta del punto 3 (qué número es 1177…) y la revisión de los logs de producción del punto 4.2. Mándeme los resultados.
2. **No escribir** al número de prueba hasta el paso 6.
3. **Crear sin efectos sobre producción:** el calendario de demo, la cuenta de servicio `bot-demo`, la clave de OpenAI `demo-meta`, y verificar los teléfonos de prueba en "Configuración de la API".
4. **Crear el servicio `bot-consultorio-demo`** con las variables de `DEMO-VERIFICACION-Y-ENTORNO.md` (fase 2D, incluidas `MODO_DEMO`, `DEMO_DESTINATARIOS` y `CALENDARIOS_PROHIBIDOS`) y Auto-Deploy en No.
5. **Comprobar en los logs de la demo** la línea `🧪 MODO DEMO: número de origen verificado…`.
6. **Separar los webhooks (fase 3):** solo después de los pasos 1 y 5, y con su aprobación una vez explicadas las consecuencias según lo que salga en el paso 1.
