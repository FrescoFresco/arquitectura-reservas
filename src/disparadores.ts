/**
 * Disparadores de flujo (Fase 1: datos + CRUD + validación).
 * El motor de disparo (eventos, cron CF, webhook → corridas) es Fase 2.
 */

export type DisparadorTipo = 'manual' | 'horario' | 'cambio_datos' | 'webhook';

export type OperacionCambio = 'crear' | 'actualizar' | 'borrar';

export const PIPELINE_STAGES_ALLOWED = [
  '$match',
  '$lookup',
  '$project',
  '$group',
  '$sort',
  '$limit',
  '$unwind',
  '$addFields',
] as const;

export const PIPELINE_STAGES_FORBIDDEN = ['$out', '$merge', '$function'] as const;

const OPERACIONES_OK = new Set<OperacionCambio>(['crear', 'actualizar', 'borrar']);

export type DisparadorDoc = {
  id: string;
  flujo_id: string;
  tipo: DisparadorTipo;
  activo: boolean;
  cron: string | null;
  coleccion: string | null;
  operaciones: OperacionCambio[] | null;
  token: string | null;
  pipeline: Record<string, unknown>[] | null;
  anti_bucle: boolean;
  agrupar_segundos: number;
  negocio: string;
  version: number;
  creado: string;
  actualizado: string;
  ultima_vez: string | null;
};

export type ValidateDisparadorResult =
  | { ok: true; value: Omit<DisparadorDoc, 'id' | 'flujo_id' | 'version' | 'creado' | 'actualizado' | 'ultima_vez' | 'token'> & { token?: string | null }; avisos: string[] }
  | { ok: false; error: string; avisos?: string[] };

export function isDisparadorTipo(t: string): t is DisparadorTipo {
  return t === 'manual' || t === 'horario' || t === 'cambio_datos' || t === 'webhook';
}

/** Token aleatorio de 32 caracteres [a-z0-9]. */
export function generateWebhookToken(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < 32; i++) out += alphabet[bytes[i]! % alphabet.length];
  return out;
}

/**
 * Cron de 5 campos (minuto hora día-mes mes día-semana).
 * Acepta *, N, N-M, N/S, listas A,B y combinaciones N-M/S.
 */
export function validateCron5(expr: string): string | null {
  const s = String(expr || '').trim();
  if (!s) return 'cron obligatorio para tipo horario.';
  const parts = s.split(/\s+/);
  if (parts.length !== 5) {
    return `cron inválido: se esperan 5 campos, hay ${parts.length}.`;
  }
  const ranges: Array<[number, number]> = [
    [0, 59], // minuto
    [0, 23], // hora
    [1, 31], // día mes
    [1, 12], // mes
    [0, 7], // día semana (0 y 7 = domingo)
  ];
  const names = ['minuto', 'hora', 'día-mes', 'mes', 'día-semana'];
  for (let i = 0; i < 5; i++) {
    const err = validateCronField(parts[i]!, ranges[i]![0], ranges[i]![1], names[i]!);
    if (err) return err;
  }
  return null;
}

function validateCronField(field: string, min: number, max: number, label: string): string | null {
  if (field === '*') return null;
  const chunks = field.split(',');
  for (const chunk of chunks) {
    const stepParts = chunk.split('/');
    if (stepParts.length > 2) return `cron inválido en ${label}: «${field}».`;
    const base = stepParts[0]!;
    const step = stepParts[1];
    if (step != null) {
      if (!/^\d+$/.test(step) || Number(step) < 1) {
        return `cron inválido en ${label}: paso «${step}».`;
      }
    }
    if (base === '*') continue;
    const range = base.split('-');
    if (range.length === 1) {
      if (!/^\d+$/.test(range[0]!)) return `cron inválido en ${label}: «${field}».`;
      const n = Number(range[0]);
      if (n < min || n > max) return `cron inválido en ${label}: ${n} fuera de ${min}-${max}.`;
    } else if (range.length === 2) {
      if (!/^\d+$/.test(range[0]!) || !/^\d+$/.test(range[1]!)) {
        return `cron inválido en ${label}: «${field}».`;
      }
      const a = Number(range[0]);
      const b = Number(range[1]);
      if (a < min || b > max || a > b) {
        return `cron inválido en ${label}: rango «${base}» fuera de ${min}-${max}.`;
      }
    } else {
      return `cron inválido en ${label}: «${field}».`;
    }
  }
  return null;
}

/** ¿La expresión de 5 campos coincide con `date` en la zona dada? (default Atlantic/Canary). */
export function cronMatchesAt(
  expr: string,
  date: Date = new Date(),
  timeZone = 'Atlantic/Canary'
): boolean {
  const parts = String(expr || '').trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const tz = getTzCronParts(date, timeZone);
  return (
    cronFieldMatches(parts[0]!, tz.minute, 0, 59) &&
    cronFieldMatches(parts[1]!, tz.hour, 0, 23) &&
    cronFieldMatches(parts[2]!, tz.day, 1, 31) &&
    cronFieldMatches(parts[3]!, tz.month, 1, 12) &&
    cronFieldMatchesDow(parts[4]!, tz.dow)
  );
}

export function getTzCronParts(
  date: Date,
  timeZone = 'Atlantic/Canary'
): { minute: number; hour: number; day: number; month: number; dow: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
    weekday: 'short',
  });
  const bag: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== 'literal') bag[p.type] = p.value;
  }
  const wd = String(bag.weekday || '').slice(0, 3).toLowerCase();
  const dowMap: Record<string, number> = {
    sun: 0,
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6,
  };
  return {
    minute: Number(bag.minute) || 0,
    hour: Number(bag.hour) || 0,
    day: Number(bag.day) || 1,
    month: Number(bag.month) || 1,
    dow: dowMap[wd] ?? 0,
  };
}

function cronFieldMatches(field: string, value: number, min: number, max: number): boolean {
  if (field === '*') return true;
  for (const chunk of field.split(',')) {
    const stepParts = chunk.split('/');
    const base = stepParts[0]!;
    const step = stepParts[1] ? Number(stepParts[1]) : 1;
    if (!Number.isFinite(step) || step < 1) continue;
    let start = min;
    let end = max;
    if (base !== '*') {
      const range = base.split('-');
      if (range.length === 1) {
        if (!/^\d+$/.test(range[0]!)) continue;
        start = Number(range[0]);
        end = start;
      } else if (range.length === 2 && /^\d+$/.test(range[0]!) && /^\d+$/.test(range[1]!)) {
        start = Number(range[0]);
        end = Number(range[1]);
      } else continue;
    }
    for (let n = start; n <= end; n += step) {
      if (n === value) return true;
    }
  }
  return false;
}

/** Día de semana: 0 y 7 = domingo. */
function cronFieldMatchesDow(field: string, dow: number): boolean {
  if (field === '*') return true;
  for (const chunk of field.split(',')) {
    const stepParts = chunk.split('/');
    const base = stepParts[0]!;
    const step = stepParts[1] ? Number(stepParts[1]) : 1;
    if (!Number.isFinite(step) || step < 1) continue;
    let start = 0;
    let end = 7;
    if (base !== '*') {
      const range = base.split('-');
      if (range.length === 1) {
        if (!/^\d+$/.test(range[0]!)) continue;
        start = Number(range[0]);
        end = start;
      } else if (range.length === 2 && /^\d+$/.test(range[0]!) && /^\d+$/.test(range[1]!)) {
        start = Number(range[0]);
        end = Number(range[1]);
      } else continue;
    }
    for (let n = start; n <= end; n += step) {
      const norm = n === 7 ? 0 : n;
      if (norm === dow) return true;
    }
  }
  return false;
}

export function parsePipeline(raw: unknown): { ok: true; pipeline: Record<string, unknown>[] | null } | { ok: false; error: string } {
  if (raw == null || raw === '') return { ok: true, pipeline: null };
  let list: unknown = raw;
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw);
    } catch {
      return { ok: false, error: 'pipeline no es JSON válido.' };
    }
  }
  if (!Array.isArray(list)) return { ok: false, error: 'pipeline debe ser un array de etapas.' };
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < list.length; i++) {
    const stage = list[i];
    if (!stage || typeof stage !== 'object' || Array.isArray(stage)) {
      return { ok: false, error: `pipeline etapa[${i}] debe ser un objeto.` };
    }
    out.push(stage as Record<string, unknown>);
  }
  return { ok: true, pipeline: out };
}

/** Rechaza etapas no allowlist; nombra la etapa prohibida. */
export function validatePipelineStages(pipeline: Record<string, unknown>[] | null): string | null {
  if (!pipeline || !pipeline.length) return null;
  const allowed = new Set<string>(PIPELINE_STAGES_ALLOWED);
  for (let i = 0; i < pipeline.length; i++) {
    const keys = Object.keys(pipeline[i]!).filter((k) => k.startsWith('$'));
    if (!keys.length) {
      return `pipeline etapa[${i}]: falta operador $…`;
    }
    for (const op of keys) {
      if (!allowed.has(op)) {
        return `pipeline etapa no permitida: ${op}`;
      }
    }
  }
  return null;
}

/** Extrae ids de ancla `_…_` citados en el pipeline (claves y strings). */
export function extractAnclaIdsFromPipeline(pipeline: Record<string, unknown>[] | null): string[] {
  if (!pipeline) return [];
  const found = new Set<string>();
  const re = /_[a-zA-Z0-9]+(?:[./][a-zA-Z0-9_]+)*_/g;
  const walk = (v: unknown) => {
    if (typeof v === 'string') {
      let m: RegExpExecArray | null;
      re.lastIndex = 0;
      while ((m = re.exec(v))) found.add(m[0]);
      return;
    }
    if (Array.isArray(v)) {
      for (const item of v) walk(item);
      return;
    }
    if (v && typeof v === 'object') {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(k))) found.add(m[0]);
        walk(val);
      }
    }
  };
  walk(pipeline);
  return [...found];
}

export function parseOperaciones(raw: unknown): { ok: true; operaciones: OperacionCambio[] | null } | { ok: false; error: string } {
  if (raw == null || raw === '') return { ok: true, operaciones: null };
  let list: unknown = raw;
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw);
    } catch {
      return { ok: false, error: 'operaciones no es JSON válido.' };
    }
  }
  if (!Array.isArray(list) || !list.length) {
    return { ok: false, error: 'operaciones debe ser un array no vacío (crear|actualizar|borrar).' };
  }
  const out: OperacionCambio[] = [];
  for (const item of list) {
    const s = String(item || '').trim() as OperacionCambio;
    if (!OPERACIONES_OK.has(s)) {
      return { ok: false, error: `operación no permitida: ${String(item)}. Usa crear|actualizar|borrar.` };
    }
    if (!out.includes(s)) out.push(s);
  }
  return { ok: true, operaciones: out };
}

/**
 * Valida body de create/update según tipo.
 * `existingToken` se conserva en webhook si no se pide regenerar.
 */
export function validateDisparadorBody(
  body: Record<string, unknown>,
  opts?: { partial?: boolean; existingTipo?: DisparadorTipo; existingToken?: string | null }
): ValidateDisparadorResult {
  const avisos: string[] = [];
  const tipoRaw = body.tipo != null ? String(body.tipo).trim() : opts?.existingTipo || '';
  if (!tipoRaw || !isDisparadorTipo(tipoRaw)) {
    return { ok: false, error: 'tipo inválido (manual|horario|cambio_datos|webhook).' };
  }
  const tipo = tipoRaw;

  let activo = true;
  if (body.activo != null) {
    activo = body.activo === true || body.activo === 1 || body.activo === '1' || body.activo === 'true';
  }

  let anti_bucle = true;
  if (body.anti_bucle != null) {
    anti_bucle =
      body.anti_bucle === true ||
      body.anti_bucle === 1 ||
      body.anti_bucle === '1' ||
      body.anti_bucle === 'true';
  }

  let agrupar_segundos = 0;
  if (body.agrupar_segundos != null) {
    const n = Number(body.agrupar_segundos);
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
      return { ok: false, error: 'agrupar_segundos debe ser un entero ≥ 0.' };
    }
    agrupar_segundos = n;
  }

  const negocio = body.negocio != null ? String(body.negocio).trim() : '';

  let cron: string | null = null;
  let coleccion: string | null = null;
  let operaciones: OperacionCambio[] | null = null;
  let token: string | null | undefined = undefined;

  // pipeline
  const pipeParsed = parsePipeline(body.pipeline);
  if (!pipeParsed.ok) return { ok: false, error: pipeParsed.error };
  const pipeline = pipeParsed.pipeline;
  const stageErr = validatePipelineStages(pipeline);
  if (stageErr) return { ok: false, error: stageErr };

  if (tipo === 'manual') {
    // sin campos obligatorios extra
  } else if (tipo === 'horario') {
    cron = body.cron != null ? String(body.cron).trim() : '';
    const cronErr = validateCron5(cron);
    if (cronErr) return { ok: false, error: cronErr };
    coleccion = body.coleccion != null ? String(body.coleccion).trim() : '';
    if (!coleccion) return { ok: false, error: 'coleccion obligatoria para tipo horario.' };
  } else if (tipo === 'cambio_datos') {
    // fundamento menciona vigilar.coleccion; API flat = coleccion (+ operaciones)
    const vigilar =
      body.vigilar && typeof body.vigilar === 'object'
        ? (body.vigilar as Record<string, unknown>)
        : null;
    coleccion =
      body.coleccion != null
        ? String(body.coleccion).trim()
        : vigilar?.coleccion != null
          ? String(vigilar.coleccion).trim()
          : '';
    if (!coleccion) return { ok: false, error: 'coleccion obligatoria para tipo cambio_datos.' };
    const opsSrc = body.operaciones != null ? body.operaciones : vigilar?.operaciones;
    const ops = parseOperaciones(opsSrc);
    if (!ops.ok) return { ok: false, error: ops.error };
    if (!ops.operaciones || !ops.operaciones.length) {
      return { ok: false, error: 'operaciones obligatorias para tipo cambio_datos.' };
    }
    operaciones = ops.operaciones;
  } else if (tipo === 'webhook') {
    if (body.token != null && String(body.token).trim()) {
      // No aceptamos token del cliente al crear/editar: lo genera la API.
      // Si viene, lo ignoramos salvo regenerar=true.
    }
    if (body.regenerar_token === true || body.regenerarToken === true) {
      token = generateWebhookToken();
    } else if (opts?.existingToken) {
      token = opts.existingToken;
    } else {
      token = generateWebhookToken();
    }
  }

  return {
    ok: true,
    value: {
      tipo,
      activo,
      cron,
      coleccion,
      operaciones,
      token: token === undefined ? null : token,
      pipeline,
      anti_bucle,
      agrupar_segundos,
      negocio,
    },
    avisos,
  };
}

export function rowToDisparador(row: Record<string, unknown>): DisparadorDoc {
  const opsRaw = row.operaciones_json;
  let operaciones: OperacionCambio[] | null = null;
  if (opsRaw != null && String(opsRaw).trim()) {
    const p = parseOperaciones(opsRaw);
    if (p.ok) operaciones = p.operaciones;
  }
  const pipeRaw = row.pipeline_json;
  let pipeline: Record<string, unknown>[] | null = null;
  if (pipeRaw != null && String(pipeRaw).trim()) {
    const p = parsePipeline(pipeRaw);
    if (p.ok) pipeline = p.pipeline;
  }
  return {
    id: String(row.id),
    flujo_id: String(row.flujo_id),
    tipo: String(row.tipo) as DisparadorTipo,
    activo: row.activo === 1 || row.activo === true,
    cron: row.cron != null && String(row.cron) ? String(row.cron) : null,
    coleccion: row.coleccion != null && String(row.coleccion) ? String(row.coleccion) : null,
    operaciones,
    token: row.token != null && String(row.token) ? String(row.token) : null,
    pipeline,
    anti_bucle: row.anti_bucle === 1 || row.anti_bucle === true || row.anti_bucle == null,
    agrupar_segundos: Number(row.agrupar_segundos) || 0,
    negocio: String(row.negocio || ''),
    version: Number(row.version) || 1,
    creado: String(row.creado || ''),
    actualizado: String(row.actualizado || ''),
    ultima_vez: row.ultima_vez != null && String(row.ultima_vez) ? String(row.ultima_vez) : null,
  };
}

/** Respuesta pública (token completo en webhook: hace falta para armar la URL). */
export function publicDisparador(d: DisparadorDoc): Record<string, unknown> {
  return {
    id: d.id,
    flujo_id: d.flujo_id,
    tipo: d.tipo,
    activo: d.activo,
    cron: d.cron,
    coleccion: d.coleccion,
    operaciones: d.operaciones,
    token: d.tipo === 'webhook' ? d.token : null,
    pipeline: d.pipeline,
    anti_bucle: d.anti_bucle,
    agrupar_segundos: d.agrupar_segundos,
    negocio: d.negocio || '',
    version: d.version,
    creado: d.creado,
    actualizado: d.actualizado,
    ultima_vez: d.ultima_vez,
  };
}
