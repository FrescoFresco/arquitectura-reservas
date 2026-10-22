## Explicación

Segundo mapeo de Rincón del Amazonas, con la plantilla mapear-recorrido v2, que añade la **clase** de cada campo y exige URL sin datos personales.

Recorrí de nuevo `https://restaurantmogan.com/reservation/` con Playwright (Edge) desde A hasta B. Usé datos de prueba: domingo 25-10-2026 a las 20:00, 2 comensales, «Prueba Reservas», `prueba@example.com` y +34 600 000 000. No pulsé «Confirm reservation»; además, un seguro en la página bloqueaba cualquier envío del formulario final.

**Qué ha cambiado desde el primer mapeo (20-10).** Nada en la estructura: los mismos pasos, campos, selectores, botón y sistema. Solo cambia el horario del día elegido: el domingo 25-10 la web ofrece de 11:15 a 21:30 cada 15 minutos, frente a 13:45–21:30 el viernes 23-10. Con 2 comensales a las 20:00 había 14 opciones de mesa.

**URL de inicio.** Confirmada: `/reservation/`, sin parámetros en la query. Toda la reserva ocurre en esa misma URL, con paneles por pasos; ninguna URL del recorrido lleva datos personales.

**Sistema de reservas.** Plugin propio de WordPress, «Amazonas Booking System», con la misma evidencia que en el primer mapeo (ver Salida).

**Clase de cada campo.**
- `normal`: fecha, hora, comensales y mesa. Son datos de la reserva, no de la persona.
- `sensible`: nombre completo, email y teléfono. Son datos personales de contacto; el nombre también lo es aunque la regla antigua lo dejaba en `normal`.
- `texto_libre`: «Special requests / Optional message». Comentario libre, donde el cliente puede escribir alergias u otros datos de salud.
- `consentimiento`: la casilla «I have read and accept the Privacy Policy and Booking Terms». La función tendrá que pedir esa aceptación al cliente.
- `normal`: el campo oculto «Company website». Es una trampa anti-robots (*honeypot*) que debe quedar vacía. No es un obstáculo: no impide avanzar ni hay nada que esquivar.
- No hay ningún `identificador` (DNI, NIE o pasaporte).

**Obligatoriedad, B y mensaje de «sin hueco».** Igual que en el primer mapeo.
- Son obligatorios por `required` la fecha, la hora, los comensales, el nombre, el email, el teléfono y la casilla; la mesa lo es por el JavaScript del plugin.
- B comprobado: `checkValidity()` da `true` y `.abs-confirm-button` es único y está visible.
- El mensaje de «sin hueco» sigue sin verse, así que va `null`.

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
_version.recorrido.campos.1.clase_: normal
_version.recorrido.campos.1.evidencia_: Atributo required; min = hoy, sin max.
_version.recorrido.campos.1.valor_prueba_: 2026-10-25
_version.recorrido.campos.2.nombre_: Time
_version.recorrido.campos.2.selector_: [name="abs_booking_time"]
_version.recorrido.campos.2.control_: select
_version.recorrido.campos.2.obligatorio_: true
_version.recorrido.campos.2.clase_: normal
_version.recorrido.campos.2.evidencia_: Atributo required; opciones HH:MM cada 15 min cargadas por AJAX según la fecha (13:45–21:30 el viernes 23-10; 11:15–21:30 el domingo 25-10).
_version.recorrido.campos.2.valor_prueba_: 20:00
_version.recorrido.campos.3.nombre_: Guests
_version.recorrido.campos.3.selector_: [name="abs_booking_guests"]
_version.recorrido.campos.3.control_: select
_version.recorrido.campos.3.obligatorio_: true
_version.recorrido.campos.3.clase_: normal
_version.recorrido.campos.3.evidencia_: Atributo required; opciones 1 a 8; aviso «For groups of more than 8 guests, reservations are accepted by phone only».
_version.recorrido.campos.3.valor_prueba_: 2
_version.recorrido.campos.4.nombre_: Mesa del plano interactivo
_version.recorrido.campos.4.selector_: .abs-table-option:is(.abs-state-recommended, .abs-state-available, .abs-state-limited)
_version.recorrido.campos.4.control_: otro
_version.recorrido.campos.4.obligatorio_: true
_version.recorrido.campos.4.clase_: normal
_version.recorrido.campos.4.evidencia_: El JavaScript no deja continuar sin mesa: «Please select an available table first.»
_version.recorrido.campos.4.valor_prueba_: La primera mesa elegible del plano
_version.recorrido.campos.5.nombre_: Full name
_version.recorrido.campos.5.selector_: [name="abs_customer_name"]
_version.recorrido.campos.5.control_: texto
_version.recorrido.campos.5.obligatorio_: true
_version.recorrido.campos.5.clase_: sensible
_version.recorrido.campos.5.evidencia_: Atributo required.
_version.recorrido.campos.5.valor_prueba_: Prueba Reservas
_version.recorrido.campos.6.nombre_: Email
_version.recorrido.campos.6.selector_: [name="abs_customer_email"]
_version.recorrido.campos.6.control_: email
_version.recorrido.campos.6.obligatorio_: true
_version.recorrido.campos.6.clase_: sensible
_version.recorrido.campos.6.evidencia_: Atributo required y type=email.
_version.recorrido.campos.6.valor_prueba_: prueba@example.com
_version.recorrido.campos.7.nombre_: Phone
_version.recorrido.campos.7.selector_: [name="abs_customer_phone"]
_version.recorrido.campos.7.control_: telefono
_version.recorrido.campos.7.obligatorio_: true
_version.recorrido.campos.7.clase_: sensible
_version.recorrido.campos.7.evidencia_: Atributo required y type=tel.
_version.recorrido.campos.7.valor_prueba_: +34 600 000 000
_version.recorrido.campos.8.nombre_: Special requests / Optional message
_version.recorrido.campos.8.selector_: [name="abs_customer_message"]
_version.recorrido.campos.8.control_: textarea
_version.recorrido.campos.8.obligatorio_: false
_version.recorrido.campos.8.clase_: texto_libre
_version.recorrido.campos.8.evidencia_: Sin required; la etiqueta dice «Optional»; el JavaScript limita a 500 caracteres.
_version.recorrido.campos.8.valor_prueba_: null
_version.recorrido.campos.9.nombre_: I have read and accept the Privacy Policy and Booking Terms.
_version.recorrido.campos.9.selector_: [name="abs_customer_gdpr"]
_version.recorrido.campos.9.control_: checkbox
_version.recorrido.campos.9.obligatorio_: true
_version.recorrido.campos.9.clase_: consentimiento
_version.recorrido.campos.9.evidencia_: Atributo required.
_version.recorrido.campos.9.valor_prueba_: marcada
_version.recorrido.campos.10.nombre_: Company website (oculto, anti-robots)
_version.recorrido.campos.10.selector_: [name="abs_company_website"]
_version.recorrido.campos.10.control_: texto
_version.recorrido.campos.10.obligatorio_: false
_version.recorrido.campos.10.clase_: normal
_version.recorrido.campos.10.evidencia_: No es visible para una persona y no tiene required; el plugin lo envía con la reserva: es un honeypot y debe quedar vacío.
_version.recorrido.campos.10.valor_prueba_: null
_version.recorrido.boton_confirmar.selector_: .abs-confirm-button
_version.recorrido.boton_confirmar.texto_: Confirm reservation
_version.recorrido.mensaje_sin_hueco_: null
