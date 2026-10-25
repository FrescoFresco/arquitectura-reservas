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

/** Modo de escritura Mongo por colección (1:1 vs 1:N). */
export type ModoEscritura = 'unico_por_negocio' | 'multiple';

/**
 * Default: `negocios`/`procesos` → unico_por_negocio; resto → multiple.
 * Override vía `proyectos.colecciones[].modo_escritura`.
 */
export function modoEscrituraColeccion(
  coleccion: string,
  coleccionesProyecto?: Array<{ id?: string; modo_escritura?: string } | null> | null
): ModoEscritura {
  const col = String(coleccion || '').trim();
  if (!col) return 'multiple';
  if (Array.isArray(coleccionesProyecto)) {
    const def = coleccionesProyecto.find((c) => c && String(c.id || '').trim() === col);
    const m = def && String(def.modo_escritura || '').trim();
    if (m === 'unico_por_negocio' || m === 'multiple') return m;
  }
  if (col === 'negocios' || col === 'procesos') return 'unico_por_negocio';
  return 'multiple';
}

/** `_id` canónico 1:1 por negocio. */
export function idUnicoPorNegocio(coleccion: string, negocioId: string): string {
  if (coleccion === 'negocios') return negocioId;
  if (coleccion === 'procesos') return `${negocioId}-proceso`;
  return `${negocioId}-${coleccion}`;
}

/** ID determinista por corrida+colección (misma corrida reutiliza el doc). */
export function idMultiplePorCorrida(coleccion: string, corridaId: string): string {
  const prefix = String(coleccion || '')
    .replace(/[^a-z0-9]/gi, '')
    .slice(0, 4)
    .toLowerCase() || 'doc';
  const bare = String(corridaId || '').replace(/^c-/, '');
  return `${prefix}-${bare}`;
}

/** ID único suelto (POST /salidas sin corrida_id). */
export function idMultipleSuelto(coleccion: string, negocioId: string): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 6)
      : Math.random().toString(36).slice(2, 8);
  return `${negocioId}-${coleccion}-${Date.now().toString(36)}-${rand}`;
}

/**
 * Resuelve el documento Mongo relevante para una ancla dado un negocio.
 * Colecciones con negocio_id / procesos → versiones vía proceso.
 * Preferir `findDocForCorrida` cuando hay `_documentos_` en la corrida.
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

  if (col === 'procesos') {
    const doc = await db.collection(col).findOne({
      $or: [{ _id: `${negocioId}-proceso` }, { negocio_id: negocioId }],
    });
    return (doc as Record<string, unknown>) || null;
  }

  if (modoEscrituraColeccion(col) === 'unico_por_negocio') {
    const doc = await db.collection(col).findOne({
      $or: [{ _id: idUnicoPorNegocio(col, negocioId) }, { _id: negocioId }, { negocio_id: negocioId }],
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

  // multiple: último por negocio (respaldo sin _documentos_)
  const doc = await db
    .collection(col)
    .find({ $or: [{ negocio_id: negocioId }, { _id: negocioId }, { cliente_id: negocioId }] })
    .sort({ actualizado_en: -1, _id: -1 })
    .limit(1)
    .next();
  return (doc as Record<string, unknown>) || null;
}

/**
 * Lectura Mongo respetando `corrida.datos._documentos_` / `_documento_id`.
 */
export async function findDocForCorrida(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: { collection: (n: string) => any },
  coleccion: string,
  negocioId: string,
  datosCorrida?: Record<string, unknown> | null,
  coleccionesProyecto?: Array<{ id?: string; modo_escritura?: string } | null> | null
): Promise<Record<string, unknown> | null> {
  const col = String(coleccion || '').trim();
  if (!col) return null;
  const docsMap =
    datosCorrida &&
    datosCorrida._documentos_ &&
    typeof datosCorrida._documentos_ === 'object' &&
    !Array.isArray(datosCorrida._documentos_)
      ? (datosCorrida._documentos_ as Record<string, unknown>)
      : null;
  const mappedId = docsMap && docsMap[col] != null ? String(docsMap[col]).trim() : '';
  if (mappedId) {
    const byId = await db.collection(col).findOne({ _id: mappedId });
    if (byId) return byId as Record<string, unknown>;
  }
  const docId =
    datosCorrida && datosCorrida._documento_id != null
      ? String(datosCorrida._documento_id).trim()
      : '';
  if (docId) {
    const byDoc = await db.collection(col).findOne({ _id: docId });
    if (byDoc) return byDoc as Record<string, unknown>;
  }
  const modo = modoEscrituraColeccion(col, coleccionesProyecto);
  if (modo === 'unico_por_negocio') {
    return findDocForColeccion(db, col, negocioId);
  }
  // multiple sin mapa: último del negocio
  if (!negocioId) return null;
  const doc = await db
    .collection(col)
    .find({ $or: [{ negocio_id: negocioId }, { _id: negocioId }] })
    .sort({ actualizado_en: -1, _id: -1 })
    .limit(1)
    .next();
  return (doc as Record<string, unknown>) || null;
}

/** Asegura `datos._documentos_[coleccion] = targetId`. */
export function setDocumentoActivo(
  datos: Record<string, unknown>,
  coleccion: string,
  targetId: string
): void {
  const prev =
    datos._documentos_ && typeof datos._documentos_ === 'object' && !Array.isArray(datos._documentos_)
      ? { ...(datos._documentos_ as Record<string, unknown>) }
      : {};
  prev[coleccion] = targetId;
  datos._documentos_ = prev;
  if (!datos._documento_id) datos._documento_id = targetId;
}

/**
 * Resuelve `_id` destino al escribir salidas en una colección.
 * Mutates `datos` con `_documentos_` si crea un id nuevo (modo multiple).
 */
export function resolveWriteTargetId(args: {
  coleccion: string;
  negocio: string;
  corridaId: string | null;
  datos?: Record<string, unknown> | null;
  valores?: Record<string, unknown> | null;
  anclaMaps?: AnclaMongoMap[];
  coleccionesProyecto?: Array<{ id?: string; modo_escritura?: string } | null> | null;
  documentoIdBody?: string | null;
}): { targetId: string; created: boolean; modo: ModoEscritura } {
  const col = String(args.coleccion || '').trim();
  const modo = modoEscrituraColeccion(col, args.coleccionesProyecto);
  if (modo === 'unico_por_negocio') {
    return { targetId: idUnicoPorNegocio(col, args.negocio), created: false, modo };
  }
  const docsMap =
    args.datos &&
    args.datos._documentos_ &&
    typeof args.datos._documentos_ === 'object' &&
    !Array.isArray(args.datos._documentos_)
      ? (args.datos._documentos_ as Record<string, unknown>)
      : null;
  if (docsMap && docsMap[col] != null && String(docsMap[col]).trim()) {
    return { targetId: String(docsMap[col]).trim(), created: false, modo };
  }
  // Ancla con claveMongo === "_id" en valores
  if (args.valores && args.anclaMaps) {
    for (const m of args.anclaMaps) {
      if (m.coleccion !== col) continue;
      if (m.claveMongo === '_id' && args.valores[m.ancla] != null) {
        const tid = String(args.valores[m.ancla]).trim();
        if (tid) {
          if (args.datos) setDocumentoActivo(args.datos, col, tid);
          return { targetId: tid, created: false, modo };
        }
      }
    }
  }
  if (args.documentoIdBody) {
    const tid = String(args.documentoIdBody).trim();
    if (tid) {
      if (args.datos) setDocumentoActivo(args.datos, col, tid);
      return { targetId: tid, created: false, modo };
    }
  }
  const targetId = args.corridaId
    ? idMultiplePorCorrida(col, args.corridaId)
    : idMultipleSuelto(col, args.negocio);
  if (args.datos) setDocumentoActivo(args.datos, col, targetId);
  return { targetId, created: true, modo };
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
