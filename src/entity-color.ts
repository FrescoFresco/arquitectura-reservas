/**
 * Color de acento por entidad de catálogo (#RRGGBB nullable).
 * Validación compartida API; la UI deriva tint/ink y Generar (ΔE76).
 */

export const ENTITY_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;
export const DEFAULT_ENTITY_INK = '#1c63d5';

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
