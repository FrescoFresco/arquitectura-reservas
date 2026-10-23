/**
 * Corridas: instancias de ejecución de un flujo en Mongo (colección `corridas` por BD).
 */

export type CorridaEstado = 'en_curso' | 'esperando' | 'terminada' | 'error';
export type PasoEstado = 'pendiente' | 'hecho' | 'error';

export type CorridaPaso = {
  nodo_id: string;
  skill: string | null;
  estado: PasoEstado;
  inicio: string | null;
  fin: string | null;
  salidas: Record<string, unknown> | null;
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
  /** Corrida padre (si esta es hija de un subflujo) */
  padre_id?: string | null;
  /** Hijo en curso (si el padre espera un subflujo) */
  hijo_id?: string | null;
  /** Nodo subflujo del padre que disparó al hijo */
  subflujo_nodo_id?: string | null;
  /** Disparador que arrancó la corrida (Fase 2) */
  disparador_id?: string | null;
  /** Evento Mongo que la originó (Fase 2) */
  evento_id?: string | null;
};

export function newCorridaId(): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
      : Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
  return `c-${rand}`;
}

export function publicCorrida(doc: CorridaDoc) {
  return {
    id: doc._id,
    flujo_id: doc.flujo_id,
    flujo_version: doc.flujo_version,
    proyecto_id: doc.proyecto_id,
    negocio: doc.negocio,
    estado: doc.estado,
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
