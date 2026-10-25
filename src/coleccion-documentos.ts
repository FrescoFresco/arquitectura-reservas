/**
 * Lectura paginada de documentos Mongo por colección (explorador UI).
 * URI nunca en respuesta/logs. Proyección = campos del catálogo (+ _id).
 */
import { ObjectId, type Db, type Document, type Filter } from 'mongodb';

export const DOCS_DEFAULT_LIMIT = 50;
export const DOCS_MAX_LIMIT = 100;
export const DOCS_MAX_TIME_MS = 8000;
export const DOCS_MAX_RESPONSE_BYTES = 1_500_000;

const SAFE_FILTER_OPS = new Set(['$eq', '$in', '$gt', '$gte', '$lt', '$lte', '$ne', '$exists', '$regex']);

export type CatalogCampo = {
  clave: string;
  sensible?: boolean;
};

export type ListDocumentosParams = {
  limit?: number;
  after?: string;
  skip?: number;
  filterJson?: string;
  sort?: string;
  fields?: string;
  negocio?: string;
  incluirSensible?: boolean;
};

export type ListDocumentosResult = {
  limit: number;
  count: number;
  nextAfter: string | null;
  hasMore: boolean;
  projection: string[];
  documentos: Record<string, unknown>[];
};

function jsonSafeValue(v: unknown): unknown {
  if (v == null) return v;
  if (typeof v === 'object' && typeof (v as { toHexString?: () => string }).toHexString === 'function') {
    return String((v as { toHexString: () => string }).toHexString());
  }
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(jsonSafeValue);
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = jsonSafeValue(val);
    }
    return out;
  }
  return v;
}

export function jsonSafeDoc(doc: unknown): Record<string, unknown> {
  return jsonSafeValue(doc) as Record<string, unknown>;
}

export function parseLimitParam(raw: string | undefined | null): { limit: number } | { error: string } {
  if (raw == null || String(raw).trim() === '') return { limit: DOCS_DEFAULT_LIMIT };
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
    return { error: 'limit debe ser un entero ≥ 1.' };
  }
  if (n > DOCS_MAX_LIMIT) {
    return { error: `limit máximo ${DOCS_MAX_LIMIT}.` };
  }
  return { limit: n };
}

/** ObjectId si es hex 24 válido canónico; si no, string (ids de negocio). */
export function coerceDocId(raw: string): unknown {
  const s = String(raw || '').trim();
  if (!s) return s;
  if (/^[a-fA-F0-9]{24}$/.test(s)) {
    try {
      const oid = new ObjectId(s);
      if (oid.toHexString() === s.toLowerCase()) return oid;
    } catch {
      /* string */
    }
  }
  return s;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Filter allowlist: operadores seguros; rechaza $where/$function/$expr/…
 * `$regex` string ≤ 200 chars.
 */
export function sanitizeFilter(
  raw: unknown,
  allowedFields: Set<string>
): { filter: Filter<Document> } | { error: string } {
  if (raw == null || (typeof raw === 'string' && !raw.trim())) {
    return { filter: {} };
  }
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { error: 'filter JSON inválido.' };
    }
  }
  if (!isPlainObject(parsed)) return { error: 'filter debe ser un objeto.' };

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(parsed)) {
    if (key.startsWith('$')) {
      return { error: `operador de filtro no permitido: ${key}` };
    }
    if (key !== '_id' && !allowedFields.has(key)) {
      return { error: `campo de filtro no permitido: ${key}` };
    }
    if (isPlainObject(val)) {
      const ops = Object.keys(val);
      if (ops.some((op) => op.startsWith('$'))) {
        for (const op of ops) {
          if (!SAFE_FILTER_OPS.has(op)) {
            return { error: `operador no permitido: ${op}` };
          }
          if (op === '$regex') {
            const rx = val[op];
            const s = typeof rx === 'string' ? rx : String(rx ?? '');
            if (s.length > 200) return { error: '$regex demasiado largo (máx 200).' };
          }
          if (op === '$in' && !Array.isArray((val as Record<string, unknown>)[op])) {
            return { error: '$in requiere un array.' };
          }
        }
        out[key] = val;
        continue;
      }
    }
    out[key] = val;
  }
  return { filter: out as Filter<Document> };
}

export type BuiltProjection =
  | { projection: Record<string, 1>; keys: string[]; fromCatalog: true }
  | { projection: null; keys: string[]; fromCatalog: false }
  | { error: string };

/**
 * Proyección del explorador: claves del catálogo Campos Mongo (+ `_id`).
 * Si el catálogo no tiene campos (y no hay `fields`), no restringe el find:
 * la lista de columnas se deriva de la primera página de documentos.
 */
export function buildProjection(
  campos: CatalogCampo[],
  opts?: { fields?: string; incluirSensible?: boolean }
): BuiltProjection {
  const fields = String(opts?.fields || '').trim();
  if (fields === '*') {
    return { error: 'fields=* no permitido en el explorador (usa proyección de catálogo).' };
  }

  const incluirSensible = !!opts?.incluirSensible;
  const catalogKeys = campos
    .filter((c) => c.clave && (incluirSensible || !c.sensible))
    .map((c) => c.clave);

  if (!fields && catalogKeys.length === 0) {
    return { projection: null, keys: ['_id'], fromCatalog: false };
  }

  let keys: string[];
  if (fields) {
    const wanted = fields.split(',').map((s) => s.trim()).filter(Boolean);
    const allow = new Set(['_id', ...catalogKeys]);
    for (const k of wanted) {
      if (!allow.has(k)) return { error: `campo no permitido en fields: ${k}` };
    }
    keys = wanted.includes('_id') ? wanted : ['_id', ...wanted];
  } else {
    keys = ['_id', ...catalogKeys.filter((k) => k !== '_id')];
  }

  const projection: Record<string, 1> = {};
  for (const k of keys) projection[k] = 1;
  return { projection, keys, fromCatalog: true };
}

/** Claves top-level de la página (`_id` primero; orden estable por aparición). */
export function deriveKeysFromDocs(docs: Record<string, unknown>[]): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const d of docs) {
    for (const k of Object.keys(d || {})) {
      if (!k || seen.has(k)) continue;
      seen.add(k);
      keys.push(k);
    }
  }
  if (!seen.has('_id')) {
    keys.unshift('_id');
  } else {
    const i = keys.indexOf('_id');
    if (i > 0) {
      keys.splice(i, 1);
      keys.unshift('_id');
    }
  }
  return keys;
}

export function parseSort(
  sortRaw: string | undefined | null,
  allowedFields: Set<string>
): { sort: Record<string, 1 | -1> } | { error: string } {
  const s = String(sortRaw || '_id').trim() || '_id';
  const desc = s.startsWith('-');
  const field = desc ? s.slice(1) : s;
  if (!field || (field !== '_id' && !allowedFields.has(field))) {
    return { error: `sort no permitido: ${s}` };
  }
  return { sort: { [field]: desc ? -1 : 1 } };
}

function applyAfter(filter: Filter<Document>, after: string): Filter<Document> {
  const id = coerceDocId(after);
  const clause: Filter<Document> = { _id: { $gt: id as never } };
  if (Object.keys(filter).length === 0) return clause;
  return { $and: [filter, clause] };
}

export async function listColeccionDocumentos(
  db: Db,
  coleccion: string,
  campos: CatalogCampo[],
  params: ListDocumentosParams
): Promise<ListDocumentosResult | { error: string; status?: number }> {
  const lim = params.limit ?? DOCS_DEFAULT_LIMIT;
  if (lim > DOCS_MAX_LIMIT) return { error: `limit máximo ${DOCS_MAX_LIMIT}.`, status: 400 };

  const allowed = new Set(campos.map((c) => c.clave).filter(Boolean));
  const proj = buildProjection(campos, {
    fields: params.fields,
    incluirSensible: params.incluirSensible,
  });
  if ('error' in proj) return { error: proj.error, status: 400 };

  const sortRes = parseSort(params.sort, allowed);
  if ('error' in sortRes) return { error: sortRes.error, status: 400 };

  let filter: Filter<Document> = {};
  if (params.filterJson) {
    const sf = sanitizeFilter(params.filterJson, allowed);
    if ('error' in sf) return { error: sf.error, status: 400 };
    filter = sf.filter;
  }

  const negocio = String(params.negocio || '').trim();
  if (negocio) {
    const negFilter: Filter<Document> = {
      $or: [{ negocio_id: negocio }, { _id: coerceDocId(negocio) as never }],
    };
    filter = Object.keys(filter).length ? { $and: [filter, negFilter] } : negFilter;
  }

  const after = String(params.after || '').trim();
  if (after) filter = applyAfter(filter, after);

  const skip = Math.max(0, Number(params.skip) || 0);
  if (skip > 10_000) return { error: 'skip demasiado alto (máx 10000); usa after.', status: 400 };

  const col = db.collection(coleccion);
  let cursor = col.find(filter);
  if (proj.projection) cursor = cursor.project(proj.projection);
  cursor = cursor
    .sort(sortRes.sort)
    .maxTimeMS(DOCS_MAX_TIME_MS)
    .limit(lim + 1);
  if (skip) cursor = cursor.skip(skip);

  const rows = await cursor.toArray();
  const hasMore = rows.length > lim;
  const page = hasMore ? rows.slice(0, lim) : rows;
  const documentos = page.map((d) => jsonSafeDoc(d));
  const last = documentos[documentos.length - 1];
  const nextAfter =
    hasMore && last && last._id != null ? String(last._id) : null;

  const projection = proj.fromCatalog ? proj.keys : deriveKeysFromDocs(documentos);

  return {
    limit: lim,
    count: documentos.length,
    nextAfter,
    hasMore,
    projection,
    documentos,
  };
}

export async function getColeccionDocumento(
  db: Db,
  coleccion: string,
  docId: string,
  campos: CatalogCampo[],
  opts?: { incluirSensible?: boolean }
): Promise<{ documento: Record<string, unknown> } | { error: string; status: number }> {
  const id = coerceDocId(docId);
  const col = db.collection(coleccion);
  let doc = await col.findOne({ _id: id as never }, { maxTimeMS: DOCS_MAX_TIME_MS });
  if (!doc && typeof id !== 'string') {
    doc = await col.findOne({ _id: String(docId) as never }, { maxTimeMS: DOCS_MAX_TIME_MS });
  }
  if (!doc) return { error: 'Documento no encontrado.', status: 404 };

  const safe = jsonSafeDoc(doc);
  if (!opts?.incluirSensible) {
    for (const c of campos) {
      if (c.sensible && c.clave && c.clave !== '_id') {
        if (Object.prototype.hasOwnProperty.call(safe, c.clave)) {
          safe[c.clave] = '[redactado]';
        }
      }
    }
  }
  return { documento: safe };
}

export function assertResponseSize(payload: unknown): { error: string } | null {
  try {
    const size = new TextEncoder().encode(JSON.stringify(payload)).length;
    if (size > DOCS_MAX_RESPONSE_BYTES) {
      return { error: `respuesta demasiado grande (~${size} bytes; máx ${DOCS_MAX_RESPONSE_BYTES}). Baja limit.` };
    }
  } catch {
    /* ignore */
  }
  return null;
}
