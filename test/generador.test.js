import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cargar, comprobar, patron } from '../src/catalogo.js';
import { validador, rellenarPlantilla, documentacion } from '../src/generador.js';

const def = (id, tipo, nivel, extra = {}) => ({
  id, tipo, nivel, descripcion: id, escribe: ['mapear-recorrido'], lee: ['generar-script'], sensible: false, estado: 'activo', ...extra,
});

const mini = [
  def('version.estado', 'enum', 'blindado', { valores: ['borrador', 'aprobada'] }),
  def('version.script', 'texto_largo', 'estable'),
  def('version.recorrido.campos.N.nombre', 'texto', 'blindado'),
  def('version.recorrido.campos.N.evidencia', 'texto', 'estable'),
  def('version.funcion.parametros', 'json', 'flexible'),
  def('version.respuesta.alternativas.N', 'texto', 'estable'),
  def('version.viejo', 'texto', 'blindado', { estado: 'obsoleto', sustituido_por: 'version.script' }),
  def('version.idea', 'texto', 'estable', { estado: 'propuesto' }),
];

test('el catálogo real carga sin errores', () => {
  const defs = cargar();
  assert.ok(defs.length > 30);
  assert.ok(defs.some((d) => d.id === 'version.recorrido.campos.N.obligatorio'));
});

test('patron sustituye los números de lista por N', () => {
  assert.equal(patron('version.recorrido.campos.12.nombre'), 'version.recorrido.campos.N.nombre');
  assert.equal(patron('ejecucion.respuesta.alternativas.2'), 'ejecucion.respuesta.alternativas.N');
});

test('comprobar detecta definiciones mal hechas', () => {
  const errores = comprobar([
    def('version.a', 'texto', 'blindado'),
    def('version.a', 'texto', 'blindado'),
    def('cosa.b', 'texto', 'blindado'),
    def('version.c', 'rarito', 'blindado'),
    def('version.d', 'enum', 'blindado'),
    def('version.e', 'texto', 'flexible'),
    def('version.f', 'texto', 'estable', { estado: 'obsoleto' }),
    def('version.a.hijo', 'texto', 'estable'),
  ]);
  for (const trozo of ['id repetido', 'colección conocida', 'tipo desconocido', 'enum necesita valores', 'flexible va con tipo json', 'obsoleto sin sustituido_por', 'campo y contenedor']) {
    assert.ok(errores.some((e) => e.includes(trozo)), `falta el error «${trozo}»:\n${errores.join('\n')}`);
  }
});

test('validador: blindado obligatorio, estable admite null, flexible libre, propuesto fuera', () => {
  const s = validador(mini, 'version');
  assert.deepEqual(s.required, ['_id', 'estado']);
  assert.equal(s.additionalProperties, false);
  assert.equal(s.properties._id.pattern, '^ver-');
  assert.deepEqual(s.properties.estado.enum, ['borrador', 'aprobada']);
  assert.deepEqual(s.properties.script.anyOf[1], { bsonType: 'null' });
  assert.equal(s.properties.funcion.properties.parametros.bsonType, 'object');
  assert.equal(s.properties.funcion.properties.parametros.additionalProperties, undefined);
  assert.equal(s.properties.idea, undefined);
  assert.ok(s.properties.viejo, 'un obsoleto sigue en el validador para los documentos antiguos');
});

test('validador: la obligación no cruza listas, pero cada elemento lleva sus blindados', () => {
  const s = validador(mini, 'version');
  const recorrido = s.properties.recorrido;
  assert.equal(recorrido.required, undefined);
  const campos = recorrido.properties.campos;
  assert.equal(campos.bsonType, 'array');
  assert.deepEqual(campos.items.required, ['nombre']);
  assert.equal(campos.items.additionalProperties, false);
  assert.equal(s.properties.respuesta.properties.alternativas.items.anyOf[0].bsonType, 'string');
});

test('rellenarPlantilla escribe las tablas entre marcas y respeta el resto', () => {
  const plantilla = 'Antes\n<!-- generado:entrada -->\nviejo\n<!-- /generado:entrada -->\nMedio\n<!-- generado:campos -->\n<!-- /generado:campos -->\nDespués';
  const otra = [...mini, def('negocio.secreto', 'texto', 'estable', { lee: ['mapear-recorrido'], sensible: true })];
  const r = rellenarPlantilla(plantilla, otra, 'mapear-recorrido');
  assert.ok(r.startsWith('Antes\n') && r.endsWith('Después'));
  assert.ok(!r.includes('viejo'));
  assert.match(r, /\| `version\.recorrido\.campos\.N\.nombre` \| texto \| blindado \|/);
  assert.match(r, /`negocio\.secreto`.*Sensible: no se entrega/);
  assert.ok(!r.includes('version.idea') && !r.includes('version.viejo'), 'solo campos activos');
  assert.equal(rellenarPlantilla(r, otra, 'mapear-recorrido'), r, 'regenerar no cambia nada');
  assert.throws(() => rellenarPlantilla('sin marcas', mini, 'x'), /Falta la marca/);
});

test('documentacion lista todos los campos con su estado', () => {
  const d = documentacion(mini);
  assert.match(d, /`version\.viejo`.*obsoleto → `version\.script`/);
  assert.match(d, /colección `versiones`/);
});
