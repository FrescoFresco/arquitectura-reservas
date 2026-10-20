# Generar script

<!-- Las tablas entre marcas «generado» las escribe `npm run generar` desde el catálogo. No las edites a mano. -->

## Versión

1

## Instrucción

A partir del recorrido de la Entrada, escribe a la vez el script de Playwright y el JSON Schema de los parámetros de su función.

**El script** es un módulo JavaScript sin `import`, con dos funciones exportadas:

```js
export async function hastaB(page, params, registrar) { … return { estado, referencia, alternativas, motivo }; }
export async function confirmar(page) { … }
```

- Cuando se llama a `hastaB`, el ejecutor ya ha abierto `proceso.url_inicio` en `page`.
- `hastaB` sigue los pasos del recorrido, rellena el formulario con `params` y se para en B. **Nunca pulsa el botón de confirmar.**
- Llama a `registrar('…')` en cada paso, con frases cortas en español.
- `hastaB` siempre devuelve las 4 claves:
  - `{ estado: 'disponible', referencia: null, alternativas: [], motivo: null }` al llegar a B;
  - `estado: 'sin_hueco'` si la web muestra el mensaje de sin hueco, con las alternativas que ofrezca (lista de textos);
  - `estado: 'error'` con `motivo: 'obstaculo'` si aparece un obstáculo; nunca lo esquives.
- Ante algo inesperado, lanza un `Error` con un mensaje claro: el ejecutor lo convierte en `error` / `fallo_recorrido`.
- `confirmar(page)` solo pulsa el botón de confirmar. El ejecutor únicamente la llama con la compuerta abierta, y en esta fase nunca.
- Usa los selectores del recorrido. Espera a los elementos con los localizadores de Playwright, nunca con pausas fijas, salvo que el recorrido explique que hacen falta.

**El JSON Schema** describe lo que hay que pedir al cliente:
- `type: "object"` con `properties`, `required` y `additionalProperties: false`;
- una `description` en español por parámetro, que el agente de voz leerá;
- un `examples` con un valor de prueba;
- la fecha con `format: "date"` (AAAA-MM-DD, día local del negocio) y la hora con `pattern` HH:MM.

Lo propio de este formulario (alérgenos, trona, zona…) va aquí como parámetro, no al catálogo.

`version.funcion.nombre` va en snake_case, por ejemplo `reservar_mesa`.

## Entrada

<!-- generado:entrada -->
| Campo | Tipo | Descripción |
|---|---|---|
| `negocio.zona_horaria` | zona_horaria | Zona horaria IANA del local; todas las horas de reserva se interpretan en ella. |
| `proceso.url_inicio` | url | Punto A: URL donde empieza la reserva. El ejecutor abre esta URL antes de correr el script. |
| `proceso.alcance` | enum: hasta_B, completo | Hasta dónde se permite llegar: hasta_B (formulario relleno, sin confirmar) o completo (confirmar con la compuerta abierta). |
| `version.recorrido.sistema.nombre` | texto | Sistema de reservas que hay detrás del formulario (CoverManager, TheFork, un plugin de WordPress, formulario propio…). |
| `version.recorrido.sistema.evidencia` | texto_largo | Qué se vio en la página (dominios, scripts, clases, iframes) que permite afirmar el sistema. |
| `version.recorrido.llega_a_b` | booleano | true si al mapear se llegó a B: formulario relleno, sin errores y con el botón de confirmar a la vista. |
| `version.recorrido.pasos.N.accion` | texto | Qué se hace en este paso, en lenguaje claro (abrir, pulsar, elegir, esperar…). |
| `version.recorrido.pasos.N.selector` | texto | Selector de Playwright del elemento sobre el que se actúa; null si el paso no actúa sobre un elemento. |
| `version.recorrido.pasos.N.url` | url | URL de la página en la que ocurre el paso. |
| `version.recorrido.campos.N.nombre` | texto | Etiqueta visible del campo del formulario. |
| `version.recorrido.campos.N.selector` | texto | Selector de Playwright que encuentra el campo de forma única. |
| `version.recorrido.campos.N.control` | enum: texto, email, telefono, numero, fecha, hora, select, checkbox, radio, textarea, otro | Tipo de control con el que se rellena el campo. |
| `version.recorrido.campos.N.obligatorio` | booleano | true si la web no deja avanzar sin este campo. |
| `version.recorrido.campos.N.evidencia` | texto | Cómo se sabe si es obligatorio: asterisco, atributo required, mensaje de error al dejarlo vacío… |
| `version.recorrido.campos.N.valor_prueba` | texto | Valor de prueba con el que se rellenó al mapear. |
| `version.recorrido.obstaculos.N.tipo` | enum: captcha, login, pago, otro | Control que no se esquiva: se anota y se para. |
| `version.recorrido.obstaculos.N.descripcion` | texto | Qué es el obstáculo y en qué paso aparece. |
| `version.recorrido.obstaculos.N.evidencia` | texto | Lo que se vio en la página (texto, iframe, script) que lo demuestra. |
| `version.recorrido.boton_confirmar.selector` | texto | Selector de Playwright del botón que envía la reserva. Nunca se pulsa hasta B. |
| `version.recorrido.boton_confirmar.texto` | texto | Texto visible del botón que envía la reserva. |
| `version.recorrido.mensaje_sin_hueco` | texto_largo | Texto que muestra la web cuando no hay hueco para la fecha, hora o personas pedidas; null si no se ha visto. |
<!-- /generado:entrada -->

<!-- valores -->

## Reglas de anclaje

- Escribe solo los campos de la tabla «Campos ancla», uno por línea: `_ruta.del.campo_: valor`.
- El script y el JSON Schema son textos largos: deja vacío el valor y escríbelos en las líneas siguientes, entre dos líneas con tres comillas invertidas.
- `null` si no hay dato; nunca inventes.
- Si necesitas un campo que no existe, escríbelo como `_propuesta.ruta.del.campo_: valor` y explica en la Explicación por qué hace falta.

## Campos ancla

<!-- generado:campos -->
| Campo | Tipo | Nivel | Descripción |
|---|---|---|---|
| `version.script` | texto_largo | estable | Módulo JavaScript con las funciones hastaB(page, params, registrar) y confirmar(page). |
| `version.funcion.nombre` | texto | estable | Nombre de la función que expondrá el agente de voz. |
| `version.funcion.parametros` | json | flexible | JSON Schema de los parámetros de la función: lo que hay que pedir al cliente. |
<!-- /generado:campos -->

## Resultado

Un fichero `.md` con dos secciones y nada más:

1. `## Explicación`: cómo traduce el script cada paso del recorrido, qué parámetros pide y por qué.
2. `## Salida`: las líneas de anclaje.
