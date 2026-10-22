## Explicación

Recorrí `https://restaurantmogan.com/reservation/` con Playwright (Edge) desde A hasta B con datos de prueba: viernes 23-10-2026 a las 20:00, 2 comensales, «Prueba Reservas», `prueba@example.com`, +34 600 000 000. No pulsé «Confirm reservation» en ningún momento; además, un seguro en la página bloqueaba cualquier envío del formulario final.

**URL de inicio.** Confirmada: el botón «Book a Table» de la portada lleva a `/reservation/` y el formulario empieza ahí, sin redirecciones ni iframes. La URL no cambia en todo el recorrido: los pasos son paneles de la misma página (`data-abs-active-step` = 1, 2 y 4; el 5 sería la pantalla C).

**Sistema de reservas.** Plugin propio de WordPress, «Amazonas Booking System» (`/wp-content/plugins/amazonas-booking-system/`, versión 0.8.4). No hay proveedor externo: solo se contactan el propio dominio y Google Fonts. Las peticiones van a `admin-ajax.php` con un nonce: `abs_get_available_time_slots` al cambiar la fecha, `abs_get_booking_options` al cambiar la hora o los comensales, y solo el envío del formulario final llama a `createReservation`. Los botones «Continue…» son `type=button` y solo cambian de panel; el único `submit` es «Confirm reservation».

**Pasos.**
1. Fecha, hora y comensales.
2. «Continue to table selection».
3. Plano interactivo: hay que pulsar una mesa elegible (estado `recommended`, `available` o `limited`, que es lo que acepta el plugin) y luego «Continue».
4. Datos personales y casilla de privacidad.

Al cambiar la fecha, las horas se recargan por AJAX; para el 23-10 van de 13:45 a 21:30 cada 15 minutos. Hay que esperar a que la etiqueta de estado del plano (`[class*="map-status"]`) deje de decir «Loading…», porque mientras carga ninguna mesa aparece disponible.

**Obligatoriedad.**
- Todos los campos con atributo `required`: fecha, hora, comensales, nombre, email, teléfono y la casilla de privacidad.
- La mesa es obligatoria porque el JavaScript no deja seguir sin ella («Please select an available table first.»).
- El mensaje es opcional, con un máximo de 500 caracteres según el JavaScript.
- La fecha tiene `min` = hoy y no tiene `max`.
- Los comensales van de 1 a 8. Un aviso dice que los grupos de más de 8 solo se aceptan por teléfono.

**B.** Comprobado: `checkValidity()` del formulario final da `true`, no hay errores visibles y `.abs-confirm-button` («Confirm reservation») es único y está visible.

**Campo oculto «Company website» (`abs_company_website`).** Está en el formulario final pero no se ve: es una trampa anti-robots (*honeypot*) que el plugin envía junto a la reserva. No lo anoto como obstáculo porque no impide avanzar ni hay nada que esquivar: una persona lo deja vacío, y el script también debe dejarlo vacío. Lo señalo para que se revise antes de la fase de confirmar.

**Mensaje de «sin hueco».** No lo he visto: con 2, 7 y 8 comensales los días 23 y 24 siempre había mesas. No he forzado más consultas para no cargar su servidor, así que va `null`. Para que lo tenga en cuenta quien genere el script, en la configuración del plugin en la página (`messages`) aparecen estos textos:
- «No tables are available for this time. Please choose another time or date.»
- «No table option is currently available for the selected date, time and guest count.»
- «No times available».

Además, el plano marca con la clase de estado cuándo no hay mesas elegibles: cero elementos `.abs-table-option.abs-state-available` (ni recommended ni limited).

**Obstáculos.** Ninguno: ni CAPTCHA, ni inicio de sesión, ni pago.

## Salida

_proceso.url_inicio_: https://restaurantmogan.com/reservation/
_version.recorrido.sistema.nombre_: Amazonas Booking System (plugin propio de WordPress)
_version.recorrido.sistema.evidencia_:
```
Script /wp-content/plugins/amazonas-booking-system/public/js/amazonas-booking.js?ver=0.8.4; clases abs-* (abs-final-form, abs-table-option, abs-confirm-button); ids abs-booking-widget-186927-*; peticiones a /wp-admin/admin-ajax.php con acciones abs_get_available_time_slots y abs_get_booking_options; meta generator WordPress 7.1.3. Ningún iframe ni dominio de terceros salvo Google Fonts.
```
_version.recorrido.llega_a_b_: true
_version.recorrido.pasos.1.accion_: Abrir la página de reserva (punto A)
_version.recorrido.pasos.1.selector_: null
_version.recorrido.pasos.1.url_: https://restaurantmogan.com/reservation/
_version.recorrido.pasos.2.accion_: Escribir la fecha (AAAA-MM-DD) y esperar a que se recarguen las horas por AJAX
_version.recorrido.pasos.2.selector_: [name="abs_booking_date"]
_version.recorrido.pasos.2.url_: https://restaurantmogan.com/reservation/
_version.recorrido.pasos.3.accion_: Elegir la hora entre las ofrecidas para ese día
_version.recorrido.pasos.3.selector_: [name="abs_booking_time"]
_version.recorrido.pasos.3.url_: https://restaurantmogan.com/reservation/
_version.recorrido.pasos.4.accion_: Elegir el número de comensales (1 a 8)
_version.recorrido.pasos.4.selector_: [name="abs_booking_guests"]
_version.recorrido.pasos.4.url_: https://restaurantmogan.com/reservation/
_version.recorrido.pasos.5.accion_: Pulsar «Continue to table selection» (solo cambia al panel del plano)
_version.recorrido.pasos.5.selector_: role=button[name="Continue to table selection"]
_version.recorrido.pasos.5.url_: https://restaurantmogan.com/reservation/
_version.recorrido.pasos.6.accion_: Esperar a que el estado del plano deje de decir «Loading…» (abs-map-status-success al cargar)
_version.recorrido.pasos.6.selector_: [class*="map-status"]
_version.recorrido.pasos.6.url_: https://restaurantmogan.com/reservation/
_version.recorrido.pasos.7.accion_: Pulsar la primera mesa elegible del plano (estado recommended, available o limited)
_version.recorrido.pasos.7.selector_: .abs-table-option:is(.abs-state-recommended, .abs-state-available, .abs-state-limited)
_version.recorrido.pasos.7.url_: https://restaurantmogan.com/reservation/
_version.recorrido.pasos.8.accion_: Pulsar «Continue» bajo la mesa elegida (solo cambia al panel de datos)
_version.recorrido.pasos.8.selector_: [data-abs-map-continue]
_version.recorrido.pasos.8.url_: https://restaurantmogan.com/reservation/
_version.recorrido.pasos.9.accion_: Rellenar nombre, email y teléfono sin pulsar Enter (Enter enviaría el formulario)
_version.recorrido.pasos.9.selector_: .abs-final-form
_version.recorrido.pasos.9.url_: https://restaurantmogan.com/reservation/
_version.recorrido.pasos.10.accion_: Marcar la casilla de privacidad y condiciones
_version.recorrido.pasos.10.selector_: [name="abs_customer_gdpr"]
_version.recorrido.pasos.10.url_: https://restaurantmogan.com/reservation/
_version.recorrido.pasos.11.accion_: Comprobar B: formulario válido y «Confirm reservation» visible. No pulsar.
_version.recorrido.pasos.11.selector_: .abs-confirm-button
_version.recorrido.pasos.11.url_: https://restaurantmogan.com/reservation/
_version.recorrido.campos.1.nombre_: Date
_version.recorrido.campos.1.selector_: [name="abs_booking_date"]
_version.recorrido.campos.1.control_: fecha
_version.recorrido.campos.1.obligatorio_: true
_version.recorrido.campos.1.evidencia_: Atributo required; min = hoy, sin max.
_version.recorrido.campos.1.valor_prueba_: 2026-10-23
_version.recorrido.campos.2.nombre_: Time
_version.recorrido.campos.2.selector_: [name="abs_booking_time"]
_version.recorrido.campos.2.control_: select
_version.recorrido.campos.2.obligatorio_: true
_version.recorrido.campos.2.evidencia_: Atributo required; opciones HH:MM cada 15 min cargadas por AJAX según la fecha (13:45–21:30 el 23-10).
_version.recorrido.campos.2.valor_prueba_: 20:00
_version.recorrido.campos.3.nombre_: Guests
_version.recorrido.campos.3.selector_: [name="abs_booking_guests"]
_version.recorrido.campos.3.control_: select
_version.recorrido.campos.3.obligatorio_: true
_version.recorrido.campos.3.evidencia_: Atributo required; opciones 1 a 8; aviso «For groups of more than 8 guests, reservations are accepted by phone only».
_version.recorrido.campos.3.valor_prueba_: 2
_version.recorrido.campos.4.nombre_: Mesa del plano interactivo
_version.recorrido.campos.4.selector_: .abs-table-option:is(.abs-state-recommended, .abs-state-available, .abs-state-limited)
_version.recorrido.campos.4.control_: otro
_version.recorrido.campos.4.obligatorio_: true
_version.recorrido.campos.4.evidencia_: El JavaScript no deja continuar sin mesa: «Please select an available table first.»
_version.recorrido.campos.4.valor_prueba_: Mesa 1 (Terrace)
_version.recorrido.campos.5.nombre_: Full name
_version.recorrido.campos.5.selector_: [name="abs_customer_name"]
_version.recorrido.campos.5.control_: texto
_version.recorrido.campos.5.obligatorio_: true
_version.recorrido.campos.5.evidencia_: Atributo required.
_version.recorrido.campos.5.valor_prueba_: Prueba Reservas
_version.recorrido.campos.6.nombre_: Email
_version.recorrido.campos.6.selector_: [name="abs_customer_email"]
_version.recorrido.campos.6.control_: email
_version.recorrido.campos.6.obligatorio_: true
_version.recorrido.campos.6.evidencia_: Atributo required y type=email.
_version.recorrido.campos.6.valor_prueba_: prueba@example.com
_version.recorrido.campos.7.nombre_: Phone
_version.recorrido.campos.7.selector_: [name="abs_customer_phone"]
_version.recorrido.campos.7.control_: telefono
_version.recorrido.campos.7.obligatorio_: true
_version.recorrido.campos.7.evidencia_: Atributo required y type=tel.
_version.recorrido.campos.7.valor_prueba_: +34 600 000 000
_version.recorrido.campos.8.nombre_: Special requests / Optional message
_version.recorrido.campos.8.selector_: [name="abs_customer_message"]
_version.recorrido.campos.8.control_: textarea
_version.recorrido.campos.8.obligatorio_: false
_version.recorrido.campos.8.evidencia_: Sin required; la etiqueta dice «Optional»; el JavaScript limita a 500 caracteres.
_version.recorrido.campos.8.valor_prueba_: null
_version.recorrido.campos.9.nombre_: I have read and accept the Privacy Policy and Booking Terms.
_version.recorrido.campos.9.selector_: [name="abs_customer_gdpr"]
_version.recorrido.campos.9.control_: checkbox
_version.recorrido.campos.9.obligatorio_: true
_version.recorrido.campos.9.evidencia_: Atributo required.
_version.recorrido.campos.9.valor_prueba_: marcada
_version.recorrido.campos.10.nombre_: Company website (oculto, anti-robots)
_version.recorrido.campos.10.selector_: [name="abs_company_website"]
_version.recorrido.campos.10.control_: texto
_version.recorrido.campos.10.obligatorio_: false
_version.recorrido.campos.10.evidencia_: No es visible para una persona y no tiene required; el plugin lo envía con la reserva: es un honeypot y debe quedar vacío.
_version.recorrido.campos.10.valor_prueba_: null
_version.recorrido.boton_confirmar.selector_: .abs-confirm-button
_version.recorrido.boton_confirmar.texto_: Confirm reservation
_version.recorrido.mensaje_sin_hueco_: null
