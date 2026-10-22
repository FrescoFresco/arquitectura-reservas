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
