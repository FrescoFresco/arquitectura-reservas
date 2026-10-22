import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { request } from 'node:http';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MongoClient } from 'mongodb';

// Las claves de estas pruebas van a un fichero temporal, nunca al conexiones.local.json de verdad.
const dir = mkdtempSync(join(tmpdir(), 'panel-'));
process.env.CONEXIONES_FICHERO = join(dir, 'conexiones.local.json');
const { guardarConexion, leerConexiones, borrarConexion, claveDe, enmascarar } = await import('../src/conexiones.js');
const { crearPanel } = await import('../src/panel.js');
const { cargar } = await import('../src/catalogo.js');
const { validador } = await import('../src/generador.js');

const SECRETO = 'contraseña-que-no-debe-salir';
const URI_FALSA = `mongodb+srv://jose:${SECRETO}@m0.ejemplo.mongodb.net/?appName=M0`;

test('la clave se guarda por base, se lee y se borra; el .env es el respaldo', () => {
  guardarConexion('Otra_base', URI_FALSA);
  assert.deepEqual(leerConexiones(), { Otra_base: URI_FALSA });
  assert.deepEqual(claveDe('Otra_base'), { uri: URI_FALSA, origen: 'ficha' });
  assert.equal(claveDe('Sin_clave').origen, process.env.MONGODB_URI ? '.env' : null);
  assert.equal(enmascarar(URI_FALSA), 'm0.ejemplo.mongodb.net');
  assert.equal(enmascarar('mongodb://127.0.0.1:27017'), '127.0.0.1:27017');
  assert.throws(() => guardarConexion('Otra_base', 'https://no-es-mongo'), /mongodb/);
  assert.throws(() => guardarConexion('../fuera', URI_FALSA), /nombre de base/);
  borrarConexion('Otra_base');
  assert.deepEqual(leerConexiones(), {});
});

test('conexiones.local.json nunca llega al repositorio', () => {
  const salida = execFileSync('git', ['check-ignore', '-v', 'conexiones.local.json'], { encoding: 'utf8' });
  assert.match(salida, /\.gitignore:\d+:conexiones\.local\.json/);
  assert.equal(execFileSync('git', ['ls-files', 'conexiones.local.json'], { encoding: 'utf8' }), '');
});

// ---------- Contra una base de pruebas local ----------

const URI_PRUEBAS = process.env.MONGODB_URI_PRUEBAS || 'mongodb://127.0.0.1:27017';
const BASE = 'panel_pruebas';
let mongo;
let panel;
let url;
const sinMongo = await MongoClient.connect(URI_PRUEBAS, { serverSelectionTimeoutMS: 1500 })
  .then((c) => ((mongo = c), false))
  .catch(() => 'no hay MongoDB de pruebas en ' + URI_PRUEBAS);

before(async () => {
  if (sinMongo) return;
  guardarConexion(BASE, URI_PRUEBAS);
  guardarConexion('Otra_base', URI_FALSA);
  const db = mongo.db(BASE);
  await db.dropDatabase();
  const defs = cargar();
  for (const [raiz, nombre] of [['negocio', 'negocios'], ['proceso', 'procesos']]) {
    await db.createCollection(nombre, { validator: { $jsonSchema: validador(defs, raiz) } });
  }
  panel = crearPanel();
  await new Promise((r) => panel.servidor.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${panel.servidor.address().port}`;
});

after(async () => {
  if (sinMongo) return;
  await panel.cerrar();
  await mongo.db(BASE).dropDatabase();
  await mongo.close();
  rmSync(dir, { recursive: true, force: true });
});

const api = async (metodo, ruta, cuerpo, token = panel.token) => {
  const r = await fetch(url + '/api' + ruta, { method: metodo, headers: { 'content-type': 'application/json', 'x-panel-token': token }, body: cuerpo && JSON.stringify(cuerpo) });
  return { codigo: r.status, json: await r.json() };
};
const docs = `/bases/${BASE}/colecciones/negocios/documentos`;

test('panel: la página y la API nunca muestran la URI entera', { skip: sinMongo }, async () => {
  const html = await (await fetch(url + '/')).text();
  assert.ok(html.includes('Conexión (URI de Atlas)'));
  assert.ok(!html.includes(SECRETO));
  const { json } = await api('GET', '/bases');
  assert.ok(!JSON.stringify(json).includes(SECRETO));
  assert.deepEqual(json.bases.find((b) => b.nombre === 'Otra_base'), { nombre: 'Otra_base', host: 'm0.ejemplo.mongodb.net', origen: 'ficha' });
  assert.ok(existsSync(process.env.CONEXIONES_FICHERO) && readFileSync(process.env.CONEXIONES_FICHERO, 'utf8').includes(SECRETO), 'la clave sí está en su fichero local');
});

test('panel: sin el token o con otro Host, no responde', { skip: sinMongo }, async () => {
  assert.equal((await api('GET', '/bases', undefined, 'otro')).codigo, 403);
  const codigo = await new Promise((r) =>
    request(url + '/api/bases', { headers: { host: 'evil.example', 'x-panel-token': panel.token } }, (res) => (res.resume(), r(res.statusCode))).end(),
  );
  assert.equal(codigo, 403);
});

test('panel: estado y colecciones con su número de documentos', { skip: sinMongo }, async () => {
  const { json: estado } = await api('GET', `/bases/${BASE}/estado`);
  assert.equal(estado.conectado, true);
  assert.equal(estado.base, BASE);
  const { json } = await api('GET', `/bases/${BASE}/colecciones`);
  assert.deepEqual(json.colecciones.map((c) => [c.nombre, c.documentos, c.editable]), [['negocios', 0, true], ['procesos', 0, true]]);
  assert.equal(json.colecciones[0].nuevo._id, 'neg-');
});

test('panel: crear, editar y borrar un documento, pasando por el gestor', { skip: sinMongo }, async () => {
  const nuevo = { _id: 'neg-panel-prueba', nombre: 'Panel', url: 'https://ejemplo.com/', zona_horaria: 'Atlantic/Canary', telefono: '+34 600 000 000' };
  assert.equal((await api('POST', docs, { documento: JSON.stringify(nuevo) })).codigo, 200);
  let { json } = await api('GET', `${docs}?filtro=${encodeURIComponent('{"_id":"neg-panel-prueba"}')}`);
  assert.equal(json.total, 1);
  assert.equal(json.documentos[0].telefono, '+34600000000', 'el gestor normaliza a E.164');

  assert.equal((await api('PUT', `${docs}/neg-panel-prueba`, { documento: JSON.stringify({ ...nuevo, nombre: 'Panel (editado)' }) })).codigo, 200);
  ({ json } = await api('GET', `${docs}?filtro=${encodeURIComponent('{"nombre":"Panel (editado)"}')}`));
  assert.equal(json.total, 1);

  let r = await api('DELETE', `${docs}/neg-panel-prueba`, { confirmacion: 'otro' });
  assert.equal(r.codigo, 422);
  assert.match(r.json.detalles[0], /escribe exactamente el _id/);
  r = await api('DELETE', `${docs}/neg-panel-prueba`, { confirmacion: 'neg-panel-prueba' });
  assert.equal(r.codigo, 200);
  assert.equal((await api('GET', docs)).json.total, 0);
});

test('panel: los rechazos se explican de forma legible', { skip: sinMongo }, async () => {
  // Del catálogo (gestor): teléfono, URL con datos personales y campo desconocido.
  let r = await api('POST', docs, { documento: JSON.stringify({ _id: 'neg-mal', nombre: 'Mal', url: 'https://x.com/?email=a@b.com', zona_horaria: 'Atlantic/Canary', telefono: '600', color: 'rojo' }) });
  assert.equal(r.codigo, 422);
  assert.ok(r.json.detalles.some((d) => d.startsWith('negocio.telefono:') && d.includes('E.164')));
  assert.ok(r.json.detalles.some((d) => d.startsWith('negocio.url:') && d.includes('datos personales')));
  assert.ok(r.json.detalles.some((d) => d.startsWith('negocio.color: no existe en el catálogo')));
  // Del validador de MongoDB: falta un campo blindado.
  r = await api('POST', docs, { documento: JSON.stringify({ _id: 'neg-mal', nombre: 'Mal', url: 'https://x.com/' }) });
  assert.equal(r.codigo, 422);
  assert.deepEqual(r.json.detalles, ['falta zona_horaria (obligatorio)']);
  // Lo que «manual» no escribe no se puede tocar, y lo que alguien referencia no se borra.
  await api('POST', docs, { documento: JSON.stringify({ _id: 'neg-ref', nombre: 'Ref', url: 'https://x.com/', zona_horaria: 'Atlantic/Canary' }) });
  const procesos = `/bases/${BASE}/colecciones/procesos/documentos`;
  r = await api('POST', procesos, { documento: JSON.stringify({ _id: 'proc-ref', id_negocio: 'neg-ref', url_inicio: 'https://x.com/r', alcance: 'hasta_B', id_version_activa: 'ver-x-1' }) });
  assert.deepEqual(r.json.detalles, ['proceso.id_version_activa: manual no puede escribirlo (lo escribe: gestor)']);
  assert.equal((await api('POST', procesos, { documento: JSON.stringify({ _id: 'proc-ref', id_negocio: 'neg-ref', url_inicio: 'https://x.com/r', alcance: 'hasta_B' }) })).codigo, 200);
  r = await api('DELETE', `${docs}/neg-ref`, { confirmacion: 'neg-ref' });
  assert.match(r.json.detalles[0], /1 documento\(s\) de procesos apuntan a neg-ref por id_negocio/);
});

test('panel: el validador y los índices de una colección', { skip: sinMongo }, async () => {
  const { json } = await api('GET', `/bases/${BASE}/colecciones/negocios/esquema`);
  assert.deepEqual(json.validador.$jsonSchema.required, ['_id', 'nombre', 'url', 'zona_horaria']);
  assert.equal(json.indices[0].name, '_id_');
});
