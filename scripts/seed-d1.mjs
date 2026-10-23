#!/usr/bin/env node
/**
 * Semilla D1 desde catalogo/** (índices JSON + markdown de versiones).
 * Uso:
 *   node scripts/seed-d1.mjs --local
 *   node scripts/seed-d1.mjs --remote
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const remote = process.argv.includes('--remote');
const flag = remote ? '--remote' : '--local';
const dbName = 'campos-ancla-db';

function readJson(rel) {
  return JSON.parse(readFileSync(join(root, rel), 'utf8'));
}

function readMd(rel) {
  const p = join(root, rel);
  if (!existsSync(p)) return '';
  return readFileSync(p, 'utf8');
}

function esc(s) {
  return String(s ?? '').replace(/'/g, "''");
}

async function main() {
  const { writeFileSync, unlinkSync } = await import('node:fs');
  const stmts = [];
  const now = new Date().toISOString();

  stmts.push('DELETE FROM proyecto_skills;');
  stmts.push('DELETE FROM ancla_skills;');
  stmts.push('DELETE FROM skill_anclas;');
  stmts.push('DELETE FROM skill_versions;');
  stmts.push('DELETE FROM proyecto_versions;');
  stmts.push('DELETE FROM fundamento_versions;');
  stmts.push('DELETE FROM skills;');
  stmts.push('DELETE FROM anclas;');
  stmts.push('DELETE FROM campos_mongo;');
  stmts.push('DELETE FROM proyectos;');
  stmts.push('DELETE FROM fundamentos;');
  stmts.push('DELETE FROM agentes;');
  stmts.push('DELETE FROM invites;');

  const skillsIdx = readJson('catalogo/skills/index.json');
  for (const ins of skillsIdx.instrucciones || []) {
    stmts.push(
      `INSERT INTO skills (id, nombre, descripcion, hash, created_at, updated_at) VALUES ('${esc(ins.id)}', '${esc(ins.nombre)}', '${esc(ins.descripcion || '')}', '${esc(ins.hash || '')}', '${now}', '${now}');`
    );
    for (const v of ins.versiones || []) {
      const md = v.ruta ? readMd(v.ruta) : '';
      stmts.push(
        `INSERT INTO skill_versions (skill_id, numero, fecha, markdown, ruta, nombre_archivo, hash) VALUES ('${esc(ins.id)}', ${Number(v.numero)}, '${esc(v.fecha || now.slice(0, 10))}', '${esc(md)}', '${esc(v.ruta || '')}', '${esc(v.nombreArchivo || '')}', '${esc(v.hash || '')}');`
      );
    }
    const entradas = Array.isArray(ins.entradas) ? ins.entradas : [];
    const salidas = Array.isArray(ins.salidas)
      ? ins.salidas
      : Array.isArray(ins.anclas)
        ? ins.anclas
        : [];
    for (const a of entradas) {
      stmts.push(
        `INSERT OR IGNORE INTO skill_anclas (skill_id, ancla, direccion) VALUES ('${esc(ins.id)}', '${esc(a)}', 'entrada');`
      );
    }
    for (const a of salidas) {
      stmts.push(
        `INSERT OR IGNORE INTO skill_anclas (skill_id, ancla, direccion) VALUES ('${esc(ins.id)}', '${esc(a)}', 'salida');`
      );
    }
  }

  const anclasIdx = readJson('catalogo/campos-ancla/index.json');
  for (const c of anclasIdx.campos || []) {
    const aliases = JSON.stringify(Array.isArray(c.aliases) ? c.aliases : []);
    // N2: ficha = definición; valores/observaciones van en ancla_valores_negocio.
    const sensible = c.sensible ? 1 : 0;
    stmts.push(
      `INSERT INTO anclas (id, ancla, etiqueta, clave_mongo, coleccion, base_datos, tipo, obligatorio, formato, descripcion, ejemplo, hash, aliases, observaciones, valor_actual, sensible, created_at, updated_at) VALUES ('${esc(c.id)}', '${esc(c.ancla)}', '${esc(c.etiqueta || '')}', '${esc(c.claveMongo || '')}', '${esc(c.coleccion || '')}', '${esc(c.baseDatos || 'software_reservas')}', '${esc(c.tipo || 'string')}', ${c.obligatorio ? 1 : 0}, '${esc(c.formato || '')}', '${esc(c.descripcion || '')}', '${esc(c.ejemplo || '')}', '${esc(c.hash || '')}', '${esc(aliases)}', '[]', '', ${sensible}, '${now}', '${now}');`
    );
    for (const sid of c.skills || []) {
      stmts.push(`INSERT OR IGNORE INTO ancla_skills (ancla_id, skill_id) VALUES ('${esc(c.id)}', '${esc(sid)}');`);
    }
  }

  const mongoIdx = readJson('catalogo/campos-mongodb/index.json');
  for (const c of mongoIdx.campos || []) {
    const proyeccion = esc(c.proyeccionMongo || '');
    const elemento = esc(JSON.stringify(c.proyeccionElemento || {}));
    const indices = esc(JSON.stringify(Array.isArray(c.indices) ? c.indices : []));
    const hijos = esc(JSON.stringify(Array.isArray(c.hijos) ? c.hijos : []));
    const proyecto = esc(c.proyecto || 'reservas');
    const enumJson = esc(JSON.stringify(Array.isArray(c.enum) ? c.enum : []));
    stmts.push(
      `INSERT INTO campos_mongo (id, campo, base_datos, coleccion, clave, bson_type, obligatorio, descripcion, ancla, hash, proyeccion_mongo, proyeccion_elemento, indices, proyecto, hijos, enum_json, created_at, updated_at) VALUES ('${esc(c.id)}', '${esc(c.campo)}', '${esc(c.baseDatos || 'software_reservas')}', '${esc(c.coleccion || '')}', '${esc(c.clave || '')}', '${esc(c.bsonType || 'string')}', ${c.obligatorio ? 1 : 0}, '${esc(c.descripcion || '')}', '${esc(c.ancla || '')}', '${esc(c.hash || '')}', '${proyeccion}', '${elemento}', '${indices}', '${proyecto}', '${hijos}', '${enumJson}', '${now}', '${now}');`
    );
  }

  const proyIdx = readJson('catalogo/proyectos/index.json');
  for (const p of proyIdx.proyectos || []) {
    const colecciones = esc(JSON.stringify(Array.isArray(p.colecciones) ? p.colecciones : []));
    const relaciones = esc(JSON.stringify(Array.isArray(p.relaciones) ? p.relaciones : []));
    const agentesJson = esc(JSON.stringify(Array.isArray(p.agentes) ? p.agentes : []));
    const legacy = p.legacyNegocio ? 1 : 0;
    stmts.push(
      `INSERT INTO proyectos (id, nombre, descripcion, hash, created_at, updated_at, base_datos, colecciones, relaciones, agentes_json, legacy_negocio) VALUES ('${esc(p.id)}', '${esc(p.nombre)}', '${esc(p.descripcion || '')}', '${esc(p.hash || '')}', '${now}', '${now}', '${esc(p.baseDatos || '')}', '${colecciones}', '${relaciones}', '${agentesJson}', ${legacy});`
    );
    for (const v of p.versiones || []) {
      const md = v.ruta ? readMd(v.ruta) : '';
      stmts.push(
        `INSERT INTO proyecto_versions (proyecto_id, numero, fecha, markdown, ruta, nombre_archivo, hash) VALUES ('${esc(p.id)}', ${Number(v.numero)}, '${esc(v.fecha || now.slice(0, 10))}', '${esc(md)}', '${esc(v.ruta || '')}', '${esc(v.nombreArchivo || '')}', '${esc(v.hash || '')}');`
      );
    }
    for (const sid of p.skills || []) {
      stmts.push(`INSERT OR IGNORE INTO proyecto_skills (proyecto_id, skill_id) VALUES ('${esc(p.id)}', '${esc(sid)}');`);
    }
  }

  const fundIdx = readJson('catalogo/fundamentos/index.json');
  for (const f of fundIdx.fundamentos || []) {
    stmts.push(
      `INSERT INTO fundamentos (id, nombre, descripcion, hash, created_at, updated_at) VALUES ('${esc(f.id)}', '${esc(f.nombre)}', '${esc(f.descripcion || '')}', '${esc(f.hash || '')}', '${now}', '${now}');`
    );
    for (const v of f.versiones || []) {
      const md = v.ruta ? readMd(v.ruta) : '';
      stmts.push(
        `INSERT INTO fundamento_versions (fundamento_id, numero, fecha, markdown, ruta, nombre_archivo, hash) VALUES ('${esc(f.id)}', ${Number(v.numero)}, '${esc(v.fecha || now.slice(0, 10))}', '${esc(md)}', '${esc(v.ruta || '')}', '${esc(v.nombreArchivo || '')}', '${esc(v.hash || '')}');`
      );
    }
  }

  const agIdx = readJson('catalogo/agentes/index.json');
  for (const a of agIdx.agentes || []) {
    const clave = a.inviteUsada || `inv_seed_${a.id}`;
    const proyectos = esc(JSON.stringify(Array.isArray(a.proyectos) ? a.proyectos : []));
    const lee = esc(JSON.stringify(Array.isArray(a.lee) ? a.lee : []));
    const escribe = esc(JSON.stringify(Array.isArray(a.escribe) ? a.escribe : []));
    stmts.push(
      `INSERT OR IGNORE INTO invites (clave, creada, usada_por, revocada) VALUES ('${esc(clave)}', '${now}', '${esc(a.id)}', 0);`
    );
    stmts.push(
      `INSERT INTO agentes (id, nombre, foto, descripcion, invite_usada, last_seen, hash, created_at, updated_at, proyectos, lee, escribe) VALUES ('${esc(a.id)}', '${esc(a.nombre)}', '${esc(a.foto || '')}', '${esc(a.descripcion || '')}', '${esc(clave)}', '${esc(a.lastSeen || '')}', '${esc(a.hash || '')}', '${now}', '${now}', '${proyectos}', '${lee}', '${escribe}');`
    );
  }

  // Valores por negocio (cajón): teléfono real de Pelo Sur; +34600111222 solo como prueba etiquetada.
  stmts.push(
    `INSERT OR REPLACE INTO ancla_valores_negocio (negocio_id, ancla_id, observaciones, valor_actual, updated_at) VALUES ('pelo-sur', 'negocio.telefono', '${esc(JSON.stringify([
      { valor: '+34612000111', url: 'https://pelosur.es/contacto', timestamp: '2026-10-13T10:00:00.000Z', skill_id: 'descubrir-negocio', visto_en: 'web' },
      { valor: '+34699111222', url: 'https://pelosur.es/contacto', timestamp: '2026-10-17T16:30:00.000Z', skill_id: 'descubrir-negocio', visto_en: 'web' },
      { valor: '+34600111222', url: 'https://example.test/prueba', timestamp: '2026-10-21T12:00:00.000Z', skill_id: 'descubrir-negocio', visto_en: 'prueba' },
    ]))}', '+34699111222', '${now}');`
  );

  // Invite de demo para pruebas locales
  stmts.push(
    `INSERT OR IGNORE INTO invites (clave, creada, usada_por, revocada) VALUES ('inv_local_demo', '${now}', NULL, 0);`
  );

  const file = join(root, '.seed-tmp.sql');
  writeFileSync(file, stmts.join('\n') + '\n');
  console.log(`Sembrando ${stmts.length} sentencias (${remote ? 'remote' : 'local'})…`);
  const r = spawnSync('npx', ['wrangler', 'd1', 'execute', dbName, flag, '--file', file], {
    cwd: root,
    stdio: 'inherit',
    shell: true,
  });
  try {
    unlinkSync(file);
  } catch (_) {}
  if (r.status !== 0) process.exit(r.status || 1);
  console.log('Listo. Invite de prueba: inv_local_demo');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
