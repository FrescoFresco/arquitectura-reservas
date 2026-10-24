/**
 * Corridas: instancias de ejecución de un flujo en Mongo (colección `corridas` por BD).
 */

/** Estados Fase 2–3 (+ aliases legados). */
export type CorridaEstado =
  | 'pendiente'
  | 'en_curso'
  | 'esperando_integracion'
  | 'esperando_humano'
  | 'esperando_hijo'
  | 'atascada'
  | 'completada'
  | 'fallida'
  | 'cancelada'
  /** @deprecated usar esperando_* */
  | 'esperando'
  /** @deprecated usar completada */
  | 'terminada'
  /** @deprecated usar fallida */
  | 'error';

export type PasoEstado = 'pendiente' | 'hecho' | 'error';

export type CorridaPaso = {
  nodo_id: string;
  skill: string | null;
  estado: PasoEstado;
  inicio: string | null;
  fin: string | null;
  salidas: Record<string, unknown> | null;
  /** Fase 2 */
  ejecutor_id?: string | null;
  ejecutor_version?: number | null;
  prompt_version?: number | null;
  duracion_ms?: number | null;
  intento?: number | null;
  entradas?: Record<string, unknown> | null;
  error?: string | null;
  coste?: unknown;
  /** Fase 3: acción de panel (reintentar, aprobar, …) */
  accion?: string | null;
  quien?: string | null;
};

export type CorridaDoc = {
  _id: string;
  flujo_id: string;
  flujo_version: number;
  proyecto_id: string;
  negocio: string;
  estado: CorridaEstado;
  paso_actual: string;
  pasos: CorridaPaso[];
  datos: Record<string, unknown>;
  errores: Array<{ at: string; nodo_id?: string; error: string }>;
  creada: string;
  actualizada: string;
  padre_id?: string | null;
  hijo_id?: string | null;
  subflujo_nodo_id?: string | null;
  disparador_id?: string | null;
  evento_id?: string | null;
};

export function newCorridaId(): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
      : Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
  return `c-${rand}`;
}

/** Normaliza estado legado → canónico F2 para respuestas. */
export function normalizeCorridaEstado(estado: string): string {
  if (estado === 'terminada') return 'completada';
  if (estado === 'error') return 'fallida';
  if (estado === 'esperando') return 'esperando_humano';
  return estado;
}

export function publicCorrida(doc: CorridaDoc) {
  return {
    id: doc._id,
    flujo_id: doc.flujo_id,
    flujo_version: doc.flujo_version,
    /** Canónico camelCase (alias de entrada: proyecto_id | proyectoId | proyecto). */
    proyectoId: doc.proyecto_id,
    negocio: doc.negocio,
    estado: normalizeCorridaEstado(doc.estado),
    paso_actual: doc.paso_actual,
    pasos: doc.pasos,
    datos: doc.datos,
    errores: doc.errores,
    creada: doc.creada,
    actualizada: doc.actualizada,
    padre_id: doc.padre_id || null,
    hijo_id: doc.hijo_id || null,
    subflujo_nodo_id: doc.subflujo_nodo_id || null,
    disparador_id: doc.disparador_id || null,
    evento_id: doc.evento_id || null,
  };
}

export function markPasoHecho(
  pasos: CorridaPaso[],
  nodoId: string,
  salidas: Record<string, unknown>,
  ts: string
): CorridaPaso[] {
  return pasos.map((p) => {
    if (p.nodo_id !== nodoId) return p;
    return {
      ...p,
      estado: 'hecho' as const,
      fin: ts,
      salidas: { ...salidas },
    };
  });
}

export function ensurePasoPendiente(
  pasos: CorridaPaso[],
  nodoId: string,
  skill: string | null,
  ts: string
): CorridaPaso[] {
  const existing = pasos.find((p) => p.nodo_id === nodoId && p.estado === 'pendiente');
  if (existing) return pasos;
  return [
    ...pasos,
    {
      nodo_id: nodoId,
      skill,
      estado: 'pendiente',
      inicio: ts,
      fin: null,
      salidas: null,
    },
  ];
}

/** Fase 3: en_curso sin lease y sin actividad → atascada (default 10 min). */
export const DEFAULT_ATASCADA_MS = 10 * 60 * 1000;

/** @deprecated usar DEFAULT_ATASCADA_MS; se mantiene por override legacy CORRIDA_STALE_MS. */
export const DEFAULT_CORRIDA_STALE_MS = DEFAULT_ATASCADA_MS;

export const CORRIDA_STALE_REASON = 'atascada';
export const CORRIDA_TIMEOUT_REASON = 'timeout';

/**
 * Marca corrida como atascada (recuperable con Reanudar).
 */
export function applyCorridaAtascada(
  doc: CorridaDoc,
  ts: string,
  reason: string = CORRIDA_STALE_REASON
): CorridaDoc {
  return {
    ...doc,
    estado: 'atascada',
    errores: [...(doc.errores || []), { at: ts, nodo_id: doc.paso_actual, error: reason }],
    actualizada: ts,
  };
}

/** @deprecated alias → applyCorridaAtascada */
export function applyCorridaStaleTimeout(
  doc: CorridaDoc,
  ts: string,
  reason: string = CORRIDA_STALE_REASON
): CorridaDoc {
  return applyCorridaAtascada(doc, ts, reason);
}

export function isCorridaStaleByUpdatedAt(
  actualizada: string,
  nowMs: number,
  staleMs: number
): boolean {
  const t = Date.parse(actualizada);
  if (!Number.isFinite(t)) return false;
  return nowMs - t >= staleMs;
}

/** ¿La corrida está esperando agente externo / integración? */
export function isEsperandoIntegracion(estado: string): boolean {
  return estado === 'esperando_integracion';
}

export function isEsperandoHumano(estado: string): boolean {
  return estado === 'esperando_humano' || estado === 'esperando';
}

export function isTerminal(estado: string): boolean {
  return (
    estado === 'completada' ||
    estado === 'terminada' ||
    estado === 'fallida' ||
    estado === 'error' ||
    estado === 'cancelada'
  );
}

export function isAtascada(estado: string): boolean {
  return estado === 'atascada';
}
