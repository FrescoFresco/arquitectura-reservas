import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { cargar, COLECCIONES, TIPOS } from './catalogo.js';

const objeto = () => ({ bsonType: 'object', properties: {}, additionalProperties: false });

function hoja(d) {
  const s = { ...TIPOS[d.tipo].esquema(d), description: d.descripcion };
  return d.nivel === 'estable' ? { anyOf: [s, { bsonType: 'null' }], description: d.descripcion } : s;
}

// $jsonSchema de una colección. Blindado = obligatorio en su objeto (la obligación no cruza una lista:
// una lista puede faltar, pero cada elemento que exista lleva sus blindados).
export function validador(defs, raiz) {
  const doc = objeto();
  doc.properties._id = { bsonType: 'string', pattern: `^${COLECCIONES[raiz].prefijo}-` };
  doc.required = ['_id'];
  for (const d of defs.filter((d) => d.id.startsWith(raiz + '.') && d.estado !== 'propuesto')) {
    const segs = d.id.split('.').slice(1);
    let nodo = doc;
    let cadena = [];
    for (let i = 0; i < segs.length; i++) {
      const clave = segs[i];
      if (clave === 'N') continue;
      const lista = segs[i + 1] === 'N';
      const fin = i === segs.length - 1 || (lista && i + 1 === segs.length - 1);
      cadena.push([nodo, clave]);
      if (lista) {
        nodo = (nodo.properties[clave] ??= { bsonType: 'array', items: fin ? hoja(d) : objeto() }).items;
        cadena = [];
      } else if (fin) {
        nodo.properties[clave] = hoja(d);
      } else {
        nodo = nodo.properties[clave] ??= objeto();
      }
    }
    if (d.nivel === 'blindado' && d.estado === 'activo') {
      for (const [n, c] of cadena) n.required = [...new Set([...(n.required ?? []), c])];
    }
  }
  return doc;
}

const activos = (defs, filtro) => defs.filter((d) => d.estado === 'activo' && filtro(d));
const tipo = (d) => (d.tipo === 'enum' ? `enum: ${d.valores.join(', ')}` : d.tipo);

export function tablaEntrada(defs, plantilla) {
  const filas = activos(defs, (d) => d.lee.includes(plantilla)).map(
    (d) => `| \`${d.id}\` | ${tipo(d)} | ${d.descripcion}${d.sensible ? ' **Sensible: no se entrega.**' : ''} |`,
  );
  return ['| Campo | Tipo | Descripción |', '|---|---|---|', ...filas].join('\n');
}

export function tablaCampos(defs, plantilla) {
  const filas = activos(defs, (d) => d.escribe.includes(plantilla)).map(
    (d) => `| \`${d.id}\` | ${tipo(d)} | ${d.nivel} | ${d.descripcion} |`,
  );
  return ['| Campo | Tipo | Nivel | Descripción |', '|---|---|---|---|', ...filas].join('\n');
}

function reemplazar(texto, marca, contenido) {
  const re = new RegExp(`(<!-- generado:${marca} -->)[\\s\\S]*?(<!-- /generado:${marca} -->)`);
  if (!re.test(texto)) throw new Error(`Falta la marca <!-- generado:${marca} --> … <!-- /generado:${marca} -->`);
  return texto.replace(re, (_, a, b) => `${a}\n${contenido}\n${b}`);
}

export const rellenarPlantilla = (texto, defs, plantilla) =>
  reemplazar(reemplazar(texto, 'entrada', tablaEntrada(defs, plantilla)), 'campos', tablaCampos(defs, plantilla));

export function documentacion(defs) {
  const partes = ['# Catálogo de campos ancla', '', '> Generado por `npm run generar` desde `catalogo/`. No lo edites a mano.'];
  for (const [raiz, c] of Object.entries(COLECCIONES)) {
    partes.push('', `## ${raiz} → colección \`${c.nombre}\` (ids \`${c.prefijo}-…\`)`, '');
    partes.push('| Campo | Tipo | Nivel | Escribe | Lee | Sensible | Estado | Descripción |', '|---|---|---|---|---|---|---|---|');
    for (const d of defs.filter((d) => d.id.startsWith(raiz + '.'))) {
      const estado = d.estado === 'obsoleto' ? `obsoleto → \`${d.sustituido_por}\`` : d.estado;
      partes.push(`| \`${d.id}\` | ${tipo(d)} | ${d.nivel} | ${d.escribe.join(', ')} | ${d.lee.join(', ')} | ${d.sensible ? 'sí' : 'no'} | ${estado} | ${d.descripcion} |`);
    }
  }
  return partes.join('\n') + '\n';
}

async function aplicarValidadores(defs) {
  const { conectar } = await import('./db.js');
  const { cliente, db } = await conectar();
  try {
    for (const [raiz, { nombre }] of Object.entries(COLECCIONES)) {
      const validator = { $jsonSchema: validador(defs, raiz) };
      const existe = (await db.listCollections({ name: nombre }).toArray()).length > 0;
      if (existe) await db.command({ collMod: nombre, validator, validationLevel: 'strict', validationAction: 'error' });
      else await db.createCollection(nombre, { validator, validationLevel: 'strict', validationAction: 'error' });
      console.log(`  validador ${existe ? 'actualizado' : 'creado'}: ${nombre}`);
    }
  } finally {
    await cliente.close();
  }
}

if (import.meta.main) {
  const defs = cargar();
  console.log(`Catálogo: ${defs.length} campos, sin errores.`);
  const dir = new URL('../plantillas/', import.meta.url);
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    const ruta = new URL(f, dir);
    writeFileSync(ruta, rellenarPlantilla(readFileSync(ruta, 'utf8'), defs, f.replace(/\.md$/, '')));
    console.log(`  tablas regeneradas: plantillas/${f}`);
  }
  mkdirSync(new URL('../docs/', import.meta.url), { recursive: true });
  writeFileSync(new URL('../docs/catalogo.md', import.meta.url), documentacion(defs));
  console.log('  documentación: docs/catalogo.md');
  await aplicarValidadores(defs);
}
