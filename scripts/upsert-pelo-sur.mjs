#!/usr/bin/env node
/**
 * Upsert / migrate Pelo Sur + auditoría X3/X4/X6 (clase enum, reservas_prueba
 * en plano Mongo, skill mapear-recorrido v3) into remote D1 via HTTP API
 * without wiping existing agentes/invites.
 *
 * Usage:
 *   AGENTE_CLAVE=inv_… node scripts/upsert-pelo-sur.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = (process.env.API_BASE || 'https://campos-ancla-api.web-legal-es.workers.dev').replace(/\/$/, '');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    const err = new Error(data.error || `HTTP ${res.status} ${path}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function ensureClave() {
  if (process.env.AGENTE_CLAVE) return process.env.AGENTE_CLAVE.trim();
  const data = await api('/v1/invites', { method: 'POST', body: '{}' });
  const clave = data.invite?.clave;
  if (!clave) throw new Error('No invite');
  console.log('Invite temporal creada (no se imprime).');
  return clave;
}

async function upsertAncla(clave, campo) {
  const headers = { Authorization: `Bearer ${clave}` };
  const body = { ...campo };
  delete body.observaciones;
  delete body.valorActual;
  delete body.valor_actual;
  try {
    await api('/v1/anclas/' + encodeURIComponent(campo.id), {
      method: 'PUT',
      headers,
      body: JSON.stringify(body),
    });
    console.log('PUT ancla', campo.id);
  } catch (e) {
    if (e.status === 404) {
      await api('/v1/anclas', { method: 'POST', headers, body: JSON.stringify(body) });
      console.log('POST ancla', campo.id);
      return;
    }
    throw e;
  }
}

async function deleteAncla(clave, id) {
  const headers = { Authorization: `Bearer ${clave}` };
  try {
    await api('/v1/anclas/' + encodeURIComponent(id), { method: 'DELETE', headers });
    console.log('DELETE ancla', id);
  } catch (e) {
    if (e.status === 404) {
      console.log('skip delete ancla (404)', id);
      return;
    }
    throw e;
  }
}

async function upsertMongo(clave, campo) {
  const headers = { Authorization: `Bearer ${clave}` };
  try {
    await api('/v1/mongo/' + encodeURIComponent(campo.id), {
      method: 'PUT',
      headers,
      body: JSON.stringify(campo),
    });
    console.log('PUT mongo', campo.id);
  } catch (e) {
    if (e.status === 404) {
      await api('/v1/mongo', { method: 'POST', headers, body: JSON.stringify(campo) });
      console.log('POST mongo', campo.id);
      return;
    }
    throw e;
  }
}

async function deleteMongo(clave, id) {
  const headers = { Authorization: `Bearer ${clave}` };
  try {
    await api('/v1/mongo/' + encodeURIComponent(id), { method: 'DELETE', headers });
    console.log('DELETE mongo', id);
  } catch (e) {
    if (e.status === 404) {
      console.log('skip delete mongo (404)', id);
      return;
    }
    throw e;
  }
}

async function upsertProyecto(clave, proyecto) {
  const headers = { Authorization: `Bearer ${clave}` };
  try {
    await api('/v1/proyectos/' + encodeURIComponent(proyecto.id), {
      method: 'PUT',
      headers,
      body: JSON.stringify(proyecto),
    });
    console.log('PUT proyecto', proyecto.id);
  } catch (e) {
    if (e.status === 404) {
      await api('/v1/proyectos', { method: 'POST', headers, body: JSON.stringify(proyecto) });
      console.log('POST proyecto', proyecto.id);
      return;
    }
    throw e;
  }
}

async function patchExisting(clave, id, patch) {
  const headers = { Authorization: `Bearer ${clave}` };
  const cur = await api('/v1/anclas/' + encodeURIComponent(id));
  const campo = { ...(cur.campo || {}), ...patch, id };
  delete campo.observaciones;
  delete campo.valorActual;
  delete campo.valor_actual;
  await api('/v1/anclas/' + encodeURIComponent(id), {
    method: 'PUT',
    headers,
    body: JSON.stringify(campo),
  });
  console.log('PATCH ancla', id);
}

async function seedObservacion(clave, anclaId, body) {
  const headers = { Authorization: `Bearer ${clave}` };
  await api('/v1/anclas/' + encodeURIComponent(anclaId) + '/observaciones', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  console.log('OBS', anclaId, body.negocio_id, body.valor);
}

function e164(raw) {
  let s = String(raw || '')
    .trim()
    .replace(/[\s\-().]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (!/^\+[1-9]\d{7,14}$/.test(s)) return null;
  return s;
}

/** X2: reescribe historial teléfono a E.164 vía D1 (POST solo añade). */
async function migratePhoneE164ViaD1() {
  const { spawnSync } = await import('node:child_process');

  const existing = await api(
    '/v1/anclas/negocio.telefono/valores?negocio_id=' + encodeURIComponent('pelo-sur')
  ).catch(() => ({ observaciones: [], valorActual: '' }));
  const obs = existing.observaciones || [];
  if (!obs.length) {
    console.log('X2: sin observaciones pelo-sur/telefono aún');
    return { seeded: false };
  }
  let changed = false;
  const next = obs.map((o) => {
    const n = e164(o.valor);
    if (!n) return o;
    if (n !== o.valor) changed = true;
    return { ...o, valor: n };
  });
  const valorActual = next.length ? next[next.length - 1].valor : '';
  if (!changed && valorActual === (existing.valorActual || '')) {
    console.log('X2: teléfono pelo-sur ya E.164');
    return { seeded: false, already: true };
  }
  const obsJson = JSON.stringify(next).replace(/'/g, "''");
  const valorEsc = String(valorActual).replace(/'/g, "''");
  const sql = `UPDATE ancla_valores_negocio SET observaciones = '${obsJson}', valor_actual = '${valorEsc}', updated_at = datetime('now') WHERE negocio_id = 'pelo-sur' AND ancla_id = 'negocio.telefono';`;
  const r = spawnSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'campos-ancla-db', '--remote', '--command', sql],
    { cwd: root, encoding: 'utf8', env: process.env }
  );
  if (r.status !== 0) {
    console.error(r.stdout || '', r.stderr || '');
    throw new Error('D1 E.164 migrate failed');
  }
  console.log('X2: normalizado historial teléfono pelo-sur →', valorActual);
  return { seeded: true, valorActual };
}

/** X6: nueva versión de mapear-recorrido si aún no pide `clase`. */
async function upsertSkillMapearV3(clave) {
  const { spawnSync } = await import('node:child_process');
  const headers = { Authorization: `Bearer ${clave}` };
  const md = readFileSync(join(root, 'catalogo/skills/mapear-recorrido/v3.md'), 'utf8');
  const anclas = [
    '_negocio.nombre_',
    '_negocio.url_',
    '_negocio.zona_horaria_',
    '_proceso.url_inicio_',
    '_version.recorrido.sistema.nombre_',
    '_version.recorrido.llega_a_b_',
    '_version.recorrido.pasos.N.accion_',
    '_version.recorrido.campos.N.nombre_',
    '_version.recorrido.campos.N.selector_',
    '_version.recorrido.campos.N.clase_',
    '_version.recorrido.boton_confirmar.selector_',
  ];
  const cur = await api('/v1/skills/mapear-recorrido').catch(() => null);
  const versiones = cur?.skill?.versiones || [];
  const hasClase = versiones.some((v) => String(v.markdown || '').includes('campos.N.clase'));
  if (!hasClase) {
    await api('/v1/skills/mapear-recorrido', {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        nombre: 'Mapear recorrido',
        descripcion:
          'Recorre la web de reserva desde A hasta B y describe el formulario con campos ancla (nombre, selector, clase), sin confirmar nunca.',
        markdown: md,
        anclas,
      }),
    });
    console.log('X6: PUT skill mapear-recorrido → nueva versión con clase');
    return;
  }
  // Ya hay versión con clase: solo alinea skill_anclas (PUT crearía otra versión).
  const esc = (s) => String(s).replace(/'/g, "''");
  const stmts = [
    "DELETE FROM skill_anclas WHERE skill_id = 'mapear-recorrido';",
    ...anclas.map(
      (a) =>
        `INSERT OR IGNORE INTO skill_anclas (skill_id, ancla) VALUES ('mapear-recorrido', '${esc(a)}');`
    ),
  ];
  const sql = stmts.join('\n');
  const r = spawnSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'campos-ancla-db', '--remote', '--command', sql],
    { cwd: root, encoding: 'utf8', env: process.env }
  );
  if (r.status !== 0) {
    console.error(r.stdout || '', r.stderr || '');
    throw new Error('D1 skill_anclas sync failed');
  }
  console.log('X6: mapear-recorrido ya tiene clase; skill_anclas sincronizadas');
}

const DELETE_ANCLA_IDS = [
  'contacto.telefono',
  'cliente.tarjeta_sanitaria',
  'campos.0.nombre',
  'campos.0.selector',
  'campos.1.nombre',
  'campos.1.selector',
  'campos.N.nombre',
  'campos.N.selector',
  'campos.N.sensible',
  // X3: sí/no sensible → enum clase
  'version.recorrido.campos.N.sensible',
];

const DELETE_MONGO_IDS = ['formularios-campos', 'versiones-recorrido-campos-N-selector'];

const anclas = [
  {
    id: 'version.recorrido.campos.N',
    ancla: '_version.recorrido.campos.N_',
    etiqueta: 'Campo N del recorrido (lista)',
    claveMongo: 'recorrido.campos',
    coleccion: 'versiones',
    tipo: 'array',
    formato: 'proyeccion-array',
    ejemplo: '[{nombre, selector, clase}]',
    descripcion:
      'Ancla de lista (X1/X5/X3): índice de versiones.recorrido.campos. Plantillas: nombre, selector, clase.',
    skills: ['mapear-recorrido', 'generar-script'],
    aliases: [],
    sensible: false,
  },
  {
    id: 'version.recorrido.campos.N.nombre',
    ancla: '_version.recorrido.campos.N.nombre_',
    etiqueta: 'Campo N · nombre',
    claveMongo: 'recorrido.campos.N.nombre',
    coleccion: 'versiones',
    tipo: 'string',
    ejemplo: 'Teléfono',
    descripcion: 'Plantilla: nombre del campo N en la versión del recorrido (lista canónica).',
    skills: ['mapear-recorrido'],
    aliases: [],
    sensible: false,
  },
  {
    id: 'version.recorrido.campos.N.selector',
    ancla: '_version.recorrido.campos.N.selector_',
    etiqueta: 'Campo N · selector',
    claveMongo: 'recorrido.campos.N.selector',
    coleccion: 'versiones',
    tipo: 'string',
    formato: 'playwright-locator',
    ejemplo: '#client-phone',
    descripcion: 'Selector Playwright del campo N (lista canónica en versiones.recorrido.campos).',
    skills: ['mapear-recorrido', 'generar-script'],
    aliases: [],
    sensible: false,
  },
  {
    id: 'version.recorrido.campos.N.clase',
    ancla: '_version.recorrido.campos.N.clase_',
    etiqueta: 'Campo N · clase',
    claveMongo: 'recorrido.campos.N.clase',
    coleccion: 'versiones',
    tipo: 'string',
    formato: 'enum:normal|texto_libre|identificador|sensible|consentimiento',
    ejemplo: 'normal',
    descripcion:
      'Clase del campo N (X3): normal | texto_libre | identificador | sensible | consentimiento. Nunca persistir el valor PII del cliente.',
    skills: ['mapear-recorrido'],
    aliases: [],
    sensible: false,
    obligatorio: true,
  },
  {
    id: 'reserva_prueba.cuando',
    ancla: '_reserva_prueba.cuando_',
    etiqueta: 'Reserva de prueba · cuándo',
    claveMongo: 'cuando',
    coleccion: 'reservas_prueba',
    tipo: 'date',
    formato: 'datetime',
    ejemplo: '2026-10-23T10:00:00+02:00',
    descripcion: 'Momento de la reserva de prueba (ISO-8601 → Mongo date).',
    skills: ['diagnosticar-alerta'],
    obligatorio: true,
  },
  {
    id: 'reserva_prueba.estado',
    ancla: '_reserva_prueba.estado_',
    etiqueta: 'Reserva de prueba · estado',
    claveMongo: 'estado',
    coleccion: 'reservas_prueba',
    tipo: 'string',
    formato: 'enum:pendiente|confirmada|cancelada|por_cancelar',
    ejemplo: 'cancelada',
    descripcion: 'Estado de la reserva de prueba.',
    skills: ['diagnosticar-alerta'],
    obligatorio: true,
  },
  {
    id: 'reserva_prueba.cancelada_en',
    ancla: '_reserva_prueba.cancelada_en_',
    etiqueta: 'Reserva de prueba · cancelada en',
    claveMongo: 'cancelada_en',
    coleccion: 'reservas_prueba',
    tipo: 'date',
    formato: 'datetime',
    ejemplo: '2026-10-23T10:15:00+02:00',
    descripcion: 'Cuándo se canceló la reserva de prueba (ISO-8601 → Mongo date).',
    skills: ['diagnosticar-alerta'],
  },
  {
    id: 'reserva_prueba.nota',
    ancla: '_reserva_prueba.nota_',
    etiqueta: 'Reserva de prueba · nota',
    claveMongo: 'nota',
    coleccion: 'reservas_prueba',
    tipo: 'string',
    ejemplo: 'Probada vía Booksy; cancelada en el panel del software',
    skills: ['diagnosticar-alerta'],
  },
];

async function main() {
  const clave = await ensureClave();

  for (const id of DELETE_ANCLA_IDS) {
    await deleteAncla(clave, id);
  }
  for (const id of DELETE_MONGO_IDS) {
    await deleteMongo(clave, id);
  }

  for (const a of anclas) await upsertAncla(clave, a);

  try {
    await patchExisting(clave, 'negocio.nombre', { aliases: ['salon_name', 'nombre_local'] });
  } catch (e) {
    console.warn('skip negocio.nombre', e.message);
  }

  try {
    await patchExisting(clave, 'negocio.telefono', {
      aliases: ['contacto.telefono', 'telefono_local'],
      formato: 'E.164',
      ejemplo: '+34699111222',
      descripcion:
        'Teléfono público del local (canónico). Alias: contacto.telefono, telefono_local. Valores E.164 por negocio_id.',
      sensible: false,
    });
  } catch (e) {
    console.warn('skip negocio.telefono', e.message);
  }

  try {
    await patchExisting(clave, 'proceso.url_inicio', {
      formato: 'uri, sin_pii',
      ejemplo: 'https://book.pelosur.es/',
      descripcion:
        'Punto A: URL de inicio sin query PII. Persistencia strict rechaza nombre/tel/email en query.',
    });
  } catch (e) {
    console.warn('skip proceso.url_inicio', e.message);
  }

  // X1/X3: lista canónica + clase
  await upsertMongo(clave, {
    id: 'versiones-recorrido-campos',
    campo: 'versiones.recorrido.campos',
    baseDatos: 'arquitectura_reservas',
    coleccion: 'versiones',
    clave: 'recorrido.campos',
    bsonType: 'array',
    obligatorio: false,
    descripcion:
      'Lista canónica de campos del formulario (X1/X3). Elemento: {nombre, selector, clase}. Booleanos reales en proyección.',
    ancla: '_version.recorrido.campos.N_',
    proyeccionMongo: 'array',
    proyeccionElemento: {
      nombre: 'version.recorrido.campos.N.nombre',
      selector: 'version.recorrido.campos.N.selector',
      clase: 'version.recorrido.campos.N.clase',
    },
  });

  // X4: cajón reservas_prueba en el plano
  await upsertMongo(clave, {
    id: 'reservas_prueba-cuando',
    campo: 'reservas_prueba.cuando',
    baseDatos: 'arquitectura_reservas',
    coleccion: 'reservas_prueba',
    clave: 'cuando',
    bsonType: 'date',
    obligatorio: true,
    descripcion: 'Momento del slot de la reserva de prueba (ISO-8601 → BSON date).',
    ancla: '_reserva_prueba.cuando_',
    indices: [{ nombre: 'idx_reservas_prueba_cuando', keys: { cuando: 1 } }],
  });
  await upsertMongo(clave, {
    id: 'reservas_prueba-estado',
    campo: 'reservas_prueba.estado',
    baseDatos: 'arquitectura_reservas',
    coleccion: 'reservas_prueba',
    clave: 'estado',
    bsonType: 'string',
    obligatorio: true,
    descripcion: 'Estado: pendiente | confirmada | cancelada | por_cancelar.',
    ancla: '_reserva_prueba.estado_',
    indices: [{ nombre: 'idx_reservas_prueba_estado', keys: { estado: 1 } }],
  });
  await upsertMongo(clave, {
    id: 'reservas_prueba-cancelada_en',
    campo: 'reservas_prueba.cancelada_en',
    baseDatos: 'arquitectura_reservas',
    coleccion: 'reservas_prueba',
    clave: 'cancelada_en',
    bsonType: 'date',
    obligatorio: false,
    descripcion: 'Cuándo se canceló la reserva de prueba (BSON date), si aplica.',
    ancla: '_reserva_prueba.cancelada_en_',
    indices: [],
  });
  await upsertMongo(clave, {
    id: 'reservas_prueba-nota',
    campo: 'reservas_prueba.nota',
    baseDatos: 'arquitectura_reservas',
    coleccion: 'reservas_prueba',
    clave: 'nota',
    bsonType: 'string',
    obligatorio: false,
    descripcion: 'Nota de seguimiento (canal, software, qué cancelar).',
    ancla: '_reserva_prueba.nota_',
    indices: [],
  });

  await upsertSkillMapearV3(clave);

  const phoneHistory = [
    {
      valor: '+34612000111',
      url: 'https://pelosur.es/contacto',
      timestamp: '2026-10-13T10:00:00.000Z',
      visto_en: 'web',
    },
    {
      valor: '+34699111222',
      url: 'https://pelosur.es/contacto',
      timestamp: '2026-10-17T16:30:00.000Z',
      visto_en: 'web',
    },
  ];
  const existing = await api(
    '/v1/anclas/negocio.telefono/valores?negocio_id=' + encodeURIComponent('pelo-sur')
  ).catch(() => ({ observaciones: [] }));
  if (!(existing.observaciones || []).length) {
    for (const h of phoneHistory) {
      await seedObservacion(clave, 'negocio.telefono', {
        negocio_id: 'pelo-sur',
        ...h,
        skill_id: 'descubrir-negocio',
      });
    }
  } else {
    await migratePhoneE164ViaD1();
  }

  await upsertProyecto(clave, {
    id: 'pelo-sur',
    nombre: 'Pelo Sur',
    descripcion: 'Salón ficticio — clase de campo, reservas_prueba en plano, E.164.',
    markdown:
      '# Pelo Sur\n\nLista: `_version.recorrido.campos.N.{nombre,selector,clase}_`. Cajón `reservas_prueba`. Teléfono E.164.\n',
    skills: ['descubrir-negocio', 'mapear-recorrido', 'diagnosticar-alerta'],
  });

  console.log('Upsert auditoría X3/X4/X6 OK →', API);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
