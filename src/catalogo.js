import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const DIR = new URL('../catalogo/', import.meta.url);

// Colección de Mongo y prefijo de los _id para cada primera palabra de una ruta.
export const COLECCIONES = {
  negocio: { nombre: 'negocios', prefijo: 'neg' },
  proceso: { nombre: 'procesos', prefijo: 'proc' },
  version: { nombre: 'versiones', prefijo: 'ver' },
  ejecucion: { nombre: 'ejecuciones', prefijo: 'ejec' },
  corrida: { nombre: 'corridas', prefijo: 'corr' },
};

const NIVELES = ['blindado', 'estable', 'flexible'];
const ESTADOS = ['activo', 'propuesto', 'obsoleto'];
const ISO_CON_ZONA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const EMAIL = /[^@\s]+@[^@\s]+\.[a-z]{2,}/i;
// Palabras que delatan un dato personal en el nombre de un parámetro de la query (customer_email, tel, dni…).
const PALABRAS_PII = new Set(
  'nombre name firstname lastname apellido apellidos tel telefono phone mobile movil email mail correo tarjeta card dni nif nie passport pasaporte ssn dob nacimiento identidad cliente'.split(' '),
);
const esClavePii = (clave) => clave.toLowerCase().split(/[_\-.\s]+/).some((p) => PALABRAS_PII.has(p));

function exigir(ok, mensaje) {
  if (!ok) throw new Error(mensaje);
}

// Cada tipo sabe dar su esquema para el validador de Mongo y leer el texto que escribe un agente.
export const TIPOS = {
  texto: { esquema: () => ({ bsonType: 'string', minLength: 1 }), leer: (t) => t },
  texto_largo: { esquema: () => ({ bsonType: 'string' }), leer: (t) => t },
  url_sin_pii: {
    esquema: () => ({ bsonType: 'string', pattern: '^https?://' }),
    leer: (t) => {
      exigir(URL.canParse(t) && /^https?:$/.test(new URL(t).protocol), `«${t}» no es una URL http(s)`);
      const pii = [...new URL(t).searchParams].filter(([k, v]) => esClavePii(k) || EMAIL.test(v)).map(([k]) => k);
      exigir(!pii.length, `«${t}» lleva datos personales en la query (${pii.join(', ')}): quítalos`);
      return t;
    },
  },
  // E.164: «+34 928 565 098» → «+34928565098»; «0034…» → «+34…».
  telefono: {
    esquema: () => ({ bsonType: 'string', pattern: '^\\+[1-9][0-9]{7,14}$' }),
    leer: (t) => {
      const e164 = t.replace(/[\s\-().]/g, '').replace(/^00/, '+');
      exigir(/^\+[1-9]\d{7,14}$/.test(e164), `«${t}» no es un teléfono E.164 con prefijo internacional (+34928565098)`);
      return e164;
    },
  },
  zona_horaria: {
    esquema: () => ({ bsonType: 'string', pattern: '^[A-Za-z_]+(/[A-Za-z0-9_+-]+)*$' }),
    leer: (t) => {
      try {
        new Intl.DateTimeFormat('es', { timeZone: t });
      } catch {
        throw new Error(`«${t}» no es una zona horaria IANA`);
      }
      return t;
    },
  },
  entero: {
    esquema: () => ({ bsonType: ['int', 'long'] }),
    leer: (t) => {
      exigir(/^-?\d+$/.test(t), `«${t}» no es un entero`);
      return Number(t);
    },
  },
  booleano: {
    esquema: () => ({ bsonType: 'bool' }),
    leer: (t) => {
      exigir(t === 'true' || t === 'false', `«${t}» no es true ni false`);
      return t === 'true';
    },
  },
  fecha: {
    esquema: () => ({ bsonType: 'date' }),
    leer: (t) => {
      exigir(ISO_CON_ZONA.test(t) && !isNaN(Date.parse(t)), `«${t}» no es una fecha ISO 8601 con hora y zona`);
      return new Date(t);
    },
  },
  id: {
    esquema: () => ({ bsonType: 'string', pattern: '^[a-z]+-[a-z0-9-]+$' }),
    leer: (t) => {
      exigir(/^[a-z]+-[a-z0-9-]+$/.test(t), `«${t}» no es un id (prefijo-nombre)`);
      return t;
    },
  },
  enum: {
    esquema: (d) => ({ enum: d.valores }),
    leer: (t, d) => {
      exigir(d.valores.includes(t), `«${t}» no es uno de: ${d.valores.join(', ')}`);
      return t;
    },
  },
  json: {
    esquema: () => ({ bsonType: 'object' }),
    leer: (t) => {
      let v;
      try {
        v = JSON.parse(t);
      } catch (e) {
        throw new Error(`JSON no válido: ${e.message}`);
      }
      exigir(v && typeof v === 'object' && !Array.isArray(v), 'el JSON debe ser un objeto');
      return v;
    },
  },
};

// Colección a la que apunta un campo id_*: proceso.id_negocio → negocio; proceso.id_version_activa → version.
export const referida = (d) => d.tipo === 'id' && Object.keys(COLECCIONES).find((r) => new RegExp(`(^|\\.)id_${r}(_|$)`).test(d.id));

// version.recorrido.campos.3.nombre -> version.recorrido.campos.N.nombre
export const patron = (ruta) => ruta.replace(/\.\d+(?=\.|$)/g, '.N');

export function comprobar(defs) {
  const errores = [];
  const ids = new Set();
  for (const d of defs) {
    const e = (m) => errores.push(`${d.id ?? '(sin id)'}: ${m}`);
    if (!/^[a-z_]+(\.([a-z_0-9]+|N))+$/.test(d.id ?? '')) e('id mal formado');
    if (ids.has(d.id)) e('id repetido');
    ids.add(d.id);
    if (!COLECCIONES[d.id?.split('.')[0]]) e('la primera palabra no es una colección conocida');
    if (!TIPOS[d.tipo]) e(`tipo desconocido «${d.tipo}»`);
    if (!NIVELES.includes(d.nivel)) e(`nivel desconocido «${d.nivel}»`);
    if (!ESTADOS.includes(d.estado)) e(`estado desconocido «${d.estado}»`);
    if (typeof d.descripcion !== 'string' || !d.descripcion.trim()) e('falta descripcion');
    if (!Array.isArray(d.escribe) || !d.escribe.length) e('escribe debe ser una lista no vacía');
    if (!Array.isArray(d.lee)) e('lee debe ser una lista');
    if (typeof d.sensible !== 'boolean') e('sensible debe ser true o false');
    if (d.tipo === 'enum' && !(Array.isArray(d.valores) && d.valores.length)) e('un enum necesita valores');
    if ((d.tipo === 'json') !== (d.nivel === 'flexible')) e('flexible va con tipo json, y json con flexible');
    if (d.alias !== undefined && !(Array.isArray(d.alias) && d.alias.every((a) => /^[a-z_][a-z_0-9]*(\.([a-z_0-9]+|N))*$/.test(a)))) {
      e('alias debe ser una lista de rutas (minúsculas, puntos y N)');
    }
  }
  // Un alias apunta a un solo campo, no coincide con ningún id y tiene las mismas listas (N) que su campo.
  const duenos = new Map();
  const cuentaN = (r) => r.split('.').filter((s) => s === 'N').length;
  for (const d of defs) {
    for (const a of Array.isArray(d.alias) ? d.alias : []) {
      if (ids.has(a)) errores.push(`${d.id}: el alias «${a}» es el id de otro campo`);
      if (duenos.has(a)) errores.push(`${d.id}: el alias «${a}» ya es de ${duenos.get(a)}`);
      if (cuentaN(a) !== cuentaN(d.id)) errores.push(`${d.id}: el alias «${a}» no tiene las mismas listas (N) que el campo`);
      duenos.set(a, d.id);
    }
  }
  for (const d of defs) {
    if (d.estado === 'obsoleto' && !ids.has(d.sustituido_por)) errores.push(`${d.id}: obsoleto sin sustituido_por válido`);
    if (defs.some((o) => o.id.startsWith(d.id + '.'))) errores.push(`${d.id}: es a la vez campo y contenedor de otros`);
  }
  return errores;
}

export function cargar() {
  const defs = [];
  const errores = [];
  for (const f of ficheros()) {
    for (const d of JSON.parse(readFileSync(new URL(f, DIR), 'utf8'))) {
      if (`${d.id?.split('.')[0]}.json` !== f) errores.push(`${d.id}: está en ${f}, que no es su colección`);
      defs.push(d);
    }
  }
  errores.push(...comprobar(defs));
  if (errores.length) throw new Error('Catálogo con errores:\n- ' + errores.join('\n- '));
  return defs;
}

// Versión del catálogo: huella de sus ficheros, para no depender de subirla a mano.
export function huella() {
  const h = createHash('sha256');
  for (const f of ficheros()) h.update(f).update(readFileSync(new URL(f, DIR), 'utf8').replace(/\r\n/g, '\n'));
  return h.digest('hex').slice(0, 12);
}

const ficheros = () => readdirSync(DIR).filter((f) => f.endsWith('.json')).sort();
