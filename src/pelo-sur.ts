/** Pelo Sur product helpers: aliases, observaciones, PII-in-URL, N→array projection. */

const PII_QUERY_KEYS = new Set([
  'nombre',
  'name',
  'firstname',
  'lastname',
  'apellido',
  'apellidos',
  'tel',
  'telefono',
  'phone',
  'mobile',
  'movil',
  'email',
  'mail',
  'e-mail',
  'correo',
  'tarjeta',
  'tarjeta_sanitaria',
  'card',
  'dni',
  'nif',
  'nie',
  'passport',
  'pasaporte',
  'ssn',
  'dob',
  'fecha_nacimiento',
  'identidad',
  'cliente',
]);

export type Observacion = {
  valor: string;
  url?: string;
  timestamp: string;
  skill_id?: string;
  visto_en?: string;
  fuente?: string;
};

export function parseJsonArray<T>(raw: unknown, fallback: T[] = []): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (typeof raw !== 'string' || !raw.trim()) return fallback.slice();
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : fallback.slice();
  } catch {
    return fallback.slice();
  }
}

export function parseJsonObject(raw: unknown): Record<string, string> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      out[k] = String(v ?? '');
    }
    return out;
  }
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      out[k] = String(v ?? '');
    }
    return out;
  } catch {
    return {};
  }
}

export function normalizeAliasList(list: unknown): string[] {
  let source: unknown = list;
  if (typeof list === 'string') {
    const trimmed = list.trim();
    if (trimmed.startsWith('[')) {
      try {
        source = JSON.parse(trimmed);
      } catch {
        source = trimmed.split(/[\n,]+/);
      }
    } else {
      source = trimmed.split(/[\n,]+/);
    }
  }
  const raw = Array.isArray(source) ? source : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    let a = String(item || '')
      .trim()
      .replace(/^_+|_+$/g, '');
    // Defend against double-encoded JSON fragments.
    a = a.replace(/^\[?"?|"?\]?$/g, '').replace(/^"|"$/g, '');
    if (!a || a === '[' || a === ']') continue;
    const key = a.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

export function canonicalFromAncla(ancla: string): string {
  return String(ancla || '')
    .trim()
    .replace(/^_+|_+$/g, '');
}

export function looksLikeUrlAncla(campo: {
  id?: string;
  ancla?: string;
  formato?: string;
  tipo?: string;
}): boolean {
  const formato = String(campo.formato || '').toLowerCase();
  const tipo = String(campo.tipo || '').toLowerCase();
  const id = String(campo.id || canonicalFromAncla(campo.ancla || '')).toLowerCase();
  if (formato.includes('uri') || formato.includes('url') || formato === 'sin_pii') return true;
  if (tipo === 'url' || tipo === 'uri') return true;
  return /(^|\.)url(_|$|\.)/.test(id) || id.endsWith('.url') || id.includes('url_');
}

export function isPiiQueryKey(key: string): boolean {
  const k = String(key || '')
    .trim()
    .toLowerCase();
  if (!k) return false;
  if (PII_QUERY_KEYS.has(k)) return true;
  return /^(nombre|name|tel|phone|email|mail|dni|nif|tarjeta)/.test(k);
}

export type PiiUrlResult = {
  url: string;
  redacted: boolean;
  rejectedKeys: string[];
};

/** URL / sin_pii anclas: reject PII query by default (strict). Opt out with strict:false. */
export function defaultStrictPii(campo: {
  id?: string;
  ancla?: string;
  formato?: string;
  tipo?: string;
}): boolean {
  return looksLikeUrlAncla(campo);
}

/**
 * Alias uniqueness: no duplicate aliases across anclas; alias must not equal
 * another ancla's id / canonical name.
 */
export function findAliasConflicts(opts: {
  selfId: string;
  aliases: string[];
  catalog: Array<{ id: string; ancla: string; aliases: string[] }>;
}): string | null {
  const self = opts.selfId.toLowerCase();
  const reservedNames = new Set<string>();
  const aliasOwner = new Map<string, string>();
  for (const row of opts.catalog) {
    const id = String(row.id || '').toLowerCase();
    const canon = canonicalFromAncla(row.ancla).toLowerCase();
    if (id !== self) {
      if (id) reservedNames.add(id);
      if (canon) reservedNames.add(canon);
    }
    for (const a of row.aliases || []) {
      const key = String(a || '').toLowerCase();
      if (!key) continue;
      if (id === self) continue;
      if (!aliasOwner.has(key)) aliasOwner.set(key, row.id);
    }
  }
  const seen = new Set<string>();
  for (const raw of opts.aliases) {
    const a = String(raw || '').trim();
    if (!a) continue;
    const key = a.toLowerCase();
    if (seen.has(key)) return 'Alias duplicado en la misma ficha: ' + a;
    seen.add(key);
    if (key === self || key === canonicalFromAncla('_' + opts.selfId + '_').toLowerCase()) {
      return 'Alias no puede coincidir con el propio id canónico: ' + a;
    }
    if (reservedNames.has(key)) {
      return 'Alias choca con el nombre de otra ancla: ' + a;
    }
    const owner = aliasOwner.get(key);
    if (owner) return 'Alias ya usado por ' + owner + ': ' + a;
  }
  return null;
}

/** Redact PII-looking query keys. If strict and any found, caller may 400. */
export function scrubPiiFromUrl(raw: string, opts?: { strict?: boolean }): PiiUrlResult {
  const input = String(raw || '').trim();
  if (!input) return { url: '', redacted: false, rejectedKeys: [] };
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    // Not a full URL — leave as-is (path templates etc.).
    return { url: input, redacted: false, rejectedKeys: [] };
  }
  const rejectedKeys: string[] = [];
  const next = new URL(parsed.toString());
  const keys = Array.from(next.searchParams.keys());
  for (const key of keys) {
    if (isPiiQueryKey(key)) {
      rejectedKeys.push(key);
      next.searchParams.set(key, '[REDACTED]');
    }
  }
  if (!rejectedKeys.length) return { url: input, redacted: false, rejectedKeys: [] };
  if (opts?.strict) {
    return { url: input, redacted: true, rejectedKeys };
  }
  // Drop empty search if all redacted and we prefer clean templates — keep redacted markers.
  return { url: next.toString(), redacted: true, rejectedKeys };
}

export function maskSensitive(value: string): string {
  const v = String(value || '');
  if (!v) return '';
  if (v.length <= 4) return '••••';
  return '••••••••';
}

export function normalizeObservaciones(list: unknown): Observacion[] {
  const arr = parseJsonArray<Record<string, unknown>>(list, []);
  const out: Observacion[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const valor = String(item.valor ?? '').trim();
    if (!valor) continue;
    out.push({
      valor,
      url: item.url != null ? String(item.url) : undefined,
      timestamp: String(item.timestamp || new Date().toISOString()),
      skill_id: item.skill_id != null ? String(item.skill_id) : undefined,
      visto_en: item.visto_en != null ? String(item.visto_en) : undefined,
      fuente: item.fuente != null ? String(item.fuente) : undefined,
    });
  }
  return out;
}

export function appendObservacion(
  prev: Observacion[],
  body: Record<string, unknown>,
  opts?: { scrubUrlValue?: boolean; strictPii?: boolean }
): { observaciones: Observacion[]; valorActual: string; piiError?: string; piiRedactado?: boolean } {
  let valor = String(body.valor ?? '').trim();
  if (!valor) return { observaciones: prev, valorActual: prev.length ? prev[prev.length - 1].valor : '' };

  let url = body.url != null ? String(body.url).trim() : '';
  let piiRedactado = false;

  if (opts?.scrubUrlValue) {
    const scrubbed = scrubPiiFromUrl(valor, { strict: opts.strictPii });
    if (opts.strictPii && scrubbed.rejectedKeys.length) {
      return {
        observaciones: prev,
        valorActual: prev.length ? prev[prev.length - 1].valor : '',
        piiError: 'URL con PII en query: ' + scrubbed.rejectedKeys.join(', '),
      };
    }
    if (scrubbed.redacted) {
      valor = scrubbed.url;
      piiRedactado = true;
    }
  }
  if (url) {
    const scrubbedUrl = scrubPiiFromUrl(url, { strict: opts?.strictPii });
    if (opts?.strictPii && scrubbedUrl.rejectedKeys.length) {
      return {
        observaciones: prev,
        valorActual: prev.length ? prev[prev.length - 1].valor : '',
        piiError: 'url de observación con PII: ' + scrubbedUrl.rejectedKeys.join(', '),
      };
    }
    if (scrubbedUrl.redacted) {
      url = scrubbedUrl.url;
      piiRedactado = true;
    }
  }

  const obs: Observacion = {
    valor,
    timestamp: String(body.timestamp || new Date().toISOString()),
  };
  if (url) obs.url = url;
  if (body.skill_id != null) obs.skill_id = String(body.skill_id);
  if (body.visto_en != null) obs.visto_en = String(body.visto_en);
  if (body.fuente != null) obs.fuente = String(body.fuente);

  const observaciones = prev.concat([obs]);
  return { observaciones, valorActual: valor, piiRedactado };
}

/**
 * Flat `campos.0.nombre` / `campos.1.selector` → `campos: [{ nombre, selector }, …]`.
 * `elemento` maps output keys → ancla path templates with `N`.
 */
export function proyectarArrayN(input: {
  ruta_ancla?: string;
  elemento?: Record<string, string>;
  valores?: Record<string, string>;
}): { ok: true; clave: string; array: Record<string, string>[] } | { ok: false; error: string } {
  const ruta = String(input.ruta_ancla || 'campos.N').trim();
  // `campos.N` → `campos`; avoid turning `campos.N.N` into `campos.`
  const base = ruta.replace(/(\.N)+$/, '').replace(/\.N\b/g, '');
  if (!base) return { ok: false, error: 'ruta_ancla inválida (ej. campos.N).' };
  const elemento =
    input.elemento && Object.keys(input.elemento).length
      ? input.elemento
      : { nombre: base + '.N.nombre', selector: base + '.N.selector' };
  const valores = input.valores || {};

  const indexRe = new RegExp('^' + escapeRegExp(base) + '\\.(\\d+)(?:\\.|$)');
  const indices = new Set<number>();
  for (const key of Object.keys(valores)) {
    const m = key.match(indexRe);
    if (m) indices.add(Number(m[1]));
  }
  const sorted = Array.from(indices).sort((a, b) => a - b);
  const array: Record<string, string>[] = [];
  for (const i of sorted) {
    const row: Record<string, string> = {};
    for (const [outKey, template] of Object.entries(elemento)) {
      const path = String(template).replace(/\.N\b/g, '.' + i).replace(/\bN\b/g, String(i));
      const bare = path.replace(/^_+|_+$/g, '');
      row[outKey] = valores[bare] ?? valores[path] ?? valores['_' + bare + '_'] ?? '';
    }
    array.push(row);
  }
  return { ok: true, clave: base, array };
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
