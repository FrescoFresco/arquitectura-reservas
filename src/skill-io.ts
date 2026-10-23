/** Skill entradas/salidas + lectura/escritura Mongo por ancla + diagrama operativa. */

export type SkillIoLists = {
  entradas: string[];
  salidas: string[];
  anclas: string[];
};

export function unionAnclas(entradas: string[], salidas: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of [...entradas, ...salidas]) {
    if (!a || seen.has(a)) continue;
    seen.add(a);
    out.push(a);
  }
  return out.sort();
}

export function normalizeAnclaToken(raw: unknown): string {
  let a = String(raw || '').trim();
  if (!a) return '';
  if (a[0] !== '_') a = '_' + a;
  if (a[a.length - 1] !== '_') a = a + '_';
  return a;
}

export function normalizeAnclasList(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const a = normalizeAnclaToken(raw);
    if (!a || seen.has(a)) continue;
    seen.add(a);
    out.push(a);
  }
  return out;
}

/** Dot-path get (supports nested objects; does not expand arrays by index unless numeric). */
export function getByPath(doc: unknown, path: string): unknown {
  if (!doc || typeof doc !== 'object' || !path) return undefined;
  const parts = path.split('.').filter(Boolean);
  let cur: unknown = doc;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

export function setByPath(doc: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.').filter(Boolean);
  if (!parts.length) return;
  let cur: Record<string, unknown> = doc;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    const next = cur[p];
    if (next == null || typeof next !== 'object' || Array.isArray(next)) {
      cur[p] = {};
    }
    cur = cur[p] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

export type AnclaMongoMap = {
  ancla: string;
  id: string;
  coleccion: string;
  claveMongo: string;
  baseDatos: string;
};

/**
 * Resuelve el documento Mongo relevante para una ancla dado un negocio.
 * Colecciones con negocio_id / procesos → versiones vía proceso.
 */
export async function findDocForColeccion(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: { collection: (n: string) => any },
  coleccion: string,
  negocioId: string
): Promise<Record<string, unknown> | null> {
  const col = String(coleccion || '').trim();
  if (!col || !negocioId) return null;

  if (col === 'negocios') {
    const doc = await db.collection(col).findOne({ _id: negocioId });
    return (doc as Record<string, unknown>) || null;
  }

  if (col === 'clientes') {
    const doc = await db.collection(col).findOne({ _id: negocioId });
    return (doc as Record<string, unknown>) || null;
  }

  if (col === 'procesos' || col === 'reservas' || col === 'ejecuciones' || col === 'reservas_prueba') {
    const doc = await db.collection(col).findOne({ negocio_id: negocioId });
    return (doc as Record<string, unknown>) || null;
  }

  if (col === 'llamadas') {
    const doc = await db.collection(col).findOne({
      $or: [{ negocio_id: negocioId }, { cliente_id: negocioId }],
    });
    return (doc as Record<string, unknown>) || null;
  }

  if (col === 'versiones') {
    const proceso = await db.collection('procesos').findOne({ negocio_id: negocioId });
    if (!proceso || !(proceso as { _id?: string })._id) return null;
    const doc = await db
      .collection(col)
      .find({ proceso_id: (proceso as { _id: string })._id })
      .sort({ _id: -1 })
      .limit(1)
      .next();
    return (doc as Record<string, unknown>) || null;
  }

  // Fallback genérico
  const doc = await db.collection(col).findOne({
    $or: [{ _id: negocioId }, { negocio_id: negocioId }],
  });
  return (doc as Record<string, unknown>) || null;
}

export type OperativaSkill = {
  id: string;
  nombre: string;
  entradas: string[];
  salidas: string[];
};

export type OperativaResult = {
  mermaid: string;
  huecos: string[];
  enlaces: Array<{ desde: string; hacia: string; ancla: string }>;
};

/** Cadena de skills: salidas A → entradas B (mismo id de ancla). Huecos en rojo. */
export function buildOperativaMermaid(skills: OperativaSkill[]): OperativaResult {
  const writers = new Map<string, string[]>(); // ancla → skill ids that write it
  for (const s of skills) {
    for (const a of s.salidas || []) {
      const list = writers.get(a) || [];
      list.push(s.id);
      writers.set(a, list);
    }
  }

  const huecosSet = new Set<string>();
  for (const s of skills) {
    for (const a of s.entradas || []) {
      if (!writers.has(a)) huecosSet.add(a);
    }
  }
  const huecos = [...huecosSet].sort();

  const enlaces: OperativaResult['enlaces'] = [];
  const edgeSeen = new Set<string>();
  for (const b of skills) {
    for (const a of b.entradas || []) {
      const fromSkills = writers.get(a) || [];
      for (const fid of fromSkills) {
        if (fid === b.id) continue;
        const key = fid + '→' + b.id + ':' + a;
        if (edgeSeen.has(key)) continue;
        edgeSeen.add(key);
        enlaces.push({ desde: fid, hacia: b.id, ancla: a });
      }
    }
  }

  const lines: string[] = ['flowchart LR'];
  for (const s of skills) {
    const label = (s.nombre || s.id).replace(/"/g, "'");
    lines.push(`  ${mermaidId(s.id)}["${label}"]`);
  }

  for (const e of enlaces) {
    const short = e.ancla.length > 42 ? e.ancla.slice(0, 40) + '…' : e.ancla;
    lines.push(`  ${mermaidId(e.desde)} -->|"${short.replace(/"/g, "'")}"| ${mermaidId(e.hacia)}`);
  }

  // Nodos de hueco (entradas sin productor)
  for (const h of huecos) {
    const hid = 'hueco_' + mermaidId(h.replace(/^_|_$/g, '').replace(/\./g, '_'));
    const short = h.length > 36 ? h.slice(0, 34) + '…' : h;
    lines.push(`  ${hid}["⛔ ${short.replace(/"/g, "'")}"]`);
    lines.push(`  style ${hid} fill:#fecaca,stroke:#b91c1c,color:#7f1d1d`);
    for (const s of skills) {
      if ((s.entradas || []).includes(h)) {
        lines.push(`  ${hid} -.-> ${mermaidId(s.id)}`);
      }
    }
  }

  if (skills.length === 0) {
    lines.push('  vacio["Sin skills asociadas"]');
  }

  return { mermaid: lines.join('\n'), huecos, enlaces };
}

function mermaidId(raw: string): string {
  return (
    'n_' +
    String(raw || 'x')
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 48)
  );
}
