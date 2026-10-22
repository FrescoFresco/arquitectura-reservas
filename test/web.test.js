import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pagina } from '../src/web.js';

const html = pagina();

test('la web tiene las seis pestañas', () => {
  for (const id of ['skills', 'campos-ancla', 'base-de-datos', 'agentes', 'fundamentos', 'documentacion']) {
    assert.match(html, new RegExp(`<section id="${id}" role="tabpanel"`), id);
  }
});

test('Campos ancla muestra la ruta de MongoDB (colección.campo)', () => {
  assert.ok(html.includes('<code>versiones.recorrido.campos.nombre</code>'));
  assert.ok(html.includes('<code>negocios.zona_horaria</code>'));
});

test('Base de datos lleva los validadores y el diagrama; Agentes, quién escribe y lee', () => {
  assert.ok(html.includes('&quot;$jsonSchema&quot;'));
  assert.match(html, /data-mermaid="erDiagram/);
  assert.ok(html.includes('<th>mapear-recorrido</th>') && html.includes('<th>generar-script</th>'));
});

test('Fundamentos y Documentación salen del CLAUDE.md y de aprender-mongo', () => {
  assert.ok(html.includes('Los agentes juzgan; el código calcula, ejecuta y guarda.'));
  assert.ok(html.includes('Aprender MongoDB con nuestros datos'));
  assert.ok(html.includes('](#base-de-datos)'), 'el enlace a esquema.md lleva a la pestaña');
});

test('index.html está al día: si falla, ejecuta npm run web', () => {
  const sinFecha = (t) => t.replace(/\r\n/g, '\n').replace(/Generada el \d{4}-\d{2}-\d{2}/, '');
  assert.equal(sinFecha(readFileSync(new URL('../index.html', import.meta.url), 'utf8')), sinFecha(html));
});

test('solo lectura: sin formularios, sin API y sin pedir URI', () => {
  assert.doesNotMatch(html, /<form|<input|<textarea|fetch\(|XMLHttpRequest/i);
  assert.doesNotMatch(html, /mongodb(\+srv)?:\/\//);
});
