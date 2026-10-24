/**
 * Motor interno Fase 2: cola Cloudflare Queue `pasos` + ejecución por tipo de ejecutor.
 * Mensaje: { corrida_id, nodo_id, intento }.
 */

import {
  evalCondicion,
  findNodo,
  pickNextNodo,
  primerPasoEjecutable,
  type FlujoNodo,
  type FlujoVersionDoc,
} from './flujos';
import {
  EJECUTOR_IMPLICITO,
  parseConfigJson,
  type EjecutorRow,
  type EjecutorTipo,
} from './ejecutores';
import type { CorridaDoc, CorridaPaso } from './corridas';
import { withMongoDb, mongoUriConfigured, type MongoEnv } from './mongo';

export type PasoQueueMsg = {
  corrida_id: string;
  nodo_id: string;
  intento: number;
};

export type MotorEnv = {
  DB: D1Database;
  PASOS?: Queue<PasoQueueMsg>;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  XAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  N8N_TOKEN?: string;
  [key: string]: unknown;
};

export type MotorDeps = {
  env: MotorEnv;
  nowIso: () => string;
  loadCorridaWithFlujo: (
    id: string
  ) => Promise<
    | { ok: true; doc: CorridaDoc; flujo: FlujoVersionDoc }
    | { ok: false; status: number; error: string }
  >;
  saveCorridaDoc: (doc: CorridaDoc) => Promise<void>;
  mongoForProyecto: (
    proyectoId: string
  ) => Promise<{ env: MongoEnv; dbName: string } | null>;
  resolveEntradasValores: (
    entradas: string[],
    negocio: string,
    datos: Record<string, unknown>
  ) => Promise<Record<string, unknown>>;
  writeSalidasMongo: (
    skillId: string,
    negocio: string,
    valores: Record<string, unknown>,
    corridaId: string | null
  ) => Promise<string[]>;
  loadFlujoVersion: (flujoId: string, version?: number) => Promise<FlujoVersionDoc | null>;
  newCorridaId: () => string;
  startChildCorrida?: (args: {
    parent: CorridaDoc;
    childFlujo: FlujoVersionDoc;
    ts: string;
  }) => Promise<CorridaDoc>;
};

export async function enqueuePaso(
  env: MotorEnv,
  msg: PasoQueueMsg,
  opts?: { delaySeconds?: number }
): Promise<boolean> {
  if (!env.PASOS) {
    console.warn('PASOS queue binding missing; skip enqueue', msg);
    return false;
  }
  const body: PasoQueueMsg = {
    corrida_id: String(msg.corrida_id || '').trim(),
    nodo_id: String(msg.nodo_id || '').trim(),
    intento: Math.max(0, Number(msg.intento) || 0),
  };
  if (!body.corrida_id || !body.nodo_id) return false;
  const delay = opts?.delaySeconds != null ? Math.max(0, Number(opts.delaySeconds) || 0) : 0;
  if (delay > 0) {
    await env.PASOS.send(body, { delaySeconds: delay });
  } else {
    await env.PASOS.send(body);
  }
  return true;
}

/** Lease en D1 corridas_index. Devuelve false si otro worker ya lo tiene. */
export async function tryAcquireLease(
  db: D1Database,
  corridaId: string,
  nodoId: string,
  timeoutS: number,
  now: string
): Promise<boolean> {
  const until = new Date(Date.parse(now) + Math.max(1, timeoutS) * 1000).toISOString();
  const r = await db
    .prepare(
      `UPDATE corridas_index
       SET lease_hasta = ?, lease_nodo_id = ?
       WHERE id = ?
         AND (lease_hasta IS NULL OR lease_hasta = '' OR lease_hasta < ?)`
    )
    .bind(until, nodoId, corridaId, now)
    .run();
  const changes = Number((r as { meta?: { changes?: number } }).meta?.changes ?? 0);
  return changes > 0;
}

export async function releaseLease(db: D1Database, corridaId: string): Promise<void> {
  await db
    .prepare(`UPDATE corridas_index SET lease_hasta = NULL, lease_nodo_id = NULL WHERE id = ?`)
    .bind(corridaId)
    .run()
    .catch(() => undefined);
}

export function implicitEjecutor(): {
  id: string;
  tipo: EjecutorTipo;
  config: Record<string, unknown>;
  timeout_s: number;
  reintentos: number;
  espera_reintento_s: number;
  version: number;
  activo: boolean;
} {
  return {
    id: EJECUTOR_IMPLICITO,
    tipo: 'agente_externo',
    config: { agente_id: 'externo' },
    timeout_s: 3600,
    reintentos: 0,
    espera_reintento_s: 10,
    version: 1,
    activo: true,
  };
}

export async function loadEjecutorForSkill(
  db: D1Database,
  skillRow: { ejecutor_id?: string | null }
): Promise<ReturnType<typeof implicitEjecutor> & { nombre?: string }> {
  const eid = skillRow.ejecutor_id ? String(skillRow.ejecutor_id) : '';
  if (!eid) return implicitEjecutor();
  const row = await db
    .prepare(
      `SELECT id, nombre, tipo, config_json, timeout_s, reintentos, espera_reintento_s,
              activo, version FROM ejecutores WHERE id = ?`
    )
    .bind(eid)
    .first<EjecutorRow & { nombre: string }>();
  if (!row || !row.activo) return implicitEjecutor();
  return {
    id: row.id,
    nombre: row.nombre,
    tipo: row.tipo as EjecutorTipo,
    config: parseConfigJson(row.config_json),
    timeout_s: Number(row.timeout_s) || 60,
    reintentos: Number(row.reintentos) || 0,
    espera_reintento_s: Number(row.espera_reintento_s) || 10,
    version: Number(row.version) || 1,
    activo: true,
  };
}

function upsertPaso(
  pasos: CorridaPaso[],
  patch: Partial<CorridaPaso> & { nodo_id: string }
): CorridaPaso[] {
  const idx = pasos.findIndex((p) => p.nodo_id === patch.nodo_id && p.estado !== 'hecho');
  if (idx < 0) {
    return [
      ...pasos,
      {
        nodo_id: patch.nodo_id,
        skill: patch.skill ?? null,
        estado: patch.estado || 'pendiente',
        inicio: patch.inicio ?? null,
        fin: patch.fin ?? null,
        salidas: patch.salidas ?? null,
        ejecutor_id: patch.ejecutor_id,
        ejecutor_version: patch.ejecutor_version,
        prompt_version: patch.prompt_version,
        duracion_ms: patch.duracion_ms,
        intento: patch.intento,
        entradas: patch.entradas,
        error: patch.error,
        coste: patch.coste,
      },
    ];
  }
  const next = [...pasos];
  next[idx] = { ...next[idx]!, ...patch };
  return next;
}

export type EjecucionLogEntry = {
  skill: string | null;
  ejecutor_id: string | null;
  ejecutor_version: number | null;
  prompt_version: number | null;
  entradas: Record<string, unknown> | null;
  salidas: Record<string, unknown> | null;
  duracion_ms: number;
  coste: unknown;
  estado: string;
  corrida_id: string | null;
  error?: string | null;
  intento?: number;
  origen?: string | null;
  modo?: string | null;
};

/** Registra ejecución en Mongo `ejecuciones` (best-effort). */
export async function logEjecucion(
  deps: MotorDeps,
  proyectoId: string,
  entry: EjecucionLogEntry
): Promise<string | null> {
  const mongo = await deps.mongoForProyecto(proyectoId);
  if (!mongo || !mongoUriConfigured(mongo.env)) return null;
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? `ej-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
      : `ej-${Date.now().toString(36)}`;
  const doc = {
    _id: id,
    ...entry,
    creado: deps.nowIso(),
  };
  try {
    await withMongoDb(
      mongo.env,
      async (db) => {
        await db.collection('ejecuciones').insertOne(doc);
      },
      mongo.dbName
    );
    return id;
  } catch (err) {
    console.error('logEjecucion', err);
    return null;
  }
}

/** Lista ejecuciones Mongo filtradas por skill y/o ejecutor_id. */
export async function listEjecucionesMongo(
  deps: MotorDeps,
  proyectoId: string,
  filter: { skill?: string; ejecutor_id?: string },
  limit = 20
): Promise<Array<Record<string, unknown>>> {
  const mongo = await deps.mongoForProyecto(proyectoId);
  if (!mongo || !mongoUriConfigured(mongo.env)) return [];
  const q: Record<string, unknown> = {};
  if (filter.skill) q.skill = filter.skill;
  if (filter.ejecutor_id) q.ejecutor_id = filter.ejecutor_id;
  const lim = Math.min(100, Math.max(1, limit));
  try {
    return await withMongoDb(
      mongo.env,
      async (db) => {
        const rows = await db
          .collection('ejecuciones')
          .find(q)
          .sort({ creado: -1 })
          .limit(lim)
          .toArray();
        return rows.map((r) => {
          const { _id, ...rest } = r as Record<string, unknown> & { _id: unknown };
          return { id: String(_id), ...rest };
        });
      },
      mongo.dbName
    );
  } catch (err) {
    console.error('listEjecucionesMongo', err);
    return [];
  }
}

function secretFromEnv(env: MotorEnv, name: string | undefined): string {
  const key = String(name || '').trim();
  if (!key) return '';
  const v = env[key];
  return typeof v === 'string' ? v.trim() : '';
}

/** Mock de salidas cuando no hay API key (permite smoke end-to-end). */
export function mockModeloSalidas(
  salidas: string[],
  entradas: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const a of salidas) {
    if (Object.prototype.hasOwnProperty.call(entradas, a) && entradas[a] != null) {
      out[a] = entradas[a];
      continue;
    }
    if (/campos|pasos|lista|array/i.test(a)) out[a] = [];
    else if (/llega|bool|flag/i.test(a)) out[a] = true;
    else if (/selector/i.test(a)) out[a] = 'button[type=submit]';
    else if (/nombre/i.test(a)) out[a] = String(entradas['_negocio.nombre_'] || 'mock');
    else if (/url/i.test(a)) out[a] = String(entradas['_negocio.url_'] || entradas['_proceso.url_inicio_'] || 'https://example.com');
    else if (/telefono/i.test(a)) out[a] = '+34000000000';
    else if (/zona/i.test(a)) out[a] = 'Atlantic/Canary';
    else out[a] = `mock:${a}`;
  }
  return out;
}

async function callModeloProveedor(
  env: MotorEnv,
  config: Record<string, unknown>,
  systemPrompt: string,
  userPayload: Record<string, unknown>
): Promise<{ text: string; coste: unknown; modelo: string; modo: 'real' | 'mock' }> {
  const proveedor = String(config.proveedor || 'openai').toLowerCase();
  const modelo = String(config.modelo || env.OPENAI_MODEL || 'gpt-4o-mini');
  const secretName = String(config.secret || (proveedor === 'xai' ? 'XAI_API_KEY' : proveedor === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'));
  const apiKey = secretFromEnv(env, secretName) || (proveedor === 'openai' ? String(env.OPENAI_API_KEY || '') : '');
  if (!apiKey) {
    return { text: '', coste: null, modelo, modo: 'mock' };
  }
  const temperatura = Number(config.temperatura ?? 0);
  const salidaJson = config.salida_json !== false;

  if (proveedor === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelo,
        max_tokens: 4096,
        temperature: temperatura,
        system: systemPrompt,
        messages: [{ role: 'user', content: JSON.stringify(userPayload) }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}`);
    const data = (await res.json()) as { content?: Array<{ text?: string }>; usage?: unknown };
    const text = data.content?.map((c) => c.text || '').join('') || '';
    return { text, coste: data.usage || null, modelo, modo: 'real' };
  }

  const base =
    proveedor === 'xai' ? 'https://api.x.ai/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions';
  const body: Record<string, unknown> = {
    model: modelo,
    temperature: temperatura,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify(userPayload) },
    ],
  };
  if (salidaJson && proveedor !== 'xai') {
    body.response_format = { type: 'json_object' };
  }
  const res = await fetch(base, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`${proveedor} HTTP ${res.status}: ${errText.slice(0, 180)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: unknown;
  };
  return {
    text: data.choices?.[0]?.message?.content || '',
    coste: data.usage || null,
    modelo,
    modo: 'real',
  };
}

function extractJsonObject(raw: string): Record<string, unknown> {
  const t = String(raw || '').trim();
  if (!t) return {};
  try {
    const v = JSON.parse(t);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : { valor: v };
  } catch {
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) {
      const v = JSON.parse(fence[1]!.trim());
      return v && typeof v === 'object' && !Array.isArray(v) ? v : { valor: v };
    }
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const v = JSON.parse(t.slice(start, end + 1));
      return v && typeof v === 'object' && !Array.isArray(v) ? v : { valor: v };
    }
    throw new Error('respuesta del modelo no es JSON');
  }
}

function pickSalidasFromModel(
  parsed: Record<string, unknown>,
  salidas: string[]
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const nested =
    parsed.salidas && typeof parsed.salidas === 'object' && !Array.isArray(parsed.salidas)
      ? (parsed.salidas as Record<string, unknown>)
      : parsed;
  for (const a of salidas) {
    if (Object.prototype.hasOwnProperty.call(nested, a)) out[a] = nested[a];
    else if (Object.prototype.hasOwnProperty.call(parsed, a)) out[a] = parsed[a];
  }
  return out;
}

async function ejecutarHerramienta(
  funcion: string,
  entradas: Record<string, unknown>,
  datos: Record<string, unknown>
): Promise<Record<string, unknown>> {
  if (funcion === 'consultar-datos') {
    return { ...datos, ...entradas, _ok_: true };
  }
  // Registro mínimo; funciones desconocidas → eco
  return { ...entradas, _herramienta_: funcion, _ok_: true };
}

async function ejecutarIntegracion(
  env: MotorEnv,
  config: Record<string, unknown>,
  payload: Record<string, unknown>
): Promise<{ asincrono: boolean; status: number; body: unknown }> {
  const url = String(config.url || '');
  const metodo = String(config.metodo || 'POST').toUpperCase();
  const asincrono = config.asincrono !== false;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const secretName = config.secret ? String(config.secret) : '';
  const token = secretFromEnv(env, secretName);
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, {
    method: metodo,
    headers,
    body: metodo === 'GET' || metodo === 'HEAD' ? undefined : JSON.stringify(payload),
  });
  const text = await res.text().catch(() => '');
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* raw */
  }
  return { asincrono, status: res.status, body };
}

async function enqueueNext(
  deps: MotorDeps,
  doc: CorridaDoc,
  flujo: FlujoVersionDoc,
  desdeId: string,
  intento: number
): Promise<void> {
  const next = pickNextNodo(flujo.nodos, flujo.aristas, desdeId, doc.datos || {});
  if (!next) {
    doc.estado = 'fallida';
    doc.errores = [
      ...(doc.errores || []),
      { at: deps.nowIso(), nodo_id: desdeId, error: `Sin arista saliente desde «${desdeId}».` },
    ];
    await deps.saveCorridaDoc(doc);
    return;
  }
  doc.paso_actual = next.id;
  if (next.tipo === 'fin') {
    // Consumer will mark completada; still enqueue so lease/pasos are consistent
  } else if (doc.estado === 'completada' || doc.estado === 'fallida' || doc.estado === 'cancelada') {
    return;
  } else if (
    doc.estado !== 'esperando_integracion' &&
    doc.estado !== 'esperando_humano' &&
    doc.estado !== 'esperando_hijo'
  ) {
    doc.estado = 'en_curso';
  }
  await deps.saveCorridaDoc(doc);
  await enqueuePaso(deps.env, { corrida_id: doc._id, nodo_id: next.id, intento });
}

/**
 * Procesa un mensaje de la cola. Devuelve 'ack' | 'retry'.
 */
export async function processPasoMessage(
  deps: MotorDeps,
  msg: PasoQueueMsg
): Promise<'ack' | 'retry'> {
  const corridaId = String(msg.corrida_id || '').trim();
  const nodoId = String(msg.nodo_id || '').trim();
  const intento = Math.max(0, Number(msg.intento) || 0);
  if (!corridaId || !nodoId) return 'ack';

  const loaded = await deps.loadCorridaWithFlujo(corridaId);
  if (!loaded.ok) return 'ack';
  let { doc, flujo } = loaded;

  // Estados terminales: descartar
  if (
    doc.estado === 'completada' ||
    doc.estado === 'terminada' ||
    doc.estado === 'fallida' ||
    doc.estado === 'error' ||
    doc.estado === 'cancelada'
  ) {
    return 'ack';
  }

  // Si espera integración/humano y este nodo ya no es el actual, ack
  if (
    (doc.estado === 'esperando_integracion' ||
      doc.estado === 'esperando_humano' ||
      doc.estado === 'esperando' ||
      doc.estado === 'esperando_hijo') &&
    doc.paso_actual !== nodoId
  ) {
    return 'ack';
  }

  const nodo = findNodo(flujo.nodos, nodoId);
  if (!nodo) {
    doc.estado = 'fallida';
    doc.errores = [
      ...(doc.errores || []),
      { at: deps.nowIso(), nodo_id: nodoId, error: 'Nodo no existe en flujo_version.' },
    ];
    await deps.saveCorridaDoc(doc);
    return 'ack';
  }

  // Timeout lease: usar timeout del ejecutor si skill; default 60
  let timeoutS = 60;
  if (nodo.tipo === 'skill' && nodo.skill) {
    const srow = await deps.env.DB.prepare('SELECT ejecutor_id FROM skills WHERE id = ?')
      .bind(nodo.skill)
      .first<{ ejecutor_id: string | null }>();
    const ej = await loadEjecutorForSkill(deps.env.DB, srow || {});
    timeoutS = ej.timeout_s || 60;
  }

  const now = deps.nowIso();
  const got = await tryAcquireLease(deps.env.DB, corridaId, nodoId, timeoutS, now);
  if (!got) return 'ack'; // otro worker

  try {
    doc.paso_actual = nodoId;
    if (doc.estado === 'pendiente') doc.estado = 'en_curso';

    if (nodo.tipo === 'fin') {
      doc.estado = 'completada';
      doc.pasos = upsertPaso(doc.pasos || [], {
        nodo_id: nodoId,
        skill: null,
        estado: 'hecho',
        inicio: now,
        fin: deps.nowIso(),
        intento,
      });
      await deps.saveCorridaDoc(doc);
      await releaseLease(deps.env.DB, corridaId);
      if (doc.padre_id) {
        // Reanudar padre: encolar siguiente tras subflujo
        const parentLoaded = await deps.loadCorridaWithFlujo(doc.padre_id);
        if (parentLoaded.ok) {
          const parent = parentLoaded.doc;
          const parentFlujo = parentLoaded.flujo;
          parent.datos = { ...(parent.datos || {}), ...(doc.datos || {}) };
          const fromId = parent.subflujo_nodo_id || parent.paso_actual;
          parent.hijo_id = null;
          parent.subflujo_nodo_id = null;
          parent.estado = 'en_curso';
          await deps.saveCorridaDoc(parent);
          await enqueueNext(deps, parent, parentFlujo, fromId, 0);
        }
      }
      return 'ack';
    }

    if (nodo.tipo === 'decision') {
      const inicio = deps.nowIso();
      // Condición DSL existente; si pipeline[] en condicion, tratar como truthy via eval
      const ok = evalCondicion(nodo.condicion, doc.datos || {});
      // pickNextNodo ya usa la condición; forzar datos iguales
      doc.pasos = upsertPaso(doc.pasos || [], {
        nodo_id: nodoId,
        skill: null,
        estado: 'hecho',
        inicio,
        fin: deps.nowIso(),
        intento,
        salidas: { _decision_: ok },
      });
      doc.estado = 'en_curso';
      await deps.saveCorridaDoc(doc);
      await releaseLease(deps.env.DB, corridaId);
      await enqueueNext(deps, doc, flujo, nodoId, 0);
      return 'ack';
    }

    if (nodo.tipo === 'subflujo') {
      const fid = String(nodo.flujo_id || '').trim();
      const childFlujo = fid ? await deps.loadFlujoVersion(fid) : null;
      if (!childFlujo) {
        doc.estado = 'fallida';
        doc.errores = [
          ...(doc.errores || []),
          { at: deps.nowIso(), nodo_id: nodoId, error: `Subflujo «${fid}» no existe.` },
        ];
        await deps.saveCorridaDoc(doc);
        await releaseLease(deps.env.DB, corridaId);
        return 'ack';
      }
      const ts = deps.nowIso();
      const childId = deps.newCorridaId();
      const child: CorridaDoc = {
        _id: childId,
        flujo_id: childFlujo.id,
        flujo_version: childFlujo.version,
        proyecto_id: childFlujo.proyectoId,
        negocio: doc.negocio,
        estado: 'pendiente',
        paso_actual: '',
        pasos: [],
        datos: { ...(doc.datos || {}) },
        errores: [],
        creada: ts,
        actualizada: ts,
        padre_id: doc._id,
        hijo_id: null,
        subflujo_nodo_id: null,
      };
      const first = primerPasoEjecutable(childFlujo.nodos, childFlujo.aristas, child.datos);
      if (first.kind === 'error') {
        doc.estado = 'fallida';
        doc.errores = [...(doc.errores || []), { at: ts, nodo_id: nodoId, error: first.error }];
        await deps.saveCorridaDoc(doc);
        await releaseLease(deps.env.DB, corridaId);
        return 'ack';
      }
      if (first.kind === 'fin') {
        child.paso_actual = first.nodo.id;
        child.estado = 'completada';
      } else if (first.kind === 'skill' || first.kind === 'espera' || first.kind === 'subflujo') {
        child.paso_actual = first.nodo.id;
        child.estado = 'en_curso';
      }
      await deps.saveCorridaDoc(child);
      if (child.paso_actual && child.estado !== 'completada') {
        await enqueuePaso(deps.env, {
          corrida_id: child._id,
          nodo_id: child.paso_actual,
          intento: 0,
        });
      }
      doc.paso_actual = nodoId;
      doc.estado = 'esperando_hijo';
      doc.hijo_id = childId;
      doc.subflujo_nodo_id = nodoId;
      doc.pasos = upsertPaso(doc.pasos || [], {
        nodo_id: nodoId,
        skill: null,
        estado: 'pendiente',
        inicio: ts,
        intento,
      });
      await deps.saveCorridaDoc(doc);
      await releaseLease(deps.env.DB, corridaId);
      return 'ack';
    }

    if (nodo.tipo === 'espera') {
      doc.estado = 'esperando_humano';
      doc.pasos = upsertPaso(doc.pasos || [], {
        nodo_id: nodoId,
        skill: null,
        estado: 'pendiente',
        inicio: deps.nowIso(),
        intento,
      });
      await deps.saveCorridaDoc(doc);
      await releaseLease(deps.env.DB, corridaId);
      return 'ack';
    }

    if (nodo.tipo !== 'skill' || !nodo.skill) {
      doc.estado = 'fallida';
      doc.errores = [
        ...(doc.errores || []),
        { at: deps.nowIso(), nodo_id: nodoId, error: `Tipo de nodo no ejecutable: ${nodo.tipo}` },
      ];
      await deps.saveCorridaDoc(doc);
      await releaseLease(deps.env.DB, corridaId);
      return 'ack';
    }

    // —— skill ——
    const skillId = nodo.skill;
    const skillRow = await deps.env.DB.prepare(
      'SELECT id, nombre, ejecutor_id FROM skills WHERE id = ?'
    )
      .bind(skillId)
      .first<{ id: string; nombre: string; ejecutor_id: string | null }>();
    if (!skillRow) {
      doc.estado = 'fallida';
      doc.errores = [
        ...(doc.errores || []),
        { at: deps.nowIso(), nodo_id: nodoId, error: `Skill «${skillId}» no encontrada.` },
      ];
      await deps.saveCorridaDoc(doc);
      await releaseLease(deps.env.DB, corridaId);
      return 'ack';
    }

    const ioRows = await deps.env.DB.prepare(
      'SELECT ancla, direccion FROM skill_anclas WHERE skill_id = ?'
    )
      .bind(skillId)
      .all();
    const entradasDecl: string[] = [];
    const salidasDecl: string[] = [];
    for (const raw of ioRows.results || []) {
      const r = raw as { ancla: string; direccion?: string };
      if (String(r.direccion || '') === 'entrada') entradasDecl.push(r.ancla);
      else salidasDecl.push(r.ancla);
    }

    const ejecutor = await loadEjecutorForSkill(deps.env.DB, skillRow);
    const promptLink = await deps.env.DB.prepare(
      `SELECT sps.system_prompt_id, COALESCE(MAX(spv.numero), 0) AS ver
       FROM system_prompt_skills sps
       LEFT JOIN system_prompt_versions spv ON spv.system_prompt_id = sps.system_prompt_id
       WHERE sps.skill_id = ?
       GROUP BY sps.system_prompt_id`
    )
      .bind(skillId)
      .first<{ system_prompt_id: string; ver: number }>();

    let systemMd = '';
    let promptVersion: number | null = promptLink?.ver ? Number(promptLink.ver) : null;
    if (promptLink?.system_prompt_id) {
      const pv = await deps.env.DB.prepare(
        `SELECT markdown, numero FROM system_prompt_versions
         WHERE system_prompt_id = ? ORDER BY numero DESC LIMIT 1`
      )
        .bind(promptLink.system_prompt_id)
        .first<{ markdown: string; numero: number }>();
      systemMd = pv?.markdown || '';
      promptVersion = pv?.numero ?? promptVersion;
    }
    const skillMdRow = await deps.env.DB.prepare(
      `SELECT markdown FROM skill_versions WHERE skill_id = ? ORDER BY numero DESC LIMIT 1`
    )
      .bind(skillId)
      .first<{ markdown: string }>();
    const skillMd = skillMdRow?.markdown || '';

    const entradas = await deps.resolveEntradasValores(entradasDecl, doc.negocio, doc.datos || {});
    const inicio = deps.nowIso();
    doc.pasos = upsertPaso(doc.pasos || [], {
      nodo_id: nodoId,
      skill: skillId,
      estado: 'pendiente',
      inicio,
      intento,
      ejecutor_id: ejecutor.id,
      ejecutor_version: ejecutor.version,
      prompt_version: promptVersion,
      entradas,
    });
    await deps.saveCorridaDoc(doc);

    // agente_externo → esperar polling
    if (ejecutor.tipo === 'agente_externo') {
      doc.estado = 'esperando_integracion';
      await deps.saveCorridaDoc(doc);
      await releaseLease(deps.env.DB, corridaId);
      await logEjecucion(deps, doc.proyecto_id, {
        skill: skillId,
        ejecutor_id: ejecutor.id,
        ejecutor_version: ejecutor.version,
        prompt_version: promptVersion,
        entradas,
        salidas: null,
        duracion_ms: 0,
        coste: null,
        estado: 'esperando_integracion',
        corrida_id: doc._id,
        intento,
      });
      return 'ack';
    }

    if (ejecutor.tipo === 'humano') {
      doc.estado = 'esperando_humano';
      await deps.saveCorridaDoc(doc);
      await releaseLease(deps.env.DB, corridaId);
      await logEjecucion(deps, doc.proyecto_id, {
        skill: skillId,
        ejecutor_id: ejecutor.id,
        ejecutor_version: ejecutor.version,
        prompt_version: promptVersion,
        entradas,
        salidas: null,
        duracion_ms: 0,
        coste: null,
        estado: 'esperando_humano',
        corrida_id: doc._id,
        intento,
      });
      return 'ack';
    }

    let salidas: Record<string, unknown> = {};
    let coste: unknown = null;
    let errMsg: string | null = null;
    const t0 = Date.now();

    try {
      if (ejecutor.tipo === 'herramienta') {
        const funcion = String(ejecutor.config.funcion || '');
        const raw = await ejecutarHerramienta(funcion, entradas, doc.datos || {});
        salidas = {};
        for (const a of salidasDecl) {
          if (Object.prototype.hasOwnProperty.call(raw, a)) salidas[a] = raw[a];
        }
        // Si la herramienta no rellena, dejar lo que haya en raw que coincida
        if (!Object.keys(salidas).length && salidasDecl.length) {
          for (const a of salidasDecl) salidas[a] = raw[a] ?? null;
        }
      } else if (ejecutor.tipo === 'integracion') {
        const payload = {
          corrida_id: doc._id,
          nodo_id: nodoId,
          skill: skillId,
          negocio: doc.negocio,
          entradas,
          salidas_esperadas: salidasDecl,
        };
        const r = await ejecutarIntegracion(deps.env, ejecutor.config, payload);
        if (r.status >= 400 && r.status < 500) {
          errMsg = `integracion HTTP ${r.status}`;
        } else if (r.asincrono || r.status === 202) {
          doc.estado = 'esperando_integracion';
          await deps.saveCorridaDoc(doc);
          await releaseLease(deps.env.DB, corridaId);
          await logEjecucion(deps, doc.proyecto_id, {
            skill: skillId,
            ejecutor_id: ejecutor.id,
            ejecutor_version: ejecutor.version,
            prompt_version: promptVersion,
            entradas,
            salidas: null,
            duracion_ms: Date.now() - t0,
            coste: null,
            estado: 'esperando_integracion',
            corrida_id: doc._id,
            intento,
          });
          return 'ack';
        } else if (r.body && typeof r.body === 'object' && !Array.isArray(r.body)) {
          const b = r.body as Record<string, unknown>;
          const vals =
            b.valores && typeof b.valores === 'object'
              ? (b.valores as Record<string, unknown>)
              : b;
          for (const a of salidasDecl) {
            if (Object.prototype.hasOwnProperty.call(vals, a)) salidas[a] = vals[a];
          }
        }
      } else if (ejecutor.tipo === 'modelo') {
        const systemPrompt =
          [systemMd, skillMd].filter(Boolean).join('\n\n') ||
          'Devuelve JSON con las anclas de salida pedidas.';
        const userPayload = {
          skill: skillId,
          entradas,
          salidas: salidasDecl,
          instruccion: 'Devuelve un JSON con exactamente las claves de salidas.',
        };
        const called = await callModeloProveedor(deps.env, ejecutor.config, systemPrompt, userPayload);
        coste = called.coste;
        if (called.modo === 'mock') {
          salidas = mockModeloSalidas(salidasDecl, entradas);
        } else {
          const parsed = extractJsonObject(called.text);
          salidas = pickSalidasFromModel(parsed, salidasDecl);
        }
      } else {
        errMsg = `tipo de ejecutor no soportado: ${ejecutor.tipo}`;
      }
    } catch (e) {
      errMsg = e instanceof Error ? e.message : String(e);
    }

    const duracion = Date.now() - t0;

    if (!errMsg) {
      const missing = salidasDecl.filter((a) => !(a in salidas));
      if (missing.length) {
        errMsg = `Salidas faltantes: ${missing.join(', ')}`;
      }
    }

    if (errMsg) {
      doc.pasos = upsertPaso(doc.pasos || [], {
        nodo_id: nodoId,
        skill: skillId,
        estado: 'error',
        inicio,
        fin: deps.nowIso(),
        intento,
        ejecutor_id: ejecutor.id,
        ejecutor_version: ejecutor.version,
        prompt_version: promptVersion,
        entradas,
        salidas: null,
        error: errMsg,
        duracion_ms: duracion,
        coste,
      });
      doc.errores = [...(doc.errores || []), { at: deps.nowIso(), nodo_id: nodoId, error: errMsg }];
      // F2: sin reintentos automáticos de F3; marcar fallida (smoke espera completada con mock)
      doc.estado = 'fallida';
      await deps.saveCorridaDoc(doc);
      await releaseLease(deps.env.DB, corridaId);
      await logEjecucion(deps, doc.proyecto_id, {
        skill: skillId,
        ejecutor_id: ejecutor.id,
        ejecutor_version: ejecutor.version,
        prompt_version: promptVersion,
        entradas,
        salidas: null,
        duracion_ms: duracion,
        coste,
        estado: 'error',
        corrida_id: doc._id,
        error: errMsg,
        intento,
      });
      return 'ack';
    }

    // Persistir salidas en Mongo + corrida.datos
    try {
      await deps.writeSalidasMongo(skillId, doc.negocio, salidas, doc._id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'escritura Mongo falló';
      doc.estado = 'fallida';
      doc.errores = [...(doc.errores || []), { at: deps.nowIso(), nodo_id: nodoId, error: msg }];
      await deps.saveCorridaDoc(doc);
      await releaseLease(deps.env.DB, corridaId);
      return 'ack';
    }

    doc.datos = { ...(doc.datos || {}), ...salidas };
    doc.pasos = upsertPaso(doc.pasos || [], {
      nodo_id: nodoId,
      skill: skillId,
      estado: 'hecho',
      inicio,
      fin: deps.nowIso(),
      intento,
      ejecutor_id: ejecutor.id,
      ejecutor_version: ejecutor.version,
      prompt_version: promptVersion,
      entradas,
      salidas,
      duracion_ms: duracion,
      coste,
    });
    doc.estado = 'en_curso';
    await deps.saveCorridaDoc(doc);
    await releaseLease(deps.env.DB, corridaId);
    await logEjecucion(deps, doc.proyecto_id, {
      skill: skillId,
      ejecutor_id: ejecutor.id,
      ejecutor_version: ejecutor.version,
      prompt_version: promptVersion,
      entradas,
      salidas,
      duracion_ms: duracion,
      coste,
      estado: 'ok',
      corrida_id: doc._id,
      intento,
    });
    await enqueueNext(deps, doc, flujo, nodoId, 0);
    return 'ack';
  } catch (err) {
    console.error('processPasoMessage', err);
    await releaseLease(deps.env.DB, corridaId).catch(() => undefined);
    return 'retry';
  }
}

/** Tras /salidas de agente externo: marcar hecho y encolar siguiente. */
export async function afterExternalSalidas(
  deps: MotorDeps,
  doc: CorridaDoc,
  flujo: FlujoVersionDoc,
  nodoId: string,
  salidas: Record<string, unknown>,
  meta?: {
    ejecutor_id?: string | null;
    ejecutor_version?: number | null;
    prompt_version?: number | null;
    entradas?: Record<string, unknown> | null;
  }
): Promise<CorridaDoc> {
  const ts = deps.nowIso();
  doc.datos = { ...(doc.datos || {}), ...salidas };
  doc.pasos = upsertPaso(doc.pasos || [], {
    nodo_id: nodoId,
    skill: findNodo(flujo.nodos, nodoId)?.skill || null,
    estado: 'hecho',
    fin: ts,
    salidas,
    ejecutor_id: meta?.ejecutor_id ?? undefined,
    ejecutor_version: meta?.ejecutor_version ?? undefined,
    prompt_version: meta?.prompt_version ?? undefined,
    entradas: meta?.entradas ?? undefined,
  });
  doc.estado = 'en_curso';
  await deps.saveCorridaDoc(doc);
  await enqueueNext(deps, doc, flujo, nodoId, 0);
  // reload
  const again = await deps.loadCorridaWithFlujo(doc._id);
  return again.ok ? again.doc : doc;
}

export function enqueueFirstPaso(
  deps: MotorDeps,
  doc: CorridaDoc
): Promise<boolean> {
  if (!doc.paso_actual) return Promise.resolve(false);
  return enqueuePaso(deps.env, {
    corrida_id: doc._id,
    nodo_id: doc.paso_actual,
    intento: 0,
  });
}
