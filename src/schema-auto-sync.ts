/**
 * Debounced hub→Atlas schema push (crear-bd) when Cluster.autoSync is on.
 * Coalesces rapid edits per proyecto_id within the isolate (~1.5s).
 */

export const SCHEMA_AUTO_SYNC_DEBOUNCE_MS = 1500;

const pendingGen = new Map<string, number>();

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Bump generation and return the id for this schedule attempt. */
export function nextSyncGeneration(proyectoId: string): number {
  const id = String(proyectoId || '').trim();
  const next = (pendingGen.get(id) || 0) + 1;
  pendingGen.set(id, next);
  return next;
}

export function isSyncGenerationCurrent(proyectoId: string, gen: number): boolean {
  const id = String(proyectoId || '').trim();
  return pendingGen.get(id) === gen;
}

export type LastSyncSummary = {
  at: string;
  ok: boolean;
  proyecto: string;
  auto: boolean;
  dryRun?: boolean;
  mock?: boolean;
  db?: string;
  created?: string[];
  updated?: string[];
  error?: string;
  hint?: string;
};

export function parseLastSyncRow(row: Record<string, unknown> | null | undefined): LastSyncSummary | null {
  if (!row) return null;
  const at = String(row.last_sync_at || '').trim();
  const summaryRaw = String(row.last_sync_summary || '').trim();
  if (!at && !summaryRaw) return null;
  let parsed: Record<string, unknown> = {};
  if (summaryRaw) {
    try {
      const p = JSON.parse(summaryRaw);
      if (p && typeof p === 'object') parsed = p as Record<string, unknown>;
    } catch {
      parsed = {};
    }
  }
  const okRaw = row.last_sync_ok;
  const ok =
    okRaw == null && parsed.ok == null
      ? false
      : !!(okRaw === 1 || okRaw === true || okRaw === '1' || parsed.ok === true);
  return {
    at: at || String(parsed.at || ''),
    ok,
    proyecto: String(row.last_sync_proyecto || parsed.proyecto || ''),
    auto: !!(parsed.auto === true),
    dryRun: parsed.dryRun === true ? true : undefined,
    mock: parsed.mock === true ? true : undefined,
    db: parsed.db != null ? String(parsed.db) : undefined,
    created: Array.isArray(parsed.created) ? (parsed.created as string[]) : undefined,
    updated: Array.isArray(parsed.updated) ? (parsed.updated as string[]) : undefined,
    error: parsed.error != null ? String(parsed.error) : undefined,
    hint: parsed.hint != null ? String(parsed.hint) : undefined,
  };
}

export async function recordClusterLastSync(
  db: D1Database,
  clusterId: string,
  summary: LastSyncSummary
): Promise<void> {
  const cid = String(clusterId || '').trim();
  if (!cid) return;
  const safe: LastSyncSummary = {
    at: summary.at,
    ok: !!summary.ok,
    proyecto: String(summary.proyecto || ''),
    auto: !!summary.auto,
    ...(summary.dryRun ? { dryRun: true } : {}),
    ...(summary.mock ? { mock: true } : {}),
    ...(summary.db ? { db: String(summary.db) } : {}),
    ...(summary.created?.length ? { created: summary.created.map(String) } : {}),
    ...(summary.updated?.length ? { updated: summary.updated.map(String) } : {}),
    ...(summary.error ? { error: String(summary.error).slice(0, 500) } : {}),
    ...(summary.hint ? { hint: String(summary.hint).slice(0, 400) } : {}),
  };
  await db
    .prepare(
      `UPDATE clusters SET last_sync_at = ?, last_sync_ok = ?, last_sync_proyecto = ?, last_sync_summary = ?, updated_at = ?
       WHERE id = ?`
    )
    .bind(
      safe.at,
      safe.ok ? 1 : 0,
      safe.proyecto,
      JSON.stringify(safe),
      safe.at,
      cid
    )
    .run();
}

/**
 * Schedule crear-bd after debounce if still the latest request for this proyecto.
 * `run` must perform the push and record last sync; never receives URI.
 */
type WaitUntilCtx = { waitUntil(promise: Promise<unknown>): void };

export function scheduleDebouncedSchemaSync(
  ctx: WaitUntilCtx,
  proyectoId: string,
  run: (proyectoId: string) => Promise<void>
): void {
  const id = String(proyectoId || '').trim();
  if (!id) return;
  const gen = nextSyncGeneration(id);
  ctx.waitUntil(
    (async () => {
      await sleep(SCHEMA_AUTO_SYNC_DEBOUNCE_MS);
      if (!isSyncGenerationCurrent(id, gen)) return;
      try {
        await run(id);
      } catch (err) {
        console.error('schema auto-sync failed', id, err instanceof Error ? err.message : err);
      }
    })()
  );
}

/** Modo visible en Historial: real | dry-run | auto. */
export type EmpujeModo = 'real' | 'dry-run' | 'auto';

export type EsquemaEmpujeRow = {
  id: string;
  proyectoId: string;
  ts: string;
  modo: EmpujeModo;
  ok: boolean;
  resumen: string;
  detalle: Record<string, unknown>;
};

export function resolveEmpujeModo(opts: {
  auto?: boolean;
  dryRun?: boolean;
  mock?: boolean;
}): EmpujeModo {
  if (opts.auto) return 'auto';
  if (opts.dryRun || opts.mock) return 'dry-run';
  return 'real';
}

export function resumenDesdeDetalle(
  modo: EmpujeModo,
  ok: boolean,
  detalle: Record<string, unknown>
): string {
  if (!ok) {
    const err = detalle.error != null ? String(detalle.error) : '';
    return (err || 'Error').slice(0, 240);
  }
  if (detalle.dryRun || detalle.mock || modo === 'dry-run') {
    const plan = detalle.plan as { collections?: unknown[] } | undefined;
    const n = Array.isArray(plan?.collections) ? plan!.collections!.length : 0;
    const hint = detalle.hint != null ? String(detalle.hint) : '';
    const base = n ? `Simulación · ${n} colección${n === 1 ? '' : 'es'}` : 'Simulación';
    return hint ? `${base}. ${hint}`.slice(0, 280) : base;
  }
  const created = Array.isArray(detalle.created) ? (detalle.created as string[]) : [];
  const updated = Array.isArray(detalle.updated) ? (detalle.updated as string[]) : [];
  const parts: string[] = [];
  if (created.length) parts.push(`Creadas: ${created.join(', ')}`);
  if (updated.length) parts.push(`Actualizadas: ${updated.join(', ')}`);
  if (!parts.length) {
    const db = detalle.db != null ? String(detalle.db) : '';
    return db ? `Empujado a ${db}` : 'Empujón OK';
  }
  return parts.join(' · ').slice(0, 280);
}

function newEmpujeId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  return `emp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Persist one Empujar / auto-sync attempt (best-effort; never throws to caller). */
export async function recordEsquemaEmpuje(
  db: D1Database,
  input: {
    proyectoId: string;
    ts?: string;
    modo: EmpujeModo;
    ok: boolean;
    detalle: Record<string, unknown>;
    resumen?: string;
  }
): Promise<string | null> {
  const proyectoId = String(input.proyectoId || '').trim();
  if (!proyectoId) return null;
  const ts = String(input.ts || new Date().toISOString());
  const id = newEmpujeId();
  const detalle = input.detalle && typeof input.detalle === 'object' ? input.detalle : {};
  const resumen =
    (input.resumen && String(input.resumen).trim()) ||
    resumenDesdeDetalle(input.modo, !!input.ok, detalle);
  try {
    await db
      .prepare(
        `INSERT INTO esquema_empujes (id, proyecto_id, ts, modo, ok, resumen, detalle_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        proyectoId,
        ts,
        input.modo,
        input.ok ? 1 : 0,
        String(resumen).slice(0, 500),
        JSON.stringify(detalle).slice(0, 100_000)
      )
      .run();
    return id;
  } catch (err) {
    console.error('recordEsquemaEmpuje', err instanceof Error ? err.message : err);
    return null;
  }
}

export type ListEmpujesOpts = {
  limit?: number;
  cursor?: string | null;
  estado?: 'ok' | 'error' | '';
  desde?: string;
  hasta?: string;
};

/** Keyset cursor: `ts~id` (ISO ts + empuje id). */
function encodeEmpujeCursor(ts: string, id: string): string {
  return `${encodeURIComponent(ts)}~${encodeURIComponent(id)}`;
}

function decodeEmpujeCursor(raw: string): { ts: string; id: string } | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  const i = s.indexOf('~');
  if (i <= 0) return null;
  try {
    const ts = decodeURIComponent(s.slice(0, i));
    const id = decodeURIComponent(s.slice(i + 1));
    if (!ts || !id) return null;
    return { ts, id };
  } catch {
    return null;
  }
}

export async function listEsquemaEmpujes(
  db: D1Database,
  proyectoId: string,
  opts: ListEmpujesOpts = {}
): Promise<{
  items: EsquemaEmpujeRow[];
  nextCursor: string | null;
  limit: number;
}> {
  const pid = String(proyectoId || '').trim();
  let limit = Number(opts.limit);
  if (!Number.isFinite(limit) || limit < 1) limit = 50;
  if (limit > 100) limit = 100;

  const where: string[] = ['proyecto_id = ?'];
  const binds: unknown[] = [pid];

  if (opts.estado === 'ok') {
    where.push('ok = 1');
  } else if (opts.estado === 'error') {
    where.push('ok = 0');
  }

  const desde = String(opts.desde || '').trim();
  const hasta = String(opts.hasta || '').trim();
  if (desde) {
    where.push('ts >= ?');
    binds.push(desde);
  }
  if (hasta) {
    where.push('ts <= ?');
    binds.push(hasta);
  }

  const cur = decodeEmpujeCursor(String(opts.cursor || ''));
  if (cur) {
    where.push('(ts < ? OR (ts = ? AND id < ?))');
    binds.push(cur.ts, cur.ts, cur.id);
  }

  const sql = `SELECT id, proyecto_id, ts, modo, ok, resumen, detalle_json
    FROM esquema_empujes
    WHERE ${where.join(' AND ')}
    ORDER BY ts DESC, id DESC
    LIMIT ?`;
  binds.push(limit + 1);

  const res = await db
    .prepare(sql)
    .bind(...binds)
    .all<{
      id: string;
      proyecto_id: string;
      ts: string;
      modo: string;
      ok: number;
      resumen: string;
      detalle_json: string;
    }>();

  const rows = res.results || [];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const items: EsquemaEmpujeRow[] = page.map((r) => {
    let detalle: Record<string, unknown> = {};
    try {
      const p = JSON.parse(String(r.detalle_json || '{}'));
      if (p && typeof p === 'object') detalle = p as Record<string, unknown>;
    } catch {
      detalle = { raw: String(r.detalle_json || '') };
    }
    const modoRaw = String(r.modo || '');
    const modo: EmpujeModo =
      modoRaw === 'auto' || modoRaw === 'dry-run' || modoRaw === 'real'
        ? modoRaw
        : 'real';
    return {
      id: String(r.id),
      proyectoId: String(r.proyecto_id),
      ts: String(r.ts),
      modo,
      ok: !!(r.ok === 1 || r.ok === true),
      resumen: String(r.resumen || ''),
      detalle,
    };
  });

  let nextCursor: string | null = null;
  if (hasMore && items.length) {
    const last = items[items.length - 1];
    nextCursor = encodeEmpujeCursor(last.ts, last.id);
  }

  return { items, nextCursor, limit };
}
