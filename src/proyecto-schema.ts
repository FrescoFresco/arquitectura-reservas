/**
 * Proyecto = software (una base Mongo). Validación de colecciones/relaciones,
 * diagrama Mermaid y $jsonSchema desde campos Mongo del catálogo.
 */

export type ColeccionDef = { id: string; descripcion?: string };
export type RelacionDef = { desde: string; hacia: string; tipo?: string };

export type ProyectoSoftwareShape = {
  id: string;
  nombre: string;
  descripcion?: string;
  baseDatos: string;
  colecciones: ColeccionDef[];
  relaciones: RelacionDef[];
  skills: string[];
  agentes: string[];
  legacyNegocio?: boolean;
};

export type MongoCampoShape = {
  id: string;
  campo: string;
  coleccion: string;
  clave: string;
  bsonType: string;
  obligatorio?: boolean;
  descripcion?: string;
  ancla?: string;
  proyecto?: string;
  hijos?: MongoCampoShape[];
  /** Valores permitidos (p. ej. resultado de llamada). */
  enum?: string[];
};

const COL_ID_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export function parseColecciones(raw: unknown): ColeccionDef[] {
  const arr = coerceArray(raw);
  const out: ColeccionDef[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const id = String(o.id || '').trim();
    if (!id || !COL_ID_RE.test(id)) continue;
    out.push({ id, descripcion: String(o.descripcion || '').trim() });
  }
  return out;
}

export function parseRelaciones(raw: unknown): RelacionDef[] {
  const arr = coerceArray(raw);
  const out: RelacionDef[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const desde = String(o.desde || '').trim();
    const hacia = String(o.hacia || '').trim();
    if (!desde || !hacia) continue;
    out.push({ desde, hacia, tipo: String(o.tipo || 'N:1').trim() || 'N:1' });
  }
  return out;
}

export function parseStringList(raw: unknown): string[] {
  const arr = coerceArray(raw);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of arr) {
    const s = String(item || '').trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function coerceArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t) return [];
    try {
      const parsed = JSON.parse(t);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Colección referenciada en `desde`/`hacia` (antes del primer punto). */
export function coleccionDeRuta(ruta: string): string {
  const s = String(ruta || '').trim();
  const i = s.indexOf('.');
  return i >= 0 ? s.slice(0, i) : s;
}

/**
 * Valida que toda colección citada en relaciones exista en colecciones.
 * Devuelve mensaje de error o null si OK.
 */
export function validateRelaciones(
  colecciones: ColeccionDef[],
  relaciones: RelacionDef[]
): string | null {
  const ids = new Set(colecciones.map((c) => c.id));
  for (const r of relaciones) {
    const desdeCol = coleccionDeRuta(r.desde);
    const haciaCol = coleccionDeRuta(r.hacia);
    if (!ids.has(desdeCol)) {
      return `relación.desde referencia colección inexistente: ${desdeCol}`;
    }
    if (!ids.has(haciaCol)) {
      return `relación.hacia referencia colección inexistente: ${haciaCol}`;
    }
  }
  return null;
}

export function validateColeccionEnProyecto(
  colecciones: ColeccionDef[],
  coleccion: string
): string | null {
  const id = String(coleccion || '').trim();
  if (!id) return 'colección obligatoria.';
  if (!colecciones.some((c) => c.id === id)) {
    return `colección "${id}" no está en colecciones del proyecto.`;
  }
  return null;
}

/** Identificador seguro para Mermaid erDiagram. */
export function mermaidEntityName(coleccionId: string): string {
  return String(coleccionId || 'col')
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/^(\d)/, '_$1');
}

function bsonToMermaidType(bson: string): string {
  const t = String(bson || 'string').toLowerCase();
  if (t === 'int' || t === 'long' || t === 'double' || t === 'decimal' || t === 'number') return 'number';
  if (t === 'bool' || t === 'boolean') return 'bool';
  if (t === 'date' || t === 'timestamp') return 'date';
  if (t === 'object' || t === 'document') return 'object';
  if (t === 'array') return 'array';
  if (t === 'objectid') return 'objectid';
  return 'string';
}

export type DiagramaPayload = {
  mermaid: string;
  colecciones: Array<{
    id: string;
    descripcion: string;
    campos: Array<{ clave: string; bsonType: string; obligatorio: boolean; ancla: string }>;
  }>;
  relaciones: RelacionDef[];
  baseDatos: string;
};

export function buildDiagrama(
  proyecto: { baseDatos: string; colecciones: ColeccionDef[]; relaciones: RelacionDef[] },
  campos: MongoCampoShape[],
  opts?: { coleccion?: string }
): DiagramaPayload {
  const focus = String(opts?.coleccion || '').trim();
  let coleccionesSrc = proyecto.colecciones.slice();
  let relacionesSrc = proyecto.relaciones.slice();

  if (focus) {
    const exists = coleccionesSrc.some((c) => c.id === focus);
    if (!exists) {
      return {
        mermaid: 'erDiagram\n',
        colecciones: [],
        relaciones: [],
        baseDatos: proyecto.baseDatos,
      };
    }
    const neighbors = new Set<string>([focus]);
    for (const r of relacionesSrc) {
      const a = coleccionDeRuta(r.desde);
      const b = coleccionDeRuta(r.hacia);
      if (a === focus) neighbors.add(b);
      if (b === focus) neighbors.add(a);
    }
    coleccionesSrc = coleccionesSrc.filter((c) => neighbors.has(c.id));
    relacionesSrc = relacionesSrc.filter((r) => {
      const a = coleccionDeRuta(r.desde);
      const b = coleccionDeRuta(r.hacia);
      return (a === focus || b === focus) && neighbors.has(a) && neighbors.has(b);
    });
  }

  const byCol = new Map<string, MongoCampoShape[]>();
  for (const c of campos) {
    const col = String(c.coleccion || '').trim();
    if (!col) continue;
    const list = byCol.get(col);
    if (list) list.push(c);
    else byCol.set(col, [c]);
  }

  const lines: string[] = ['erDiagram'];
  const coleccionesOut: DiagramaPayload['colecciones'] = [];

  for (const col of coleccionesSrc) {
    const entity = mermaidEntityName(col.id);
    const fields = byCol.get(col.id) || [];
    const fieldLines: string[] = [];
    // Always show _id as PK-ish anchor.
    fieldLines.push('    objectid _id PK');
    for (const f of fields) {
      const clave = String(f.clave || '').trim() || 'campo';
      // Mermaid entity attrs: TYPE name
      const safeKey = clave.replace(/[^a-zA-Z0-9_]/g, '_');
      const typ = bsonToMermaidType(f.bsonType);
      const pk = f.obligatorio ? ' "obligatorio"' : '';
      fieldLines.push(`    ${typ} ${safeKey}${pk}`);
    }
    lines.push(`${entity} {`);
    lines.push(...fieldLines);
    lines.push('}');
    coleccionesOut.push({
      id: col.id,
      descripcion: col.descripcion || '',
      campos: fields.map((f) => ({
        clave: String(f.clave || ''),
        bsonType: String(f.bsonType || 'string'),
        obligatorio: !!f.obligatorio,
        ancla: String(f.ancla || ''),
      })),
    });
  }

  // Relations: Mermaid uses ||--o{ etc. Map N:1 → many-to-one.
  for (const r of relacionesSrc) {
    const a = mermaidEntityName(coleccionDeRuta(r.desde));
    const b = mermaidEntityName(coleccionDeRuta(r.hacia));
    const tipo = String(r.tipo || 'N:1').toUpperCase();
    let arrow = '}o--||';
    if (tipo === '1:1') arrow = '||--||';
    else if (tipo === '1:N' || tipo === '1:n') arrow = '||--o{';
    else if (tipo === 'N:N' || tipo === 'N:M' || tipo === 'M:N') arrow = '}o--o{';
    const label = `${r.desde} → ${r.hacia}`.replace(/"/g, "'");
    lines.push(`${a} ${arrow} ${b} : "${label}"`);
  }

  return {
    mermaid: lines.join('\n'),
    colecciones: coleccionesOut,
    relaciones: relacionesSrc,
    baseDatos: proyecto.baseDatos,
  };
}

/** Map bsonType catálogo → JSON Schema type for $jsonSchema. */
export function bsonToJsonSchemaType(bson: string): string | string[] {
  const t = String(bson || 'string').toLowerCase();
  switch (t) {
    case 'int':
    case 'long':
    case 'double':
    case 'decimal':
    case 'number':
      return 'number';
    case 'bool':
    case 'boolean':
      return 'boolean';
    case 'date':
    case 'timestamp':
      return 'string'; // ISO; Atlas also accepts date via bsonType in validator
    case 'object':
    case 'document':
      return 'object';
    case 'array':
      return 'array';
    case 'objectid':
      return 'string';
    case 'null':
      return 'null';
    default:
      return 'string';
  }
}

export function buildJsonSchemaForCollection(
  coleccionId: string,
  campos: MongoCampoShape[]
): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    _id: { bsonType: ['objectId', 'string'] },
  };
  const required: string[] = [];

  for (const f of campos) {
    if (f.coleccion !== coleccionId) continue;
    const clave = String(f.clave || '').trim();
    if (!clave || clave.includes('.')) {
      // Nested dotted keys: put under a flat property name of the root segment
      // and document; full nested $jsonSchema can be refined later via hijos.
      const root = clave.split('.')[0];
      if (!root) continue;
      if (!properties[root]) {
        properties[root] = { bsonType: ['object', 'string', 'array', 'bool', 'int', 'long', 'double', 'date'] };
      }
      continue;
    }
    const bson = String(f.bsonType || 'string').toLowerCase();
    if (bson === 'object' && Array.isArray(f.hijos) && f.hijos.length) {
      properties[clave] = {
        bsonType: 'object',
        properties: Object.fromEntries(
          f.hijos.map((h) => [
            h.clave || h.id,
            { bsonType: bsonToAtlasBson(h.bsonType), description: h.descripcion || '' },
          ])
        ),
      };
    } else if (bson === 'array' && Array.isArray(f.hijos) && f.hijos.length) {
      properties[clave] = {
        bsonType: 'array',
        items: {
          bsonType: 'object',
          properties: Object.fromEntries(
            f.hijos.map((h) => [
              h.clave || h.id,
              { bsonType: bsonToAtlasBson(h.bsonType), description: h.descripcion || '' },
            ])
          ),
        },
      };
    } else {
      const prop: Record<string, unknown> = {
        bsonType: bsonToAtlasBson(bson),
        description: f.descripcion || undefined,
      };
      if (Array.isArray(f.enum) && f.enum.length) {
        prop.enum = f.enum.map((v) => String(v));
      }
      properties[clave] = prop;
    }
    if (f.obligatorio) required.push(clave.split('.')[0]);
  }

  const schema: Record<string, unknown> = {
    bsonType: 'object',
    required: [...new Set(required)].filter(Boolean),
    properties,
    additionalProperties: true,
  };
  return schema;
}

function bsonToAtlasBson(bson: string): string | string[] {
  const t = String(bson || 'string').toLowerCase();
  switch (t) {
    case 'int':
      return 'int';
    case 'long':
      return 'long';
    case 'double':
      return 'double';
    case 'decimal':
      return 'decimal';
    case 'bool':
    case 'boolean':
      return 'bool';
    case 'date':
    case 'timestamp':
      return 'date';
    case 'object':
    case 'document':
      return 'object';
    case 'array':
      return 'array';
    case 'objectid':
      return 'objectId';
    case 'number':
      return ['int', 'long', 'double', 'decimal'];
    default:
      return 'string';
  }
}

export const DEFAULT_RESERVAS_COLECCIONES: ColeccionDef[] = [
  { id: 'negocios', descripcion: 'Un documento por negocio cliente' },
  { id: 'procesos', descripcion: 'Puntos A / alcances de reserva por negocio' },
  { id: 'versiones', descripcion: 'Recorridos, scripts y funciones versionados' },
  { id: 'reservas', descripcion: 'Reservas hechas por los agentes' },
  { id: 'ejecuciones', descripcion: 'Historial de ejecuciones' },
  { id: 'reservas_prueba', descripcion: 'Reservas de prueba (no producción)' },
];

export const DEFAULT_RESERVAS_RELACIONES: RelacionDef[] = [
  { desde: 'procesos.negocio_id', hacia: 'negocios._id', tipo: 'N:1' },
  { desde: 'versiones.proceso_id', hacia: 'procesos._id', tipo: 'N:1' },
  { desde: 'reservas.negocio_id', hacia: 'negocios._id', tipo: 'N:1' },
  { desde: 'ejecuciones.negocio_id', hacia: 'negocios._id', tipo: 'N:1' },
  { desde: 'reservas_prueba.negocio_id', hacia: 'negocios._id', tipo: 'N:1' },
];
