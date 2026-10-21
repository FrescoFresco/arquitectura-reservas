#!/usr/bin/env node
/**
 * Upsert Pelo Sur example anclas/mongo/proyecto into remote D1 via HTTP API
 * without wiping existing agentes/invites.
 *
 * Usage:
 *   AGENTE_CLAVE=inv_… node scripts/upsert-pelo-sur.mjs
 *   (If no clave, creates a temporary invite via POST /v1/invites)
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
  try {
    await api('/v1/anclas/' + encodeURIComponent(campo.id), {
      method: 'PUT',
      headers,
      body: JSON.stringify(campo),
    });
    console.log('PUT ancla', campo.id);
  } catch (e) {
    if (e.status === 404) {
      await api('/v1/anclas', { method: 'POST', headers, body: JSON.stringify(campo) });
      console.log('POST ancla', campo.id);
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
  await api('/v1/anclas/' + encodeURIComponent(id), {
    method: 'PUT',
    headers,
    body: JSON.stringify(campo),
  });
  console.log('PATCH ancla', id);
}

const anclas = [
  {
    id: 'contacto.telefono',
    ancla: '_contacto.telefono_',
    etiqueta: 'Teléfono de contacto',
    claveMongo: 'telefono',
    coleccion: 'negocios',
    tipo: 'string',
    formato: 'E.164',
    descripcion: 'Teléfono de contacto del negocio (canónico Pelo Sur).',
    ejemplo: '+34 699 111 222',
    aliases: ['negocio.telefono', 'telefono_local'],
    skills: ['descubrir-negocio'],
    observaciones: [
      { valor: '+34 612 000 111', url: 'https://pelosur.es/contacto', timestamp: '2026-10-13T10:00:00.000Z' },
      { valor: '+34 699 111 222', url: 'https://pelosur.es/contacto', timestamp: '2026-10-17T16:30:00.000Z' },
    ],
    valorActual: '+34 699 111 222',
    sensible: false,
  },
  {
    id: 'cliente.tarjeta_sanitaria',
    ancla: '_cliente.tarjeta_sanitaria_',
    etiqueta: 'Tarjeta sanitaria',
    claveMongo: 'tarjeta_sanitaria',
    coleccion: 'clientes',
    tipo: 'string',
    formato: 'sensible',
    descripcion: 'Nº tarjeta sanitaria. Sensible: UI/logs enmascaran.',
    ejemplo: 'ES-1234-5678',
    aliases: [],
    skills: [],
    sensible: true,
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
  {
    id: 'campos.0.nombre',
    ancla: '_campos.0.nombre_',
    etiqueta: 'Campo 0 · nombre',
    claveMongo: '0.nombre',
    coleccion: 'formularios',
    tipo: 'string',
    ejemplo: 'Nombre',
    skills: ['mapear-recorrido'],
  },
  {
    id: 'campos.0.selector',
    ancla: '_campos.0.selector_',
    etiqueta: 'Campo 0 · selector',
    claveMongo: '0.selector',
    coleccion: 'formularios',
    tipo: 'string',
    ejemplo: '#client-name',
    skills: ['mapear-recorrido'],
  },
  {
    id: 'campos.1.nombre',
    ancla: '_campos.1.nombre_',
    etiqueta: 'Campo 1 · nombre',
    claveMongo: '1.nombre',
    coleccion: 'formularios',
    tipo: 'string',
    ejemplo: 'Teléfono',
    skills: ['mapear-recorrido'],
  },
  {
    id: 'campos.1.selector',
    ancla: '_campos.1.selector_',
    etiqueta: 'Campo 1 · selector',
    claveMongo: '1.selector',
    coleccion: 'formularios',
    tipo: 'string',
    ejemplo: '#client-phone',
    skills: ['mapear-recorrido'],
  },
];

async function main() {
  const clave = await ensureClave();
  for (const a of anclas) await upsertAncla(clave, a);
  try {
    await patchExisting(clave, 'negocio.nombre', { aliases: ['salon_name', 'nombre_local'] });
  } catch (e) {
    console.warn('skip negocio.nombre', e.message);
  }
  try {
    await patchExisting(clave, 'negocio.telefono', { aliases: ['telefono_local'] });
  } catch (e) {
    console.warn('skip negocio.telefono', e.message);
  }
  try {
    await patchExisting(clave, 'proceso.url_inicio', {
      formato: 'uri, sin_pii',
      descripcion:
        'URL de inicio del proceso de reserva. Sin nombre/tel/email en query.',
    });
  } catch (e) {
    console.warn('skip proceso.url_inicio', e.message);
  }
  await upsertMongo(clave, {
    id: 'formularios-campos',
    campo: 'formularios.campos',
    baseDatos: 'arquitectura_reservas',
    coleccion: 'formularios',
    clave: 'campos',
    bsonType: 'array',
    obligatorio: false,
    descripcion: 'Proyección array: campos.N.* → [{nombre, selector}, …].',
    ancla: '_campos.N_',
    proyeccionMongo: 'array',
    proyeccionElemento: { nombre: 'campos.N.nombre', selector: 'campos.N.selector' },
  });
  await upsertProyecto(clave, {
    id: 'pelo-sur',
    nombre: 'Pelo Sur',
    descripcion: 'Salón ficticio — aliases, observaciones, sensibles, reserva de prueba.',
    markdown: '# Pelo Sur\n\nProyecto de catálogo para casos ancla.\n',
    skills: ['descubrir-negocio', 'mapear-recorrido', 'diagnosticar-alerta'],
  });
  console.log('Upsert Pelo Sur OK →', API);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
