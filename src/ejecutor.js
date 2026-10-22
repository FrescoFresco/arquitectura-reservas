import { chromium } from 'playwright';
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { cargar } from './catalogo.js';

const valores = (id) => cargar().find((d) => d.id === id).valores;

// NAVEGADOR en .env: msedge (por defecto), chrome, o chromium (el de Playwright: npx playwright install chromium).
export function lanzar(opciones) {
  const canal = process.env.NAVEGADOR || 'msedge';
  return chromium.launch({ ...(canal === 'chromium' ? {} : { channel: canal }), ...opciones });
}

// Día local del negocio dentro de `dias` días (AAAA-MM-DD).
export function fechaLocal(zona, dias, ahora = new Date()) {
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: zona }).format(ahora);
  const d = new Date(`${hoy}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

// Parámetros de prueba desde el JSON Schema: los obligatorios con su ejemplo; la fecha, dentro de 3 días (nunca hoy).
// ponytail: sin validar contra el esquema porque salen de él; cuando lleguen parámetros de un cliente real, validar con ajv.
export function parametrosDePrueba(esquema, zona) {
  const params = {};
  for (const clave of esquema.required ?? []) {
    const p = esquema.properties?.[clave] ?? {};
    params[clave] = p.format === 'date' ? fechaLocal(zona, 3) : (p.const ?? p.examples?.[0] ?? p.default);
    if (params[clave] === undefined) throw new Error(`El parámetro obligatorio «${clave}» no tiene ejemplo en el JSON Schema`);
  }
  return params;
}

// La respuesta de la función siempre tiene 4 claves, con los valores que fija el catálogo.
export function comprobarRespuesta(r) {
  const ok =
    r && typeof r === 'object' &&
    Object.keys(r).sort().join() === 'alternativas,estado,motivo,referencia' &&
    valores('ejecucion.respuesta.estado').includes(r.estado) &&
    (r.motivo === null || valores('ejecucion.respuesta.motivo').includes(r.motivo)) &&
    (r.referencia === null || typeof r.referencia === 'string') &&
    Array.isArray(r.alternativas) && r.alternativas.every((a) => typeof a === 'string');
  if (!ok) throw new Error(`el script devolvió una respuesta mal formada: ${JSON.stringify(r)}`);
  return r;
}

// Seguro de hasta_B, se ejecuta dentro de la página: bloquea el clic en el botón de confirmar y el envío del formulario
// que lo contiene (también con Enter o requestSubmit). Si el selector no es CSS, no puede actuar y lo avisa.
// ponytail: form.submit() desde el JS de la web no lanza eventos y no se puede bloquear así; si un sistema lo usa,
// cortar su petición con page.route.
export function seguroHastaB(sel) {
  try {
    document.querySelector(sel);
  } catch {
    console.warn('[seguro] selector no CSS: seguro inactivo');
    return;
  }
  const bloquear = (e) => {
    const objetivo = e.type === 'submit' ? e.target.querySelector?.(sel) : e.target.closest?.(sel);
    if (!objetivo) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    console.warn('[seguro] envío bloqueado: hasta_B nunca confirma');
  };
  addEventListener('submit', bloquear, true);
  addEventListener('click', bloquear, true);
}

export async function esperar(mensaje) {
  if (!process.stdin.isTTY) return new Promise((r) => setTimeout(r, 5000));
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await rl.question(mensaje);
  rl.close();
}

// Corre el script de una versión en modo hasta_B con el navegador visible y guarda la ejecución.
export async function ejecutar(db, idVersion, { soloAprobada = false, pausa = false } = {}) {
  const version = await db.collection('versiones').findOne({ _id: idVersion });
  if (!version) throw new Error(`No existe la versión ${idVersion}`);
  if (soloAprobada && version.estado !== 'aprobada') throw new Error(`${idVersion} está ${version.estado}, no aprobada`);
  if (!version.script || !version.funcion?.parametros) throw new Error(`${idVersion} no tiene script o JSON Schema: falta generar-script`);
  const selector = version.recorrido?.boton_confirmar?.selector;
  if (!selector) throw new Error(`${idVersion} no tiene version.recorrido.boton_confirmar.selector: no se puede comprobar B`);
  const proceso = await db.collection('procesos').findOne({ _id: version.id_proceso });
  const negocio = await db.collection('negocios').findOne({ _id: proceso.id_negocio });

  const params = parametrosDePrueba(version.funcion.parametros, negocio.zona_horaria);
  const traza = [];
  const registrar = (m) => {
    traza.push({ hora: new Date(), mensaje: String(m) || '(vacío)' });
    console.log(`  · ${m}`);
  };
  const inicio = new Date();
  let respuesta;
  let page;
  const navegador = await lanzar({ headless: false, args: ['--start-maximized'] });
  try {
    page = await navegador.newPage({ viewport: null });
    await page.addInitScript(seguroHastaB, selector);
    page.on('console', (m) => m.text().startsWith('[seguro]') && registrar(m.text()));
    registrar(`Parámetros de prueba: ${params.personas ?? '?'} personas, ${params.fecha ?? '?'} ${params.hora ?? ''}`);

    const { hastaB } = await import(`data:text/javascript,${encodeURIComponent(version.script)}`);
    registrar(`Abro A: ${proceso.url_inicio}`);
    await page.goto(proceso.url_inicio, { waitUntil: 'domcontentloaded' });
    respuesta = comprobarRespuesta(await hastaB(page, params, registrar));
    if (['confirmada', 'pendiente_negocio'].includes(respuesta.estado)) throw new Error(`en modo hasta_B no puede haber «${respuesta.estado}»`);
    if (respuesta.estado === 'disponible') {
      if (!(await page.locator(selector).first().isVisible())) throw new Error('el script dice que llegó a B, pero el botón de confirmar no está a la vista');
      registrar('El ejecutor comprueba B: el botón de confirmar está a la vista. No se pulsa.');
    }
    if (pausa) await esperar('\n  Navegador en B. Pulsa Enter para cerrarlo… ');
  } catch (e) {
    registrar(`Error: ${e.message.split('\n')[0]}`);
    respuesta = { estado: 'error', referencia: null, alternativas: [], motivo: 'fallo_recorrido' };
  }
  const url = page?.url();
  await navegador.close();

  const ejecucion = {
    _id: `ejec-${Date.now().toString(36)}`,
    id_version: idVersion,
    modo: 'hasta_B',
    parametros: params,
    inicio,
    fin: new Date(),
    ultima_url: /^https?:/.test(url ?? '') ? url : null,
    traza,
    respuesta,
  };
  await db.collection('ejecuciones').insertOne(ejecucion);
  return ejecucion;
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { version: { type: 'string' }, proceso: { type: 'string' }, pausa: { type: 'boolean' } } });
  const { conectar } = await import('./db.js');
  const { cliente, db } = await conectar();
  try {
    let id = values.version;
    if (!id && values.proceso) id = (await db.collection('procesos').findOne({ _id: values.proceso }))?.id_version_activa;
    if (!id) throw new Error('Uso: npm run ejecutar -- --version ver-…  |  --proceso proc-… (usa su versión aprobada)  [--pausa]');
    console.log(`Ejecutando ${id} hasta B…`);
    const e = await ejecutar(db, id, { soloAprobada: !values.version, pausa: values.pausa });
    console.log(`\nRespuesta: ${JSON.stringify(e.respuesta)}\nGuardada en ejecuciones: ${e._id}`);
    process.exitCode = e.respuesta.estado === 'disponible' ? 0 : 1;
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exitCode = 1;
  } finally {
    await cliente.close();
  }
}
