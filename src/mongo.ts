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

export const DEFAULT_MONGO_DB = 'arquitectura_reservas';

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
    hint: 'Configura la URI en Ajustes → Conexiones del panel, o el secret MONGODB_URI del Worker. La URI no se reexpone por API.',
  };
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
    const message = err instanceof Error ? err.message : 'MongoDB unreachable';
    // Strip accidental URI fragments from driver errors.
    const scrubbed = message.replace(/mongodb(\+srv)?:\/\/[^\s'"]+/gi, 'mongodb://***');
    return { configured: true, connected: false, db, error: scrubbed };
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
