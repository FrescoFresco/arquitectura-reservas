#!/usr/bin/env node
/**
 * Upsert / migrate Pelo Sur + auditoría N1–N5 into remote D1 via HTTP API
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
  // Strip negocio values — definition only
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
      console.log('skip delete (404)', id);
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

const DELETE_IDS = [
  'contacto.telefono',
  'cliente.tarjeta_sanitaria',
  'campos.0.nombre',
  'campos.0.selector',
  'campos.1.nombre',
  'campos.1.selector',
];

const anclas = [
  {
    id: 'campos.N.nombre',
    ancla: '_campos.N.nombre_',
    etiqueta: 'Campo N · nombre',
    claveMongo: 'campos.N.nombre',
    coleccion: 'formularios',
    tipo: 'string',
    ejemplo: 'Nombre',
    descripcion: 'Plantilla: nombre del campo N. Índices solo en valores / proyección array.',
    skills: ['mapear-recorrido'],
    aliases: [],
    sensible: false,
  },
  {
    id: 'campos.N.selector',
    ancla: '_campos.N.selector_',
    etiqueta: 'Campo N · selector',
    claveMongo: 'campos.N.selector',
    coleccion: 'formularios',
    tipo: 'string',
    ejemplo: '#client-name',
    descripcion: 'Plantilla: selector del campo N. Índices solo en valores / proyección array.',
    skills: ['mapear-recorrido'],
    aliases: [],
    sensible: false,
  },
  {
    id: 'campos.N.sensible',
    ancla: '_campos.N.sensible_',
    etiqueta: 'Campo N · sensible (clase)',
    claveMongo: 'campos.N.sensible',
    coleccion: 'formularios',
    tipo: 'boolean',
    formato: 'clase',
    ejemplo: 'true',
    descripcion:
      'Clase del campo del formulario (sensible). Nunca persistir el valor PII del cliente; solo la marca.',
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

  for (const id of DELETE_IDS) {
    await deleteAncla(clave, id);
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
        'Teléfono público del local (canónico). Alias: contacto.telefono, telefono_local. Valores por negocio_id.',
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

  // N2: historial teléfono Pelo Sur → por negocio_id (no en ficha)
  const phoneHistory = [
    {
      valor: '+34 612 000 111',
      url: 'https://pelosur.es/contacto',
      timestamp: '2026-10-13T10:00:00.000Z',
      visto_en: 'web',
    },
    {
      valor: '+34 699 111 222',
      url: 'https://pelosur.es/contacto',
      timestamp: '2026-10-17T16:30:00.000Z',
      visto_en: 'web',
    },
  ];
  // Re-seed: append both (idempotent enough for demo; valores grow if re-run)
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
    console.log('OBS pelo-sur/negocio.telefono ya tiene', existing.observaciones.length, 'filas');
  }

  await upsertMongo(clave, {
    id: 'formularios-campos',
    campo: 'formularios.campos',
    baseDatos: 'arquitectura_reservas',
    coleccion: 'formularios',
    clave: 'campos',
    bsonType: 'array',
    obligatorio: false,
    descripcion: 'Proyección array: campos.N.* → [{nombre, selector, sensible}, …].',
    ancla: '_campos.N_',
    proyeccionMongo: 'array',
    proyeccionElemento: {
      nombre: 'campos.N.nombre',
      selector: 'campos.N.selector',
      sensible: 'campos.N.sensible',
    },
  });

  await upsertProyecto(clave, {
    id: 'pelo-sur',
    nombre: 'Pelo Sur',
    descripcion: 'Salón ficticio — aliases, valores por negocio, clase sensible, reserva de prueba.',
    markdown:
      '# Pelo Sur\n\nProyecto de catálogo. Teléfono canónico `_negocio.telefono_` (alias contacto.telefono).\n',
    skills: ['descubrir-negocio', 'mapear-recorrido', 'diagnosticar-alerta'],
  });

  console.log('Upsert auditoría N1–N5 OK →', API);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
