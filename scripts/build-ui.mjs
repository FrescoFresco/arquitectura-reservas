#!/usr/bin/env node
/**
 * Assembles the static Campos ancla panel into dist-ui/ for Cloudflare deploy.
 * (Workers Static Assets — preferred while the API token lacks Pages Edit.)
 */
import { cpSync, mkdirSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const out = join(root, 'dist-ui');

const files = [
  'index.html',
  'color-entidad-ui.js',
  'ajustes-ui.js',
  'agentes-ui.js',
  'campos-ancla-ui.js',
  'campos-mongodb-ui.js',
  'catalogo-ui.js',
  'clusters-ui.js',
  'colecciones-ui.js',
  'fundamentos-ui.js',
  'proyectos-ui.js',
  'skills-ui.js',
  'system-prompts-ui.js',
  'system-prompts-catalog.js',
  'flujos-corridas-ui.js',
];

const dirs = ['catalogo', 'documentacion'];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

for (const f of files) {
  const src = join(root, f);
  if (!existsSync(src)) throw new Error('Falta archivo UI: ' + f);
  cpSync(src, join(out, f));
}

for (const d of dirs) {
  const src = join(root, d);
  if (!existsSync(src)) throw new Error('Falta carpeta UI: ' + d);
  cpSync(src, join(out, d), { recursive: true });
}

function countFiles(dir) {
  let n = 0;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) n += countFiles(p);
    else n += 1;
  }
  return n;
}

console.log('dist-ui listo:', countFiles(out), 'archivos →', out);
