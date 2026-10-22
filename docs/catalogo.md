# Catálogo de campos ancla

> Generado por `npm run generar` desde `catalogo/`. No lo edites a mano.

## negocio → colección `negocios` (ids `neg-…`)

| Campo | Tipo | Nivel | Escribe | Lee | Sensible | Estado | Alias | Descripción |
|---|---|---|---|---|---|---|---|---|
| `negocio.nombre` | texto | blindado | manual | mapear-recorrido | no | activo | `nombre_local` | Nombre comercial del local, tal como lo ve el cliente. |
| `negocio.url` | url_sin_pii | blindado | manual | mapear-recorrido | no | activo |  | Web principal del local. |
| `negocio.zona_horaria` | zona_horaria | blindado | manual | mapear-recorrido, generar-script, ejecutor | no | activo |  | Zona horaria IANA del local; todas las horas de reserva se interpretan en ella. |
| `negocio.telefono` | telefono | estable | manual | mapear-recorrido | no | activo | `telefono_local`, `contacto.telefono` | Teléfono público del local en formato E.164 (+34928565098). |

## proceso → colección `procesos` (ids `proc-…`)

| Campo | Tipo | Nivel | Escribe | Lee | Sensible | Estado | Alias | Descripción |
|---|---|---|---|---|---|---|---|---|
| `proceso.id_negocio` | id | blindado | manual | gestor | no | activo |  | Negocio al que pertenece este proceso de reserva. |
| `proceso.url_inicio` | url_sin_pii | blindado | manual, mapear-recorrido | mapear-recorrido, generar-script, ejecutor | no | activo |  | Punto A: URL donde empieza la reserva. El ejecutor abre esta URL antes de correr el script. |
| `proceso.alcance` | enum: hasta_B, completo | blindado | manual | mapear-recorrido, generar-script, ejecutor | no | activo |  | Hasta dónde se permite llegar: hasta_B (formulario relleno, sin confirmar) o completo (confirmar con la compuerta abierta). |
| `proceso.id_version_activa` | id | estable | gestor | ejecutor | no | activo |  | Versión aprobada que usa el ejecutor. Falta hasta la primera aprobación. |

## version → colección `versiones` (ids `ver-…`)

| Campo | Tipo | Nivel | Escribe | Lee | Sensible | Estado | Alias | Descripción |
|---|---|---|---|---|---|---|---|---|
| `version.id_proceso` | id | blindado | gestor | gestor, ejecutor | no | activo |  | Proceso al que pertenece esta versión. |
| `version.estado` | enum: borrador, aprobada, retirada | blindado | gestor | gestor, ejecutor | no | activo |  | borrador al crearse; aprobada cuando una persona la aprueba tras probarla hasta B; retirada cuando otra la sustituye. |
| `version.creada` | fecha | blindado | gestor | gestor | no | activo |  | Momento en que el gestor creó la versión. |
| `version.aprobacion.por` | texto | estable | gestor | gestor | no | activo |  | Persona que aprobó la versión. |
| `version.aprobacion.fecha` | fecha | estable | gestor | gestor | no | activo |  | Momento de la aprobación. |
| `version.recorrido.sistema.nombre` | texto | estable | mapear-recorrido | generar-script | no | activo |  | Sistema de reservas que hay detrás del formulario (CoverManager, TheFork, un plugin de WordPress, formulario propio…). |
| `version.recorrido.sistema.evidencia` | texto_largo | estable | mapear-recorrido | generar-script | no | activo |  | Qué se vio en la página (dominios, scripts, clases, iframes) que permite afirmar el sistema. |
| `version.recorrido.llega_a_b` | booleano | estable | mapear-recorrido | generar-script | no | activo |  | true si al mapear se llegó a B: formulario relleno, sin errores y con el botón de confirmar a la vista. |
| `version.recorrido.pasos.N.accion` | texto | blindado | mapear-recorrido | generar-script | no | activo |  | Qué se hace en este paso, en lenguaje claro (abrir, pulsar, elegir, esperar…). |
| `version.recorrido.pasos.N.selector` | texto | estable | mapear-recorrido | generar-script | no | activo |  | Selector de Playwright del elemento sobre el que se actúa; null si el paso no actúa sobre un elemento. |
| `version.recorrido.pasos.N.url` | url_sin_pii | estable | mapear-recorrido | generar-script | no | activo |  | URL de la página en la que ocurre el paso. |
| `version.recorrido.campos.N.nombre` | texto | blindado | mapear-recorrido | generar-script | no | activo |  | Etiqueta visible del campo del formulario. |
| `version.recorrido.campos.N.selector` | texto | blindado | mapear-recorrido | generar-script | no | activo |  | Selector de Playwright que encuentra el campo de forma única. |
| `version.recorrido.campos.N.control` | enum: texto, email, telefono, numero, fecha, hora, select, checkbox, radio, textarea, otro | estable | mapear-recorrido | generar-script | no | activo |  | Tipo de control con el que se rellena el campo. |
| `version.recorrido.campos.N.obligatorio` | booleano | blindado | mapear-recorrido | generar-script | no | activo |  | true si la web no deja avanzar sin este campo. |
| `version.recorrido.campos.N.clase` | enum: normal, texto_libre, identificador, sensible, consentimiento | blindado | mapear-recorrido | generar-script | no | activo |  | Qué clase de dato pide el campo: identificador (DNI, NIE, pasaporte), sensible (nombre, teléfono, email, salud), consentimiento (casilla de privacidad o condiciones), texto_libre (comentarios) y normal (el resto). Un identificador no lleva valor de prueba; cada consentimiento exige un parámetro const: true en la función. |
| `version.recorrido.campos.N.evidencia` | texto | estable | mapear-recorrido | generar-script | no | activo |  | Cómo se sabe si es obligatorio: asterisco, atributo required, mensaje de error al dejarlo vacío… |
| `version.recorrido.campos.N.valor_prueba` | texto | estable | mapear-recorrido | generar-script | no | activo |  | Valor de prueba con el que se rellenó al mapear. |
| `version.recorrido.obstaculos.N.tipo` | enum: captcha, login, pago, otro | blindado | mapear-recorrido | generar-script | no | activo |  | Control que no se esquiva: se anota y se para. |
| `version.recorrido.obstaculos.N.descripcion` | texto | blindado | mapear-recorrido | generar-script | no | activo |  | Qué es el obstáculo y en qué paso aparece. |
| `version.recorrido.obstaculos.N.evidencia` | texto | estable | mapear-recorrido | generar-script | no | activo |  | Lo que se vio en la página (texto, iframe, script) que lo demuestra. |
| `version.recorrido.boton_confirmar.selector` | texto | estable | mapear-recorrido | generar-script, ejecutor | no | activo |  | Selector de Playwright del botón que envía la reserva. Nunca se pulsa hasta B. |
| `version.recorrido.boton_confirmar.texto` | texto | estable | mapear-recorrido | generar-script | no | activo |  | Texto visible del botón que envía la reserva. |
| `version.recorrido.mensaje_sin_hueco` | texto_largo | estable | mapear-recorrido | generar-script | no | activo |  | Texto que muestra la web cuando no hay hueco para la fecha, hora o personas pedidas; null si no se ha visto. |
| `version.script` | texto_largo | estable | generar-script | ejecutor | no | activo |  | Módulo JavaScript con las funciones hastaB(page, params, registrar) y confirmar(page). |
| `version.funcion.nombre` | texto | estable | generar-script | ejecutor | no | activo |  | Nombre de la función que expondrá el agente de voz. |
| `version.funcion.parametros` | json | flexible | generar-script | ejecutor | no | activo |  | JSON Schema de los parámetros de la función: lo que hay que pedir al cliente. |

## ejecucion → colección `ejecuciones` (ids `ejec-…`)

| Campo | Tipo | Nivel | Escribe | Lee | Sensible | Estado | Alias | Descripción |
|---|---|---|---|---|---|---|---|---|
| `ejecucion.id_version` | id | blindado | ejecutor | gestor | no | activo |  | Versión cuyo script se ejecutó. |
| `ejecucion.modo` | enum: hasta_B, completo | blindado | ejecutor | gestor | no | activo |  | hasta_B nunca pulsa confirmar; completo solo con la compuerta abierta. |
| `ejecucion.parametros` | json | flexible | ejecutor | gestor | sí | activo |  | Parámetros con los que se llamó a la función (datos del cliente). |
| `ejecucion.inicio` | fecha | blindado | ejecutor | gestor | no | activo |  | Momento en que empezó la ejecución. |
| `ejecucion.fin` | fecha | estable | ejecutor | gestor | no | activo |  | Momento en que terminó la ejecución. |
| `ejecucion.ultima_url` | url_sin_pii | estable | ejecutor | gestor | no | activo |  | URL en la que estaba el navegador al terminar. |
| `ejecucion.traza.N.hora` | fecha | blindado | ejecutor | gestor | no | activo |  | Momento de esta línea de la traza. |
| `ejecucion.traza.N.mensaje` | texto | blindado | ejecutor | gestor | no | activo |  | Qué hizo o vio el script en ese momento. |
| `ejecucion.respuesta.estado` | enum: confirmada, pendiente_negocio, disponible, sin_hueco, error | blindado | ejecutor | gestor | no | activo |  | Resultado de la función. En modo hasta_B, disponible significa que se llegó a B. |
| `ejecucion.respuesta.referencia` | texto | estable | ejecutor | gestor | no | activo |  | Localizador de la reserva que da la web; null si no hay. |
| `ejecucion.respuesta.alternativas.N` | texto | estable | ejecutor | gestor | no | activo |  | Hueco alternativo que ofrece la web cuando no hay sitio. |
| `ejecucion.respuesta.motivo` | enum: fallo_recorrido, obstaculo, resultado_no_verificable | estable | ejecutor | gestor | no | activo |  | Por qué no salió bien; null si salió bien. |

## corrida → colección `corridas` (ids `corr-…`)

| Campo | Tipo | Nivel | Escribe | Lee | Sensible | Estado | Alias | Descripción |
|---|---|---|---|---|---|---|---|---|
| `corrida.plantilla` | texto | blindado | gestor | gestor | no | activo |  | Plantilla que siguió el agente. |
| `corrida.version_plantilla` | entero | blindado | gestor | gestor | no | activo |  | Versión de la plantilla. |
| `corrida.version_catalogo` | texto | blindado | gestor | gestor | no | activo |  | Huella del catálogo con el que se validó la respuesta. |
| `corrida.fecha` | fecha | blindado | gestor | gestor | no | activo |  | Momento en que el gestor guardó la corrida. |
| `corrida.id_negocio` | id | estable | gestor | gestor | no | activo |  | Negocio sobre el que trabajó el agente. |
| `corrida.id_proceso` | id | estable | gestor | gestor | no | activo |  | Proceso sobre el que trabajó el agente. |
| `corrida.id_version` | id | estable | gestor | gestor | no | activo |  | Versión que creó o completó el agente. |
| `corrida.entrada` | texto_largo | blindado | gestor | gestor | no | activo |  | Plantilla con la Entrada rellena, tal como la recibió el agente. |
| `corrida.respuesta` | texto_largo | blindado | gestor | gestor | no | activo |  | Respuesta del agente, tal cual. |
| `corrida.guardada` | booleano | blindado | gestor | gestor | no | activo |  | true si los valores se escribieron en su colección; false si el gestor encontró errores y no escribió nada. |
| `corrida.entendido` | json | flexible | gestor | gestor | no | activo |  | Lo que entendió el gestor: los valores válidos ya convertidos y anidados por colección. |
| `corrida.errores.N` | texto | estable | gestor | gestor | no | activo |  | Problema que encontró el gestor al leer la respuesta. |
| `corrida.propuestas.N.ruta` | texto | blindado | gestor | gestor | no | activo |  | Ruta del campo que propone el agente, sin el prefijo propuesta. |
| `corrida.propuestas.N.valor` | texto_largo | estable | gestor | gestor | no | activo |  | Valor que el agente dio al campo propuesto, tal cual. |
| `corrida.propuestas.N.estado` | enum: pendiente, aceptada, alias, rechazada | blindado | gestor | gestor | no | activo |  | Decisión de la revisión humana; pendiente hasta entonces. |
