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
  parseLastSyncRow,
  recordClusterLastSync,
  scheduleDebouncedSchemaSync,
  type LastSyncSummary,
} from './schema-auto-sync';
import {
  buildOperativaMermaid,
  findDocForColeccion,
  getByPath,
  normalizeAnclasList,
  setByPath,
  unionAnclas,
  type AnclaMongoMap,
} from './skill-io';

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

/** Public catalog reads — no auth. */
app.get('/v1/skills', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT id, nombre, descripcion, hash, created_at, updated_at FROM skills ORDER BY nombre'
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
    'SELECT id, nombre, descripcion, hash, created_at, updated_at FROM skills WHERE id = ?'
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
  const row = await c.env.DB.prepare('SELECT * FROM skills WHERE id = ?').bind(skillId).first();
  if (!row) return jsonError(c, 404, 'Skill no encontrada.');
  const skill = await hydrateSkill(c.env.DB, row as Record<string, unknown>);
  const entradas = (skill.entradas as string[]) || [];
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
              docCache.set(cacheKey, await findDocForColeccion(db, m.coleccion, negocio));
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
 * Auth: Bearer inv_…  Body: { negocio, valores: { "_ancla_": valor } }
 * 400 si alguna ancla no está en salidas de la skill.
 */
app.post('/v1/ejecutar/:skillId/salidas', async (c) => {
  const skillId = c.req.param('skillId');
  const body = (await c.req.json().catch(() => ({}))) as {
    negocio?: string;
    negocio_id?: string;
    valores?: Record<string, unknown>;
  };
  const negocio = String(body.negocio || body.negocio_id || '').trim();
  if (!negocio) return jsonError(c, 400, 'Falta negocio.');
  if (!ID_RE.test(negocio)) return jsonError(c, 400, 'negocio inválido.');
  const valoresIn = body.valores && typeof body.valores === 'object' ? body.valores : null;
  if (!valoresIn) return jsonError(c, 400, 'Falta valores.');

  const row = await c.env.DB.prepare('SELECT * FROM skills WHERE id = ?').bind(skillId).first();
  if (!row) return jsonError(c, 404, 'Skill no encontrada.');
  const skill = await hydrateSkill(c.env.DB, row as Record<string, unknown>);
  const salidas = new Set((skill.salidas as string[]) || []);
  const keys = Object.keys(valoresIn).map((k) => {
    let a = k.trim();
    if (a && a[0] !== '_') a = '_' + a;
    if (a && a[a.length - 1] !== '_') a = a + '_';
    return a;
  });
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

  const maps = await loadAnclaMongoMaps(c.env.DB, keys);
  const baseDatos =
    maps.find((m) => m.baseDatos)?.baseDatos || (await catalogMongoDbHint(c.env.DB)) || 'software_reservas';
  const proyectoId = await proyectoIdForBaseDatos(c.env.DB, baseDatos);
  const resolved = await resolveRuntimeMongo(c.env, baseDatos, proyectoId || undefined);
  if (!mongoUriConfigured(resolved.env)) {
    return c.json(mongoNotConfiguredError(), 503);
  }

  const escritos: string[] = [];
  try {
    await withMongoDb(
      resolved.env,
      async (db) => {
        const docCache = new Map<string, Record<string, unknown> | null>();
        for (const m of maps) {
          const cacheKey = m.coleccion + '|' + m.baseDatos;
          if (!docCache.has(cacheKey)) {
            let doc = await findDocForColeccion(db, m.coleccion, negocio);
            if (!doc) {
              // Crear stub mínimo
              if (m.coleccion === 'negocios') doc = { _id: negocio };
              else if (m.coleccion === 'procesos') doc = { _id: negocio + '-proceso', negocio_id: negocio };
              else doc = { _id: negocio + '-' + m.coleccion, negocio_id: negocio };
            }
            docCache.set(cacheKey, doc);
          }
          const doc = docCache.get(cacheKey);
          if (!doc) continue;
          const rawKey = Object.keys(valoresIn).find((k) => {
            let a = k.trim();
            if (a && a[0] !== '_') a = '_' + a;
            if (a && a[a.length - 1] !== '_') a = a + '_';
            return a === m.ancla;
          });
          if (rawKey == null) continue;
          setByPath(doc, m.claveMongo, valoresIn[rawKey]);
          escritos.push(m.ancla);
        }
        for (const [cacheKey, doc] of docCache) {
          if (!doc) continue;
          const coleccion = cacheKey.split('|')[0];
          const id = doc._id;
          const { _id, ...rest } = doc;
          await db.collection(coleccion).updateOne(
            { _id: id ?? negocio },
            { $set: { ...rest, _id: id ?? negocio } },
            { upsert: true }
          );
        }
      },
      baseDatos
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'escritura Mongo falló';
    if (msg === 'configure MONGODB_URI') return c.json(mongoNotConfiguredError(), 503);
    const scrubbed = msg.replace(/mongodb(\+srv)?:\/\/[^\s'"]+/gi, 'mongodb://***');
    return jsonError(c, 502, scrubbed);
  }

  // Espejo D1 por negocio (observaciones/valor) cuando hay fila ancla
  const ts = nowIso();
  for (const m of maps) {
    const rawKey = Object.keys(valoresIn).find((k) => {
      let a = k.trim();
      if (a && a[0] !== '_') a = '_' + a;
      if (a && a[a.length - 1] !== '_') a = a + '_';
      return a === m.ancla;
    });
    if (rawKey == null) continue;
    const val = valoresIn[rawKey];
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

  return c.json({ ok: true, skill: skillId, negocio, escritos });
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
  return c.json({
    ok: true,
    skill: skillId,
    nombre: skill.nombre,
    descripcion: skill.descripcion,
    entradas,
    salidas,
    anclas,
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
    `SELECT id, nombre, descripcion, hash, created_at, updated_at,
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
  if (resolved.meta.configured && mongoUriConfigured(resolved.env)) {
    const status = await probeMongoStatus(resolved.env, resolved.meta.db);
    connected = status.connected ? true : false;
    if (status.error) probeError = status.error;
    if (status.mongo) probeMongo = status.mongo;
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
    updatedAt: clusterMeta?.updatedAt || undefined,
    deprecatedWrite:
      'La URI se guarda en el Cluster. Usa GET|POST|DELETE /v1/clusters/:clusterId/mongo-config.',
  });
});

app.get('/v1/clusters', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT id, nombre, descripcion, hash, created_at, updated_at,
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
  if (resolved.meta.configured && mongoUriConfigured(resolved.env)) {
    const status = await probeMongoStatus(resolved.env, resolved.meta.db);
    connected = status.connected ? true : false;
    if (status.error) probeError = status.error;
    if (status.mongo) probeMongo = status.mongo;
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
    updatedAt: clusterMeta?.updatedAt || undefined,
  });
});

app.get('/v1/clusters/:id', async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT id, nombre, descripcion, hash, created_at, updated_at,
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

app.get('/v1/fundamentos', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT id, nombre, descripcion, hash, created_at, updated_at FROM fundamentos ORDER BY nombre'
  ).all();
  const out = [];
  for (const row of rows.results || []) {
    out.push(await hydrateFundamento(c.env.DB, row as Record<string, unknown>));
  }
  return c.json({ ok: true, id: 'fundamentos', nombre: 'Fundamentos', fundamentos: out });
});

app.get('/v1/fundamentos/:id', async (c) => {
  const row = await c.env.DB.prepare(
    'SELECT id, nombre, descripcion, hash, created_at, updated_at FROM fundamentos WHERE id = ?'
  )
    .bind(c.req.param('id'))
    .first();
  if (!row) return jsonError(c, 404, 'Fundamento no encontrado.');
  return c.json({ ok: true, fundamento: await hydrateFundamento(c.env.DB, row as Record<string, unknown>) });
});

app.get('/v1/agentes', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT id, nombre, foto, descripcion, invite_usada, last_seen, hash, proyectos, lee, escribe FROM agentes ORDER BY nombre'
  ).all();
  return c.json({
    ok: true,
    id: 'agentes',
    nombre: 'Agentes',
    agentes: (rows.results || []).map(mapAgente),
  });
});

/** Writes require a valid non-revoked invite key. */
app.use('/v1/*', async (c, next) => {
  if (c.req.method === 'GET' || c.req.method === 'OPTIONS' || c.req.method === 'HEAD') {
    return next();
  }
  // Public agent self-registration / heartbeat use body.clave instead.
  const path = new URL(c.req.url).pathname;
  if (path === '/v1/agentes/registro' || path === '/v1/agentes/latido' || path === '/v1/invites') {
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

  const prev = await c.env.DB.prepare('SELECT id FROM agentes WHERE id = ?').bind(id).first();
  if (prev) {
    await c.env.DB.prepare(
      'UPDATE agentes SET nombre = ?, foto = ?, descripcion = ?, invite_usada = ?, last_seen = ?, hash = ?, updated_at = ? WHERE id = ?'
    )
      .bind(nombre, foto, descripcion, clave, ts, hash, ts, id)
      .run();
  } else {
    await c.env.DB.prepare(
      'INSERT INTO agentes (id, nombre, foto, descripcion, invite_usada, last_seen, hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
      .bind(id, nombre, foto, descripcion, clave, ts, hash, ts, ts)
      .run();
  }
  await c.env.DB.prepare('UPDATE invites SET usada_por = ? WHERE clave = ?').bind(id, clave).run();
  return c.json({ ok: true, id, lastSeen: ts }, prev ? 200 : 201);
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
  const body = (await c.req.json().catch(() => ({}))) as {
    nombre?: string;
    foto?: string;
    descripcion?: string;
    proyectos?: string[];
    lee?: string[];
    escribe?: string[];
  };
  const ag = await c.env.DB.prepare('SELECT * FROM agentes WHERE id = ?').bind(id).first();
  if (!ag) return jsonError(c, 404, 'Agente no encontrado.');
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
  const ts = nowIso();
  const hash = await sha256Hex(id + '|' + nombre + '|' + ((ag as { invite_usada: string }).invite_usada || ''));
  await c.env.DB.prepare(
    `UPDATE agentes SET nombre = ?, foto = ?, descripcion = ?, hash = ?, updated_at = ?,
     proyectos = ?, lee = ?, escribe = ? WHERE id = ?`
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
      id
    )
    .run();
  return c.json({
    ok: true,
    id,
    nombre,
    foto,
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
  };
  const nombre = String(body.nombre || '').trim();
  if (!nombre) return jsonError(c, 400, 'nombre obligatorio.');
  const id = String(body.id || slugId(nombre)).trim();
  if (!ID_RE.test(id)) return jsonError(c, 400, 'id inválido.');
  const markdown = String(body.markdown || '');
  const descripcion = String(body.descripcion || '').trim().slice(0, 280);
  const io = resolveSkillIoFromBody(body);
  const ts = nowIso();
  const hash = await sha256Hex(markdown || id + '|1');
  try {
    await c.env.DB.prepare(
      'INSERT INTO skills (id, nombre, descripcion, hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
      .bind(id, nombre, descripcion, hash, ts, ts)
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
  const skill = await hydrateSkill(
    c.env.DB,
    (await c.env.DB.prepare('SELECT * FROM skills WHERE id = ?').bind(id).first()) as Record<string, unknown>
  );
  return c.json({ ok: true, skill }, 201);
});

app.put('/v1/skills/:id', async (c) => {
  const id = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as {
    nombre?: string;
    descripcion?: string;
    markdown?: string;
    anclas?: string[];
    entradas?: string[];
    salidas?: string[];
  };
  const row = await c.env.DB.prepare('SELECT * FROM skills WHERE id = ?').bind(id).first();
  if (!row) return jsonError(c, 404, 'Skill no encontrada.');
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
  await c.env.DB.prepare('UPDATE skills SET nombre = ?, descripcion = ?, hash = ?, updated_at = ? WHERE id = ?')
    .bind(nombre, descripcion, hash, ts, id)
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
  const skill = await hydrateSkill(
    c.env.DB,
    (await c.env.DB.prepare('SELECT * FROM skills WHERE id = ?').bind(id).first()) as Record<string, unknown>
  );
  return c.json({ ok: true, skill });
});

app.delete('/v1/skills/:id', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM proyecto_skills WHERE skill_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM ancla_skills WHERE skill_id = ?').bind(id),
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
    await c.env.DB.prepare(
      `INSERT INTO anclas (id, ancla, etiqueta, clave_mongo, coleccion, base_datos, tipo, obligatorio, formato, descripcion, ejemplo, hash, aliases, observaciones, valor_actual, sensible, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
  const prevMapped = mapAnclaRow(prev as Record<string, unknown>);
  const prepared = await prepareAnclaPersistAsync(c.env.DB, { ...prevMapped, ...body, id }, id);
  if ('error' in prepared) return jsonError(c, 400, prepared.error);
  const merged = prepared.campo;
  const ts = nowIso();
  await c.env.DB.prepare(
    `UPDATE anclas SET ancla = ?, etiqueta = ?, clave_mongo = ?, coleccion = ?, base_datos = ?, tipo = ?,
     obligatorio = ?, formato = ?, descripcion = ?, ejemplo = ?, hash = ?, aliases = ?, observaciones = ?,
     valor_actual = ?, sensible = ?, updated_at = ? WHERE id = ?`
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
 * Deprecated: global Ajustes → Conexiones URI. Use per-schema
 * POST /v1/proyectos/:id/mongo-config (ficha Base de datos → Conexión).
 */
app.post('/v1/mongo/config', async (c) => {
  return c.json(
    {
      ok: false,
      error: 'deprecated',
      hint: 'La URI global ya no forma parte del producto. Usa POST /v1/proyectos/:id/mongo-config (pestaña Conexión de la Base de datos).',
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
      hint: 'La URI global ya no forma parte del producto. Usa DELETE /v1/proyectos/:id/mongo-config.',
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
    const result = await withMongoDb(
      resolved.env,
      async (db) => upsertNegocio(db, built.doc),
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
    negocio_id?: string;
    negocioId?: string;
  };
  const proyectoId = String(body.proyecto_id || body.proyectoId || '').trim();
  if (!proyectoId) return jsonError(c, 400, 'Falta proyecto_id.');
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
      async (db) => upsertNegocio(db, built.doc),
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
    await c.env.DB.prepare(
      `INSERT INTO campos_mongo (id, campo, base_datos, coleccion, clave, bson_type, obligatorio, descripcion, ancla, hash, proyeccion_mongo, proyeccion_elemento, indices, proyecto, hijos, enum_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
  const prepared = await prepareMongoPersist(c.env.DB, {
    ...mapMongo(prev as Record<string, unknown>),
    ...body,
    id,
  });
  if ('error' in prepared) return jsonError(c, 400, prepared.error);
  const merged = prepared.campo;
  const ts = nowIso();
  await c.env.DB.prepare(
    `UPDATE campos_mongo SET campo = ?, base_datos = ?, coleccion = ?, clave = ?, bson_type = ?,
     obligatorio = ?, descripcion = ?, ancla = ?, hash = ?, proyeccion_mongo = ?, proyeccion_elemento = ?, indices = ?,
     proyecto = ?, hijos = ?, enum_json = ?, updated_at = ? WHERE id = ?`
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
  try {
    await c.env.DB.prepare(
      'INSERT INTO clusters (id, nombre, descripcion, hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
      .bind(id, nombre, descripcion, hash, ts, ts)
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
          `SELECT id, nombre, descripcion, hash, created_at, updated_at,
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
    'SELECT id, nombre, descripcion, auto_sync FROM clusters WHERE id = ?'
  )
    .bind(id)
    .first<{ id: string; nombre: string; descripcion: string; auto_sync: number }>();
  if (!row) return jsonError(c, 404, 'Cluster no encontrado.');
  const body = (await c.req.json().catch(() => ({}))) as {
    nombre?: string;
    descripcion?: string;
    autoSync?: boolean;
    auto_sync?: boolean;
  };
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
  const ts = nowIso();
  const hash = await sha256Hex(id + '|' + nombre + '|' + descripcion + '|' + (autoSync ? '1' : '0'));
  await c.env.DB.prepare(
    'UPDATE clusters SET nombre = ?, descripcion = ?, hash = ?, updated_at = ?, auto_sync = ? WHERE id = ?'
  )
    .bind(nombre, descripcion, hash, ts, autoSync ? 1 : 0, id)
    .run();
  return c.json({
    ok: true,
    cluster: await hydrateCluster(
      c.env.DB,
      (await c.env.DB.prepare(
        `SELECT id, nombre, descripcion, hash, created_at, updated_at,
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
    await c.env.DB.prepare(
      `INSERT INTO proyectos (id, nombre, descripcion, hash, created_at, updated_at,
        base_datos, colecciones, relaciones, agentes_json, legacy_negocio, cluster_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        shape.nombre,
        shape.descripcion,
        hash,
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
  await c.env.DB.prepare(
    `UPDATE proyectos SET nombre = ?, descripcion = ?, hash = ?, updated_at = ?,
     base_datos = ?, colecciones = ?, relaciones = ?, agentes_json = ?, legacy_negocio = ?,
     cluster_id = ? WHERE id = ?`
  )
    .bind(
      shape.nombre,
      shape.descripcion,
      hash,
      ts,
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
  await c.env.DB.prepare('DELETE FROM proyecto_skills WHERE proyecto_id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM proyecto_versions WHERE proyecto_id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM proyectos WHERE id = ?').bind(id).run();
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
  try {
    await c.env.DB.prepare(
      'INSERT INTO fundamentos (id, nombre, descripcion, hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
      .bind(id, nombre, descripcion, hash, ts, ts)
      .run();
  } catch {
    return jsonError(c, 409, 'Ya existe ese fundamento.');
  }
  await c.env.DB.prepare(
    'INSERT INTO fundamento_versions (fundamento_id, numero, fecha, markdown, ruta, nombre_archivo, hash) VALUES (?, 1, ?, ?, ?, ?, ?)'
  )
    .bind(id, todayIso(), markdown, '', id + '.md', hash)
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
  const body = (await c.req.json().catch(() => ({}))) as {
    nombre?: string;
    descripcion?: string;
    markdown?: string;
  };
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
  await c.env.DB.prepare('UPDATE fundamentos SET nombre = ?, descripcion = ?, hash = ?, updated_at = ? WHERE id = ?')
    .bind(nombre, descripcion, hash, ts, id)
    .run();
  await c.env.DB.prepare(
    'INSERT INTO fundamento_versions (fundamento_id, numero, fecha, markdown, ruta, nombre_archivo, hash) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(id, numero, todayIso(), markdown, '', id + '.md', hash)
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

/** Alias público: /v1/esquemas → mismos handlers que /v1/proyectos. */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/v1/esquemas' || url.pathname.startsWith('/v1/esquemas/')) {
      url.pathname = url.pathname.replace(/^\/v1\/esquemas/, '/v1/proyectos');
      request = new Request(url.toString(), request);
    }
    return app.fetch(request, env, ctx);
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

async function replaceSkillAnclas(db: D1Database, skillId: string, anclas: string[]) {
  await replaceSkillIo(db, skillId, [], anclas);
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
}

async function replaceAnclaSkills(db: D1Database, anclaId: string, skills: string[]) {
  await db.prepare('DELETE FROM ancla_skills WHERE ancla_id = ?').bind(anclaId).run();
  for (const s of skills) {
    await db.prepare('INSERT OR IGNORE INTO ancla_skills (ancla_id, skill_id) VALUES (?, ?)').bind(anclaId, s).run();
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
  return {
    id,
    nombre: row.nombre,
    descripcion: row.descripcion || '',
    hash: row.hash || '',
    entradas,
    salidas,
    anclas,
    versiones: versiones.results || [],
  };
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
  if (!proy.baseDatos) {
    return { ok: false, status: 400, body: { ok: false, error: 'El proyecto no tiene baseDatos.' } };
  }
  if (!proy.colecciones.length) {
    return { ok: false, status: 400, body: { ok: false, error: 'El proyecto no tiene colecciones.' } };
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

  const record = async (summary: LastSyncSummary) => {
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
    await record({
      at,
      ok: true,
      proyecto: id,
      auto: !!opts.auto,
      dryRun: !!body.dryRun,
      mock: !!body.mock,
      db: proy.baseDatos,
      hint: body.hint,
    });
    return { ok: true, body };
  }

  try {
    const result = await createProjectDatabase(resolved.env, proy.baseDatos, plans);
    const body = { ok: true, proyecto: id, auto: !!opts.auto, ...result };
    await record({
      at,
      ok: true,
      proyecto: id,
      auto: !!opts.auto,
      db: result.db || proy.baseDatos,
      created: result.created,
      updated: result.updated,
    });
    return { ok: true, body };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'crear-bd falló';
    if (msg === 'configure MONGODB_URI') {
      await record({
        at,
        ok: false,
        proyecto: id,
        auto: !!opts.auto,
        error: 'Sin URI Mongo configurada en el Cluster.',
      });
      return { ok: false, status: 503, body: mongoNotConfiguredError() };
    }
    const body = mongoDriverErrorBody(err);
    await record({
      at,
      ok: false,
      proyecto: id,
      auto: !!opts.auto,
      error: body.error,
    });
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
      'SELECT id, nombre, descripcion, hash, base_datos, colecciones, relaciones, agentes_json, legacy_negocio, cluster_id FROM proyectos WHERE cluster_id = ? ORDER BY nombre'
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
