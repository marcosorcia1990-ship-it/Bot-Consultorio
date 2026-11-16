# Consentimiento para datos sensibles (salud): diseño y estado

**Estado: NO RESUELTO.** Mientras no se resuelva, el bot opera en modo administrativo:
`PERMITIR_DATOS_SENSIBLES_IA` está apagado. No es una decisión técnica: la base jurídica
la define el abogado. Aquí se describen el problema y las opciones.

## El problema
- La ley de protección de datos personales en posesión de los particulares exige, para los datos sensibles (salud), consentimiento **expreso y por escrito** del titular, ya sea con firma autógrafa, firma electrónica o un mecanismo de autenticación, salvo las excepciones de la ley. **[VERIFICAR la redacción vigente tras la reforma de 2025.]**
- Por WhatsApp los pacientes mandan síntomas, resultados y audios sin que se les pida. Antes de este cambio, todo eso llegaba a OpenAI (en Estados Unidos) sin ningún consentimiento.

## Lo que hace hoy el código (modo administrativo)
1. Las notas de voz no se descargan ni se transcriben: el personal las escucha en la app.
2. Los mensajes con términos clínicos se responden con un texto fijo, no llegan a OpenAI y no entran al historial.
3. Las urgencias reciben la indicación fija de acudir a urgencias.
4. La IA tiene instrucción de no preguntar ni repetir información de salud.
5. El aviso simplificado pide no enviar información de salud por este medio.

**Lo que esto no resuelve:**
- Meta recibe todo, porque es el canal.
- El filtro no detecta el 100% de los casos.
- El dato "valoración preoperatoria" sigue llegando a la IA.

## Opciones para el abogado

### Opción A: mantener el modo administrativo (recomendada por ahora)
- El bot no trata datos de salud de forma intencional. Los que llegan de forma incidental los atiende una persona.
- Preguntas para el abogado:
  - ¿Basta con el aviso simplificado y la advertencia, considerando que el paciente envía los datos por iniciativa propia?
  - ¿Cómo se trata lo que el filtro no detecta?
  - ¿"Valoración preoperatoria" es dato sensible en este contexto?

### Opción B: consentimiento expreso antes de cualquier tratamiento por IA
Flujo propuesto (no implementado):
1. Cuando el filtro detecta información de salud, el bot no la procesa. Envía un mensaje con botones: *"Para que nuestro asistente digital pueda leer información sobre su salud, necesitamos su consentimiento expreso. La información se procesará con OpenAI (Estados Unidos) para redactar respuestas administrativas; no se emitirá consejo médico. [Acepto] [No acepto]"* y el enlace al aviso integral.
2. Solo con "Acepto" y para ese número se habilita el procesamiento.
3. **Requiere registrar el consentimiento** (número, fecha y hora, versión del aviso, texto aceptado, identificador del mensaje), es decir, **almacenamiento persistente que hoy no existe**, y un procedimiento de revocación.
4. Preguntas para el abogado:
   - ¿Un botón de WhatsApp es un "mecanismo de autenticación" válido para el consentimiento por escrito?
   - ¿Cómo se acredita que quien pulsa el botón es el titular, por ejemplo en familias que comparten teléfono?

### Opción C: reducir la exposición del proveedor
Combinable con A o B:
- Firmar el DPA de OpenAI y solicitar Zero Data Retention.
- O usar un proveedor de IA con acuerdo de tratamiento y servidores en una jurisdicción aceptada por el abogado.

## Regla para el futuro
`PERMITIR_DATOS_SENSIBLES_IA=true` solo se activa cuando:
1. el abogado aprobó por escrito la base jurídica;
2. el mecanismo de consentimiento (opción B u otro) está implementado y probado;
3. los acuerdos de tratamiento con los proveedores están firmados (`PROVEEDORES-Y-TRANSFERENCIAS.md`);
4. el aviso integral se actualizó para describirlo.
