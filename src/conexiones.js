// Clave (URI de Atlas) de cada base de datos, en conexiones.local.json: { "Prueba_software": "mongodb+srv://…" }.
// El fichero está en .gitignore y nunca sale de este ordenador. Si una base no tiene clave, se usa MONGODB_URI del .env.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const fichero = () => process.env.CONEXIONES_FICHERO || fileURLToPath(new URL('../conexiones.local.json', import.meta.url));
export const NOMBRE_BASE = /^[A-Za-z0-9_-]{1,63}$/;
export const nombreValido = (base) => typeof base === 'string' && NOMBRE_BASE.test(base) && !/^(null|undefined)$/i.test(base);

// Base por defecto: MONGODB_DB del .env o, si no hay .env, la del repositorio (package.json → config.base).
export const BASE_DEL_REPO = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).config.base;
export const baseActual = () => process.env.MONGODB_DB || BASE_DEL_REPO;

const crudas = () => (existsSync(fichero()) ? JSON.parse(readFileSync(fichero(), 'utf8')) : {});

// Solo las entradas con un nombre de base válido; las demás («null», vacías…) se ignoran.
export function leerConexiones() {
  return Object.fromEntries(Object.entries(crudas()).filter(([base]) => nombreValido(base)));
}

export const clavesIgnoradas = () => Object.keys(crudas()).filter((base) => !nombreValido(base));

function escribir(conexiones) {
  writeFileSync(fichero(), JSON.stringify(conexiones, null, 2) + '\n', { mode: 0o600 });
}

export function guardarConexion(base, uri) {
  if (!nombreValido(base)) throw new Error(`«${base}» no es un nombre de base válido: elige una base antes de guardar la clave`);
  if (!/^mongodb(\+srv)?:\/\/\S+$/.test(uri ?? '')) throw new Error('La URI tiene que empezar por mongodb+srv:// o mongodb://');
  escribir({ ...crudas(), [base]: uri.trim() });
}

export function borrarConexion(base) {
  const { [base]: _, ...resto } = crudas();
  escribir(resto);
}

// La clave de una base y de dónde sale: su ficha (conexiones.local.json) o el .env.
export function claveDe(base) {
  const propia = leerConexiones()[base];
  if (propia) return { uri: propia, origen: 'ficha' };
  if (process.env.MONGODB_URI) return { uri: process.env.MONGODB_URI, origen: '.env' };
  return { uri: null, origen: null };
}

// Solo el host: «mongodb+srv://usuario:clave@cluster0.ejemplo.mongodb.net/?x=1» → «cluster0.ejemplo.mongodb.net».
export const enmascarar = (uri) => uri?.match(/^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/?]+)/)?.[1] ?? null;
