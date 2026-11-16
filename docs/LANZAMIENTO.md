# Lanzamiento: hoja de control

**Funcionalidad congelada** desde 72d37c7. Único cambio posterior: el bot arranca pausado por omisión fuera de la demo.

## Encender y apagar (Render → Environment → guardar; reinicia en ~1 min)
- **Apagar:** `BOT_PAUSADO=true` (o borrar la variable). El bot no contesta; la app WhatsApp Business sigue funcionando.
- **Encender:** `BOT_PAUSADO=false`.
- **Corte total inmediato:** `/admin/whatsapp` → "Quitar la suscripción" (dejan de llegar mensajes al servidor).

## Antes de integrar a `main` (solo con su autorización)
1. En producción (`bot-consultorio-1ggd`): `RECORDATORIOS_ACTIVOS=false`.
2. Borrar del calendario real las citas de prueba de julio y agosto que tengan fecha futura.
3. Agregar `ADMIN_TOKEN`, `LOG_SALT`, `ESTADO_CALENDAR_ID` (un calendario de estado nuevo, compartido con la cuenta de servicio de producción) y **no** definir `BOT_PAUSADO`.
4. Pull request `ccr-aa25d197-be722x` → `main` y merge. El bot desplegado queda **pausado**.

## Conexión del número real (solo con su autorización, después de la aprobación de Meta)
Seguir `docs/COEXISTENCIA-PRODUCCION.md`: `/alta` → modo sombra (pausado) → `BOT_PAUSADO=false` → plantillas → recordatorios.
