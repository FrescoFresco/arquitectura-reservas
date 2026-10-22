# Sistema de reservas: contexto del proyecto

Lee esto antes de trabajar. Es el plan acordado; si algo de lo que te piden choca con él, dilo antes de hacerlo.

## Objetivo

Un agente de voz reserva mesas en la web de reserva que ya tiene cada restaurante, mediante un script de Playwright. Confirma al cliente por SMS con la forma de cancelar, y un sistema de vigilancia detecta cuándo cambia la web.

Orden de trabajo: primero la arquitectura, con un solo negocio (Rincón del Amazonas, Puerto de Mogán). La voz y el SMS se enganchan al final. Se empieza con pocos pasos encadenados y se añaden solo cuando hacen falta.

## El recorrido de una reserva

- **A:** la URL donde empieza la reserva.
- **B:** el formulario relleno, sin errores y con el botón de confirmar a la vista, justo antes de enviar.
- **Confirmar:** una acción del script que solo se ejecuta si la compuerta está abierta.
- **C:** todo lo que pasa justo después de confirmar. Es un dato: se guarda entero en cada ejecución.

La observación y el script llegan hasta B. La primera reserva de prueba autorizada captura la C de referencia. Sin C de referencia, un proceso no se ofrece.

## Principios

1. **Los agentes juzgan; el código calcula, ejecuta y guarda.** Un agente convierte una web desordenada en datos. Horarios, compuerta, ejecutar el script, comparar resultados y enviar SMS son código.
2. **Un único catálogo de campos ancla** (`catalogo/`, en git) define todos los campos. De él se generan los validadores de MongoDB, las tablas de las plantillas `.md` y la documentación. No se escriben definiciones de campos en ningún otro sitio.
3. **La ruta de un ancla es el sitio donde se guarda.** La primera palabra es la colección en singular (`negocio`, `proceso`, `version`, `ejecucion`, `reserva`); el resto es la ruta dentro del documento. Las listas llevan `N` en la definición y un número en la salida.
4. **Los valores solo viven en MongoDB.** La instancia es el documento (`neg-…`, `proc-…`). Ningún agente escribe en la base de datos: entrega su `.md` y el gestor valida y guarda.
5. **Cada ejecución de un agente se guarda entera** en `corridas`: plantilla y versión, versión del catálogo, entrada, respuesta tal cual, lo que entendió el gestor y las propuestas. Así se puede volver a leer sin repetir el trabajo del agente.

## Formato de las plantillas y las respuestas

Cada plantilla `.md` tiene: título, Versión, Instrucción, Entrada, Reglas de anclaje, Campos ancla y Resultado. Las tablas de Entrada y Campos ancla se generan desde el catálogo, según lo que la plantilla lee y escribe.

La respuesta de un agente tiene solo dos secciones: **Explicación** (Markdown) y **Salida**, con una línea por dato:

```
_ruta.del.campo_: valor
```

- `null` si no hay dato; nunca inventar.
- Fechas en ISO 8601 con hora y zona.
- Los textos largos van en las líneas siguientes, entre dos líneas con ```.
- Un campo que no existe se propone como `_propuesta.ruta_: valor`, explicando en la Explicación por qué hace falta.

## Catálogo: cómo crece

- **Por diseño (lo normal):** el campo se añade al catálogo en el mismo cambio que la plantilla que lo usa.
- **Por propuesta de un agente:** el gestor guarda los campos válidos y aparta las propuestas. Nunca se registran solas.
- **Revisión a mano** (`npm run propuestas`): agrupa las propuestas por ruta, con cuántas veces y en cuántos negocios han aparecido, ejemplos y los campos parecidos (comparando rutas y descripciones, sin IA). Para cada una se decide:
  - **aceptar:** si cae en una zona flexible, basta con añadirla; si es estructural, se decide entre los dos y se actualiza el validador;
  - **asociarla a un campo existente:** queda como alias;
  - **rechazarla:** queda apuntada para que no vuelva a proponerse.
- **Relleno hacia atrás:** al aceptar un campo, `npm run releer` lo rellena en las corridas antiguas.
- **Nunca se borra:** un campo pasa a `obsoleto` con `sustituido_por`.
- **Lo propio de cada formulario no va al catálogo:** alérgenos, trona o zona son parámetros de la función de ese proceso (JSON Schema dentro de la versión). El catálogo guarda lo que comparten todos los negocios, por eso converge.
- **Criterio para aceptar (armonía):**
  - ¿ya existe con otro nombre?
  - ¿es del negocio, del proceso o de la versión?
  - ¿sirve para más de un negocio?
  - ¿tiene la profundidad mínima que deja claro su significado?
  - ¿es un dato personal?

## Agentes (plantillas), por fases

1. **Ahora:**
   - `mapear-recorrido`: de A a B; los campos con su evidencia y si son obligatorios, los obstáculos, el botón de confirmar y el mensaje de «sin hueco».
   - `generar-script`: el script de Playwright y el JSON Schema de sus parámetros, a la vez.
2. **Cuando haya C:** `clasificar-c`, que decide si una pantalla C significa «confirmada» o «pendiente del negocio» y fija la C de referencia.
3. **Al dar de alta el segundo negocio:** `descubrir-negocio` (identidad, contactos, inicios de reserva, cancelación) y `horario` (reglas, festivos, vacaciones con fecha, cierre de cocina y contradicciones entre fuentes). Hasta entonces, los datos del negocio se meten a mano.
4. **Con la vigilancia:** `diagnosticar-alerta`.

Por ahora el agente es Claude Code siguiendo la plantilla y pasando siempre por el gestor. Más adelante lo hará la API.

## Código (no agentes)

- **Ejecutor:** corre el script aprobado en modo «hasta B» o «completo». Guarda la traza, la última URL y la pantalla C, y devuelve la respuesta de 4 claves.
- **Respuesta de la función:** siempre 4 claves.
  - `estado`: `confirmada`, `pendiente_negocio`, `disponible`, `sin_hueco` o `error`;
  - `referencia`: texto o null;
  - `alternativas`: lista de textos;
  - `motivo`: `fallo_recorrido`, `obstaculo`, `resultado_no_verificable` o null.
- **Compuerta:** solo se abre con versión aprobada, C de referencia, local abierto con margen, ninguna alerta abierta y canal de cancelación. Si está cerrada, la respuesta es `disponible` y se guarda el motivo.
- **Clasificador de C, evaluador de horario, mensajero SMS, endpoint de la función y cron de vigilancia:** todo código.

## Mantenimiento cero

El día a día es determinista. Los agentes son el equipo de reparación:
1. La vigilancia ejecuta cada script hasta B y lo compara con lo aprobado.
2. Si el camino cambió, se vuelven a lanzar `mapear-recorrido` y `generar-script`, y el resultado se prueba hasta B.
3. Si los parámetros de la función no cambian y se llega a B, la versión nueva se aprueba sola.
4. Pasa por una persona solo si cambian los datos que hay que pedir al cliente o si C deja de coincidir.

Al escalar, el mantenimiento crece con el número de sistemas de reserva distintos (CoverManager, TheFork…), no con el de negocios. Generalizar los scripts por sistema es la palanca principal.

## Datos

Colecciones previstas (se crean a medida que hagan falta): `negocios`, `procesos`, `versiones` (con el recorrido, el script, la función y la C de referencia dentro), `ejecuciones`, `corridas`, `alertas` y `reservas` (caducan solas por los datos personales).

Niveles de campo:
- **blindado:** obligatorio, con tipo y valores fijos;
- **estable:** tipo fijo, pero puede faltar;
- **flexible:** contenedor libre.

## Revisión humana

1. **Aprobar un recorrido** tras probarlo hasta B.
2. **Autorizar la reserva de prueba:** con OK del restaurante; después se cancela por el canal registrado.
3. **Aprobar los campos propuestos** del catálogo.

## Nunca

- Pulsar confirmar o enviar una reserva sin la compuerta abierta y sin autorización explícita.
- Esquivar un CAPTCHA, un inicio de sesión, un pago u otro control: se anota como obstáculo y se para.
- Subir `.env` ni credenciales al repositorio.
- Escribir en MongoDB saltándose el gestor.
- Definir un campo fuera del catálogo.

## Pendiente de decidir

- Proveedor de voz y de SMS: elegirlo pronto aunque se integre al final.
- OK por escrito de Templo de Pandora para las reservas automáticas y la reserva de prueba.
- Dónde corren el ejecutor y el endpoint: un servidor con navegador.
