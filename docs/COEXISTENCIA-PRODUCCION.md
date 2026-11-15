# Conexión definitiva del número del consultorio (coexistence)

**No ejecutar hasta que Meta apruebe los permisos y la demo haya pasado la prueba real.**
Nada de esto se ha hecho. Es el plan listo para usarse.

## Qué queda listo en el código
| Necesidad | Dónde | Probado |
|---|---|---|
| Embedded Signup v4 con coexistence (evento con solo `waba_id`, cancelación y error) | `alta.js` | Pruebas automáticas con Meta simulado |
| Suscripción a webhooks y sincronización de contactos e historial (`smb_app_data`) | `alta.js` | Automáticas |
| Recepción de ecos de la app (`smb_message_echoes`) | `server.js` | Automáticas |
| Historial y contactos sincronizados no se contestan | `server.js` | Automáticas |
| Normalización de números mexicanos (521/52/10 dígitos) | `numeros.js` | Automáticas |
| Silencio persistente cuando contesta una persona (sobrevive reinicios) | `estado.js` | Automáticas, con reinicio simulado |
| Comprobación de intervención humana justo antes de responder | `server.js` | Automáticas (ruta del código) |
| Mensajes duplicados (mismo id) y mensajes atrasados | `server.js` | Automáticas |
| Cola por chat (mensajes seguidos en orden) | `server.js` | Automáticas |
| Interruptor de emergencia `BOT_PAUSADO` | `server.js` | Automáticas |
| Aviso al equipo fuera de la ventana de 24 h (plantilla) | `server.js` | **No probado** (requiere plantilla aprobada) |

**Límites conocidos:**
- Los duplicados se detectan en memoria. Si Meta reenvía un mensaje después de un reinicio, solo lo frena la regla de mensajes atrasados (15 minutos por omisión).
- El historial temporal de la conversación se pierde al reiniciar: el paciente puede tener que repetir el último dato. El silencio humano **no** se pierde.

## Plan de puesta en marcha ("modo sombra")
Requisitos: permisos aprobados y la prueba real de la demo (`RENDER-DEMO.md`, R1 a R10) completa.

1. **Calendario de estado de producción:** cree `Bot consultorio – estado` y compártalo con la cuenta de servicio de producción. **No** use el calendario de citas.
2. **Plantillas:** se crean **después** de conectar el número, porque requieren la WABA (ver `PLANTILLAS-WHATSAPP.md`).
3. **Código:** integre la rama a `main` con una revisión (pull request), **con estas variables ya puestas en Render antes del despliegue:**
   - `BOT_PAUSADO=true` (el bot arranca callado);
   - `RECORDATORIOS_ACTIVOS=false`;
   - `ADMIN_TOKEN`, `LOG_SALT` y `ESTADO_CALENDAR_ID`;
   - `META_APP_ID`, `META_APP_SECRET`, `META_CONFIG_ID` y `ALTA_MODO=coexistencia`;
   - **sin** `MODO_DEMO`.
4. **Conexión:** abra `/alta` en producción → Embedded Signup → escanee el código QR con la app WhatsApp Business del consultorio → acepte compartir el historial. Copie `WABA_ID`, `PHONE_NUMBER_ID` y el token (con el botón) a Render y reinicie.
5. **Modo sombra (1 o 2 días):** con `BOT_PAUSADO=true`, compruebe en los logs que llegan los mensajes (`📩`) y los ecos cuando Ade contesta (`👤 Chat tomado por el equipo`), y en `/admin/whatsapp` el estado del número. El bot no contesta nada.
6. **Encendido:** `BOT_PAUSADO=false`. Haga primero pruebas con teléfonos de la familia, después horario normal.
7. **Recordatorios:** cuando las plantillas estén aprobadas, `RECORDATORIOS_ACTIVOS=true`.

## Reversión ante fallos (de menor a mayor)
| Nivel | Acción | Efecto | Tiempo |
|---|---|---|---|
| 1 | Render → `BOT_PAUSADO=true` | El bot deja de contestar; la app WhatsApp Business sigue igual; se sigue registrando quién atiende | 1 a 2 min (reinicio) |
| 2 | `/admin/whatsapp` → "Quitar la suscripción" | Los mensajes dejan de llegar al servidor; la app sigue igual | Inmediato |
| 3 | Render → Rollback al despliegue anterior | Vuelve el código previo | 2 a 5 min |
| 4 | Desconectar la coexistence (WhatsApp Manager o, en la app, Configuración → Herramientas para la empresa → Plataforma de negocios) **[VERIFICAR la ruta exacta en la app]** | El número vuelve a ser solo de la app | Variable |

**Regla:** ante cualquier duda, nivel 1. Mientras exista coexistence, los pacientes siguen siendo atendidos desde la app, haga lo que haga el bot.

## Riesgos de la coexistence que debe aceptar
- Mientras esté activa, se desactivan los mensajes temporales, las fotos de "ver una vez" y la ubicación en tiempo real; editar y borrar mensajes queda limitado.
- Abrir la app WhatsApp Business al menos cada 14 días **[VERIFICAR el plazo vigente]**.
- Según un proveedor, durante la conexión se desvinculan los dispositivos enlazados (WhatsApp Web); hay que volver a enlazarlos.
- Los mensajes que salen por la API se cobran según las tarifas de la Cloud API; los de la app siguen siendo gratis.
