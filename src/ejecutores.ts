/**
 * Catálogo de ejecutores: validación de tipo + config (Fase 1).
 * La ejecución real (cola / proveedores) es Fase 2.
 */

export const EJECUTOR_TIPOS = [
  'modelo',
  'herramienta',
  'integracion',
  'humano',
  'agente_externo',
] as const;

export type EjecutorTipo = (typeof EJECUTOR_TIPOS)[number];

export const EJECUTOR_IMPLICITO = 'agente_externo';

const PROVEEDORES_MODELO = new Set(['xai', 'openai', 'anthropic']);

export type EjecutorConfig =
  | { proveedor: string; modelo: string; secret: string; temperatura?: number; salida_json?: boolean }
  | { funcion: string }
  | { url: string; metodo?: string; secret?: string; asincrono?: boolean }
  | { rol: string; instrucciones?: string }
  | { agente_id: string }
  | Record<string, unknown>;

export type EjecutorRow = {
  id: string;
  nombre: string;
  tipo: string;
  config_json: string;
  timeout_s: number;
  reintentos: number;
  espera_reintento_s: number;
  activo: number;
  version: number;
  color: string | null;
  created_at: string;
  updated_at: string;
};

export type EjecutorPublic = {
  id: string;
  nombre: string;
  tipo: EjecutorTipo;
  config: Record<string, unknown>;
  timeout_s: number;
  reintentos: number;
  espera_reintento_s: number;
  activo: boolean;
  version: number;
  color: string | null;
  createdAt: string;
  updatedAt: string;
  /** Skills que lo usan (relleno opcional). */
  skills?: string[];
};

export function isEjecutorTipo(raw: unknown): raw is EjecutorTipo {
  return typeof raw === 'string' && (EJECUTOR_TIPOS as readonly string[]).includes(raw);
}

export function parseConfigJson(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function asNonEmptyString(v: unknown, field: string): string | { error: string } {
  const s = String(v ?? '').trim();
  if (!s) return { error: `config.${field} obligatorio.` };
  return s;
}

/**
 * Valida y normaliza `config` según `tipo`.
 * Devuelve el objeto listo para JSON.stringify o { error }.
 */
export function validateEjecutorConfig(
  tipo: EjecutorTipo,
  raw: unknown
): { ok: true; config: Record<string, unknown> } | { ok: false; error: string } {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'config debe ser un objeto JSON.' };
  }
  const c = raw as Record<string, unknown>;

  if (tipo === 'modelo') {
    const proveedor = asNonEmptyString(c.proveedor, 'proveedor');
    if (typeof proveedor !== 'string') return { ok: false, error: proveedor.error };
    if (!PROVEEDORES_MODELO.has(proveedor)) {
      return { ok: false, error: 'config.proveedor debe ser xai|openai|anthropic.' };
    }
    const modelo = asNonEmptyString(c.modelo, 'modelo');
    if (typeof modelo !== 'string') return { ok: false, error: modelo.error };
    const secret = asNonEmptyString(c.secret, 'secret');
    if (typeof secret !== 'string') return { ok: false, error: secret.error };
    const out: Record<string, unknown> = { proveedor, modelo, secret };
    if (c.temperatura !== undefined) {
      const t = Number(c.temperatura);
      if (!Number.isFinite(t) || t < 0 || t > 2) {
        return { ok: false, error: 'config.temperatura debe ser 0..2.' };
      }
      out.temperatura = t;
    } else {
      out.temperatura = 0;
    }
    out.salida_json = c.salida_json === undefined ? true : !!c.salida_json;
    return { ok: true, config: out };
  }

  if (tipo === 'herramienta') {
    const funcion = asNonEmptyString(c.funcion, 'funcion');
    if (typeof funcion !== 'string') return { ok: false, error: funcion.error };
    return { ok: true, config: { funcion } };
  }

  if (tipo === 'integracion') {
    const url = asNonEmptyString(c.url, 'url');
    if (typeof url !== 'string') return { ok: false, error: url.error };
    if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'config.url debe ser http(s).' };
    const metodo = String(c.metodo || 'POST').trim().toUpperCase() || 'POST';
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(metodo)) {
      return { ok: false, error: 'config.metodo no permitido.' };
    }
    const out: Record<string, unknown> = {
      url,
      metodo,
      asincrono: c.asincrono === undefined ? true : !!c.asincrono,
    };
    if (c.secret != null && String(c.secret).trim()) {
      out.secret = String(c.secret).trim();
    }
    return { ok: true, config: out };
  }

  if (tipo === 'humano') {
    const rol = asNonEmptyString(c.rol, 'rol');
    if (typeof rol !== 'string') return { ok: false, error: rol.error };
    return {
      ok: true,
      config: {
        rol,
        instrucciones: String(c.instrucciones ?? '').trim(),
      },
    };
  }

  // agente_externo
  const agenteId = asNonEmptyString(c.agente_id, 'agente_id');
  if (typeof agenteId !== 'string') return { ok: false, error: agenteId.error };
  return { ok: true, config: { agente_id: agenteId } };
}

export function normalizeTimeouts(body: {
  timeout_s?: unknown;
  reintentos?: unknown;
  espera_reintento_s?: unknown;
}): { ok: true; timeout_s: number; reintentos: number; espera_reintento_s: number } | { ok: false; error: string } {
  const timeout_s =
    body.timeout_s === undefined || body.timeout_s === null ? 60 : Number(body.timeout_s);
  const reintentos =
    body.reintentos === undefined || body.reintentos === null ? 2 : Number(body.reintentos);
  const espera_reintento_s =
    body.espera_reintento_s === undefined || body.espera_reintento_s === null
      ? 10
      : Number(body.espera_reintento_s);
  if (!Number.isInteger(timeout_s) || timeout_s < 1 || timeout_s > 3600) {
    return { ok: false, error: 'timeout_s debe ser entero 1..3600 (default 60).' };
  }
  if (!Number.isInteger(reintentos) || reintentos < 0 || reintentos > 20) {
    return { ok: false, error: 'reintentos debe ser entero 0..20 (default 2).' };
  }
  if (!Number.isInteger(espera_reintento_s) || espera_reintento_s < 0 || espera_reintento_s > 3600) {
    return { ok: false, error: 'espera_reintento_s debe ser entero 0..3600 (default 10).' };
  }
  return { ok: true, timeout_s, reintentos, espera_reintento_s };
}

export function rowToEjecutor(
  row: EjecutorRow,
  opts?: { skills?: string[]; colorFromRow?: (r: Record<string, unknown>) => string | null }
): EjecutorPublic {
  const color =
    opts?.colorFromRow?.(row as unknown as Record<string, unknown>) ??
    (row.color && /^#[0-9A-Fa-f]{6}$/.test(String(row.color))
      ? String(row.color).toLowerCase()
      : null);
  const out: EjecutorPublic = {
    id: row.id,
    nombre: row.nombre,
    tipo: row.tipo as EjecutorTipo,
    config: parseConfigJson(row.config_json),
    timeout_s: Number(row.timeout_s) || 60,
    reintentos: Number(row.reintentos) || 0,
    espera_reintento_s: Number(row.espera_reintento_s) || 0,
    activo: !!row.activo,
    version: Number(row.version) || 1,
    color,
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  };
  if (opts?.skills) out.skills = opts.skills;
  return out;
}

/** Acepta ejecutorId (string|null). Vacío/null = sin vínculo (implícito agente_externo). */
export function resolveSkillEjecutorId(body: {
  ejecutorId?: unknown;
  ejecutor_id?: unknown;
}): { set: boolean; id: string | null; error?: string } {
  const raw = body.ejecutorId !== undefined ? body.ejecutorId : body.ejecutor_id;
  if (raw === undefined) return { set: false, id: null };
  if (raw === null || raw === '') return { set: true, id: null };
  const id = String(raw).trim();
  if (!/^[a-z0-9][a-z0-9-]{0,60}$/.test(id)) {
    return { set: true, id: null, error: 'ejecutorId inválido.' };
  }
  return { set: true, id };
}
