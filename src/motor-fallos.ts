/**
 * Fase 3 — Control de fallos: timeouts async, atascadas, acciones de panel.
 */

import { findNodo, pickNextPorCuando, type FlujoVersionDoc } from './flujos';
import {
  applyCorridaAtascada,
  DEFAULT_ATASCADA_MS,
  isTerminal,
  type CorridaDoc,
  type CorridaPaso,
} from './corridas';
import {
  enqueuePaso,
  hasActiveLease,
  loadEjecutorForSkill,
  releaseLease,
  retryDelaySeconds,
  setLeaseDeadline,
  shouldRetryPaso,
  type MotorDeps,
} from './motor-pasos';

export type FallosActionResult = {
  ok: true;
  corrida: CorridaDoc;
  accion: string;
};

function appendAccionPaso(
  pasos: CorridaPaso[],
  patch: Partial<CorridaPaso> & { nodo_id: string }
): CorridaPaso[] {
  const ts = patch.fin || patch.inicio || new Date().toISOString();
  return [
    ...pasos,
    {
      nodo_id: patch.nodo_id,
      skill: patch.skill ?? null,
      estado: patch.estado || 'hecho',
      inicio: patch.inicio || ts,
      fin: patch.fin || ts,
      salidas: patch.salidas ?? null,
      accion: patch.accion ?? null,
      quien: patch.quien ?? null,
      error: patch.error ?? null,
      intento: patch.intento ?? null,
    },
  ];
}

async function loadEjecutorTimeoutForNodo(
  deps: MotorDeps,
  flujo: FlujoVersionDoc,
  nodoId: string
): Promise<{ timeout_s: number; reintentos: number; espera_reintento_s: number }> {
  const nodo = findNodo(flujo.nodos, nodoId);
  if (nodo?.tipo === 'skill' && nodo.skill) {
    const srow = await deps.env.DB.prepare('SELECT ejecutor_id FROM skills WHERE id = ?')
      .bind(nodo.skill)
      .first<{ ejecutor_id: string | null }>();
    const ej = await loadEjecutorForSkill(deps.env.DB, srow || {});
    return {
      timeout_s: ej.timeout_s || 60,
      reintentos: ej.reintentos || 0,
      espera_reintento_s: ej.espera_reintento_s || 10,
    };
  }
  return { timeout_s: 60, reintentos: 0, espera_reintento_s: 10 };
}

/** Cron cada minuto: esperando_integracion timeout; esperando_tiempo → despertar. */
export async function runEsperandoTimeoutTick(
  deps: MotorDeps,
  at: Date = new Date()
): Promise<{
  scanned: number;
  timed_out: string[];
  retried: string[];
  fallidas: string[];
  despertadas: string[];
}> {
  const now = at.toISOString();
  const rows = await deps.env.DB.prepare(
    `SELECT id, proyecto_id, lease_nodo_id, lease_hasta, estado FROM corridas_index
     WHERE estado IN ('esperando_integracion', 'esperando_tiempo')
       AND lease_hasta IS NOT NULL AND lease_hasta != '' AND lease_hasta <= ?
     ORDER BY lease_hasta ASC LIMIT 40`
  )
    .bind(now)
    .all<{
      id: string;
      proyecto_id: string;
      lease_nodo_id: string | null;
      lease_hasta: string;
      estado: string;
    }>();

  const list = rows.results || [];
  const timed_out: string[] = [];
  const retried: string[] = [];
  const fallidas: string[] = [];
  const despertadas: string[] = [];

  for (const row of list) {
    const loaded = await deps.loadCorridaWithFlujo(row.id);
    if (!loaded.ok) continue;
    let { doc, flujo } = loaded;
    const nodoId = row.lease_nodo_id || doc.paso_actual;
    const ts = deps.nowIso();

    // Reloj de espera: encolar despertar (processPasoMessage completa el paso)
    if (doc.estado === 'esperando_tiempo' || row.estado === 'esperando_tiempo') {
      if (doc.estado !== 'esperando_tiempo') continue;
      await enqueuePaso(deps.env, {
        corrida_id: doc._id,
        nodo_id: nodoId,
        intento: 0,
        despertar: true,
      });
      despertadas.push(doc._id);
      continue;
    }

    if (doc.estado !== 'esperando_integracion') continue;
    const ej = await loadEjecutorTimeoutForNodo(deps, flujo, nodoId);
    const intento =
      [...(doc.pasos || [])].reverse().find((p) => p.nodo_id === nodoId)?.intento ?? 0;
    const errMsg = 'timeout';
    doc.pasos = appendAccionPaso(doc.pasos || [], {
      nodo_id: nodoId,
      skill: findNodo(flujo.nodos, nodoId)?.skill || null,
      estado: 'error',
      inicio: ts,
      fin: ts,
      error: errMsg,
      intento,
      accion: 'timeout',
    });
    doc.errores = [...(doc.errores || []), { at: ts, nodo_id: nodoId, error: errMsg }];
    timed_out.push(doc._id);

    if (shouldRetryPaso(errMsg, Number(intento) || 0, ej.reintentos)) {
      const delay = retryDelaySeconds(ej.espera_reintento_s, Number(intento) || 0);
      doc.estado = 'en_curso';
      await deps.saveCorridaDoc(doc);
      await releaseLease(deps.env.DB, doc._id);
      await enqueuePaso(
        deps.env,
        { corrida_id: doc._id, nodo_id: nodoId, intento: (Number(intento) || 0) + 1 },
        { delaySeconds: delay }
      );
      retried.push(doc._id);
    } else {
      doc.estado = 'fallida';
      await deps.saveCorridaDoc(doc);
      await releaseLease(deps.env.DB, doc._id);
      fallidas.push(doc._id);
    }
  }

  return { scanned: list.length, timed_out, retried, fallidas, despertadas };
}

/** Cron cada 5 min: en_curso sin lease activo y sin actividad → atascada. */
export async function runAtascadasTick(
  deps: MotorDeps,
  at: Date = new Date(),
  atascadaMsOverride?: number
): Promise<{ scanned: number; marked: string[]; atascada_ms: number }> {
  const atascadaMs =
    atascadaMsOverride != null && Number.isFinite(atascadaMsOverride) && atascadaMsOverride >= 30_000
      ? atascadaMsOverride
      : DEFAULT_ATASCADA_MS;
  const now = at.toISOString();
  const cutoff = new Date(at.getTime() - atascadaMs).toISOString();
  const rows = await deps.env.DB.prepare(
    `SELECT id, updated_at, lease_hasta FROM corridas_index
     WHERE estado = 'en_curso' AND updated_at < ?
     ORDER BY updated_at ASC LIMIT 50`
  )
    .bind(cutoff)
    .all<{ id: string; updated_at: string; lease_hasta: string | null }>();

  const list = rows.results || [];
  const marked: string[] = [];

  for (const row of list) {
    const lease = row.lease_hasta ? String(row.lease_hasta) : '';
    if (lease && lease >= now) continue; // lease activo
    const loaded = await deps.loadCorridaWithFlujo(row.id);
    if (!loaded.ok) continue;
    const doc = loaded.doc;
    if (doc.estado !== 'en_curso') continue;
    if (await hasActiveLease(deps.env.DB, doc._id, now)) continue;
    const next = applyCorridaAtascada(doc, deps.nowIso());
    await deps.saveCorridaDoc(next);
    await releaseLease(deps.env.DB, doc._id);
    marked.push(doc._id);
  }

  return { scanned: list.length, marked, atascada_ms: atascadaMs };
}

export async function accionReintentar(
  deps: MotorDeps,
  doc: CorridaDoc,
  flujo: FlujoVersionDoc,
  quien: string
): Promise<FallosActionResult> {
  if (doc.estado !== 'fallida' && doc.estado !== 'error') {
    throw new Error('Solo se puede reintentar una corrida fallida.');
  }
  const nodoId = doc.paso_actual;
  if (!nodoId) throw new Error('Sin paso_actual para reintentar.');
  const ts = deps.nowIso();
  doc.pasos = appendAccionPaso(doc.pasos || [], {
    nodo_id: nodoId,
    skill: findNodo(flujo.nodos, nodoId)?.skill || null,
    estado: 'hecho',
    accion: 'reintentar',
    quien,
    inicio: ts,
    fin: ts,
  });
  doc.estado = 'en_curso';
  await deps.saveCorridaDoc(doc);
  await releaseLease(deps.env.DB, doc._id);
  await enqueuePaso(deps.env, { corrida_id: doc._id, nodo_id: nodoId, intento: 0 });
  const again = await deps.loadCorridaWithFlujo(doc._id);
  return { ok: true, corrida: again.ok ? again.doc : doc, accion: 'reintentar' };
}

export async function accionAprobar(
  deps: MotorDeps,
  doc: CorridaDoc,
  flujo: FlujoVersionDoc,
  quien: string
): Promise<FallosActionResult> {
  if (
    doc.estado !== 'esperando_humano' &&
    doc.estado !== 'esperando' &&
    doc.estado !== 'esperando_tiempo'
  ) {
    throw new Error('La corrida no está esperando_humano ni esperando_tiempo.');
  }
  const nodoId = doc.paso_actual;
  const next = pickNextPorCuando(flujo.nodos, flujo.aristas, nodoId, true);
  if (!next) throw new Error('No hay arista «si» (ni única) para aprobar.');
  const ts = deps.nowIso();
  const adelantar = doc.estado === 'esperando_tiempo';
  doc.pasos = appendAccionPaso(doc.pasos || [], {
    nodo_id: nodoId,
    skill: findNodo(flujo.nodos, nodoId)?.skill || null,
    estado: 'hecho',
    accion: adelantar ? 'adelantar' : 'aprobar',
    quien,
    inicio: ts,
    fin: ts,
    salidas: adelantar ? { _despertado_: true, _adelantado_: true } : { _aprobado_: true },
  });
  doc.datos = {
    ...(doc.datos || {}),
    ...(adelantar ? { _despertado_: true } : { _aprobado_: true }),
  };
  doc.estado = 'en_curso';
  doc.paso_actual = next.id;
  await deps.saveCorridaDoc(doc);
  await releaseLease(deps.env.DB, doc._id);
  await enqueuePaso(deps.env, { corrida_id: doc._id, nodo_id: next.id, intento: 0 });
  const again = await deps.loadCorridaWithFlujo(doc._id);
  return { ok: true, corrida: again.ok ? again.doc : doc, accion: adelantar ? 'adelantar' : 'aprobar' };
}

export async function accionRechazar(
  deps: MotorDeps,
  doc: CorridaDoc,
  flujo: FlujoVersionDoc,
  quien: string
): Promise<FallosActionResult> {
  if (doc.estado !== 'esperando_humano' && doc.estado !== 'esperando') {
    throw new Error('La corrida no está esperando_humano.');
  }
  const nodoId = doc.paso_actual;
  const next = pickNextPorCuando(flujo.nodos, flujo.aristas, nodoId, false);
  const ts = deps.nowIso();
  if (!next) {
    doc.pasos = appendAccionPaso(doc.pasos || [], {
      nodo_id: nodoId,
      skill: findNodo(flujo.nodos, nodoId)?.skill || null,
      estado: 'hecho',
      accion: 'rechazar',
      quien,
      inicio: ts,
      fin: ts,
      salidas: { _aprobado_: false },
    });
    doc.estado = 'cancelada';
    doc.errores = [...(doc.errores || []), { at: ts, nodo_id: nodoId, error: 'rechazado' }];
    await deps.saveCorridaDoc(doc);
    await releaseLease(deps.env.DB, doc._id);
    const again = await deps.loadCorridaWithFlujo(doc._id);
    return { ok: true, corrida: again.ok ? again.doc : doc, accion: 'rechazar' };
  }
  doc.pasos = appendAccionPaso(doc.pasos || [], {
    nodo_id: nodoId,
    skill: findNodo(flujo.nodos, nodoId)?.skill || null,
    estado: 'hecho',
    accion: 'rechazar',
    quien,
    inicio: ts,
    fin: ts,
    salidas: { _aprobado_: false },
  });
  doc.datos = { ...(doc.datos || {}), _aprobado_: false };
  doc.estado = 'en_curso';
  doc.paso_actual = next.id;
  await deps.saveCorridaDoc(doc);
  await releaseLease(deps.env.DB, doc._id);
  await enqueuePaso(deps.env, { corrida_id: doc._id, nodo_id: next.id, intento: 0 });
  const again = await deps.loadCorridaWithFlujo(doc._id);
  return { ok: true, corrida: again.ok ? again.doc : doc, accion: 'rechazar' };
}

export async function accionCancelar(
  deps: MotorDeps,
  doc: CorridaDoc,
  quien: string
): Promise<FallosActionResult> {
  if (isTerminal(doc.estado)) throw new Error('La corrida ya está en estado final.');
  const ts = deps.nowIso();
  const nodoId = doc.paso_actual || '—';
  doc.pasos = appendAccionPaso(doc.pasos || [], {
    nodo_id: nodoId,
    estado: 'hecho',
    accion: 'cancelar',
    quien,
    inicio: ts,
    fin: ts,
  });
  doc.estado = 'cancelada';
  doc.errores = [...(doc.errores || []), { at: ts, nodo_id: nodoId, error: 'cancelada' }];
  await deps.saveCorridaDoc(doc);
  await releaseLease(deps.env.DB, doc._id);
  const again = await deps.loadCorridaWithFlujo(doc._id);
  return { ok: true, corrida: again.ok ? again.doc : doc, accion: 'cancelar' };
}

export async function accionReanudar(
  deps: MotorDeps,
  doc: CorridaDoc,
  quien: string
): Promise<FallosActionResult> {
  const now = deps.nowIso();
  const active = await hasActiveLease(deps.env.DB, doc._id, now);
  const okEstado =
    doc.estado === 'atascada' || (doc.estado === 'en_curso' && !active);
  if (!okEstado) {
    throw new Error('Solo se puede reanudar si está atascada o en_curso sin lease activo.');
  }
  const nodoId = doc.paso_actual;
  if (!nodoId) throw new Error('Sin paso_actual para reanudar.');
  const ts = deps.nowIso();
  doc.pasos = appendAccionPaso(doc.pasos || [], {
    nodo_id: nodoId,
    estado: 'hecho',
    accion: 'reanudar',
    quien,
    inicio: ts,
    fin: ts,
  });
  doc.estado = 'en_curso';
  await deps.saveCorridaDoc(doc);
  await releaseLease(deps.env.DB, doc._id);
  await enqueuePaso(deps.env, { corrida_id: doc._id, nodo_id: nodoId, intento: 0 });
  const again = await deps.loadCorridaWithFlujo(doc._id);
  return { ok: true, corrida: again.ok ? again.doc : doc, accion: 'reanudar' };
}
