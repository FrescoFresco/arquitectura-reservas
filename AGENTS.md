# Conectar un agente

Empieza leyendo Documentación → API (https://frescofresco.github.io/arquitectura-reservas/) y el contrato que ya está en el repo. No inventes rutas.

El token se obtiene en la página, Documentación → Conectar un agente, con el botón Generar token. La primera vez la persona confirma en GitHub. instálala solo en FrescoFresco/arquitectura-reservas. En ese navegador, los clics siguientes emiten otro token sin volver a GitHub. El token dura 1 hora. Pégalo en el agente, en GITHUB_TOKEN. No va en el HTML ni en el repo.

Puede modificar: Skills (documento o versión en `catalogo/skills/`), Campos ancla (`catalogo/campos-ancla/`), Campos MongoDB (`catalogo/campos-mongodb/`) y el flujo del mapa. Cada cambio es una versión nueva y no pisa la anterior. También puede eliminar una skill. La confirmación solo está en la página; la API elimina directo cuando el agente lo pide.

En la UI de Skills: **Editar** modifica el contenido y al guardar crea una versión nueva; **Subir versión** carga un documento completo como versión nueva. Ver skill y las fichas de ancla/Mongo se abren en popup.

El cliente de referencia es `scripts/subir.js`. Lee el índice antes de escribir.
