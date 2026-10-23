/**
 * Flujos de ejecución: nodos (Inicio, Skill, Decisión, Espera, Subflujo, Fin) + aristas.
 * Condiciones de decisión: lenguaje mínimo y seguro sobre `datos` de la corrida.
 */

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
  | { truthy: string };

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
    if (o.condicion != null && typeof o.condicion === 'object') {
      nodo.condicion = o.condicion as Condicion;
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

/** Valor de ancla en `datos` (clave exacta `_…_`). */
export function getDato(datos: Record<string, unknown>, path: string): unknown {
  const key = String(path || '').trim();
  if (!key) return undefined;
  if (Object.prototype.hasOwnProperty.call(datos, key)) return datos[key];
  // También aceptar path sin guiones bajos extremos
  const bare = key.replace(/^_|_$/g, '');
  const withUnderscores = `_${bare}_`;
  if (Object.prototype.hasOwnProperty.call(datos, withUnderscores)) return datos[withUnderscores];
  return undefined;
}

/**
 * Evalúa condición sobre `datos`. Desconocida / mal formada → false.
 * No ejecuta código arbitrario.
 */
export function evalCondicion(condicion: Condicion | undefined, datos: Record<string, unknown>): boolean {
  if (!condicion || typeof condicion !== 'object') return false;
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
