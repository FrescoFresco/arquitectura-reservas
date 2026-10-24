/**
 * Proxy opcional a la API pública de n8n (listar workflows + webhook URL).
 * Secrets: N8N_BASE_URL + N8N_API_KEY en el Worker.
 */

export type N8nWorkflowListItem = {
  id: string;
  nombre: string;
  activo: boolean;
  editor_url: string;
  webhook_url: string | null;
};

export type N8nWorkflowsResponse =
  | {
      ok: true;
      configured: false;
      workflows: [];
      hint: string;
    }
  | {
      ok: true;
      configured: true;
      workflows: N8nWorkflowListItem[];
    };

const HINT_SIN_SECRETS =
  'Configura N8N_BASE_URL y N8N_API_KEY en los secrets del Worker para listar los workflows automáticamente.';

const WEBHOOK_NODE_TYPES = new Set([
  'n8n-nodes-base.webhook',
  'n8n-nodes-base.webhookTrigger',
]);

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/** Extrae path del primer nodo Webhook de un workflow n8n. */
export function webhookPathFromNodes(nodes: unknown): string | null {
  if (!Array.isArray(nodes)) return null;
  for (const raw of nodes) {
    if (!raw || typeof raw !== 'object') continue;
    const node = raw as { type?: unknown; parameters?: Record<string, unknown> };
    const type = String(node.type || '');
    if (!WEBHOOK_NODE_TYPES.has(type) && !/webhook/i.test(type)) continue;
    const path = node.parameters && node.parameters.path != null ? String(node.parameters.path).trim() : '';
    if (path) return path.replace(/^\/+/, '');
  }
  return null;
}

function normalizeWorkflowList(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) return payload as Array<Record<string, unknown>>;
  if (payload && typeof payload === 'object') {
    const data = (payload as { data?: unknown }).data;
    if (Array.isArray(data)) return data as Array<Record<string, unknown>>;
  }
  return [];
}

export async function listN8nWorkflows(env: {
  N8N_BASE_URL?: string;
  N8N_API_KEY?: string;
}): Promise<N8nWorkflowsResponse> {
  const base = stripTrailingSlash(String(env.N8N_BASE_URL || '').trim());
  const apiKey = String(env.N8N_API_KEY || '').trim();
  if (!base || !apiKey) {
    return {
      ok: true,
      configured: false,
      workflows: [],
      hint: HINT_SIN_SECRETS,
    };
  }

  const res = await fetch(`${base}/api/v1/workflows`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'X-N8N-API-KEY': apiKey,
    },
  });
  if (!res.ok) {
    const errText = (await res.text().catch(() => '')).slice(0, 200);
    throw new Error(`n8n API HTTP ${res.status}${errText ? `: ${errText}` : ''}`);
  }
  const payload = await res.json().catch(() => null);
  const rows = normalizeWorkflowList(payload);
  const workflows: N8nWorkflowListItem[] = rows.map((w) => {
    const id = String(w.id ?? '').trim();
    const nombre = String(w.name ?? w.nombre ?? id).trim() || id;
    const activo = w.active === true || w.active === 1 || w.active === 'true';
    const path = webhookPathFromNodes(w.nodes);
    return {
      id,
      nombre,
      activo,
      editor_url: `${base}/workflow/${encodeURIComponent(id)}`,
      webhook_url: path ? `${base}/webhook/${path}` : null,
    };
  }).filter((w) => !!w.id);

  return { ok: true, configured: true, workflows };
}
