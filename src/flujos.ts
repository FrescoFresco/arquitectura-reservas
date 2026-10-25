/**
 * Flujos de ejecución: nodos (Inicio, Skill, Decisión, Espera, Subflujo, Fin) + aristas.
 * Condiciones de decisión: lenguaje mínimo y seguro sobre `datos` de la corrida.
 */

import { getByPath } from './skill-io';

export type NodoTipo = 'inicio' | 'skill' | 'decision' | 'espera' | 'subflujo' | 'fin';

export type FlujoNodo = {
  id: string;
  tipo: NodoTipo;
  /** Solo tipo skill */
  skill?: string;
  /** Solo tipo decisión — ver documentacion/api.md */
  condicion?: Condicion;
  /** Solo tipo subflujo */
  flujo_id?: string;
  /** Subflujo: ancla con array → una corrida hija por elemento (máx. 50). */
  sobre_ancla?: string;
  /** Solo tipo espera: segundos de reloj (>=0). */
  segundos?: number;
  /** Solo tipo espera: "tiempo" | "humano". */
  modo?: 'tiempo' | 'humano';
  label?: string;
};

export type FlujoArista = {
  desde: string;
  hacia: string;
  /**
   * Para nodos decisión: true = rama si, false = rama no.
   * Ausente en aristas de skill/inicio/espera/subflujo (una sola salida).
   */
  cuando?: boolean;
};

/** Condiciones seguras (sin eval). Paths = claves de ancla en `datos` (p. ej. `_negocio.nombre_`). */
export type Condicion =
  | { eq: [string, unknown] }
  | { neq: [string, unknown] }
  | { exists: string }
  | { truthy: string }
  | { gt: [string, unknown] }
  | { gte: [string, unknown] }
  | { lt: [string, unknown] }
  | { lte: [string, unknown] }
  | { contains: [string, unknown] }
  | { in: [string, unknown] }
  | { and: Condicion[] }
  | { or: Condicion[] }
  | { not: Condicion }
  | { match: Record<string, unknown> };

export type FlujoVersionDoc = {
  id: string;
  nombre: string;
  descripcion: string;
  proyectoId: string;
  version: number;
  nodos: FlujoNodo[];
  aristas: FlujoArista[];
  hash: string;
  color?: string | null;
};

export function parseNodos(raw: unknown): FlujoNodo[] {
  let list: unknown = raw;
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  const out: FlujoNodo[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const id = String(o.id || '').trim();
    const tipo = String(o.tipo || '').trim() as NodoTipo;
    if (!id || !isNodoTipo(tipo)) continue;
    const nodo: FlujoNodo = { id, tipo };
    if (o.skill != null) nodo.skill = String(o.skill).trim();
    if (o.flujo_id != null) nodo.flujo_id = String(o.flujo_id).trim();
    if (o.label != null) nodo.label = String(o.label);
    if (o.sobre_ancla != null) nodo.sobre_ancla = String(o.sobre_ancla).trim();
    if (o.condicion != null && typeof o.condicion === 'object') {
      nodo.condicion = o.condicion as Condicion;
    }
    if (tipo === 'espera') {
      let segundos: number | undefined;
      if (o.segundos != null && Number.isFinite(Number(o.segundos))) {
        segundos = Math.max(0, Math.floor(Number(o.segundos)));
      } else if (o.minutos != null && Number.isFinite(Number(o.minutos))) {
        segundos = Math.max(0, Math.floor(Number(o.minutos) * 60));
      } else if (o.horas != null && Number.isFinite(Number(o.horas))) {
        segundos = Math.max(0, Math.floor(Number(o.horas) * 3600));
      } else if (o.dias != null && Number.isFinite(Number(o.dias))) {
        segundos = Math.max(0, Math.floor(Number(o.dias) * 86400));
      }
      if (segundos != null) nodo.segundos = segundos;
      const modoRaw = String(o.modo || '').trim();
      if (modoRaw === 'tiempo' || modoRaw === 'humano') nodo.modo = modoRaw;
      else if (segundos != null && segundos > 0) nodo.modo = 'tiempo';
      else nodo.modo = 'humano';
    }
    out.push(nodo);
  }
  return out;
}

export function parseAristas(raw: unknown): FlujoArista[] {
  let list: unknown = raw;
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  const out: FlujoArista[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const desde = String(o.desde || '').trim();
    const hacia = String(o.hacia || '').trim();
    if (!desde || !hacia) continue;
    const a: FlujoArista = { desde, hacia };
    if (typeof o.cuando === 'boolean') a.cuando = o.cuando;
    out.push(a);
  }
  return out;
}

function isNodoTipo(t: string): t is NodoTipo {
  return (
    t === 'inicio' ||
    t === 'skill' ||
    t === 'decision' ||
    t === 'espera' ||
    t === 'subflujo' ||
    t === 'fin'
  );
}

export function findNodo(nodos: FlujoNodo[], id: string): FlujoNodo | null {
  return nodos.find((n) => n.id === id) || null;
}

export function findInicio(nodos: FlujoNodo[]): FlujoNodo | null {
  return nodos.find((n) => n.tipo === 'inicio') || nodos[0] || null;
}

/** Valor de ancla en `datos` (clave exacta `_…_`, bare, o ruta con puntos). */
export function getDato(datos: Record<string, unknown>, path: string): unknown {
  const key = String(path || '').trim();
  if (!key) return undefined;
  if (Object.prototype.hasOwnProperty.call(datos, key)) return datos[key];
  // También aceptar path sin guiones bajos extremos
  const bare = key.replace(/^_|_$/g, '');
  const withUnderscores = `_${bare}_`;
  if (Object.prototype.hasOwnProperty.call(datos, withUnderscores)) return datos[withUnderscores];
  // Rutas con puntos / _path_ anidadas
  if (key.includes('.') || bare.includes('.')) {
    const nested = getByPath(datos, key) ?? getByPath(datos, bare);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

/**
 * Evalúa condición sobre `datos`. Desconocida / mal formada → false.
 * No ejecuta código arbitrario.
 */
export function evalCondicion(condicion: Condicion | undefined, datos: Record<string, unknown>): boolean {
  if (!condicion || typeof condicion !== 'object') return false;

  if ('and' in condicion && Array.isArray(condicion.and)) {
    if (!condicion.and.length) return false;
    return condicion.and.every((c) => evalCondicion(c as Condicion, datos));
  }
  if ('or' in condicion && Array.isArray(condicion.or)) {
    if (!condicion.or.length) return false;
    return condicion.or.some((c) => evalCondicion(c as Condicion, datos));
  }
  if ('not' in condicion) {
    return !evalCondicion(condicion.not as Condicion, datos);
  }
  if ('match' in condicion && condicion.match && typeof condicion.match === 'object') {
    return evalMatchQuery(condicion.match as Record<string, unknown>, datos);
  }

  if ('eq' in condicion && Array.isArray(condicion.eq) && condicion.eq.length >= 2) {
    const left = getDato(datos, String(condicion.eq[0]));
    const right = condicion.eq[1];
    return valuesEqual(left, right);
  }
  if ('neq' in condicion && Array.isArray(condicion.neq) && condicion.neq.length >= 2) {
    const left = getDato(datos, String(condicion.neq[0]));
    const right = condicion.neq[1];
    return !valuesEqual(left, right);
  }
  if ('exists' in condicion) {
    const v = getDato(datos, String(condicion.exists));
    return v !== undefined && v !== null && v !== '';
  }
  if ('truthy' in condicion) {
    const v = getDato(datos, String(condicion.truthy));
    return Boolean(v);
  }
  if ('gt' in condicion && Array.isArray(condicion.gt) && condicion.gt.length >= 2) {
    return compareOrdered(getDato(datos, String(condicion.gt[0])), condicion.gt[1]) > 0;
  }
  if ('gte' in condicion && Array.isArray(condicion.gte) && condicion.gte.length >= 2) {
    return compareOrdered(getDato(datos, String(condicion.gte[0])), condicion.gte[1]) >= 0;
  }
  if ('lt' in condicion && Array.isArray(condicion.lt) && condicion.lt.length >= 2) {
    return compareOrdered(getDato(datos, String(condicion.lt[0])), condicion.lt[1]) < 0;
  }
  if ('lte' in condicion && Array.isArray(condicion.lte) && condicion.lte.length >= 2) {
    return compareOrdered(getDato(datos, String(condicion.lte[0])), condicion.lte[1]) <= 0;
  }
  if ('contains' in condicion && Array.isArray(condicion.contains) && condicion.contains.length >= 2) {
    const left = getDato(datos, String(condicion.contains[0]));
    const needle = condicion.contains[1];
    if (Array.isArray(left)) {
      return left.some((x) => valuesEqual(x, needle));
    }
    if (typeof left === 'string') {
      return left.toLowerCase().includes(String(needle ?? '').toLowerCase());
    }
    return false;
  }
  if ('in' in condicion && Array.isArray(condicion.in) && condicion.in.length >= 2) {
    const left = getDato(datos, String(condicion.in[0]));
    const arr = condicion.in[1];
    if (!Array.isArray(arr)) return false;
    return arr.some((x) => valuesEqual(left, x));
  }
  return false;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a === 'object' || typeof b === 'object') {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return String(a) === String(b);
}

/** Comparación numérica si ambos son números convertibles; si no, ISO/string. */
function compareOrdered(a: unknown, b: unknown): number {
  const na = toFiniteNumber(a);
  const nb = toFiniteNumber(b);
  if (na != null && nb != null) return na === nb ? 0 : na > nb ? 1 : -1;
  const sa = a == null ? '' : String(a);
  const sb = b == null ? '' : String(b);
  if (sa === sb) return 0;
  return sa > sb ? 1 : -1;
}

function toFiniteNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** Subconjunto seguro estilo `$match` Mongo sobre `datos`. */
function evalMatchQuery(query: Record<string, unknown>, datos: Record<string, unknown>): boolean {
  if ('$and' in query && Array.isArray(query.$and)) {
    return (query.$and as unknown[]).every(
      (q) => q && typeof q === 'object' && evalMatchQuery(q as Record<string, unknown>, datos)
    );
  }
  if ('$or' in query && Array.isArray(query.$or)) {
    return (query.$or as unknown[]).some(
      (q) => q && typeof q === 'object' && evalMatchQuery(q as Record<string, unknown>, datos)
    );
  }
  for (const [field, raw] of Object.entries(query)) {
    if (field.startsWith('$')) continue;
    const left = getDato(datos, field);
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const ops = raw as Record<string, unknown>;
      for (const [op, val] of Object.entries(ops)) {
        if (op === '$eq' && !valuesEqual(left, val)) return false;
        else if (op === '$ne' && valuesEqual(left, val)) return false;
        else if (op === '$gt' && !(compareOrdered(left, val) > 0)) return false;
        else if (op === '$gte' && !(compareOrdered(left, val) >= 0)) return false;
        else if (op === '$lt' && !(compareOrdered(left, val) < 0)) return false;
        else if (op === '$lte' && !(compareOrdered(left, val) <= 0)) return false;
        else if (op === '$in') {
          if (!Array.isArray(val) || !val.some((x) => valuesEqual(left, x))) return false;
        } else if (op === '$nin') {
          if (Array.isArray(val) && val.some((x) => valuesEqual(left, x))) return false;
        } else if (op === '$exists') {
          const exists = left !== undefined && left !== null;
          if (Boolean(val) !== exists) return false;
        } else if (op === '$regex') {
          try {
            const re = new RegExp(String(val), 'i');
            if (!re.test(String(left ?? ''))) return false;
          } catch {
            return false;
          }
        }
      }
    } else if (!valuesEqual(left, raw)) {
      return false;
    }
  }
  return true;
}

/**
 * Siguiente nodo desde `desdeId`.
 * - Decisión: elige arista con `cuando` = resultado de la condición.
 * - Resto: primera arista saliente (sin `cuando` o cualquiera).
 */
export function pickNextNodo(
  nodos: FlujoNodo[],
  aristas: FlujoArista[],
  desdeId: string,
  datos: Record<string, unknown>
): FlujoNodo | null {
  const desde = findNodo(nodos, desdeId);
  if (!desde) return null;
  const salientes = aristas.filter((a) => a.desde === desdeId);
  if (!salientes.length) return null;

  if (desde.tipo === 'decision') {
    const ok = evalCondicion(desde.condicion, datos);
    const match = salientes.find((a) => a.cuando === ok) || salientes.find((a) => a.cuando === undefined);
    if (!match) return null;
    return findNodo(nodos, match.hacia);
  }

  const plain = salientes.find((a) => a.cuando === undefined) || salientes[0];
  return findNodo(nodos, plain.hacia);
}

/**
 * Fase 3 — Aprobar (cuando=true / arista única) o Rechazar (cuando=false).
 * Devuelve null si no hay arista compatible.
 */
export function pickNextPorCuando(
  nodos: FlujoNodo[],
  aristas: FlujoArista[],
  desdeId: string,
  cuando: boolean
): FlujoNodo | null {
  const salientes = aristas.filter((a) => a.desde === desdeId);
  if (!salientes.length) return null;
  const match = salientes.find((a) => a.cuando === cuando);
  if (match) return findNodo(nodos, match.hacia);
  if (cuando === true) {
    const plain =
      salientes.find((a) => a.cuando === undefined) ||
      (salientes.length === 1 ? salientes[0] : undefined);
    return plain ? findNodo(nodos, plain.hacia) : null;
  }
  return null;
}

export type AvanceResultado =
  | { kind: 'skill'; nodo: FlujoNodo }
  | { kind: 'espera'; nodo: FlujoNodo }
  | { kind: 'subflujo'; nodo: FlujoNodo; flujoId: string }
  | { kind: 'fin'; nodo: FlujoNodo }
  | { kind: 'error'; error: string };

/**
 * Avanza desde un nodo ya «consumido» (p. ej. tras salidas de un skill, o tras Inicio)
 * saltando decisiones automáticamente hasta skill | espera | subflujo | fin.
 */
export function avanzarDesde(
  nodos: FlujoNodo[],
  aristas: FlujoArista[],
  desdeId: string,
  datos: Record<string, unknown>,
  maxHops = 32
): AvanceResultado {
  let curId = desdeId;
  for (let i = 0; i < maxHops; i++) {
    const next = pickNextNodo(nodos, aristas, curId, datos);
    if (!next) return { kind: 'error', error: `Sin arista saliente desde «${curId}».` };
    if (next.tipo === 'decision') {
      curId = next.id;
      continue;
    }
    if (next.tipo === 'inicio') {
      curId = next.id;
      continue;
    }
    if (next.tipo === 'skill') {
      if (!next.skill) return { kind: 'error', error: `Nodo skill «${next.id}» sin skill.` };
      return { kind: 'skill', nodo: next };
    }
    if (next.tipo === 'espera') return { kind: 'espera', nodo: next };
    if (next.tipo === 'subflujo') {
      const fid = String(next.flujo_id || '').trim();
      if (!fid) return { kind: 'error', error: `Nodo subflujo «${next.id}» sin flujo_id.` };
      return { kind: 'subflujo', nodo: next, flujoId: fid };
    }
    if (next.tipo === 'fin') return { kind: 'fin', nodo: next };
    return { kind: 'error', error: `Tipo de nodo desconocido: ${next.tipo}` };
  }
  return { kind: 'error', error: 'Demasiados saltos de decisión (posible ciclo).' };
}

/** Mermaid flowchart LR a partir de nodos/aristas (para UI). */
export function flujoToMermaid(nodos: FlujoNodo[], aristas: FlujoArista[]): string {
  const lines = ['flowchart LR'];
  const safe = (id: string) => String(id || '').replace(/[^a-zA-Z0-9_]/g, '_');
  for (const n of nodos) {
    const sid = safe(n.id);
    const label = (n.label || n.skill || n.flujo_id || n.tipo || n.id).replace(/"/g, "'");
    if (n.tipo === 'inicio' || n.tipo === 'fin') {
      lines.push(`  ${sid}((${label}))`);
    } else if (n.tipo === 'decision') {
      lines.push(`  ${sid}{${label}}`);
    } else {
      lines.push(`  ${sid}["${label}"]`);
    }
  }
  for (const a of aristas) {
    const d = safe(a.desde);
    const h = safe(a.hacia);
    if (typeof a.cuando === 'boolean') {
      lines.push(`  ${d} -->|"${a.cuando ? 'sí' : 'no'}"| ${h}`);
    } else {
      lines.push(`  ${d} --> ${h}`);
    }
  }
  if (nodos.length === 0) lines.push('  vacio["Sin nodos"]');
  return lines.join('\n');
}

/** Primera posición ejecutable tras Inicio (o error). */
export function primerPasoEjecutable(
  nodos: FlujoNodo[],
  aristas: FlujoArista[],
  datos: Record<string, unknown>
): AvanceResultado {
  const inicio = findInicio(nodos);
  if (!inicio) return { kind: 'error', error: 'Flujo sin nodo Inicio.' };
  if (inicio.tipo !== 'inicio') {
    // Flujo sin inicio explícito: tratar primer nodo
    if (inicio.tipo === 'skill') return { kind: 'skill', nodo: inicio };
    if (inicio.tipo === 'fin') return { kind: 'fin', nodo: inicio };
    if (inicio.tipo === 'espera') return { kind: 'espera', nodo: inicio };
    if (inicio.tipo === 'subflujo') {
      const fid = String(inicio.flujo_id || '').trim();
      if (!fid) return { kind: 'error', error: 'Subflujo sin flujo_id.' };
      return { kind: 'subflujo', nodo: inicio, flujoId: fid };
    }
  }
  return avanzarDesde(nodos, aristas, inicio.id, datos);
}
