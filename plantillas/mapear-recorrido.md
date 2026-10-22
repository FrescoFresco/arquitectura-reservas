# Mapear recorrido

<!-- Las tablas entre marcas «generado» las escribe `npm run generar` desde el catálogo. No las edites a mano. -->

## Versión

2

## Instrucción

Recorre la web de reserva del negocio desde el punto A (`proceso.url_inicio`) hasta el punto B y descríbelo con los campos ancla.

- **B** es el formulario relleno, sin errores de validación y con el botón de confirmar a la vista, justo antes de enviar.
- **Nunca pulses el botón de confirmar ni envíes nada.** Si un botón intermedio («Continuar», «Siguiente») pudiera enviar la reserva, no lo pulses y explícalo.
- Rellena con datos de prueba evidentes (nombre «Prueba», email en `example.com`, teléfono +34 600 000 000). Usa una fecha de dentro de unos días, nunca hoy, y una hora dentro del horario del local en su zona horaria.
- Averigua qué sistema de reservas hay detrás (CoverManager, TheFork, un plugin de WordPress, formulario propio…) y anota qué lo demuestra.
- Recorre los pasos en orden: cada clic, cada elección y cada espera que haga falta para llegar a B.
- Para cada campo del formulario, di si es obligatorio y cómo lo sabes (asterisco, atributo `required`, error al dejarlo vacío). Usa selectores de Playwright estables (id, name, rol con nombre accesible) y comprueba que encuentran un único elemento.
- Da a cada campo su **clase**: `identificador` (DNI, NIE, pasaporte), `sensible` (nombre, teléfono, email, datos de salud), `consentimiento` (casilla de privacidad o condiciones), `texto_libre` (comentarios, peticiones) y `normal` (el resto). Un `identificador` no lleva valor de prueba: escribe `null`.
- Las URL no llevan datos personales en la query (nombre, teléfono, email, DNI…): si la web los pone ahí, escribe la URL sin ellos y explícalo.
- Si aparece un obstáculo (CAPTCHA, inicio de sesión, pago u otro control que no se debe esquivar), **no lo esquives**: anótalo y para ahí. Un formulario cerrado o sin fechas no es un obstáculo: cuéntalo en la Explicación.
- Si ves el mensaje de «sin hueco» (por ejemplo, eligiendo un día o una hora sin disponibilidad), cópialo literal. Si no lo ves, escribe `null`.
- Si `proceso.url_inicio` no es la URL donde empieza de verdad la reserva, escribe la correcta.

## Entrada

<!-- generado:entrada -->
| Campo | Tipo | Descripción |
|---|---|---|
| `negocio.nombre` | texto | Nombre comercial del local, tal como lo ve el cliente. |
| `negocio.url` | url_sin_pii | Web principal del local. |
| `negocio.zona_horaria` | zona_horaria | Zona horaria IANA del local; todas las horas de reserva se interpretan en ella. |
| `negocio.telefono` | telefono | Teléfono público del local en formato E.164 (+34928565098). |
| `proceso.url_inicio` | url_sin_pii | Punto A: URL donde empieza la reserva. El ejecutor abre esta URL antes de correr el script. |
| `proceso.alcance` | enum: hasta_B, completo | Hasta dónde se permite llegar: hasta_B (formulario relleno, sin confirmar) o completo (confirmar con la compuerta abierta). |
<!-- /generado:entrada -->

<!-- valores -->

## Reglas de anclaje

- Escribe solo los campos de la tabla «Campos ancla», uno por línea: `_ruta.del.campo_: valor`.
- En las listas, sustituye `N` por 1, 2, 3… sin huecos y en el orden del recorrido.
- `null` si no hay dato; nunca inventes. Booleanos: `true` o `false`. Fechas en ISO 8601 con hora y zona.
- Textos largos: deja vacío el valor y escríbelo en las líneas siguientes, entre dos líneas con tres comillas invertidas.
- Si necesitas un campo que no existe, escríbelo como `_propuesta.ruta.del.campo_: valor` y explica en la Explicación por qué hace falta.

## Campos ancla

<!-- generado:campos -->
| Campo | Tipo | Nivel | Descripción |
|---|---|---|---|
| `proceso.url_inicio` | url_sin_pii | blindado | Punto A: URL donde empieza la reserva. El ejecutor abre esta URL antes de correr el script. |
| `version.recorrido.sistema.nombre` | texto | estable | Sistema de reservas que hay detrás del formulario (CoverManager, TheFork, un plugin de WordPress, formulario propio…). |
| `version.recorrido.sistema.evidencia` | texto_largo | estable | Qué se vio en la página (dominios, scripts, clases, iframes) que permite afirmar el sistema. |
| `version.recorrido.llega_a_b` | booleano | estable | true si al mapear se llegó a B: formulario relleno, sin errores y con el botón de confirmar a la vista. |
| `version.recorrido.pasos.N.accion` | texto | blindado | Qué se hace en este paso, en lenguaje claro (abrir, pulsar, elegir, esperar…). |
| `version.recorrido.pasos.N.selector` | texto | estable | Selector de Playwright del elemento sobre el que se actúa; null si el paso no actúa sobre un elemento. |
| `version.recorrido.pasos.N.url` | url_sin_pii | estable | URL de la página en la que ocurre el paso. |
| `version.recorrido.campos.N.nombre` | texto | blindado | Etiqueta visible del campo del formulario. |
| `version.recorrido.campos.N.selector` | texto | blindado | Selector de Playwright que encuentra el campo de forma única. |
| `version.recorrido.campos.N.control` | enum: texto, email, telefono, numero, fecha, hora, select, checkbox, radio, textarea, otro | estable | Tipo de control con el que se rellena el campo. |
| `version.recorrido.campos.N.obligatorio` | booleano | blindado | true si la web no deja avanzar sin este campo. |
| `version.recorrido.campos.N.clase` | enum: normal, texto_libre, identificador, sensible, consentimiento | blindado | Qué clase de dato pide el campo: identificador (DNI, NIE, pasaporte), sensible (nombre, teléfono, email, salud), consentimiento (casilla de privacidad o condiciones), texto_libre (comentarios) y normal (el resto). Un identificador no lleva valor de prueba; cada consentimiento exige un parámetro const: true en la función. |
| `version.recorrido.campos.N.evidencia` | texto | estable | Cómo se sabe si es obligatorio: asterisco, atributo required, mensaje de error al dejarlo vacío… |
| `version.recorrido.campos.N.valor_prueba` | texto | estable | Valor de prueba con el que se rellenó al mapear. |
| `version.recorrido.obstaculos.N.tipo` | enum: captcha, login, pago, otro | blindado | Control que no se esquiva: se anota y se para. |
| `version.recorrido.obstaculos.N.descripcion` | texto | blindado | Qué es el obstáculo y en qué paso aparece. |
| `version.recorrido.obstaculos.N.evidencia` | texto | estable | Lo que se vio en la página (texto, iframe, script) que lo demuestra. |
| `version.recorrido.boton_confirmar.selector` | texto | estable | Selector de Playwright del botón que envía la reserva. Nunca se pulsa hasta B. |
| `version.recorrido.boton_confirmar.texto` | texto | estable | Texto visible del botón que envía la reserva. |
| `version.recorrido.mensaje_sin_hueco` | texto_largo | estable | Texto que muestra la web cuando no hay hueco para la fecha, hora o personas pedidas; null si no se ha visto. |
<!-- /generado:campos -->

## Resultado

Un fichero `.md` con dos secciones y nada más:

1. `## Explicación`: qué hiciste, qué viste y por qué decidiste cada cosa (obligatoriedad, sistema, obstáculos, URL de inicio).
2. `## Salida`: las líneas de anclaje.
