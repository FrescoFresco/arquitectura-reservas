# Agente y catálogos

Empieza leyendo Documentación → API y el contrato que ya está en el repo. No inventes rutas.

El acceso de un agente de trabajo se concede en Catálogos → Agentes → **+ Agente** (instrucciones + clave `inv_…`). La clave **no caduca**. El agente se registra solo y late para aparecer En línea. No uses un flujo de «Generar token» en Documentación: ya no está en la página.

Puede modificar: Skills (documento o versión en `catalogo/skills/`), Campos ancla (`catalogo/campos-ancla/`), Campos MongoDB (`catalogo/campos-mongodb/`), Proyectos (`catalogo/proyectos/`) y Fundamentos (`catalogo/fundamentos/`). Cada cambio es una versión nueva y no pisa la anterior. También puede eliminar una skill. La confirmación solo está en la página; la API elimina directo cuando el agente lo pide. Un proyecto guarda las skills asociadas por id en `skills` (many-to-many).

Catálogo Agentes (`catalogo/agentes/`): solo registro + latido. No hay cola de comentarios todavía.

La página ya no edita el mapa: los archivos en `mapa/` pueden seguir en el repo, pero no hay hub ni contrato de edición del mapa en la UI.

En la UI de Skills: **Editar** modifica el contenido y al guardar crea una versión nueva solo si markdown o anclas cambiaron; **Subir versión** carga un documento completo como versión nueva. Ver skill y las fichas de ancla/Mongo se abren en popup. Cada versión y cada campo llevan un `hash` estable en el índice.

El cliente de referencia es `scripts/subir.js`. Lee el índice antes de escribir.
