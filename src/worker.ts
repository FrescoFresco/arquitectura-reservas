import { Hono } from 'hono';
import { cors } from 'hono/cors';
// Bundled via wrangler rules (Text) — same canonical contract as Documentación → API.
import apiDocsMd from '../documentacion/api.md';
import { API_DOCS_INDEX } from './docs-index';
import {
  appendObservacion,
  canonicalFromAncla,
  defaultStrictPii,
  findAliasConflicts,
  looksLikeE164Ancla,
  looksLikeUrlAncla,
  maskSensitive,
  normalizeAliasList,
  normalizeE164,
  normalizeObservaciones,
  parseJsonArray,
  parseJsonObject,
  proyectarArrayN,
  scrubPiiFromUrl,
  type Observacion,
} from './pelo-sur';
import {
  buildNegocioDoc,
  createProjectDatabase,
  mongoDriverErrorBody,
  mongoHealthLabel,
  mongoNotConfiguredError,
  mongoUriConfigured,
  probeMongoStatus,
  resolveMongoDbName,
  upsertNegocio,
  withMongoDb,
  type MongoEnv,
} from './mongo';
import {
  clearClusterStoredUri,
  isValidMongoUri,
  loadClusterStoredUri,
  readClusterMongoMeta,
  saveClusterStoredUri,
  type MongoConfigMeta,
} from './mongo-config';
import {
  bodyHasColor,
  colorFromRow,
  parseEntityColor,
  tryColorOnlyUpdate,
} from './entity-color';
import {
  buildDiagrama,
  buildJsonSchemaForCollection,
  parseColecciones,
  parseRelaciones,
  parseStringList,
  validateColeccionEnProyecto,
  validateRelaciones,
  type ColeccionDef,
  type MongoCampoShape,
  type RelacionDef,
} from './proyecto-schema';
import {
  assertResponseSize,
  getColeccionDocumento,
  listColeccionDocumentos,
  parseLimitParam,
  type CatalogCampo,
} from './coleccion-documentos';
import {
  listEsquemaEmpujes,
  parseLastSyncRow,
  recordClusterLastSync,
  recordEsquemaEmpuje,
  resolveEmpujeModo,
  scheduleDebouncedSchemaSync,
  type LastSyncSummary,
} from './schema-auto-sync';
import {
  buildOperativaMermaid,
  findDocForColeccion,
  findDocForCorrida,
  getByPath,
  normalizeAnclasList,
  resolveWriteTargetId,
  setByPath,
  setDocumentoActivo,
  unionAnclas,
  type AnclaMongoMap,
} from './skill-io';
import {
  avanzarDesde,
  findNodo,
  flujoToMermaid,
  parseAristas,
  parseNodos,
  primerPasoEjecutable,
  type FlujoVersionDoc,
} from './flujos';
import {
  ensurePasoPendiente,
  isEsperandoHumano,
  isEsperandoIntegracion,
  isTerminal,
  markPasoHecho,
  newCorridaId,
  publicCorrida,
  type CorridaDoc,
} from './corridas';
import {
  afterExternalSalidas,
  enqueueFirstPaso,
  enqueuePaso,
  listEjecucionesMongo,
  loadEjecutorForSkill,
  logEjecucion,
  processPasoMessage,
  setLeaseDeadline,
  type PasoQueueMsg,
  type MotorDeps as PasosMotorDeps,
} from './motor-pasos';
import {
  accionAprobar,
  accionCancelar,
  accionReanudar,
  accionRechazar,
  accionReintentar,
  runAtascadasTick,
  runEsperandoTimeoutTick,
} from './motor-fallos';
import {
  extractAnclaIdsFromPipeline,
  isDisparadorTipo,
  parsePipeline,
  publicDisparador,
  rowToDisparador,
  validateDisparadorBody,
  validatePipelineStages,
} from './disparadores';
import {
  isEjecutorTipo,
  normalizeTimeouts,
  parseConfigJson,
  resolveSkillEjecutorId,
  rowToEjecutor,
  validateEjecutorConfig,
  type EjecutorRow,
} from './ejecutores';
import { listN8nWorkflows } from './n8n-integracion';
import {
  cloneDoc,
  emitCambioDatos,
  emitWebhook,
  ensureEventosIndexes,
  EVENTOS_COLLECTION,
  probarDisparadorDryRun,
  publicEvento,
  runHorarioTick,
  SYSTEM_COLLECTIONS,
  type EventoDoc,
  type MotorDeps,
} from './eventos-motor';
import {
  generarDefinicion,
  isTipoDefinicion,
  registrarEjecucionSkill,
  esquemaParaTipo,
  REDACTOR_SKILL_ID,
  type RedactorContexto,
} from './redactor';

export type Env = {
  DB: D1Database;
  PUBLIC_UI_ORIGIN?: string;
  /** Optional extra origin for local UI (comma-separated). */
  CORS_ORIGINS?: string;
  /** Atlas / Mongo connection string — wrangler secret fallback (never commit). */
  MONGODB_URI?: string;
  /** Optional DB name; default software_reservas (schema reservas). */
  MONGODB_DB?: string;
  /**
   * AES-GCM key material for encrypting the in-app Mongo URI in D1.
   * Prefer `wrangler secret put ENCRYPTION_KEY`. Required to save/load stored URI.
   */
  ENCRYPTION_KEY?: string;
  /** OpenAI API key for Redactor (skill generar-definicion). Optional — mock if absent. */
  OPENAI_API_KEY?: string;
  /** OpenAI model id (default gpt-4o-mini). */
  OPENAI_MODEL?: string;
  /**
   * Ms sin actualización en corrida `en_curso` antes de marcarla `error` (timeout_sin_avance).
   * Default 10800000 (3h). Solo afecta en_curso; no toca esperando (humano/subflujo).
   */
  CORRIDA_STALE_MS?: string;
  /** Cola de pasos del motor (Fase 2). */
  PASOS?: Queue<PasoQueueMsg>;
  XAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  N8N_TOKEN?: string;
  /** Base URL del n8n autohospedado (p. ej. https://n8n.ejemplo.com). Opcional. */
  N8N_BASE_URL?: string;
  /** API key pública de n8n (`X-N8N-API-KEY`). Opcional; con N8N_BASE_URL habilita el listado. */
  N8N_API_KEY?: string;
};

type ResolvedMongo = {
  env: MongoEnv;
  meta: MongoConfigMeta;
  decryptError?: string;
};

const DEFAULT_CLUSTER_ID = 'atlas-principal';

async function ensureDefaultCluster(db: D1Database): Promise<string> {
  const existing = await db
    .prepare('SELECT id FROM clusters WHERE id = ?')
    .bind(DEFAULT_CLUSTER_ID)
    .first<{ id: string }>();
  if (existing?.id) return existing.id;
  const any = await db.prepare('SELECT id FROM clusters ORDER BY nombre LIMIT 1').first<{ id: string }>();
  if (any?.id) return any.id;
  const ts = nowIso();
  await db
    .prepare(
      'INSERT INTO clusters (id, nombre, descripcion, hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .bind(
      DEFAULT_CLUSTER_ID,
      'Cluster Atlas',
      'Cluster por defecto.',
      '',
      ts,
      ts
    )
    .run();
  return DEFAULT_CLUSTER_ID;
}

async function resolveClusterIdForProyecto(
  db: D1Database,
  proyectoId: string
): Promise<string | null> {
  const row = await db
    .prepare('SELECT cluster_id FROM proyectos WHERE id = ?')
    .bind(proyectoId)
    .first<{ cluster_id: string | null }>();
  if (!row) return null;
  const cid = String(row.cluster_id || '').trim();
  return cid || null;
}

/**
 * URI resolution (never exposes the URI):
 * - With proyectoId (crear-bd, sync/proyecto): URI of that schema's **cluster**
 *   (`mongo_config_cluster` via `proyectos.cluster_id`). No Ajustes global; no env
 *   fallback for product writes — missing URI → not configured (fail clearly).
 * - With clusterId directly (ficha Cluster → Conexión): same table.
 * - Without proyecto/cluster (health / status / sync/negocio): ops-only `MONGODB_URI`.
 */
async function resolveRuntimeMongo(
  env: Env,
  dbHint?: string,
  proyectoId?: string,
  clusterId?: string
): Promise<ResolvedMongo> {
  let decryptError: string | undefined;
  const proyId = String(proyectoId || '').trim();
  let cid = String(clusterId || '').trim();

  if (proyId && !cid) {
    cid = (await resolveClusterIdForProyecto(env.DB, proyId)) || '';
  }

  if (cid) {
    const clusterMeta = await readClusterMongoMeta(env.DB, cid);
    if (clusterMeta?.present) {
      let clusterUri: string | undefined;
      let clusterDb: string | undefined;
      let hint = clusterMeta.hint || '';
      try {
        const loaded = await loadClusterStoredUri(env.DB, env.ENCRYPTION_KEY, cid);
        if (loaded) {
          clusterUri = loaded.uri;
          clusterDb = loaded.db;
          hint = loaded.hint || hint;
        }
      } catch (err) {
        decryptError = err instanceof Error ? err.message : 'decrypt failed';
      }
      if (clusterUri) {
        const mongoEnv: MongoEnv = {
          MONGODB_URI: clusterUri,
          MONGODB_DB: clusterDb || env.MONGODB_DB,
        };
        return {
          env: mongoEnv,
          meta: {
            configured: true,
            source: 'cluster',
            hint,
            db: resolveMongoDbName(mongoEnv, dbHint || clusterDb),
          },
          decryptError,
        };
      }
      return {
        env: {},
        meta: {
          configured: true,
          source: 'cluster',
          hint: clusterMeta.hint || '',
          db: clusterMeta.dbName || resolveMongoDbName(env, dbHint),
        },
        decryptError: decryptError || 'ENCRYPTION_KEY missing',
      };
    }
    return {
      env: {},
      meta: {
        configured: false,
        source: 'none',
        hint: '',
        db: resolveMongoDbName(env, dbHint),
      },
    };
  }

  if (proyId) {
    // Proyecto sin cluster_id: no hay URI de producto.
    return {
      env: {},
      meta: {
        configured: false,
        source: 'none',
        hint: '',
        db: resolveMongoDbName(env, dbHint),
      },
    };
  }

  // Ops-only: Worker secret (not product Ajustes).
  if (mongoUriConfigured(env)) {
    const mongoEnv: MongoEnv = {
      MONGODB_URI: env.MONGODB_URI,
      MONGODB_DB: env.MONGODB_DB,
    };
    return {
      env: mongoEnv,
      meta: {
        configured: true,
        source: 'env',
        hint: '',
        db: resolveMongoDbName(mongoEnv, dbHint),
      },
    };
  }

  return {
    env: {},
    meta: {
      configured: false,
      source: 'none',
      hint: '',
      db: resolveMongoDbName(env, dbHint),
    },
  };
}

type Variables = {
  inviteClave?: string;
  agenteId?: string;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const ID_RE = /^[a-z0-9][a-z0-9-]{0,60}$/;

/** Acepta proyecto | proyectoId | proyecto_id (query o body) → un solo string. */
function pickProyectoId(...raws: unknown[]): string {
  for (const raw of raws) {
    const s = String(raw ?? '').trim();
    if (s) return s;
  }
  return '';
}

function nowIso() {
  return new Date().toISOString();
}

function todayIso() {
  return nowIso().slice(0, 10);
}

function jsonError(
  c: { json: (b: unknown, s?: number) => Response },
  status: number,
  error: string,
  extra?: Record<string, unknown>
) {
  // Keep `{ ok: false, error, … }` — no log-string wrappers. Caller must not put URI/password in body.
  return c.json({ ok: false, error, ...(extra || {}) }, status);
}

/** Mongo/driver failure → structured JSON body (scrubbed; never URI). */
function jsonMongoError(
  c: { json: (b: unknown, s?: number) => Response },
  status: number,
  err: unknown
) {
  return c.json(mongoDriverErrorBody(err), status);
}

function extractClave(c: { req: { header: (n: string) => string | undefined } }) {
  const auth = c.req.header('Authorization') || '';
  if (auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  return (c.req.header('X-Agente-Clave') || '').trim();
}

app.use('*', async (c, next) => {
  const ui = c.env.PUBLIC_UI_ORIGIN || 'https://campos-ancla.web-legal-es.workers.dev';
  const extra = (c.env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  // github.io solo durante el cutover; la UI primaria es Cloudflare (Workers Assets / Pages).
  const origins = new Set([
    ui,
    'https://frescofresco.github.io',
    'http://127.0.0.1:8787',
    'http://localhost:8787',
    ...extra,
  ]);
  const mw = cors({
    origin: (origin) => (origin && origins.has(origin) ? origin : ui),
    allowHeaders: ['Content-Type', 'Authorization', 'X-Agente-Clave'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  return mw(c, next);
});

app.get('/health', async (c) => {
  const resolved = await resolveRuntimeMongo(c.env);
  return c.json({
    ok: true,
    service: 'campos-ancla-api',
    mongo: mongoHealthLabel(resolved.env),
    /** Drift check: UI color picker needs GET/PUT `color` on catalog entities. */
    entityColor: true,
  });
});

/** Canonical agent contract (same markdown as UI Documentación → API). */
app.get('/v1/docs', (c) =>
  c.text(String(apiDocsMd), 200, {
    'Content-Type': 'text/markdown; charset=utf-8',
    'Cache-Control': 'public, max-age=60',
  })
);
/** Machine-readable index of agent-facing routes (sibling of /v1/docs). */
app.get('/v1/docs.json', (c) =>
  c.json(API_DOCS_INDEX, 200, {
    'Cache-Control': 'public, max-age=60',
  })
);
app.get('/docs', (c) => c.redirect('/v1/docs', 302));

/** Listado opcional de workflows n8n (secrets N8N_BASE_URL + N8N_API_KEY). */
app.get('/v1/integraciones/n8n/workflows', async (c) => {
  try {
    const out = await listN8nWorkflows(c.env);
    return c.json(out);
  } catch (err) {
    return jsonError(c, 502, err instanceof Error ? err.message : 'Error al consultar n8n.');
  }
});

/** Catálogo de ejecutores (Fase 1). Skill sin ejecutorId → implícito agente_externo. */
app.get('/v1/ejecutores', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT id, nombre, tipo, config_json, timeout_s, reintentos, espera_reintento_s,
            activo, version, color, created_at, updated_at
     FROM ejecutores ORDER BY nombre`
  ).all();
  const out = [];
  for (const raw of rows.results || []) {
    out.push(await hydrateEjecutor(c.env.DB, raw as EjecutorRow));
  }
  return c.json({ ok: true, id: 'ejecutores', nombre: 'Ejecutores', ejecutores: out });
});

app.get('/v1/ejecutores/:id', async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT id, nombre, tipo, config_json, timeout_s, reintentos, espera_reintento_s,
            activo, version, color, created_at, updated_at
     FROM ejecutores WHERE id = ?`
  )
    .bind(c.req.param('id'))
    .first<EjecutorRow>();
  if (!row) return jsonError(c, 404, 'Ejecutor no encontrado.');
  return c.json({ ok: true, ejecutor: await hydrateEjecutor(c.env.DB, row) });
});

/** Writes require a valid non-revoked invite key. */
app.use('/v1/*', async (c, next) => {
  if (c.req.method === 'GET' || c.req.method === 'OPTIONS' || c.req.method === 'HEAD') {
    return next();
  }
  // Public agent self-registration / heartbeat use body.clave instead.
  // Webhook de disparador: autenticado por token en la URL (404 si no coincide).
  const path = new URL(c.req.url).pathname;
  if (
    path === '/v1/agentes/registro' ||
    path === '/v1/agentes/latido' ||
    path === '/v1/invites' ||
    path.startsWith('/v1/disparar/')
  ) {
    return next();
  }
  const clave = extractClave(c);
  if (!clave) return jsonError(c, 401, 'Falta AGENTE_CLAVE (Authorization: Bearer inv_… o X-Agente-Clave).');
  const inv = await c.env.DB.prepare('SELECT clave, revocada, usada_por FROM invites WHERE clave = ?')
    .bind(clave)
    .first<{ clave: string; revocada: number; usada_por: string | null }>();
  if (!inv || inv.revocada) return jsonError(c, 403, 'Invite inválida o revocada.');
  c.set('inviteClave', clave);
  if (inv.usada_por) c.set('agenteId', inv.usada_por);
  return next();
});

/** Public catalog reads — no auth. */
app.get('/v1/skills', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT id, nombre, descripcion, hash, color, ejecutor_id, created_at, updated_at FROM skills ORDER BY nombre'
  ).all();
  const out = [];
  for (const row of rows.results || []) {
    out.push(await hydrateSkill(c.env.DB, row as Record<string, unknown>));
  }
  return c.json({ ok: true, id: 'skills', nombre: 'Skills', instrucciones: out });
});

app.get('/v1/skills/:id', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare(
    'SELECT id, nombre, descripcion, hash, color, ejecutor_id, created_at, updated_at FROM skills WHERE id = ?'
  )
    .bind(id)
    .first();
  if (!row) return jsonError(c, 404, 'Skill no encontrada.');
  return c.json({ ok: true, skill: await hydrateSkill(c.env.DB, row as Record<string, unknown>) });
});

/**
 * Lee valores de las anclas de entrada de una skill desde Mongo (vía Campo Mongo / clave_mongo).
 * GET público (lectura de catálogo + datos del negocio). Query: negocio=<id>
 * → { ok, skill, negocio, valores: { "_ancla_": valor } }
 */
app.get('/v1/ejecutar/:skillId/entradas', async (c) => {
  const skillId = c.req.param('skillId');
  const negocio = String(c.req.query('negocio') || '').trim();
  if (!negocio) return jsonError(c, 400, 'Falta query negocio.');
  if (!ID_RE.test(negocio)) return jsonError(c, 400, 'negocio inválido.');
  const corridaIdQ = String(c.req.query('corrida_id') || '').trim();
  let datosCorrida: Record<string, unknown> = {};
  if (corridaIdQ) {
    const loaded = await loadCorridaDoc(c.env, corridaIdQ);
    if (loaded.ok) datosCorrida = loaded.doc.datos || {};
  }
  const row = await c.env.DB.prepare('SELECT * FROM skills WHERE id = ?').bind(skillId).first();
  if (!row) return jsonError(c, 404, 'Skill no encontrada.');
  const skill = await hydrateSkill(c.env.DB, row as Record<string, unknown>);
  const entradas = (skill.entradas as string[]) || [];
  // Preferir valores ya en corrida.datos
  if (Object.keys(datosCorrida).length) {
    const fromCorrida = await resolveEntradasValores(c.env, entradas, negocio, datosCorrida);
    const maps = await loadAnclaMongoMaps(c.env.DB, entradas);
    const baseDatos =
      maps.find((m) => m.baseDatos)?.baseDatos || (await catalogMongoDbHint(c.env.DB)) || 'software_reservas';
    const proyectoId = await proyectoIdForBaseDatos(c.env.DB, baseDatos);
    const resolved = await resolveRuntimeMongo(c.env, baseDatos, proyectoId || undefined);
    return c.json({
      ok: true,
      skill: skillId,
      negocio,
      corrida_id: corridaIdQ || null,
      valores: fromCorrida,
      mongo: {
        configured: resolved.meta.configured,
        db: resolved.meta.db,
        source: resolved.meta.source,
      },
    });
  }
  const maps = await loadAnclaMongoMaps(c.env.DB, entradas);
  const baseDatos =
    maps.find((m) => m.baseDatos)?.baseDatos || (await catalogMongoDbHint(c.env.DB)) || 'software_reservas';
  const proyectoId = await proyectoIdForBaseDatos(c.env.DB, baseDatos);
  const resolved = await resolveRuntimeMongo(c.env, baseDatos, proyectoId || undefined);
  const valores: Record<string, unknown> = {};
  for (const a of entradas) valores[a] = null;

  if (mongoUriConfigured(resolved.env) && maps.length) {
    try {
      await withMongoDb(
        resolved.env,
        async (db) => {
          const docCache = new Map<string, Record<string, unknown> | null>();
          for (const m of maps) {
            const cacheKey = m.coleccion + '|' + m.baseDatos;
            if (!docCache.has(cacheKey)) {
              docCache.set(cacheKey, await findDocForCorrida(db, m.coleccion, negocio, datosCorrida));
            }
            const doc = docCache.get(cacheKey);
            if (!doc) continue;
            const v = getByPath(doc, m.claveMongo);
            if (v !== undefined) valores[m.ancla] = v;
          }
        },
        baseDatos
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'lectura Mongo falló';
      if (msg !== 'configure MONGODB_URI') {
        const scrubbed = msg.replace(/mongodb(\+srv)?:\/\/[^\s'"]+/gi, 'mongodb://***');
        return jsonError(c, 502, scrubbed);
      }
    }
  }

  // Fallback D1 ancla_valores_negocio si Mongo no tiene valor
  for (const m of maps) {
    if (valores[m.ancla] != null && valores[m.ancla] !== '') continue;
    const vals = await loadValoresNegocio(c.env.DB, negocio, m.id, { mask: false });
    if (vals.valorActual) valores[m.ancla] = vals.valorActual;
  }

  return c.json({
    ok: true,
    skill: skillId,
    negocio,
    valores,
    mongo: {
      configured: resolved.meta.configured,
      db: resolved.meta.db,
      source: resolved.meta.source,
    },
  });
});

/**
 * Escribe valores en las anclas de salida de una skill → Mongo.
 * Auth: Bearer inv_…  Body: { negocio, valores: { "_ancla_": valor }, corrida_id?, nodo_id? }
 * Con corrida_id + nodo_id: además copia a corrida.datos, marca paso hecho y avanza el flujo.
 * Sin corrida_id: comportamiento previo (sin romper).
 * 400 si alguna ancla no está en salidas de la skill.
 */
app.post('/v1/ejecutar/:skillId/salidas', async (c) => {
  const skillId = c.req.param('skillId');
  const body = (await c.req.json().catch(() => ({}))) as {
    negocio?: string;
    negocio_id?: string;
    valores?: Record<string, unknown>;
    corrida_id?: string;
    nodo_id?: string;
    documento_id?: string;
    coleccion?: string;
  };
  const negocio = String(body.negocio || body.negocio_id || '').trim();
  if (!negocio) return jsonError(c, 400, 'Falta negocio.');
  if (!ID_RE.test(negocio)) return jsonError(c, 400, 'negocio inválido.');
  const valoresIn = body.valores && typeof body.valores === 'object' ? body.valores : null;
  if (!valoresIn) return jsonError(c, 400, 'Falta valores.');

  const corridaId = String(body.corrida_id || '').trim();
  const nodoId = String(body.nodo_id || '').trim();
  if (corridaId && !nodoId) return jsonError(c, 400, 'Con corrida_id hace falta nodo_id.');
  if (nodoId && !corridaId) return jsonError(c, 400, 'Con nodo_id hace falta corrida_id.');

  const row = await c.env.DB.prepare('SELECT * FROM skills WHERE id = ?').bind(skillId).first();
  if (!row) return jsonError(c, 404, 'Skill no encontrada.');
  const skill = await hydrateSkill(c.env.DB, row as Record<string, unknown>);
  const salidas = new Set((skill.salidas as string[]) || []);
  const keys = Object.keys(valoresIn).map((k) => normalizeAnclaKey(k));
  const invalidas = keys.filter((a) => a && !salidas.has(a));
  if (invalidas.length) {
    return c.json(
      {
        ok: false,
        error: 'Ancla(s) no están en salidas de esta skill.',
        invalidas,
        salidas: [...salidas],
      },
      400
    );
  }

  const normalizedValores: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(valoresIn)) {
    const a = normalizeAnclaKey(k);
    if (a) normalizedValores[a] = v;
  }

  let corridaCtx: { doc: CorridaDoc; flujo: FlujoVersionDoc } | null = null;
  if (corridaId) {
    const loaded = await loadCorridaWithFlujo(c.env, corridaId);
    if (!loaded.ok) return jsonError(c, loaded.status, loaded.error);
    const { doc, flujo } = loaded;
    if (doc.negocio !== negocio) {
      return jsonError(c, 400, 'negocio no coincide con la corrida.', {
        corrida_negocio: doc.negocio,
      });
    }
    if (isTerminal(doc.estado)) {
      return jsonError(c, 409, `Corrida en estado ${doc.estado}; no acepta salidas.`);
    }
    if (doc.paso_actual !== nodoId) {
      return jsonError(c, 409, 'nodo_id no es el paso_actual de la corrida.', {
        paso_actual: doc.paso_actual,
        nodo_id: nodoId,
      });
    }
    const nodo = findNodo(flujo.nodos, nodoId);
    if (!nodo || nodo.tipo !== 'skill' || nodo.skill !== skillId) {
      return jsonError(c, 409, 'El nodo actual no es esta skill.', {
        nodo: nodo ? { id: nodo.id, tipo: nodo.tipo, skill: nodo.skill } : null,
        skill: skillId,
      });
    }
    corridaCtx = { doc, flujo };
  }

  const maps = await loadAnclaMongoMaps(c.env.DB, keys);
  const baseDatos =
    maps.find((m) => m.baseDatos)?.baseDatos ||
    (corridaCtx
      ? (await loadProyectoBaseDatos(c.env.DB, corridaCtx.doc.proyecto_id)) || 'software_reservas'
      : (await catalogMongoDbHint(c.env.DB)) || 'software_reservas');
  const proyectoId =
    corridaCtx?.doc.proyecto_id || (await proyectoIdForBaseDatos(c.env.DB, baseDatos));
  const resolved = await resolveRuntimeMongo(c.env, baseDatos, proyectoId || undefined);
  if (!mongoUriConfigured(resolved.env)) {
    return c.json(mongoNotConfiguredError(), 503);
  }

  const datosWrite = corridaCtx ? corridaCtx.doc.datos || {} : {};
  if (body.documento_id && body.coleccion) {
    setDocumentoActivo(datosWrite, String(body.coleccion).trim(), String(body.documento_id).trim());
  }
  let escritos: string[] = [];
  try {
    escritos = await writeSkillSalidasToMongo(
      c.env,
      skillId,
      negocio,
      normalizedValores,
      corridaId || null,
      datosWrite,
      { documentoId: body.documento_id ? String(body.documento_id).trim() : null }
    );
    if (corridaCtx) {
      corridaCtx.doc.datos = {
        ...(corridaCtx.doc.datos || {}),
        ...datosWrite,
      };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'escritura Mongo falló';
    if (msg === 'configure MONGODB_URI') return c.json(mongoNotConfiguredError(), 503);
    const scrubbed = msg.replace(/mongodb(\+srv)?:\/\/[^\s'"]+/gi, 'mongodb://***');
    if (corridaCtx) {
      await failCorrida(c.env, corridaCtx.doc, nodoId, scrubbed);
    }
    return jsonError(c, 502, scrubbed);
  }

  const ts = nowIso();
  for (const m of maps) {
    if (!(m.ancla in normalizedValores)) continue;
    const val = normalizedValores[m.ancla];
    const asStr = val == null ? '' : typeof val === 'string' ? val : JSON.stringify(val);
    await c.env.DB.prepare(
      `INSERT INTO ancla_valores_negocio (negocio_id, ancla_id, observaciones, valor_actual, updated_at)
       VALUES (?, ?, '[]', ?, ?)
       ON CONFLICT(negocio_id, ancla_id) DO UPDATE SET valor_actual = excluded.valor_actual, updated_at = excluded.updated_at`
    )
      .bind(negocio, m.id, asStr, ts)
      .run()
      .catch(() => undefined);
  }

  let corridaOut: ReturnType<typeof publicCorrida> | null = null;
  if (corridaCtx) {
    try {
      // Fase 2: /salidas encola el siguiente nodo (motor); sin cola → avance síncrono legado.
      let advanced: CorridaDoc;
      if (c.env.PASOS) {
        advanced = await afterExternalSalidas(
          pasosMotorDeps(c.env),
          corridaCtx.doc,
          corridaCtx.flujo,
          nodoId,
          normalizedValores
        );
        await logEjecucion(pasosMotorDeps(c.env), advanced.proyecto_id, {
          skill: skillId,
          ejecutor_id: null,
          ejecutor_version: null,
          prompt_version: null,
          entradas: null,
          salidas: normalizedValores,
          duracion_ms: 0,
          coste: null,
          estado: 'ok',
          corrida_id: advanced._id,
        });
      } else {
        advanced = await advanceCorridaAfterSkill(
          c.env,
          corridaCtx.doc,
          corridaCtx.flujo,
          nodoId,
          normalizedValores,
          ts
        );
      }
      corridaOut = publicCorrida(advanced);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'avance de corrida falló';
      await failCorrida(c.env, corridaCtx.doc, nodoId, msg);
      return jsonError(c, 502, msg);
    }
  }

  return c.json({
    ok: true,
    skill: skillId,
    negocio,
    escritos,
    ...(corridaOut ? { corrida: corridaOut } : {}),
  });
});

/** Flujos versionados (D1). */
app.get('/v1/flujos', async (c) => {
  const proyecto = pickProyectoId(
    c.req.query('proyecto'),
    c.req.query('proyectoId'),
    c.req.query('proyecto_id')
  );
  let sql = 'SELECT id, nombre, descripcion, proyecto_id, hash, color, created_at, updated_at FROM flujos';
  const binds: string[] = [];
  if (proyecto) {
    sql += ' WHERE proyecto_id = ?';
    binds.push(proyecto);
  }
  sql += ' ORDER BY nombre';
  const rows = binds.length
    ? await c.env.DB.prepare(sql).bind(...binds).all()
    : await c.env.DB.prepare(sql).all();
  const out = [];
  for (const row of rows.results || []) {
    out.push(await hydrateFlujoListItem(c.env.DB, row as Record<string, unknown>));
  }
  return c.json({ ok: true, id: 'flujos', nombre: 'Flujos', flujos: out });
});

app.get('/v1/flujos/:id', async (c) => {
  const id = c.req.param('id');
  const versionQ = String(c.req.query('version') || '').trim();
  const versionNum = versionQ ? Number(versionQ) : undefined;
  const flujo = await loadFlujoVersion(
    c.env.DB,
    id,
    Number.isFinite(versionNum) && (versionNum as number) > 0 ? (versionNum as number) : undefined
  );
  if (!flujo) return jsonError(c, 404, 'Flujo no encontrado.');
  const versiones = await listFlujoVersions(c.env.DB, id);
  return c.json({
    ok: true,
    flujo: {
      ...flujo,
      mermaid: flujoToMermaid(flujo.nodos, flujo.aristas),
      versiones,
    },
  });
});

app.post('/v1/flujos', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    id?: string;
    nombre?: string;
    descripcion?: string;
    proyecto_id?: string;
    proyectoId?: string;
    proyecto?: string;
    nodos?: unknown;
    aristas?: unknown;
  };
  const id = String(body.id || '').trim();
  const nombre = String(body.nombre || '').trim();
  const proyectoId = pickProyectoId(body.proyectoId, body.proyecto_id, body.proyecto);
  if (!id || !ID_RE.test(id)) return jsonError(c, 400, 'id inválido.');
  if (!nombre) return jsonError(c, 400, 'Falta nombre.');
  if (!proyectoId || !ID_RE.test(proyectoId)) return jsonError(c, 400, 'proyectoId inválido.');
  const proy = await c.env.DB.prepare('SELECT id FROM proyectos WHERE id = ?').bind(proyectoId).first();
  if (!proy) return jsonError(c, 404, 'Proyecto no encontrado.');
  const exists = await c.env.DB.prepare('SELECT id FROM flujos WHERE id = ?').bind(id).first();
  if (exists) return jsonError(c, 409, 'Ya existe un flujo con ese id.');
  const nodos = parseNodos(body.nodos);
  const aristas = parseAristas(body.aristas);
  if (!nodos.length) return jsonError(c, 400, 'Falta nodos[].');
  const ts = nowIso();
  const hash = `flujo-${id}-v1`;
  await c.env.DB.prepare(
    `INSERT INTO flujos (id, nombre, descripcion, proyecto_id, hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, nombre, String(body.descripcion || ''), proyectoId, hash, ts, ts)
    .run();
  await c.env.DB.prepare(
    `INSERT INTO flujo_versions (flujo_id, numero, fecha, nodos_json, aristas_json, hash)
     VALUES (?, 1, ?, ?, ?, ?)`
  )
    .bind(id, todayIso(), JSON.stringify(nodos), JSON.stringify(aristas), hash)
    .run();
  const flujo = await loadFlujoVersion(c.env.DB, id);
  const versiones = await listFlujoVersions(c.env.DB, id);
  return c.json(
    {
      ok: true,
      flujo: flujo
        ? { ...flujo, mermaid: flujoToMermaid(flujo.nodos, flujo.aristas), versiones }
        : null,
    },
    201
  );
});

/** Nueva versión de un flujo (nodos/aristas). Body: { nombre?, descripcion?, nodos[], aristas[] } */
app.put('/v1/flujos/:id', async (c) => {
  const id = c.req.param('id');
  const meta = await c.env.DB.prepare(
    'SELECT id, nombre, descripcion, proyecto_id, color FROM flujos WHERE id = ?'
  )
    .bind(id)
    .first<{ id: string; nombre: string; descripcion: string; proyecto_id: string; color: string | null }>();
  if (!meta) return jsonError(c, 404, 'Flujo no encontrado.');
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  {
    const colorOnly = await tryColorOnlyUpdate(c.env.DB, 'flujos', id, body, nowIso());
    if (colorOnly && 'error' in colorOnly) return jsonError(c, 400, colorOnly.error);
    if (colorOnly) {
      const flujo = await loadFlujoVersion(c.env.DB, id);
      const versiones = await listFlujoVersions(c.env.DB, id);
      return c.json({
        ok: true,
        flujo: flujo
          ? { ...flujo, mermaid: flujoToMermaid(flujo.nodos, flujo.aristas), versiones }
          : null,
      });
    }
  }
  const nodos = parseNodos(body.nodos);
  const aristas = parseAristas(body.aristas);
  if (!nodos.length) return jsonError(c, 400, 'Falta nodos[].');
  const nombre = body.nombre != null ? String(body.nombre).trim() : meta.nombre;
  const descripcion =
    body.descripcion != null ? String(body.descripcion) : meta.descripcion || '';
  if (!nombre) return jsonError(c, 400, 'Falta nombre.');
  const max = await c.env.DB.prepare(
    'SELECT COALESCE(MAX(numero), 0) AS m FROM flujo_versions WHERE flujo_id = ?'
  )
    .bind(id)
    .first<{ m: number }>();
  const numero = (max?.m || 0) + 1;
  const ts = nowIso();
  const hash = `flujo-${id}-v${numero}`;
  let colorVal: string | null = meta.color || null;
  if (bodyHasColor(body)) {
    const parsed = parseEntityColor(body.color);
    if (!parsed.ok) return jsonError(c, 400, parsed.error);
    colorVal = parsed.color;
  }
  await c.env.DB.prepare(
    `UPDATE flujos SET nombre = ?, descripcion = ?, hash = ?, updated_at = ?, color = ? WHERE id = ?`
  )
    .bind(nombre, descripcion, hash, ts, colorVal, id)
    .run();
  await c.env.DB.prepare(
    `INSERT INTO flujo_versions (flujo_id, numero, fecha, nodos_json, aristas_json, hash)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(id, numero, todayIso(), JSON.stringify(nodos), JSON.stringify(aristas), hash)
    .run();
  const flujo = await loadFlujoVersion(c.env.DB, id);
  const versiones = await listFlujoVersions(c.env.DB, id);
  return c.json({
    ok: true,
    flujo: flujo
      ? { ...flujo, mermaid: flujoToMermaid(flujo.nodos, flujo.aristas), versiones }
      : null,
  });
});

/** Borrar flujo (+ versiones CASCADE). Índice D1 de corridas; Mongo best-effort. */
app.delete('/v1/flujos/:id', async (c) => {
  const id = c.req.param('id');
  const meta = await c.env.DB.prepare('SELECT id, proyecto_id FROM flujos WHERE id = ?')
    .bind(id)
    .first<{ id: string; proyecto_id: string }>();
  if (!meta) return jsonError(c, 404, 'Flujo no encontrado.');

  const idx = await c.env.DB.prepare('SELECT id FROM corridas_index WHERE flujo_id = ?')
    .bind(id)
    .all();
  const corridaIds = ((idx.results || []) as Array<{ id: string }>).map((r) => r.id);

  // Best-effort: borrar docs Mongo de esas corridas.
  if (corridaIds.length) {
    try {
      const mongo = await mongoForProyecto(c.env, meta.proyecto_id);
      if (mongo) {
        await withMongoDb(
          mongo.env,
          async (db) => {
            await db.collection('corridas').deleteMany({ _id: { $in: corridaIds } });
          },
          mongo.dbName
        );
      }
    } catch {
      /* índice + flujo se limpian igual */
    }
  }

  await c.env.DB.prepare('DELETE FROM corridas_index WHERE flujo_id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM flujos WHERE id = ?').bind(id).run();
  return c.json({ ok: true, deleted: id, corridasDeleted: corridaIds.length });
});

/* ——— Disparadores (Fase 1: CRUD D1; motor de disparo = Fase 2) ——— */

app.get('/v1/flujos/:id/disparadores', async (c) => {
  const flujoId = c.req.param('id');
  const flujo = await c.env.DB.prepare('SELECT id FROM flujos WHERE id = ?').bind(flujoId).first();
  if (!flujo) return jsonError(c, 404, 'Flujo no encontrado.');
  const rows = await c.env.DB.prepare(
    'SELECT * FROM disparadores WHERE flujo_id = ? ORDER BY creado'
  )
    .bind(flujoId)
    .all();
  const disparadores = ((rows.results || []) as Record<string, unknown>[]).map((r) =>
    publicDisparador(rowToDisparador(r))
  );
  return c.json({ ok: true, flujo_id: flujoId, disparadores });
});

app.post('/v1/flujos/:id/disparadores', async (c) => {
  const flujoId = c.req.param('id');
  const flujo = await c.env.DB.prepare('SELECT id, proyecto_id FROM flujos WHERE id = ?')
    .bind(flujoId)
    .first<{ id: string; proyecto_id: string }>();
  if (!flujo) return jsonError(c, 404, 'Flujo no encontrado.');
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const id = String(body.id || '').trim();
  if (!id || !ID_RE.test(id)) return jsonError(c, 400, 'id inválido.');
  const exists = await c.env.DB.prepare('SELECT id FROM disparadores WHERE id = ?').bind(id).first();
  if (exists) return jsonError(c, 409, 'Ya existe un disparador con ese id.');

  const validated = validateDisparadorBody(body);
  if (!validated.ok) return jsonError(c, 400, validated.error);

  const colErr = await ensureColeccionMongo(c.env, flujo.proyecto_id, validated.value.coleccion);
  if (colErr) return jsonError(c, 400, colErr);

  const avisos = await avisosAnclasPipeline(c.env.DB, validated.value.pipeline);
  const ts = nowIso();
  const v = validated.value;
  await c.env.DB.prepare(
    `INSERT INTO disparadores (
      id, flujo_id, tipo, activo, cron, coleccion, operaciones_json, token, pipeline_json,
      anti_bucle, agrupar_segundos, negocio, version, creado, actualizado, ultima_vez
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, NULL)`
  )
    .bind(
      id,
      flujoId,
      v.tipo,
      v.activo ? 1 : 0,
      v.cron,
      v.coleccion,
      v.operaciones ? JSON.stringify(v.operaciones) : null,
      v.tipo === 'webhook' ? v.token : null,
      v.pipeline ? JSON.stringify(v.pipeline) : null,
      v.anti_bucle ? 1 : 0,
      v.agrupar_segundos,
      v.negocio || '',
      ts,
      ts
    )
    .run();

  const row = await c.env.DB.prepare('SELECT * FROM disparadores WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();
  return c.json(
    {
      ok: true,
      disparador: row ? publicDisparador(rowToDisparador(row)) : null,
      avisos,
    },
    201
  );
});

app.get('/v1/disparadores/:id', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT * FROM disparadores WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();
  if (!row) return jsonError(c, 404, 'Disparador no encontrado.');
  return c.json({ ok: true, disparador: publicDisparador(rowToDisparador(row)) });
});

app.put('/v1/disparadores/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT * FROM disparadores WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();
  if (!existing) return jsonError(c, 404, 'Disparador no encontrado.');
  const prev = rowToDisparador(existing);
  const flujo = await c.env.DB.prepare('SELECT id, proyecto_id FROM flujos WHERE id = ?')
    .bind(prev.flujo_id)
    .first<{ id: string; proyecto_id: string }>();
  if (!flujo) return jsonError(c, 404, 'Flujo del disparador no encontrado.');

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  // Merge defaults from existing so partial PUTs keep tipo-required fields if omitted.
  const merged: Record<string, unknown> = {
    tipo: body.tipo != null ? body.tipo : prev.tipo,
    activo: body.activo != null ? body.activo : prev.activo,
    cron: body.cron != null ? body.cron : prev.cron,
    coleccion: body.coleccion != null ? body.coleccion : prev.coleccion,
    operaciones: body.operaciones != null ? body.operaciones : prev.operaciones,
    pipeline: body.pipeline !== undefined ? body.pipeline : prev.pipeline,
    anti_bucle: body.anti_bucle != null ? body.anti_bucle : prev.anti_bucle,
    agrupar_segundos: body.agrupar_segundos != null ? body.agrupar_segundos : prev.agrupar_segundos,
    negocio: body.negocio != null ? body.negocio : prev.negocio,
    regenerar_token: body.regenerar_token ?? body.regenerarToken,
  };

  const validated = validateDisparadorBody(merged, {
    existingTipo: prev.tipo,
    existingToken: prev.token,
  });
  if (!validated.ok) return jsonError(c, 400, validated.error);

  const colErr = await ensureColeccionMongo(c.env, flujo.proyecto_id, validated.value.coleccion);
  if (colErr) return jsonError(c, 400, colErr);

  const avisos = await avisosAnclasPipeline(c.env.DB, validated.value.pipeline);
  const ts = nowIso();
  const nextVersion = (prev.version || 1) + 1;
  const v = validated.value;
  await c.env.DB.prepare(
    `UPDATE disparadores SET
      tipo = ?, activo = ?, cron = ?, coleccion = ?, operaciones_json = ?, token = ?,
      pipeline_json = ?, anti_bucle = ?, agrupar_segundos = ?, negocio = ?,
      version = ?, actualizado = ?
     WHERE id = ?`
  )
    .bind(
      v.tipo,
      v.activo ? 1 : 0,
      v.cron,
      v.coleccion,
      v.operaciones ? JSON.stringify(v.operaciones) : null,
      v.tipo === 'webhook' ? v.token : null,
      v.pipeline ? JSON.stringify(v.pipeline) : null,
      v.anti_bucle ? 1 : 0,
      v.agrupar_segundos,
      v.negocio || '',
      nextVersion,
      ts,
      id
    )
    .run();

  const row = await c.env.DB.prepare('SELECT * FROM disparadores WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();
  return c.json({
    ok: true,
    disparador: row ? publicDisparador(rowToDisparador(row)) : null,
    avisos,
  });
});

app.delete('/v1/disparadores/:id', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT id FROM disparadores WHERE id = ?').bind(id).first();
  if (!row) return jsonError(c, 404, 'Disparador no encontrado.');
  await c.env.DB.prepare('DELETE FROM disparadores WHERE id = ?').bind(id).run();
  return c.json({ ok: true, deleted: id });
});

app.post('/v1/disparadores/:id/activar', async (c) => {
  return setDisparadorActivo(c, true);
});

app.post('/v1/disparadores/:id/pausar', async (c) => {
  return setDisparadorActivo(c, false);
});

/**
 * Dry-run de pipeline (no crea corridas ni eventos).
 * Body: { flujo_id, tipo, coleccion?, pipeline?, disparador_id? }
 * También acepta id en path: POST /v1/disparadores/:id/probar (carga definición).
 */
app.post('/v1/flujos/:id/disparadores/probar', async (c) => {
  const flujoId = c.req.param('id');
  const flujo = await c.env.DB.prepare('SELECT id, proyecto_id FROM flujos WHERE id = ?')
    .bind(flujoId)
    .first<{ id: string; proyecto_id: string }>();
  if (!flujo) return jsonError(c, 404, 'Flujo no encontrado.');
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  return responderProbarDisparador(c, flujo.proyecto_id, body);
});

app.post('/v1/disparadores/:id/probar', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT * FROM disparadores WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();
  if (!row) return jsonError(c, 404, 'Disparador no encontrado.');
  const d = rowToDisparador(row);
  const flujo = await c.env.DB.prepare('SELECT proyecto_id FROM flujos WHERE id = ?')
    .bind(d.flujo_id)
    .first<{ proyecto_id: string }>();
  if (!flujo) return jsonError(c, 404, 'Flujo del disparador no encontrado.');
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const merged = {
    tipo: body.tipo != null ? body.tipo : d.tipo,
    coleccion: body.coleccion !== undefined ? body.coleccion : d.coleccion,
    pipeline: body.pipeline !== undefined ? body.pipeline : d.pipeline,
    disparador_id: d.id,
  };
  return responderProbarDisparador(c, flujo.proyecto_id, merged);
});

/**
 * Contrato Redactor (público). Evita 404 si se abre GET en el navegador /
 * exploradores que asumen GET; la generación es POST + Bearer.
 */
app.get('/v1/redactor', (c) =>
  c.json({
    ok: true,
    skill: REDACTOR_SKILL_ID,
    method: 'POST',
    path: '/v1/redactor',
    auth: 'Authorization: Bearer inv_… (obligatorio en POST; sin Bearer → 401, no 404)',
    body: {
      intencion: 'string',
      tipo_definicion: 'disparador|flujo|pipeline',
      definicion_actual: 'object? (opcional)',
      origen: 'string? (panel-disparador|panel-flujo|api)',
    },
    response: {
      definicion: 'object|array',
      explicacion: 'string',
      validacion: { ok: 'boolean', errores: 'string[]', avisos: 'string[]' },
      modo: 'openai|mock',
      ejecucion_id: 'string?',
    },
    nota: 'Sin OPENAI_API_KEY responde mock heurístico + validación. La IA no guarda sola.',
  })
);

/**
 * Redactor — intención → definición JSON (skill generar-definicion).
 * Body: { intencion, tipo_definicion, definicion_actual?, origen? }
 * → { ok, definicion, explicacion, validacion, modo, ejecucion_id }
 * Sin OPENAI_API_KEY: mock heurístico + validación (no bloquea la fase).
 */
app.post('/v1/redactor', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const intencion = String(body.intencion || '').trim();
  const tipoRaw = String(body.tipo_definicion || body.tipo || '').trim();
  if (!intencion) return jsonError(c, 400, 'Falta intencion.');
  if (!isTipoDefinicion(tipoRaw)) {
    return jsonError(c, 400, 'tipo_definicion inválido (disparador|flujo|pipeline).');
  }
  const origen = String(body.origen || 'api').trim() || 'api';

  const [anclaRows, skillRows, flujoRows, campoRows] = await Promise.all([
    c.env.DB.prepare('SELECT ancla FROM anclas ORDER BY ancla').all(),
    c.env.DB.prepare('SELECT id FROM skills ORDER BY id').all(),
    c.env.DB.prepare('SELECT id FROM flujos ORDER BY id').all(),
    c.env.DB.prepare(
      "SELECT DISTINCT coleccion FROM campos_mongo WHERE coleccion IS NOT NULL AND coleccion != '' ORDER BY coleccion"
    ).all(),
  ]);
  const contexto: RedactorContexto = {
    anclas: (anclaRows.results || []).map((r) => String((r as { ancla: string }).ancla)),
    skills: (skillRows.results || []).map((r) => String((r as { id: string }).id)),
    flujos: (flujoRows.results || []).map((r) => String((r as { id: string }).id)),
    colecciones: (campoRows.results || []).map((r) => String((r as { coleccion: string }).coleccion)),
  };
  if (!contexto.colecciones.length) {
    contexto.colecciones = ['negocios', 'reservas', 'procesos', 'versiones', 'ejecuciones'];
  }

  // Fase 2: si la skill generar-definicion tiene ejecutor modelo, usar su secret/modelo.
  let openaiKey = c.env.OPENAI_API_KEY;
  let openaiModel = c.env.OPENAI_MODEL;
  let redactorEj: Awaited<ReturnType<typeof loadEjecutorForSkill>> | null = null;
  try {
    const skillEj = await c.env.DB.prepare(
      'SELECT ejecutor_id FROM skills WHERE id = ?'
    )
      .bind(REDACTOR_SKILL_ID)
      .first<{ ejecutor_id: string | null }>();
    redactorEj = await loadEjecutorForSkill(c.env.DB, skillEj || {});
    if (redactorEj.tipo === 'modelo') {
      const secretName = String(redactorEj.config.secret || 'OPENAI_API_KEY');
      const fromSecret = (c.env as Record<string, unknown>)[secretName];
      if (typeof fromSecret === 'string' && fromSecret.trim()) openaiKey = fromSecret.trim();
      if (redactorEj.config.modelo) openaiModel = String(redactorEj.config.modelo);
    }
  } catch {
    /* keep env defaults */
  }

  const result = await generarDefinicion({
    intencion,
    tipo: tipoRaw,
    contexto,
    definicionActual: body.definicion_actual !== undefined ? body.definicion_actual : body.definicionActual,
    openaiKey,
    openaiModel,
  });

  const entrada = {
    intencion,
    tipo_definicion: tipoRaw,
    esquema: esquemaParaTipo(tipoRaw),
    contexto,
    definicion_actual: body.definicion_actual ?? body.definicionActual ?? null,
  };
  const salida = {
    definicion: result.definicion,
    explicacion: result.explicacion,
    validacion: result.validacion,
    modo: result.modo,
    modelo: result.modelo || null,
  };

  let ejecucionId: string | null = null;
  try {
    ejecucionId = await registrarEjecucionSkill(c.env.DB, entrada, salida, {
      modo: result.modo,
      ok: result.validacion.ok,
      origen,
    });
  } catch (err) {
    console.warn('skill_ejecuciones insert failed', err instanceof Error ? err.message : err);
  }

  // Fase 2: también en Mongo `ejecuciones` (haya o no corrida).
  try {
    const proy = await defaultProyectoIdForLogs(c.env);
    const mongoId = await logEjecucion(pasosMotorDeps(c.env), proy, {
      skill: REDACTOR_SKILL_ID,
      ejecutor_id: redactorEj && redactorEj.tipo === 'modelo' ? redactorEj.id : null,
      ejecutor_version: redactorEj && redactorEj.tipo === 'modelo' ? redactorEj.version : null,
      prompt_version: null,
      entradas: entrada as Record<string, unknown>,
      salidas: salida as Record<string, unknown>,
      duracion_ms: 0,
      coste: null,
      estado: result.validacion.ok ? 'ok' : 'error',
      corrida_id: null,
      origen,
      modo: result.modo,
    });
    if (mongoId) ejecucionId = ejecucionId || mongoId;
  } catch (err) {
    console.warn('ejecuciones mongo insert failed', err instanceof Error ? err.message : err);
  }

  return c.json({
    ok: true,
    skill: REDACTOR_SKILL_ID,
    definicion: result.definicion,
    explicacion: result.explicacion,
    validacion: result.validacion,
    modo: result.modo,
    modelo: result.modelo || null,
    ejecucion_id: ejecucionId,
    nota:
      result.modo === 'mock'
        ? 'Sin OPENAI_API_KEY (wrangler secret put OPENAI_API_KEY). Mock heurístico + validación.'
        : undefined,
  });
});

app.get('/v1/skills/:id/ejecuciones', async (c) => {
  const skillId = c.req.param('id');
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') || 20) || 20));
  const proyectoId =
    String(c.req.query('proyecto') || c.req.query('proyectoId') || '').trim() ||
    (await defaultProyectoIdForLogs(c.env));

  const d1: Array<Record<string, unknown>> = [];
  try {
    const rows = await c.env.DB.prepare(
      'SELECT id, skill_id, origen, modo, ok, entrada_json, salida_json, creado FROM skill_ejecuciones WHERE skill_id = ? ORDER BY creado DESC LIMIT ?'
    )
      .bind(skillId, limit)
      .all();
    for (const r of rows.results || []) {
      const row = r as Record<string, unknown>;
      let entrada: unknown = {};
      let salida: unknown = {};
      try {
        entrada = JSON.parse(String(row.entrada_json || '{}'));
      } catch {
        /* ignore */
      }
      try {
        salida = JSON.parse(String(row.salida_json || '{}'));
      } catch {
        /* ignore */
      }
      d1.push({
        id: row.id,
        skill: row.skill_id,
        skill_id: row.skill_id,
        origen: row.origen,
        modo: row.modo,
        ok: Number(row.ok) === 1,
        estado: Number(row.ok) === 1 ? 'ok' : 'error',
        entradas: entrada,
        salidas: salida,
        entrada,
        salida,
        fuente: 'd1',
        creado: row.creado,
      });
    }
  } catch {
    /* tabla ausente */
  }

  const mongo = await listEjecucionesMongo(
    pasosMotorDeps(c.env),
    proyectoId,
    { skill: skillId },
    limit
  ).catch(() => [] as Array<Record<string, unknown>>);

  const byId = new Map<string, Record<string, unknown>>();
  for (const e of d1) byId.set(String(e.id), e);
  for (const e of mongo) {
    const id = String(e.id);
    if (!byId.has(id)) byId.set(id, { ...e, fuente: 'mongo' });
  }
  const ejecuciones = [...byId.values()]
    .sort((a, b) => String(b.creado || '').localeCompare(String(a.creado || '')))
    .slice(0, limit);

  return c.json({
    ok: true,
    skill_id: skillId,
    proyectoId,
    ejecuciones,
  });
});

app.get('/v1/ejecutores/:id/ejecuciones', async (c) => {
  const ejecutorId = c.req.param('id');
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') || 20) || 20));
  const row = await c.env.DB.prepare('SELECT id FROM ejecutores WHERE id = ?')
    .bind(ejecutorId)
    .first();
  if (!row) return jsonError(c, 404, 'Ejecutor no encontrado.');
  const proyectoId =
    String(c.req.query('proyecto') || c.req.query('proyectoId') || '').trim() ||
    (await defaultProyectoIdForLogs(c.env));
  const ejecuciones = await listEjecucionesMongo(
    pasosMotorDeps(c.env),
    proyectoId,
    { ejecutor_id: ejecutorId },
    limit
  );
  return c.json({
    ok: true,
    ejecutor_id: ejecutorId,
    proyectoId,
    ejecuciones,
  });
});

/** Ops/smoke: ejecuta el tick horario ahora (mismo código que el Cron Trigger CF). */
app.post('/v1/interno/horario-tick', async (c) => {
  try {
    const r = await runHorarioTick(
      async (proyectoId, fn) => {
        const mongo = await mongoForProyecto(c.env, proyectoId);
        if (!mongo) return null;
        return withMongoDb(mongo.env, fn, mongo.dbName);
      },
      motorDeps(c.env)
    );
    return c.json({ ok: true, ...r });
  } catch (err) {
    return jsonError(c, 502, err instanceof Error ? err.message : 'tick falló');
  }
});

/** Ops/smoke: marca corridas en_curso sin lease y sin actividad → atascada (Fase 3).
 * Body opcional: { stale_ms? | atascada_ms? } para override (p. ej. pruebas). */
app.post('/v1/interno/corridas-stale-tick', async (c) => {
  try {
    const body = (await c.req.json().catch(() => ({}))) as {
      stale_ms?: number;
      atascada_ms?: number;
    };
    const override =
      body.atascada_ms != null && Number.isFinite(Number(body.atascada_ms))
        ? Number(body.atascada_ms)
        : body.stale_ms != null && Number.isFinite(Number(body.stale_ms))
          ? Number(body.stale_ms)
          : undefined;
    const r = await runAtascadasTick(pasosMotorDeps(c.env), new Date(), override);
    return c.json({ ok: true, ...r });
  } catch (err) {
    return jsonError(c, 502, err instanceof Error ? err.message : 'atascadas tick falló');
  }
});

/** Ops: timeout de pasos en esperando_integracion (lease_hasta vencido). */
app.post('/v1/interno/corridas-timeout-tick', async (c) => {
  try {
    const r = await runEsperandoTimeoutTick(pasosMotorDeps(c.env), new Date());
    return c.json({ ok: true, ...r });
  } catch (err) {
    return jsonError(c, 502, err instanceof Error ? err.message : 'timeout tick falló');
  }
});

/** Alias explícito del tick de atascadas. */
app.post('/v1/interno/corridas-atascadas-tick', async (c) => {
  try {
    const body = (await c.req.json().catch(() => ({}))) as { atascada_ms?: number };
    const override =
      body.atascada_ms != null && Number.isFinite(Number(body.atascada_ms))
        ? Number(body.atascada_ms)
        : undefined;
    const r = await runAtascadasTick(pasosMotorDeps(c.env), new Date(), override);
    return c.json({ ok: true, ...r });
  } catch (err) {
    return jsonError(c, 502, err instanceof Error ? err.message : 'atascadas tick falló');
  }
});

/**
 * Ops/smoke: deja una corrida en `en_curso` sin lease y con `actualizada` atrasada
 * para que el tick de atascadas la recoja (p. ej. c-df817b30ebdc4cfe).
 * Body: { hace_ms?: number } default 15 min.
 */
app.post('/v1/interno/corridas/:id/preparar-atascada', async (c) => {
  const loaded = await loadCorridaWithFlujo(c.env, c.req.param('id'));
  if (!loaded.ok) return jsonError(c, loaded.status, loaded.error);
  const body = (await c.req.json().catch(() => ({}))) as { hace_ms?: number };
  const hace =
    body.hace_ms != null && Number.isFinite(Number(body.hace_ms)) && Number(body.hace_ms) >= 60_000
      ? Number(body.hace_ms)
      : 15 * 60 * 1000;
  const doc = loaded.doc;
  const actualizada = new Date(Date.now() - hace).toISOString();
  const mongo = await mongoForProyecto(c.env, doc.proyecto_id);
  if (!mongo) return jsonError(c, 503, 'configure MONGODB_URI');
  await withMongoDb(
    mongo.env,
    async (db) => {
      await db.collection('corridas').updateOne(
        { _id: doc._id },
        { $set: { estado: 'en_curso', actualizada } }
      );
    },
    mongo.dbName
  );
  await c.env.DB.prepare(
    `UPDATE corridas_index SET estado = 'en_curso', updated_at = ?, lease_hasta = NULL, lease_nodo_id = NULL WHERE id = ?`
  )
    .bind(actualizada, doc._id)
    .run();
  return c.json({
    ok: true,
    corrida_id: doc._id,
    estado: 'en_curso',
    actualizada,
    nota: 'Llama POST /v1/interno/corridas-atascadas-tick',
  });
});

/**
 * Crea una corrida en Mongo `corridas` de la BD del proyecto del flujo.
 * Body: { flujo_id, negocio, datos_iniciales?, disparador_id? }
 */
app.post('/v1/corridas', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    flujo_id?: string;
    negocio?: string;
    negocio_id?: string;
    datos_iniciales?: Record<string, unknown>;
    disparador_id?: string;
    documento_id?: string;
    coleccion?: string;
  };
  const flujoId = String(body.flujo_id || '').trim();
  const negocio = String(body.negocio || body.negocio_id || '').trim();
  if (!flujoId) return jsonError(c, 400, 'Falta flujo_id.');
  if (!negocio || !ID_RE.test(negocio)) return jsonError(c, 400, 'negocio inválido.');
  const flujo = await loadFlujoVersion(c.env.DB, flujoId);
  if (!flujo) return jsonError(c, 404, 'Flujo no encontrado.');

  let disparadorId: string | null = String(body.disparador_id || '').trim() || null;
  if (disparadorId) {
    const drow = await c.env.DB.prepare('SELECT * FROM disparadores WHERE id = ?')
      .bind(disparadorId)
      .first<Record<string, unknown>>();
    if (!drow) return jsonError(c, 404, 'Disparador no encontrado.');
    const d = rowToDisparador(drow);
    if (d.flujo_id !== flujoId) {
      return jsonError(c, 400, 'disparador_id no pertenece a este flujo.');
    }
  }

  const datos: Record<string, unknown> = {};
  if (body.datos_iniciales && typeof body.datos_iniciales === 'object') {
    for (const [k, v] of Object.entries(body.datos_iniciales)) {
      const a = normalizeAnclaKey(k);
      if (a) datos[a] = v;
      else datos[k] = v;
    }
  }
  // Identidad documento 1:N
  if (datos._documentos_ && typeof datos._documentos_ === 'object') {
    /* keep from datos_iniciales */
  }
  const coleccion = String(body.coleccion || '').trim();
  const documentoId = String(body.documento_id || '').trim();
  if (coleccion && documentoId) {
    setDocumentoActivo(datos, coleccion, documentoId);
  }

  try {
    const doc = await startCorridaForDisparo(c.env, {
      flujoId,
      negocio,
      datos,
      disparadorId: disparadorId || '',
      eventoId: '',
    });
    return c.json({ ok: true, corrida: publicCorrida(doc) }, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'No se pudo iniciar la corrida.';
    return jsonError(c, 502, msg);
  }
});

/**
 * Webhook de disparador. 404 si token incorrecto o pausado (sin detalles).
 * 202 { evento_id, corridas[] }
 */
app.post('/v1/disparar/:flujo/:token', async (c) => {
  const flujoId = c.req.param('flujo');
  const token = c.req.param('token');
  const row = await c.env.DB.prepare(
    `SELECT * FROM disparadores WHERE flujo_id = ? AND tipo = 'webhook' AND token = ?`
  )
    .bind(flujoId, token)
    .first<Record<string, unknown>>();
  if (!row) return jsonError(c, 404, 'No encontrado.');
  const d = rowToDisparador(row);
  if (!d.activo) return jsonError(c, 404, 'No encontrado.');

  const flujo = await c.env.DB.prepare('SELECT id, proyecto_id FROM flujos WHERE id = ?')
    .bind(flujoId)
    .first<{ id: string; proyecto_id: string }>();
  if (!flujo) return jsonError(c, 404, 'No encontrado.');

  const body = await c.req.json().catch(() => ({}));
  const headers: Record<string, string> = {};
  c.req.raw.headers.forEach((v, k) => {
    const lk = k.toLowerCase();
    if (lk === 'authorization' || lk === 'cookie') return;
    if (headers[lk] == null) headers[lk] = v;
  });
  const negocioBody =
    body && typeof body === 'object'
      ? String((body as Record<string, unknown>).negocio || (body as Record<string, unknown>).negocio_id || '').trim()
      : '';

  const mongo = await mongoForProyecto(c.env, flujo.proyecto_id);
  if (!mongo) return jsonError(c, 503, 'configure MONGODB_URI');

  try {
    const evento = await withMongoDb(
      mongo.env,
      async (db) =>
        emitWebhook(db, motorDeps(c.env), {
          disparador: d,
          proyectoId: flujo.proyecto_id,
          body,
          headers,
          negocio: negocioBody || undefined,
        }),
      mongo.dbName
    );
    const corridas: string[] = [];
    for (const r of evento.resultado || []) {
      if (r.corridas?.length) corridas.push(...r.corridas);
      else if (r.corrida_id) corridas.push(r.corrida_id);
    }
    return c.json({ ok: true, evento_id: evento._id, corridas }, 202);
  } catch (err) {
    return jsonMongoError(c, 502, err);
  }
});

/** Listar eventos recientes (smoke / depuración). */
app.get('/v1/eventos', async (c) => {
  const proyectoId =
    pickProyectoId(c.req.query('proyecto'), c.req.query('proyectoId'), c.req.query('proyecto_id')) ||
    'reservas';
  const coleccion = String(c.req.query('coleccion') || '').trim();
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') || 20) || 20));
  const mongo = await mongoForProyecto(c.env, proyectoId);
  if (!mongo) return jsonError(c, 503, 'configure MONGODB_URI');
  try {
    const eventos = await withMongoDb(
      mongo.env,
      async (db) => {
        await ensureEventosIndexes(db);
        const q: Record<string, unknown> = {};
        if (coleccion) q.coleccion = coleccion;
        const rows = await db
          .collection(EVENTOS_COLLECTION)
          .find(q)
          .sort({ creado: -1 })
          .limit(limit)
          .toArray();
        return rows.map((r) => publicEvento(r as unknown as EventoDoc));
      },
      mongo.dbName
    );
    return c.json({ ok: true, proyectoId, eventos });
  } catch (err) {
    return jsonMongoError(c, 502, err);
  }
});

app.get('/v1/corridas', async (c) => {
  const flujoId = String(c.req.query('flujo_id') || '').trim();
  const negocio = String(c.req.query('negocio') || '').trim();
  const estado = String(c.req.query('estado') || '').trim();
  const proyectoQ = pickProyectoId(c.req.query('proyecto'), c.req.query('proyectoId'), c.req.query('proyecto_id'));

  let sql = 'SELECT id, proyecto_id, flujo_id, negocio, estado, updated_at FROM corridas_index WHERE 1=1';
  const binds: string[] = [];
  if (flujoId) {
    sql += ' AND flujo_id = ?';
    binds.push(flujoId);
  }
  if (negocio) {
    sql += ' AND negocio = ?';
    binds.push(negocio);
  }
  if (estado) {
    sql += ' AND estado = ?';
    binds.push(estado);
  }
  if (proyectoQ) {
    sql += ' AND proyecto_id = ?';
    binds.push(proyectoQ);
  }
  sql += ' ORDER BY updated_at DESC LIMIT 100';
  const idx = binds.length
    ? await c.env.DB.prepare(sql).bind(...binds).all()
    : await c.env.DB.prepare(sql).all();
  const rows = (idx.results || []) as Array<{
    id: string;
    proyecto_id: string;
    flujo_id: string;
    negocio: string;
    estado: string;
    updated_at: string;
  }>;

  // Hidratar desde Mongo cuando sea posible; si falla, devolver índice.
  const byProyecto = new Map<string, string[]>();
  for (const r of rows) {
    const list = byProyecto.get(r.proyecto_id) || [];
    list.push(r.id);
    byProyecto.set(r.proyecto_id, list);
  }
  const docs = new Map<string, CorridaDoc>();
  for (const [proyId, ids] of byProyecto) {
    try {
      const mongo = await mongoForProyecto(c.env, proyId);
      if (!mongo) continue;
      await withMongoDb(
        mongo.env,
        async (db) => {
          const found = await db
            .collection('corridas')
            .find({ _id: { $in: ids } })
            .toArray();
          for (const f of found) {
            docs.set(String((f as CorridaDoc)._id), f as CorridaDoc);
          }
        },
        mongo.dbName
      );
    } catch {
      /* índice basta */
    }
  }

  const corridas = rows.map((r) => {
    const d = docs.get(r.id);
    return d
      ? publicCorrida(d)
      : {
          id: r.id,
          flujo_id: r.flujo_id,
          proyectoId: r.proyecto_id,
          negocio: r.negocio,
          estado: r.estado,
          actualizada: r.updated_at,
        };
  });
  return c.json({ ok: true, corridas });
});

app.get('/v1/corridas/:id', async (c) => {
  const id = c.req.param('id');
  const loaded = await loadCorridaWithFlujo(c.env, id);
  if (!loaded.ok) return jsonError(c, loaded.status, loaded.error);
  return c.json({ ok: true, corrida: publicCorrida(loaded.doc), flujo: loaded.flujo });
});

/** Borrar corrida (Mongo + índice D1). */
app.delete('/v1/corridas/:id', async (c) => {
  const id = c.req.param('id');
  const idx = await c.env.DB.prepare(
    'SELECT id, proyecto_id FROM corridas_index WHERE id = ?'
  )
    .bind(id)
    .first<{ id: string; proyecto_id: string }>();
  if (!idx) return jsonError(c, 404, 'Corrida no encontrada.');

  let mongoDeleted = false;
  try {
    const mongo = await mongoForProyecto(c.env, idx.proyecto_id);
    if (mongo) {
      await withMongoDb(
        mongo.env,
        async (db) => {
          const r = await db.collection('corridas').deleteOne({ _id: id });
          mongoDeleted = (r.deletedCount || 0) > 0;
        },
        mongo.dbName
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'borrado corrida falló';
    return jsonError(c, 502, msg.replace(/mongodb(\+srv)?:\/\/[^\s'"]+/gi, 'mongodb://***'));
  }

  await c.env.DB.prepare('DELETE FROM corridas_index WHERE id = ?').bind(id).run();
  return c.json({ ok: true, deleted: id, mongoDeleted });
});

function quienDesdeRequest(c: {
  get: (k: 'inviteClave') => string | undefined;
  req: { json: () => Promise<unknown> };
}): Promise<string> {
  return (async () => {
    const body = (await c.req.json().catch(() => ({}))) as { quien?: string; actor?: string };
    const q = String(body.quien || body.actor || '').trim();
    if (q) return q;
    const inv = c.get('inviteClave');
    return inv ? `invite:${inv.slice(0, 12)}…` : 'panel';
  })();
}

/** Fase 3 — Reintentar paso (solo fallida). Body opcional: { quien? } */
app.post('/v1/corridas/:id/reintentar', async (c) => {
  const loaded = await loadCorridaWithFlujo(c.env, c.req.param('id'));
  if (!loaded.ok) return jsonError(c, loaded.status, loaded.error);
  try {
    const quien = await quienDesdeRequest(c);
    const r = await accionReintentar(pasosMotorDeps(c.env), loaded.doc, loaded.flujo, quien);
    return c.json({ ok: true, accion: r.accion, corrida: publicCorrida(r.corrida) });
  } catch (err) {
    return jsonError(c, 400, err instanceof Error ? err.message : 'reintentar falló');
  }
});

/** Fase 3 — Aprobar (esperando_humano). */
app.post('/v1/corridas/:id/aprobar', async (c) => {
  const loaded = await loadCorridaWithFlujo(c.env, c.req.param('id'));
  if (!loaded.ok) return jsonError(c, loaded.status, loaded.error);
  try {
    const quien = await quienDesdeRequest(c);
    const r = await accionAprobar(pasosMotorDeps(c.env), loaded.doc, loaded.flujo, quien);
    return c.json({ ok: true, accion: r.accion, corrida: publicCorrida(r.corrida) });
  } catch (err) {
    return jsonError(c, 400, err instanceof Error ? err.message : 'aprobar falló');
  }
});

/** Fase 3 — Rechazar (esperando_humano → arista no o cancelada). */
app.post('/v1/corridas/:id/rechazar', async (c) => {
  const loaded = await loadCorridaWithFlujo(c.env, c.req.param('id'));
  if (!loaded.ok) return jsonError(c, loaded.status, loaded.error);
  try {
    const quien = await quienDesdeRequest(c);
    const r = await accionRechazar(pasosMotorDeps(c.env), loaded.doc, loaded.flujo, quien);
    return c.json({ ok: true, accion: r.accion, corrida: publicCorrida(r.corrida) });
  } catch (err) {
    return jsonError(c, 400, err instanceof Error ? err.message : 'rechazar falló');
  }
});

/** Fase 3 — Cancelar corrida (cualquier estado no final). */
app.post('/v1/corridas/:id/cancelar', async (c) => {
  const loaded = await loadCorridaWithFlujo(c.env, c.req.param('id'));
  if (!loaded.ok) return jsonError(c, loaded.status, loaded.error);
  try {
    const quien = await quienDesdeRequest(c);
    const r = await accionCancelar(pasosMotorDeps(c.env), loaded.doc, quien);
    return c.json({ ok: true, accion: r.accion, corrida: publicCorrida(r.corrida) });
  } catch (err) {
    return jsonError(c, 400, err instanceof Error ? err.message : 'cancelar falló');
  }
});

/** Fase 3 — Reanudar atascada / en_curso sin lease. */
app.post('/v1/corridas/:id/reanudar', async (c) => {
  const loaded = await loadCorridaWithFlujo(c.env, c.req.param('id'));
  if (!loaded.ok) return jsonError(c, loaded.status, loaded.error);
  try {
    const quien = await quienDesdeRequest(c);
    const r = await accionReanudar(pasosMotorDeps(c.env), loaded.doc, quien);
    return c.json({ ok: true, accion: r.accion, corrida: publicCorrida(r.corrida) });
  } catch (err) {
    return jsonError(c, 400, err instanceof Error ? err.message : 'reanudar falló');
  }
});

/**
 * Paso debido para n8n: skill + systemPrompt + entradas (datos corrida → Mongo).
 * terminada → { tipo: "fin" }; esperando → { tipo: "espera" }.
 */
app.get('/v1/corridas/:id/siguiente', async (c) => {
  const id = c.req.param('id');
  const loaded = await loadCorridaWithFlujo(c.env, id);
  if (!loaded.ok) return jsonError(c, loaded.status, loaded.error);
  let { doc, flujo } = loaded;

  // Si espera hijo de subflujo, reanudar al terminar el hijo.
  if ((doc.estado === 'esperando_hijo' || doc.estado === 'esperando') && doc.hijo_id) {
    const child = await loadCorridaDoc(c.env, doc.hijo_id);
    if (
      child.ok &&
      (child.doc.estado === 'completada' || child.doc.estado === 'terminada')
    ) {
      const ts = nowIso();
      try {
        doc = await resumeParentAfterChild(c.env, doc, flujo, child.doc, ts);
        if (c.env.PASOS && doc.paso_actual && !isTerminal(doc.estado)) {
          await enqueuePaso(c.env, {
            corrida_id: doc._id,
            nodo_id: doc.paso_actual,
            intento: 0,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'No se pudo reanudar tras subflujo.';
        return jsonError(c, 502, msg);
      }
    } else if (
      child.ok &&
      (child.doc.estado === 'fallida' || child.doc.estado === 'error')
    ) {
      await failCorrida(c.env, doc, doc.paso_actual, `Subflujo en error: ${doc.hijo_id}`);
      return c.json({
        ok: true,
        corrida_id: doc._id,
        tipo: 'error',
        negocio: doc.negocio,
        error: 'El subflujo terminó en error.',
        hijo_id: doc.hijo_id,
      });
    }
  }

  if (doc.estado === 'completada' || doc.estado === 'terminada') {
    return c.json({
      ok: true,
      corrida_id: doc._id,
      tipo: 'fin',
      negocio: doc.negocio,
      paso_actual: doc.paso_actual,
    });
  }
  if (doc.estado === 'fallida' || doc.estado === 'error' || doc.estado === 'cancelada') {
    return c.json({
      ok: true,
      corrida_id: doc._id,
      tipo: 'error',
      negocio: doc.negocio,
      errores: doc.errores,
    });
  }
  if (doc.estado === 'atascada') {
    return c.json({
      ok: true,
      corrida_id: doc._id,
      tipo: 'atascada',
      negocio: doc.negocio,
      paso_actual: doc.paso_actual,
      errores: doc.errores,
      nota: 'Usa POST /v1/corridas/:id/reanudar',
    });
  }
  if (isEsperandoHumano(doc.estado) || doc.estado === 'esperando_hijo') {
    const nodo = findNodo(flujo.nodos, doc.paso_actual);
    return c.json({
      ok: true,
      corrida_id: doc._id,
      nodo_id: doc.paso_actual,
      tipo: 'espera',
      skill: null,
      systemPrompt: null,
      entradas: {},
      negocio: doc.negocio,
      hijo_id: doc.hijo_id || null,
      motivo:
        doc.estado === 'esperando_hijo' || nodo?.tipo === 'subflujo' ? 'subflujo' : 'aprobacion',
    });
  }
  // esperando_integracion / en_curso: devolver skill para agente_externo (polling).

  const nodo = findNodo(flujo.nodos, doc.paso_actual);
  if (!nodo) {
    return jsonError(c, 500, 'paso_actual no existe en el flujo.', { paso_actual: doc.paso_actual });
  }
  if (nodo.tipo !== 'skill' || !nodo.skill) {
    return c.json({
      ok: true,
      corrida_id: doc._id,
      nodo_id: nodo.id,
      tipo: nodo.tipo,
      skill: nodo.skill || null,
      systemPrompt: null,
      entradas: {},
      negocio: doc.negocio,
    });
  }

  const skillRow = await c.env.DB.prepare('SELECT * FROM skills WHERE id = ?').bind(nodo.skill).first();
  if (!skillRow) return jsonError(c, 404, `Skill «${nodo.skill}» no encontrada.`);
  const skill = await hydrateSkill(c.env.DB, skillRow as Record<string, unknown>);
  const entradasList = (skill.entradas as string[]) || [];
  const systemPrompts = await loadSystemPromptsForSkill(c.env.DB, nodo.skill, { withMarkdown: true });
  const systemPrompt = systemPrompts[0] || null;

  const entradas = await resolveEntradasValores(c.env, entradasList, doc.negocio, doc.datos);

  return c.json({
    ok: true,
    corrida_id: doc._id,
    nodo_id: nodo.id,
    tipo: 'skill',
    skill: nodo.skill,
    systemPrompt,
    entradas,
    negocio: doc.negocio,
    flujo_id: doc.flujo_id,
    flujo_version: doc.flujo_version,
  });
});

/**
 * Contrato I/O de una skill (sin tocar Mongo). GET público.
 * → { ok, skill, entradas, salidas, anclas }
 */
app.get('/v1/ejecutar/:skillId', async (c) => {
  const skillId = c.req.param('skillId');
  const row = await c.env.DB.prepare('SELECT * FROM skills WHERE id = ?').bind(skillId).first();
  if (!row) return jsonError(c, 404, 'Skill no encontrada.');
  const skill = await hydrateSkill(c.env.DB, row as Record<string, unknown>);
  const entradas = (skill.entradas as string[]) || [];
  const salidas = (skill.salidas as string[]) || [];
  const anclas = (skill.anclas as string[]) || [];
  const systemPrompts = await loadSystemPromptsForSkill(c.env.DB, skillId, { withMarkdown: true });
  return c.json({
    ok: true,
    skill: skillId,
    nombre: skill.nombre,
    descripcion: skill.descripcion,
    entradas,
    salidas,
    anclas,
    /**
     * Compat: array de longitud 0..1 (máx. un system prompt por skill).
     * Vacío si no hay vínculo.
     */
    systemPrompts,
  });
});

app.get('/v1/anclas', async (c) => {
  // Batch hydrate: one query for anclas + one for ancla_skills (avoids N+1 D1_ERROR under load).
  const reveal = await mayRevealSensitive(c);
  const [rows, skillRows] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM anclas ORDER BY ancla').all(),
    c.env.DB.prepare('SELECT ancla_id, skill_id FROM ancla_skills').all(),
  ]);
  const skillsByAncla = new Map<string, string[]>();
  for (const r of skillRows.results || []) {
    const aid = String((r as { ancla_id: string }).ancla_id);
    const sid = String((r as { skill_id: string }).skill_id);
    const list = skillsByAncla.get(aid);
    if (list) list.push(sid);
    else skillsByAncla.set(aid, [sid]);
  }
  const out = (rows.results || []).map((row) => {
    const mapped = mapAnclaRow(row as Record<string, unknown>);
    let ejemplo = mapped.ejemplo;
    if (mapped.sensible && !reveal) {
      ejemplo = ejemplo ? maskSensitive(ejemplo) : '';
    }
    return {
      ...mapped,
      ejemplo,
      valorActual: '',
      observaciones: [] as Observacion[],
      skills: skillsByAncla.get(mapped.id) || [],
    };
  });
  return c.json({ ok: true, id: 'campos-ancla', nombre: 'Campos ancla', campos: out });
});

/**
 * Resolve alias or canonical name → ancla. Public.
 * Canonical id wins over alias when both match (avoids alias=`negocio.telefono` colliding with id).
 * Duplicate aliases across anclas → 409.
 */
app.get('/v1/anclas/resolve', async (c) => {
  const q = String(c.req.query('q') || c.req.query('alias') || '')
    .trim()
    .replace(/^_+|_+$/g, '');
  if (!q) return jsonError(c, 400, 'Falta q o alias.');
  const reveal = await mayRevealSensitive(c);
  const rows = await c.env.DB.prepare('SELECT * FROM anclas').all();
  const needle = q.toLowerCase();
  type Hit = { row: Record<string, unknown>; mapped: ReturnType<typeof mapAnclaRow> };
  const aliasHits: Hit[] = [];
  let idHit: Hit | null = null;
  for (const row of rows.results || []) {
    const mapped = mapAnclaRow(row as Record<string, unknown>);
    const canon = canonicalFromAncla(mapped.ancla).toLowerCase();
    const id = mapped.id.toLowerCase();
    const aliases = mapped.aliases.map((a) => a.toLowerCase());
    if (aliases.includes(needle)) {
      aliasHits.push({ row: row as Record<string, unknown>, mapped });
    }
    if (!idHit && (canon === needle || id === needle)) {
      idHit = { row: row as Record<string, unknown>, mapped };
    }
  }
  if (aliasHits.length > 1) {
    return jsonError(
      c,
      409,
      'Alias ambiguo («' + q + '»): ' + aliasHits.map((h) => h.mapped.id).join(', ')
    );
  }
  // Prefer canonical id match over alias (N4: alias must not collide with another name).
  const hit = idHit || aliasHits[0] || null;
  if (!hit) return jsonError(c, 404, 'Ningún ancla coincide con ese alias o canónico.');
  const via = idHit ? 'canonical' : 'alias';
  return c.json({
    ok: true,
    query: q,
    via,
    canonical: canonicalFromAncla(hit.mapped.ancla),
    ancla: hit.mapped.ancla,
    campo: await hydrateAncla(c.env.DB, hit.row, { reveal }),
  });
});

app.get('/v1/anclas/:id', async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM anclas WHERE id = ?').bind(c.req.param('id')).first();
  if (!row) return jsonError(c, 404, 'Ancla no encontrada.');
  const reveal = await mayRevealSensitive(c);
  const negocioId = String(c.req.query('negocio_id') || '').trim();
  const campo = await hydrateAncla(c.env.DB, row as Record<string, unknown>, { reveal });
  if (negocioId) {
    const valores = await loadValoresNegocio(c.env.DB, negocioId, String(row.id), {
      mask: !!campo.sensible && !reveal,
    });
    return c.json({
      ok: true,
      campo: { ...campo, ...valores, negocio_id: negocioId },
    });
  }
  return c.json({ ok: true, campo });
});

/** Valores / historial por negocio (N2). Definición del ancla no guarda valorActual. */
app.get('/v1/anclas/:id/valores', async (c) => {
  const id = c.req.param('id');
  const negocioId = String(c.req.query('negocio_id') || '').trim();
  if (!negocioId) return jsonError(c, 400, 'Falta negocio_id.');
  const row = await c.env.DB.prepare('SELECT * FROM anclas WHERE id = ?').bind(id).first();
  if (!row) return jsonError(c, 404, 'Ancla no encontrada.');
  const mapped = mapAnclaRow(row as Record<string, unknown>);
  const reveal = await mayRevealSensitive(c);
  const valores = await loadValoresNegocio(c.env.DB, negocioId, id, {
    mask: mapped.sensible && !reveal,
  });
  return c.json({
    ok: true,
    negocio_id: negocioId,
    ancla_id: id,
    ancla: mapped.ancla,
    ...valores,
  });
});

app.get('/v1/mongo', async (c) => {
  const proyecto = String(c.req.query('proyecto') || '').trim();
  const rows = proyecto
    ? await c.env.DB.prepare('SELECT * FROM campos_mongo WHERE proyecto = ? ORDER BY campo')
        .bind(proyecto)
        .all()
    : await c.env.DB.prepare('SELECT * FROM campos_mongo ORDER BY campo').all();
  return c.json({
    ok: true,
    id: 'campos-mongodb',
    nombre: 'Campos MongoDB',
    ...(proyecto ? { proyecto } : {}),
    campos: (rows.results || []).map(mapMongo),
  });
});

/**
 * Live Atlas link status (no URI leaked).
 * Public GET: configured / connected / db / source / optional safe host hint (last-4).
 */
app.get('/v1/mongo/status', async (c) => {
  const dbHint = await catalogMongoDbHint(c.env.DB);
  const resolved = await resolveRuntimeMongo(c.env, dbHint);
  if (!resolved.meta.configured || !mongoUriConfigured(resolved.env)) {
    return c.json({
      ok: true,
      configured: resolved.meta.configured,
      connected: false,
      db: resolved.meta.db,
      source: resolved.meta.source,
      ...(resolved.meta.hint ? { hint: resolved.meta.hint } : {}),
      ...(resolved.decryptError ? { error: resolved.decryptError } : {}),
    });
  }
  const status = await probeMongoStatus(resolved.env, resolved.meta.db);
  return c.json({
    ok: true,
    configured: true,
    connected: status.connected,
    db: status.db,
    source: resolved.meta.source,
    ...(resolved.meta.hint ? { hint: resolved.meta.hint } : {}),
    ...(status.error ? { error: status.error } : {}),
    ...(status.mongo ? { mongo: status.mongo } : {}),
  });
});

app.get('/v1/mongo/:id', async (c) => {
  // Avoid treating reserved paths as campo ids if routing order changes.
  const id = c.req.param('id');
  if (id === 'status' || id === 'sync' || id === 'config') {
    return jsonError(c, 404, 'Campo Mongo no encontrado.');
  }
  const row = await c.env.DB.prepare('SELECT * FROM campos_mongo WHERE id = ?').bind(id).first();
  if (!row) return jsonError(c, 404, 'Campo Mongo no encontrado.');
  return c.json({ ok: true, campo: mapMongo(row as Record<string, unknown>) });
});

app.get('/v1/proyectos', async (c) => {
  // Batch hydrate versions + skills to keep list GETs under D1 statement pressure.
  const rows = await c.env.DB.prepare(
    `SELECT id, nombre, descripcion, hash, color, created_at, updated_at,
            base_datos, colecciones, relaciones, agentes_json, legacy_negocio, cluster_id
     FROM proyectos ORDER BY nombre`
  ).all();
  const ids = (rows.results || []).map((r) => String((r as { id: string }).id));
  const [versionesAll, skillsAll] = await Promise.all([
    c.env.DB.prepare(
      'SELECT proyecto_id, numero, fecha, markdown, ruta, nombre_archivo AS nombreArchivo, hash FROM proyecto_versions ORDER BY proyecto_id, numero'
    ).all(),
    c.env.DB.prepare('SELECT proyecto_id, skill_id FROM proyecto_skills').all(),
  ]);
  const versBy = new Map<string, unknown[]>();
  for (const v of versionesAll.results || []) {
    const pid = String((v as { proyecto_id: string }).proyecto_id);
    const { proyecto_id: _p, ...rest } = v as Record<string, unknown>;
    const list = versBy.get(pid);
    if (list) list.push(rest);
    else versBy.set(pid, [rest]);
  }
  const skillsBy = new Map<string, string[]>();
  for (const s of skillsAll.results || []) {
    const pid = String((s as { proyecto_id: string }).proyecto_id);
    const sid = String((s as { skill_id: string }).skill_id);
    const list = skillsBy.get(pid);
    if (list) list.push(sid);
    else skillsBy.set(pid, [sid]);
  }
  const out = ids.map((id) => {
    const row = (rows.results || []).find((r) => String((r as { id: string }).id) === id) as Record<
      string,
      unknown
    >;
    return mapProyectoRow(row, skillsBy.get(id) || [], versBy.get(id) || []);
  });
  return c.json({ ok: true, id: 'proyectos', nombre: 'Base de datos', proyectos: out, alias: 'esquemas' });
});

/**
 * Catálogo top-level Colecciones (como la UI): aplanado de proyectos.colecciones[].
 * Mutar: PUT /v1/proyectos/:id con colecciones[] (no hay POST/DELETE sueltos).
 */
app.get('/v1/colecciones', async (c) => {
  const proyectoQ = pickProyectoId(c.req.query('proyecto'), c.req.query('proyectoId'), c.req.query('proyecto_id'));
  let sql = `SELECT id, nombre, base_datos, colecciones, legacy_negocio FROM proyectos`;
  const binds: string[] = [];
  if (proyectoQ) {
    sql += ' WHERE id = ?';
    binds.push(proyectoQ);
  }
  sql += ' ORDER BY nombre';
  const rows = binds.length
    ? await c.env.DB.prepare(sql).bind(...binds).all()
    : await c.env.DB.prepare(sql).all();

  const campos = await c.env.DB.prepare(
    'SELECT proyecto, coleccion, COUNT(*) AS n FROM campos_mongo GROUP BY proyecto, coleccion'
  ).all();
  const conteo = new Map<string, number>();
  for (const r of campos.results || []) {
    const row = r as { proyecto: string; coleccion: string; n: number };
    conteo.set(`${row.proyecto}::${row.coleccion}`, Number(row.n) || 0);
  }

  const colecciones: Array<Record<string, unknown>> = [];
  for (const raw of rows.results || []) {
    const row = raw as Record<string, unknown>;
    const legacy = !!(row.legacy_negocio === 1 || row.legacy_negocio === true);
    if (legacy) continue;
    const proyectoId = String(row.id);
    const proyectoNombre = String(row.nombre || proyectoId);
    const baseDatos = String(row.base_datos || '').trim();
    for (const col of parseColecciones(row.colecciones)) {
      if (!col.id) continue;
      const key = `${proyectoId}::${col.id}`;
      colecciones.push({
        key,
        id: col.id,
        descripcion: col.descripcion || '',
        color: col.color ?? null,
        proyectoId,
        proyectoNombre,
        baseDatos,
        nCampos: conteo.has(key) ? conteo.get(key)! : 0,
      });
    }
  }
  colecciones.sort((a, b) => {
    const pa = String(a.proyectoId).localeCompare(String(b.proyectoId), 'es');
    if (pa !== 0) return pa;
    return String(a.id).localeCompare(String(b.id), 'es');
  });
  return c.json({ ok: true, id: 'colecciones', nombre: 'Colecciones', colecciones });
});

app.get('/v1/proyectos/:id/diagrama', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT * FROM proyectos WHERE id = ?').bind(id).first();
  if (!row) return jsonError(c, 404, 'Proyecto no encontrado.');
  const proy = mapProyectoRow(row as Record<string, unknown>, [], []);
  const camposRows = await c.env.DB.prepare(
    'SELECT * FROM campos_mongo WHERE proyecto = ? ORDER BY coleccion, campo'
  )
    .bind(id)
    .all();
  const campos = (camposRows.results || []).map((r) => mapMongo(r as Record<string, unknown>)) as MongoCampoShape[];
  const coleccionQ = String(c.req.query('coleccion') || '').trim();
  const diagrama = buildDiagrama(
    {
      baseDatos: proy.baseDatos,
      colecciones: proy.colecciones,
      relaciones: proy.relaciones,
    },
    campos,
    coleccionQ ? { coleccion: coleccionQ } : undefined
  );
  const format = String(c.req.query('format') || 'json').toLowerCase();
  if (format === 'mermaid' || format === 'text') {
    return c.text(diagrama.mermaid, 200, { 'Content-Type': 'text/plain; charset=utf-8' });
  }
  return c.json({
    ok: true,
    proyecto: id,
    ...(coleccionQ ? { coleccion: coleccionQ } : {}),
    diagrama,
  });
});

/**
 * Explorador de datos: listado paginado (keyset `after`) de docs de una colección.
 * Bearer obligatorio. Alias: /v1/esquemas/:id/colecciones/:col/documentos (middleware).
 */
app.get('/v1/proyectos/:id/colecciones/:col/documentos', async (c) => {
  const authErr = await requireInviteClave(c);
  if (authErr) return authErr;

  const proyectoId = c.req.param('id');
  const coleccionId = c.req.param('col');
  const ctx = await loadColeccionDocsContext(c.env, proyectoId, coleccionId);
  if ('error' in ctx) return jsonError(c, ctx.status, ctx.error, ctx.extra);

  const lim = parseLimitParam(c.req.query('limit'));
  if ('error' in lim) return jsonError(c, 400, lim.error);

  const incluirSensible =
    String(c.req.query('incluirSensible') || '') === '1' ||
    String(c.req.query('reveal') || '') === '1';

  const mongo = await mongoForProyecto(c.env, proyectoId);
  if (!mongo) {
    return c.json(
      {
        ...mongoNotConfiguredError(),
        hint:
          'Configura la URI en Cluster → Conexión (producto). Sin URI no se pueden listar documentos.',
        proyecto: proyectoId,
        coleccion: coleccionId,
      },
      503
    );
  }

  try {
    const result = await withMongoDb(
      mongo.env,
      (db) =>
        listColeccionDocumentos(db, coleccionId, ctx.campos, {
          limit: lim.limit,
          after: String(c.req.query('after') || '').trim() || undefined,
          skip: c.req.query('skip') != null ? Number(c.req.query('skip')) : undefined,
          filterJson: c.req.query('filter') || undefined,
          sort: c.req.query('sort') || undefined,
          fields: c.req.query('fields') || undefined,
          negocio: String(c.req.query('negocio') || '').trim() || undefined,
          incluirSensible,
        }),
      mongo.dbName
    );
    if ('error' in result) {
      return jsonError(c, result.status || 400, result.error);
    }
    const body = {
      ok: true as const,
      proyecto: proyectoId,
      coleccion: coleccionId,
      baseDatos: ctx.baseDatos,
      limit: result.limit,
      count: result.count,
      nextAfter: result.nextAfter,
      hasMore: result.hasMore,
      projection: result.projection,
      documentos: result.documentos,
      mongo: { configured: true, db: mongo.dbName, source: 'cluster' as const },
    };
    const sizeErr = assertResponseSize(body);
    if (sizeErr) return jsonError(c, 413, sizeErr.error);
    return c.json(body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'configure MONGODB_URI') return c.json(mongoNotConfiguredError(), 503);
    return jsonMongoError(c, 502, err);
  }
});

/** Detalle de un documento (panel JSON). Bearer. */
app.get('/v1/proyectos/:id/colecciones/:col/documentos/:docId', async (c) => {
  const authErr = await requireInviteClave(c);
  if (authErr) return authErr;

  const proyectoId = c.req.param('id');
  const coleccionId = c.req.param('col');
  const docId = c.req.param('docId');
  const ctx = await loadColeccionDocsContext(c.env, proyectoId, coleccionId);
  if ('error' in ctx) return jsonError(c, ctx.status, ctx.error, ctx.extra);

  const incluirSensible =
    String(c.req.query('incluirSensible') || '') === '1' ||
    String(c.req.query('reveal') || '') === '1';

  const mongo = await mongoForProyecto(c.env, proyectoId);
  if (!mongo) {
    return c.json(
      {
        ...mongoNotConfiguredError(),
        hint:
          'Configura la URI en Cluster → Conexión (producto). Sin URI no se puede leer el documento.',
        proyecto: proyectoId,
        coleccion: coleccionId,
      },
      503
    );
  }

  try {
    const result = await withMongoDb(
      mongo.env,
      (db) =>
        getColeccionDocumento(db, coleccionId, docId, ctx.campos, { incluirSensible }),
      mongo.dbName
    );
    if ('error' in result) return jsonError(c, result.status, result.error);
    const body = {
      ok: true as const,
      proyecto: proyectoId,
      coleccion: coleccionId,
      baseDatos: ctx.baseDatos,
      documento: result.documento,
      mongo: { configured: true, db: mongo.dbName, source: 'cluster' as const },
    };
    const sizeErr = assertResponseSize(body);
    if (sizeErr) return jsonError(c, 413, sizeErr.error);
    return c.json(body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'configure MONGODB_URI') return c.json(mongoNotConfiguredError(), 503);
    return jsonMongoError(c, 502, err);
  }
});

/**
 * Operativa: cadena de skills de la BD (salidas A → entradas B).
 * Entradas sin productor se marcan en rojo en el Mermaid.
 */
app.get('/v1/proyectos/:id/operativa', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT id FROM proyectos WHERE id = ?').bind(id).first();
  if (!row) return jsonError(c, 404, 'Proyecto no encontrado.');
  const links = await c.env.DB.prepare(
    'SELECT skill_id FROM proyecto_skills WHERE proyecto_id = ? ORDER BY skill_id'
  )
    .bind(id)
    .all();
  const skills = [];
  for (const r of links.results || []) {
    const sid = String((r as { skill_id: string }).skill_id);
    const srow = await c.env.DB.prepare('SELECT * FROM skills WHERE id = ?').bind(sid).first();
    if (!srow) continue;
    const hydrated = await hydrateSkill(c.env.DB, srow as Record<string, unknown>);
    skills.push({
      id: String(hydrated.id),
      nombre: String(hydrated.nombre || hydrated.id),
      entradas: (hydrated.entradas as string[]) || [],
      salidas: (hydrated.salidas as string[]) || [],
    });
  }
  const operativa = buildOperativaMermaid(skills);
  const format = String(c.req.query('format') || 'json').toLowerCase();
  if (format === 'mermaid' || format === 'text') {
    return c.text(operativa.mermaid, 200, { 'Content-Type': 'text/plain; charset=utf-8' });
  }
  return c.json({ ok: true, proyecto: id, skills, ...operativa });
});

/**
 * Estado de conexión Mongo de una Base de datos (sin URI).
 * La URI vive en el Cluster del esquema; este GET es solo lectura de estado.
 * Escritura: /v1/clusters/:id/mongo-config.
 */
app.get('/v1/proyectos/:id/mongo-config', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT id, base_datos, cluster_id FROM proyectos WHERE id = ?')
    .bind(id)
    .first<{ id: string; base_datos: string | null; cluster_id: string | null }>();
  if (!row) return jsonError(c, 404, 'Proyecto no encontrado.');
  const baseDatos = String(row.base_datos || '').trim();
  const clusterId = String(row.cluster_id || '').trim();
  const clusterMeta = clusterId ? await readClusterMongoMeta(c.env.DB, clusterId) : null;
  const resolved = await resolveRuntimeMongo(c.env, baseDatos || undefined, id);
  let connected = false;
  let probeError: string | undefined;
  let probeMongo: ReturnType<typeof mongoDriverErrorBody>['mongo'] | undefined;
  let connectHint: string | undefined;
  if (resolved.meta.configured && mongoUriConfigured(resolved.env)) {
    const status = await probeMongoStatus(resolved.env, resolved.meta.db);
    connected = status.connected ? true : false;
    if (status.error) probeError = status.error;
    if (status.mongo) probeMongo = status.mongo;
    if (status.connectHint) connectHint = status.connectHint;
  }
  return c.json({
    ok: true,
    proyecto: id,
    baseDatos: baseDatos || resolved.meta.db,
    clusterId: clusterId || null,
    configured: resolved.meta.configured,
    own: false,
    connected,
    db: resolved.meta.db,
    source: resolved.meta.source,
    ...(resolved.meta.hint ? { hint: resolved.meta.hint } : {}),
    ...(resolved.decryptError ? { error: resolved.decryptError } : {}),
    ...(probeError ? { error: probeError } : {}),
    ...(probeMongo ? { mongo: probeMongo } : {}),
    ...(connectHint ? { connectHint } : {}),
    updatedAt: clusterMeta?.updatedAt || undefined,
    deprecatedWrite:
      'La URI se guarda en el Cluster. Usa GET|POST|DELETE /v1/clusters/:clusterId/mongo-config.',
  });
});

app.get('/v1/clusters', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT id, nombre, descripcion, hash, color, created_at, updated_at,
      auto_sync, last_sync_at, last_sync_ok, last_sync_proyecto, last_sync_summary
     FROM clusters ORDER BY nombre`
  ).all();
  const out = [];
  for (const row of rows.results || []) {
    out.push(await hydrateCluster(c.env.DB, row as Record<string, unknown>));
  }
  return c.json({ ok: true, id: 'clusters', nombre: 'Clusters', clusters: out });
});

app.get('/v1/clusters/:id/mongo-config', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare(
    `SELECT id, auto_sync, last_sync_at, last_sync_ok, last_sync_proyecto, last_sync_summary
     FROM clusters WHERE id = ?`
  )
    .bind(id)
    .first<Record<string, unknown>>();
  if (!row) return jsonError(c, 404, 'Cluster no encontrado.');
  const clusterMeta = await readClusterMongoMeta(c.env.DB, id);
  const resolved = await resolveRuntimeMongo(c.env, undefined, undefined, id);
  let connected = false;
  let probeError: string | undefined;
  let probeMongo: ReturnType<typeof mongoDriverErrorBody>['mongo'] | undefined;
  let connectHint: string | undefined;
  if (resolved.meta.configured && mongoUriConfigured(resolved.env)) {
    const status = await probeMongoStatus(resolved.env, resolved.meta.db);
    connected = status.connected ? true : false;
    if (status.error) probeError = status.error;
    if (status.mongo) probeMongo = status.mongo;
    if (status.connectHint) connectHint = status.connectHint;
  }
  const lastSync = parseLastSyncRow(row);
  return c.json({
    ok: true,
    cluster: id,
    configured: resolved.meta.configured,
    own: !!clusterMeta?.present,
    connected,
    db: resolved.meta.db,
    source: resolved.meta.source,
    autoSync: !!(row.auto_sync === 1 || row.auto_sync === true || row.auto_sync === '1'),
    ...(lastSync ? { lastSync } : {}),
    ...(resolved.meta.hint ? { hint: resolved.meta.hint } : {}),
    ...(resolved.decryptError ? { error: resolved.decryptError } : {}),
    ...(probeError ? { error: probeError } : {}),
    ...(probeMongo ? { mongo: probeMongo } : {}),
    ...(connectHint ? { connectHint } : {}),
    updatedAt: clusterMeta?.updatedAt || undefined,
  });
});

app.get('/v1/clusters/:id', async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT id, nombre, descripcion, hash, color, created_at, updated_at,
      auto_sync, last_sync_at, last_sync_ok, last_sync_proyecto, last_sync_summary
     FROM clusters WHERE id = ?`
  )
    .bind(c.req.param('id'))
    .first();
  if (!row) return jsonError(c, 404, 'Cluster no encontrado.');
  return c.json({ ok: true, cluster: await hydrateCluster(c.env.DB, row as Record<string, unknown>) });
});

app.get('/v1/proyectos/:id', async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM proyectos WHERE id = ?')
    .bind(c.req.param('id'))
    .first();
  if (!row) return jsonError(c, 404, 'Proyecto no encontrado.');
  return c.json({ ok: true, proyecto: await hydrateProyecto(c.env.DB, row as Record<string, unknown>) });
});

app.get('/v1/system-prompts', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT id, nombre, descripcion, hash, color, created_at, updated_at FROM system_prompts ORDER BY nombre'
  ).all();
  const out = [];
  for (const row of rows.results || []) {
    out.push(await hydrateSystemPrompt(c.env.DB, row as Record<string, unknown>));
  }
  return c.json({ ok: true, id: 'system-prompts', nombre: 'System prompts', systemPrompts: out });
});

app.get('/v1/system-prompts/:id', async (c) => {
  const row = await c.env.DB.prepare(
    'SELECT id, nombre, descripcion, hash, color, created_at, updated_at FROM system_prompts WHERE id = ?'
  )
    .bind(c.req.param('id'))
    .first();
  if (!row) return jsonError(c, 404, 'System prompt no encontrado.');
  return c.json({
    ok: true,
    systemPrompt: await hydrateSystemPrompt(c.env.DB, row as Record<string, unknown>),
  });
});

app.get('/v1/fundamentos', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT id, nombre, descripcion, hash, color, created_at, updated_at FROM fundamentos ORDER BY nombre'
  ).all();
  const out = [];
  for (const row of rows.results || []) {
    out.push(await hydrateFundamento(c.env.DB, row as Record<string, unknown>));
  }
  return c.json({ ok: true, id: 'fundamentos', nombre: 'Fundamentos', fundamentos: out });
});

app.get('/v1/fundamentos/:id', async (c) => {
  const row = await c.env.DB.prepare(
    'SELECT id, nombre, descripcion, hash, color, created_at, updated_at FROM fundamentos WHERE id = ?'
  )
    .bind(c.req.param('id'))
    .first();
  if (!row) return jsonError(c, 404, 'Fundamento no encontrado.');
  return c.json({ ok: true, fundamento: await hydrateFundamento(c.env.DB, row as Record<string, unknown>) });
});

app.get('/v1/agentes', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT id, nombre, foto, descripcion, invite_usada, last_seen, hash, color, proyectos, lee, escribe FROM agentes ORDER BY nombre'
  ).all();
  return c.json({
    ok: true,
    id: 'agentes',
    nombre: 'Agentes',
    agentes: (rows.results || []).map(mapAgente),
  });
});



app.post('/v1/invites', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { clave?: string };
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  const clave =
    (body.clave && String(body.clave).trim()) ||
    'inv_' + Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  if (!clave.startsWith('inv_')) return jsonError(c, 400, 'La clave debe empezar por inv_.');
  const creada = nowIso();
  try {
    await c.env.DB.prepare('INSERT INTO invites (clave, creada, usada_por, revocada) VALUES (?, ?, NULL, 0)')
      .bind(clave, creada)
      .run();
  } catch {
    return jsonError(c, 409, 'Esa invite ya existe.');
  }
  return c.json({ ok: true, invite: { clave, creada, usadaPor: null } }, 201);
});

app.post('/v1/agentes/registro', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    clave?: string;
    nombre?: string;
    foto?: string;
    id?: string;
    descripcion?: string;
  };
  const clave = String(body.clave || '').trim();
  const nombre = String(body.nombre || '').trim();
  if (!clave || !nombre) return jsonError(c, 400, 'clave y nombre son obligatorios.');
  const inv = await c.env.DB.prepare('SELECT clave, revocada, usada_por FROM invites WHERE clave = ?')
    .bind(clave)
    .first<{ clave: string; revocada: number; usada_por: string | null }>();
  if (!inv || inv.revocada) return jsonError(c, 403, 'Invite inválida o revocada.');

  let id = String(body.id || '').trim();
  if (!id) id = slugId(nombre);
  if (!ID_RE.test(id)) return jsonError(c, 400, 'id inválido (^[a-z0-9][a-z0-9-]{0,60}$).');

  if (inv.usada_por && inv.usada_por !== id) {
    return jsonError(c, 409, 'Esta invite ya está usada por otro agente.');
  }

  const existingInvite = await c.env.DB.prepare('SELECT id FROM agentes WHERE invite_usada = ? AND id != ?')
    .bind(clave, id)
    .first();
  if (existingInvite) return jsonError(c, 409, 'Invite ya asignada a otro agente.');

  const ts = nowIso();
  const foto = String(body.foto || '').trim();
  const descripcion = String(body.descripcion || '').trim().slice(0, 280);
  const hash = await sha256Hex(id + '|' + nombre + '|' + clave);

  // lee/escribe = metadatos UI; hoy no filtran rutas. Default ["*"] = acceso completo al hub.
  const fullAcl = JSON.stringify(['*']);
  const prev = await c.env.DB.prepare('SELECT id FROM agentes WHERE id = ?').bind(id).first();
  if (prev) {
    await c.env.DB.prepare(
      `UPDATE agentes SET nombre = ?, foto = ?, descripcion = ?, invite_usada = ?, last_seen = ?, hash = ?,
       updated_at = ?, lee = ?, escribe = ? WHERE id = ?`
    )
      .bind(nombre, foto, descripcion, clave, ts, hash, ts, fullAcl, fullAcl, id)
      .run();
  } else {
    await c.env.DB.prepare(
      `INSERT INTO agentes (id, nombre, foto, descripcion, invite_usada, last_seen, hash, created_at, updated_at, lee, escribe)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(id, nombre, foto, descripcion, clave, ts, hash, ts, ts, fullAcl, fullAcl)
      .run();
  }
  await c.env.DB.prepare('UPDATE invites SET usada_por = ? WHERE clave = ?').bind(id, clave).run();
  return c.json({ ok: true, id, lastSeen: ts, lee: ['*'], escribe: ['*'] }, prev ? 200 : 201);
});

app.post('/v1/agentes/latido', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { id?: string; clave?: string };
  const id = String(body.id || '').trim();
  const clave = String(body.clave || '').trim();
  if (!id || !clave) return jsonError(c, 400, 'id y clave son obligatorios.');
  const ag = await c.env.DB.prepare('SELECT id, invite_usada FROM agentes WHERE id = ?')
    .bind(id)
    .first<{ id: string; invite_usada: string }>();
  if (!ag) return jsonError(c, 404, 'Agente no encontrado.');
  if (ag.invite_usada !== clave) return jsonError(c, 403, 'Clave incorrecta.');
  const inv = await c.env.DB.prepare('SELECT revocada FROM invites WHERE clave = ?')
    .bind(clave)
    .first<{ revocada: number }>();
  if (inv && inv.revocada) return jsonError(c, 403, 'Invite revocada.');
  const ts = nowIso();
  await c.env.DB.prepare('UPDATE agentes SET last_seen = ?, updated_at = ? WHERE id = ?').bind(ts, ts, id).run();
  return c.json({ ok: true, id, lastSeen: ts, enLinea: true });
});

app.delete('/v1/agentes/:id', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM agentes WHERE id = ?').bind(id).run();
  return c.json({ ok: true, deleted: id });
});

app.put('/v1/agentes/:id', async (c) => {
  const id = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const ag = await c.env.DB.prepare('SELECT * FROM agentes WHERE id = ?').bind(id).first();
  if (!ag) return jsonError(c, 404, 'Agente no encontrado.');
  {
    const colorOnly = await tryColorOnlyUpdate(c.env.DB, 'agentes', id, body, nowIso());
    if (colorOnly && 'error' in colorOnly) return jsonError(c, 400, colorOnly.error);
    if (colorOnly) {
      const row = await c.env.DB.prepare('SELECT * FROM agentes WHERE id = ?').bind(id).first();
      return c.json({ ok: true, agente: mapAgente(row as Record<string, unknown>) });
    }
  }
  const nombre = String(body.nombre ?? (ag as { nombre: string }).nombre).trim();
  const foto = String(body.foto ?? ((ag as { foto: string }).foto || '')).trim();
  const descripcion = String(body.descripcion ?? ((ag as { descripcion: string }).descripcion || ''))
    .trim()
    .slice(0, 280);
  const proyectos =
    body.proyectos != null
      ? parseStringList(body.proyectos)
      : parseStringList((ag as { proyectos?: string }).proyectos);
  const lee = body.lee != null ? parseStringList(body.lee) : parseStringList((ag as { lee?: string }).lee);
  const escribe =
    body.escribe != null
      ? parseStringList(body.escribe)
      : parseStringList((ag as { escribe?: string }).escribe);
  let colorVal: string | null = colorFromRow(ag as Record<string, unknown>);
  if (bodyHasColor(body)) {
    const parsed = parseEntityColor(body.color);
    if (!parsed.ok) return jsonError(c, 400, parsed.error);
    colorVal = parsed.color;
  }
  const ts = nowIso();
  const hash = await sha256Hex(id + '|' + nombre + '|' + ((ag as { invite_usada: string }).invite_usada || ''));
  await c.env.DB.prepare(
    `UPDATE agentes SET nombre = ?, foto = ?, descripcion = ?, hash = ?, updated_at = ?,
     proyectos = ?, lee = ?, escribe = ?, color = ? WHERE id = ?`
  )
    .bind(
      nombre,
      foto,
      descripcion,
      hash,
      ts,
      JSON.stringify(proyectos),
      JSON.stringify(lee),
      JSON.stringify(escribe),
      colorVal,
      id
    )
    .run();
  return c.json({
    ok: true,
    id,
    nombre,
    foto,
    color: colorVal,
    proyectos,
    lee,
    escribe,
  });
});

app.post('/v1/skills', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    id?: string;
    nombre?: string;
    descripcion?: string;
    markdown?: string;
    anclas?: string[];
    entradas?: string[];
    salidas?: string[];
    systemPromptId?: string | null;
    systemPrompts?: unknown;
    ejecutorId?: string | null;
    ejecutor_id?: string | null;
  };
  const nombre = String(body.nombre || '').trim();
  if (!nombre) return jsonError(c, 400, 'nombre obligatorio.');
  const id = String(body.id || slugId(nombre)).trim();
  if (!ID_RE.test(id)) return jsonError(c, 400, 'id inválido.');
  const markdown = String(body.markdown || '');
  const descripcion = String(body.descripcion || '').trim().slice(0, 280);
  const io = resolveSkillIoFromBody(body);
  const promptLink = resolveSkillSystemPromptId(body);
  if (promptLink.error) return jsonError(c, 400, promptLink.error);
  const ejecutorLink = resolveSkillEjecutorId(body);
  if (ejecutorLink.error) return jsonError(c, 400, ejecutorLink.error);
  if (ejecutorLink.set && ejecutorLink.id) {
    const ex = await c.env.DB.prepare('SELECT id FROM ejecutores WHERE id = ?')
      .bind(ejecutorLink.id)
      .first();
    if (!ex) return jsonError(c, 400, 'Ejecutor no encontrado.');
  }
  const ts = nowIso();
  const hash = await sha256Hex(markdown || id + '|1');
  let colorVal: string | null = null;
  if (bodyHasColor(body as Record<string, unknown>)) {
    const parsed = parseEntityColor((body as Record<string, unknown>).color);
    if (!parsed.ok) return jsonError(c, 400, parsed.error);
    colorVal = parsed.color;
  }
  const ejecutorIdVal = ejecutorLink.set ? ejecutorLink.id : null;
  try {
    await c.env.DB.prepare(
      'INSERT INTO skills (id, nombre, descripcion, hash, color, ejecutor_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
      .bind(id, nombre, descripcion, hash, colorVal, ejecutorIdVal, ts, ts)
      .run();
  } catch {
    return jsonError(c, 409, 'Ya existe esa skill.');
  }
  await c.env.DB.prepare(
    'INSERT INTO skill_versions (skill_id, numero, fecha, markdown, ruta, nombre_archivo, hash) VALUES (?, 1, ?, ?, ?, ?, ?)'
  )
    .bind(id, todayIso(), markdown, '', id + '.md', hash)
    .run();
  await replaceSkillIo(c.env.DB, id, io.entradas, io.salidas);
  if (promptLink.set) {
    try {
      await setSkillSystemPrompt(c.env.DB, id, promptLink.id);
    } catch {
      return jsonError(c, 400, 'System prompt no encontrado.');
    }
  }
  const skill = await hydrateSkill(
    c.env.DB,
    (await c.env.DB.prepare('SELECT * FROM skills WHERE id = ?').bind(id).first()) as Record<string, unknown>
  );
  return c.json({ ok: true, skill }, 201);
});

app.put('/v1/skills/:id', async (c) => {
  const id = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const row = await c.env.DB.prepare('SELECT * FROM skills WHERE id = ?').bind(id).first();
  if (!row) return jsonError(c, 404, 'Skill no encontrada.');

  // Solo color: sin bump de versión MD (módulo entity-color).
  {
    const colorOnly = await tryColorOnlyUpdate(c.env.DB, 'skills', id, body, nowIso());
    if (colorOnly && 'error' in colorOnly) return jsonError(c, 400, colorOnly.error);
    if (colorOnly) {
      const skill = await hydrateSkill(
        c.env.DB,
        (await c.env.DB.prepare('SELECT * FROM skills WHERE id = ?').bind(id).first()) as Record<
          string,
          unknown
        >
      );
      return c.json({ ok: true, skill });
    }
  }

  const promptLink = resolveSkillSystemPromptId(body);
  if (promptLink.error) return jsonError(c, 400, promptLink.error);
  const ejecutorLink = resolveSkillEjecutorId(body);
  if (ejecutorLink.error) return jsonError(c, 400, ejecutorLink.error);

  const hasDocOrIo =
    body.nombre != null ||
    body.descripcion != null ||
    body.markdown != null ||
    body.entradas != null ||
    body.salidas != null ||
    body.anclas != null;

  // Solo cambiar system prompt y/o ejecutor: sin nueva versión de MD.
  if ((promptLink.set || ejecutorLink.set) && !hasDocOrIo) {
    let movedSkill: MovedSkillLink | null = null;
    if (promptLink.set) {
      try {
        const linkResult = await setSkillSystemPrompt(c.env.DB, id, promptLink.id);
        movedSkill = linkResult.moved;
      } catch {
        return jsonError(c, 400, 'System prompt no encontrado.');
      }
    }
    if (ejecutorLink.set) {
      if (ejecutorLink.id) {
        const ex = await c.env.DB.prepare('SELECT id FROM ejecutores WHERE id = ?')
          .bind(ejecutorLink.id)
          .first();
        if (!ex) return jsonError(c, 400, 'Ejecutor no encontrado.');
      }
      await c.env.DB.prepare('UPDATE skills SET ejecutor_id = ?, updated_at = ? WHERE id = ?')
        .bind(ejecutorLink.id, nowIso(), id)
        .run();
    }
    const skill = await hydrateSkill(
      c.env.DB,
      (await c.env.DB.prepare('SELECT * FROM skills WHERE id = ?').bind(id).first()) as Record<
        string,
        unknown
      >
    );
    return c.json({ ok: true, skill, movedSkill });
  }

  const nombre = String(body.nombre ?? (row as { nombre: string }).nombre).trim();
  const descripcion = String(body.descripcion ?? ((row as { descripcion: string }).descripcion || ''))
    .trim()
    .slice(0, 280);
  const max = await c.env.DB.prepare('SELECT COALESCE(MAX(numero), 0) AS m FROM skill_versions WHERE skill_id = ?')
    .bind(id)
    .first<{ m: number }>();
  const numero = (max?.m || 0) + 1;
  const markdown =
    body.markdown != null
      ? String(body.markdown)
      : (
          await c.env.DB.prepare(
            'SELECT markdown FROM skill_versions WHERE skill_id = ? ORDER BY numero DESC LIMIT 1'
          )
            .bind(id)
            .first<{ markdown: string }>()
        )?.markdown || '';
  const hash = await sha256Hex(markdown || id + '|' + numero);
  const ts = nowIso();
  let colorVal: string | null = colorFromRow(row as Record<string, unknown>);
  if (bodyHasColor(body)) {
    const parsed = parseEntityColor(body.color);
    if (!parsed.ok) return jsonError(c, 400, parsed.error);
    colorVal = parsed.color;
  }
  await c.env.DB.prepare('UPDATE skills SET nombre = ?, descripcion = ?, hash = ?, updated_at = ?, color = ? WHERE id = ?')
    .bind(nombre, descripcion, hash, ts, colorVal, id)
    .run();
  await c.env.DB.prepare(
    'INSERT INTO skill_versions (skill_id, numero, fecha, markdown, ruta, nombre_archivo, hash) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(id, numero, todayIso(), markdown, '', id + '.md', hash)
    .run();
  if (body.entradas != null || body.salidas != null || body.anclas != null) {
    const io = resolveSkillIoFromBody(body);
    await replaceSkillIo(c.env.DB, id, io.entradas, io.salidas);
  }
  let movedSkill: MovedSkillLink | null = null;
  if (promptLink.set) {
    try {
      const linkResult = await setSkillSystemPrompt(c.env.DB, id, promptLink.id);
      movedSkill = linkResult.moved;
    } catch {
      return jsonError(c, 400, 'System prompt no encontrado.');
    }
  }
  if (ejecutorLink.set) {
    if (ejecutorLink.id) {
      const ex = await c.env.DB.prepare('SELECT id FROM ejecutores WHERE id = ?')
        .bind(ejecutorLink.id)
        .first();
      if (!ex) return jsonError(c, 400, 'Ejecutor no encontrado.');
    }
    await c.env.DB.prepare('UPDATE skills SET ejecutor_id = ? WHERE id = ?')
      .bind(ejecutorLink.id, id)
      .run();
  }
  const skill = await hydrateSkill(
    c.env.DB,
    (await c.env.DB.prepare('SELECT * FROM skills WHERE id = ?').bind(id).first()) as Record<string, unknown>
  );
  return c.json({ ok: true, skill, movedSkill });
});

app.delete('/v1/skills/:id', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM proyecto_skills WHERE skill_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM ancla_skills WHERE skill_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM skill_anclas WHERE skill_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM skill_versions WHERE skill_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM system_prompt_skills WHERE skill_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM skills WHERE id = ?').bind(id),
  ]);
  return c.json({ ok: true, deleted: id });
});

app.post('/v1/anclas', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const prepared = await prepareAnclaPersistAsync(c.env.DB, body);
  if ('error' in prepared) return jsonError(c, 400, prepared.error);
  const campo = prepared.campo;
  const ts = nowIso();
  try {
    let colorVal: string | null = null;
    if (bodyHasColor(body)) {
      const parsedC = parseEntityColor(body.color);
      if (!parsedC.ok) return jsonError(c, 400, parsedC.error);
      colorVal = parsedC.color;
    }
    await c.env.DB.prepare(
      `INSERT INTO anclas (id, ancla, etiqueta, clave_mongo, coleccion, base_datos, tipo, obligatorio, formato, descripcion, ejemplo, hash, aliases, observaciones, valor_actual, sensible, color, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        campo.id,
        campo.ancla,
        campo.etiqueta,
        campo.claveMongo,
        campo.coleccion,
        campo.baseDatos,
        campo.tipo,
        campo.obligatorio ? 1 : 0,
        campo.formato,
        campo.descripcion,
        campo.ejemplo,
        campo.hash,
        JSON.stringify(campo.aliases),
        '[]',
        '',
        campo.sensible ? 1 : 0,
        colorVal,
        ts,
        ts
      )
      .run();
  } catch {
    return jsonError(c, 409, 'Ya existe ese ancla.');
  }
  await replaceAnclaSkills(c.env.DB, campo.id, campo.skills);
  const row = await c.env.DB.prepare('SELECT * FROM anclas WHERE id = ?').bind(campo.id).first();
  return c.json(
    {
      ok: true,
      piiRedactado: prepared.piiRedactado || undefined,
      campo: await hydrateAncla(c.env.DB, row as Record<string, unknown>, { reveal: true }),
    },
    201
  );
});

app.put('/v1/anclas/:id', async (c) => {
  const id = c.req.param('id');
  const prev = await c.env.DB.prepare('SELECT * FROM anclas WHERE id = ?').bind(id).first();
  if (!prev) return jsonError(c, 404, 'Ancla no encontrada.');
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  {
    const colorOnly = await tryColorOnlyUpdate(c.env.DB, 'anclas', id, body, nowIso());
    if (colorOnly && 'error' in colorOnly) return jsonError(c, 400, colorOnly.error);
    if (colorOnly) {
      const row = await c.env.DB.prepare('SELECT * FROM anclas WHERE id = ?').bind(id).first();
      return c.json({
        ok: true,
        campo: await hydrateAncla(c.env.DB, row as Record<string, unknown>, { reveal: true }),
      });
    }
  }
  const prevMapped = mapAnclaRow(prev as Record<string, unknown>);
  const prepared = await prepareAnclaPersistAsync(c.env.DB, { ...prevMapped, ...body, id }, id);
  if ('error' in prepared) return jsonError(c, 400, prepared.error);
  const merged = prepared.campo;
  const ts = nowIso();
  let colorVal: string | null = colorFromRow(prev as Record<string, unknown>);
  if (bodyHasColor(body)) {
    const parsedC = parseEntityColor(body.color);
    if (!parsedC.ok) return jsonError(c, 400, parsedC.error);
    colorVal = parsedC.color;
  }
  await c.env.DB.prepare(
    `UPDATE anclas SET ancla = ?, etiqueta = ?, clave_mongo = ?, coleccion = ?, base_datos = ?, tipo = ?,
     obligatorio = ?, formato = ?, descripcion = ?, ejemplo = ?, hash = ?, aliases = ?, observaciones = ?,
     valor_actual = ?, sensible = ?, color = ?, updated_at = ? WHERE id = ?`
  )
    .bind(
      merged.ancla,
      merged.etiqueta,
      merged.claveMongo,
      merged.coleccion,
      merged.baseDatos,
      merged.tipo,
      merged.obligatorio ? 1 : 0,
      merged.formato,
      merged.descripcion,
      merged.ejemplo,
      merged.hash,
      JSON.stringify(merged.aliases),
      '[]',
      '',
      merged.sensible ? 1 : 0,
      colorVal,
      ts,
      id
    )
    .run();
  if (body.skills) await replaceAnclaSkills(c.env.DB, id, merged.skills);
  const row = await c.env.DB.prepare('SELECT * FROM anclas WHERE id = ?').bind(id).first();
  return c.json({
    ok: true,
    piiRedactado: prepared.piiRedactado || undefined,
    campo: await hydrateAncla(c.env.DB, row as Record<string, unknown>, { reveal: true }),
  });
});

/**
 * Append observación por negocio (N2). No se escribe en la ficha global del ancla.
 * Body: { negocio_id, valor, url?, … }. URL/sin_pii: strict por defecto.
 */
app.post('/v1/anclas/:id/observaciones', async (c) => {
  const id = c.req.param('id');
  const prev = await c.env.DB.prepare('SELECT * FROM anclas WHERE id = ?').bind(id).first();
  if (!prev) return jsonError(c, 404, 'Ancla no encontrada.');
  const mapped = mapAnclaRow(prev as Record<string, unknown>);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const negocioId = String(body.negocio_id || body.negocioId || '').trim();
  if (!negocioId) return jsonError(c, 400, 'Falta negocio_id (los valores van por negocio, no en la ficha ancla).');
  const strictExplicit = body.strict === true || body.strict_pii === true;
  const strictOff = body.strict === false || body.strict_pii === false;
  const strict = strictExplicit || (!strictOff && defaultStrictPii(mapped));
  const prevValores = await loadValoresNegocio(c.env.DB, negocioId, id);
  const result = appendObservacion(prevValores.observaciones, body, {
    scrubUrlValue: looksLikeUrlAncla(mapped),
    strictPii: strict,
    normalizeE164: looksLikeE164Ancla(mapped),
  });
  if (result.e164Error) return jsonError(c, 400, result.e164Error);
  if (result.piiError) return jsonError(c, 400, result.piiError);
  const ts = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO ancla_valores_negocio (negocio_id, ancla_id, observaciones, valor_actual, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(negocio_id, ancla_id) DO UPDATE SET
       observaciones = excluded.observaciones,
       valor_actual = excluded.valor_actual,
       updated_at = excluded.updated_at`
  )
    .bind(negocioId, id, JSON.stringify(result.observaciones), result.valorActual, ts)
    .run();
  const valores = await loadValoresNegocio(c.env.DB, negocioId, id);
  return c.json({
    ok: true,
    piiRedactado: result.piiRedactado || undefined,
    e164Normalizado: result.e164Normalizado || undefined,
    negocio_id: negocioId,
    ancla_id: id,
    ...valores,
    campo: {
      ...(await hydrateAncla(c.env.DB, prev as Record<string, unknown>, { reveal: true })),
      ...valores,
      negocio_id: negocioId,
    },
  });
});

app.delete('/v1/anclas/:id', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM anclas WHERE id = ?').bind(id).run();
  return c.json({ ok: true, deleted: id });
});

/** Helper: flat campos.N.* → array BSON projection. */
app.post('/v1/helpers/proyeccion-array', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    ruta_ancla?: string;
    elemento?: Record<string, string>;
    valores?: Record<string, string>;
    mongo_id?: string;
  };
  let ruta = body.ruta_ancla;
  let elemento = body.elemento;
  if (body.mongo_id) {
    const mongo = await c.env.DB.prepare('SELECT * FROM campos_mongo WHERE id = ?')
      .bind(body.mongo_id)
      .first();
    if (!mongo) return jsonError(c, 404, 'Campo Mongo no encontrado.');
    const m = mapMongo(mongo as Record<string, unknown>);
    if (m.proyeccionMongo === 'array') {
      if (!ruta && m.ancla) {
        const canon = canonicalFromAncla(m.ancla);
        // `_version.recorrido.campos.N_` → `version.recorrido.campos.N` (no añadir otro `.N`)
        ruta = /\.N\b/.test(canon) ? canon.replace(/\.\d+\b/g, '.N') : canon.replace(/\.\d+.*$/, '') + '.N';
      }
      ruta = ruta || 'version.recorrido.campos.N';
      if (!elemento && Object.keys(m.proyeccionElemento).length) elemento = m.proyeccionElemento;
    }
  }
  const out = proyectarArrayN({ ruta_ancla: ruta, elemento, valores: body.valores || {} });
  if (!out.ok) return jsonError(c, 400, out.error);
  return c.json({ ok: true, clave: out.clave, [out.clave]: out.array, array: out.array });
});

/**
 * Deprecated: URI global. Canónico: POST /v1/clusters/:id/mongo-config
 * (ficha Cluster → Conexión).
 */
app.post('/v1/mongo/config', async (c) => {
  return c.json(
    {
      ok: false,
      error: 'deprecated',
      hint: 'La URI global ya no forma parte del producto. Usa POST /v1/clusters/:id/mongo-config (ficha Cluster → Conexión).',
    },
    410
  );
});

/** Deprecated: clear global panel URI (removed from product UX). */
app.delete('/v1/mongo/config', async (c) => {
  return c.json(
    {
      ok: false,
      error: 'deprecated',
      hint: 'La URI global ya no forma parte del producto. Usa DELETE /v1/clusters/:id/mongo-config.',
    },
    410
  );
});

/**
 * Upsert `negocios` in Atlas from D1 ancla_valores_negocio (catalog mapping).
 * Auth: invite Bearer. Without URI (stored or env) → 503.
 */
app.post('/v1/mongo/sync/negocio', async (c) => {
  const resolved = await resolveRuntimeMongo(c.env);
  if (!mongoUriConfigured(resolved.env)) {
    return c.json(mongoNotConfiguredError(), 503);
  }
  const body = (await c.req.json().catch(() => ({}))) as {
    negocio_id?: string;
    negocioId?: string;
  };
  const negocioId = String(body.negocio_id || body.negocioId || '').trim();
  if (!negocioId) return jsonError(c, 400, 'Falta negocio_id.');
  if (!ID_RE.test(negocioId)) return jsonError(c, 400, 'negocio_id inválido.');

  try {
    const built = await buildNegocioFromAnclas(c.env.DB, negocioId);
    const dbName = resolveMongoDbName(resolved.env, built.baseDatos);
    const proyId =
      (await proyectoIdForBaseDatos(c.env.DB, dbName)) ||
      String((await c.env.DB.prepare('SELECT id FROM proyectos LIMIT 1').first<{ id: string }>())?.id || '');
    const result = await withMongoDb(
      resolved.env,
      async (db) => {
        const antesRaw = (await db.collection('negocios').findOne({ _id: negocioId })) as Record<
          string,
          unknown
        > | null;
        const antes = cloneDoc(antesRaw);
        const up = await upsertNegocio(db, built.doc);
        const despues = cloneDoc(built.doc as unknown as Record<string, unknown>);
        if (proyId) {
          try {
            await emitCambioDatos(db, motorDeps(c.env), {
              proyectoId: proyId,
              coleccion: 'negocios',
              documentoId: negocioId,
              operacion: antes ? 'actualizar' : 'crear',
              antes,
              despues,
              origen: 'api',
              negocio: negocioId,
            });
          } catch (e) {
            console.error('emitCambioDatos sync/negocio', e);
          }
        }
        return up;
      },
      dbName
    );
    return c.json({
      ok: true,
      db: dbName,
      coleccion: 'negocios',
      fields: built.fieldsUsed,
      ...result,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'sync falló';
    if (msg === 'configure MONGODB_URI') return c.json(mongoNotConfiguredError(), 503);
    return jsonMongoError(c, 502, err);
  }
});

/**
 * Map proyecto id → negocio_id (default: same id) and upsert negocios.
 */
app.post('/v1/mongo/sync/proyecto', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    proyecto_id?: string;
    proyectoId?: string;
    proyecto?: string;
    negocio_id?: string;
    negocioId?: string;
  };
  const proyectoId = String(body.proyecto_id || body.proyectoId || body.proyecto || '').trim();
  if (!proyectoId) return jsonError(c, 400, 'Falta proyecto_id (o proyecto / proyectoId).');
  if (!ID_RE.test(proyectoId)) return jsonError(c, 400, 'proyecto_id inválido.');

  const proyecto = await c.env.DB.prepare(
    'SELECT id, nombre FROM proyectos WHERE id = ?'
  )
    .bind(proyectoId)
    .first<{ id: string; nombre: string }>();
  if (!proyecto) return jsonError(c, 404, 'Proyecto no encontrado.');

  const resolved = await resolveRuntimeMongo(c.env, undefined, proyectoId);
  if (!mongoUriConfigured(resolved.env)) {
    return c.json(mongoNotConfiguredError(), 503);
  }

  const negocioId = String(body.negocio_id || body.negocioId || proyectoId).trim();
  if (!ID_RE.test(negocioId)) return jsonError(c, 400, 'negocio_id inválido.');

  try {
    const built = await buildNegocioFromAnclas(c.env.DB, negocioId, {
      fallbackNombre: proyecto.nombre,
      proyectoId,
    });
    const dbName = resolveMongoDbName(resolved.env, built.baseDatos);
    const result = await withMongoDb(
      resolved.env,
      async (db) => {
        const antesRaw = (await db.collection('negocios').findOne({ _id: negocioId })) as Record<
          string,
          unknown
        > | null;
        const antes = cloneDoc(antesRaw);
        const up = await upsertNegocio(db, built.doc);
        const despues = cloneDoc(built.doc as unknown as Record<string, unknown>);
        try {
          await emitCambioDatos(db, motorDeps(c.env), {
            proyectoId,
            coleccion: 'negocios',
            documentoId: negocioId,
            operacion: antes ? 'actualizar' : 'crear',
            antes,
            despues,
            origen: 'api',
            negocio: negocioId,
          });
        } catch (e) {
          console.error('emitCambioDatos sync/proyecto', e);
        }
        return up;
      },
      dbName
    );
    return c.json({
      ok: true,
      db: dbName,
      coleccion: 'negocios',
      proyecto_id: proyectoId,
      fields: built.fieldsUsed,
      ...result,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'sync falló';
    if (msg === 'configure MONGODB_URI') return c.json(mongoNotConfiguredError(), 503);
    return jsonMongoError(c, 502, err);
  }
});

app.post('/v1/mongo', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const prepared = await prepareMongoPersist(c.env.DB, body);
  if ('error' in prepared) return jsonError(c, 400, prepared.error);
  const campo = prepared.campo;
  const ts = nowIso();
  try {
    let colorVal: string | null = null;
    if (bodyHasColor(body)) {
      const parsedC = parseEntityColor(body.color);
      if (!parsedC.ok) return jsonError(c, 400, parsedC.error);
      colorVal = parsedC.color;
    }
    await c.env.DB.prepare(
      `INSERT INTO campos_mongo (id, campo, base_datos, coleccion, clave, bson_type, obligatorio, descripcion, ancla, hash, proyeccion_mongo, proyeccion_elemento, indices, proyecto, hijos, enum_json, color, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        campo.id,
        campo.campo,
        campo.baseDatos,
        campo.coleccion,
        campo.clave,
        campo.bsonType,
        campo.obligatorio ? 1 : 0,
        campo.descripcion,
        campo.ancla,
        campo.hash,
        campo.proyeccionMongo,
        JSON.stringify(campo.proyeccionElemento),
        JSON.stringify(campo.indices || []),
        campo.proyecto,
        JSON.stringify(campo.hijos || []),
        JSON.stringify(Array.isArray((campo as { enum?: string[] }).enum) ? (campo as { enum?: string[] }).enum : []),
        colorVal,
        ts,
        ts
      )
      .run();
  } catch {
    return jsonError(c, 409, 'Ya existe ese campo.');
  }
  maybeScheduleSchemaAutoSync(c, String(campo.proyecto || ''));
  return c.json({ ok: true, campo }, 201);
});

app.put('/v1/mongo/:id', async (c) => {
  const id = c.req.param('id');
  const prev = await c.env.DB.prepare('SELECT * FROM campos_mongo WHERE id = ?').bind(id).first();
  if (!prev) return jsonError(c, 404, 'Campo Mongo no encontrado.');
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  {
    const colorOnly = await tryColorOnlyUpdate(c.env.DB, 'campos_mongo', id, body, nowIso());
    if (colorOnly && 'error' in colorOnly) return jsonError(c, 400, colorOnly.error);
    if (colorOnly) {
      const row = await c.env.DB.prepare('SELECT * FROM campos_mongo WHERE id = ?').bind(id).first();
      return c.json({ ok: true, campo: mapMongo(row as Record<string, unknown>) });
    }
  }
  const prepared = await prepareMongoPersist(c.env.DB, {
    ...mapMongo(prev as Record<string, unknown>),
    ...body,
    id,
  });
  if ('error' in prepared) return jsonError(c, 400, prepared.error);
  const merged = prepared.campo;
  const ts = nowIso();
  let colorVal: string | null = colorFromRow(prev as Record<string, unknown>);
  if (bodyHasColor(body)) {
    const parsedC = parseEntityColor(body.color);
    if (!parsedC.ok) return jsonError(c, 400, parsedC.error);
    colorVal = parsedC.color;
  }
  await c.env.DB.prepare(
    `UPDATE campos_mongo SET campo = ?, base_datos = ?, coleccion = ?, clave = ?, bson_type = ?,
     obligatorio = ?, descripcion = ?, ancla = ?, hash = ?, proyeccion_mongo = ?, proyeccion_elemento = ?, indices = ?,
     proyecto = ?, hijos = ?, enum_json = ?, color = ?, updated_at = ? WHERE id = ?`
  )
    .bind(
      merged.campo,
      merged.baseDatos,
      merged.coleccion,
      merged.clave,
      merged.bsonType,
      merged.obligatorio ? 1 : 0,
      merged.descripcion,
      merged.ancla,
      merged.hash,
      merged.proyeccionMongo,
      JSON.stringify(merged.proyeccionElemento),
      JSON.stringify(merged.indices || []),
      merged.proyecto,
      JSON.stringify(merged.hijos || []),
      JSON.stringify(Array.isArray((merged as { enum?: string[] }).enum) ? (merged as { enum?: string[] }).enum : []),
      colorVal,
      ts,
      id
    )
    .run();
  const prevProyecto = String((prev as { proyecto?: string }).proyecto || '');
  maybeScheduleSchemaAutoSync(c, String(merged.proyecto || ''));
  if (prevProyecto && prevProyecto !== String(merged.proyecto || '')) {
    maybeScheduleSchemaAutoSync(c, prevProyecto);
  }
  return c.json({ ok: true, campo: merged });
});

app.delete('/v1/mongo/:id', async (c) => {
  const id = c.req.param('id');
  const prev = await c.env.DB.prepare('SELECT proyecto FROM campos_mongo WHERE id = ?')
    .bind(id)
    .first<{ proyecto: string }>();
  await c.env.DB.prepare('DELETE FROM campos_mongo WHERE id = ?').bind(id).run();
  if (prev?.proyecto) maybeScheduleSchemaAutoSync(c, prev.proyecto);
  return c.json({ ok: true, deleted: id });
});

app.post('/v1/clusters', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    id?: string;
    nombre?: string;
    descripcion?: string;
  };
  const nombre = String(body.nombre || '').trim();
  if (!nombre) return jsonError(c, 400, 'nombre obligatorio.');
  const id = String(body.id || slugId(nombre)).trim();
  if (!ID_RE.test(id)) return jsonError(c, 400, 'id inválido.');
  const descripcion = String(body.descripcion || '').trim().slice(0, 280);
  const ts = nowIso();
  const hash = await sha256Hex(id + '|' + nombre + '|' + descripcion);
  let colorVal: string | null = null;
  if (bodyHasColor(body as Record<string, unknown>)) {
    const parsed = parseEntityColor((body as Record<string, unknown>).color);
    if (!parsed.ok) return jsonError(c, 400, parsed.error);
    colorVal = parsed.color;
  }
  try {
    await c.env.DB.prepare(
      'INSERT INTO clusters (id, nombre, descripcion, hash, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
      .bind(id, nombre, descripcion, hash, colorVal, ts, ts)
      .run();
  } catch {
    return jsonError(c, 409, 'Ya existe ese cluster.');
  }
  return c.json(
    {
      ok: true,
      cluster: await hydrateCluster(
        c.env.DB,
        (await c.env.DB.prepare(
          `SELECT id, nombre, descripcion, hash, color, created_at, updated_at,
            auto_sync, last_sync_at, last_sync_ok, last_sync_proyecto, last_sync_summary
           FROM clusters WHERE id = ?`
        )
          .bind(id)
          .first()) as Record<string, unknown>
      ),
    },
    201
  );
});

app.put('/v1/clusters/:id', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare(
    'SELECT id, nombre, descripcion, auto_sync, color FROM clusters WHERE id = ?'
  )
    .bind(id)
    .first<{ id: string; nombre: string; descripcion: string; auto_sync: number; color: string | null }>();
  if (!row) return jsonError(c, 404, 'Cluster no encontrado.');
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  {
    const colorOnly = await tryColorOnlyUpdate(c.env.DB, 'clusters', id, body, nowIso());
    if (colorOnly && 'error' in colorOnly) return jsonError(c, 400, colorOnly.error);
    if (colorOnly) {
      return c.json({
        ok: true,
        cluster: await hydrateCluster(
          c.env.DB,
          (await c.env.DB.prepare(
            `SELECT id, nombre, descripcion, hash, color, created_at, updated_at,
            auto_sync, last_sync_at, last_sync_ok, last_sync_proyecto, last_sync_summary
           FROM clusters WHERE id = ?`
          )
            .bind(id)
            .first()) as Record<string, unknown>
        ),
      });
    }
  }
  const nombre = String(body.nombre != null ? body.nombre : row.nombre).trim();
  if (!nombre) return jsonError(c, 400, 'nombre obligatorio.');
  const descripcion = String(
    body.descripcion != null ? body.descripcion : row.descripcion || ''
  )
    .trim()
    .slice(0, 280);
  let autoSync = !!(row.auto_sync === 1);
  if (body.autoSync != null || body.auto_sync != null) {
    autoSync = !!(body.autoSync ?? body.auto_sync);
  }
  let colorVal: string | null = colorFromRow(row as Record<string, unknown>);
  if (bodyHasColor(body)) {
    const parsed = parseEntityColor(body.color);
    if (!parsed.ok) return jsonError(c, 400, parsed.error);
    colorVal = parsed.color;
  }
  const ts = nowIso();
  const hash = await sha256Hex(id + '|' + nombre + '|' + descripcion + '|' + (autoSync ? '1' : '0'));
  await c.env.DB.prepare(
    'UPDATE clusters SET nombre = ?, descripcion = ?, hash = ?, updated_at = ?, auto_sync = ?, color = ? WHERE id = ?'
  )
    .bind(nombre, descripcion, hash, ts, autoSync ? 1 : 0, colorVal, id)
    .run();
  return c.json({
    ok: true,
    cluster: await hydrateCluster(
      c.env.DB,
      (await c.env.DB.prepare(
        `SELECT id, nombre, descripcion, hash, color, created_at, updated_at,
          auto_sync, last_sync_at, last_sync_ok, last_sync_proyecto, last_sync_summary
         FROM clusters WHERE id = ?`
      )
        .bind(id)
        .first()) as Record<string, unknown>
    ),
  });
});

app.post('/v1/clusters/:id/mongo-config', async (c) => {
  const id = c.req.param('id');
  const clusterRow = await c.env.DB.prepare('SELECT id FROM clusters WHERE id = ?')
    .bind(id)
    .first<{ id: string }>();
  if (!clusterRow) return jsonError(c, 404, 'Cluster no encontrado.');
  const key = (c.env.ENCRYPTION_KEY || '').trim();
  if (!key) {
    return c.json(
      {
        ok: false,
        error: 'ENCRYPTION_KEY missing',
        hint: 'Define el secret ENCRYPTION_KEY en el Worker (wrangler secret put ENCRYPTION_KEY).',
      },
      503
    );
  }
  const body = (await c.req.json().catch(() => ({}))) as {
    uri?: string;
    db?: string;
    dbName?: string;
    probeOnly?: boolean;
  };
  const uri = String(body.uri || '').trim();
  const dbName = String(body.db || body.dbName || '').trim();
  if (!uri) return jsonError(c, 400, 'Falta uri.');
  if (!isValidMongoUri(uri)) {
    return jsonError(c, 400, 'URI inválida (usa mongodb:// o mongodb+srv:// con usuario@host).');
  }
  const probeEnv: MongoEnv = {
    MONGODB_URI: uri,
    MONGODB_DB: dbName || c.env.MONGODB_DB,
  };
  const status = await probeMongoStatus(probeEnv, dbName || undefined);
  if (body.probeOnly) {
    return c.json({
      ok: true,
      probed: true,
      cluster: id,
      configured: false,
      own: false,
      connected: status.connected,
      db: status.db,
      ...(status.error ? { error: status.error } : {}),
      ...(status.mongo ? { mongo: status.mongo } : {}),
      ...(status.connectHint ? { connectHint: status.connectHint } : {}),
    });
  }
  const saved = await saveClusterStoredUri(c.env.DB, key, id, uri, dbName || undefined);
  return c.json({
    ok: true,
    cluster: id,
    configured: true,
    own: true,
    connected: status.connected,
    db: saved.db || status.db,
    source: 'cluster' as const,
    hint: saved.hint,
    updatedAt: saved.updatedAt,
    ...(status.error ? { error: status.error } : {}),
    ...(status.mongo ? { mongo: status.mongo } : {}),
    ...(status.connectHint ? { connectHint: status.connectHint } : {}),
  });
});

app.delete('/v1/clusters/:id/mongo-config', async (c) => {
  const id = c.req.param('id');
  const clusterRow = await c.env.DB.prepare('SELECT id FROM clusters WHERE id = ?')
    .bind(id)
    .first<{ id: string }>();
  if (!clusterRow) return jsonError(c, 404, 'Cluster no encontrado.');
  await clearClusterStoredUri(c.env.DB, id);
  const resolved = await resolveRuntimeMongo(c.env, undefined, undefined, id);
  return c.json({
    ok: true,
    cleared: true,
    cluster: id,
    configured: resolved.meta.configured,
    own: false,
    connected: false,
    db: resolved.meta.db,
    source: resolved.meta.source,
    ...(resolved.meta.hint ? { hint: resolved.meta.hint } : {}),
  });
});

app.delete('/v1/clusters/:id', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT id FROM clusters WHERE id = ?')
    .bind(id)
    .first<{ id: string }>();
  if (!row) return jsonError(c, 404, 'Cluster no encontrado.');
  const linked = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM proyectos WHERE cluster_id = ?'
  )
    .bind(id)
    .first<{ n: number }>();
  if (linked && Number(linked.n) > 0) {
    return jsonError(
      c,
      409,
      'El cluster tiene bases de datos asociadas. Reasigna o bórralas antes.'
    );
  }
  await c.env.DB.prepare('DELETE FROM mongo_config_cluster WHERE cluster_id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM clusters WHERE id = ?').bind(id).run();
  return c.json({ ok: true, deleted: id });
});

app.post('/v1/proyectos', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const nombre = String(body.nombre || '').trim();
  if (!nombre) return jsonError(c, 400, 'nombre obligatorio.');
  const id = String(body.id || slugId(nombre)).trim();
  if (!ID_RE.test(id)) return jsonError(c, 400, 'id inválido.');
  const shape = normalizeProyectoSoftwareBody(body, { id, nombre });
  if ('error' in shape) return jsonError(c, 400, shape.error);
  let clusterId = String(body.clusterId || body.cluster_id || '').trim();
  if (clusterId) {
    if (!ID_RE.test(clusterId)) return jsonError(c, 400, 'cluster_id inválido.');
    const cl = await c.env.DB.prepare('SELECT id FROM clusters WHERE id = ?')
      .bind(clusterId)
      .first();
    if (!cl) return jsonError(c, 400, 'Cluster no encontrado.');
  } else {
    clusterId = await ensureDefaultCluster(c.env.DB);
  }
  const markdown = String(body.markdown || '');
  const ts = nowIso();
  const hash = await sha256Hex(markdown || id + '|1');
  try {
    let colorVal: string | null = null;
    if (bodyHasColor(body)) {
      const parsed = parseEntityColor(body.color);
      if (!parsed.ok) return jsonError(c, 400, parsed.error);
      colorVal = parsed.color;
    }
    await c.env.DB.prepare(
      `INSERT INTO proyectos (id, nombre, descripcion, hash, color, created_at, updated_at,
        base_datos, colecciones, relaciones, agentes_json, legacy_negocio, cluster_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        shape.nombre,
        shape.descripcion,
        hash,
        colorVal,
        ts,
        ts,
        shape.baseDatos,
        JSON.stringify(shape.colecciones),
        JSON.stringify(shape.relaciones),
        JSON.stringify(shape.agentes),
        shape.legacyNegocio ? 1 : 0,
        clusterId
      )
      .run();
  } catch {
    return jsonError(c, 409, 'Ya existe ese proyecto.');
  }
  await c.env.DB.prepare(
    'INSERT INTO proyecto_versions (proyecto_id, numero, fecha, markdown, ruta, nombre_archivo, hash) VALUES (?, 1, ?, ?, ?, ?, ?)'
  )
    .bind(id, todayIso(), markdown, '', id + '.md', hash)
    .run();
  await replaceProyectoSkills(c.env.DB, id, shape.skills);
  if (shape.colecciones.length || shape.baseDatos) {
    maybeScheduleSchemaAutoSync(c, id);
  }
  return c.json({
    ok: true,
    proyecto: await hydrateProyecto(
      c.env.DB,
      (await c.env.DB.prepare('SELECT * FROM proyectos WHERE id = ?').bind(id).first()) as Record<string, unknown>
    ),
  }, 201);
});

app.put('/v1/proyectos/:id', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT * FROM proyectos WHERE id = ?').bind(id).first();
  if (!row) return jsonError(c, 404, 'Proyecto no encontrado.');
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  {
    const colorOnly = await tryColorOnlyUpdate(c.env.DB, 'proyectos', id, body, nowIso());
    if (colorOnly && 'error' in colorOnly) return jsonError(c, 400, colorOnly.error);
    if (colorOnly) {
      return c.json({
        ok: true,
        proyecto: await hydrateProyecto(
          c.env.DB,
          (await c.env.DB.prepare('SELECT * FROM proyectos WHERE id = ?').bind(id).first()) as Record<
            string,
            unknown
          >
        ),
      });
    }
  }
  // Solo colecciones (p. ej. color por ítem): actualiza JSON sin bump de versión MD.
  const bodyKeys = Object.keys(body).filter((k) => body[k] !== undefined);
  if (bodyKeys.length === 1 && bodyKeys[0] === 'colecciones') {
    const cols = parseColecciones(body.colecciones);
    const tsOnly = nowIso();
    await c.env.DB.prepare('UPDATE proyectos SET colecciones = ?, updated_at = ? WHERE id = ?')
      .bind(JSON.stringify(cols), tsOnly, id)
      .run();
    return c.json({
      ok: true,
      proyecto: await hydrateProyecto(
        c.env.DB,
        (await c.env.DB.prepare('SELECT * FROM proyectos WHERE id = ?').bind(id).first()) as Record<
          string,
          unknown
        >
      ),
    });
  }
  const prev = mapProyectoRow(row as Record<string, unknown>, [], []);
  const shape = normalizeProyectoSoftwareBody(
    {
      ...prev,
      ...body,
      // merge nested arrays carefully when omitted
      colecciones: body.colecciones != null ? body.colecciones : prev.colecciones,
      relaciones: body.relaciones != null ? body.relaciones : prev.relaciones,
      agentes: body.agentes != null ? body.agentes : prev.agentes,
      skills: body.skills != null ? body.skills : undefined,
      baseDatos: body.baseDatos != null || body.base_datos != null ? body.baseDatos ?? body.base_datos : prev.baseDatos,
    },
    { id, nombre: String(body.nombre ?? prev.nombre).trim() }
  );
  if ('error' in shape) return jsonError(c, 400, shape.error);
  let clusterId = String(
    body.clusterId != null || body.cluster_id != null
      ? body.clusterId ?? body.cluster_id
      : (row as { cluster_id?: string }).cluster_id || ''
  ).trim();
  if (body.clusterId != null || body.cluster_id != null) {
    if (!clusterId) return jsonError(c, 400, 'cluster_id vacío.');
    if (!ID_RE.test(clusterId)) return jsonError(c, 400, 'cluster_id inválido.');
    const cl = await c.env.DB.prepare('SELECT id FROM clusters WHERE id = ?')
      .bind(clusterId)
      .first();
    if (!cl) return jsonError(c, 400, 'Cluster no encontrado.');
  } else if (!clusterId) {
    clusterId = await ensureDefaultCluster(c.env.DB);
  }
  const max = await c.env.DB.prepare(
    'SELECT COALESCE(MAX(numero), 0) AS m FROM proyecto_versions WHERE proyecto_id = ?'
  )
    .bind(id)
    .first<{ m: number }>();
  const numero = (max?.m || 0) + 1;
  const markdown =
    body.markdown != null
      ? String(body.markdown)
      : (
          await c.env.DB.prepare(
            'SELECT markdown FROM proyecto_versions WHERE proyecto_id = ? ORDER BY numero DESC LIMIT 1'
          )
            .bind(id)
            .first<{ markdown: string }>()
        )?.markdown || '';
  const hash = await sha256Hex(
    JSON.stringify({
      markdown,
      baseDatos: shape.baseDatos,
      colecciones: shape.colecciones,
      relaciones: shape.relaciones,
      agentes: shape.agentes,
      skills: shape.skills,
      clusterId,
    }) || id + '|' + numero
  );
  const ts = nowIso();
  let colorVal: string | null = colorFromRow(row as Record<string, unknown>);
  if (bodyHasColor(body)) {
    const parsed = parseEntityColor(body.color);
    if (!parsed.ok) return jsonError(c, 400, parsed.error);
    colorVal = parsed.color;
  }
  await c.env.DB.prepare(
    `UPDATE proyectos SET nombre = ?, descripcion = ?, hash = ?, updated_at = ?, color = ?,
     base_datos = ?, colecciones = ?, relaciones = ?, agentes_json = ?, legacy_negocio = ?,
     cluster_id = ? WHERE id = ?`
  )
    .bind(
      shape.nombre,
      shape.descripcion,
      hash,
      ts,
      colorVal,
      shape.baseDatos,
      JSON.stringify(shape.colecciones),
      JSON.stringify(shape.relaciones),
      JSON.stringify(shape.agentes),
      shape.legacyNegocio ? 1 : 0,
      clusterId,
      id
    )
    .run();
  // PUT always creates a new version (software schema + optional markdown).
  await c.env.DB.prepare(
    'INSERT INTO proyecto_versions (proyecto_id, numero, fecha, markdown, ruta, nombre_archivo, hash) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(id, numero, todayIso(), markdown, '', id + '.md', hash)
    .run();
  if (body.skills != null) await replaceProyectoSkills(c.env.DB, id, shape.skills);
  const schemaTouched =
    body.colecciones != null ||
    body.relaciones != null ||
    body.baseDatos != null ||
    body.base_datos != null ||
    body.clusterId != null ||
    body.cluster_id != null;
  if (schemaTouched) maybeScheduleSchemaAutoSync(c, id);
  return c.json({
    ok: true,
    proyecto: await hydrateProyecto(
      c.env.DB,
      (await c.env.DB.prepare('SELECT * FROM proyectos WHERE id = ?').bind(id).first()) as Record<string, unknown>
    ),
  });
});

/** Deprecated: la URI vive en el Cluster. */
app.post('/v1/proyectos/:id/mongo-config', async (c) => {
  const id = c.req.param('id');
  const proyRow = await c.env.DB.prepare('SELECT id, cluster_id FROM proyectos WHERE id = ?')
    .bind(id)
    .first<{ id: string; cluster_id: string | null }>();
  if (!proyRow) return jsonError(c, 404, 'Proyecto no encontrado.');
  const clusterId = String(proyRow.cluster_id || '').trim();
  return c.json(
    {
      ok: false,
      error: 'gone',
      hint: clusterId
        ? `La URI se guarda en el Cluster. Usa POST /v1/clusters/${clusterId}/mongo-config.`
        : 'La URI se guarda en el Cluster. Asigna cluster_id al esquema y usa /v1/clusters/:id/mongo-config.',
      clusterId: clusterId || null,
    },
    410
  );
});

/** Deprecated: la URI vive en el Cluster. */
app.delete('/v1/proyectos/:id/mongo-config', async (c) => {
  const id = c.req.param('id');
  const proyRow = await c.env.DB.prepare('SELECT id, cluster_id FROM proyectos WHERE id = ?')
    .bind(id)
    .first<{ id: string; cluster_id: string | null }>();
  if (!proyRow) return jsonError(c, 404, 'Proyecto no encontrado.');
  const clusterId = String(proyRow.cluster_id || '').trim();
  return c.json(
    {
      ok: false,
      error: 'gone',
      hint: clusterId
        ? `La URI se borra en el Cluster. Usa DELETE /v1/clusters/${clusterId}/mongo-config.`
        : 'La URI se borra en el Cluster (/v1/clusters/:id/mongo-config).',
      clusterId: clusterId || null,
    },
    410
  );
});

app.post('/v1/proyectos/:id/crear-bd', async (c) => {
  const id = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as { dryRun?: boolean; mock?: boolean };
  const outcome = await ejecutarCrearBd(c.env, id, {
    dryRun: body.dryRun === true,
    mock: body.mock === true,
    auto: false,
  });
  if (!outcome.ok) {
    return c.json(outcome.body, outcome.status);
  }
  return c.json(outcome.body);
});

/**
 * Historial de empujes de esquema de esta Base de datos (manual + auto-sync).
 * Keyset: ?limit=50&cursor=ts~id&estado=ok|error&desde=&hasta=
 */
app.get('/v1/proyectos/:id/empujes', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT id FROM proyectos WHERE id = ?').bind(id).first();
  if (!row) return jsonError(c, 404, 'Proyecto no encontrado.');

  const limitRaw = c.req.query('limit');
  const cursor = c.req.query('cursor') || '';
  const estadoRaw = String(c.req.query('estado') || '')
    .trim()
    .toLowerCase();
  const estado =
    estadoRaw === 'ok' || estadoRaw === 'error'
      ? (estadoRaw as 'ok' | 'error')
      : ('' as const);
  const desde = String(c.req.query('desde') || '').trim();
  const hasta = String(c.req.query('hasta') || '').trim();

  const listed = await listEsquemaEmpujes(c.env.DB, id, {
    limit: limitRaw ? Number(limitRaw) : 50,
    cursor,
    estado,
    desde,
    hasta,
  });

  return c.json({
    ok: true,
    proyecto: id,
    limit: listed.limit,
    nextCursor: listed.nextCursor,
    filters: {
      ...(estado ? { estado } : {}),
      ...(desde ? { desde } : {}),
      ...(hasta ? { hasta } : {}),
    },
    empujes: listed.items.map((e) => ({
      id: e.id,
      proyectoId: e.proyectoId,
      ts: e.ts,
      modo: e.modo,
      ok: e.ok,
      estado: e.ok ? 'ok' : 'error',
      resumen: e.resumen,
      detalle: e.detalle,
    })),
  });
});

app.delete('/v1/proyectos/:id', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT legacy_negocio FROM proyectos WHERE id = ?')
    .bind(id)
    .first<{ legacy_negocio: number }>();
  const body = (await c.req.json().catch(() => ({}))) as { confirmLegacy?: boolean; confirm?: boolean };
  const confirmLegacy = body.confirmLegacy === true || body.confirm === true;
  if (row && row.legacy_negocio && !confirmLegacy) {
    return jsonError(
      c,
      409,
      'Entrada legado (negocio). Tras migrar a negocios, borra con { "confirmLegacy": true }.'
    );
  }
  await c.env.DB.prepare('DELETE FROM esquema_empujes WHERE proyecto_id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM proyecto_skills WHERE proyecto_id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM proyecto_versions WHERE proyecto_id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM proyectos WHERE id = ?').bind(id).run();
  return c.json({ ok: true, deleted: id });
});

app.post('/v1/ejecutores', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const nombre = String(body.nombre || '').trim();
  if (!nombre) return jsonError(c, 400, 'nombre obligatorio.');
  const id = String(body.id || slugId(nombre)).trim();
  if (!ID_RE.test(id)) return jsonError(c, 400, 'id inválido.');
  if (!isEjecutorTipo(body.tipo)) {
    return jsonError(c, 400, 'tipo inválido (modelo|herramienta|integracion|humano|agente_externo).');
  }
  const cfg = validateEjecutorConfig(body.tipo, body.config ?? {});
  if (!cfg.ok) return jsonError(c, 400, cfg.error);
  const timeouts = normalizeTimeouts(body);
  if (!timeouts.ok) return jsonError(c, 400, timeouts.error);
  const activo = body.activo === undefined ? true : !!body.activo;
  let colorVal: string | null = null;
  if (bodyHasColor(body)) {
    const parsed = parseEntityColor(body.color);
    if (!parsed.ok) return jsonError(c, 400, parsed.error);
    colorVal = parsed.color;
  }
  const ts = nowIso();
  try {
    await c.env.DB.prepare(
      `INSERT INTO ejecutores
        (id, nombre, tipo, config_json, timeout_s, reintentos, espera_reintento_s, activo, version, color, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
    )
      .bind(
        id,
        nombre,
        body.tipo,
        JSON.stringify(cfg.config),
        timeouts.timeout_s,
        timeouts.reintentos,
        timeouts.espera_reintento_s,
        activo ? 1 : 0,
        colorVal,
        ts,
        ts
      )
      .run();
  } catch {
    return jsonError(c, 409, 'Ya existe ese ejecutor.');
  }
  const row = await c.env.DB.prepare(
    `SELECT id, nombre, tipo, config_json, timeout_s, reintentos, espera_reintento_s,
            activo, version, color, created_at, updated_at FROM ejecutores WHERE id = ?`
  )
    .bind(id)
    .first<EjecutorRow>();
  return c.json({ ok: true, ejecutor: await hydrateEjecutor(c.env.DB, row!) }, 201);
});

app.put('/v1/ejecutores/:id', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare(
    `SELECT id, nombre, tipo, config_json, timeout_s, reintentos, espera_reintento_s,
            activo, version, color, created_at, updated_at FROM ejecutores WHERE id = ?`
  )
    .bind(id)
    .first<EjecutorRow>();
  if (!row) return jsonError(c, 404, 'Ejecutor no encontrado.');
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  {
    const colorOnly = await tryColorOnlyUpdate(c.env.DB, 'ejecutores', id, body, nowIso());
    if (colorOnly && 'error' in colorOnly) return jsonError(c, 400, colorOnly.error);
    if (colorOnly) {
      const refreshed = await c.env.DB.prepare(
        `SELECT id, nombre, tipo, config_json, timeout_s, reintentos, espera_reintento_s,
                activo, version, color, created_at, updated_at FROM ejecutores WHERE id = ?`
      )
        .bind(id)
        .first<EjecutorRow>();
      return c.json({ ok: true, ejecutor: await hydrateEjecutor(c.env.DB, refreshed!) });
    }
  }
  const nombre = String(body.nombre ?? row.nombre).trim();
  if (!nombre) return jsonError(c, 400, 'nombre obligatorio.');
  const tipoRaw = body.tipo !== undefined ? body.tipo : row.tipo;
  if (!isEjecutorTipo(tipoRaw)) {
    return jsonError(c, 400, 'tipo inválido (modelo|herramienta|integracion|humano|agente_externo).');
  }
  const configRaw = body.config !== undefined ? body.config : parseConfigJson(row.config_json);
  const cfg = validateEjecutorConfig(tipoRaw, configRaw);
  if (!cfg.ok) return jsonError(c, 400, cfg.error);
  const timeouts = normalizeTimeouts({
    timeout_s: body.timeout_s !== undefined ? body.timeout_s : row.timeout_s,
    reintentos: body.reintentos !== undefined ? body.reintentos : row.reintentos,
    espera_reintento_s:
      body.espera_reintento_s !== undefined ? body.espera_reintento_s : row.espera_reintento_s,
  });
  if (!timeouts.ok) return jsonError(c, 400, timeouts.error);
  const activo = body.activo !== undefined ? !!body.activo : !!row.activo;
  let colorVal: string | null = colorFromRow(row as unknown as Record<string, unknown>);
  if (bodyHasColor(body)) {
    const parsed = parseEntityColor(body.color);
    if (!parsed.ok) return jsonError(c, 400, parsed.error);
    colorVal = parsed.color;
  }
  const version = (Number(row.version) || 1) + 1;
  const ts = nowIso();
  await c.env.DB.prepare(
    `UPDATE ejecutores SET
      nombre = ?, tipo = ?, config_json = ?, timeout_s = ?, reintentos = ?,
      espera_reintento_s = ?, activo = ?, version = ?, color = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(
      nombre,
      tipoRaw,
      JSON.stringify(cfg.config),
      timeouts.timeout_s,
      timeouts.reintentos,
      timeouts.espera_reintento_s,
      activo ? 1 : 0,
      version,
      colorVal,
      ts,
      id
    )
    .run();
  const refreshed = await c.env.DB.prepare(
    `SELECT id, nombre, tipo, config_json, timeout_s, reintentos, espera_reintento_s,
            activo, version, color, created_at, updated_at FROM ejecutores WHERE id = ?`
  )
    .bind(id)
    .first<EjecutorRow>();
  return c.json({ ok: true, ejecutor: await hydrateEjecutor(c.env.DB, refreshed!) });
});

app.delete('/v1/ejecutores/:id', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT id FROM ejecutores WHERE id = ?').bind(id).first();
  if (!row) return jsonError(c, 404, 'Ejecutor no encontrado.');
  // ON DELETE SET NULL en skills; cleanup explícito por si el FK no está activo en D1.
  await c.env.DB.prepare('UPDATE skills SET ejecutor_id = NULL WHERE ejecutor_id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM ejecutores WHERE id = ?').bind(id).run();
  return c.json({ ok: true, deleted: id });
});

app.post('/v1/system-prompts', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    id?: string;
    nombre?: string;
    descripcion?: string;
    markdown?: string;
    skills?: string[];
  };
  const nombre = String(body.nombre || '').trim();
  if (!nombre) return jsonError(c, 400, 'nombre obligatorio.');
  const id = String(body.id || slugId(nombre)).trim();
  if (!ID_RE.test(id)) return jsonError(c, 400, 'id inválido.');
  const markdown = String(body.markdown || '');
  const descripcion = String(body.descripcion || '').trim().slice(0, 280);
  const skills = normalizeIdList(body.skills);
  const ts = nowIso();
  const hash = await sha256Hex(markdown || id + '|1');
  try {
    let colorVal: string | null = null;
    if (bodyHasColor(body as Record<string, unknown>)) {
      const parsed = parseEntityColor((body as Record<string, unknown>).color);
      if (!parsed.ok) return jsonError(c, 400, parsed.error);
      colorVal = parsed.color;
    }
    await c.env.DB.prepare(
      'INSERT INTO system_prompts (id, nombre, descripcion, hash, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
      .bind(id, nombre, descripcion, hash, colorVal, ts, ts)
      .run();
  } catch {
    return jsonError(c, 409, 'Ya existe ese system prompt.');
  }
  await c.env.DB.prepare(
    'INSERT INTO system_prompt_versions (system_prompt_id, numero, fecha, markdown, ruta, nombre_archivo, hash) VALUES (?, 1, ?, ?, ?, ?, ?)'
  )
    .bind(id, todayIso(), markdown, '', id + '.md', hash)
    .run();
  const linkResult = await replaceSystemPromptSkills(c.env.DB, id, skills);
  return c.json(
    {
      ok: true,
      systemPrompt: await hydrateSystemPrompt(
        c.env.DB,
        (await c.env.DB.prepare('SELECT * FROM system_prompts WHERE id = ?').bind(id).first()) as Record<
          string,
          unknown
        >
      ),
      /** Skills que tenían otro prompt y se movieron aquí (máx. 1 prompt/skill). */
      movedSkills: linkResult.moved,
    },
    201
  );
});

app.put('/v1/system-prompts/:id', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT * FROM system_prompts WHERE id = ?').bind(id).first();
  if (!row) return jsonError(c, 404, 'System prompt no encontrado.');
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  {
    const colorOnly = await tryColorOnlyUpdate(c.env.DB, 'system_prompts', id, body, nowIso());
    if (colorOnly && 'error' in colorOnly) return jsonError(c, 400, colorOnly.error);
    if (colorOnly) {
      return c.json({
        ok: true,
        systemPrompt: await hydrateSystemPrompt(
          c.env.DB,
          (await c.env.DB.prepare('SELECT * FROM system_prompts WHERE id = ?').bind(id).first()) as Record<
            string,
            unknown
          >
        ),
      });
    }
  }
  const nombre = String(body.nombre ?? (row as { nombre: string }).nombre).trim();
  const descripcion = String(body.descripcion ?? ((row as { descripcion: string }).descripcion || ''))
    .trim()
    .slice(0, 280);
  const max = await c.env.DB.prepare(
    'SELECT COALESCE(MAX(numero), 0) AS m FROM system_prompt_versions WHERE system_prompt_id = ?'
  )
    .bind(id)
    .first<{ m: number }>();
  const numero = (max?.m || 0) + 1;
  const markdown =
    body.markdown != null
      ? String(body.markdown)
      : (
          await c.env.DB.prepare(
            'SELECT markdown FROM system_prompt_versions WHERE system_prompt_id = ? ORDER BY numero DESC LIMIT 1'
          )
            .bind(id)
            .first<{ markdown: string }>()
        )?.markdown || '';
  const hash = await sha256Hex(markdown || id + '|' + numero);
  const ts = nowIso();
  let colorVal: string | null = colorFromRow(row as Record<string, unknown>);
  if (bodyHasColor(body)) {
    const parsed = parseEntityColor(body.color);
    if (!parsed.ok) return jsonError(c, 400, parsed.error);
    colorVal = parsed.color;
  }
  await c.env.DB.prepare(
    'UPDATE system_prompts SET nombre = ?, descripcion = ?, hash = ?, updated_at = ?, color = ? WHERE id = ?'
  )
    .bind(nombre, descripcion, hash, ts, colorVal, id)
    .run();
  await c.env.DB.prepare(
    'INSERT INTO system_prompt_versions (system_prompt_id, numero, fecha, markdown, ruta, nombre_archivo, hash) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(id, numero, todayIso(), markdown, '', id + '.md', hash)
    .run();
  let movedSkills: MovedSkillLink[] = [];
  if (body.skills != null) {
    const linkResult = await replaceSystemPromptSkills(c.env.DB, id, normalizeIdList(body.skills));
    movedSkills = linkResult.moved;
  }
  return c.json({
    ok: true,
    systemPrompt: await hydrateSystemPrompt(
      c.env.DB,
      (await c.env.DB.prepare('SELECT * FROM system_prompts WHERE id = ?').bind(id).first()) as Record<
        string,
        unknown
      >
    ),
    movedSkills,
  });
});

app.delete('/v1/system-prompts/:id', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM system_prompts WHERE id = ?').bind(id).run();
  return c.json({ ok: true, deleted: id });
});

app.post('/v1/fundamentos', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    id?: string;
    nombre?: string;
    descripcion?: string;
    markdown?: string;
  };
  const nombre = String(body.nombre || '').trim();
  if (!nombre) return jsonError(c, 400, 'nombre obligatorio.');
  const id = String(body.id || slugId(nombre)).trim();
  if (!ID_RE.test(id)) return jsonError(c, 400, 'id inválido.');
  const markdown = String(body.markdown || '');
  const descripcion = String(body.descripcion || '').trim().slice(0, 280);
  const ts = nowIso();
  const hash = await sha256Hex(markdown || id + '|1');
  let colorVal: string | null = null;
  if (bodyHasColor(body as Record<string, unknown>)) {
    const parsed = parseEntityColor((body as Record<string, unknown>).color);
    if (!parsed.ok) return jsonError(c, 400, parsed.error);
    colorVal = parsed.color;
  }
  try {
    await c.env.DB.prepare(
      'INSERT INTO fundamentos (id, nombre, descripcion, hash, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
      .bind(id, nombre, descripcion, hash, colorVal, ts, ts)
      .run();
  } catch {
    return jsonError(c, 409, 'Ya existe ese fundamento.');
  }
  const rutaPost =
    String((body as { ruta?: string }).ruta || '').trim() ||
    `catalogo/fundamentos/${id}/v1.md`;
  await c.env.DB.prepare(
    'INSERT INTO fundamento_versions (fundamento_id, numero, fecha, markdown, ruta, nombre_archivo, hash) VALUES (?, 1, ?, ?, ?, ?, ?)'
  )
    .bind(id, todayIso(), markdown, rutaPost, id + '.md', hash)
    .run();
  return c.json({
    ok: true,
    fundamento: await hydrateFundamento(
      c.env.DB,
      (await c.env.DB.prepare('SELECT * FROM fundamentos WHERE id = ?').bind(id).first()) as Record<string, unknown>
    ),
  }, 201);
});

app.put('/v1/fundamentos/:id', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT * FROM fundamentos WHERE id = ?').bind(id).first();
  if (!row) return jsonError(c, 404, 'Fundamento no encontrado.');
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  {
    const colorOnly = await tryColorOnlyUpdate(c.env.DB, 'fundamentos', id, body, nowIso());
    if (colorOnly && 'error' in colorOnly) return jsonError(c, 400, colorOnly.error);
    if (colorOnly) {
      return c.json({
        ok: true,
        fundamento: await hydrateFundamento(
          c.env.DB,
          (await c.env.DB.prepare('SELECT * FROM fundamentos WHERE id = ?').bind(id).first()) as Record<
            string,
            unknown
          >
        ),
      });
    }
  }
  const nombre = String(body.nombre ?? (row as { nombre: string }).nombre).trim();
  const descripcion = String(body.descripcion ?? ((row as { descripcion: string }).descripcion || ''))
    .trim()
    .slice(0, 280);
  const max = await c.env.DB.prepare(
    'SELECT COALESCE(MAX(numero), 0) AS m FROM fundamento_versions WHERE fundamento_id = ?'
  )
    .bind(id)
    .first<{ m: number }>();
  const numero = (max?.m || 0) + 1;
  const markdown =
    body.markdown != null
      ? String(body.markdown)
      : (
          await c.env.DB.prepare(
            'SELECT markdown FROM fundamento_versions WHERE fundamento_id = ? ORDER BY numero DESC LIMIT 1'
          )
            .bind(id)
            .first<{ markdown: string }>()
        )?.markdown || '';
  const hash = await sha256Hex(markdown || id + '|' + numero);
  const ts = nowIso();
  let colorVal: string | null = colorFromRow(row as Record<string, unknown>);
  if (bodyHasColor(body)) {
    const parsed = parseEntityColor(body.color);
    if (!parsed.ok) return jsonError(c, 400, parsed.error);
    colorVal = parsed.color;
  }
  await c.env.DB.prepare(
    'UPDATE fundamentos SET nombre = ?, descripcion = ?, hash = ?, updated_at = ?, color = ? WHERE id = ?'
  )
    .bind(nombre, descripcion, hash, ts, colorVal, id)
    .run();
  const rutaPut =
    String(body.ruta || '').trim() || `catalogo/fundamentos/${id}/v${numero}.md`;
  await c.env.DB.prepare(
    'INSERT INTO fundamento_versions (fundamento_id, numero, fecha, markdown, ruta, nombre_archivo, hash) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(id, numero, todayIso(), markdown, rutaPut, id + '.md', hash)
    .run();
  return c.json({
    ok: true,
    fundamento: await hydrateFundamento(
      c.env.DB,
      (await c.env.DB.prepare('SELECT * FROM fundamentos WHERE id = ?').bind(id).first()) as Record<string, unknown>
    ),
  });
});

app.delete('/v1/fundamentos/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM fundamentos WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true, deleted: c.req.param('id') });
});

app.notFound((c) => jsonError(c, 404, 'Ruta no encontrada.'));
app.onError((err, c) => {
  console.error(err);
  return jsonError(c, 500, err instanceof Error ? err.message : 'Error interno.');
});

/** Alias público: /v1/esquemas → mismos handlers que /v1/proyectos. Cron = motor horario. */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/v1/esquemas' || url.pathname.startsWith('/v1/esquemas/')) {
      url.pathname = url.pathname.replace(/^\/v1\/esquemas/, '/v1/proyectos');
      request = new Request(url.toString(), request);
    }
    return app.fetch(request, env, ctx);
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runHorarioTick(
        async (proyectoId, fn) => {
          const mongo = await mongoForProyecto(env, proyectoId);
          if (!mongo) return null;
          return withMongoDb(mongo.env, fn, mongo.dbName);
        },
        motorDeps(env)
      ).catch((err) => console.error('horario tick', err))
    );
    // Cada minuto: timeouts de esperando_integracion
    ctx.waitUntil(
      runEsperandoTimeoutTick(pasosMotorDeps(env)).catch((err) =>
        console.error('esperando timeout tick', err)
      )
    );
    // Cada 5 minutos: marcar atascadas
    if (new Date().getUTCMinutes() % 5 === 0) {
      ctx.waitUntil(
        runAtascadasTick(pasosMotorDeps(env)).catch((err) => console.error('atascadas tick', err))
      );
    }
  },
  async queue(batch: MessageBatch<PasoQueueMsg>, env: Env, ctx: ExecutionContext): Promise<void> {
    const deps = pasosMotorDeps(env);
    for (const message of batch.messages) {
      try {
        const body = message.body || ({} as PasoQueueMsg);
        const result = await processPasoMessage(deps, body);
        if (result === 'retry') message.retry();
        else message.ack();
      } catch (err) {
        console.error('queue pasos', err);
        message.retry();
      }
    }
  },
};

/* ——— helpers ——— */

function slugId(nombre: string) {
  return String(nombre || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 61) || 'item';
}

function normalizeAnclas(list: unknown): string[] {
  return normalizeAnclasList(list);
}

/** Body → entradas/salidas. Si solo viene `anclas` (legado), se tratan como salidas. */
function resolveSkillIoFromBody(body: {
  anclas?: string[];
  entradas?: string[];
  salidas?: string[];
}): { entradas: string[]; salidas: string[] } {
  const hasIo = body.entradas != null || body.salidas != null;
  if (hasIo) {
    return {
      entradas: normalizeAnclasList(body.entradas),
      salidas: normalizeAnclasList(body.salidas),
    };
  }
  return { entradas: [], salidas: normalizeAnclasList(body.anclas) };
}

async function sha256Hex(texto: string) {
  const data = new TextEncoder().encode(String(texto || ''));
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Resuelve token skill_anclas (`_x_` / bare) → id de fila `anclas`. */
async function resolveAnclaIdFromToken(db: D1Database, token: string): Promise<string | null> {
  const raw = String(token || '').trim();
  if (!raw) return null;
  const bare = canonicalFromAncla(raw);
  const underscored = bare ? `_${bare}_` : '';
  const row = await db
    .prepare(
      'SELECT id FROM anclas WHERE id = ? OR ancla = ? OR id = ? OR ancla = ? LIMIT 1'
    )
    .bind(raw, raw, bare, underscored || raw)
    .first<{ id: string }>();
  return row?.id || null;
}

/** Proyecta skill_anclas → ancla_skills para una skill (misma N:M). */
async function syncAnclaSkillsFromSkillIo(db: D1Database, skillId: string, anclas: string[]) {
  await db.prepare('DELETE FROM ancla_skills WHERE skill_id = ?').bind(skillId).run();
  const seen = new Set<string>();
  for (const token of anclas) {
    const aid = await resolveAnclaIdFromToken(db, token);
    if (!aid || seen.has(aid)) continue;
    seen.add(aid);
    await db
      .prepare('INSERT OR IGNORE INTO ancla_skills (ancla_id, skill_id) VALUES (?, ?)')
      .bind(aid, skillId)
      .run();
  }
}

async function replaceSkillIo(
  db: D1Database,
  skillId: string,
  entradas: string[],
  salidas: string[]
) {
  await db.prepare('DELETE FROM skill_anclas WHERE skill_id = ?').bind(skillId).run();
  for (const a of entradas) {
    await db
      .prepare('INSERT OR IGNORE INTO skill_anclas (skill_id, ancla, direccion) VALUES (?, ?, ?)')
      .bind(skillId, a, 'entrada')
      .run();
  }
  for (const a of salidas) {
    await db
      .prepare('INSERT OR IGNORE INTO skill_anclas (skill_id, ancla, direccion) VALUES (?, ?, ?)')
      .bind(skillId, a, 'salida')
      .run();
  }
  await syncAnclaSkillsFromSkillIo(db, skillId, unionAnclas(entradas, salidas));
}

/**
 * Ficha ancla → skills: escribe ancla_skills y mantiene skill_anclas alineado.
 * Altas nuevas van como `salida` si aún no hay fila I/O; bajas borran I/O de esa ancla.
 */
async function replaceAnclaSkills(db: D1Database, anclaId: string, skills: string[]) {
  const anclaRow = await db
    .prepare('SELECT ancla FROM anclas WHERE id = ?')
    .bind(anclaId)
    .first<{ ancla: string }>();
  const anclaToken = String(anclaRow?.ancla || '').trim() || anclaId;
  const prevRows = await db
    .prepare('SELECT skill_id FROM ancla_skills WHERE ancla_id = ?')
    .bind(anclaId)
    .all();
  const prev = new Set(
    (prevRows.results || []).map((r) => String((r as { skill_id: string }).skill_id))
  );
  const next = new Set((skills || []).map((s) => String(s || '').trim()).filter(Boolean));

  await db.prepare('DELETE FROM ancla_skills WHERE ancla_id = ?').bind(anclaId).run();
  for (const s of next) {
    await db
      .prepare('INSERT OR IGNORE INTO ancla_skills (ancla_id, skill_id) VALUES (?, ?)')
      .bind(anclaId, s)
      .run();
  }

  for (const sid of prev) {
    if (next.has(sid)) continue;
    await db
      .prepare('DELETE FROM skill_anclas WHERE skill_id = ? AND ancla = ?')
      .bind(sid, anclaToken)
      .run();
    if (anclaToken !== anclaId) {
      await db
        .prepare('DELETE FROM skill_anclas WHERE skill_id = ? AND ancla = ?')
        .bind(sid, anclaId)
        .run();
    }
  }
  for (const sid of next) {
    if (prev.has(sid)) continue;
    const exists = await db
      .prepare('SELECT 1 AS ok FROM skill_anclas WHERE skill_id = ? AND ancla = ? LIMIT 1')
      .bind(sid, anclaToken)
      .first();
    if (exists) continue;
    await db
      .prepare('INSERT OR IGNORE INTO skill_anclas (skill_id, ancla, direccion) VALUES (?, ?, ?)')
      .bind(sid, anclaToken, 'salida')
      .run();
  }
}

async function replaceProyectoSkills(db: D1Database, proyectoId: string, skills: string[]) {
  await db.prepare('DELETE FROM proyecto_skills WHERE proyecto_id = ?').bind(proyectoId).run();
  for (const s of skills) {
    await db.prepare('INSERT OR IGNORE INTO proyecto_skills (proyecto_id, skill_id) VALUES (?, ?)').bind(proyectoId, s).run();
  }
}

async function hydrateSkill(db: D1Database, row: Record<string, unknown>) {
  const id = String(row.id);
  const versiones = await db
    .prepare(
      'SELECT numero, fecha, markdown, ruta, nombre_archivo AS nombreArchivo, hash FROM skill_versions WHERE skill_id = ? ORDER BY numero'
    )
    .bind(id)
    .all();
  const rows = await db
    .prepare('SELECT ancla, direccion FROM skill_anclas WHERE skill_id = ? ORDER BY ancla')
    .bind(id)
    .all();
  const entradas: string[] = [];
  const salidas: string[] = [];
  for (const raw of rows.results || []) {
    const r = raw as { ancla: string; direccion?: string };
    const a = String(r.ancla || '');
    if (!a) continue;
    const dir = String(r.direccion || 'salida');
    if (dir === 'entrada') entradas.push(a);
    else salidas.push(a);
  }
  const anclas = unionAnclas(entradas, salidas);
  const systemPrompts = await loadSystemPromptsForSkill(db, id, { withMarkdown: false });
  const ejecutorIdRaw = row.ejecutor_id;
  const ejecutorId =
    ejecutorIdRaw == null || ejecutorIdRaw === '' ? null : String(ejecutorIdRaw);
  return {
    id,
    nombre: row.nombre,
    descripcion: row.descripcion || '',
    hash: row.hash || '',
    color: colorFromRow(row),
    entradas,
    salidas,
    anclas,
    systemPrompts,
    /** null = implícito agente_externo (sin fila en catálogo). */
    ejecutorId,
    versiones: versiones.results || [],
  };
}

async function hydrateEjecutor(db: D1Database, row: EjecutorRow) {
  const skillsRows = await db
    .prepare('SELECT id FROM skills WHERE ejecutor_id = ? ORDER BY id')
    .bind(row.id)
    .all();
  const skills = (skillsRows.results || []).map((r) => String((r as { id: string }).id));
  return rowToEjecutor(row, { skills, colorFromRow });
}

function normalizeIdList(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const id = String(raw || '').trim();
    if (!id || !ID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

type MovedSkillLink = { skillId: string; fromSystemPromptId: string };

/**
 * Sustituye las skills de un system prompt.
 * Regla: cada skill tiene como máximo 1 prompt → si ya estaba en otro, se mueve aquí (auto-replace).
 */
async function replaceSystemPromptSkills(
  db: D1Database,
  systemPromptId: string,
  skills: string[]
): Promise<{ moved: MovedSkillLink[] }> {
  const moved: MovedSkillLink[] = [];
  for (const s of skills) {
    const prev = await db
      .prepare(
        'SELECT system_prompt_id FROM system_prompt_skills WHERE skill_id = ? AND system_prompt_id != ?'
      )
      .bind(s, systemPromptId)
      .first<{ system_prompt_id: string }>();
    if (prev?.system_prompt_id) {
      moved.push({ skillId: s, fromSystemPromptId: prev.system_prompt_id });
    }
  }
  await db.prepare('DELETE FROM system_prompt_skills WHERE system_prompt_id = ?').bind(systemPromptId).run();
  for (const s of skills) {
    // Quita vínculo previo en otro prompt (UNIQUE skill_id) y enlaza a este.
    await db.prepare('DELETE FROM system_prompt_skills WHERE skill_id = ?').bind(s).run();
    await db
      .prepare('INSERT INTO system_prompt_skills (system_prompt_id, skill_id) VALUES (?, ?)')
      .bind(systemPromptId, s)
      .run();
  }
  return { moved };
}

/**
 * Asigna (o quita) el único system prompt de una skill. Auto-replace si ya tenía otro.
 * systemPromptId null/'' → sin prompt.
 */
async function setSkillSystemPrompt(
  db: D1Database,
  skillId: string,
  systemPromptId: string | null
): Promise<{ moved: MovedSkillLink | null }> {
  const prev = await db
    .prepare('SELECT system_prompt_id FROM system_prompt_skills WHERE skill_id = ?')
    .bind(skillId)
    .first<{ system_prompt_id: string }>();
  await db.prepare('DELETE FROM system_prompt_skills WHERE skill_id = ?').bind(skillId).run();
  if (!systemPromptId) {
    return {
      moved: prev?.system_prompt_id
        ? { skillId, fromSystemPromptId: prev.system_prompt_id }
        : null,
    };
  }
  const exists = await db
    .prepare('SELECT id FROM system_prompts WHERE id = ?')
    .bind(systemPromptId)
    .first();
  if (!exists) throw new Error('System prompt no encontrado.');
  await db
    .prepare('INSERT INTO system_prompt_skills (system_prompt_id, skill_id) VALUES (?, ?)')
    .bind(systemPromptId, skillId)
    .run();
  return {
    moved:
      prev?.system_prompt_id && prev.system_prompt_id !== systemPromptId
        ? { skillId, fromSystemPromptId: prev.system_prompt_id }
        : null,
  };
}

/** Acepta systemPromptId (string|null) o systemPrompts (array 0..1). */
function resolveSkillSystemPromptId(body: {
  systemPromptId?: unknown;
  systemPrompts?: unknown;
}): { set: boolean; id: string | null; error?: string } {
  if (body.systemPromptId !== undefined) {
    if (body.systemPromptId === null || body.systemPromptId === '') return { set: true, id: null };
    const id = String(body.systemPromptId).trim();
    if (!ID_RE.test(id)) return { set: true, id: null, error: 'systemPromptId inválido.' };
    return { set: true, id };
  }
  if (body.systemPrompts !== undefined) {
    if (!Array.isArray(body.systemPrompts)) {
      return { set: true, id: null, error: 'systemPrompts debe ser un array de 0 o 1 id.' };
    }
    if (body.systemPrompts.length > 1) {
      return {
        set: true,
        id: null,
        error: 'Una skill tiene como máximo 1 system prompt (envía 0 o 1 id).',
      };
    }
    if (body.systemPrompts.length === 0) return { set: true, id: null };
    const raw = body.systemPrompts[0];
    const id =
      raw && typeof raw === 'object' && 'id' in (raw as object)
        ? String((raw as { id: unknown }).id || '').trim()
        : String(raw || '').trim();
    if (!id || !ID_RE.test(id)) return { set: true, id: null, error: 'systemPrompts[0] inválido.' };
    return { set: true, id };
  }
  return { set: false, id: null };
}

async function hydrateSystemPrompt(db: D1Database, row: Record<string, unknown>) {
  const id = String(row.id);
  const versiones = await db
    .prepare(
      'SELECT numero, fecha, markdown, ruta, nombre_archivo AS nombreArchivo, hash FROM system_prompt_versions WHERE system_prompt_id = ? ORDER BY numero'
    )
    .bind(id)
    .all();
  const skillsRows = await db
    .prepare('SELECT skill_id FROM system_prompt_skills WHERE system_prompt_id = ? ORDER BY skill_id')
    .bind(id)
    .all();
  const skills = (skillsRows.results || []).map((r) => String((r as { skill_id: string }).skill_id));
  return {
    id,
    nombre: row.nombre,
    descripcion: row.descripcion || '',
    hash: row.hash || '',
    color: colorFromRow(row),
    skills,
    versiones: versiones.results || [],
  };
}

/**
 * System prompt(s) de una skill — como máximo 1 (UNIQUE skill_id).
 * Se sigue devolviendo array 0..1 por compatibilidad con clientes.
 * withMarkdown: incluye markdown + meta de la versión actual (bundle ejecutar).
 */
async function loadSystemPromptsForSkill(
  db: D1Database,
  skillId: string,
  opts?: { withMarkdown?: boolean }
) {
  const links = await db
    .prepare(
      `SELECT sp.id, sp.nombre, sp.descripcion, sp.hash
       FROM system_prompt_skills sps
       JOIN system_prompts sp ON sp.id = sps.system_prompt_id
       WHERE sps.skill_id = ?
       ORDER BY sp.nombre
       LIMIT 1`
    )
    .bind(skillId)
    .all();
  const out: Record<string, unknown>[] = [];
  for (const raw of links.results || []) {
    const r = raw as { id: string; nombre: string; descripcion: string; hash: string };
    const item: Record<string, unknown> = {
      id: r.id,
      nombre: r.nombre,
      descripcion: r.descripcion || '',
      hash: r.hash || '',
    };
    if (opts?.withMarkdown) {
      const ver = await db
        .prepare(
          `SELECT numero, fecha, markdown, hash FROM system_prompt_versions
           WHERE system_prompt_id = ? ORDER BY numero DESC LIMIT 1`
        )
        .bind(r.id)
        .first<{ numero: number; fecha: string; markdown: string; hash: string }>();
      item.markdown = ver?.markdown || '';
      item.version = ver
        ? { numero: ver.numero, fecha: ver.fecha, hash: ver.hash || '' }
        : null;
    }
    out.push(item);
  }
  return out;
}

function normalizeAnclaKey(raw: string): string {
  let a = String(raw || '').trim();
  if (!a) return '';
  if (a[0] !== '_') a = '_' + a;
  if (a[a.length - 1] !== '_') a = a + '_';
  return a;
}

async function loadProyectoBaseDatos(db: D1Database, proyectoId: string): Promise<string | null> {
  const row = await db
    .prepare('SELECT base_datos FROM proyectos WHERE id = ?')
    .bind(proyectoId)
    .first<{ base_datos: string }>();
  return row?.base_datos ? String(row.base_datos) : null;
}

async function setDisparadorActivo(
  c: { req: { param: (n: string) => string }; env: Env; json: (b: unknown, s?: number) => Response },
  activo: boolean
) {
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT * FROM disparadores WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();
  if (!existing) return jsonError(c, 404, 'Disparador no encontrado.');
  const prev = rowToDisparador(existing);
  const ts = nowIso();
  const nextVersion = (prev.version || 1) + 1;
  await c.env.DB.prepare(
    'UPDATE disparadores SET activo = ?, version = ?, actualizado = ? WHERE id = ?'
  )
    .bind(activo ? 1 : 0, nextVersion, ts, id)
    .run();
  const row = await c.env.DB.prepare('SELECT * FROM disparadores WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();
  return c.json({
    ok: true,
    disparador: row ? publicDisparador(rowToDisparador(row)) : null,
  });
}

/** coleccion debe existir en Mongo (BD del proyecto). null/vacío = ok (tipos sin colección). */
async function ensureColeccionMongo(
  env: Env,
  proyectoId: string,
  coleccion: string | null | undefined
): Promise<string | null> {
  const name = String(coleccion || '').trim();
  if (!name) return null;
  const mongo = await mongoForProyecto(env, proyectoId);
  if (!mongo) {
    return `No hay URI Mongo para el proyecto «${proyectoId}»; no se puede comprobar la colección «${name}».`;
  }
  try {
    const names = await withMongoDb(
      mongo.env,
      async (db) => {
        const cols = await db.listCollections({}, { nameOnly: true }).toArray();
        return cols.map((c) => c.name);
      },
      mongo.dbName
    );
    if (!names.includes(name)) {
      return `colección «${name}» no existe en Mongo (${mongo.dbName}).`;
    }
    return null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `No se pudo listar colecciones Mongo: ${msg}`;
  }
}

/** Aviso (no error) si el pipeline cita anclas `_…_` que no están en el catálogo. */
async function avisosAnclasPipeline(
  db: D1Database,
  pipeline: Record<string, unknown>[] | null | undefined
): Promise<string[]> {
  const ids = extractAnclaIdsFromPipeline(pipeline || null);
  if (!ids.length) return [];
  const missing: string[] = [];
  for (const anclaId of ids) {
    const row = await db.prepare('SELECT id FROM anclas WHERE id = ?').bind(anclaId).first();
    if (!row) missing.push(anclaId);
  }
  if (!missing.length) return [];
  return [`Campos del pipeline sin ancla en catálogo: ${missing.join(', ')}`];
}

async function hydrateFlujoListItem(db: D1Database, row: Record<string, unknown>) {
  const id = String(row.id);
  const ver = await db
    .prepare(
      `SELECT numero FROM flujo_versions WHERE flujo_id = ? ORDER BY numero DESC LIMIT 1`
    )
    .bind(id)
    .first<{ numero: number }>();
  return {
    id,
    nombre: String(row.nombre || ''),
    descripcion: String(row.descripcion || ''),
    proyectoId: String(row.proyecto_id || ''),
    hash: String(row.hash || ''),
    color: colorFromRow(row),
    version: ver?.numero || 1,
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
  };
}

async function listFlujoVersions(db: D1Database, flujoId: string) {
  const rows = await db
    .prepare(
      `SELECT numero, fecha, hash FROM flujo_versions WHERE flujo_id = ? ORDER BY numero`
    )
    .bind(flujoId)
    .all();
  return (rows.results || []).map((raw) => {
    const r = raw as { numero: number; fecha: string; hash: string };
    return {
      numero: r.numero,
      fecha: r.fecha || '',
      hash: r.hash || '',
    };
  });
}

async function loadFlujoVersion(
  db: D1Database,
  flujoId: string,
  version?: number
): Promise<FlujoVersionDoc | null> {
  const meta = await db
    .prepare('SELECT id, nombre, descripcion, proyecto_id, hash, color FROM flujos WHERE id = ?')
    .bind(flujoId)
    .first<{
      id: string;
      nombre: string;
      descripcion: string;
      proyecto_id: string;
      hash: string;
      color: string | null;
    }>();
  if (!meta) return null;
  const ver = version
    ? await db
        .prepare(
          `SELECT numero, nodos_json, aristas_json, hash FROM flujo_versions
           WHERE flujo_id = ? AND numero = ?`
        )
        .bind(flujoId, version)
        .first<{ numero: number; nodos_json: string; aristas_json: string; hash: string }>()
    : await db
        .prepare(
          `SELECT numero, nodos_json, aristas_json, hash FROM flujo_versions
           WHERE flujo_id = ? ORDER BY numero DESC LIMIT 1`
        )
        .bind(flujoId)
        .first<{ numero: number; nodos_json: string; aristas_json: string; hash: string }>();
  if (!ver) return null;
  return {
    id: meta.id,
    nombre: meta.nombre,
    descripcion: meta.descripcion || '',
    proyectoId: meta.proyecto_id,
    version: ver.numero,
    nodos: parseNodos(ver.nodos_json),
    aristas: parseAristas(ver.aristas_json),
    hash: ver.hash || meta.hash || '',
    color: colorFromRow(meta as unknown as Record<string, unknown>),
  };
}

async function mongoForProyecto(
  env: Env,
  proyectoId: string
): Promise<{ env: MongoEnv; dbName: string } | null> {
  const baseDatos = (await loadProyectoBaseDatos(env.DB, proyectoId)) || undefined;
  const resolved = await resolveRuntimeMongo(env, baseDatos, proyectoId);
  if (!mongoUriConfigured(resolved.env)) return null;
  return { env: resolved.env, dbName: resolved.meta.db };
}

/** Bearer invite para GETs que leen datos de negocio (no catálogo público). */
async function requireInviteClave(c: {
  req: { header: (n: string) => string | undefined };
  env: Env;
  json: (b: unknown, s?: number) => Response;
  set: (k: string, v: string) => void;
}): Promise<Response | null> {
  const clave = extractClave(c);
  if (!clave) {
    return jsonError(c, 401, 'Falta AGENTE_CLAVE (Authorization: Bearer inv_… o X-Agente-Clave).');
  }
  const inv = await c.env.DB.prepare('SELECT clave, revocada, usada_por FROM invites WHERE clave = ?')
    .bind(clave)
    .first<{ clave: string; revocada: number; usada_por: string | null }>();
  if (!inv || inv.revocada) return jsonError(c, 403, 'Invite inválida o revocada.');
  c.set('inviteClave', clave);
  if (inv.usada_por) c.set('agenteId', inv.usada_por);
  return null;
}

/**
 * Resuelve proyecto + colección del schema + campos catálogo (sensible vía ancla).
 */
async function loadColeccionDocsContext(
  env: Env,
  proyectoId: string,
  coleccionId: string
): Promise<
  | { baseDatos: string; campos: CatalogCampo[] }
  | { error: string; status: number; extra?: Record<string, unknown> }
> {
  const pid = String(proyectoId || '').trim();
  const cid = String(coleccionId || '').trim();
  if (!pid || !ID_RE.test(pid)) return { error: 'proyecto inválido.', status: 400 };
  if (!cid || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(cid)) {
    return { error: 'colección inválida.', status: 400 };
  }
  const row = await env.DB.prepare('SELECT id, base_datos, colecciones FROM proyectos WHERE id = ?')
    .bind(pid)
    .first<{ id: string; base_datos: string | null; colecciones: string | null }>();
  if (!row) return { error: 'Proyecto no encontrado.', status: 404 };
  const cols = parseColecciones(row.colecciones);
  if (!cols.some((c) => c.id === cid)) {
    return {
      error: `colección «${cid}» no está en el schema del proyecto.`,
      status: 404,
      extra: { proyecto: pid, coleccion: cid },
    };
  }
  const baseDatos = String(row.base_datos || '').trim() || resolveMongoDbName(env);
  const campoRows = await env.DB.prepare(
    'SELECT clave, ancla FROM campos_mongo WHERE proyecto = ? AND coleccion = ? ORDER BY campo'
  )
    .bind(pid, cid)
    .all();
  const anclaIds = new Set<string>();
  for (const r of campoRows.results || []) {
    const a = String((r as { ancla?: string }).ancla || '').trim();
    if (a) anclaIds.add(a);
  }
  const sensibleAnclas = new Set<string>();
  if (anclaIds.size) {
    const anclaRows = await env.DB.prepare(
      'SELECT id, ancla, sensible FROM anclas WHERE sensible = 1'
    ).all();
    for (const r of anclaRows.results || []) {
      const id = String((r as { id: string }).id || '');
      const ancla = String((r as { ancla: string }).ancla || '');
      if (anclaIds.has(id) || anclaIds.has(ancla)) {
        sensibleAnclas.add(id);
        if (ancla) sensibleAnclas.add(ancla);
      }
    }
  }
  const campos: CatalogCampo[] = [];
  const seen = new Set<string>();
  for (const r of campoRows.results || []) {
    const clave = String((r as { clave?: string }).clave || '').trim();
    if (!clave || seen.has(clave)) continue;
    seen.add(clave);
    const ancla = String((r as { ancla?: string }).ancla || '').trim();
    campos.push({
      clave,
      sensible: !!(ancla && sensibleAnclas.has(ancla)),
    });
  }
  return { baseDatos, campos };
}

function motorDeps(env: Env): MotorDeps {
  return {
    dbD1: env.DB,
    nowIso,
    startCorrida: (args) => startCorridaForDisparo(env, args),
  };
}

function pasosMotorDeps(env: Env): PasosMotorDeps {
  return {
    env,
    nowIso,
    loadCorridaWithFlujo: (id) => loadCorridaWithFlujo(env, id),
    saveCorridaDoc: (doc) => saveCorridaDoc(env, doc),
    mongoForProyecto: (proyectoId) => mongoForProyecto(env, proyectoId),
    resolveEntradasValores: (entradas, negocio, datos) =>
      resolveEntradasValores(env, entradas, negocio, datos),
    writeSalidasMongo: (skillId, negocio, valores, corridaId, datos) =>
      writeSkillSalidasToMongo(env, skillId, negocio, valores, corridaId, datos),
    loadFlujoVersion: (flujoId, version) => loadFlujoVersion(env.DB, flujoId, version),
    newCorridaId,
  };
}

/** Escritura Mongo de salidas de skill (motor + /salidas). Respeta 1:N vía `_documentos_`. */
async function writeSkillSalidasToMongo(
  env: Env,
  skillId: string,
  negocio: string,
  valores: Record<string, unknown>,
  corridaId: string | null,
  datosCorrida?: Record<string, unknown> | null,
  opts?: { documentoId?: string | null; coleccionesProyecto?: Array<{ id?: string; modo_escritura?: string }> | null }
): Promise<string[]> {
  const keys = Object.keys(valores);
  const maps = await loadAnclaMongoMaps(env.DB, keys);
  const baseDatos =
    maps.find((m) => m.baseDatos)?.baseDatos ||
    (await catalogMongoDbHint(env.DB)) ||
    'software_reservas';
  const proyectoId = await proyectoIdForBaseDatos(env.DB, baseDatos);
  const resolved = await resolveRuntimeMongo(env, baseDatos, proyectoId || undefined);
  if (!mongoUriConfigured(resolved.env)) throw new Error('configure MONGODB_URI');
  const datos = datosCorrida || {};
  const coleccionesProyecto = opts?.coleccionesProyecto || null;
  const escritos: string[] = [];
  const origenEscritura = corridaId ? `corrida:${corridaId}` : 'motor';
  await withMongoDb(
    resolved.env,
    async (db) => {
      const docCache = new Map<string, Record<string, unknown> | null>();
      const antesCache = new Map<string, Record<string, unknown> | null>();
      const targetIds = new Map<string, string>();
      for (const m of maps) {
        const cacheKey = m.coleccion + '|' + m.baseDatos;
        if (!docCache.has(cacheKey)) {
          const resolvedTarget = resolveWriteTargetId({
            coleccion: m.coleccion,
            negocio,
            corridaId,
            datos,
            valores,
            anclaMaps: maps,
            coleccionesProyecto,
            documentoIdBody: opts?.documentoId,
          });
          targetIds.set(cacheKey, resolvedTarget.targetId);
          let existing = await db.collection(m.coleccion).findOne({ _id: resolvedTarget.targetId });
          if (!existing && resolvedTarget.modo === 'unico_por_negocio') {
            existing = await findDocForColeccion(db, m.coleccion, negocio);
          }
          antesCache.set(cacheKey, cloneDoc(existing as Record<string, unknown> | null));
          let doc = existing
            ? ({ ...(existing as Record<string, unknown>) } as Record<string, unknown>)
            : {
                _id: resolvedTarget.targetId,
                ...(m.coleccion !== 'negocios' ? { negocio_id: negocio } : {}),
              };
          doc._id = resolvedTarget.targetId;
          if (m.coleccion !== 'negocios') doc.negocio_id = negocio;
          docCache.set(cacheKey, doc);
        }
        const doc = docCache.get(cacheKey);
        if (!doc) continue;
        if (!(m.ancla in valores)) continue;
        setByPath(doc, m.claveMongo, valores[m.ancla]);
        escritos.push(m.ancla);
      }
      const proyId = proyectoId || '';
      const now = nowIso();
      for (const [cacheKey, doc] of docCache) {
        if (!doc) continue;
        const coleccion = cacheKey.split('|')[0]!;
        const id = targetIds.get(cacheKey) || doc._id;
        doc._id = id;
        const antes = antesCache.get(cacheKey) || null;
        const operacion = antes ? ('actualizar' as const) : ('crear' as const);
        const { _id, ...rest } = doc;
        const setDoc: Record<string, unknown> = {
          ...rest,
          _id: id,
          actualizado_en: now,
        };
        if (coleccion !== 'negocios') setDoc.negocio_id = negocio;
        if (!antes) setDoc.creado_en = now;
        else if (antes.creado_en != null) setDoc.creado_en = antes.creado_en;
        await db.collection(coleccion).updateOne({ _id: id }, { $set: setDoc }, { upsert: true });
        Object.assign(doc, setDoc);
        if (SYSTEM_COLLECTIONS.has(coleccion) || !proyId) continue;
        try {
          await emitCambioDatos(db, motorDeps(env), {
            proyectoId: proyId,
            coleccion,
            documentoId: String(id),
            operacion,
            antes,
            despues: cloneDoc(doc),
            origen: origenEscritura,
            negocio,
          });
        } catch (emitErr) {
          console.error('emitCambioDatos motor', emitErr);
        }
      }
    },
    baseDatos
  );
  // `_documentos_` queda en `datos` (mutado); el caller persiste la corrida.
  return escritos;
}

async function responderProbarDisparador(
  c: { env: Env; json: (b: unknown, s?: number) => Response },
  proyectoId: string,
  body: Record<string, unknown>
) {
  const tipoRaw = String(body.tipo || '').trim();
  if (!isDisparadorTipo(tipoRaw)) {
    return jsonError(c, 400, 'tipo inválido (manual|horario|cambio_datos|webhook).');
  }
  const pipeParsed = parsePipeline(body.pipeline);
  if (!pipeParsed.ok) return jsonError(c, 400, pipeParsed.error);
  const stageErr = validatePipelineStages(pipeParsed.pipeline);
  if (stageErr) return jsonError(c, 400, stageErr);

  const mongo = await mongoForProyecto(c.env, proyectoId);
  if (!mongo) return jsonError(c, 503, 'configure MONGODB_URI');

  try {
    const result = await withMongoDb(
      mongo.env,
      async (db) =>
        probarDisparadorDryRun(db, {
          tipo: tipoRaw,
          coleccion: body.coleccion != null ? String(body.coleccion) : null,
          pipeline: pipeParsed.pipeline,
          disparador_id: body.disparador_id != null ? String(body.disparador_id) : null,
        }),
      mongo.dbName
    );
    return c.json({
      ok: true,
      habria_lanzado: result.habria_lanzado,
      muestra: result.muestra,
      eventos_probados: result.eventos_probados ?? null,
      nota: result.nota || null,
      error: result.error || null,
    });
  } catch (err) {
    return jsonMongoError(c, 502, err);
  }
}

/** Crea corrida + avance inicial (usado por POST /v1/corridas y motor de disparo). */
async function startCorridaForDisparo(
  env: Env,
  args: {
    flujoId: string;
    negocio: string;
    datos: Record<string, unknown>;
    disparadorId: string;
    eventoId: string;
    proyectoId?: string;
  }
): Promise<CorridaDoc> {
  const flujo = await loadFlujoVersion(env.DB, args.flujoId);
  if (!flujo) throw new Error(`Flujo «${args.flujoId}» no encontrado.`);
  const ts = nowIso();
  const id = newCorridaId();
  const datos: Record<string, unknown> = { ...(args.datos || {}) };
  const doc: CorridaDoc = {
    _id: id,
    flujo_id: flujo.id,
    flujo_version: flujo.version,
    proyecto_id: flujo.proyectoId,
    negocio: args.negocio,
    estado: 'pendiente',
    paso_actual: '',
    pasos: [],
    datos,
    errores: [],
    creada: ts,
    actualizada: ts,
    padre_id: null,
    hijo_id: null,
    subflujo_nodo_id: null,
    disparador_id: args.disparadorId || null,
    evento_id: args.eventoId || null,
  };
  await applyAvanceToCorrida(
    env,
    doc,
    flujo,
    primerPasoEjecutable(flujo.nodos, flujo.aristas, datos),
    ts
  );
  // Fase 2: encolar primer paso (tras inicio) para el consumidor de la cola.
  // esperando_tiempo ya encola despertar con delay en applyAvanceToCorrida.
  if (
    doc.paso_actual &&
    !isTerminal(doc.estado) &&
    doc.estado !== 'esperando_tiempo' &&
    doc.estado !== 'esperando_humano' &&
    doc.estado !== 'esperando_hijo'
  ) {
    if (doc.estado === 'pendiente') doc.estado = 'en_curso';
    await saveCorridaDoc(env, doc);
    await enqueueFirstPaso(pasosMotorDeps(env), doc);
  }
  return doc;
}

async function upsertCorridasIndex(db: D1Database, doc: CorridaDoc) {
  await db
    .prepare(
      `INSERT INTO corridas_index (id, proyecto_id, flujo_id, negocio, estado, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         estado = excluded.estado,
         updated_at = excluded.updated_at,
         flujo_id = excluded.flujo_id,
         negocio = excluded.negocio,
         proyecto_id = excluded.proyecto_id`
    )
    .bind(doc._id, doc.proyecto_id, doc.flujo_id, doc.negocio, doc.estado, doc.actualizada)
    .run();
}

async function saveCorridaDoc(env: Env, doc: CorridaDoc): Promise<void> {
  const mongo = await mongoForProyecto(env, doc.proyecto_id);
  if (!mongo) throw new Error('configure MONGODB_URI');
  doc.actualizada = nowIso();
  await withMongoDb(
    mongo.env,
    async (db) => {
      const { _id, ...rest } = doc;
      await db.collection('corridas').updateOne(
        { _id },
        { $set: { ...rest, _id } },
        { upsert: true }
      );
    },
    mongo.dbName
  );
  await upsertCorridasIndex(env.DB, doc);
}

async function loadCorridaDoc(
  env: Env,
  id: string
): Promise<{ ok: true; doc: CorridaDoc } | { ok: false; status: number; error: string }> {
  const idx = await env.DB.prepare(
    'SELECT id, proyecto_id FROM corridas_index WHERE id = ?'
  )
    .bind(id)
    .first<{ id: string; proyecto_id: string }>();
  if (!idx) return { ok: false, status: 404, error: 'Corrida no encontrada.' };
  const mongo = await mongoForProyecto(env, idx.proyecto_id);
  if (!mongo) {
    return { ok: false, status: 503, error: 'configure MONGODB_URI' };
  }
  try {
    const doc = await withMongoDb(
      mongo.env,
      async (db) => (await db.collection('corridas').findOne({ _id: id })) as CorridaDoc | null,
      mongo.dbName
    );
    if (!doc) return { ok: false, status: 404, error: 'Corrida no encontrada en Mongo.' };
    return { ok: true, doc };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'lectura corrida falló';
    if (msg === 'configure MONGODB_URI') return { ok: false, status: 503, error: msg };
    return {
      ok: false,
      status: 502,
      error: msg.replace(/mongodb(\+srv)?:\/\/[^\s'"]+/gi, 'mongodb://***'),
    };
  }
}

async function loadCorridaWithFlujo(
  env: Env,
  id: string
): Promise<
  | { ok: true; doc: CorridaDoc; flujo: FlujoVersionDoc }
  | { ok: false; status: number; error: string }
> {
  const loaded = await loadCorridaDoc(env, id);
  if (!loaded.ok) return loaded;
  const flujo = await loadFlujoVersion(env.DB, loaded.doc.flujo_id, loaded.doc.flujo_version);
  if (!flujo) return { ok: false, status: 404, error: 'Flujo de la corrida no encontrado.' };
  return { ok: true, doc: loaded.doc, flujo };
}

async function failCorrida(env: Env, doc: CorridaDoc, nodoId: string, error: string) {
  const ts = nowIso();
  doc.estado = 'fallida';
  doc.errores = [...(doc.errores || []), { at: ts, nodo_id: nodoId, error }];
  doc.pasos = (doc.pasos || []).map((p) =>
    p.nodo_id === nodoId && p.estado === 'pendiente' ? { ...p, estado: 'error' as const, fin: ts } : p
  );
  doc.actualizada = ts;
  try {
    await saveCorridaDoc(env, doc);
  } catch {
    /* best effort */
  }
}

async function applyAvanceToCorrida(
  env: Env,
  doc: CorridaDoc,
  flujo: FlujoVersionDoc,
  avance: ReturnType<typeof primerPasoEjecutable>,
  ts: string
): Promise<CorridaDoc> {
  if (avance.kind === 'error') {
    doc.estado = 'fallida';
    doc.errores = [...(doc.errores || []), { at: ts, error: avance.error }];
    doc.actualizada = ts;
    await saveCorridaDoc(env, doc);
    throw new Error(avance.error);
  }

  if (avance.kind === 'fin') {
    doc.paso_actual = avance.nodo.id;
    doc.estado = 'completada';
    doc.actualizada = ts;
    await saveCorridaDoc(env, doc);
    return doc;
  }

  if (avance.kind === 'espera') {
    doc.paso_actual = avance.nodo.id;
    doc.hijo_id = null;
    doc.subflujo_nodo_id = null;
    const segundos = Math.max(0, Math.floor(Number(avance.nodo.segundos) || 0));
    if (segundos > 0) {
      const despertarEn = new Date(Date.now() + segundos * 1000).toISOString();
      doc.estado = 'esperando_tiempo';
      doc.pasos = ensurePasoPendiente(doc.pasos || [], avance.nodo.id, null, ts).map((p) =>
        p.nodo_id === avance.nodo.id && p.estado === 'pendiente'
          ? { ...p, salidas: { _espera_segundos_: segundos, _despertar_en_: despertarEn } }
          : p
      );
      doc.actualizada = ts;
      await saveCorridaDoc(env, doc);
      await setLeaseDeadline(env.DB, doc._id, avance.nodo.id, segundos, ts);
      if (segundos <= 900) {
        await enqueuePaso(
          env,
          { corrida_id: doc._id, nodo_id: avance.nodo.id, intento: 0, despertar: true },
          { delaySeconds: segundos }
        );
      }
      return doc;
    }
    doc.estado = 'esperando_humano';
    doc.actualizada = ts;
    await saveCorridaDoc(env, doc);
    return doc;
  }

  if (avance.kind === 'subflujo') {
    const childFlujo = await loadFlujoVersion(env.DB, avance.flujoId);
    if (!childFlujo) {
      doc.estado = 'fallida';
      doc.errores = [
        ...(doc.errores || []),
        { at: ts, nodo_id: avance.nodo.id, error: `Subflujo «${avance.flujoId}» no existe.` },
      ];
      doc.paso_actual = avance.nodo.id;
      await saveCorridaDoc(env, doc);
      throw new Error(`Subflujo «${avance.flujoId}» no existe.`);
    }
    const childId = newCorridaId();
    const child: CorridaDoc = {
      _id: childId,
      flujo_id: childFlujo.id,
      flujo_version: childFlujo.version,
      proyecto_id: childFlujo.proyectoId,
      negocio: doc.negocio,
      estado: 'pendiente',
      paso_actual: '',
      pasos: [],
      datos: { ...doc.datos },
      errores: [],
      creada: ts,
      actualizada: ts,
      padre_id: doc._id,
      hijo_id: null,
      subflujo_nodo_id: null,
    };
    await applyAvanceToCorrida(
      env,
      child,
      childFlujo,
      primerPasoEjecutable(childFlujo.nodos, childFlujo.aristas, child.datos),
      ts
    );
    if (child.paso_actual && !isTerminal(child.estado)) {
      if (child.estado === 'pendiente') child.estado = 'en_curso';
      await saveCorridaDoc(env, child);
      await enqueueFirstPaso(pasosMotorDeps(env), child);
    }
    doc.paso_actual = avance.nodo.id;
    doc.estado = 'esperando_hijo';
    doc.hijo_id = childId;
    doc.subflujo_nodo_id = avance.nodo.id;
    doc.actualizada = ts;
    await saveCorridaDoc(env, doc);
    return doc;
  }

  // skill
  doc.paso_actual = avance.nodo.id;
  doc.estado = 'en_curso';
  doc.pasos = ensurePasoPendiente(doc.pasos || [], avance.nodo.id, avance.nodo.skill || null, ts);
  doc.hijo_id = null;
  doc.subflujo_nodo_id = null;
  doc.actualizada = ts;
  await saveCorridaDoc(env, doc);
  return doc;
}

async function advanceCorridaAfterSkill(
  env: Env,
  doc: CorridaDoc,
  flujo: FlujoVersionDoc,
  nodoId: string,
  salidas: Record<string, unknown>,
  ts: string
): Promise<CorridaDoc> {
  doc.datos = { ...(doc.datos || {}), ...salidas };
  doc.pasos = markPasoHecho(doc.pasos || [], nodoId, salidas, ts);
  const avance = avanzarDesde(flujo.nodos, flujo.aristas, nodoId, doc.datos);
  return applyAvanceToCorrida(env, doc, flujo, avance, ts);
}

async function resumeParentAfterChild(
  env: Env,
  parent: CorridaDoc,
  flujo: FlujoVersionDoc,
  child: CorridaDoc,
  ts: string
): Promise<CorridaDoc> {
  // Fusionar datos del hijo
  parent.datos = { ...(parent.datos || {}), ...(child.datos || {}) };
  const fromId = parent.subflujo_nodo_id || parent.paso_actual;
  parent.hijo_id = null;
  parent.subflujo_nodo_id = null;
  parent.estado = 'en_curso';
  const avance = avanzarDesde(flujo.nodos, flujo.aristas, fromId, parent.datos);
  return applyAvanceToCorrida(env, parent, flujo, avance, ts);
}

/** Entradas: prioriza corrida.datos; si falta, Mongo (+ fallback D1) como ejecutar/entradas. */
async function resolveEntradasValores(
  env: Env,
  entradas: string[],
  negocio: string,
  datos: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const valores: Record<string, unknown> = {};
  for (const a of entradas) {
    if (Object.prototype.hasOwnProperty.call(datos, a) && datos[a] != null && datos[a] !== '') {
      valores[a] = datos[a];
    } else {
      valores[a] = null;
    }
  }
  const missing = entradas.filter((a) => valores[a] == null || valores[a] === '');
  if (!missing.length) return valores;

  const maps = await loadAnclaMongoMaps(env.DB, missing);
  const baseDatos =
    maps.find((m) => m.baseDatos)?.baseDatos || (await catalogMongoDbHint(env.DB)) || 'software_reservas';
  const proyectoId = await proyectoIdForBaseDatos(env.DB, baseDatos);
  const resolved = await resolveRuntimeMongo(env, baseDatos, proyectoId || undefined);

  if (mongoUriConfigured(resolved.env) && maps.length) {
    try {
      await withMongoDb(
        resolved.env,
        async (db) => {
          const docCache = new Map<string, Record<string, unknown> | null>();
          for (const m of maps) {
            const cacheKey = m.coleccion + '|' + m.baseDatos;
            if (!docCache.has(cacheKey)) {
              docCache.set(
                cacheKey,
                await findDocForCorrida(db, m.coleccion, negocio, datos)
              );
            }
            const doc = docCache.get(cacheKey);
            if (!doc) continue;
            const v = getByPath(doc, m.claveMongo);
            if (v !== undefined) valores[m.ancla] = v;
          }
        },
        baseDatos
      );
    } catch {
      /* leave nulls */
    }
  }

  for (const m of maps) {
    if (valores[m.ancla] != null && valores[m.ancla] !== '') continue;
    const vals = await loadValoresNegocio(env.DB, negocio, m.id, { mask: false });
    if (vals.valorActual) valores[m.ancla] = vals.valorActual;
  }
  return valores;
}

async function loadAnclaMongoMaps(db: D1Database, anclas: string[]): Promise<AnclaMongoMap[]> {
  const out: AnclaMongoMap[] = [];
  for (const a of anclas) {
    const row = await db
      .prepare('SELECT id, ancla, clave_mongo, coleccion, base_datos FROM anclas WHERE ancla = ?')
      .bind(a)
      .first<{
        id: string;
        ancla: string;
        clave_mongo: string;
        coleccion: string;
        base_datos: string;
      }>();
    if (!row) continue;
    out.push({
      ancla: row.ancla,
      id: row.id,
      coleccion: String(row.coleccion || '').trim(),
      claveMongo: String(row.clave_mongo || '').trim(),
      baseDatos: String(row.base_datos || '').trim(),
    });
  }
  return out;
}

async function proyectoIdForBaseDatos(db: D1Database, baseDatos: string): Promise<string | null> {
  const bd = String(baseDatos || '').trim();
  if (!bd) return null;
  const row = await db
    .prepare(
      `SELECT id FROM proyectos WHERE base_datos = ? AND legacy_negocio = 0
       ORDER BY CASE id WHEN 'reservas' THEN 0 ELSE 1 END, id LIMIT 1`
    )
    .bind(bd)
    .first<{ id: string }>();
  return row?.id || null;
}

/** Preferir BD de catálogo (p. ej. software_reservas → reservas) para logs ejecuciones. */
async function defaultProyectoIdForLogs(env: Env): Promise<string> {
  const hint = (await catalogMongoDbHint(env.DB)) || 'software_reservas';
  const fromBd = await proyectoIdForBaseDatos(env.DB, hint);
  if (fromBd) return fromBd;
  const reservas = await env.DB.prepare(`SELECT id FROM proyectos WHERE id = 'reservas'`).first<{
    id: string;
  }>();
  if (reservas?.id) return reservas.id;
  const any = await env.DB.prepare(
    `SELECT id FROM proyectos WHERE legacy_negocio = 0 ORDER BY id LIMIT 1`
  ).first<{ id: string }>();
  return any?.id || 'reservas';
}

async function mayRevealSensitive(c: {
  req: { method: string; header: (n: string) => string | undefined; query: (n: string) => string | undefined };
  env: Env;
}): Promise<boolean> {
  if (String(c.req.query('reveal') || '') !== '1') return false;
  const clave = extractClave(c);
  if (!clave) return false;
  const inv = await c.env.DB.prepare('SELECT clave, revocada FROM invites WHERE clave = ?')
    .bind(clave)
    .first<{ clave: string; revocada: number }>();
  return !!(inv && !inv.revocada);
}

async function hydrateAncla(
  db: D1Database,
  row: Record<string, unknown>,
  opts?: { reveal?: boolean }
) {
  const id = String(row.id);
  const skills = await db.prepare('SELECT skill_id FROM ancla_skills WHERE ancla_id = ?').bind(id).all();
  const mapped = mapAnclaRow(row);
  const reveal = !!opts?.reveal;
  let ejemplo = mapped.ejemplo;
  if (mapped.sensible && !reveal) {
    ejemplo = ejemplo ? maskSensitive(ejemplo) : '';
  }
  // N2: definición = sin valorActual/observaciones (van por negocio_id).
  return {
    ...mapped,
    ejemplo,
    valorActual: '',
    observaciones: [] as Observacion[],
    skills: (skills.results || []).map((r) => (r as { skill_id: string }).skill_id),
  };
}

async function loadValoresNegocio(
  db: D1Database,
  negocioId: string,
  anclaId: string,
  opts?: { mask?: boolean }
): Promise<{ valorActual: string; observaciones: Observacion[] }> {
  const row = await db
    .prepare(
      'SELECT observaciones, valor_actual FROM ancla_valores_negocio WHERE negocio_id = ? AND ancla_id = ?'
    )
    .bind(negocioId, anclaId)
    .first<{ observaciones: string; valor_actual: string }>();
  const observaciones = normalizeObservaciones(row?.observaciones);
  let valorActual =
    String(row?.valor_actual || '').trim() ||
    (observaciones.length ? observaciones[observaciones.length - 1].valor : '');
  let obs = observaciones;
  if (opts?.mask) {
    valorActual = valorActual ? maskSensitive(valorActual) : '';
    obs = observaciones.map((o) => ({ ...o, valor: maskSensitive(o.valor) }));
  }
  return { valorActual, observaciones: obs };
}

/** Prefer catálogo baseDatos (campos_mongo / anclas) over hard-coded default. */
async function catalogMongoDbHint(db: D1Database): Promise<string | undefined> {
  // Prefer schema reservas (software_reservas), no el id del Worker ni arquitectura_reservas.
  const fromProy = await db
    .prepare(
      `SELECT base_datos FROM proyectos
       WHERE legacy_negocio = 0 AND base_datos IS NOT NULL AND trim(base_datos) != ''
       ORDER BY CASE id WHEN 'reservas' THEN 0 ELSE 1 END, id
       LIMIT 1`
    )
    .first<{ base_datos: string }>();
  if (fromProy?.base_datos) return fromProy.base_datos;
  const fromMongo = await db
    .prepare(
      `SELECT base_datos FROM campos_mongo WHERE base_datos IS NOT NULL AND trim(base_datos) != '' LIMIT 1`
    )
    .first<{ base_datos: string }>();
  if (fromMongo?.base_datos) return fromMongo.base_datos;
  const fromAncla = await db
    .prepare(
      `SELECT base_datos FROM anclas WHERE coleccion = 'negocios' AND base_datos IS NOT NULL AND trim(base_datos) != '' LIMIT 1`
    )
    .first<{ base_datos: string }>();
  return fromAncla?.base_datos || undefined;
}

/**
 * Collect nombre/telefono/url/zona_horaria from anclas mapped to colección negocios
 * + valores in ancla_valores_negocio for this negocio_id.
 */
async function buildNegocioFromAnclas(
  db: D1Database,
  negocioId: string,
  opts?: { fallbackNombre?: string; proyectoId?: string }
) {
  const rows = await db
    .prepare(
      `SELECT id, clave_mongo, coleccion, base_datos FROM anclas
       WHERE coleccion = 'negocios'
          OR id IN ('negocio.nombre','negocio.telefono','negocio.url','negocio.zona_horaria')
       ORDER BY id`
    )
    .all();
  const fields: Record<string, string> = {};
  const fieldsUsed: string[] = [];
  let baseDatos: string | undefined;
  for (const raw of rows.results || []) {
    const row = raw as {
      id: string;
      clave_mongo: string;
      coleccion: string;
      base_datos: string;
    };
    if (!baseDatos && row.base_datos) baseDatos = row.base_datos;
    const clave = String(row.clave_mongo || '').trim();
    if (!clave || !['nombre', 'telefono', 'url', 'zona_horaria'].includes(clave)) continue;
    const vals = await loadValoresNegocio(db, negocioId, String(row.id), { mask: false });
    if (vals.valorActual) {
      fields[clave] = vals.valorActual;
      fieldsUsed.push(clave);
    }
  }
  if (!fields.nombre && opts?.fallbackNombre) {
    fields.nombre = opts.fallbackNombre;
    fieldsUsed.push('nombre');
  }
  const doc = buildNegocioDoc(negocioId, fields, {
    proyecto_id: opts?.proyectoId,
    actualizado_en: nowIso(),
  });
  return { doc, fieldsUsed, baseDatos };
}

function mapAnclaRow(row: Record<string, unknown>) {
  const aliases = normalizeAliasList(row.aliases ?? row.alias);
  return {
    id: String(row.id),
    ancla: String(row.ancla || ''),
    etiqueta: String(row.etiqueta || ''),
    claveMongo: String(row.clave_mongo ?? row.claveMongo ?? ''),
    coleccion: String(row.coleccion || ''),
    baseDatos: String(row.base_datos ?? row.baseDatos ?? 'software_reservas'),
    tipo: String(row.tipo || 'string'),
    obligatorio: !!(row.obligatorio === 1 || row.obligatorio === true),
    formato: String(row.formato || ''),
    descripcion: String(row.descripcion || ''),
    ejemplo: String(row.ejemplo || ''),
    hash: String(row.hash || ''),
    color: colorFromRow(row),
    aliases,
    // N2: ficha = definición. Valores por negocio en ancla_valores_negocio.
    observaciones: [] as Observacion[],
    valorActual: '',
    sensible: !!(row.sensible === 1 || row.sensible === true || row.sensible === '1'),
  };
}

function mapMongo(row: Record<string, unknown>) {
  const hijosRaw = row.hijos;
  let hijos: unknown[] = [];
  if (Array.isArray(hijosRaw)) hijos = hijosRaw;
  else if (typeof hijosRaw === 'string' && hijosRaw.trim()) {
    try {
      const p = JSON.parse(hijosRaw);
      if (Array.isArray(p)) hijos = p;
    } catch {
      hijos = [];
    }
  }
  const enumVals = parseStringList(row.enum_json ?? row.enum ?? row.enumJson);
  return {
    id: String(row.id),
    campo: String(row.campo || ''),
    baseDatos: String(row.base_datos ?? row.baseDatos ?? ''),
    coleccion: String(row.coleccion || ''),
    clave: String(row.clave || ''),
    bsonType: String(row.bson_type ?? row.bsonType ?? 'string'),
    obligatorio: !!(row.obligatorio === 1 || row.obligatorio === true),
    descripcion: String(row.descripcion || ''),
    ancla: String(row.ancla || ''),
    hash: String(row.hash || ''),
    color: colorFromRow(row),
    proyeccionMongo: String(row.proyeccion_mongo ?? row.proyeccionMongo ?? '').trim(),
    proyeccionElemento: parseJsonObject(row.proyeccion_elemento ?? row.proyeccionElemento),
    indices: parseJsonArray(row.indices),
    proyecto: String(row.proyecto || ''),
    hijos,
    ...(enumVals.length ? { enum: enumVals } : {}),
  };
}

function mapAgente(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    nombre: String(row.nombre || ''),
    foto: String(row.foto || ''),
    descripcion: String(row.descripcion || ''),
    inviteUsada: String(row.invite_usada ?? row.inviteUsada ?? ''),
    lastSeen: String(row.last_seen ?? row.lastSeen ?? ''),
    hash: String(row.hash || ''),
    color: colorFromRow(row),
    proyectos: parseStringList(row.proyectos),
    lee: parseStringList(row.lee),
    escribe: parseStringList(row.escribe),
  };
}

function mapProyectoRow(
  row: Record<string, unknown>,
  skills: string[],
  versiones: unknown[]
) {
  const colecciones = parseColecciones(row.colecciones);
  const relaciones = parseRelaciones(row.relaciones);
  const agentes = parseStringList(row.agentes_json ?? row.agentes);
  const clusterId = String(row.cluster_id ?? row.clusterId ?? '').trim();
  return {
    id: String(row.id),
    nombre: row.nombre,
    descripcion: row.descripcion || '',
    hash: row.hash || '',
    color: colorFromRow(row),
    baseDatos: String(row.base_datos ?? row.baseDatos ?? '').trim(),
    clusterId: clusterId || null,
    colecciones,
    relaciones,
    agentes,
    legacyNegocio: !!(row.legacy_negocio === 1 || row.legacy_negocio === true || row.legacyNegocio === true),
    skills,
    versiones,
  };
}

function mapClusterRow(row: Record<string, unknown>, proyectos: unknown[]) {
  const lastSync = parseLastSyncRow(row);
  return {
    id: String(row.id),
    nombre: String(row.nombre || ''),
    descripcion: String(row.descripcion || ''),
    hash: String(row.hash || ''),
    color: colorFromRow(row),
    createdAt: String(row.created_at || row.createdAt || ''),
    updatedAt: String(row.updated_at || row.updatedAt || ''),
    autoSync: !!(row.auto_sync === 1 || row.auto_sync === true || row.auto_sync === '1'),
    ...(lastSync ? { lastSync } : {}),
    proyectos,
  };
}

type CrearBdOutcome =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; status: number; body: Record<string, unknown> };

async function ejecutarCrearBd(
  env: Env,
  proyectoId: string,
  opts: { dryRun?: boolean; mock?: boolean; auto?: boolean }
): Promise<CrearBdOutcome> {
  const id = String(proyectoId || '').trim();
  const row = await env.DB.prepare('SELECT * FROM proyectos WHERE id = ?').bind(id).first();
  if (!row) {
    return { ok: false, status: 404, body: { ok: false, error: 'Proyecto no encontrado.' } };
  }
  const proy = await hydrateProyecto(env.DB, row as Record<string, unknown>);
  const earlyFail = async (status: number, error: string): Promise<CrearBdOutcome> => {
    const body = { ok: false, error, proyecto: id, auto: !!opts.auto };
    await recordEsquemaEmpuje(env.DB, {
      proyectoId: id,
      modo: resolveEmpujeModo({
        auto: !!opts.auto,
        dryRun: opts.dryRun === true,
        mock: opts.mock === true,
      }),
      ok: false,
      detalle: body,
    });
    return { ok: false, status, body };
  };
  if (!proy.baseDatos) {
    return earlyFail(400, 'El proyecto no tiene baseDatos.');
  }
  if (!proy.colecciones.length) {
    return earlyFail(400, 'El proyecto no tiene colecciones.');
  }

  const camposRows = await env.DB.prepare('SELECT * FROM campos_mongo WHERE proyecto = ?').bind(id).all();
  const campos = (camposRows.results || []).map((r) =>
    mapMongo(r as Record<string, unknown>)
  ) as MongoCampoShape[];

  const plans = proy.colecciones.map((col: ColeccionDef) => {
    const colCampos = campos.filter((f) => f.coleccion === col.id);
    const indexes: Array<{ keys: Record<string, 1 | -1>; name?: string; unique?: boolean }> = [];
    for (const f of colCampos) {
      const fAny = f as unknown as { indices?: unknown };
      const idxList = Array.isArray(fAny.indices) ? (fAny.indices as unknown[]) : [];
      for (const raw of idxList) {
        if (typeof raw === 'string' && raw.trim()) {
          indexes.push({ keys: { [raw.trim()]: 1 }, name: `${col.id}_${raw.trim()}_1` });
        } else if (raw && typeof raw === 'object') {
          const o = raw as Record<string, unknown>;
          const keys = (o.keys || o) as Record<string, 1 | -1>;
          if (keys && typeof keys === 'object') {
            indexes.push({
              keys,
              name: String(o.name || '') || undefined,
              unique: !!o.unique,
            });
          }
        }
      }
    }
    for (const f of colCampos) {
      const clave = String(f.clave || '');
      if (clave.endsWith('_id') || clave === 'negocio_id' || clave === 'proceso_id') {
        indexes.push({ keys: { [clave.split('.')[0]]: 1 }, name: `${col.id}_${clave.split('.')[0]}_1` });
      }
    }
    return {
      id: col.id,
      validator: buildJsonSchemaForCollection(col.id, campos),
      indexes,
    };
  });

  const dryRun = opts.dryRun === true;
  const resolved = await resolveRuntimeMongo(env, proy.baseDatos, id);
  const clusterId = String(proy.clusterId || '').trim();
  const at = nowIso();

  const record = async (
    summary: LastSyncSummary,
    detalle: Record<string, unknown>,
    empujeOk: boolean
  ) => {
    const modo = resolveEmpujeModo({
      auto: !!opts.auto,
      dryRun: !!summary.dryRun || !!detalle.dryRun,
      mock: !!summary.mock || !!detalle.mock,
    });
    await recordEsquemaEmpuje(env.DB, {
      proyectoId: id,
      ts: at,
      modo,
      ok: empujeOk,
      detalle,
    });
    if (!clusterId) return;
    try {
      await recordClusterLastSync(env.DB, clusterId, summary);
    } catch (err) {
      console.error('recordClusterLastSync', err instanceof Error ? err.message : err);
    }
  };

  if (dryRun || opts.mock === true || !mongoUriConfigured(resolved.env)) {
    const body = {
      ok: true,
      proyecto: id,
      mock: !mongoUriConfigured(resolved.env) || opts.mock === true,
      dryRun: dryRun || !mongoUriConfigured(resolved.env),
      db: proy.baseDatos,
      source: resolved.meta.source,
      auto: !!opts.auto,
      plan: {
        collections: plans.map((p) => ({
          id: p.id,
          validator: p.validator,
          indexes: p.indexes,
        })),
      },
      hint: mongoUriConfigured(resolved.env)
        ? undefined
        : 'Sin URI Mongo: plan en seco. Configura la pestaña Conexión del Cluster de esta Base de datos y vuelve a llamar.',
      created: [] as string[],
      updated: [] as string[],
      indexes: [] as unknown[],
    };
    await record(
      {
        at,
        ok: true,
        proyecto: id,
        auto: !!opts.auto,
        dryRun: !!body.dryRun,
        mock: !!body.mock,
        db: proy.baseDatos,
        hint: body.hint,
      },
      body,
      true
    );
    return { ok: true, body };
  }

  try {
    const result = await createProjectDatabase(resolved.env, proy.baseDatos, plans);
    const body = { ok: true, proyecto: id, auto: !!opts.auto, ...result };
    await record(
      {
        at,
        ok: true,
        proyecto: id,
        auto: !!opts.auto,
        db: result.db || proy.baseDatos,
        created: result.created,
        updated: result.updated,
      },
      body,
      true
    );
    return { ok: true, body };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'crear-bd falló';
    if (msg === 'configure MONGODB_URI') {
      const body = mongoNotConfiguredError();
      await record(
        {
          at,
          ok: false,
          proyecto: id,
          auto: !!opts.auto,
          error: 'Sin URI Mongo configurada en el Cluster.',
        },
        body as Record<string, unknown>,
        false
      );
      return { ok: false, status: 503, body };
    }
    const body = mongoDriverErrorBody(err);
    await record(
      {
        at,
        ok: false,
        proyecto: id,
        auto: !!opts.auto,
        error: body.error,
      },
      body as Record<string, unknown>,
      false
    );
    return { ok: false, status: 502, body };
  }
}

type HonoCtx = {
  env: Env;
  executionCtx: { waitUntil(promise: Promise<unknown>): void };
};

/**
 * Fast path: only arm debounce when autoSync is on (avoids idle waitUntil when off).
 * Re-checks toggle inside the debounced run.
 */
function maybeScheduleSchemaAutoSync(c: HonoCtx, proyectoId: string): void {
  const id = String(proyectoId || '').trim();
  if (!id) return;
  const env = c.env;
  c.executionCtx.waitUntil(
    (async () => {
      const proy = await env.DB.prepare('SELECT cluster_id FROM proyectos WHERE id = ?')
        .bind(id)
        .first<{ cluster_id: string | null }>();
      const clusterId = String(proy?.cluster_id || '').trim();
      if (!clusterId) return;
      const cl = await env.DB.prepare('SELECT auto_sync FROM clusters WHERE id = ?')
        .bind(clusterId)
        .first<{ auto_sync: number }>();
      if (!cl || !(cl.auto_sync === 1)) return;
      scheduleDebouncedSchemaSync(c.executionCtx, id, async (proyId) => {
        const again = await env.DB.prepare(
          `SELECT c.auto_sync AS auto_sync FROM proyectos p
           LEFT JOIN clusters c ON c.id = p.cluster_id WHERE p.id = ?`
        )
          .bind(proyId)
          .first<{ auto_sync: number | null }>();
        if (!again || !(again.auto_sync === 1)) return;
        await ejecutarCrearBd(env, proyId, { auto: true });
      });
    })()
  );
}

async function hydrateCluster(db: D1Database, row: Record<string, unknown>) {
  const id = String(row.id);
  const proyRows = await db
    .prepare(
      'SELECT id, nombre, descripcion, hash, color, base_datos, colecciones, relaciones, agentes_json, legacy_negocio, cluster_id FROM proyectos WHERE cluster_id = ? ORDER BY nombre'
    )
    .bind(id)
    .all();
  const proyectos = (proyRows.results || []).map((r) =>
    mapProyectoRow(r as Record<string, unknown>, [], [])
  );
  return mapClusterRow(row, proyectos);
}

async function hydrateProyecto(db: D1Database, row: Record<string, unknown>) {
  const id = String(row.id);
  const versiones = await db
    .prepare(
      'SELECT numero, fecha, markdown, ruta, nombre_archivo AS nombreArchivo, hash FROM proyecto_versions WHERE proyecto_id = ? ORDER BY numero'
    )
    .bind(id)
    .all();
  const skills = await db.prepare('SELECT skill_id FROM proyecto_skills WHERE proyecto_id = ?').bind(id).all();
  return mapProyectoRow(
    row,
    (skills.results || []).map((r) => (r as { skill_id: string }).skill_id),
    versiones.results || []
  );
}

function normalizeProyectoSoftwareBody(
  body: Record<string, unknown>,
  opts: { id: string; nombre: string }
):
  | {
      nombre: string;
      descripcion: string;
      baseDatos: string;
      colecciones: ColeccionDef[];
      relaciones: RelacionDef[];
      agentes: string[];
      skills: string[];
      legacyNegocio: boolean;
    }
  | { error: string } {
  const nombre = String(opts.nombre || '').trim();
  if (!nombre) return { error: 'nombre obligatorio.' };
  const descripcion = String(body.descripcion || '').trim().slice(0, 280);
  const baseDatos = String(body.baseDatos || body.base_datos || '')
    .trim()
    .replace(/[^a-zA-Z0-9_]/g, '_');
  const colecciones = parseColecciones(body.colecciones);
  const relaciones = parseRelaciones(body.relaciones);
  const relErr = validateRelaciones(colecciones, relaciones);
  if (relErr) return { error: relErr };
  const agentes = parseStringList(body.agentes ?? body.agentes_json);
  const skills = Array.isArray(body.skills)
    ? body.skills.map(String).filter(Boolean)
    : parseStringList(body.skills);
  const legacyNegocio = !!(
    body.legacyNegocio === true ||
    body.legacy_negocio === true ||
    body.legacy_negocio === 1 ||
    body.legacyNegocio === 1
  );
  return {
    nombre,
    descripcion,
    baseDatos,
    colecciones,
    relaciones,
    agentes,
    skills,
    legacyNegocio,
  };
}

async function prepareMongoPersist(
  db: D1Database,
  body: Record<string, unknown>
): Promise<{ campo: ReturnType<typeof normalizeMongoBody> & { proyecto: string; hijos: unknown[] } } | { error: string }> {
  const proyectoId = String(body.proyecto || '').trim();
  if (!proyectoId) return { error: 'proyecto obligatorio (id del software).' };
  if (!ID_RE.test(proyectoId)) return { error: 'proyecto inválido.' };
  const proyRow = await db.prepare('SELECT * FROM proyectos WHERE id = ?').bind(proyectoId).first();
  if (!proyRow) return { error: 'proyecto no encontrado.' };
  const proy = mapProyectoRow(proyRow as Record<string, unknown>, [], []);
  const base = normalizeMongoBody(body);
  if (!base) return { error: 'colección/clave obligatorias.' };
  const colErr = validateColeccionEnProyecto(proy.colecciones, base.coleccion);
  if (colErr) return { error: colErr };
  // baseDatos siempre del proyecto (no se edita a mano en el campo).
  const hijos = Array.isArray(body.hijos) ? body.hijos : base.hijos || [];
  const bsonType = String(base.bsonType || 'string').trim();
  if ((bsonType === 'object' || bsonType === 'array') && !Array.isArray(hijos)) {
    return { error: 'object/array requieren hijos[].' };
  }
  const enumVals = parseStringList(body.enum ?? body.enum_json ?? (base as { enum?: string[] }).enum);
  return {
    campo: {
      ...base,
      baseDatos: proy.baseDatos || base.baseDatos,
      proyecto: proyectoId,
      hijos,
      bsonType,
      ...(enumVals.length ? { enum: enumVals } : {}),
    },
  };
}

async function hydrateFundamento(db: D1Database, row: Record<string, unknown>) {
  const id = String(row.id);
  const versiones = await db
    .prepare(
      'SELECT numero, fecha, markdown, ruta, nombre_archivo AS nombreArchivo, hash FROM fundamento_versions WHERE fundamento_id = ? ORDER BY numero'
    )
    .bind(id)
    .all();
  return {
    id,
    nombre: row.nombre,
    descripcion: row.descripcion || '',
    hash: row.hash || '',
    color: colorFromRow(row),
    versiones: versiones.results || [],
  };
}

function normalizeAnclaBody(body: Record<string, unknown>) {
  let ancla = String(body.ancla || '').trim();
  let id = String(body.id || '').trim();
  if (!ancla && id) ancla = '_' + id + '_';
  if (!ancla) return null;
  if (ancla[0] !== '_') ancla = '_' + ancla;
  if (ancla[ancla.length - 1] !== '_') ancla = ancla + '_';
  if (!id) id = ancla.replace(/^_|_$/g, '');
  if (!id) return null;
  const skills = Array.isArray(body.skills) ? body.skills.map(String).filter(Boolean) : [];
  const aliases = normalizeAliasList(body.aliases ?? body.alias);
  const formato = String(body.formato || '').trim();
  // `sensible` en formato = máscara de ficha (flags tipo "uri, sensible").
  // No aplicar si el cuerpo dice sensible:false, ni dentro de enum:…|sensible|…
  const explicitOff =
    body.sensible === false || body.sensible === 0 || body.sensible === '0';
  const explicitOn =
    body.sensible === true || body.sensible === 1 || body.sensible === '1';
  const formatoMarcaSensible =
    !/^enum:/i.test(formato) && /(^|[,;\s])sensible([,;\s]|$)/i.test(formato);
  const sensible = explicitOff ? false : explicitOn || formatoMarcaSensible;
  return {
    id,
    ancla,
    etiqueta: String(body.etiqueta || '').trim(),
    claveMongo: String(body.claveMongo || body.clave_mongo || id.split('.').pop() || '').trim(),
    coleccion: String(body.coleccion || 'negocios').trim(),
    baseDatos: String(body.baseDatos || body.base_datos || 'software_reservas').trim(),
    tipo: String(body.tipo || 'string').trim(),
    obligatorio: !!(body.obligatorio === true || body.obligatorio === 1 || body.obligatorio === '1'),
    formato,
    descripcion: String(body.descripcion || '').trim(),
    ejemplo: String(body.ejemplo || '').trim(),
    skills,
    hash: String(body.hash || ''),
    aliases,
    // N2: nunca en la ficha; usar POST …/observaciones con negocio_id.
    observaciones: [] as Observacion[],
    valorActual: '',
    sensible,
  };
}

async function prepareAnclaPersistAsync(
  db: D1Database,
  body: Record<string, unknown>,
  selfId?: string
): Promise<
  | { campo: NonNullable<ReturnType<typeof normalizeAnclaBody>>; piiRedactado?: boolean }
  | { error: string }
> {
  const campo = normalizeAnclaBody(body);
  if (!campo) return { error: 'ancla/id inválidos.' };
  const hasObs =
    (Array.isArray(body.observaciones) && body.observaciones.length > 0) ||
    (typeof body.observaciones === 'string' && body.observaciones.trim() && body.observaciones.trim() !== '[]');
  const hasValor =
    (typeof body.valorActual === 'string' && body.valorActual.trim()) ||
    (typeof body.valor_actual === 'string' && body.valor_actual.trim());
  if (hasObs || hasValor) {
    return {
      error:
        'valorActual/observaciones no van en la ficha ancla; usa POST /v1/anclas/:id/observaciones con negocio_id.',
    };
  }
  const rows = await db.prepare('SELECT id, ancla, aliases FROM anclas').all();
  const catalog = (rows.results || []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: String(row.id),
      ancla: String(row.ancla || ''),
      aliases: normalizeAliasList(row.aliases),
    };
  });
  const conflict = findAliasConflicts({
    selfId: selfId || campo.id,
    aliases: campo.aliases,
    catalog,
  });
  if (conflict) return { error: conflict };

  const strictExplicit = body.strict === true || body.strict_pii === true;
  const strictOff = body.strict === false || body.strict_pii === false;
  const strict = strictExplicit || (!strictOff && defaultStrictPii(campo));
  let piiRedactado = false;
  if (looksLikeUrlAncla(campo) && campo.ejemplo) {
    const scrubbed = scrubPiiFromUrl(campo.ejemplo, { strict });
    if (strict && scrubbed.rejectedKeys.length) {
      return { error: 'ejemplo URL con PII en query: ' + scrubbed.rejectedKeys.join(', ') };
    }
    if (scrubbed.redacted) {
      campo.ejemplo = scrubbed.url;
      piiRedactado = true;
    }
  }
  if (looksLikeE164Ancla(campo) && campo.ejemplo) {
    const phone = normalizeE164(campo.ejemplo);
    if (!phone.ok) return { error: phone.error };
    campo.ejemplo = phone.value;
  }
  return { campo, piiRedactado };
}

function normalizeMongoBody(body: Record<string, unknown>) {
  const coleccion = String(body.coleccion || '').trim();
  const clave = String(body.clave || '').trim();
  let campo = String(body.campo || '').trim();
  if (!campo && coleccion && clave) campo = coleccion + '.' + clave;
  if (!campo) return null;
  const id = String(body.id || campo.replace(/\./g, '-')).trim();
  let ancla = String(body.ancla || '').trim();
  if (ancla && ancla[0] !== '_') ancla = '_' + ancla;
  if (ancla && ancla[ancla.length - 1] !== '_') ancla = ancla + '_';
  const proyeccionMongo = String(body.proyeccionMongo || body.proyeccion_mongo || '').trim();
  let proyeccionElemento = parseJsonObject(body.proyeccionElemento ?? body.proyeccion_elemento);
  if (typeof body.proyeccion_elemento === 'string' && body.proyeccion_elemento.trim().startsWith('{')) {
    proyeccionElemento = parseJsonObject(body.proyeccion_elemento);
  }
  if (proyeccionMongo === 'array' && !Object.keys(proyeccionElemento).length && ancla) {
    const base = canonicalFromAncla(ancla).replace(/\.N$/, '');
    proyeccionElemento = {
      nombre: base + '.N.nombre',
      selector: base + '.N.selector',
      clase: base + '.N.clase',
    };
  }
  const indices = parseJsonArray(body.indices);
  let hijos: unknown[] = [];
  if (Array.isArray(body.hijos)) hijos = body.hijos;
  const bsonType = String(
    body.bsonType || body.bson_type || (proyeccionMongo === 'array' ? 'array' : 'string')
  ).trim();
  const enumVals = parseStringList(body.enum ?? body.enum_json ?? body.enumJson);
  return {
    id,
    campo,
    baseDatos: String(body.baseDatos || body.base_datos || '').trim(),
    coleccion: coleccion || campo.split('.')[0],
    clave: clave || campo.split('.').slice(1).join('.'),
    bsonType,
    obligatorio: !!(body.obligatorio === true || body.obligatorio === 1 || body.obligatorio === '1'),
    descripcion: String(body.descripcion || '').trim(),
    ancla,
    hash: String(body.hash || ''),
    proyeccionMongo,
    proyeccionElemento,
    indices,
    proyecto: String(body.proyecto || '').trim(),
    hijos,
    ...(enumVals.length ? { enum: enumVals } : {}),
  };
}
