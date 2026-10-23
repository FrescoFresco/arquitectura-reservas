/**
 * MongoDB on Cloudflare Workers — official `mongodb` Node driver over TCP.
 *
 * Docs: https://developers.cloudflare.com/workers/databases/third-party-integrations/mongodb/
 * Requires compatibility_date ≥ 2026-08-04 (nodejs_compat on by default) or explicit nodejs_compat.
 * For low-traffic sync/status this direct client is enough; Durable Object pooling is optional later.
 *
 * Never log or return the URI.
 */
import { MongoClient, type Db } from 'mongodb';
import { sanitizeJsonSchemaForMongo } from './proyecto-schema';

export const DEFAULT_MONGO_DB = 'software_reservas';

export type MongoEnv = {
  MONGODB_URI?: string;
  MONGODB_DB?: string;
};

export function mongoUriConfigured(env: MongoEnv): boolean {
  return Boolean(env.MONGODB_URI && String(env.MONGODB_URI).trim());
}

export function resolveMongoDbName(env: MongoEnv, fallback?: string): string {
  const fromEnv = env.MONGODB_DB && String(env.MONGODB_DB).trim();
  if (fromEnv) return fromEnv;
  if (fallback && String(fallback).trim()) return String(fallback).trim();
  return DEFAULT_MONGO_DB;
}

export function mongoNotConfiguredError() {
  return {
    ok: false as const,
    error: 'configure MONGODB_URI',
    hint: 'Configura la URI en la pestaña Conexión de la Base de datos (producto). El secret MONGODB_URI del Worker es solo ops y no sustituye esa URI. La URI no se reexpone por API.',
  };
}

/** Strip accidental URI/password fragments from driver messages. Never put URI in bodies. */
export function scrubMongoSecrets(text: string): string {
  return String(text || '')
    .replace(/mongodb(\+srv)?:\/\/[^\s'"]+/gi, 'mongodb://***')
    .replace(/([?&](?:password|pwd|pass|secret|token)=)[^&\s'"]+/gi, '$1***');
}

export type MongoDriverErrorBody = {
  message: string;
  name?: string;
  code?: string | number;
  codeName?: string;
};

/**
 * Structured Mongo/driver failure for JSON API bodies (no URI/password).
 * Keep top-level `{ ok: false, error }` and attach `mongo` with driver fields when present.
 */
export function mongoDriverErrorBody(err: unknown): {
  ok: false;
  error: string;
  mongo: MongoDriverErrorBody;
} {
  const rawMsg =
    err instanceof Error
      ? err.message
      : err && typeof err === 'object' && 'message' in err
        ? String((err as { message: unknown }).message)
        : String(err || 'MongoDB error');
  const message = scrubMongoSecrets(rawMsg);
  const mongo: MongoDriverErrorBody = { message };
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    if (typeof e.name === 'string' && e.name) mongo.name = e.name;
    if (typeof e.code === 'string' || typeof e.code === 'number') mongo.code = e.code;
    if (typeof e.codeName === 'string' && e.codeName) mongo.codeName = e.codeName;
  } else if (err instanceof Error && err.name) {
    mongo.name = err.name;
  }
  return { ok: false, error: message, mongo };
}

/** Short health label for /health — never probes the cluster. */
export function mongoHealthLabel(env: MongoEnv): 'configured' | 'disconnected' {
  return mongoUriConfigured(env) ? 'configured' : 'disconnected';
}

export type MongoStatus = {
  configured: boolean;
  connected: boolean | null;
  db: string;
  error?: string;
  mongo?: MongoDriverErrorBody;
};

/**
 * Status without leaking the URI. If configured, tries a lightweight ping.
 */
export async function probeMongoStatus(env: MongoEnv, dbHint?: string): Promise<MongoStatus> {
  const db = resolveMongoDbName(env, dbHint);
  if (!mongoUriConfigured(env)) {
    return { configured: false, connected: false, db };
  }
  let client: MongoClient | null = null;
  try {
    client = new MongoClient(String(env.MONGODB_URI).trim(), {
      maxPoolSize: 1,
      minPoolSize: 0,
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
    });
    await client.connect();
    await client.db(db).command({ ping: 1 });
    return { configured: true, connected: true, db };
  } catch (err) {
    const body = mongoDriverErrorBody(err);
    return {
      configured: true,
      connected: false,
      db,
      error: body.error,
      mongo: body.mongo,
    };
  } finally {
    if (client) {
      try {
        await client.close();
      } catch {
        /* ignore */
      }
    }
  }
}

export type WithDbFn<T> = (db: Db) => Promise<T>;

/** Open → run → close. Safe for infrequent sync from Workers. */
export async function withMongoDb<T>(env: MongoEnv, fn: WithDbFn<T>, dbHint?: string): Promise<T> {
  if (!mongoUriConfigured(env)) {
    throw new Error('configure MONGODB_URI');
  }
  const dbName = resolveMongoDbName(env, dbHint);
  const client = new MongoClient(String(env.MONGODB_URI).trim(), {
    maxPoolSize: 1,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 8000,
    connectTimeoutMS: 8000,
  });
  try {
    await client.connect();
    return await fn(client.db(dbName));
  } finally {
    try {
      await client.close();
    } catch {
      /* ignore */
    }
  }
}

export type NegocioDoc = {
  _id: string;
  nombre?: string;
  telefono?: string;
  url?: string;
  zona_horaria?: string;
  actualizado_en?: string;
  proyecto_id?: string;
};

const NEGOCIO_CLAVES = new Set(['nombre', 'telefono', 'url', 'zona_horaria']);

/** Map ancla clave_mongo → field on negocios doc (whitelist). */
export function buildNegocioDoc(
  negocioId: string,
  fields: Record<string, string>,
  extra?: { proyecto_id?: string; actualizado_en?: string }
): NegocioDoc {
  const doc: NegocioDoc = { _id: negocioId };
  for (const [k, v] of Object.entries(fields)) {
    if (!NEGOCIO_CLAVES.has(k)) continue;
    const val = String(v ?? '').trim();
    if (val) (doc as Record<string, string>)[k] = val;
  }
  if (extra?.proyecto_id) doc.proyecto_id = extra.proyecto_id;
  doc.actualizado_en = extra?.actualizado_en || new Date().toISOString();
  return doc;
}

export async function upsertNegocio(db: Db, doc: NegocioDoc) {
  const { _id, ...rest } = doc;
  const result = await db.collection('negocios').updateOne(
    { _id },
    { $set: { ...rest, _id } },
    { upsert: true }
  );
  return {
    negocio_id: _id,
    upserted: Boolean(result.upsertedCount),
    modified: Boolean(result.modifiedCount),
    matched: Boolean(result.matchedCount),
  };
}

export type CreateBdCollectionPlan = {
  id: string;
  validator?: Record<string, unknown>;
  indexes?: Array<{ keys: Record<string, 1 | -1>; name?: string; unique?: boolean }>;
};

export type CreateBdResult = {
  db: string;
  created: string[];
  updated: string[];
  indexes: Array<{ collection: string; name: string }>;
  dryRun?: boolean;
  mock?: boolean;
};

/**
 * Crea (o actualiza) la base: colecciones + $jsonSchema + índices.
 * Nunca recibe ni loguea la URI (usa env ya resuelto).
 */
export async function createProjectDatabase(
  env: MongoEnv,
  dbName: string,
  collections: CreateBdCollectionPlan[]
): Promise<CreateBdResult> {
  return withMongoDb(
    env,
    async (db) => {
      const existing = await db.listCollections({}, { nameOnly: true }).toArray();
      const existingNames = new Set(existing.map((c) => c.name));
      const created: string[] = [];
      const updated: string[] = [];
      const indexes: Array<{ collection: string; name: string }> = [];

      for (const col of collections) {
        const name = String(col.id || '').trim();
        if (!name) continue;
        if (!existingNames.has(name)) {
          if (col.validator) {
            await db.createCollection(name, {
              validator: { $jsonSchema: sanitizeJsonSchemaForMongo(col.validator) },
              validationLevel: 'moderate',
              validationAction: 'warn',
            });
          } else {
            await db.createCollection(name);
          }
          created.push(name);
          existingNames.add(name);
        } else if (col.validator) {
          await db.command({
            collMod: name,
            validator: { $jsonSchema: sanitizeJsonSchemaForMongo(col.validator) },
            validationLevel: 'moderate',
            validationAction: 'warn',
          });
          updated.push(name);
        }

        const indexSpecs = col.indexes || [];
        // Default index on _id already exists; add declared ones.
        for (const spec of indexSpecs) {
          const keys = spec.keys || {};
          if (!Object.keys(keys).length) continue;
          const idxName =
            spec.name ||
            Object.entries(keys)
              .map(([k, v]) => `${k}_${v}`)
              .join('_');
          try {
            await db.collection(name).createIndex(keys, {
              name: idxName,
              unique: !!spec.unique,
              background: true,
            });
            indexes.push({ collection: name, name: idxName });
          } catch {
            // Index may already exist with same keys — ignore.
          }
        }
      }

      return { db: dbName, created, updated, indexes };
    },
    dbName
  );
}
