/**
 * Persist MongoDB URI encrypted-at-rest in D1 (AES-GCM).
 *
 * Choice: D1 + ENCRYPTION_KEY (Worker secret) rather than Cloudflare Secrets API —
 * the panel can rotate the URI without wrangler/CLI; secrets API is write-once from
 * humans.
 *
 * Product path: URI on **Cluster** (`mongo_config_cluster`). Bases de datos
 * (proyectos) reference a cluster via `cluster_id`.
 * Env `MONGODB_URI` is ops-only (health / status / sync without proyecto).
 *
 * Never log or return the URI. Status may expose a safe host last-4 hint only.
 */

export type StoredMongoConfig = {
  uri: string;
  db?: string;
  hint: string;
  updatedAt: string;
};

export type MongoConfigMeta = {
  configured: boolean;
  source: 'cluster' | 'env' | 'none';
  hint: string;
  db: string;
};

/** Last 4 of hostname only (never password / user). */
export function safeUriHint(uri: string): string {
  try {
    const trimmed = String(uri || '').trim();
    if (!trimmed) return '';
    // mongodb+srv://user:pass@host/db?… → host
    const at = trimmed.indexOf('@');
    if (at < 0) return '';
    const after = trimmed.slice(at + 1);
    const hostPart = after.split(/[/?#]/)[0] || '';
    // strip port
    const host = hostPart.split(':')[0].trim().toLowerCase();
    if (host.length < 4) return host ? '…' + host : '';
    return '…' + host.slice(-4);
  } catch {
    return '';
  }
}

export function isValidMongoUri(uri: string): boolean {
  const u = String(uri || '').trim();
  return /^mongodb(\+srv)?:\/\//i.test(u) && u.includes('@');
}

async function deriveAesKey(secret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', material, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptUri(uri: string, encryptionKey: string): Promise<{ ciphertext: string; iv: string }> {
  const key = await deriveAesKey(encryptionKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipherBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(uri)
  );
  return {
    ciphertext: bytesToB64(new Uint8Array(cipherBuf)),
    iv: bytesToB64(iv),
  };
}

export async function decryptUri(
  ciphertextB64: string,
  ivB64: string,
  encryptionKey: string
): Promise<string> {
  const key = await deriveAesKey(encryptionKey);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64ToBytes(ivB64) },
    key,
    b64ToBytes(ciphertextB64)
  );
  return new TextDecoder().decode(plain);
}

function bytesToB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

function b64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

type ConfigRow = {
  ciphertext: string;
  iv: string;
  uri_hint: string;
  db_name: string;
  updated_at: string;
};

/** ——— Per-cluster (URI Atlas del cluster) ——— */

export async function readClusterMongoMeta(
  db: D1Database,
  clusterId: string
): Promise<{
  present: boolean;
  hint: string;
  dbName: string;
  updatedAt: string;
} | null> {
  const id = String(clusterId || '').trim();
  if (!id) return null;
  const row = await db
    .prepare(
      'SELECT ciphertext, iv, uri_hint, db_name, updated_at FROM mongo_config_cluster WHERE cluster_id = ?'
    )
    .bind(id)
    .first<ConfigRow>();
  if (!row) return null;
  return {
    present: true,
    hint: String(row.uri_hint || ''),
    dbName: String(row.db_name || ''),
    updatedAt: String(row.updated_at || ''),
  };
}

export async function loadClusterStoredUri(
  db: D1Database,
  encryptionKey: string | undefined,
  clusterId: string
): Promise<StoredMongoConfig | null> {
  const id = String(clusterId || '').trim();
  if (!id) return null;
  const row = await db
    .prepare(
      'SELECT ciphertext, iv, uri_hint, db_name, updated_at FROM mongo_config_cluster WHERE cluster_id = ?'
    )
    .bind(id)
    .first<ConfigRow>();
  if (!row) return null;
  if (!encryptionKey || !String(encryptionKey).trim()) {
    throw new Error('ENCRYPTION_KEY missing');
  }
  const uri = await decryptUri(row.ciphertext, row.iv, String(encryptionKey).trim());
  const dbName = String(row.db_name || '').trim();
  return {
    uri,
    db: dbName || undefined,
    hint: String(row.uri_hint || '') || safeUriHint(uri),
    updatedAt: String(row.updated_at || ''),
  };
}

export async function saveClusterStoredUri(
  db: D1Database,
  encryptionKey: string,
  clusterId: string,
  uri: string,
  dbName: string | undefined
): Promise<{ hint: string; db: string; updatedAt: string }> {
  const id = String(clusterId || '').trim();
  if (!id) throw new Error('Falta cluster_id');
  const trimmed = String(uri).trim();
  const { ciphertext, iv } = await encryptUri(trimmed, encryptionKey);
  const hint = safeUriHint(trimmed);
  const dbVal = (dbName && String(dbName).trim()) || '';
  const updatedAt = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO mongo_config_cluster (cluster_id, ciphertext, iv, uri_hint, db_name, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(cluster_id) DO UPDATE SET
         ciphertext = excluded.ciphertext,
         iv = excluded.iv,
         uri_hint = excluded.uri_hint,
         db_name = excluded.db_name,
         updated_at = excluded.updated_at`
    )
    .bind(id, ciphertext, iv, hint, dbVal, updatedAt)
    .run();
  return { hint, db: dbVal, updatedAt };
}

export async function clearClusterStoredUri(db: D1Database, clusterId: string): Promise<boolean> {
  const id = String(clusterId || '').trim();
  if (!id) return false;
  const res = await db
    .prepare('DELETE FROM mongo_config_cluster WHERE cluster_id = ?')
    .bind(id)
    .run();
  return Boolean(res.meta?.changes);
}
