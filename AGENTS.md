# Conectar un agente

Empieza leyendo Documentación → API (https://frescofresco.github.io/arquitectura-reservas/) y el contrato que ya está en el repo. No inventes rutas.

El token se obtiene en la página, Documentación → Conectar un agente, con el botón Generar token. La persona confirma con la cuenta de GitHub que puede escribir en FrescoFresco/arquitectura-reservas. El token pertenece a esa cuenta; pégalo solo en el agente, en GITHUB_TOKEN. No va en el HTML ni en el repo.

Puede modificar tres cosas. Cada cambio es una versión nueva y no pisa la anterior: Bloques (documento o versión), el flujo del mapa, y una tabla de tabla-activación (reglas o pasos, solo esa tabla). También puede eliminar un bloque. La confirmación solo está en la página; la API elimina directo cuando el agente lo pide.

El cliente de referencia es `scripts/subir.js`. Lee el índice antes de escribir.
