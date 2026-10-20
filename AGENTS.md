# Conectar un agente

Empieza leyendo Documentación → API (https://frescofresco.github.io/arquitectura-reservas/) y el contrato que ya está en el repo. No inventes rutas.

El token se obtiene en la página, Documentación → Conectar un agente, con el botón Generar token. La primera vez la persona confirma en GitHub. instálala solo en FrescoFresco/arquitectura-reservas. En ese navegador, los clics siguientes emiten otro token sin volver a GitHub. El token dura 1 hora. Pégalo en el agente, en GITHUB_TOKEN. No va en el HTML ni en el repo.

Puede modificar tres cosas. Cada cambio es una versión nueva y no pisa la anterior: Skills (documento o versión), Campos ancla (el índice en `catalogo/campos-ancla/`), y el flujo del mapa. También puede eliminar una skill. La confirmación solo está en la página; la API elimina directo cuando el agente lo pide.

En la UI de Skills: **Editar** modifica el contenido y al guardar crea una versión nueva; **Subir versión** carga un documento completo como versión nueva.

El cliente de referencia es `scripts/subir.js`. Lee el índice antes de escribir.
