## Explicación

Script y JSON Schema de `ver-rincon-del-amazonas-1` con la plantilla generar-script v2, sobre el recorrido del segundo mapeo (v2, con la clase de cada campo). El recorrido no ha cambiado, así que el script es el mismo que ya llegaba a B de forma estable. Es la versión que espera a que no quede ninguna petición AJAX del plugin antes de elegir mesa y comprueba que la mesa queda seleccionada.

**Pasos.** El script sigue los 11 pasos del recorrido.
1. Fecha: espera las horas del día por AJAX.
2. Hora: si la pedida no se ofrece, devuelve `sin_hueco` con las 3 más cercanas como alternativas.
3. Comensales.
4. Abre el plano y espera a que cargue.
5. Mesa: elige la primera elegible (recommended, available o limited); si no hay ninguna, devuelve `sin_hueco`.
6. «Continue».
7. Datos del cliente, siempre con `fill` y sin Enter.
8. Casilla de privacidad.
9. B: si aparece un CAPTCHA, devuelve `error` / `obstaculo`; si no, comprueba que el formulario es válido y que «Confirm reservation» está a la vista, y devuelve `disponible`.

Nunca pulsa confirmar; `confirmar(page)` es solo para la fase con compuerta.

**Reglas de clase (v2).**
- **Consentimiento.** El recorrido tiene un campo de clase `consentimiento`, la casilla «I have read and accept the Privacy Policy and Booking Terms». La función lo pide con `acepta_privacidad` (`const: true`), que el agente de voz tiene que preguntar, y el script lanza un error sin ese `true`.
- **Sensible y texto libre.** Nombre, email y teléfono (`sensible`) y el mensaje (`texto_libre`) se rellenan desde `params`, y ninguna llamada a `registrar` escribe su valor. La traza solo recoge fecha, hora, comensales y el estado del plano, que son campos `normal`.
- **Campo oculto.** El honeypot `abs_company_website` no se toca.

**Parámetros.** fecha, hora (franjas de 15 minutos), personas (1 a 8; más de 8, por teléfono), nombre, email, teléfono, el mensaje opcional (máximo 500 caracteres) y `acepta_privacidad`.

## Salida

_version.funcion.nombre_: reservar_mesa
_version.funcion.parametros_:
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["fecha", "hora", "personas", "nombre", "email", "telefono", "acepta_privacidad"],
  "properties": {
    "fecha": {
      "type": "string",
      "format": "date",
      "description": "Día de la reserva (AAAA-MM-DD) en hora de Canarias. No puede ser anterior a hoy.",
      "examples": ["2026-10-23"]
    },
    "hora": {
      "type": "string",
      "pattern": "^([01][0-9]|2[0-3]):[0-5][0-9]$",
      "description": "Hora de llegada (HH:MM). La web ofrece franjas de 15 minutos; si la hora no está libre se devuelven las más cercanas.",
      "examples": ["20:00"]
    },
    "personas": {
      "type": "integer",
      "minimum": 1,
      "maximum": 8,
      "description": "Número de comensales, de 1 a 8. Para más de 8 personas hay que llamar al restaurante.",
      "examples": [2]
    },
    "nombre": {
      "type": "string",
      "minLength": 2,
      "description": "Nombre y apellidos de quien reserva.",
      "examples": ["Prueba Reservas"]
    },
    "email": {
      "type": "string",
      "format": "email",
      "description": "Email de contacto; el restaurante envía ahí la confirmación con el enlace para cancelar.",
      "examples": ["prueba@example.com"]
    },
    "telefono": {
      "type": "string",
      "pattern": "^\\+?[0-9 ]{9,}$",
      "description": "Teléfono de contacto, mejor con prefijo internacional.",
      "examples": ["+34 600 000 000"]
    },
    "mensaje": {
      "type": "string",
      "maxLength": 500,
      "description": "Peticiones especiales opcionales: alergias, accesibilidad o preferencia de mesa.",
      "examples": ["Mesa en la terraza si es posible"]
    },
    "acepta_privacidad": {
      "const": true,
      "description": "El cliente acepta la política de privacidad y las condiciones de reserva del restaurante. Hay que preguntárselo.",
      "examples": [true]
    }
  }
}
```
_version.script_:
```
// Rincón del Amazonas · Amazonas Booking System (plugin de WordPress) · generar-script v1.
const SEL = {
  fecha: '[name="abs_booking_date"]',
  hora: '[name="abs_booking_time"]',
  personas: '[name="abs_booking_guests"]',
  estadoPlano: '[class*="map-status"]',
  mesaElegible: '.abs-table-option:is(.abs-state-recommended, .abs-state-available, .abs-state-limited)',
  continuarPlano: '[data-abs-map-continue]',
  nombre: '[name="abs_customer_name"]',
  email: '[name="abs_customer_email"]',
  telefono: '[name="abs_customer_phone"]',
  mensaje: '[name="abs_customer_message"]',
  privacidad: '[name="abs_customer_gdpr"]',
  formulario: '.abs-final-form',
  confirmar: '.abs-confirm-button',
  captcha: 'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="challenges.cloudflare.com"]',
};

const respuesta = (estado, alternativas = [], motivo = null) => ({ estado, referencia: null, alternativas, motivo });
const minutos = (h) => {
  const [a, b] = h.split(':').map(Number);
  return a * 60 + b;
};
const sinCargar = (sel) => {
  const e = document.querySelector(sel);
  return !!e && !!e.textContent.trim() && !/loading|waiting/i.test(e.textContent);
};

const esAjax = (r) => r.url().includes('admin-ajax.php');
const esperarAccion = (page, accion) => page.waitForResponse((r) => esAjax(r) && (r.request().postData() ?? '').includes(accion));

// Cuenta las peticiones AJAX del plugin en curso. calma() sondea hasta que no queda ninguna:
// una respuesta tardía repinta el plano y borra la mesa elegida.
function vigilarAjax(page) {
  let pendientes = 0;
  page.on('request', (r) => esAjax(r) && pendientes++);
  const fin = (r) => esAjax(r) && pendientes--;
  page.on('requestfinished', fin);
  page.on('requestfailed', fin);
  return async () => {
    while (pendientes > 0) await page.waitForTimeout(100);
  };
}

export async function hastaB(page, params, registrar) {
  if (params.acepta_privacidad !== true) throw new Error('El cliente no ha aceptado la política de privacidad y las condiciones');
  const calma = vigilarAjax(page);

  registrar(`Fecha: ${params.fecha}`);
  const horasCargadas = esperarAccion(page, 'abs_get_available_time_slots');
  await page.locator(SEL.fecha).fill(params.fecha);
  await page.locator(SEL.fecha).dispatchEvent('change');
  await horasCargadas;
  await calma();
  await page.waitForFunction(sinCargar, SEL.hora);

  const horas = await page.locator(`${SEL.hora} option`).evaluateAll((os) => os.map((o) => o.value).filter((v) => /^\d{2}:\d{2}$/.test(v)));
  if (!horas.length) {
    registrar('La web no ofrece ninguna hora ese día');
    return respuesta('sin_hueco');
  }
  if (!horas.includes(params.hora)) {
    const cercanas = [...horas]
      .sort((a, b) => Math.abs(minutos(a) - minutos(params.hora)) - Math.abs(minutos(b) - minutos(params.hora)))
      .slice(0, 3)
      .sort();
    registrar(`La hora ${params.hora} no se ofrece; las más cercanas: ${cercanas.join(', ')}`);
    return respuesta('sin_hueco', cercanas.map((h) => `${params.fecha} ${h}`));
  }

  registrar(`Hora ${params.hora} · ${params.personas} comensales`);
  const mesasCargadas = esperarAccion(page, 'abs_get_booking_options');
  await page.selectOption(SEL.hora, params.hora);
  await page.selectOption(SEL.personas, String(params.personas));
  await mesasCargadas;
  await calma();

  registrar('Paso al plano de mesas');
  await page.getByRole('button', { name: 'Continue to table selection' }).click();
  await page.waitForFunction(sinCargar, SEL.estadoPlano);
  await calma();
  const estado = (await page.locator(SEL.estadoPlano).first().innerText()).trim();
  const mesas = page.locator(SEL.mesaElegible);
  const total = await mesas.count();
  if (!total) {
    registrar(`No hay mesas para esa hora y comensales: «${estado}»`);
    return respuesta('sin_hueco');
  }
  registrar(`${total} opciones de mesa («${estado}»); elijo la primera`);
  // «Continue» solo aparece con una mesa seleccionada: es la prueba de que la selección se quedó.
  const seleccionada = () => page.locator(SEL.continuarPlano).waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false);
  for (let intento = 1; ; intento++) {
    await mesas.first().click();
    if (await seleccionada()) break;
    if (intento === 2) throw new Error('La mesa elegida no queda seleccionada');
    registrar('La selección de mesa no se quedó; repito');
    await calma();
  }
  await page.locator(SEL.continuarPlano).click();

  registrar('Relleno los datos del cliente (sin pulsar Enter)');
  await page.locator(SEL.nombre).fill(params.nombre);
  await page.locator(SEL.email).fill(params.email);
  await page.locator(SEL.telefono).fill(params.telefono);
  if (params.mensaje) await page.locator(SEL.mensaje).fill(params.mensaje);
  await page.locator(SEL.privacidad).check();

  if (await page.locator(SEL.captcha).count()) {
    registrar('Obstáculo: aparece un CAPTCHA. No se esquiva.');
    return respuesta('error', [], 'obstaculo');
  }
  if (!(await page.locator(SEL.formulario).evaluate((f) => f.checkValidity()))) throw new Error('El formulario final no es válido con estos datos');
  await page.locator(SEL.confirmar).scrollIntoViewIfNeeded();
  await page.locator(SEL.confirmar).waitFor({ state: 'visible' });
  registrar('B: formulario relleno y válido, «Confirm reservation» a la vista. No se pulsa.');
  return respuesta('disponible');
}

export async function confirmar(page) {
  await page.locator(SEL.confirmar).click();
}
```
