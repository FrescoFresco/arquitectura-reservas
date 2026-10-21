#!/usr/bin/env node
/**
 * Upsert / migrate Pelo Sur + auditoría X1/X5/X2 (lista canónica recorrido,
 * índice `_version.recorrido.campos.N_`, E.164) into remote D1 via HTTP API
 * without wiping existing agentes/invites.
 *
 * Usage:
 *   AGENTE_CLAVE=inv_… node scripts/upsert-pelo-sur.mjs
 */
const API = (process.env.API_BASE || 'https://campos-ancla-api.web-legal-es.workers.dev').replace(/\/$/, '');

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
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');

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

const DELETE_ANCLA_IDS = [
  'contacto.telefono',
  'cliente.tarjeta_sanitaria',
  'campos.0.nombre',
  'campos.0.selector',
  'campos.1.nombre',
  'campos.1.selector',
  // X1: lista duplicada en formularios — canónico = version.recorrido.campos
  'campos.N.nombre',
  'campos.N.selector',
  'campos.N.sensible',
];

const DELETE_MONGO_IDS = [
  'formularios-campos',
  'versiones-recorrido-campos-N-selector',
];

const anclas = [
  {
    id: 'version.recorrido.campos.N',
    ancla: '_version.recorrido.campos.N_',
    etiqueta: 'Campo N del recorrido (lista)',
    claveMongo: 'recorrido.campos',
    coleccion: 'versiones',
    tipo: 'array',
    formato: 'proyeccion-array',
    ejemplo: '[{nombre, selector, sensible}]',
    descripcion:
      'Ancla de lista (X1/X5): índice de versiones.recorrido.campos. Plantillas: nombre, selector, sensible.',
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
    id: 'version.recorrido.campos.N.sensible',
    ancla: '_version.recorrido.campos.N.sensible_',
    etiqueta: 'Campo N · sensible (clase)',
    claveMongo: 'recorrido.campos.N.sensible',
    coleccion: 'versiones',
    tipo: 'boolean',
    formato: 'clase',
    ejemplo: 'true',
    descripcion: 'Clase sensible del campo N. Nunca persistir el valor PII del cliente.',
    skills: ['mapear-recorrido'],
    aliases: [],
    sensible: false,
  },
  {
    id: 'reserva_prueba.cuando',
    ancla: '_reserva_prueba.cuando_',
    etiqueta: 'Reserva de prueba · cuándo',
    claveMongo: 'cuando',
    coleccion: 'reservas_prueba',
    tipo: 'string',
    formato: 'datetime',
    ejemplo: '2026-10-23T10:00:00+02:00',
    descripcion: 'Momento de la reserva de prueba.',
    skills: ['diagnosticar-alerta'],
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
  },
  {
    id: 'reserva_prueba.cancelada_en',
    ancla: '_reserva_prueba.cancelada_en_',
    etiqueta: 'Reserva de prueba · cancelada en',
    claveMongo: 'cancelada_en',
    coleccion: 'reservas_prueba',
    tipo: 'string',
    formato: 'datetime',
    ejemplo: '2026-10-23T10:15:00+02:00',
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

  // X1: lista canónica en versiones.recorrido.campos
  await upsertMongo(clave, {
    id: 'versiones-recorrido-campos',
    campo: 'versiones.recorrido.campos',
    baseDatos: 'arquitectura_reservas',
    coleccion: 'versiones',
    clave: 'recorrido.campos',
    bsonType: 'array',
    obligatorio: false,
    descripcion:
      'Lista canónica de campos del formulario en la versión del recorrido (X1). No usar formularios.campos.',
    ancla: '_version.recorrido.campos.N_',
    proyeccionMongo: 'array',
    proyeccionElemento: {
      nombre: 'version.recorrido.campos.N.nombre',
      selector: 'version.recorrido.campos.N.selector',
      sensible: 'version.recorrido.campos.N.sensible',
    },
  });

  // Teléfono: seed si vacío; si hay filas, normalizar E.164 en D1
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
    descripcion: 'Salón ficticio — lista canónica en versiones.recorrido.campos, E.164.',
    markdown:
      '# Pelo Sur\n\nLista de campos del formulario: `_version.recorrido.campos.N_*` (no formularios). Teléfono E.164 `_negocio.telefono_`.\n',
    skills: ['descubrir-negocio', 'mapear-recorrido', 'diagnosticar-alerta'],
  });

  console.log('Upsert auditoría X1/X5/X2 OK →', API);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
