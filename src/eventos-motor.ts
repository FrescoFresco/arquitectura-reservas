/**
 * Fase 2 — eventos Mongo + motor de disparo (cambio_datos / webhook / horario).
 * No escribe D1 de diseño salvo `ultima_vez` del disparador.
 */

import type { Db } from 'mongodb';
import {
  cronMatchesAt,
  rowToDisparador,
  type DisparadorDoc,
  type OperacionCambio,
} from './disparadores';
import type { CorridaDoc } from './corridas';
import { getByPath, normalizeAnclaToken } from './skill-io';

export const EVENTOS_COLLECTION = 'eventos';
export const SYSTEM_COLLECTIONS = new Set(['corridas', 'eventos']);

export const PIPELINE_TIMEOUT_MS = 5000;
export const MAX_CORRIDAS_POR_EVENTO = 100;

export type EventoTipo = 'cambio_datos' | 'webhook' | 'horario';

export type EventoResultado = {
  disparador_id: string;
  lanzo: boolean;
  corrida_id: string | null;
  motivo: string | null;
  corridas?: string[];
};

export type EventoDoc = {
  _id: string;
  tipo: EventoTipo;
  coleccion: string | null;
  documento_id: string | null;
  operacion: OperacionCambio | null;
  antes: Record<string, unknown> | null;
  despues: Record<string, unknown> | null;
  body: unknown;
  headers: Record<string, string> | null;
  origen: string;
  negocio: string;
  proyecto_id: string;
  flujo_id: string | null;
  disparador_id: string | null;
  /** Date for TTL index */
  creado: Date;
  resultado: EventoResultado[];
};

export type StartCorridaArgs = {
  flujoId: string;
  negocio: string;
  datos: Record<string, unknown>;
  disparadorId: string;
  eventoId: string;
  proyectoId?: string;
};

export type MotorDeps = {
  dbD1: D1Database;
  /** Arranca una corrida (aplica avance inicial) y la persiste. */
  startCorrida: (args: StartCorridaArgs) => Promise<CorridaDoc>;
  nowIso: () => string;
};

let indexesEnsured = false;

export function newEventoId(): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  return `ev-${rand}`;
}

export async function ensureEventosIndexes(db: Db): Promise<void> {
  if (indexesEnsured) return;
  const col = db.collection(EVENTOS_COLLECTION);
  await col.createIndex({ creado: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60, name: 'ttl_creado_30d' });
  await col.createIndex({ coleccion: 1 }, { name: 'idx_coleccion' });
  await col.createIndex({ creado: -1 }, { name: 'idx_creado' });
  indexesEnsured = true;
}

export function publicEvento(doc: EventoDoc): Record<string, unknown> {
  return {
    id: doc._id,
    tipo: doc.tipo,
    coleccion: doc.coleccion,
    documento_id: doc.documento_id,
    operacion: doc.operacion,
    antes: doc.antes,
    despues: doc.despues,
    body: doc.body,
    headers: doc.headers,
    origen: doc.origen,
    negocio: doc.negocio,
    proyecto_id: doc.proyecto_id,
    flujo_id: doc.flujo_id,
    disparador_id: doc.disparador_id,
    creado: doc.creado instanceof Date ? doc.creado.toISOString() : String(doc.creado),
    resultado: doc.resultado || [],
  };
}

async function loadDisparadoresTipo(
  d1: D1Database,
  tipo: string,
  opts?: { coleccion?: string; activoOnly?: boolean }
): Promise<DisparadorDoc[]> {
  let sql = 'SELECT * FROM disparadores WHERE tipo = ?';
  const binds: (string | number)[] = [tipo];
  if (opts?.activoOnly !== false) {
    sql += ' AND activo = 1';
  }
  if (opts?.coleccion) {
    sql += ' AND coleccion = ?';
    binds.push(opts.coleccion);
  }
  const rows = await d1.prepare(sql).bind(...binds).all();
  return ((rows.results || []) as Record<string, unknown>[]).map(rowToDisparador);
}

function operacionCubre(d: DisparadorDoc, op: OperacionCambio): boolean {
  if (!d.operaciones || !d.operaciones.length) return false;
  return d.operaciones.includes(op);
}

function negocioOk(d: DisparadorDoc, negocio: string): boolean {
  const want = String(d.negocio || '').trim();
  if (!want) return true;
  return want === String(negocio || '').trim();
}

/** Anti-bucle: origen corrida:<id> del mismo flujo. */
async function bloqueadoAntiBucle(
  d1: D1Database,
  d: DisparadorDoc,
  origen: string
): Promise<boolean> {
  if (!d.anti_bucle) return false;
  const m = /^corrida:(.+)$/.exec(String(origen || '').trim());
  if (!m) return false;
  const corridaId = m[1]!;
  const idx = await d1
    .prepare('SELECT flujo_id FROM corridas_index WHERE id = ?')
    .bind(corridaId)
    .first<{ flujo_id: string }>();
  if (!idx) return false;
  return idx.flujo_id === d.flujo_id;
}

async function bloqueadoAgrupar(
  db: Db,
  d: DisparadorDoc,
  negocio: string
): Promise<boolean> {
  const secs = Number(d.agrupar_segundos) || 0;
  if (secs <= 0) return false;
  const since = new Date(Date.now() - secs * 1000).toISOString();
  const found = await db.collection('corridas').findOne({
    disparador_id: d.id,
    negocio: String(negocio || ''),
    creada: { $gte: since },
  });
  return !!found;
}

export async function runPipeline(
  db: Db,
  collection: string,
  pipeline: Record<string, unknown>[]
): Promise<{ ok: true; docs: Record<string, unknown>[] } | { ok: false; error: string }> {
  const capped = [...pipeline, { $limit: MAX_CORRIDAS_POR_EVENTO + 1 }];
  try {
    const docs = (await Promise.race([
      db.collection(collection).aggregate(capped).toArray(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('pipeline_timeout')), PIPELINE_TIMEOUT_MS);
      }),
    ])) as Record<string, unknown>[];
    if (docs.length > MAX_CORRIDAS_POR_EVENTO) {
      return { ok: false, error: 'limite_corridas' };
    }
    return { ok: true, docs };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'pipeline_timeout') return { ok: false, error: 'pipeline_timeout' };
    return { ok: false, error: msg.slice(0, 200) };
  }
}

function flattenDatos(doc: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc)) {
    if (k === '_id') {
      out['_id'] = v;
      continue;
    }
    // Preserve ancla-looking keys as-is; also expose flat top-level
    out[k] = v;
  }
  return out;
}

type AnclaCatalogRow = {
  ancla: string;
  id: string;
  clave_mongo: string;
  coleccion: string;
  aliases: string[];
};

async function loadAnclasCatalog(d1: D1Database): Promise<AnclaCatalogRow[]> {
  const rows = await d1
    .prepare('SELECT ancla, id, clave_mongo, coleccion, aliases FROM anclas')
    .all();
  const out: AnclaCatalogRow[] = [];
  for (const raw of rows.results || []) {
    const r = raw as Record<string, unknown>;
    let aliases: string[] = [];
    try {
      const parsed = typeof r.aliases === 'string' ? JSON.parse(r.aliases) : r.aliases;
      if (Array.isArray(parsed)) aliases = parsed.map((a) => String(a));
    } catch {
      aliases = [];
    }
    out.push({
      ancla: String(r.ancla || ''),
      id: String(r.id || ''),
      clave_mongo: String(r.clave_mongo || ''),
      coleccion: String(r.coleccion || ''),
      aliases,
    });
  }
  return out;
}

function collectBodyKeys(body: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!body || typeof body !== 'object' || Array.isArray(body)) return out;
  const o = body as Record<string, unknown>;
  Object.assign(out, o);
  if (o.valores && typeof o.valores === 'object' && !Array.isArray(o.valores)) {
    Object.assign(out, o.valores as Record<string, unknown>);
  }
  if (o.datos && typeof o.datos === 'object' && !Array.isArray(o.datos)) {
    Object.assign(out, o.datos as Record<string, unknown>);
  }
  return out;
}

function matchAnclaKey(catalog: AnclaCatalogRow[], key: string): AnclaCatalogRow | null {
  const k = String(key || '').trim();
  if (!k) return null;
  const norm = normalizeAnclaToken(k);
  for (const a of catalog) {
    if (a.ancla === k || a.ancla === norm) return a;
    if (a.id === k || a.id === norm) return a;
    if (a.clave_mongo && (a.clave_mongo === k || a.clave_mongo === key)) return a;
    for (const al of a.aliases || []) {
      if (al === k || normalizeAnclaToken(al) === norm) return a;
    }
  }
  return null;
}

/**
 * Traduce body/documento del evento a anclas en `datos` de la corrida.
 * Webhook: claves del body → anclas por id/ancla/clave_mongo/alias.
 * cambio_datos/horario: campos del doc vía clave_mongo de anclas de esa colección.
 */
export async function hidratarAnclasDesdeEvento(
  d1: D1Database,
  _proyectoId: string,
  coleccion: string | null,
  docPlano: Record<string, unknown> | null,
  evento: EventoDoc
): Promise<Record<string, unknown>> {
  const datos: Record<string, unknown> = {};
  const catalog = await loadAnclasCatalog(d1);
  const colEvento = String(coleccion || evento.coleccion || '').trim();

  if (evento.tipo === 'webhook') {
    const keys = {
      ...collectBodyKeys(evento.body),
      ...(docPlano || {}),
    };
    for (const [k, v] of Object.entries(keys)) {
      if (k === '_id' || k === 'negocio' || k === 'negocio_id') continue;
      const hit = matchAnclaKey(catalog, k);
      if (hit) {
        datos[hit.ancla] = v;
        continue;
      }
      // Claves tipo `_x.y_` o `x.y`
      if (k.includes('.') || (k.startsWith('_') && k.endsWith('_'))) {
        const norm = normalizeAnclaToken(k);
        if (norm) datos[norm] = v;
      }
    }
  } else {
    // cambio_datos | horario
    const fuenteDoc =
      (evento.tipo === 'cambio_datos' ? (evento.despues as Record<string, unknown> | null) : null) ||
      docPlano ||
      null;
    if (fuenteDoc && colEvento) {
      for (const a of catalog) {
        if (a.coleccion !== colEvento) continue;
        if (!a.clave_mongo) continue;
        const v = getByPath(fuenteDoc, a.clave_mongo);
        if (v !== undefined) datos[a.ancla] = v;
      }
      const docId = String(fuenteDoc._id || evento.documento_id || '').trim();
      if (docId) {
        datos._documentos_ = { [colEvento]: docId };
        datos._documento_id = docId;
      }
    }
  }

  // Identidad documento desde evento si aún no hay
  if (evento.documento_id && colEvento && !datos._documentos_) {
    datos._documentos_ = { [colEvento]: String(evento.documento_id) };
    datos._documento_id = String(evento.documento_id);
  }

  return datos;
}

async function datosParaCorrida(
  deps: MotorDeps,
  evento: EventoDoc,
  doc: Record<string, unknown> | null,
  coleccionHint?: string | null
): Promise<Record<string, unknown>> {
  const base = flattenDatos(doc || {});
  const hidratados = await hidratarAnclasDesdeEvento(
    deps.dbD1,
    evento.proyecto_id,
    coleccionHint || evento.coleccion,
    doc,
    evento
  );
  const out: Record<string, unknown> = { ...base, ...hidratados };
  // Preservar _documentos_ de hidratación
  if (hidratados._documentos_) out._documentos_ = hidratados._documentos_;
  if (hidratados._documento_id) out._documento_id = hidratados._documento_id;
  return out;
}

function resolveNegocio(
  d: DisparadorDoc,
  fallback: string,
  doc?: Record<string, unknown> | null
): string {
  const fromD = String(d.negocio || '').trim();
  if (fromD) return fromD;
  if (doc) {
    const n = String(doc.negocio_id || doc.negocio || '').trim();
    if (n) return n;
    const id = String(doc._id || '').trim();
    if (id && /^[a-z0-9][a-z0-9-]{0,60}$/i.test(id)) return id;
  }
  const fb = String(fallback || '').trim();
  return fb || 'sistema';
}

async function markUltimaVez(d1: D1Database, disparadorId: string, ts: string) {
  await d1
    .prepare('UPDATE disparadores SET ultima_vez = ?, actualizado = ? WHERE id = ?')
    .bind(ts, ts, disparadorId)
    .run();
}

/**
 * Evalúa disparadores sobre un evento ya insertado (cambio_datos o webhook).
 * Pipeline corre sobre `eventos` con {$match:{_id}} al inicio.
 */
export async function evaluarDisparadoresSobreEvento(
  db: Db,
  deps: MotorDeps,
  evento: EventoDoc,
  candidatos: DisparadorDoc[]
): Promise<EventoDoc> {
  const resultados: EventoResultado[] = [];
  const ts = deps.nowIso();

  for (const d of candidatos) {
    if (!d.activo) {
      resultados.push({ disparador_id: d.id, lanzo: false, corrida_id: null, motivo: 'pausado' });
      continue;
    }
    if (!negocioOk(d, evento.negocio)) {
      resultados.push({ disparador_id: d.id, lanzo: false, corrida_id: null, motivo: 'negocio' });
      continue;
    }
    if (await bloqueadoAntiBucle(deps.dbD1, d, evento.origen)) {
      resultados.push({ disparador_id: d.id, lanzo: false, corrida_id: null, motivo: 'anti_bucle' });
      continue;
    }
    if (await bloqueadoAgrupar(db, d, evento.negocio)) {
      resultados.push({ disparador_id: d.id, lanzo: false, corrida_id: null, motivo: 'agrupado' });
      continue;
    }

    const basePipe: Record<string, unknown>[] = [{ $match: { _id: evento._id } }];
    const userPipe = d.pipeline && d.pipeline.length ? d.pipeline : [];
    const pipe = [...basePipe, ...userPipe];
    const ran = await runPipeline(db, EVENTOS_COLLECTION, pipe);
    if (!ran.ok) {
      resultados.push({
        disparador_id: d.id,
        lanzo: false,
        corrida_id: null,
        motivo: ran.error,
      });
      continue;
    }
    if (!ran.docs.length) {
      resultados.push({
        disparador_id: d.id,
        lanzo: false,
        corrida_id: null,
        motivo: 'pipeline_vacio',
      });
      continue;
    }

    const corridaIds: string[] = [];
    let firstId: string | null = null;
    let failed: string | null = null;
    for (const doc of ran.docs) {
      try {
        const negocio = resolveNegocio(d, evento.negocio, doc);
        const datos = await datosParaCorrida(deps, evento, doc, evento.coleccion);
        // Identidad 1:N en cambio_datos
        if (evento.tipo === 'cambio_datos' && evento.documento_id && evento.coleccion) {
          const docsMap =
            datos._documentos_ && typeof datos._documentos_ === 'object'
              ? { ...(datos._documentos_ as Record<string, unknown>) }
              : {};
          docsMap[evento.coleccion] = String(evento.documento_id);
          datos._documentos_ = docsMap;
          datos._documento_id = String(evento.documento_id);
        }
        const started = await deps.startCorrida({
          flujoId: d.flujo_id,
          negocio,
          datos,
          disparadorId: d.id,
          eventoId: evento._id,
          proyectoId: evento.proyecto_id,
        });
        corridaIds.push(started._id);
        if (!firstId) firstId = started._id;
      } catch (err) {
        failed = err instanceof Error ? err.message : 'error_corrida';
        break;
      }
    }
    if (failed && !corridaIds.length) {
      resultados.push({
        disparador_id: d.id,
        lanzo: false,
        corrida_id: null,
        motivo: failed.slice(0, 120),
      });
      continue;
    }
    await markUltimaVez(deps.dbD1, d.id, ts);
    resultados.push({
      disparador_id: d.id,
      lanzo: true,
      corrida_id: firstId,
      corridas: corridaIds,
      motivo: failed ? `parcial:${failed.slice(0, 80)}` : null,
    });
  }

  evento.resultado = resultados;
  await db.collection(EVENTOS_COLLECTION).updateOne(
    { _id: evento._id },
    { $set: { resultado: resultados } }
  );
  return evento;
}

/** Tras una escritura de negocio: crea evento y evalúa disparadores cambio_datos. */
export async function emitCambioDatos(
  db: Db,
  deps: MotorDeps,
  args: {
    proyectoId: string;
    coleccion: string;
    documentoId: string;
    operacion: OperacionCambio;
    antes: Record<string, unknown> | null;
    despues: Record<string, unknown> | null;
    origen: string;
    negocio: string;
  }
): Promise<EventoDoc | null> {
  if (SYSTEM_COLLECTIONS.has(args.coleccion)) return null;
  await ensureEventosIndexes(db);

  const evento: EventoDoc = {
    _id: newEventoId(),
    tipo: 'cambio_datos',
    coleccion: args.coleccion,
    documento_id: args.documentoId,
    operacion: args.operacion,
    antes: args.antes,
    despues: args.despues,
    body: null,
    headers: null,
    origen: args.origen,
    negocio: args.negocio,
    proyecto_id: args.proyectoId,
    flujo_id: null,
    disparador_id: null,
    creado: new Date(),
    resultado: [],
  };
  await db.collection(EVENTOS_COLLECTION).insertOne({ ...evento });

  const all = await loadDisparadoresTipo(deps.dbD1, 'cambio_datos', {
    coleccion: args.coleccion,
    activoOnly: true,
  });
  // Filtrar por proyecto vía flujo
  const candidatos: DisparadorDoc[] = [];
  for (const d of all) {
    if (!operacionCubre(d, args.operacion)) continue;
    const flujo = await deps.dbD1
      .prepare('SELECT proyecto_id FROM flujos WHERE id = ?')
      .bind(d.flujo_id)
      .first<{ proyecto_id: string }>();
    if (!flujo || flujo.proyecto_id !== args.proyectoId) continue;
    candidatos.push(d);
  }

  return evaluarDisparadoresSobreEvento(db, deps, evento, candidatos);
}

/** Webhook: evento + evaluación de ese disparador (y solo él). */
export async function emitWebhook(
  db: Db,
  deps: MotorDeps,
  args: {
    disparador: DisparadorDoc;
    proyectoId: string;
    body: unknown;
    headers: Record<string, string>;
    negocio?: string;
  }
): Promise<EventoDoc> {
  await ensureEventosIndexes(db);
  const d = args.disparador;
  const negocio = String(args.negocio || d.negocio || '').trim() || 'sistema';
  const evento: EventoDoc = {
    _id: newEventoId(),
    tipo: 'webhook',
    coleccion: d.coleccion || null,
    documento_id: null,
    operacion: null,
    antes: null,
    despues: null,
    body: args.body,
    headers: args.headers,
    origen: `webhook:${d.id}`,
    negocio,
    proyecto_id: args.proyectoId,
    flujo_id: d.flujo_id,
    disparador_id: d.id,
    creado: new Date(),
    resultado: [],
  };
  await db.collection(EVENTOS_COLLECTION).insertOne({ ...evento });
  return evaluarDisparadoresSobreEvento(db, deps, evento, [d]);
}

export type WithProyectoDb = <T>(
  proyectoId: string,
  fn: (db: Db) => Promise<T>
) => Promise<T | null>;

export type ProbarDisparadorArgs = {
  tipo: 'manual' | 'horario' | 'cambio_datos' | 'webhook';
  coleccion?: string | null;
  pipeline?: Record<string, unknown>[] | null;
  disparador_id?: string | null;
};

/**
 * Dry-run: no crea corridas ni eventos.
 * - cambio_datos/webhook: últimos 50 eventos (colección o disparador) × pipeline con $match _id
 * - horario: pipeline sobre la colección (sin pipeline → 1 hipotética)
 * - manual: 0 (usa POST /v1/corridas)
 */
export async function probarDisparadorDryRun(
  db: Db,
  args: ProbarDisparadorArgs
): Promise<{
  habria_lanzado: number;
  muestra: Record<string, unknown>[];
  eventos_probados?: number;
  nota?: string;
  error?: string;
}> {
  const tipo = args.tipo;
  const userPipe = args.pipeline && args.pipeline.length ? args.pipeline : [];
  const muestra: Record<string, unknown>[] = [];

  if (tipo === 'manual') {
    return {
      habria_lanzado: 0,
      muestra: [],
      nota: 'Tipo manual: usa «Lanzar» / POST /v1/corridas (no hay pipeline que probar).',
    };
  }

  if (tipo === 'horario') {
    const col = String(args.coleccion || '').trim();
    if (!col) return { habria_lanzado: 0, muestra: [], error: 'Falta coleccion para horario.' };
    if (!userPipe.length) {
      return {
        habria_lanzado: 1,
        muestra: [{ _nota: 'Sin pipeline → habría creado 1 corrida' }],
        nota: 'Sin pipeline: una corrida.',
      };
    }
    const ran = await runPipeline(db, col, userPipe);
    if (!ran.ok) return { habria_lanzado: 0, muestra: [], error: ran.error };
    for (const d of ran.docs.slice(0, 20)) {
      muestra.push(publicSampleDoc(d));
    }
    return { habria_lanzado: ran.docs.length, muestra };
  }

  // cambio_datos | webhook → eventos
  await ensureEventosIndexes(db);
  const q: Record<string, unknown> = {};
  if (tipo === 'cambio_datos' && args.coleccion) q.coleccion = String(args.coleccion);
  if (tipo === 'webhook' && args.disparador_id) q.disparador_id = String(args.disparador_id);
  if (tipo === 'cambio_datos') q.tipo = 'cambio_datos';
  if (tipo === 'webhook') q.tipo = 'webhook';

  const eventos = (await db
    .collection(EVENTOS_COLLECTION)
    .find(q)
    .sort({ creado: -1 })
    .limit(50)
    .toArray()) as Array<{ _id: string }>;

  if (!eventos.length) {
    return {
      habria_lanzado: 0,
      muestra: [],
      eventos_probados: 0,
      nota: 'No hay eventos recientes que coincidan para probar.',
    };
  }

  let total = 0;
  for (const ev of eventos) {
    const pipe = [{ $match: { _id: ev._id } }, ...userPipe];
    const ran = await runPipeline(db, EVENTOS_COLLECTION, pipe);
    if (!ran.ok) {
      return {
        habria_lanzado: 0,
        muestra: [],
        eventos_probados: eventos.length,
        error: ran.error,
      };
    }
    total += ran.docs.length;
    for (const d of ran.docs) {
      if (muestra.length < 20) muestra.push(publicSampleDoc(d));
    }
  }
  return { habria_lanzado: total, muestra, eventos_probados: eventos.length };
}

function publicSampleDoc(doc: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  try {
    const raw = JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
    const keys = Object.keys(raw).slice(0, 12);
    for (const k of keys) out[k] = raw[k];
    if (Object.keys(raw).length > 12) out._truncado = true;
  } catch {
    out._id = doc._id != null ? String(doc._id) : null;
  }
  return out;
}

/**
 * Cron minuto: dispara horario activos cuyo cron coincide (Atlantic/Canary).
 * Pipeline sobre la colección del disparador; sin pipeline → 1 corrida.
 */
export async function runHorarioTick(
  withProyectoDb: WithProyectoDb,
  deps: MotorDeps,
  at: Date = new Date()
): Promise<{ processed: number; eventos: string[] }> {
  const rows = await deps.dbD1
    .prepare(`SELECT * FROM disparadores WHERE tipo = 'horario' AND activo = 1`)
    .all();
  const list = ((rows.results || []) as Record<string, unknown>[]).map(rowToDisparador);
  const matching = list.filter((d) => d.cron && cronMatchesAt(d.cron, at));
  const eventoIds: string[] = [];
  let processed = 0;

  for (const d of matching) {
    const flujo = await deps.dbD1
      .prepare('SELECT proyecto_id FROM flujos WHERE id = ?')
      .bind(d.flujo_id)
      .first<{ proyecto_id: string }>();
    if (!flujo) continue;

    const eventoId = await withProyectoDb(flujo.proyecto_id, async (db) => {
      await ensureEventosIndexes(db);
      const ts = deps.nowIso();
      const evento: EventoDoc = {
        _id: newEventoId(),
        tipo: 'horario',
        coleccion: d.coleccion,
        documento_id: null,
        operacion: null,
        antes: null,
        despues: null,
        body: null,
        headers: null,
        origen: 'horario',
        negocio: String(d.negocio || '').trim() || 'sistema',
        proyecto_id: flujo.proyecto_id,
        flujo_id: d.flujo_id,
        disparador_id: d.id,
        creado: new Date(),
        resultado: [],
      };
      await db.collection(EVENTOS_COLLECTION).insertOne({ ...evento });

      const resultados: EventoResultado[] = [];

      if (await bloqueadoAgrupar(db, d, evento.negocio)) {
        resultados.push({
          disparador_id: d.id,
          lanzo: false,
          corrida_id: null,
          motivo: 'agrupado',
        });
      } else if (!d.coleccion) {
        resultados.push({
          disparador_id: d.id,
          lanzo: false,
          corrida_id: null,
          motivo: 'sin_coleccion',
        });
      } else if (d.pipeline && d.pipeline.length) {
        const ran = await runPipeline(db, d.coleccion, d.pipeline);
        if (!ran.ok) {
          resultados.push({
            disparador_id: d.id,
            lanzo: false,
            corrida_id: null,
            motivo: ran.error,
          });
        } else if (!ran.docs.length) {
          resultados.push({
            disparador_id: d.id,
            lanzo: false,
            corrida_id: null,
            motivo: 'pipeline_vacio',
          });
        } else {
          const corridaIds: string[] = [];
          let firstId: string | null = null;
          for (const doc of ran.docs) {
            try {
              const negocio = resolveNegocio(d, evento.negocio, doc);
              const datos = await datosParaCorrida(deps, evento, doc, d.coleccion);
              if (doc._id != null && d.coleccion) {
                const docsMap =
                  datos._documentos_ && typeof datos._documentos_ === 'object'
                    ? { ...(datos._documentos_ as Record<string, unknown>) }
                    : {};
                docsMap[d.coleccion] = String(doc._id);
                datos._documentos_ = docsMap;
                datos._documento_id = String(doc._id);
              }
              const started = await deps.startCorrida({
                flujoId: d.flujo_id,
                negocio,
                datos,
                disparadorId: d.id,
                eventoId: evento._id,
                proyectoId: flujo.proyecto_id,
              });
              corridaIds.push(started._id);
              if (!firstId) firstId = started._id;
            } catch {
              break;
            }
          }
          if (corridaIds.length) {
            await markUltimaVez(deps.dbD1, d.id, ts);
            resultados.push({
              disparador_id: d.id,
              lanzo: true,
              corrida_id: firstId,
              corridas: corridaIds,
              motivo: null,
            });
          } else {
            resultados.push({
              disparador_id: d.id,
              lanzo: false,
              corrida_id: null,
              motivo: 'error_corrida',
            });
          }
        }
      } else {
        try {
          const datosBase = await datosParaCorrida(deps, evento, null, d.coleccion);
          const started = await deps.startCorrida({
            flujoId: d.flujo_id,
            negocio: resolveNegocio(d, evento.negocio, null),
            datos: { ...datosBase, _horario: true, _disparador_id: d.id },
            disparadorId: d.id,
            eventoId: evento._id,
            proyectoId: flujo.proyecto_id,
          });
          await markUltimaVez(deps.dbD1, d.id, ts);
          resultados.push({
            disparador_id: d.id,
            lanzo: true,
            corrida_id: started._id,
            corridas: [started._id],
            motivo: null,
          });
        } catch (err) {
          resultados.push({
            disparador_id: d.id,
            lanzo: false,
            corrida_id: null,
            motivo: err instanceof Error ? err.message.slice(0, 120) : 'error_corrida',
          });
        }
      }

      evento.resultado = resultados;
      await db
        .collection(EVENTOS_COLLECTION)
        .updateOne({ _id: evento._id }, { $set: { resultado: resultados } });
      return evento._id;
    });

    if (eventoId) {
      eventoIds.push(eventoId);
      processed += 1;
    }
  }

  return { processed, eventos: eventoIds };
}

/** Utilidad: clone JSON-safe del doc (sin ObjectId raros). */
export function cloneDoc(doc: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!doc) return null;
  try {
    return JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
  } catch {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(doc)) {
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v == null) {
        out[k] = v;
      } else {
        out[k] = String(v);
      }
    }
    return out;
  }
}
