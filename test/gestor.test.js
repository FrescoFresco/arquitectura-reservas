import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cargar } from '../src/catalogo.js';
import { separar, anclas, validar, anidar, aplanar, formatear, parecidos } from '../src/gestor.js';

const defs = cargar();
const mapa = new Map(defs.map((d) => [d.id, d]));
const leerSalida = (salida, plantilla = 'mapear-recorrido') => {
  const a = anclas(salida);
  const v = validar(a.anclas, defs, plantilla);
  return { ...v, errores: [...a.errores, ...v.errores] };
};

const RESPUESTA = `# Respuesta

## Explicación

Recorrí la web. El teléfono es obligatorio por el asterisco.

## Salida

_proceso.url_inicio_: https://ejemplo.com/reservar/
_version.recorrido.llega_a_b_: true
_version.recorrido.campos.1.nombre_: Nombre
_version.recorrido.campos.1.selector_: #nombre
_version.recorrido.campos.1.obligatorio_: true
_version.recorrido.campos.2.nombre_: Teléfono
_version.recorrido.campos.2.selector_: input[name="tel"]
_version.recorrido.campos.2.obligatorio_: false
_version.recorrido.mensaje_sin_hueco_:
\`\`\`
No hay mesas.
Prueba otro día.
\`\`\`
_propuesta.version.recorrido.idioma_: es
`;

test('separar exige Explicación y Salida, en ese orden', () => {
  const s = separar(RESPUESTA);
  assert.match(s.explicacion, /asterisco/);
  assert.match(s.salida, /_proceso\.url_inicio_/);
  assert.throws(() => separar('## Salida\nx\n## Explicación\ny'), /Explicación/);
  assert.throws(() => separar('## Explicación\n\n## Salida\n'), /vacía/);
});

test('una respuesta correcta se entiende entera, con textos largos y propuestas', () => {
  const r = leerSalida(separar(RESPUESTA).salida);
  assert.deepEqual(r.errores, []);
  assert.equal(r.valores.length, 9);
  assert.equal(r.valores.find((v) => v.ruta === 'version.recorrido.mensaje_sin_hueco').valor, 'No hay mesas.\nPrueba otro día.');
  assert.equal(r.valores.find((v) => v.ruta === 'version.recorrido.campos.2.obligatorio').valor, false);
  assert.deepEqual(r.propuestas, [{ ruta: 'version.recorrido.idioma', valor: 'es' }]);
});

test('anidar convierte las rutas en documentos con listas', () => {
  const r = leerSalida(separar(RESPUESTA).salida);
  const doc = anidar(r.valores);
  assert.equal(doc.proceso.url_inicio, 'https://ejemplo.com/reservar/');
  assert.equal(doc.version.recorrido.campos.length, 2);
  assert.deepEqual(doc.version.recorrido.campos[1], { nombre: 'Teléfono', selector: 'input[name="tel"]', obligatorio: false });
});

test('rechaza campos desconocidos, sin permiso o con tipo incorrecto', () => {
  const r = leerSalida(
    [
      '_version.recorrido.color_: rojo',
      '_negocio.nombre_: Otro nombre',
      '_version.script_: hola',
      '_proceso.url_inicio_: ftp://x',
      '_version.recorrido.llega_a_b_: sí',
      '_version.recorrido.campos.1.control_: deslizador',
      'esto no es un ancla',
      '_version.recorrido.sistema.nombre_:',
    ].join('\n'),
  );
  const esperado = [
    'version.recorrido.color: no existe en el catálogo; si hace falta, propónlo como _propuesta.version.recorrido.color_',
    'negocio.nombre: mapear-recorrido no puede escribirlo (lo escribe: manual)',
    'version.script: mapear-recorrido no puede escribirlo',
    'proceso.url_inicio: «ftp://x» no es una URL http(s)',
    'version.recorrido.llega_a_b: «sí» no es true ni false',
    'version.recorrido.campos.1.control: «deslizador» no es uno de',
    'línea no entendida',
    'version.recorrido.sistema.nombre: sin valor',
  ];
  for (const e of esperado) assert.ok(r.errores.some((x) => x.startsWith(e) || x.includes(e)), `falta «${e}» en:\n${r.errores.join('\n')}`);
  assert.equal(r.valores.length, 0);
});

test('null: vale en estable, no en blindado', () => {
  const r = leerSalida('_version.recorrido.mensaje_sin_hueco_: null\n_version.recorrido.campos.1.nombre_: null\n_version.recorrido.campos.1.selector_: #a\n_version.recorrido.campos.1.obligatorio_: true');
  assert.deepEqual(r.valores.find((v) => v.ruta === 'version.recorrido.mensaje_sin_hueco'), { ruta: 'version.recorrido.mensaje_sin_hueco', valor: null });
  assert.ok(r.errores.some((e) => e.startsWith('version.recorrido.campos.1.nombre: es blindado')));
});

test('listas: sin huecos, desde 1 y con los blindados de cada elemento', () => {
  const r = leerSalida(
    '_version.recorrido.pasos.1.accion_: Abrir\n_version.recorrido.pasos.3.accion_: Pulsar\n_version.recorrido.campos.1.nombre_: Nombre',
  );
  assert.ok(r.errores.some((e) => e.startsWith('version.recorrido.pasos: numera')));
  assert.ok(r.errores.includes('version.recorrido.campos.1.selector: falta (es blindado)'));
  assert.ok(r.errores.includes('version.recorrido.campos.1.obligatorio: falta (es blindado)'));
  assert.ok(leerSalida('_version.recorrido.pasos.0.accion_: Abrir').errores.some((e) => e.includes('numera')));
});

test('repetidos y propuestas de campos que ya existen', () => {
  const r = leerSalida('_version.recorrido.llega_a_b_: true\n_version.recorrido.llega_a_b_: false\n_propuesta.version.recorrido.llega_a_b_: true');
  assert.ok(r.errores.includes('version.recorrido.llega_a_b: repetido'));
  assert.ok(r.errores.some((e) => e.includes('ya existe en el catálogo')));
});

test('fechas: ISO con zona; sin zona se rechaza', () => {
  const sin = validar([{ ruta: 'version.aprobacion.fecha', texto: '2026-10-25T20:00' }], defs, 'gestor');
  assert.match(sin.errores[0], /con hora y zona/);
  const con = validar([{ ruta: 'version.aprobacion.fecha', texto: '2026-10-25T20:00:00+01:00' }], defs, 'gestor');
  assert.deepEqual(con.errores, []);
  assert.equal(con.valores[0].valor.toISOString(), '2026-10-25T19:00:00.000Z');
});

test('alta manual: zona horaria y teléfono se comprueban', () => {
  const r = validar(
    [
      { ruta: 'negocio.zona_horaria', texto: 'Atlantic/Canary' },
      { ruta: 'negocio.telefono', texto: '+34 928 565 098' },
      { ruta: 'proceso.url_inicio', texto: 'https://x.com/' },
    ],
    defs,
    'manual',
  );
  assert.deepEqual(r.errores, []);
  const mal = validar([{ ruta: 'negocio.zona_horaria', texto: 'Canarias' }, { ruta: 'negocio.telefono', texto: '928565098' }], defs, 'manual');
  assert.equal(mal.errores.length, 2);
});

test('json: el JSON Schema de la función se lee como objeto', () => {
  const r = leerSalida('_version.funcion.parametros_:\n```json\n{"type":"object","properties":{}}\n```\n_version.funcion.nombre_: reservar_mesa', 'generar-script');
  assert.deepEqual(r.errores, []);
  assert.deepEqual(r.valores[0].valor, { type: 'object', properties: {} });
  assert.ok(leerSalida('_version.funcion.parametros_: [1]', 'generar-script').errores[0].includes('objeto'));
  assert.ok(leerSalida('_version.script_:\n```\nsin cerrar', 'generar-script').errores[0].includes('no se cierra'));
});

test('aplanar y formatear: de documento a líneas de anclaje y vuelta', () => {
  const doc = { _id: 'ver-x-1', recorrido: { campos: [{ nombre: 'Nombre', selector: '#n', obligatorio: true }], mensaje_sin_hueco: 'Lleno\nOtro día' }, funcion: { parametros: { type: 'object' } } };
  const lineas = aplanar(doc, 'version', mapa).map(formatear);
  assert.ok(lineas.includes('_version.recorrido.campos.1.nombre_: Nombre'));
  const texto = lineas.join('\n');
  const vuelta = validar(anclas(texto).anclas, defs, 'gestor').valores;
  const conPermiso = validar(anclas(texto).anclas, defs.map((d) => ({ ...d, escribe: ['todo'] })), 'todo');
  assert.deepEqual(conPermiso.errores, []);
  assert.deepEqual(anidar(conPermiso.valores).version, { recorrido: doc.recorrido, funcion: doc.funcion });
  assert.equal(vuelta.length, 0, 'el gestor no escribe el recorrido');
});

test('parecidos encuentra campos con palabras en común', () => {
  const p = parecidos('version.recorrido.campos.N.etiqueta_obligatorio', defs);
  assert.ok(p.length > 0);
  assert.ok(p.some((x) => x.id === 'version.recorrido.campos.N.obligatorio'));
});
