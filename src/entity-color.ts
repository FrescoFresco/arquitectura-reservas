/**
 * Color de acento por entidad de catálogo (#RRGGBB nullable).
 * Módulo único API: validar, leer de fila, PUT color-only (sin bump MD).
 */

export const ENTITY_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;
export const DEFAULT_ENTITY_INK = '#1c63d5';

/** Tablas D1 con columna `color` (colecciones viven en JSON de proyectos). */
export const ENTITY_COLOR_TABLES = [
  'skills',
  'anclas',
  'campos_mongo',
  'clusters',
  'proyectos',
  'system_prompts',
  'fundamentos',
  'agentes',
  'flujos',
  'ejecutores',
] as const;

export type EntityColorTable = (typeof ENTITY_COLOR_TABLES)[number];

const TABLE_SET = new Set<string>(ENTITY_COLOR_TABLES);

export function bodyHasColor(body: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(body, 'color');
}

/**
 * Valida body.color. Hex → lowercased; null/'' → null; inválido → error.
 * No llamar si la clave no está en el body.
 */
export function parseEntityColor(
  raw: unknown
): { ok: true; color: string | null } | { ok: false; error: string } {
  if (raw === null || raw === '') return { ok: true, color: null };
  const s = String(raw).trim();
  if (!ENTITY_COLOR_RE.test(s)) {
    return { ok: false, error: 'color inválido (usa #RRGGBB o null).' };
  }
  return { ok: true, color: s.toLowerCase() };
}

/** Extrae color de una fila D1 / objeto API. */
export function colorFromRow(row: Record<string, unknown> | null | undefined): string | null {
  if (!row) return null;
  const raw = row.color;
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  if (!ENTITY_COLOR_RE.test(s)) return null;
  return s.toLowerCase();
}

/** true si el body solo pide cambiar color (sin bump de versión MD). */
export function isColorOnlyBody(body: Record<string, unknown>): boolean {
  const keys = Object.keys(body).filter((k) => body[k] !== undefined);
  return keys.length === 1 && keys[0] === 'color';
}

/** UPDATE color + updated_at en cualquier tabla del catálogo. */
export async function updateEntityColorOnly(
  db: D1Database,
  table: EntityColorTable,
  id: string,
  color: string | null,
  updatedAt: string
): Promise<void> {
  if (!TABLE_SET.has(table)) {
    throw new Error('Tabla de color desconocida: ' + table);
  }
  await db
    .prepare(`UPDATE ${table} SET color = ?, updated_at = ? WHERE id = ?`)
    .bind(color, updatedAt, id)
    .run();
}

/**
 * Si body es solo `{ color }`, valida + persiste y devuelve el color.
 * Si no es color-only → null (sigue el PUT normal).
 * Si color inválido → { error }.
 */
export async function tryColorOnlyUpdate(
  db: D1Database,
  table: EntityColorTable,
  id: string,
  body: Record<string, unknown>,
  updatedAt: string
): Promise<{ color: string | null } | { error: string } | null> {
  if (!isColorOnlyBody(body)) return null;
  const parsed = parseEntityColor(body.color);
  if (!parsed.ok) return { error: parsed.error };
  await updateEntityColorOnly(db, table, id, parsed.color, updatedAt);
  return { color: parsed.color };
}
