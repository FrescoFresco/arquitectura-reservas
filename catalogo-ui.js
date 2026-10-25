'use strict';

const CATALOGOS = [
  { id: 'clusters', nombre: 'Clusters', icono: 'cluster' },
  { id: 'proyectos', nombre: 'Base de datos', icono: 'proyecto' },
  { id: 'colecciones', nombre: 'Colecciones', icono: 'coleccion' },
  { id: 'campos-mongodb', nombre: 'Campos', icono: 'mongo' },
  { id: 'campos-ancla', nombre: 'Campos ancla', icono: 'ancla' },
  { id: 'skills', nombre: 'Skills', icono: 'skills' },
  { id: 'ejecutores', nombre: 'Ejecutores', icono: 'ejecutor' },
  { id: 'flujos', nombre: 'Flujos', icono: 'flujo' },
  { id: 'system-prompts', nombre: 'System prompts', icono: 'system-prompt' }
];
const DOCUMENTOS = [
  { id: 'fundamentos', nombre: 'Fundamentos', icono: 'fundamento' },
  { id: 'arquitectura', nombre: 'Arquitectura', icono: 'arquitectura' },
  { id: 'api', nombre: 'API', icono: 'api' },
  { id: 'mongodb', nombre: 'MongoDB', icono: 'mongo' }
];
const LS_KEY = 'arquitectura-reservas.catalogo.skills';
const LS_CAMPOS = 'arquitectura-reservas.catalogo.campos-ancla';
const LS_MONGO = 'arquitectura-reservas.catalogo.campos-mongodb';
const LS_PROYECTOS = 'arquitectura-reservas.catalogo.proyectos';
const LS_AGENTES = 'arquitectura-reservas.catalogo.agentes';
const LS_FUNDAMENTOS = 'arquitectura-reservas.catalogo.fundamentos';
const AGENTE_LATIDO_MS = 120000;
const AGENTE_POLL_MS = 4000;
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];


const FICHA_PANE_IDS = [
  'dlgSkill',
  'dlgCampoFicha',
  'dlgMongoFicha',
  'dlgCluster',
  'dlgProyecto',
  'dlgColeccion',
  'dlgAgenteFicha',
  'dlgFundamento',
  'dlgSystemPrompt',
  'dlgEjecutor',
  'dlgFlujo',
  'dlgCorrida'
];

function syncFichaPaneClass() {
  const open = FICHA_PANE_IDS.some(function (id) {
    const d = document.getElementById(id);
    return !!(d && d.open);
  });
  document.documentElement.classList.toggle('ficha-pane-open', open);
}

function openFichaPane(dlg) {
  if (!dlg) return;
  FICHA_PANE_IDS.forEach(function (id) {
    if (dlg.id && id === dlg.id) return;
    const other = document.getElementById(id);
    if (other && other.open) other.close();
  });
  const wasOpen = !!dlg.open;
  if (!wasOpen) {
    if (typeof dlg.show === 'function') dlg.show();
    else if (typeof dlg.showModal === 'function') dlg.showModal();
    try {
      history.pushState({ fichaPane: dlg.id || true }, '', location.href);
    } catch (err) {}
  }
  syncFichaPaneClass();
}

function cerrarTodasFichasPane() {
  FICHA_PANE_IDS.forEach(function (id) {
    const d = document.getElementById(id);
    if (d && d.open) d.close();
  });
  syncFichaPaneClass();
}
window.cerrarTodasFichasPane = cerrarTodasFichasPane;

/** Cierra la ficha abierta; si hay entrada de historial, usa atrás del navegador. */
function atrasDesdeFicha(closeFn) {
  if (history.state && history.state.fichaPane) {
    try {
      history.back();
      return;
    } catch (err) {}
  }
  if (typeof closeFn === 'function') closeFn();
}

function cerrarFichasPorPopstate() {
  let hubo = false;
  FICHA_PANE_IDS.forEach(function (id) {
    const d = document.getElementById(id);
    if (d && d.open) {
      d.close();
      hubo = true;
    }
  });
  if (hubo) syncFichaPaneClass();
}


function esHashHex(h) {
  return typeof h === 'string' && /^[a-f0-9]{16,64}$/i.test(h.trim());
}

function normalizarHash(h) {
  return esHashHex(h) ? h.trim().toLowerCase() : '';
}

function hashFnvHex(str) {
  let h1 = 2166136261 >>> 0;
  let h2 = 2166136261 >>> 0;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) {
    h1 ^= s.charCodeAt(i);
    h1 = Math.imul(h1, 16777619) >>> 0;
  }
  for (let j = s.length - 1; j >= 0; j--) {
    h2 ^= s.charCodeAt(j);
    h2 = Math.imul(h2, 16777619) >>> 0;
  }
  return ('00000000' + h1.toString(16)).slice(-8) + ('00000000' + h2.toString(16)).slice(-8);
}

async function sha256Hex(texto) {
  const raw = String(texto || '');
  if (window.crypto && crypto.subtle) {
    const data = new TextEncoder().encode(raw);
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf)).map(function (b) {
      return b.toString(16).padStart(2, '0');
    }).join('');
  }
  return hashFnvHex(raw);
}

function payloadHashAncla(c) {
  return [
    c.ancla || '', c.etiqueta || '', c.claveMongo || '', c.coleccion || '',
    c.baseDatos || '', c.tipo || '', c.obligatorio ? '1' : '0',
    c.sensible ? '1' : '0',
    c.formato || '', c.descripcion || '', c.ejemplo || '',
    (c.aliases || []).join(','),
    (c.skills || []).join(',')
  ].join('|');
}

function payloadHashMongo(c) {
  return [
    c.campo || '', c.baseDatos || '', c.coleccion || '', c.clave || '',
    c.bsonType || '', c.obligatorio ? '1' : '0',
    c.descripcion || '', c.ancla || '',
    c.proyeccionMongo || '', JSON.stringify(c.proyeccionElemento || {}),
    JSON.stringify(c.indices || [])
  ].join('|');
}

function normalizarAliasesLista(list) {
  const raw = Array.isArray(list)
    ? list
    : String(list || '').split(/[\n,]+/);
  const out = [];
  const seen = new Set();
  raw.forEach(function (item) {
    let a = String(item || '').trim().replace(/^_+|_+$/g, '');
    if (!a) return;
    const key = a.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(a);
  });
  return out;
}

function claveCatalogoEscritura() {
  try {
    return (
      localStorage.getItem('AGENTE_CLAVE') ||
      localStorage.getItem('ARQ_AGENTE_CLAVE') ||
      ''
    ).trim();
  } catch (e) {
    return '';
  }
}

function guardarClaveCatalogo(clave) {
  try {
    if (clave) localStorage.setItem('AGENTE_CLAVE', clave);
  } catch (e) {}
}

function apiFetchAuth(path, opts) {
  const init = Object.assign({}, opts || {});
  const headers = Object.assign({}, init.headers || {});
  const clave = claveCatalogoEscritura();
  if (clave) {
    headers.Authorization = 'Bearer ' + clave;
  }
  init.headers = headers;
  return apiFetch(path, init);
}

/**
 * Color catálogo — capa fina sobre window.ColorEntidad (módulo único).
 * Persistencia, picker y tint viven en color-entidad-ui.js.
 */
function coloresUsadosCatalogo(kind, excludeId) {
  if (window.ColorEntidad && typeof window.ColorEntidad.coloresUsados === 'function') {
    return window.ColorEntidad.coloresUsados(kind, excludeId);
  }
  return [];
}

function guardarColorEntidad(kind, id, color) {
  if (!window.ColorEntidad || typeof window.ColorEntidad.guardar !== 'function') {
    return Promise.reject(new Error('ColorEntidad no cargado.'));
  }
  return window.ColorEntidad.guardar(kind, id, color, optsColeccionColor());
}

function optsColeccionColor() {
  return {
    getProyecto: function (proyId) {
      return ((state.proyectos && state.proyectos.lista) || []).find(function (p) {
        return p.id === proyId;
      }) || null;
    },
    onProyectoUpdated: function (proyId, data) {
      if (data && data.proyecto) {
        const idx = (state.proyectos.lista || []).findIndex(function (p) { return p.id === proyId; });
        if (idx >= 0) {
          const merged = Object.assign({}, state.proyectos.lista[idx], data.proyecto);
          if (Array.isArray(data.proyecto.colecciones)) {
            merged.colecciones = fusionarColeccionesMeta(
              state.proyectos.lista[idx].colecciones,
              data.proyecto.colecciones
            );
          }
          state.proyectos.lista[idx] = merged;
        }
        const ridx = (state.proyectos.remotos || []).findIndex(function (p) { return p.id === proyId; });
        if (ridx >= 0 && data.proyecto) {
          state.proyectos.remotos[ridx] = Object.assign({}, state.proyectos.remotos[ridx], data.proyecto);
        }
      }
      if (typeof refrescarListaColecciones === 'function') refrescarListaColecciones();
    }
  };
}

function cablearColorFicha(dlgOrEl, opts) {
  opts = opts || {};
  if (!window.ColorEntidad || typeof window.ColorEntidad.bindCatalogFicha !== 'function') return;
  window.ColorEntidad.bindCatalogFicha(dlgOrEl, Object.assign({}, opts, {
    coleccionOpts: optsColeccionColor()
  }));
}

window.guardarColorEntidad = guardarColorEntidad;
window.coloresUsadosCatalogo = coloresUsadosCatalogo;
window.cablearColorFicha = cablearColorFicha;

/** Registra kinds en ColorEntidad (listas + refresh). Llamar tras definir state. */
function registrarColorEntidadKinds() {
  if (!window.ColorEntidad || typeof window.ColorEntidad.registerKind !== 'function') return;
  window.ColorEntidad.configure({
    ensureAuth: asegurarClaveCatalogo,
    apiFetchAuth: apiFetchAuth
  });
  function setOnList(list, id, color) {
    if (!list) return;
    list.forEach(function (x) {
      if (x && x.id === id) x.color = color;
    });
  }
  window.ColorEntidad.registerKind('skill', {
    listItems: function () { return state.instrucciones || []; },
    applyLocal: function (id, color) { setOnList(state.instrucciones, id, color); },
    refresh: function () { if (typeof pintarSkills === 'function') pintarSkills(); }
  });
  window.ColorEntidad.registerKind('ancla', {
    listItems: function () { return (state.campos && state.campos.lista) || []; },
    applyLocal: function (id, color) {
      setOnList(state.campos && state.campos.lista, id, color);
      setOnList(state.campos && state.campos.remotos, id, color);
    },
    refresh: function () {
      if (window.CamposAnclaUI && typeof window.CamposAnclaUI.refrescar === 'function' && typeof camposBridge === 'function') {
        window.CamposAnclaUI.refrescar(camposBridge());
      }
    }
  });
  window.ColorEntidad.registerKind('mongo', {
    listItems: function () { return (state.mongo && state.mongo.lista) || []; },
    applyLocal: function (id, color) {
      setOnList(state.mongo && state.mongo.lista, id, color);
      setOnList(state.mongo && state.mongo.remotos, id, color);
    },
    refresh: function () {
      if (window.CamposMongoUI && typeof window.CamposMongoUI.refrescar === 'function' && typeof mongoBridge === 'function') {
        window.CamposMongoUI.refrescar(mongoBridge());
      }
    }
  });
  window.ColorEntidad.registerKind('cluster', {
    listItems: function () { return (state.clusters && state.clusters.lista) || []; },
    applyLocal: function (id, color) { setOnList(state.clusters && state.clusters.lista, id, color); },
    refresh: function () {
      if (window.ClustersUI && typeof window.ClustersUI.refrescar === 'function') window.ClustersUI.refrescar(clustersBridge());
      else if (typeof pintarClusters === 'function') pintarClusters();
    }
  });
  window.ColorEntidad.registerKind('proyecto', {
    listItems: function () { return (state.proyectos && state.proyectos.lista) || []; },
    applyLocal: function (id, color) { setOnList(state.proyectos && state.proyectos.lista, id, color); },
    refresh: function () {
      if (window.ProyectosUI && typeof window.ProyectosUI.refrescar === 'function') window.ProyectosUI.refrescar(proyectosBridge());
      else if (typeof pintarProyectos === 'function') pintarProyectos();
    }
  });
  window.ColorEntidad.registerKind('system-prompt', {
    listItems: function () { return (state.systemPrompts && state.systemPrompts.lista) || []; },
    applyLocal: function (id, color) { setOnList(state.systemPrompts && state.systemPrompts.lista, id, color); },
    refresh: function () {
      if (window.SystemPromptsUI && typeof window.SystemPromptsUI.refrescar === 'function') {
        window.SystemPromptsUI.refrescar();
      }
    }
  });

  window.ColorEntidad.registerKind('ejecutor', {
    listItems: function () { return (window.EjecutoresCatalog && window.EjecutoresCatalog.state && window.EjecutoresCatalog.state.lista) || []; },
    applyLocal: function (id, color) {
      var lista = window.EjecutoresCatalog && window.EjecutoresCatalog.state && window.EjecutoresCatalog.state.lista;
      if (!lista) return;
      for (var i = 0; i < lista.length; i++) {
        if (lista[i].id === id) { lista[i].color = color; break; }
      }
    },
    refresh: function () { if (window.EjecutoresCatalog) window.EjecutoresCatalog.pintar(); }
  });
  window.ColorEntidad.registerKind('fundamento', {
    listItems: function () { return (state.fundamentos && state.fundamentos.lista) || []; },
    applyLocal: function (id, color) { setOnList(state.fundamentos && state.fundamentos.lista, id, color); },
    refresh: function () {
      if (window.FundamentosUI && typeof window.FundamentosUI.refrescar === 'function') {
        window.FundamentosUI.refrescar();
      }
    }
  });
  window.ColorEntidad.registerKind('agente', {
    listItems: function () { return (state.agentes && state.agentes.lista) || []; },
    applyLocal: function (id, color) { setOnList(state.agentes && state.agentes.lista, id, color); },
    refresh: function () { if (typeof pintarAgentes === 'function') pintarAgentes(); }
  });
  window.ColorEntidad.registerKind('flujo', {
    listItems: function () {
      var out = [];
      var seen = {};
      function push(x) {
        if (!x || !x.id || seen[x.id]) return;
        seen[x.id] = true;
        out.push(x);
      }
      ((state.flujos && state.flujos.lista) || []).forEach(push);
      var fc = window.FlujosCorridasUI && window.FlujosCorridasUI.state;
      if (fc) {
        (fc.flujos || []).forEach(push);
        (fc.catalogFlujos || []).forEach(push);
      }
      return out;
    },
    applyLocal: function (id, color) {
      setOnList(state.flujos && state.flujos.lista, id, color);
      var fc = window.FlujosCorridasUI && window.FlujosCorridasUI.state;
      if (fc) {
        (fc.flujos || []).forEach(function (x) { if (x && x.id === id) x.color = color; });
        (fc.catalogFlujos || []).forEach(function (x) { if (x && x.id === id) x.color = color; });
      }
    },
    refresh: function () {
      if (window.FlujosCorridasUI) {
        if (typeof window.FlujosCorridasUI.refrescarListas === 'function') window.FlujosCorridasUI.refrescarListas();
        else if (typeof window.FlujosCorridasUI.cargarCatalogo === 'function') window.FlujosCorridasUI.cargarCatalogo();
      }
    }
  });
  window.ColorEntidad.registerKind('coleccion', {
    listItems: function () { return (state.colecciones && state.colecciones.lista) || []; },
    itemId: function (x) { return x && (x.key != null ? x.key : x.id); },
    applyLocal: function (id, color) {
      ((state.colecciones && state.colecciones.lista) || []).forEach(function (x) {
        if (x.key === id || x.id === id) x.color = color;
      });
      ((state.proyectos && state.proyectos.lista) || []).forEach(function (proy) {
        (proy.colecciones || []).forEach(function (c) {
          const key = (typeof claveColeccion === 'function')
            ? claveColeccion(proy.id, c.id)
            : (proy.id + '/' + c.id);
          if (key === id || c.id === id) c.color = color;
        });
      });
      // Remotos: mismo JSON que alimenta construirListaColecciones tras reload/merge.
      ((state.proyectos && state.proyectos.remotos) || []).forEach(function (proy) {
        (proy.colecciones || []).forEach(function (c) {
          const key = (typeof claveColeccion === 'function')
            ? claveColeccion(proy.id, c.id)
            : (proy.id + '/' + c.id);
          if (key === id || c.id === id) c.color = color;
        });
      });
    },
    refresh: function () {
      if (typeof refrescarListaColecciones === 'function') refrescarListaColecciones();
      if (typeof pintarColecciones === 'function') pintarColecciones();
      if (state.proyectos && state.proyectos.abiertoId && typeof pintarProyectoColecciones === 'function') {
        const proy = typeof proyectoAbierto === 'function' ? proyectoAbierto() : null;
        if (proy) pintarProyectoColecciones(proy);
      }
    }
  });
}

function asegurarClaveCatalogo() {
  const existing = claveCatalogoEscritura();
  if (existing) return Promise.resolve(existing);
  return apiFetch('/v1/invites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  }).then(function (data) {
    const clave = data && data.invite && data.invite.clave;
    if (!clave) throw new Error('No se pudo crear invite de catálogo.');
    guardarClaveCatalogo(clave);
    return clave;
  });
}

function anclasCanonicasTexto(list) {
  return normalizarAnclas(list).join('\n');
}

const state = {
  catalogoId: CATALOGOS[0].id,
  docId: DOCUMENTOS[0].id,
  ready: false,
  indexError: false,
  remotas: [],
  instrucciones: [],
  abiertaId: null,
  abiertaNumero: null,
  historial: false,
  historialSkillId: null,
  campos: {
    ready: false,
    indexError: false,
    remotos: [],
    lista: [],
    abiertoId: null
  },
  mongo: {
    ready: false,
    indexError: false,
    remotos: [],
    lista: [],
    abiertoId: null,
    initialTab: null,
    reabrirColeccionKey: null,
    reabrirColeccionTab: null
  },
  colecciones: {
    ready: false,
    indexError: false,
    lista: [],
    abiertaKey: null,
    volverA: null,
    navigatingAway: false,
    tab: 'resumen',
    asocSub: 'base-datos',
    diagramaToken: 0,
    _mermaidPromise: null
  },
  clusters: {
    ready: false,
    indexError: false,
    lista: [],
    abiertoId: null,
    tab: 'resumen',
    asocSub: 'bases'
  },
  proyectos: {
    ready: false,
    indexError: false,
    remotos: [],
    lista: [],
    abiertoId: null,
    abiertaNumero: null,
    historial: false,
    asocSub: 'cluster',
    reabrirColeccionKey: null,
    reabrirColeccionTab: null,
    fetchToken: 0,
    inflightRuta: null,
    reabrirTrasSkill: null,
    empujes: {
      items: [],
      nextCursor: null,
      loading: false,
      token: 0,
      openId: null,
      estado: '',
      desde: '',
      hasta: ''
    }
  },
  apiDoc: { loaded: false, loading: false, error: false },
  arqDoc: {
    index: null,
    subId: null,
    cache: {},
    indexError: false,
    loading: false,
    fetchToken: 0
  },
  mongoDoc: {
    index: null,
    subId: null,
    cache: {},
    tipos: null,
    indexError: false,
    loading: false,
    fetchToken: 0
  },
  agentes: {
    ready: false,
    indexError: false,
    remotos: [],
    lista: [],
    abiertoId: null,
    inviteActual: null,
    lastSyncAt: null,
    pollTimer: null,
    pollInflight: false
  },
  fundamentos: {
    ready: false,
    indexError: false,
    remotos: [],
    lista: [],
    abiertoId: null,
    abiertaNumero: null,
    historial: false,
    fetchToken: 0,
    inflightRuta: null
  },
  fetchToken: 0,
  inflightRuta: null,
  pendingFocus: null
};

const mdCache = new Map();

function formatVersion(numero, fecha) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(fecha || '');
  if (!match) return 'v' + numero;
  const mes = MESES[Number(match[2]) - 1];
  if (!mes) return 'v' + numero;
  return 'v' + numero + ' · ' + Number(match[3]) + ' ' + mes;
}

function todayISO(date) {
  const d = date || new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + m + '-' + day;
}

function siguienteNumero(versiones) {
  return versiones.reduce(function (max, v) { return Math.max(max, v.numero); }, 0) + 1;
}

function slugId(nombre) {
  const base = String(nombre || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'instruccion';
  return base + '-' + Date.now().toString(36);
}

function rutaValida(ruta) {
  return typeof ruta === 'string'
    && ruta.trim() !== ''
    && ruta.indexOf('..') === -1
    && ruta.charAt(0) !== '/'
    && !/^[a-z][a-z0-9+.-]*:/i.test(ruta);
}

function hrefRuta(ruta) {
  if (!rutaValida(ruta)) throw new Error('ruta');
  return ruta.split('/').map(encodeURIComponent).join('/');
}

function esMarkdownNombre(nombre) {
  const n = String(nombre || '').toLowerCase().split('?')[0].split('#')[0];
  return n.endsWith('.md') || n.endsWith('.markdown') || n.endsWith('.txt');
}

function nombreArchivoDe(v) {
  if (!v || typeof v.nombreArchivo !== 'string') return '';
  const base = v.nombreArchivo.trim().split('/').pop().split('\\').pop();
  if (!base || base.length > 180 || base.indexOf('..') !== -1) return '';
  return base;
}

function nombreSeguro(nombre) {
  const base = String(nombre || 'archivo').split('/').pop().split('\\').pop().replace(/["<>]/g, '');
  return base || 'archivo';
}

function versionesUnicas(list) {
  const map = new Map();
  list.forEach(function (v) {
    if (!map.has(v.numero)) map.set(v.numero, v);
  });
  return Array.from(map.values()).sort(function (a, b) { return a.numero - b.numero; });
}

function normalizeVersionIndice(v) {
  if (!v || typeof v !== 'object') return null;
  const numero = Number(v.numero);
  if (!Number.isInteger(numero) || numero < 1) return null;
  const fecha = typeof v.fecha === 'string' ? v.fecha : '';
  if (!/^(\d{4})-(\d{2})-(\d{2})/.test(fecha)) return null;
  // API D1 versions carry markdown inline and often ruta:"" — accept either path or body.
  const tieneRuta = rutaValida(v.ruta);
  const tieneMd = typeof v.markdown === 'string';
  if (!tieneRuta && !tieneMd) return null;
  const out = {
    numero: numero,
    fecha: fecha.slice(0, 10),
    origen: 'indice'
  };
  if (tieneRuta) out.ruta = String(v.ruta).trim();
  if (tieneMd) out.markdown = v.markdown;
  const nombre = nombreArchivoDe(v);
  if (nombre) out.nombreArchivo = nombre;
  const hash = normalizarHash(v.hash);
  if (hash) out.hash = hash;
  else if (tieneMd) out.hash = hashFnvHex(v.markdown);
  else out.hash = hashFnvHex(out.ruta + '|' + out.numero + '|' + out.fecha);
  return out;
}

function normalizeVersionLocal(v) {
  if (!v || typeof v !== 'object') return null;
  const numero = Number(v.numero);
  if (!Number.isInteger(numero) || numero < 1) return null;
  const fecha = typeof v.fecha === 'string' ? v.fecha : '';
  if (!/^(\d{4})-(\d{2})-(\d{2})/.test(fecha)) return null;
  const tieneMd = typeof v.markdown === 'string';
  const tieneDatos = typeof v.datos === 'string' && v.datos.indexOf('data:') === 0;
  if (!tieneMd && !tieneDatos) return null;
  const out = {
    numero: numero,
    fecha: fecha.slice(0, 10),
    origen: 'local'
  };
  if (tieneMd) out.markdown = v.markdown;
  if (tieneDatos) out.datos = v.datos;
  const nombre = nombreArchivoDe(v);
  if (nombre) out.nombreArchivo = nombre;
  const hash = normalizarHash(v.hash);
  if (hash) out.hash = hash;
  else if (tieneMd) out.hash = hashFnvHex(v.markdown);
  else out.hash = hashFnvHex(String(numero) + '|' + fecha.slice(0, 10) + '|' + (nombre || ''));
  return out;
}

function normalizarAnclas(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  list.forEach(function (raw) {
    let a = String(raw || '').trim();
    if (!a) return;
    if (a.charAt(0) !== '_') a = '_' + a;
    if (a.charAt(a.length - 1) !== '_') a = a + '_';
    if (!/^_[a-z][a-z0-9_.]*_$/i.test(a)) return;
    const key = a.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(a);
  });
  return out;
}

function anclasDeMarkdown(texto) {
  const out = [];
  const seen = new Set();
  const re = /`([a-z][a-z0-9_.]*)`|_([a-z][a-z0-9_.]*)_/gi;
  String(texto || '').replace(re, function (_, a, b) {
    const ruta = (a || b || '').trim();
    if (!ruta) return '';
    const ancla = '_' + ruta + '_';
    const key = ancla.toLowerCase();
    if (seen.has(key)) return '';
    seen.add(key);
    out.push(ancla);
    return '';
  });
  return out.slice(0, 24);
}

function normalizeInstruccion(item, versionFn) {
  if (!item || typeof item !== 'object') return null;
  if (typeof item.id !== 'string' || !item.id.trim()) return null;
  if (typeof item.nombre !== 'string' || !item.nombre.trim()) return null;
  if (!Array.isArray(item.versiones)) return null;
  const versiones = versionesUnicas(item.versiones.map(versionFn).filter(Boolean));
  if (!versiones.length) return null;
  const out = {
    id: item.id.trim(),
    nombre: item.nombre.trim(),
    versiones: versiones
  };
  if (typeof item.descripcion === 'string' && item.descripcion.trim()) {
    out.descripcion = item.descripcion.trim().slice(0, 280);
  }
  if (Object.prototype.hasOwnProperty.call(item, 'color')) {
    const c = item.color;
    if (c == null || c === '') out.color = null;
    else if (typeof c === 'string' && /^#[0-9A-Fa-f]{6}$/.test(c.trim())) out.color = c.trim().toLowerCase();
  }
  const entradas = normalizarAnclas(item.entradas);
  const salidas = normalizarAnclas(item.salidas);
  let anclas = normalizarAnclas(item.anclas);
  if (entradas.length || salidas.length) {
    out.entradas = entradas;
    out.salidas = salidas;
    const seen = new Set();
    anclas = [];
    entradas.concat(salidas).forEach(function (a) {
      if (seen.has(a)) return;
      seen.add(a);
      anclas.push(a);
    });
  }
  if (anclas.length) out.anclas = anclas;
  if (!out.entradas) out.entradas = [];
  if (!out.salidas) out.salidas = out.anclas ? out.anclas.slice() : [];
  // Máx. 1 system prompt por skill (array 0..1 por compat API).
  if (Array.isArray(item.systemPrompts)) {
    out.systemPrompts = item.systemPrompts.slice(0, 1).map(function (p) {
      if (!p || typeof p !== 'object') return null;
      if (typeof p.id !== 'string' || !p.id.trim()) return null;
      return {
        id: p.id.trim(),
        nombre: typeof p.nombre === 'string' ? p.nombre : p.id,
        descripcion: typeof p.descripcion === 'string' ? p.descripcion : '',
        hash: typeof p.hash === 'string' ? p.hash : ''
      };
    }).filter(Boolean);
  } else {
    out.systemPrompts = [];
  }
  if (Object.prototype.hasOwnProperty.call(item, 'ejecutorId')) {
    out.ejecutorId = item.ejecutorId == null || item.ejecutorId === '' ? null : String(item.ejecutorId);
  } else if (Object.prototype.hasOwnProperty.call(item, 'ejecutor_id')) {
    out.ejecutorId = item.ejecutor_id == null || item.ejecutor_id === '' ? null : String(item.ejecutor_id);
  } else {
    out.ejecutorId = null;
  }
  return out;
}

function normalizeIndice(data) {
  const list = Array.isArray(data) ? data : (data && Array.isArray(data.instrucciones) ? data.instrucciones : []);
  const out = [];
  const seen = new Set();
  list.forEach(function (item) {
    const ins = normalizeInstruccion(item, normalizeVersionIndice);
    if (!ins || seen.has(ins.id)) return;
    seen.add(ins.id);
    ins.origen = 'indice';
    out.push(ins);
  });
  return out;
}

function normalizeLocales(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  list.forEach(function (item) {
    const ins = normalizeInstruccion(item, normalizeVersionLocal);
    if (!ins || seen.has(ins.id)) return;
    seen.add(ins.id);
    ins.origen = 'local';
    out.push(ins);
  });
  return out;
}

function copiaVersion(v) {
  const o = { numero: v.numero, fecha: v.fecha, origen: v.origen };
  if (v.ruta) o.ruta = v.ruta;
  if (typeof v.markdown === 'string') o.markdown = v.markdown;
  if (v.datos) o.datos = v.datos;
  if (v.nombreArchivo) o.nombreArchivo = v.nombreArchivo;
  if (v.hash) o.hash = v.hash;
  return o;
}

function attachEntityColor(out, item) {
  if (window.ColorEntidad && typeof window.ColorEntidad.attachNormalized === 'function') {
    return window.ColorEntidad.attachNormalized(out, item);
  }
  if (!out || !item || typeof item !== 'object') return out;
  if (!Object.prototype.hasOwnProperty.call(item, 'color')) return out;
  const c = item.color;
  if (c == null || c === '') out.color = null;
  else if (typeof c === 'string' && /^#[0-9A-Fa-f]{6}$/.test(c.trim())) out.color = c.trim().toLowerCase();
  return out;
}

/** Copia `color` en merges remoto/local (sin esto mergeProyectos perdía el tinte). */
function copiarColorMeta(destino, fuente) {
  return attachEntityColor(destino, fuente || {});
}

function conMetaSkill(destino, fuente) {
  if (fuente.descripcion) destino.descripcion = fuente.descripcion;
  copiarColorMeta(destino, fuente);
  if (fuente.entradas) destino.entradas = fuente.entradas.slice();
  if (fuente.salidas) destino.salidas = fuente.salidas.slice();
  if (fuente.anclas && fuente.anclas.length) destino.anclas = fuente.anclas.slice();
  else if (destino.entradas || destino.salidas) {
    const seen = new Set();
    const u = [];
    (destino.entradas || []).concat(destino.salidas || []).forEach(function (a) {
      if (seen.has(a)) return;
      seen.add(a);
      u.push(a);
    });
    destino.anclas = u;
  }
  if (!destino.entradas) destino.entradas = [];
  if (!destino.salidas) destino.salidas = destino.anclas ? destino.anclas.slice() : [];
  return destino;
}

function skillIoListas(ins) {
  const entradas = normalizarAnclas((ins && ins.entradas) || []);
  let salidas = normalizarAnclas((ins && ins.salidas) || []);
  if (!entradas.length && !salidas.length) {
    salidas = normalizarAnclas((ins && ins.anclas) || []);
  }
  return { entradas: entradas, salidas: salidas };
}

function campoAnclaPorToken(ancla) {
  refrescarCampos();
  const list = (state.campos && state.campos.lista) || [];
  return list.find(function (c) {
    return c.ancla === ancla || c.id === String(ancla || '').replace(/^_|_$/g, '');
  }) || { id: String(ancla || '').replace(/^_|_$/g, ''), ancla: ancla, etiqueta: ancla };
}

function filaCatalogoAnclaDom(campo, onAbrir) {
  const btn = el('button', 'catalogo-fila', null);
  btn.type = 'button';
  btn.setAttribute('role', 'listitem');
  const titulo = campo.etiqueta || campo.ancla || campo.id;
  btn.title = titulo;
  btn.setAttribute('aria-label', 'Abrir ' + titulo);
  const icon = el('span', 'catalogo-fila-icon', null);
  icon.setAttribute('aria-hidden', 'true');
  if (window.ColorEntidad) window.ColorEntidad.applyToEl(icon, campo.color);
  if (typeof window.svgPestanaCatalogo === 'function') {
    const svg = window.svgPestanaCatalogo('ancla');
    svg.setAttribute('class', 'catalogo-fila-svg');
    icon.append(svg);
  }
  const main = el('span', 'catalogo-fila-main', null);
  main.append(el('span', 'catalogo-fila-titulo', titulo));
  main.append(el('code', 'catalogo-fila-codigo', campo.ancla || ''));
  const enlace = el('span', 'catalogo-fila-enlace', null);
  enlace.setAttribute('aria-hidden', 'true');
  if (typeof window.svgPestanaCatalogo === 'function') {
    // Lucide external-link approx via existing catalog pattern: use text arrow if needed
    enlace.textContent = '↗';
  }
  btn.append(icon, main, enlace);
  btn.addEventListener('click', function () {
    if (typeof onAbrir === 'function') onAbrir(campo.ancla || campo.id);
  });
  return btn;
}

function mergeInstrucciones(remotas, locales, eliminados) {
  const map = new Map();
  remotas.forEach(function (ins) {
    map.set(ins.id, conMetaSkill({
      id: ins.id,
      nombre: ins.nombre,
      origen: 'indice',
      versiones: ins.versiones.map(copiaVersion)
    }, ins));
  });
  locales.forEach(function (ins) {
    const prev = map.get(ins.id);
    if (!prev) {
      map.set(ins.id, conMetaSkill({
        id: ins.id,
        nombre: ins.nombre,
        origen: 'local',
        versiones: ins.versiones.map(copiaVersion)
      }, ins));
      return;
    }
    const byNum = new Map(prev.versiones.map(function (v) { return [v.numero, v]; }));
    ins.versiones.forEach(function (v) {
      byNum.set(v.numero, copiaVersion(v));
    });
    prev.versiones = Array.from(byNum.values()).sort(function (a, b) { return a.numero - b.numero; });
    if (ins.descripcion) prev.descripcion = ins.descripcion;
    if (ins.anclas && ins.anclas.length) prev.anclas = ins.anclas.slice();
  });
  const ocultos = new Set(eliminados || []);
  return Array.from(map.values()).filter(function (ins) { return !ocultos.has(ins.id); });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inlineMarkdown(s) {
  let t = escapeHtml(s);
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" rel="noopener noreferrer" target="_blank">$1</a>');
  t = t.replace(/\[([^\]]+)\]\((#[a-z0-9][a-z0-9/_-]*)\)/gi, '<a href="$2">$1</a>');
  t = t.replace(/(^|[^"'>=])(https?:\/\/[^\s<]+[^\s<.,;:!?)\]])/g, function (_m, pre, url) {
    return pre + '<a href="' + url + '" rel="noopener noreferrer" target="_blank">' + url + '</a>';
  });
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  t = t.replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>');
  return t;
}

function esFilaTablaMd(line) {
  return /^\s*\|/.test(line) && /\|/.test(line.slice(1));
}

function esSeparadorTablaMd(line) {
  if (!esFilaTablaMd(line)) return false;
  const cells = line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|');
  return cells.length > 0 && cells.every(function (c) {
    return /^\s*:?-{3,}:?\s*$/.test(c);
  });
}

function celdasTablaMd(line) {
  const raw = String(line || '').replace(/^\s*\|/, '').replace(/\|\s*$/, '');
  return raw.split('|').map(function (c) { return c.trim(); });
}

function renderTablaMarkdown(headerLine, rows) {
  const headers = celdasTablaMd(headerLine);
  let html = '<div class="md-table-wrap"><table><thead><tr>';
  headers.forEach(function (h) {
    html += '<th>' + inlineMarkdown(h) + '</th>';
  });
  html += '</tr></thead><tbody>';
  rows.forEach(function (row) {
    const cells = celdasTablaMd(row);
    html += '<tr>';
    for (let i = 0; i < headers.length; i++) {
      html += '<td>' + inlineMarkdown(cells[i] != null ? cells[i] : '') + '</td>';
    }
    html += '</tr>';
  });
  html += '</tbody></table></div>';
  return html;
}

function renderMarkdown(src) {
  const lines = String(src || '').replace(/\r\n/g, '\n').split('\n');
  let html = '';
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const langMatch = /^```(\w*)/.exec(line);
      const lang = langMatch && langMatch[1] ? langMatch[1].toLowerCase() : '';
      const buf = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i])) {
        buf.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      const body = buf.join('\n');
      if (lang === 'mermaid') {
        html += '<div class="doc-mermaid" role="img" aria-label="Diagrama"><pre class="doc-mermaid-src">' +
          escapeHtml(body) + '</pre></div>';
      } else {
        html += '<pre><code>' + escapeHtml(body) + '</code></pre>';
      }
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      html += '<h' + level + '>' + inlineMarkdown(heading[2]) + '</h' + level + '>';
      i += 1;
      continue;
    }
    if (esFilaTablaMd(line) && i + 1 < lines.length && esSeparadorTablaMd(lines[i + 1])) {
      const headerLine = line;
      i += 2;
      const rows = [];
      while (i < lines.length && esFilaTablaMd(lines[i]) && !esSeparadorTablaMd(lines[i])) {
        rows.push(lines[i]);
        i += 1;
      }
      html += renderTablaMarkdown(headerLine, rows);
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      html += '<hr>';
      i += 1;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i += 1;
      }
      html += '<blockquote><p>' + buf.map(inlineMarkdown).join('<br>') + '</p></blockquote>';
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*[-*]\s+/, ''));
        i += 1;
      }
      html += '<ul>' + buf.map(function (x) { return '<li>' + inlineMarkdown(x) + '</li>'; }).join('') + '</ul>';
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i += 1;
      }
      html += '<ol>' + buf.map(function (x) { return '<li>' + inlineMarkdown(x) + '</li>'; }).join('') + '</ol>';
      continue;
    }
    if (line.trim() === '') {
      i += 1;
      continue;
    }
    const buf = [];
    while (
      i < lines.length
      && lines[i].trim() !== ''
      && !/^(#{1,6})\s+/.test(lines[i])
      && !/^```/.test(lines[i])
      && !/^\s*[-*]\s+/.test(lines[i])
      && !/^\s*\d+\.\s+/.test(lines[i])
      && !/^>\s?/.test(lines[i])
      && !/^(-{3,}|\*{3,}|_{3,})$/.test(lines[i].trim())
      && !(esFilaTablaMd(lines[i]) && i + 1 < lines.length && esSeparadorTablaMd(lines[i + 1]))
    ) {
      buf.push(lines[i]);
      i += 1;
    }
    html += '<p>' + inlineMarkdown(buf.join(' ')) + '</p>';
  }
  return html;
}

function htmlDeMarkdown(text) {
  if (!String(text || '').trim()) return '<p class="vacio-md">Esta versión no tiene texto.</p>';
  return renderMarkdown(text);
}

function idsEliminados(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  list.forEach(function (id) {
    if (typeof id !== 'string') return;
    const limpio = id.trim();
    if (!limpio || limpio.length > 80 || seen.has(limpio)) return;
    seen.add(limpio);
    out.push(limpio);
  });
  return out;
}

function leerStore() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { instrucciones: [], eliminados: [] };
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.instrucciones)) return { instrucciones: [], eliminados: [] };
    return { instrucciones: data.instrucciones, eliminados: idsEliminados(data.eliminados) };
  } catch (e) {
    return { instrucciones: [], eliminados: [] };
  }
}

function guardarLocal(store) {
  const json = JSON.stringify(store);
  if (json.length > 4500000) {
    throw new Error('No cabe en el almacenamiento de este navegador.');
  }
  try {
    localStorage.setItem(LS_KEY, json);
  } catch (e) {
    throw new Error('No cabe en el almacenamiento de este navegador.');
  }
}

function refrescar() {
  const store = leerStore();
  state.instrucciones = mergeInstrucciones(state.remotas, normalizeLocales(store.instrucciones), store.eliminados);
}

function versionActual(ins) {
  return ins.versiones[ins.versiones.length - 1];
}

function instruccionAbierta() {
  if (!state.abiertaId) return null;
  return state.instrucciones.find(function (ins) { return ins.id === state.abiertaId; }) || null;
}

function versionAbierta(ins) {
  return ins.versiones.find(function (v) { return v.numero === state.abiertaNumero; }) || versionActual(ins);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function svgPath(d, attrs) {
  const ns = 'http://www.w3.org/2000/svg';
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', d);
  if (attrs) Object.keys(attrs).forEach(function (k) { path.setAttribute(k, attrs[k]); });
  return path;
}

function svgCircle(cx, cy, r) {
  const ns = 'http://www.w3.org/2000/svg';
  const c = document.createElementNS(ns, 'circle');
  c.setAttribute('cx', cx);
  c.setAttribute('cy', cy);
  c.setAttribute('r', r);
  return c;
}

function svgEllipse(cx, cy, rx, ry) {
  const ns = 'http://www.w3.org/2000/svg';
  const c = document.createElementNS(ns, 'ellipse');
  c.setAttribute('cx', cx);
  c.setAttribute('cy', cy);
  c.setAttribute('rx', rx);
  c.setAttribute('ry', ry);
  return c;
}

function svgLine(x1, y1, x2, y2) {
  const ns = 'http://www.w3.org/2000/svg';
  const line = document.createElementNS(ns, 'line');
  line.setAttribute('x1', x1);
  line.setAttribute('y1', y1);
  line.setAttribute('x2', x2);
  line.setAttribute('y2', y2);
  return line;
}

function svgPolyline(points) {
  const ns = 'http://www.w3.org/2000/svg';
  const p = document.createElementNS(ns, 'polyline');
  p.setAttribute('points', points);
  return p;
}

/** Inline Lucide-style icons already used across the site (stroke 24×24). */
function svgPestanaCatalogo(tipo) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'pestana-svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  if (tipo === 'skills') {
    // Lucide: file-text
    svg.append(
      svgPath('M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z'),
      svgPolyline('14 2 14 8 20 8'),
      svgLine('16', '13', '8', '13'),
      svgLine('16', '17', '8', '17'),
      svgLine('10', '9', '8', '9')
    );
  } else if (tipo === 'ancla') {
    svg.append(
      svgCircle('12', '5', '2.5'),
      svgPath('M12 7.5v10.5'),
      svgPath('M8 14c0 2.5 1.8 4.5 4 4.5s4-2 4-4.5'),
      svgPath('M7 11h10')
    );
  } else if (tipo === 'mongo') {
    svg.append(
      svgEllipse('12', '6', '7', '3'),
      svgPath('M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6'),
      svgPath('M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6')
    );
  } else if (tipo === 'asociados' || tipo === 'asociado') {
    // Lucide: link-2
    svg.append(
      svgPath('M9 17H7A5 5 0 0 1 7 7h2'),
      svgPath('M15 7h2a5 5 0 1 1 0 10h-2'),
      svgLine('8', '12', '16', '12')
    );
  } else if (tipo === 'cluster') {
    // Lucide: server
    (function () {
      const ns2 = 'http://www.w3.org/2000/svg';
      [['2', '2'], ['2', '14']].forEach(function (xy) {
        const r = document.createElementNS(ns2, 'rect');
        r.setAttribute('width', '20');
        r.setAttribute('height', '8');
        r.setAttribute('x', xy[0]);
        r.setAttribute('y', xy[1]);
        r.setAttribute('rx', '2');
        r.setAttribute('ry', '2');
        svg.append(r);
      });
    })();
    svg.append(svgLine('6', '6', '6.01', '6'), svgLine('6', '18', '6.01', '18'));
  } else if (tipo === 'proyecto') {
    // Lucide: folder
    svg.append(
      svgPath('M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9l-.81-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z')
    );
  } else if (tipo === 'coleccion') {
    // Lucide: layers
    svg.append(
      svgPath('M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z'),
      svgPath('M2 12l8.58 3.91a2 2 0 0 0 1.66 0L21 12'),
      svgPath('M2 17l8.58 3.91a2 2 0 0 0 1.66 0L21 17')
    );
  } else if (tipo === 'agente') {
    // Lucide: bot
    svg.append(
      svgPath('M12 8V4H8'),
      (function () {
        const ns2 = 'http://www.w3.org/2000/svg';
        const r = document.createElementNS(ns2, 'rect');
        r.setAttribute('width', '16');
        r.setAttribute('height', '12');
        r.setAttribute('x', '4');
        r.setAttribute('y', '8');
        r.setAttribute('rx', '2');
        return r;
      })(),
      svgPath('M2 14h2'),
      svgPath('M20 14h2'),
      svgPath('M15 13v2'),
      svgPath('M9 13v2')
    );
  } else if (tipo === 'fundamento') {
    // Lucide: book-open
    svg.append(
      svgPath('M12 7v14'),
      svgPath('M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z')
    );
  } else if (tipo === 'ejecutor') {
    // Lucide: cog / settings
    svg.append(
      svgPath('M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z'),
      svgPath('M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z')
    );
  } else if (tipo === 'system-prompt') {
    // Lucide: message-square
    svg.append(svgPath('M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'));
  } else if (tipo === 'arquitectura') {
    // Lucide: git-fork / network-ish
    svg.append(
      svgCircle('12', '18', '3'),
      svgCircle('6', '6', '3'),
      svgCircle('18', '6', '3'),
      svgPath('M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9'),
      svgPath('M12 12v3')
    );
  } else if (tipo === 'entradas-salidas') {
    // Lucide: arrow-left-right
    svg.append(
      svgPath('M8 3 4 7l4 4'),
      svgPath('M4 7h16'),
      svgPath('M16 21l4-4-4-4'),
      svgPath('M20 17H4')
    );
  } else if (tipo === 'api') {
    // Lucide: code
    svg.append(
      svgPath('m16 18 6-6-6-6'),
      svgPath('m8 6-6 6 6 6')
    );
  } else if (tipo === 'documento' || tipo === 'resumen') {
    // Lucide: file-text / align-left (documento y resumen de ficha)
    if (tipo === 'resumen') {
      svg.append(
        svgLine('21', '6', '3', '6'),
        svgLine('15', '12', '3', '12'),
        svgLine('17', '18', '3', '18')
      );
    } else {
      svg.append(
        svgPath('M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z'),
        svgPolyline('14 2 14 8 20 8'),
        svgLine('16', '13', '8', '13'),
        svgLine('16', '17', '8', '17'),
        svgLine('10', '9', '8', '9')
      );
    }
  } else if (tipo === 'diagrama') {
    // Lucide: git-fork (mismo tono que Arquitectura)
    svg.append(
      svgCircle('12', '18', '3'),
      svgCircle('6', '6', '3'),
      svgCircle('18', '6', '3'),
      svgPath('M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9'),
      svgPath('M12 12v3')
    );
  } else if (tipo === 'conexion') {
    // Lucide: link
    svg.append(
      svgPath('M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71'),
      svgPath('M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71')
    );
  } else if (tipo === 'interno') {
    // Lucide: hash
    svg.append(
      svgLine('4', '9', '20', '9'),
      svgLine('4', '15', '20', '15'),
      svgLine('10', '3', '8', '21'),
      svgLine('16', '3', '14', '21')
    );
  } else if (tipo === 'historial') {
    // Lucide: clock
    svg.append(
      svgCircle('12', '12', '8'),
      svgPath('M12 8v4l3 2')
    );
  } else if (tipo === 'definicion') {
    // Lucide: list
    svg.append(
      svgLine('8', '6', '21', '6'),
      svgLine('8', '12', '21', '12'),
      svgLine('8', '18', '21', '18'),
      svgLine('3', '6', '3.01', '6'),
      svgLine('3', '12', '3.01', '12'),
      svgLine('3', '18', '3.01', '18')
    );
  } else if (tipo === 'empujar') {
    // Lucide: upload-cloud
    svg.append(
      svgPath('M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242'),
      svgPath('M12 12v9'),
      svgPath('m16 16-4-4-4 4')
    );
  } else if (tipo === 'flujo' || tipo === 'flujos') {
    // Lucide: git-branch
    svg.append(
      svgCircle('18', '18', '3'),
      svgCircle('6', '6', '3'),
      svgPath('M6 21V9a9 9 0 0 0 9 9')
    );
  } else if (tipo === 'corrida' || tipo === 'corridas' || tipo === 'pasos') {
    // Lucide: activity
    svg.append(svgPath('M22 12h-4l-3 9L9 3l-3 9H2'));
  } else if (tipo === 'datos') {
    // Lucide: braces / code
    svg.append(
      svgPath('m16 18 6-6-6-6'),
      svgPath('m8 6-6 6 6 6')
    );
  } else if (tipo === 'errores') {
    // Lucide: alert-triangle
    svg.append(
      svgPath('m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3'),
      svgLine('12', '9', '12', '13'),
      svgLine('12', '17', '12.01', '17')
    );
  } else if (tipo === 'versiones') {
    // Lucide: clock (mismo tono historial)
    svg.append(
      svgCircle('12', '12', '8'),
      svgPath('M12 8v4l3 2')
    );
  } else if (tipo === 'disparadores' || tipo === 'disparador' || tipo === 'zap') {
    // Lucide: zap
    svg.append(svgPath('M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z'));
  } else if (tipo === 'eventos' || tipo === 'evento') {
    // Lucide: radio
    svg.append(
      svgPath('M4.9 19.1C1 15.2 1 8.8 4.9 4.9'),
      svgPath('M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5'),
      svgCircle('12', '12', '2'),
      svgPath('M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5'),
      svgPath('M19.1 4.9C23 8.8 23 15.1 19.1 19')
    );
  } else if (tipo === 'acl') {
    // Lucide: shield
    svg.append(
      svgPath('M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z')
    );
  }
  return svg;
}

/** Icono representativo de una pestaña de ficha (reusa svgPestanaCatalogo). */
function iconoDePestanaFicha(tabId) {
  const mapa = {
    documento: 'documento',
    anclas: 'ancla',
    entradas: 'ancla',
    salidas: 'ancla',
    interno: 'interno',
    resumen: 'resumen',
    asociados: 'asociados',
    colecciones: 'coleccion',
    diagrama: 'diagrama',
    operativa: 'entradas-salidas',
    campos: 'mongo',
    skills: 'skills',
    'system-prompts': 'system-prompt',
    'system-prompt': 'system-prompt',
    ejecutores: 'ejecutor',
    ejecutor: 'ejecutor',
    ejecuciones: 'pasos',
    conexion: 'conexion',
    bases: 'proyecto',
    'base-datos': 'proyecto',
    definicion: 'definicion',
    historial: 'historial',
    mongo: 'mongo',
    campo: 'mongo',
    coleccion: 'coleccion',
    empujar: 'empujar',
    flujos: 'flujo',
    flujo: 'flujo',
    corridas: 'corrida',
    corrida: 'corrida',
    disparadores: 'disparadores',
    disparador: 'disparadores',
    eventos: 'eventos',
    evento: 'eventos',
    pasos: 'pasos',
    datos: 'datos',
    errores: 'errores',
    versiones: 'versiones',
    acl: 'acl',
    ancla: 'ancla',
    cluster: 'cluster'
  };
  return mapa[tabId] || null;
}

/** Prefija el Lucide de catálogo en cada .ancla-ficha-tab (HTML estático). */
function iconizarPestanasFicha(root) {
  const scope = root || document;
  scope.querySelectorAll('.ancla-ficha-tab').forEach(function (btn) {
    if (btn.querySelector('.pestana-svg')) return;
    let tabId = btn.getAttribute('data-icon');
    if (!tabId) {
      tabId = btn.getAttribute('data-reader-tab')
        || btn.getAttribute('data-proy-tab')
        || btn.getAttribute('data-col-tab')
        || btn.getAttribute('data-cluster-tab')
        || btn.getAttribute('data-fund-tab')
        || btn.getAttribute('data-sp-tab')
        || btn.getAttribute('data-editar-tab')
        || btn.getAttribute('data-editar-proy-tab')
        || btn.getAttribute('data-editar-sp-tab')
        || btn.getAttribute('data-agente-tab')
        || btn.getAttribute('data-flujo-tab')
        || btn.getAttribute('data-corrida-tab')
        || btn.getAttribute('data-reader-asoc-sub')
        || btn.getAttribute('data-proy-asoc-sub')
        || btn.getAttribute('data-col-asoc-sub')
        || btn.getAttribute('data-cluster-asoc-sub')
        || btn.getAttribute('data-sp-asoc-sub')
        || btn.getAttribute('data-flujo-asoc-sub')
        || btn.getAttribute('data-flujo-corr-sub')
        || btn.getAttribute('data-ej-tab')
        || btn.getAttribute('data-skill-io-sub');
    }
    const tipo = iconoDePestanaFicha(tabId) || tabId;
    if (!tipo) return;
    const label = (btn.textContent || '').trim();
    btn.textContent = '';
    btn.append(svgPestanaCatalogo(tipo));
    if (label) btn.append(document.createTextNode(label));
  });
}

window.svgPestanaCatalogo = svgPestanaCatalogo;
window.iconoDePestanaFicha = iconoDePestanaFicha;

function skillsBridge() {
  return {
    getSnapshot: function () {
      const abiertaIns = instruccionAbierta();
      const abiertaVersion = abiertaIns ? versionAbierta(abiertaIns) : null;
      return {
        ready: state.ready,
        indexError: state.indexError,
        instrucciones: state.instrucciones,
        historialId: state.historialSkillId,
        abierta: abiertaIns ? {
          id: abiertaIns.id,
          version: abiertaVersion
        } : null
      };
    },
    añadirSkill: function () { abrirDialogoNuevo(); },
    abrirSkill: function (id, numero) {
      state.historialSkillId = null;
      if (state.abiertaId === id && numero == null) {
        const dlg = document.getElementById('dlgSkill');
        if (dlg && dlg.open) {
          cerrarSkillModal();
          return;
        }
      }
      abrirInstruccion(id, numero == null ? null : numero);
    },
    alternarHistorial: function (id) {
      state.historialSkillId = state.historialSkillId === id ? null : id;
      pintarSkills();
    },
    editarSkill: function (id) { abrirDialogoEditar(id); },
    eliminarSkill: function (id) { abrirDialogoEliminar(id); },
    subirVersion: function (id) { abrirDialogoVersion(id); },
    abrirAncla: function (ancla) { abrirFichaAncla(ancla); }
  };
}

function pintarSkills() {
  if (window.SkillsUI && typeof window.SkillsUI.refrescar === 'function') {
    window.SkillsUI.refrescar(skillsBridge());
  }
}

function normalizeCampo(item) {
  if (!item || typeof item !== 'object') return null;
  if (typeof item.id !== 'string' || !item.id.trim()) return null;
  let ancla = typeof item.ancla === 'string' ? item.ancla.trim() : '';
  if (!ancla && item.id) ancla = '_' + item.id.trim() + '_';
  if (ancla.charAt(0) !== '_') ancla = '_' + ancla;
  if (ancla.charAt(ancla.length - 1) !== '_') ancla = ancla + '_';
  const aliases = normalizarAliasesLista(item.aliases);
  const observaciones = Array.isArray(item.observaciones) ? item.observaciones : [];
  const valorActual = typeof item.valorActual === 'string'
    ? item.valorActual.trim()
    : (typeof item.valor_actual === 'string' ? item.valor_actual.trim() : '');
  const out = {
    id: item.id.trim(),
    ancla: ancla,
    etiqueta: typeof item.etiqueta === 'string' ? item.etiqueta.trim() : '',
    claveMongo: typeof item.claveMongo === 'string' ? item.claveMongo.trim() : '',
    coleccion: typeof item.coleccion === 'string' ? item.coleccion.trim() : '',
    baseDatos: typeof item.baseDatos === 'string' ? item.baseDatos.trim() : 'software_reservas',
    tipo: typeof item.tipo === 'string' ? item.tipo.trim() : 'string',
    obligatorio: !!item.obligatorio,
    sensible: !!(item.sensible === true || item.sensible === 1 || item.sensible === '1'),
    formato: typeof item.formato === 'string' ? item.formato.trim() : '',
    descripcion: typeof item.descripcion === 'string' ? item.descripcion.trim() : '',
    ejemplo: typeof item.ejemplo === 'string' ? item.ejemplo.trim() : '',
    aliases: aliases,
    observaciones: observaciones,
    valorActual: valorActual,
    skills: Array.isArray(item.skills)
      ? item.skills.map(function (s) { return String(s || '').trim(); }).filter(Boolean)
      : []
  };
  const hash = normalizarHash(item.hash);
  out.hash = hash || hashFnvHex(payloadHashAncla(out));
  attachEntityColor(out, item);
  return out;
}

function normalizeCamposIndice(data) {
  const list = data && Array.isArray(data.campos) ? data.campos : (Array.isArray(data) ? data : []);
  const out = [];
  const seen = new Set();
  list.forEach(function (item) {
    const c = normalizeCampo(item);
    if (!c || seen.has(c.id)) return;
    seen.add(c.id);
    c.origen = 'indice';
    out.push(c);
  });
  return out;
}

function leerCamposStore() {
  try {
    const raw = localStorage.getItem(LS_CAMPOS);
    if (!raw) return { campos: [], eliminados: [] };
    const data = JSON.parse(raw);
    return {
      campos: Array.isArray(data.campos) ? data.campos : [],
      eliminados: Array.isArray(data.eliminados) ? data.eliminados : []
    };
  } catch (e) {
    return { campos: [], eliminados: [] };
  }
}

function guardarCamposStore(store) {
  localStorage.setItem(LS_CAMPOS, JSON.stringify(store));
}

function mergeCampos(remotos, locales, eliminados) {
  const map = new Map();
  remotos.forEach(function (c) {
    map.set(c.id, Object.assign({}, c));
  });
  (locales || []).forEach(function (raw) {
    const c = normalizeCampo(raw);
    if (!c) return;
    const prev = map.get(c.id);
    if (!prev) {
      c.origen = 'local';
      map.set(c.id, c);
      return;
    }
    const merged = Object.assign({}, prev, c, { origen: 'local' });
    if (!Object.prototype.hasOwnProperty.call(c, 'color')) {
      copiarColorMeta(merged, prev);
    }
    map.set(c.id, merged);
  });
  const ocultos = new Set(eliminados || []);
  return Array.from(map.values()).filter(function (c) { return !ocultos.has(c.id); });
}

function refrescarCampos() {
  const store = leerCamposStore();
  state.campos.lista = mergeCampos(state.campos.remotos, store.campos, store.eliminados);
}

function camposBridge() {
  return {
    getSnapshot: function () {
      const abierta = state.campos.abiertoId
        ? state.campos.lista.find(function (c) { return c.id === state.campos.abiertoId; }) || null
        : null;
      return {
        ready: state.campos.ready,
        indexError: state.campos.indexError,
        campos: state.campos.lista,
        abierta: abierta
      };
    },
    abrirCampo: function (id) { abrirFichaCampo(id); },
    cerrarCampo: function () { cerrarFichaCampo(); },
    añadirCampo: function () { abrirDialogoCampo(); }
  };
}

function buscarCampoPorAncla(texto) {
  let a = String(texto || '').trim();
  if (!a) return null;
  if (a.charAt(0) !== '_') a = '_' + a;
  if (a.charAt(a.length - 1) !== '_') a = a + '_';
  const id = a.replace(/^_|_$/g, '');
  return state.campos.lista.find(function (c) {
    return c.ancla === a || c.id === id;
  }) || null;
}

function abrirFichaCampo(id) {
  refrescarCampos();
  const campo = state.campos.lista.find(function (c) { return c.id === id; }) || null;
  if (!campo) {
    abrirFichaAncla('_' + id + '_');
    return;
  }
  state.campos.abiertoId = campo.id;
  const dlg = document.getElementById('dlgCampoFicha');
  const extras = extrasFichaAncla(campo);
  extras.mongo = mongoParaAncla(campo);
  if (window.CamposAnclaUI && window.CamposAnclaUI.mostrarFicha) {
    window.CamposAnclaUI.mostrarFicha(campo, cerrarFichaCampo, null, extras);
  }
  openFichaPane(dlg);
  pintarCampos();
}

function abrirFichaAncla(texto) {
  refrescarCampos();
  const campo = buscarCampoPorAncla(texto);
  const dlg = document.getElementById('dlgCampoFicha');
  const extras = extrasFichaAncla(campo);
  if (campo) {
    state.campos.abiertoId = campo.id;
    extras.mongo = mongoParaAncla(campo);
    if (window.CamposAnclaUI && window.CamposAnclaUI.mostrarFicha) {
      window.CamposAnclaUI.mostrarFicha(campo, cerrarFichaCampo, null, extras);
    }
  } else {
    state.campos.abiertoId = null;
    if (window.CamposAnclaUI && window.CamposAnclaUI.mostrarFicha) {
      window.CamposAnclaUI.mostrarFicha(null, cerrarFichaCampo, 'Este ancla no está en el catálogo Campos ancla.', extras);
    }
  }
  openFichaPane(dlg);
  pintarCampos();
}

function cerrarFichaCampo() {
  state.campos.abiertoId = null;
  const dlg = document.getElementById('dlgCampoFicha');
  if (dlg && dlg.open) dlg.close();
  syncFichaPaneClass();
  if (window.CamposAnclaUI && window.CamposAnclaUI.limpiarFicha) {
    window.CamposAnclaUI.limpiarFicha();
  }
  pintarCampos();
}

function cerrarSkillModal() {
  const dlg = document.getElementById('dlgSkill');
  if (dlg && dlg.open) {
    dlg.close();
    return;
  }
  state.abiertaId = null;
  state.abiertaNumero = null;
  state.historial = false;
  render();
  reabrirAnclaTrasSkillSiProcede();
  reabrirProyectoTrasSkillSiProcede();
}

function pintarCampos() {
  if (window.CamposAnclaUI && typeof window.CamposAnclaUI.refrescar === 'function') {
    window.CamposAnclaUI.refrescar(camposBridge());
  }
}

function normalizeMongoCampo(item) {
  if (!item || typeof item !== 'object') return null;
  const coleccion = typeof item.coleccion === 'string' ? item.coleccion.trim() : '';
  const clave = typeof item.clave === 'string' ? item.clave.trim() : '';
  let campo = typeof item.campo === 'string' ? item.campo.trim() : '';
  if (!campo && coleccion && clave) campo = coleccion + '.' + clave;
  if (!campo) return null;
  const id = (typeof item.id === 'string' && item.id.trim())
    ? item.id.trim()
    : campo.replace(/\./g, '-');
  let ancla = typeof item.ancla === 'string' ? item.ancla.trim() : '';
  if (ancla && ancla.charAt(0) !== '_') ancla = '_' + ancla;
  if (ancla && ancla.charAt(ancla.length - 1) !== '_') ancla = ancla + '_';
  let proyeccionElemento = {};
  if (item.proyeccionElemento && typeof item.proyeccionElemento === 'object') {
    proyeccionElemento = item.proyeccionElemento;
  } else if (typeof item.proyeccionElemento === 'string' && item.proyeccionElemento.trim()) {
    try { proyeccionElemento = JSON.parse(item.proyeccionElemento); } catch (e) { proyeccionElemento = {}; }
  }
  const proyeccionMongo = typeof item.proyeccionMongo === 'string'
    ? item.proyeccionMongo.trim()
    : (typeof item.proyeccion_mongo === 'string' ? item.proyeccion_mongo.trim() : '');
  let indices = [];
  if (Array.isArray(item.indices)) {
    indices = item.indices;
  } else if (typeof item.indices === 'string' && item.indices.trim()) {
    try { indices = JSON.parse(item.indices); } catch (e) { indices = []; }
    if (!Array.isArray(indices)) indices = [];
  }
  const out = {
    id: id,
    campo: campo,
    baseDatos: typeof item.baseDatos === 'string' ? item.baseDatos.trim() : 'software_reservas',
    coleccion: coleccion || campo.split('.')[0],
    clave: clave || campo.split('.').slice(1).join('.'),
    bsonType: typeof item.bsonType === 'string' ? item.bsonType.trim() : 'string',
    obligatorio: !!item.obligatorio,
    descripcion: typeof item.descripcion === 'string' ? item.descripcion.trim() : '',
    ancla: ancla,
    proyecto: typeof item.proyecto === 'string' ? item.proyecto.trim() : '',
    proyeccionMongo: proyeccionMongo,
    proyeccionElemento: proyeccionElemento,
    indices: indices
  };
  const hash = normalizarHash(item.hash);
  out.hash = hash || hashFnvHex(payloadHashMongo(out));
  attachEntityColor(out, item);
  return out;
}

function normalizeMongoIndice(data) {
  const list = data && Array.isArray(data.campos) ? data.campos : (Array.isArray(data) ? data : []);
  const out = [];
  const seen = new Set();
  list.forEach(function (item) {
    const c = normalizeMongoCampo(item);
    if (!c || seen.has(c.id)) return;
    seen.add(c.id);
    c.origen = 'indice';
    out.push(c);
  });
  return out;
}

function leerMongoStore() {
  try {
    const raw = localStorage.getItem(LS_MONGO);
    if (!raw) return { campos: [], eliminados: [] };
    const data = JSON.parse(raw);
    return {
      campos: Array.isArray(data.campos) ? data.campos : [],
      eliminados: Array.isArray(data.eliminados) ? data.eliminados : []
    };
  } catch (e) {
    return { campos: [], eliminados: [] };
  }
}

function guardarMongoStore(store) {
  localStorage.setItem(LS_MONGO, JSON.stringify(store));
}

function mergeMongo(remotos, locales, eliminados) {
  const map = new Map();
  remotos.forEach(function (c) { map.set(c.id, Object.assign({}, c)); });
  (locales || []).forEach(function (raw) {
    const c = normalizeMongoCampo(raw);
    if (!c) return;
    const prev = map.get(c.id);
    if (!prev) {
      c.origen = 'local';
      map.set(c.id, c);
      return;
    }
    const merged = Object.assign({}, prev, c, { origen: 'local' });
    if (!Object.prototype.hasOwnProperty.call(c, 'color')) {
      copiarColorMeta(merged, prev);
    }
    map.set(c.id, merged);
  });
  const ocultos = new Set(eliminados || []);
  return Array.from(map.values()).filter(function (c) { return !ocultos.has(c.id); });
}

function refrescarMongo() {
  const store = leerMongoStore();
  state.mongo.lista = mergeMongo(state.mongo.remotos, store.campos, store.eliminados);
}

function mongoBridge() {
  return {
    getSnapshot: function () {
      const abierta = state.mongo.abiertoId
        ? state.mongo.lista.find(function (c) { return c.id === state.mongo.abiertoId; }) || null
        : null;
      return {
        ready: state.mongo.ready,
        indexError: state.mongo.indexError,
        campos: state.mongo.lista,
        abierta: abierta
      };
    },
    abrirCampo: function (id) { abrirFichaMongo(id); },
    cerrarCampo: function () { cerrarFichaMongo(); },
    añadirCampo: function () { abrirDialogoMongo(); }
  };
}

function pintarMongo() {
  if (window.CamposMongoUI && typeof window.CamposMongoUI.refrescar === 'function') {
    window.CamposMongoUI.refrescar(mongoBridge());
  }
}

function coleccionItemParaMongo(campo) {
  if (!campo || !campo.coleccion) return null;
  refrescarListaColecciones();
  let col = null;
  if (campo.proyecto) {
    col = state.colecciones.lista.find(function (c) {
      return c.proyectoId === campo.proyecto && c.id === campo.coleccion;
    }) || null;
  }
  if (!col && campo.baseDatos) {
    col = state.colecciones.lista.find(function (c) {
      return c.baseDatos === campo.baseDatos && c.id === campo.coleccion;
    }) || null;
  }
  if (!col) {
    const proy = (state.proyectos.lista || []).find(function (p) {
      return (campo.proyecto && p.id === campo.proyecto)
        || (campo.baseDatos && p.baseDatos === campo.baseDatos);
    });
    col = {
      key: claveColeccion(proy ? proy.id : (campo.proyecto || '?'), campo.coleccion),
      id: campo.coleccion,
      descripcion: '',
      proyectoId: proy ? proy.id : (campo.proyecto || ''),
      proyectoNombre: proy ? (proy.nombre || proy.id) : (campo.proyecto || ''),
      baseDatos: (proy && proy.baseDatos) || campo.baseDatos || '',
      nCampos: null
    };
  }
  return col;
}

function abrirColeccionDesdeMongo(key) {
  const mongoId = state.mongo.abiertoId;
  abrirFichaColeccion(key, {
    volverA: mongoId ? { tipo: 'mongo', id: mongoId } : { tipo: 'catalogo' }
  });
}

function extrasFichaMongo(campo) {
  const extras = {};
  const col = coleccionItemParaMongo(campo);
  extras.coleccionItems = col ? [col] : [];
  extras.onAbrirColeccion = function (key) { abrirColeccionDesdeMongo(key); };
  const anclaItem = anclaItemParaMongo(campo);
  extras.anclaItems = anclaItem ? [anclaItem] : [];
  extras.onAbrirAncla = function (texto) { abrirAnclaDesdeMongo(texto); };
  if (state.mongo.initialTab) {
    extras.initialTab = state.mongo.initialTab;
    state.mongo.initialTab = null;
  }
  if (campo && campo.id) {
    extras.onEditar = function () { abrirDialogoEditarMongo(campo.id); };
    extras.onEliminar = function () {
      abrirDialogoEliminar({
        tipo: 'mongo',
        id: campo.id,
        titulo: '¿Estás seguro de eliminar el campo MongoDB?',
        aviso: 'Se elimina del catálogo en la API (D1). Esta acción no se puede deshacer desde el panel.'
      });
    };
    extras.getUsadosColor = function () { return coloresUsadosCatalogo('mongo', campo.id); };
    extras.onColor = function (hex) {
      guardarColorEntidad('mongo', campo.id, hex).then(function () {
        campo.color = hex;
        if (window.CamposMongoUI && typeof window.CamposMongoUI.refrescar === 'function') {
          window.CamposMongoUI.refrescar(mongoBridge());
        }
        if (window.CamposMongoUI && typeof window.CamposMongoUI.mostrarFicha === 'function') {
          window.CamposMongoUI.mostrarFicha(campo, cerrarFichaMongo, null, extrasFichaMongo(campo));
        }
      }).catch(function (err) {
        alert((err && err.message) || 'No se pudo guardar el color.');
      });
    };
  }
  return extras;
}

function abrirFichaMongo(id) {
  refrescarMongo();
  const campo = state.mongo.lista.find(function (c) { return c.id === id; }) || null;
  const dlg = document.getElementById('dlgMongoFicha');
  state.mongo.abiertoId = campo ? campo.id : null;
  if (window.CamposMongoUI && window.CamposMongoUI.mostrarFicha) {
    window.CamposMongoUI.mostrarFicha(
      campo,
      cerrarFichaMongo,
      campo ? null : 'Este campo no está en el catálogo Campos MongoDB.',
      extrasFichaMongo(campo)
    );
  }
  openFichaPane(dlg);
  pintarMongo();
}

function cerrarFichaMongo() {
  state.mongo.abiertoId = null;
  const dlg = document.getElementById('dlgMongoFicha');
  if (dlg && dlg.open) dlg.close();
  syncFichaPaneClass();
  if (window.CamposMongoUI && window.CamposMongoUI.limpiarFicha) window.CamposMongoUI.limpiarFicha();
  pintarMongo();
}

function cargarMongo() {
  apiFetch('/v1/mongo')
    .then(function (data) {
      state.mongo.remotos = normalizeMongoIndice(data);
      state.mongo.indexError = false;
    })
    .catch(function () {
      return fetch('catalogo/campos-mongodb/index.json', { cache: 'no-store' })
        .then(function (res) {
          if (!res.ok) throw new Error('http');
          return res.json();
        })
        .then(function (data) {
          state.mongo.remotos = normalizeMongoIndice(data);
          state.mongo.indexError = false;
        });
    })
    .catch(function () {
      state.mongo.remotos = [];
      state.mongo.indexError = true;
    })
    .then(function () {
      state.mongo.ready = true;
      refrescarMongo();
      pintarMongo();
      refrescarMongoConnStatus();
      if (state.colecciones && state.colecciones.ready) {
        refrescarListaColecciones();
        pintarColecciones();
      }
    });
}

function resetFormMongoMode(form, modo) {
  delete form.dataset.mode;
  delete form.dataset.id;
  if (form.coleccion) form.coleccion.readOnly = false;
  if (form.clave) form.clave.readOnly = false;
  const titulo = document.getElementById('dlgMongoTitulo');
  const submit = form.querySelector('[type="submit"]');
  if (modo === 'edit') {
    if (titulo) titulo.textContent = 'Editar campo MongoDB';
    if (submit) submit.textContent = 'Guardar';
  } else {
    if (titulo) titulo.textContent = 'Añadir campo MongoDB';
    if (submit) submit.textContent = 'Añadir campo';
  }
}

function abrirDialogoMongo() {
  const dlg = document.getElementById('dlgMongo');
  const form = document.getElementById('formMongo');
  if (!dlg || !form) return;
  form.reset();
  resetFormMongoMode(form, 'add');
  const err = document.getElementById('mongoError');
  if (err) err.textContent = '';
  dlg.showModal();
  if (form.coleccion) form.coleccion.focus();
}

function abrirDialogoEditarMongo(id) {
  refrescarMongo();
  const campo = state.mongo.lista.find(function (c) { return c.id === id; });
  if (!campo) return;
  const dlg = document.getElementById('dlgMongo');
  const form = document.getElementById('formMongo');
  if (!dlg || !form) return;
  form.reset();
  resetFormMongoMode(form, 'edit');
  form.dataset.mode = 'edit';
  form.dataset.id = campo.id;
  form.coleccion.value = campo.coleccion || '';
  form.clave.value = campo.clave || '';
  form.coleccion.readOnly = true;
  form.clave.readOnly = true;
  form.baseDatos.value = campo.baseDatos || '';
  form.bsonType.value = campo.bsonType || '';
  form.obligatorio.checked = !!campo.obligatorio;
  form.descripcion.value = campo.descripcion || '';
  form.ancla.value = campo.ancla || '';
  if (form.proyeccionMongo) form.proyeccionMongo.value = campo.proyeccionMongo || '';
  if (form.proyeccionElemento) {
    form.proyeccionElemento.value = campo.proyeccionElemento && Object.keys(campo.proyeccionElemento).length
      ? JSON.stringify(campo.proyeccionElemento, null, 2)
      : '';
  }
  const err = document.getElementById('mongoError');
  if (err) err.textContent = '';
  dlg.showModal();
  if (form.baseDatos) form.baseDatos.focus();
}

function eliminarCampoMongo(id) {
  const store = leerMongoStore();
  store.campos = (store.campos || []).filter(function (c) { return !(c && c.id === id); });
  if ((store.eliminados || []).indexOf(id) < 0) {
    store.eliminados = (store.eliminados || []).concat([id]);
  }
  guardarMongoStore(store);
  if (state.mongo.abiertoId === id) cerrarFichaMongo();
  refrescarMongo();
  pintarMongo();
}

function onSubmitMongo(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const error = document.getElementById('mongoError');
  if (error) error.textContent = '';
  const coleccion = form.coleccion.value.trim();
  const clave = form.clave.value.trim();
  if (!coleccion || !clave) {
    if (error) error.textContent = 'Colección y clave son obligatorias.';
    return;
  }
  let proyeccionElemento = {};
  if (form.proyeccionElemento && form.proyeccionElemento.value.trim()) {
    try {
      proyeccionElemento = JSON.parse(form.proyeccionElemento.value.trim());
    } catch (e) {
      if (error) error.textContent = 'Elemento proyección: JSON inválido.';
      return;
    }
  }
  const editandoMongo = form.dataset.mode === 'edit';
  const campo = normalizeMongoCampo({
    id: editandoMongo && form.dataset.id ? form.dataset.id : undefined,
    campo: coleccion + '.' + clave,
    baseDatos: form.baseDatos.value.trim() || 'software_reservas',
    coleccion: coleccion,
    clave: clave,
    bsonType: form.bsonType.value.trim() || 'string',
    obligatorio: !!form.obligatorio.checked,
    descripcion: form.descripcion.value.trim(),
    ancla: form.ancla.value.trim(),
    proyeccionMongo: form.proyeccionMongo ? form.proyeccionMongo.value.trim() : '',
    proyeccionElemento: proyeccionElemento
  });
  if (!campo) {
    if (error) error.textContent = 'No se pudo crear el campo.';
    return;
  }
  const finalizarLocal = function () {
    const store = leerMongoStore();
    store.campos = store.campos.filter(function (c) { return !(c && c.id === campo.id); });
    store.campos.push(campo);
    store.eliminados = (store.eliminados || []).filter(function (xid) { return xid !== campo.id; });
    guardarMongoStore(store);
    document.getElementById('dlgMongo').close();
    resetFormMongoMode(form, 'add');
    refrescarMongo();
    abrirFichaMongo(campo.id);
  };
  asegurarClaveCatalogo()
    .then(function () {
      const path = editandoMongo ? '/v1/mongo/' + encodeURIComponent(campo.id) : '/v1/mongo';
      return apiFetchAuth(path, {
        method: editandoMongo ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(campo)
      });
    })
    .then(function (data) {
      const saved = normalizeMongoCampo((data && data.campo) || campo);
      if (saved) Object.assign(campo, saved);
      document.getElementById('dlgMongo').close();
      resetFormMongoMode(form, 'add');
      cargarMongo();
      setTimeout(function () { abrirFichaMongo(campo.id); }, 200);
    })
    .catch(function (err) {
      try {
        finalizarLocal();
      } catch (e2) {
        if (error) showApiErrorRaw(error, err, { kind: 'is-err', statusLabel: true });
      }
    });
}

function cargarCampos() {
  apiFetch('/v1/anclas')
    .then(function (data) {
      state.campos.remotos = normalizeCamposIndice(data);
      state.campos.indexError = false;
    })
    .catch(function () {
      return fetch('catalogo/campos-ancla/index.json', { cache: 'no-store' })
        .then(function (res) {
          if (!res.ok) throw new Error('http');
          return res.json();
        })
        .then(function (data) {
          state.campos.remotos = normalizeCamposIndice(data);
          state.campos.indexError = false;
        });
    })
    .catch(function () {
      state.campos.remotos = [];
      state.campos.indexError = true;
    })
    .then(function () {
      state.campos.ready = true;
      refrescarCampos();
      pintarCampos();
    });
}

function resetFormCampoMode(form, modo) {
  delete form.dataset.mode;
  delete form.dataset.id;
  if (form.ancla) form.ancla.readOnly = false;
  const titulo = document.getElementById('dlgCampoTitulo');
  const submit = form.querySelector('[type="submit"]');
  if (modo === 'edit') {
    if (titulo) titulo.textContent = 'Editar ancla';
    if (submit) submit.textContent = 'Guardar';
  } else {
    if (titulo) titulo.textContent = 'Añadir ancla';
    if (submit) submit.textContent = 'Añadir ancla';
  }
}

function abrirDialogoCampo() {
  const dlg = document.getElementById('dlgCampo');
  const form = document.getElementById('formCampo');
  if (!dlg || !form) return;
  form.reset();
  resetFormCampoMode(form, 'add');
  const err = document.getElementById('campoError');
  if (err) err.textContent = '';
  dlg.showModal();
  if (form.ancla) form.ancla.focus();
}

function abrirDialogoEditarCampo(id) {
  refrescarCampos();
  const campo = state.campos.lista.find(function (c) { return c.id === id; });
  if (!campo) return;
  const dlg = document.getElementById('dlgCampo');
  const form = document.getElementById('formCampo');
  if (!dlg || !form) return;
  form.reset();
  resetFormCampoMode(form, 'edit');
  form.dataset.mode = 'edit';
  form.dataset.id = campo.id;
  form.ancla.value = campo.ancla || '';
  form.ancla.readOnly = true;
  form.etiqueta.value = campo.etiqueta || '';
  form.claveMongo.value = campo.claveMongo || '';
  form.coleccion.value = campo.coleccion || '';
  form.baseDatos.value = campo.baseDatos || '';
  form.tipo.value = campo.tipo || '';
  form.obligatorio.checked = !!campo.obligatorio;
  form.formato.value = campo.formato || '';
  form.descripcion.value = campo.descripcion || '';
  form.ejemplo.value = campo.ejemplo || '';
  if (form.aliases) form.aliases.value = Array.isArray(campo.aliases) ? campo.aliases.join('\n') : '';
  if (form.sensible) form.sensible.checked = !!campo.sensible;
  form.skills.value = Array.isArray(campo.skills) ? campo.skills.join('\n') : '';
  const err = document.getElementById('campoError');
  if (err) err.textContent = '';
  dlg.showModal();
  if (form.etiqueta) form.etiqueta.focus();
}

function eliminarCampoAncla(id) {
  const store = leerCamposStore();
  store.campos = (store.campos || []).filter(function (c) { return !(c && c.id === id); });
  if ((store.eliminados || []).indexOf(id) < 0) {
    store.eliminados = (store.eliminados || []).concat([id]);
  }
  guardarCamposStore(store);
  if (state.campos.abiertoId === id) cerrarFichaCampo();
  refrescarCampos();
  pintarCampos();
}

function onSubmitCampo(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const error = document.getElementById('campoError');
  if (error) error.textContent = '';
  const editando = form.dataset.mode === 'edit';
  let ancla = form.ancla.value.trim();
  if (!ancla) {
    if (error) error.textContent = 'Escribe el ancla.';
    return;
  }
  if (ancla.charAt(0) !== '_') ancla = '_' + ancla;
  if (ancla.charAt(ancla.length - 1) !== '_') ancla = ancla + '_';
  const idBase = editando && form.dataset.id ? form.dataset.id : ancla.replace(/^_|_$/g, '');
  if (!idBase) {
    if (error) error.textContent = 'El ancla no es válida.';
    return;
  }
  const campo = normalizeCampo({
    id: idBase,
    ancla: ancla,
    etiqueta: form.etiqueta.value.trim(),
    claveMongo: form.claveMongo.value.trim() || idBase.split('.').pop(),
    coleccion: form.coleccion.value.trim() || 'negocios',
    baseDatos: form.baseDatos.value.trim() || 'software_reservas',
    tipo: form.tipo.value.trim() || 'string',
    obligatorio: !!form.obligatorio.checked,
    sensible: !!(form.sensible && form.sensible.checked),
    formato: form.formato.value.trim(),
    descripcion: form.descripcion.value.trim(),
    ejemplo: form.ejemplo.value.trim(),
    aliases: form.aliases ? form.aliases.value : '',
    skills: form.skills.value.split(/[\n,]+/).map(function (s) { return s.trim(); }).filter(Boolean)
  });
  if (!campo) {
    if (error) error.textContent = 'No se pudo crear el campo.';
    return;
  }
  campo.hash = hashFnvHex(payloadHashAncla(campo));
  const finalizarLocal = function () {
    const store = leerCamposStore();
    store.campos = store.campos.filter(function (c) { return !(c && c.id === campo.id); });
    store.campos.push(campo);
    store.eliminados = (store.eliminados || []).filter(function (xid) { return xid !== campo.id; });
    guardarCamposStore(store);
    document.getElementById('dlgCampo').close();
    resetFormCampoMode(form, 'add');
    refrescarCampos();
    abrirFichaCampo(campo.id);
  };
  asegurarClaveCatalogo()
    .then(function () {
      const path = editando ? '/v1/anclas/' + encodeURIComponent(campo.id) : '/v1/anclas';
      return apiFetchAuth(path, {
        method: editando ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(campo)
      });
    })
    .then(function (data) {
      const saved = normalizeCampo((data && data.campo) || campo);
      if (saved) Object.assign(campo, saved);
      document.getElementById('dlgCampo').close();
      resetFormCampoMode(form, 'add');
      cargarCampos();
      setTimeout(function () { abrirFichaCampo(campo.id); }, 200);
    })
    .catch(function (err) {
      try {
        finalizarLocal();
      } catch (e2) {
        if (error) showApiErrorRaw(error, err, { kind: 'is-err', statusLabel: true });
      }
    });
}

function textoDeVersionActual(v) {
  if (!v) return Promise.resolve('');
  if (typeof v.markdown === 'string') return Promise.resolve(v.markdown);
  if (v.datos && esMarkdownNombre(v.nombreArchivo || '')) {
    try { return Promise.resolve(textoDeDatos(v.datos)); } catch (e) { return Promise.resolve(''); }
  }
  if (v.ruta && esMarkdownNombre(v.ruta)) {
    if (mdCache.has(v.ruta)) return Promise.resolve(mdCache.get(v.ruta));
    try {
      return fetch(hrefRuta(v.ruta), { cache: 'no-store' })
        .then(function (res) {
          if (!res.ok) throw new Error('http');
          return res.text();
        })
        .then(function (text) {
          mdCache.set(v.ruta, text);
          return text;
        })
        .catch(function () { return ''; });
    } catch (e) {
      return Promise.resolve('');
    }
  }
  return Promise.resolve('');
}

function editarIoSubActual() {
  const on = document.querySelector('#editarAnclasSubtabs [data-editar-io-sub].is-on');
  return (on && on.getAttribute('data-editar-io-sub')) || 'entradas';
}

function pintarEditarAnclasCapsulas() {
  const lista = document.getElementById('editarAnclasLista');
  const form = document.getElementById('formEditar');
  if (!lista || !form) return;
  const sub = editarIoSubActual();
  const raw = sub === 'salidas'
    ? (form.salidas && form.salidas.value)
    : (form.entradas && form.entradas.value);
  const anclas = normalizarAnclas(String(raw || '').split(/[\n,]+/));
  lista.replaceChildren();
  anclas.forEach(function (a) {
    lista.append(filaCatalogoAnclaDom(campoAnclaPorToken(a), function (tok) {
      abrirFichaAncla(tok);
    }));
  });
  const ent = normalizarAnclas(String((form.entradas && form.entradas.value) || '').split(/[\n,]+/));
  const sal = normalizarAnclas(String((form.salidas && form.salidas.value) || '').split(/[\n,]+/));
  const seen = new Set();
  const union = [];
  ent.concat(sal).forEach(function (a) {
    if (seen.has(a)) return;
    seen.add(a);
    union.push(a);
  });
  if (form.anclas) form.anclas.value = union.join('\n');
}

function seleccionarEditarIoSub(id) {
  const tabs = document.querySelectorAll('#editarAnclasSubtabs [data-editar-io-sub]');
  tabs.forEach(function (btn) {
    const on = btn.getAttribute('data-editar-io-sub') === id;
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  pintarEditarAnclasCapsulas();
}

function valorAnclasEdicion() {
  const form = document.getElementById('formEditar');
  if (!form) return '';
  const sub = editarIoSubActual();
  if (sub === 'salidas' && form.salidas) return form.salidas.value || '';
  if (form.entradas) return form.entradas.value || '';
  return form.anclas ? form.anclas.value || '' : '';
}

function abrirDialogoEditarAnclas() {
  const form = document.getElementById('formEditar');
  const dlg = document.getElementById('dlgEditarAnclas');
  const formAnclas = document.getElementById('formEditarAnclas');
  if (!form || !dlg || !formAnclas) return;
  const err = document.getElementById('editarAnclasError');
  if (err) err.textContent = '';
  const sub = editarIoSubActual();
  const dirLabel = document.getElementById('editarAnclasDirLabel');
  if (dirLabel) dirLabel.textContent = sub;
  const titulo = document.getElementById('dlgEditarAnclasTitulo');
  if (titulo) titulo.textContent = sub === 'salidas' ? 'Editar salidas' : 'Editar entradas';
  formAnclas.anclas.value = valorAnclasEdicion();
  dlg.showModal();
  formAnclas.anclas.focus();
}

function onSubmitEditarAnclas(e) {
  e.preventDefault();
  const form = document.getElementById('formEditar');
  const formAnclas = e.currentTarget;
  const dlg = document.getElementById('dlgEditarAnclas');
  if (!form) return;
  const anclas = normalizarAnclas(String(formAnclas.anclas.value || '').split(/[\n,]+/));
  const sub = editarIoSubActual();
  if (sub === 'salidas' && form.salidas) form.salidas.value = anclas.join('\n');
  else if (form.entradas) form.entradas.value = anclas.join('\n');
  pintarEditarAnclasCapsulas();
  if (dlg && dlg.open) dlg.close();
}

function extrasFichaAncla(campo) {
  const nombres = {};
  state.instrucciones.forEach(function (ins) {
    nombres[ins.id] = ins.nombre;
  });
  const skillIds = campo && Array.isArray(campo.skills) ? campo.skills : [];
  const skillItems = skillIds.map(function (id) {
    const found = state.instrucciones.find(function (ins) { return ins.id === id; });
    if (found) return found;
    return {
      id: id,
      nombre: nombres[id] || id,
      descripcion: '',
      versiones: [{ numero: 1, fecha: '' }]
    };
  });
  const extras = {
    nombresSkill: nombres,
    skillItems: skillItems,
    mongo: null,
    onAbrirSkill: function (id) { abrirVistaSkill(id); },
    onAbrirCampo: function (id) { abrirMongoDesdeAncla(id); }
  };
  if (campo && campo.id) {
    extras.onEditar = function () { abrirDialogoEditarCampo(campo.id); };
    extras.onEliminar = function () {
      abrirDialogoEliminar({
        tipo: 'ancla',
        id: campo.id,
        titulo: '¿Estás seguro de eliminar el ancla?',
        aviso: 'Se elimina del catálogo en la API (D1). Esta acción no se puede deshacer desde el panel.'
      });
    };
    extras.getUsadosColor = function () { return coloresUsadosCatalogo('ancla', campo.id); };
    extras.onColor = function (hex) {
      guardarColorEntidad('ancla', campo.id, hex).then(function () {
        campo.color = hex;
        if (window.CamposAnclaUI && typeof window.CamposAnclaUI.refrescar === 'function') {
          window.CamposAnclaUI.refrescar(camposBridge());
        }
        if (window.CamposAnclaUI && typeof window.CamposAnclaUI.mostrarFicha === 'function') {
          window.CamposAnclaUI.mostrarFicha(campo, cerrarFichaCampo, null, extrasFichaAncla(campo));
        }
      }).catch(function (err) {
        alert((err && err.message) || 'No se pudo guardar el color.');
      });
    };
  }
  return extras;
}

/** Vista de skill (dlgSkill). Cierra la ficha ancla/proyecto si hace falta (no hay dos modales a la vez). */
function abrirVistaSkill(id, numero) {
  const anclaId = state.campos && state.campos.abiertoId;
  const dlgCampo = document.getElementById('dlgCampoFicha');
  if (dlgCampo && dlgCampo.open && anclaId) {
    state.reabrirAnclaTrasSkill = anclaId;
    cerrarFichaCampo();
    setTimeout(function () {
      abrirInstruccion(id, numero == null ? null : numero);
    }, 0);
    return;
  }
  const proyId = state.proyectos && state.proyectos.abiertoId;
  const dlgProy = document.getElementById('dlgProyecto');
  if (dlgProy && dlgProy.open && proyId) {
    state.proyectos.reabrirTrasSkill = proyId;
    cerrarProyectoModal();
    setTimeout(function () {
      abrirInstruccion(id, numero == null ? null : numero);
    }, 0);
    return;
  }
  abrirInstruccion(id, numero == null ? null : numero);
}

function reabrirAnclaTrasSkillSiProcede() {
  const reabrir = state.reabrirAnclaTrasSkill;
  state.reabrirAnclaTrasSkill = null;
  if (!reabrir) return;
  setTimeout(function () { abrirFichaCampo(reabrir); }, 0);
}

function reabrirProyectoTrasSkillSiProcede() {
  const reabrir = state.proyectos && state.proyectos.reabrirTrasSkill;
  if (state.proyectos) state.proyectos.reabrirTrasSkill = null;
  if (!reabrir) return;
  setTimeout(function () { abrirProyecto(reabrir); }, 0);
}

function mongoParaAncla(campo) {
  if (!campo) return null;
  refrescarMongo();
  // Solo enlace real por campo.ancla === ancla. Sin fallback inferido desde coleccion/clave del ancla.
  const ancla = campo.ancla ? String(campo.ancla).trim() : '';
  if (!ancla) return null;
  return state.mongo.lista.find(function (m) { return m.ancla && m.ancla === ancla; }) || null;
}

function abrirMongoDesdeAncla(mongoId) {
  const anclaId = state.campos && state.campos.abiertoId;
  state.reabrirMongoTrasAncla = null;
  if (anclaId) state.reabrirAnclaTrasMongo = anclaId;
  cerrarFichaCampo();
  setTimeout(function () { abrirFichaMongo(mongoId); }, 0);
}

function abrirAnclaDesdeMongo(textoAncla) {
  const mongoId = state.mongo && state.mongo.abiertoId;
  state.reabrirAnclaTrasMongo = null;
  if (mongoId) state.reabrirMongoTrasAncla = mongoId;
  cerrarFichaMongo();
  setTimeout(function () { abrirFichaAncla(textoAncla); }, 0);
}

function reabrirAnclaTrasMongoSiProcede() {
  const reabrir = state.reabrirAnclaTrasMongo;
  state.reabrirAnclaTrasMongo = null;
  if (!reabrir) return;
  setTimeout(function () { abrirFichaCampo(reabrir); }, 0);
}

function reabrirMongoTrasAnclaSiProcede() {
  const reabrir = state.reabrirMongoTrasAncla;
  state.reabrirMongoTrasAncla = null;
  if (!reabrir) return;
  setTimeout(function () { abrirFichaMongo(reabrir); }, 0);
}

function anclaItemParaMongo(campo) {
  if (!campo || !campo.ancla) return null;
  refrescarCampos();
  const found = state.campos.lista.find(function (c) {
    return c.ancla === campo.ancla || c.id === String(campo.ancla).replace(/^_|_$/g, '');
  });
  if (found) return found;
  return { id: String(campo.ancla).replace(/^_|_$/g, ''), ancla: campo.ancla, etiqueta: campo.ancla };
}

function abrirDialogoEditar(id) {
  const ins = state.instrucciones.find(function (item) { return item.id === id; });
  if (!ins) return;
  const dlg = document.getElementById('dlgEditar');
  const form = document.getElementById('formEditar');
  if (!dlg || !form) return;
  form.reset();
  form.dataset.id = id;
  delete form.dataset.snapMarkdown;
  delete form.dataset.snapAnclas;
  limpiarError('editarError');
  form.nombre.value = ins.nombre;
  form.descripcion.value = ins.descripcion || '';
  const io = skillIoListas(ins);
  if (form.entradas) form.entradas.value = io.entradas.join('\n');
  if (form.salidas) form.salidas.value = io.salidas.join('\n');
  form.anclas.value = (ins.anclas || io.entradas.concat(io.salidas)).join('\n');
  seleccionarEditarIoSub('entradas');
  form.markdown.value = 'Cargando…';
  seleccionarEditarTab('documento');
  dlg.showModal();
  const v = versionActual(ins);
  textoDeVersionActual(v).then(function (text) {
    if (form.dataset.id !== id) return;
    const md = text || '';
    form.markdown.value = md;
    form.dataset.snapMarkdown = md;
    form.dataset.snapAnclas = anclasCanonicasTexto(io.entradas.concat(io.salidas));
    form.nombre.focus();
  });
}

async function guardarEdicionSkill(id, meta, markdown, hash) {
  refrescar();
  const actual = state.instrucciones.find(function (ins) { return ins.id === id; });
  if (!actual) throw new Error('No está esa skill.');
  const store = leerStore();
  let entrada = store.instrucciones.find(function (ins) { return ins && ins.id === id; });
  if (!entrada) {
    entrada = { id: id, nombre: actual.nombre, versiones: [] };
    store.instrucciones.push(entrada);
  }
  if (meta.nombre) entrada.nombre = meta.nombre;
  if (meta.descripcion != null) entrada.descripcion = meta.descripcion;
  if (meta.entradas) entrada.entradas = meta.entradas;
  if (meta.salidas) entrada.salidas = meta.salidas;
  if (meta.anclas) entrada.anclas = meta.anclas;
  if (!Array.isArray(entrada.versiones)) entrada.versiones = [];
  const creada = {
    numero: siguienteNumero(actual.versiones),
    fecha: todayISO(),
    markdown: markdown,
    hash: hash
  };
  entrada.versiones.push(creada);
  guardarLocal(store);
  return creada;
}

async function onSubmitEditar(e) {
  e.preventDefault();
  const error = document.getElementById('editarError');
  if (error) error.textContent = '';
  const form = e.currentTarget;
  const submit = form.querySelector('[type="submit"]');
  const id = form.dataset.id;
  const nombre = form.nombre.value.trim();
  if (!nombre) {
    if (error) error.textContent = 'Escribe un nombre.';
    return;
  }
  const markdown = form.markdown.value;
  if (!String(markdown || '').trim()) {
    if (error) error.textContent = 'El contenido no puede estar vacío.';
    return;
  }
  const descripcion = form.descripcion.value.trim().slice(0, 280);
  const entradasFinal = normalizarAnclas(
    String((form.entradas && form.entradas.value) || '').split(/[\n,]+/)
  );
  let salidasFinal = normalizarAnclas(
    String((form.salidas && form.salidas.value) || '').split(/[\n,]+/)
  );
  const anclasNorm = normalizarAnclas(
    form.anclas.value.split(/[\n,]+/).map(function (s) { return s.trim(); }).filter(Boolean)
  );
  if (!entradasFinal.length && !salidasFinal.length) {
    salidasFinal = anclasNorm.length ? anclasNorm : anclasDeMarkdown(markdown);
  }
  const seenU = new Set();
  const anclasFinal = [];
  entradasFinal.concat(salidasFinal).forEach(function (a) {
    if (seenU.has(a)) return;
    seenU.add(a);
    anclasFinal.push(a);
  });
  const snapMd = form.dataset.snapMarkdown;
  const snapAnclas = form.dataset.snapAnclas;
  if (typeof snapMd === 'string' && typeof snapAnclas === 'string') {
    if (markdown === snapMd && anclasCanonicasTexto(anclasFinal) === snapAnclas) {
      if (error) error.textContent = 'Sin cambios';
      return;
    }
  }
  submit.disabled = true;
  try {
    const hash = await sha256Hex(markdown);
    await asegurarClaveCatalogo();
    const data = await apiFetchAuth('/v1/skills/' + encodeURIComponent(id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre: nombre,
        descripcion: descripcion,
        markdown: markdown,
        entradas: entradasFinal,
        salidas: salidasFinal,
        anclas: anclasFinal
      })
    });
    if (data && data.ok === false) throw new Error(data.error || 'No se pudo guardar');
    const creada = await guardarEdicionSkill(id, {
      nombre: nombre,
      descripcion: descripcion,
      entradas: entradasFinal,
      salidas: salidasFinal,
      anclas: anclasFinal
    }, markdown, hash);
    document.getElementById('dlgEditar').close();
    state.pendingFocus = id;
    cargarSkills();
    setTimeout(function () { abrirInstruccion(id, creada.numero); }, 200);
  } catch (err) {
    if (error) showApiErrorRaw(error, err, { kind: 'is-err', statusLabel: true });
  } finally {
    submit.disabled = false;
  }
}

function esMarkdownVersion(v) {
  if (typeof v.markdown === 'string') return true;
  if (v.datos && esMarkdownNombre(v.nombreArchivo || '')) return true;
  if (v.ruta && esMarkdownNombre(v.ruta)) return true;
  return false;
}

function textoDeDatos(datos) {
  const coma = String(datos).indexOf(',');
  if (coma < 0) return '';
  const meta = datos.slice(0, coma);
  const payload = datos.slice(coma + 1);
  if (/;base64/i.test(meta)) {
    const bin = atob(payload);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  }
  try { return decodeURIComponent(payload); } catch (e) { return payload; }
}

function pintarDescarga(nombre, href) {
  const md = document.getElementById('md');
  if (!md) return;
  const seguro = nombreSeguro(nombre);
  md.innerHTML = '<p><a download="' + escapeHtml(seguro) + '" href="' + escapeHtml(href) + '">Descargar ' + escapeHtml(seguro) + '</a></p>'
    + '<p class="vacio-md">Este archivo no es markdown. Se descarga.</p>';
}

function pintarVersion(v) {
  const md = document.getElementById('md');
  if (!md) return;
  if (typeof v.markdown === 'string') {
    state.inflightRuta = null;
    state.fetchToken += 1;
    md.innerHTML = htmlDeMarkdown(v.markdown);
    return;
  }
  if (v.datos) {
    state.inflightRuta = null;
    state.fetchToken += 1;
    if (esMarkdownNombre(v.nombreArchivo || '')) {
      try {
        md.innerHTML = htmlDeMarkdown(textoDeDatos(v.datos));
      } catch (e) {
        pintarDescarga(v.nombreArchivo || 'archivo', v.datos);
      }
      return;
    }
    pintarDescarga(v.nombreArchivo || 'archivo', v.datos);
    return;
  }
  if (!esMarkdownVersion(v)) {
    state.inflightRuta = null;
    state.fetchToken += 1;
    let href = '';
    try { href = hrefRuta(v.ruta); } catch (e) {
      md.textContent = 'No se pudo preparar la descarga de esta versión.';
      return;
    }
    pintarDescarga(v.nombreArchivo || v.ruta.split('/').pop(), href);
    return;
  }
  if (mdCache.has(v.ruta)) {
    md.innerHTML = htmlDeMarkdown(mdCache.get(v.ruta));
    return;
  }
  if (state.inflightRuta === v.ruta) {
    md.textContent = 'Cargando…';
    return;
  }
  state.inflightRuta = v.ruta;
  const token = ++state.fetchToken;
  const ruta = v.ruta;
  md.textContent = 'Cargando…';
  let url;
  try {
    url = hrefRuta(ruta);
  } catch (e) {
    state.inflightRuta = null;
    md.textContent = 'No se pudo leer el markdown de esta versión.';
    return;
  }
  fetch(url, { cache: 'no-store' })
    .then(function (res) {
      if (!res.ok) throw new Error('http');
      return res.text();
    })
    .then(function (text) {
      if (token !== state.fetchToken) return;
      mdCache.set(ruta, text);
      if (state.inflightRuta === ruta) state.inflightRuta = null;
      const actual = instruccionAbierta();
      if (!actual) return;
      const abierta = versionAbierta(actual);
      if (!abierta || abierta.ruta !== ruta) return;
      const box = document.getElementById('md');
      if (box) box.innerHTML = htmlDeMarkdown(text);
    })
    .catch(function () {
      if (token !== state.fetchToken) return;
      if (state.inflightRuta === ruta) state.inflightRuta = null;
      const box = document.getElementById('md');
      if (box) box.textContent = 'No se pudo leer el markdown de esta versión.';
    });
}

function renderHistorial(ins, abierta) {
  const pop = document.getElementById('historial');
  const lista = document.getElementById('historialLista');
  const btn = document.getElementById('btnHistorial');
  if (!pop || !lista || !btn) return;
  pop.hidden = !state.historial;
  btn.setAttribute('aria-expanded', state.historial ? 'true' : 'false');
  lista.replaceChildren();
  const orden = ins.versiones.slice().sort(function (a, b) { return b.numero - a.numero; });
  orden.forEach(function (v) {
    const li = document.createElement('li');
    const b = el('button', null, '');
    b.type = 'button';
    b.dataset.numero = String(v.numero);
    const marca = v.numero === abierta.numero;
    if (marca) b.setAttribute('aria-current', 'true');
    b.append(el('span', null, formatVersion(v.numero, v.fecha)));
    if (marca) b.append(el('span', 'marca', 'Abierta'));
    li.append(b);
    lista.append(li);
  });
}

function readerIoSubActual() {
  const on = document.querySelector('#readerAnclasSubtabs [data-skill-io-sub].is-on');
  return (on && on.getAttribute('data-skill-io-sub')) || 'entradas';
}

function seleccionarReaderIoSub(id) {
  const tabs = document.querySelectorAll('#readerAnclasSubtabs [data-skill-io-sub]');
  tabs.forEach(function (btn) {
    const on = btn.getAttribute('data-skill-io-sub') === id;
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  const hintVerb = document.getElementById('readerAnclasHintVerb');
  if (hintVerb) hintVerb.textContent = id === 'salidas' ? 'escribe' : 'lee';
  pintarReaderAnclas(instruccionAbierta());
}

function pintarReaderAnclas(ins) {
  const box = document.getElementById('readerAnclas');
  const lista = document.getElementById('readerAnclasLista');
  const vacio = document.getElementById('readerAnclasVacio');
  if (!box || !lista) return;
  const io = skillIoListas(ins || {});
  const sub = readerIoSubActual();
  const anclas = sub === 'salidas' ? io.salidas : io.entradas;
  lista.replaceChildren();
  if (!anclas.length) {
    if (vacio) {
      vacio.hidden = false;
      vacio.textContent = sub === 'salidas'
        ? 'Ninguna ancla de salida.'
        : 'Ninguna ancla de entrada.';
    }
    return;
  }
  if (vacio) vacio.hidden = true;
  anclas.forEach(function (a) {
    lista.append(filaCatalogoAnclaDom(campoAnclaPorToken(a), function (tok) {
      abrirFichaAncla(tok);
    }));
  });
}

function pintarSkillConexion(ins) {
  const box = document.getElementById('readerConexionBox');
  if (!box) return;
  box.replaceChildren();
  if (!ins || !ins.id) {
    box.append(el('p', 'ancla-ficha-vacio', 'Abre una skill para ver la conexión.'));
    return;
  }
  const base = (typeof window.API_BASE === 'string' && window.API_BASE)
    || 'https://campos-ancla-api.web-legal-es.workers.dev';
  const sid = encodeURIComponent(ins.id);
  const getCard = el('div', 'skill-conexion-card', null);
  getCard.append(el('h4', null, '1. Leer entradas'));
  const getPre = document.createElement('pre');
  getPre.textContent = 'GET ' + base + '/v1/ejecutar/' + sid + '/entradas?negocio=<id>\n→ { "_ancla_": valor }';
  getCard.append(getPre);
  const postCard = el('div', 'skill-conexion-card', null);
  postCard.append(el('h4', null, '2. Escribir salidas'));
  const postPre = document.createElement('pre');
  postPre.textContent = 'POST ' + base + '/v1/ejecutar/' + sid + '/salidas\nAuthorization: Bearer inv_…\n{ "negocio": "<id>", "valores": { "_ancla_": valor } }\n→ 400 si el ancla no está en salidas';
  postCard.append(postPre);
  box.append(getCard, postCard);
}

function renderReader() {
  const dlg = document.getElementById('dlgSkill');
  const reader = document.getElementById('reader');
  if (!reader) return;
  const ins = instruccionAbierta();
  if (!ins) {
    state.abiertaId = null;
    state.abiertaNumero = null;
    state.historial = false;
    const vacio = document.getElementById('readerAnclasVacio');
    const lista = document.getElementById('readerAnclasLista');
    if (lista) lista.replaceChildren();
    if (vacio) vacio.hidden = false;
    if (dlg && dlg.open) dlg.close();
    return;
  }
  const v = versionAbierta(ins);
  state.abiertaNumero = v.numero;
  document.getElementById('readerNombre').textContent = ins.nombre;
  document.getElementById('readerVersion').textContent = formatVersion(v.numero, v.fecha);
  const readerId = document.getElementById('readerId');
  if (readerId) readerId.textContent = ins.id || '—';
  const readerInternoVersion = document.getElementById('readerInternoVersion');
  if (readerInternoVersion) readerInternoVersion.textContent = formatVersion(v.numero, v.fecha);
  const full = normalizarHash(v.hash) || hashFnvHex(ins.id + '|' + v.numero + '|' + (v.ruta || v.fecha || ''));
  const hashBtn = document.getElementById('readerHashBtn');
  const hashFull = document.getElementById('readerHashFull');
  const hashVacio = document.getElementById('readerHashVacio');
  if (hashBtn && hashFull && hashVacio) {
    if (full) {
      hashFull.textContent = full;
      hashBtn.hidden = false;
      hashBtn.dataset.hash = full;
      hashVacio.hidden = true;
    } else {
      hashBtn.hidden = true;
      hashBtn.dataset.hash = '';
      hashVacio.hidden = false;
    }
  }
  seleccionarReaderTab('documento');
  renderHistorial(ins, v);
  pintarVersion(v);
  pintarReaderAnclas(ins);
  pintarSkillBases(ins);
  if (window.SystemPromptsCatalog) {
    window.SystemPromptsCatalog.pintarSkillSystemPromptsTab(ins);
  }
  if (window.EjecutoresCatalog) {
    window.EjecutoresCatalog.pintarSkillEjecutorTab(ins);
  }
  openFichaPane(dlg);
  cablearColorFicha(dlg, {
    kind: 'skill',
    id: ins.id,
    iconKind: 'skill',
    getColor: function () { return ins.color; },
    onSaved: function (hex) { ins.color = hex; }
  });
  const nombre = document.getElementById('readerNombre');
  if (nombre) nombre.focus();
}

var skillAsocSub = 'anclas';

function readerAsocSubActual() {
  const on = document.querySelector('#readerAsociadosSubtabs [data-reader-asoc-sub].is-on');
  return (on && on.getAttribute('data-reader-asoc-sub')) || skillAsocSub || 'anclas';
}

function seleccionarReaderAsocSub(id) {
  if (id !== 'anclas' && id !== 'system-prompt' && id !== 'ejecutor' && id !== 'bases') id = 'anclas';
  skillAsocSub = id;
  const tabs = document.querySelectorAll('#readerAsociadosSubtabs [data-reader-asoc-sub]');
  tabs.forEach(function (btn) {
    const on = btn.getAttribute('data-reader-asoc-sub') === id;
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  document.querySelectorAll('#readerPanelAsociados [data-reader-asoc-pane]').forEach(function (pane) {
    pane.hidden = pane.getAttribute('data-reader-asoc-pane') !== id;
  });
  const ins = instruccionAbierta();
  if (id === 'anclas') seleccionarReaderIoSub(readerIoSubActual());
  if (id === 'bases') pintarSkillBases(ins);
  if (id === 'system-prompt' && window.SystemPromptsCatalog) {
    window.SystemPromptsCatalog.pintarSkillSystemPromptsTab(ins);
  }
  if (id === 'ejecutor' && window.EjecutoresCatalog) {
    window.EjecutoresCatalog.pintarSkillEjecutorTab(ins);
  }
}

function seleccionarReaderTab(id) {
  if (
    id === 'anclas' ||
    id === 'bases' ||
    id === 'system-prompts' ||
    id === 'system-prompt' ||
    id === 'ejecutor' ||
    id === 'ejecutores'
  ) {
    const sub = id === 'system-prompts' || id === 'ejecutores' ? (id === 'ejecutores' ? 'ejecutor' : 'system-prompt') : id;
    id = 'asociados';
    skillAsocSub = sub;
  }
  const tabs = document.querySelectorAll('#readerTabs [data-reader-tab]');
  const panelDoc = document.getElementById('readerPanelDoc');
  const panelAsociados = document.getElementById('readerPanelAsociados');
  const panelConexion = document.getElementById('readerPanelConexion');
  const panelEjecuciones = document.getElementById('readerPanelEjecuciones');
  const panelInterno = document.getElementById('readerPanelInterno');
  tabs.forEach(function (btn) {
    const on = btn.getAttribute('data-reader-tab') === id;
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  if (panelDoc) panelDoc.hidden = id !== 'documento';
  if (panelAsociados) panelAsociados.hidden = id !== 'asociados';
  if (panelConexion) panelConexion.hidden = id !== 'conexion';
  if (panelEjecuciones) panelEjecuciones.hidden = id !== 'ejecuciones';
  if (panelInterno) panelInterno.hidden = id !== 'interno';
  if (id === 'asociados') seleccionarReaderAsocSub(skillAsocSub || readerAsocSubActual());
  if (id === 'conexion') pintarSkillConexion(instruccionAbierta());
  if (id === 'ejecuciones') pintarSkillEjecuciones(instruccionAbierta());
}

async function pintarSkillEjecuciones(ins) {
  const mount = document.getElementById('readerEjecucionesLista');
  const vacio = document.getElementById('readerEjecucionesVacio');
  if (!mount) return;
  mount.replaceChildren();
  if (!ins || !ins.id) {
    if (vacio) {
      vacio.hidden = false;
      vacio.textContent = 'Abre una skill para ver ejecuciones.';
    }
    return;
  }
  if (vacio) {
    vacio.hidden = false;
    vacio.textContent = 'Cargando…';
  }
  try {
    const data = await apiFetch(
      '/v1/skills/' + encodeURIComponent(ins.id) + '/ejecuciones?limit=30'
    );
    const list = (data && data.ejecuciones) || [];
    mount.replaceChildren();
    if (!list.length) {
      if (vacio) {
        vacio.hidden = false;
        vacio.textContent = 'Sin ejecuciones todavía.';
      }
      return;
    }
    if (vacio) vacio.hidden = true;
    list.forEach(function (ej) {
      const estado = String(
        ej.estado != null ? ej.estado : ej.ok === false ? 'error' : ej.ok ? 'ok' : '—'
      );
      const cuando = String(ej.creado || '');
      const fuente = ej.fuente ? String(ej.fuente) : '';
      const ms = ej.duracion_ms != null ? String(ej.duracion_ms) + ' ms' : '';
      const secundario = [
        cuando,
        ej.corrida_id ? String(ej.corrida_id) : '',
        ej.ejecutor_id ? String(ej.ejecutor_id) : '',
        fuente
      ]
        .filter(Boolean)
        .join(' · ');
      const titulo = estado + (ms ? ' · ' + ms : '');
      if (typeof filaCatalogoLista === 'function') {
        mount.appendChild(
          filaCatalogoLista({
            icono: 'pasos',
            titulo: titulo,
            secundario: secundario || '—',
            static: true,
            ariaLabel: 'Ejecución ' + estado
          })
        );
      } else {
        const row = document.createElement('div');
        row.className = 'catalogo-fila catalogo-fila-static';
        row.textContent = titulo + (secundario ? ' · ' + secundario : '');
        mount.appendChild(row);
      }
    });
  } catch (err) {
    mount.replaceChildren();
    if (vacio) {
      vacio.hidden = false;
      vacio.textContent = 'No se pudieron cargar las ejecuciones.';
    }
  }
}

function pintarSkillBases(ins) {
  const mount = document.getElementById('readerBasesLista');
  const vacio = document.getElementById('readerBasesVacio');
  if (!mount) return;
  if (!ins || !ins.id) {
    mount.replaceChildren();
    if (vacio) {
      vacio.hidden = false;
      vacio.textContent = 'Ninguna base de datos usa esta skill.';
    }
    return;
  }
  const usados = proyectosQueUsanSkill(ins.id);
  if (!usados.length) {
    mount.replaceChildren();
    if (vacio) {
      vacio.hidden = false;
      vacio.textContent = 'Ninguna base de datos usa esta skill todavía.';
    }
    return;
  }
  if (vacio) vacio.hidden = true;
  if (!window.ProyectosUI || typeof window.ProyectosUI.montarLista !== 'function') {
    mount.textContent = usados.map(function (p) { return p.nombre || p.id; }).join(', ');
    return;
  }
  const skillId = ins.id;
  window.ProyectosUI.montarLista(mount, {
    getSnapshot: function () {
      return {
        ready: true,
        indexError: false,
        proyectos: usados,
        abierta: null
      };
    },
    añadirProyecto: function () {},
    abrirProyecto: function (id) {
      state.reabrirSkillTrasProyecto = skillId;
      cerrarSkillModal();
      setTimeout(function () { abrirProyecto(id); }, 0);
    }
  }, { emptyMsg: 'Ninguna base de datos usa esta skill todavía.' });
}

function seleccionarEditarTab(id) {
  const tabs = document.querySelectorAll('#editarTabs [data-editar-tab]');
  const panelDoc = document.getElementById('editarPanelDoc');
  const panelAnclas = document.getElementById('editarPanelAnclas');
  tabs.forEach(function (btn) {
    const on = btn.getAttribute('data-editar-tab') === id;
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  if (panelDoc) panelDoc.hidden = id !== 'documento';
  if (panelAnclas) panelAnclas.hidden = id !== 'anclas';
}

function render() {
  if (typeof document === 'undefined') return;
  const focoEnHistorial = !!(document.activeElement && document.activeElement.closest && document.activeElement.closest('#historial, #btnHistorial'));
  refrescar();
  pintarSkills();
  renderReader();
  if (state.pendingFocus) {
    const id = state.pendingFocus;
    state.pendingFocus = null;
    const btn = document.querySelector('#skills-root [data-accion="abrir"][data-id="' + CSS.escape(id) + '"]');
    if (btn) btn.focus();
  } else if (state.historial && focoEnHistorial) {
    const current = document.querySelector('#historialLista [aria-current="true"]');
    if (current) current.focus();
  }
}

function limpiarError(id) {
  const nodo = document.getElementById(id);
  if (nodo) nodo.textContent = '';
}

function abrirDialogoNuevo() {
  const dlg = document.getElementById('dlgNueva');
  const form = document.getElementById('formNueva');
  form.reset();
  limpiarError('nuevaError');
  document.getElementById('nuevaArchivoNombre').textContent = '';
  dlg.showModal();
  form.nombre.focus();
}

function proyectosQueUsanSkill(skillId) {
  refrescarProyectos();
  return state.proyectos.lista.filter(function (p) {
    return Array.isArray(p.skills) && p.skills.indexOf(skillId) >= 0;
  });
}

function quitarSkillDeProyectos(skillId) {
  refrescarProyectos();
  const afectados = proyectosQueUsanSkill(skillId);
  if (!afectados.length) return;
  const store = leerProyectosStore();
  afectados.forEach(function (proy) {
    let entrada = store.proyectos.find(function (p) { return p && p.id === proy.id; });
    if (!entrada) {
      entrada = {
        id: proy.id,
        nombre: proy.nombre,
        descripcion: proy.descripcion || '',
        skills: (proy.skills || []).slice(),
        versiones: Array.isArray(proy.versiones) ? proy.versiones.slice() : []
      };
      store.proyectos.push(entrada);
    }
    entrada.skills = (entrada.skills || []).filter(function (s) { return s !== skillId; });
  });
  guardarProyectosLocal(store);
  refrescarProyectos();
  pintarProyectos();
}

function eliminarBloque(id) {
  const store = leerStore();
  store.instrucciones = store.instrucciones.filter(function (ins) {
    return !(ins && ins.id === id);
  });
  if (store.eliminados.indexOf(id) < 0) store.eliminados.push(id);
  guardarLocal(store);
  quitarSkillDeProyectos(id);
  if (state.abiertaId === id) {
    state.abiertaId = null;
    state.abiertaNumero = null;
    state.historial = false;
    const dlg = document.getElementById('dlgSkill');
    if (dlg && dlg.open) dlg.close();
  }
  render();
}

function eliminarProyecto(id) {
  const store = leerProyectosStore();
  store.proyectos = (store.proyectos || []).filter(function (p) { return !(p && p.id === id); });
  if ((store.eliminados || []).indexOf(id) < 0) {
    store.eliminados = (store.eliminados || []).concat([id]);
  }
  guardarProyectosLocal(store);
  if (state.proyectos.abiertoId === id) {
    state.proyectos.abiertoId = null;
    state.proyectos.abiertaNumero = null;
    state.proyectos.historial = false;
    const dlg = document.getElementById('dlgProyecto');
    if (dlg && dlg.open) dlg.close();
  }
  refrescarProyectos();
  pintarProyectos();
}

function eliminarAgenteLocal(id) {
  const store = leerAgentesStore();
  store.agentes = (store.agentes || []).filter(function (a) { return !(a && a.id === id); });
  if ((store.eliminados || []).indexOf(id) < 0) {
    store.eliminados = (store.eliminados || []).concat([id]);
  }
  guardarAgentesLocal(store);
  if (state.agentes.abiertoId === id) {
    state.agentes.abiertoId = null;
    const dlg = document.getElementById('dlgAgenteFicha');
    if (dlg && dlg.open) dlg.close();
  }
  refrescarAgentes();
  pintarAgentes();
  sincronizarAgentesSilencioso();
}

function eliminarAgente(id) {
  const ag = state.agentes.lista.find(function (a) { return a.id === id; });
  const clave = (ag && ag.inviteUsada) || state.agentes.inviteActual || '';
  const finish = function () { eliminarAgenteLocal(id); };
  if (!clave) {
    finish();
    return;
  }
  apiFetch('/v1/agentes/' + encodeURIComponent(id), {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + clave }
  }).then(finish).catch(function () {
    // Si la API falla, al menos se oculta en este navegador.
    finish();
  });
}

function eliminarFundamento(id) {
  const store = leerFundamentosStore();
  store.fundamentos = (store.fundamentos || []).filter(function (f) { return !(f && f.id === id); });
  if ((store.eliminados || []).indexOf(id) < 0) {
    store.eliminados = (store.eliminados || []).concat([id]);
  }
  guardarFundamentosLocal(store);
  if (state.fundamentos.abiertoId === id) {
    state.fundamentos.abiertoId = null;
    state.fundamentos.abiertaNumero = null;
    state.fundamentos.historial = false;
    const dlg = document.getElementById('dlgFundamento');
    if (dlg && dlg.open) dlg.close();
  }
  refrescarFundamentos();
  pintarFundamentos();
}

function abrirDialogoEliminar(opts) {
  if (typeof opts === 'string') {
    opts = { tipo: 'skill', id: opts };
  }
  if (!opts || !opts.tipo || !opts.id) return;
  if (opts.tipo === 'skill') {
    const ins = state.instrucciones.find(function (item) { return item.id === opts.id; });
    if (!ins) return;
    if (!opts.titulo) opts.titulo = '¿Estás seguro de eliminar la skill?';
    if (opts.aviso == null) {
      const usados = proyectosQueUsanSkill(opts.id);
      if (usados.length) {
        opts.aviso = 'Está en ' + usados.length + (usados.length === 1 ? ' base de datos' : ' bases de datos')
          + ' (' + usados.map(function (p) { return p.nombre; }).join(', ')
          + '). Al confirmar se quita también de esas asociaciones.';
      }
    }
  }
  if (opts.tipo === 'cluster') {
    const cl = (state.clusters.lista || []).find(function (c) { return c.id === opts.id; });
    if (!cl) return;
    if (!opts.titulo) opts.titulo = '¿Estás seguro de eliminar el cluster?';
    if (opts.aviso == null) {
      opts.aviso = 'Solo se puede borrar si no tiene Bases de datos asociadas. La URI cifrada del cluster también se elimina.';
    }
  }
  if (opts.tipo === 'proyecto') {
    const proy = state.proyectos.lista.find(function (p) { return p.id === opts.id; });
    if (!proy) return;
    if (!opts.titulo) opts.titulo = '¿Estás seguro de eliminar la base de datos?';
    if (opts.aviso == null) {
      opts.aviso = 'Se quita la base de datos de este navegador. Las skills no se borran; solo dejan de estar asociadas a ella.';
    }
  }
  if (opts.tipo === 'agente') {
    const ag = state.agentes.lista.find(function (a) { return a.id === opts.id; });
    if (!ag) return;
    if (!opts.titulo) opts.titulo = '¿Estás seguro de eliminar el agente?';
  }
  if (opts.tipo === 'fundamento') {
    const f = state.fundamentos.lista.find(function (x) { return x.id === opts.id; });
    if (!f) return;
    if (!opts.titulo) opts.titulo = '¿Estás seguro de eliminar el fundamento?';
  }
  if (opts.tipo === 'system-prompt') {
    const list = (window.SystemPromptsCatalog && window.SystemPromptsCatalog.state.lista) || [];
    const f = list.find(function (x) { return x.id === opts.id; });
    if (!f) return;
    if (!opts.titulo) opts.titulo = '¿Estás seguro de eliminar el system prompt?';
  }
  if (opts.tipo === 'ejecutor') {
    const list = (window.EjecutoresCatalog && window.EjecutoresCatalog.state.lista) || [];
    const f = list.find(function (x) { return x.id === opts.id; });
    if (!f) return;
    if (!opts.titulo) opts.titulo = '¿Estás seguro de eliminar el ejecutor?';
    if (opts.aviso == null) {
      opts.aviso = 'Las skills que lo usaban pasan a implícito agente_externo.';
    }
  }
  const dlg = document.getElementById('dlgEliminar');
  const form = document.getElementById('formEliminar');
  if (!dlg || !form) return;
  form.dataset.tipo = opts.tipo;
  form.dataset.id = opts.id;
  const titulo = document.getElementById('dlgEliminarTitulo');
  if (titulo) titulo.textContent = opts.titulo || '¿Estás seguro de eliminar?';
  const aviso = document.getElementById('eliminarAviso');
  if (aviso) {
    if (opts.aviso) {
      aviso.hidden = false;
      aviso.textContent = opts.aviso;
    } else {
      aviso.hidden = true;
      aviso.textContent = '';
    }
  }
  const error = document.getElementById('eliminarError');
  if (error) error.textContent = '';
  dlg.showModal();
  const cancelar = document.getElementById('eliminarCancelar');
  if (cancelar) cancelar.focus();
}

function abrirDialogoVersion(id) {
  const ins = state.instrucciones.find(function (item) { return item.id === id; });
  if (!ins) return;
  const dlg = document.getElementById('dlgVersion');
  const form = document.getElementById('formVersion');
  form.reset();
  form.dataset.id = id;
  limpiarError('versionError');
  document.getElementById('versionArchivoNombre').textContent = '';
  document.getElementById('versionDestino').textContent = ins.nombre;
  dlg.showModal();
  const campo = form.elements.archivo;
  if (campo) campo.focus();
}

function leerArchivo(file) {
  return new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.onload = function () { resolve(String(reader.result || '')); };
    reader.onerror = function () { reject(new Error('No se pudo leer el archivo.')); };
    reader.readAsText(file);
  });
}

function leerDatos(file) {
  return new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.onload = function () { resolve(String(reader.result || '')); };
    reader.onerror = function () { reject(new Error('No se pudo leer el archivo.')); };
    reader.readAsDataURL(file);
  });
}

async function contenidoDelFormulario(form) {
  const file = form.archivo.files && form.archivo.files[0];
  if (file) {
    if (!file.size) throw new Error('El archivo está vacío.');
    if (file.size > 350000) throw new Error('El archivo es demasiado grande para este navegador.');
    if (esMarkdownNombre(file.name)) {
      const text = await leerArchivo(file);
      if (!text.trim()) throw new Error('El archivo está vacío.');
      if (text.length > 400000) throw new Error('El archivo es demasiado grande para este navegador.');
      return { markdown: text, nombreArchivo: file.name };
    }
    const datos = await leerDatos(file);
    if (datos.indexOf('data:') !== 0) throw new Error('No se pudo leer el archivo.');
    return { datos: datos, nombreArchivo: file.name };
  }
  const pasted = form.markdown.value;
  if (!pasted.trim()) throw new Error('Elige un archivo o pega el markdown.');
  if (pasted.length > 400000) throw new Error('El markdown es demasiado grande para este navegador.');
  return { markdown: pasted };
}

async function guardarInstruccionNueva(nombre, contenido, meta) {
  const store = leerStore();
  const version = { numero: 1, fecha: todayISO() };
  if (contenido.markdown != null) version.markdown = contenido.markdown;
  if (contenido.datos) version.datos = contenido.datos;
  if (contenido.nombreArchivo) version.nombreArchivo = contenido.nombreArchivo;
  version.hash = await sha256Hex(
    contenido.markdown != null ? contenido.markdown : (contenido.datos || (nombre + '|1'))
  );
  const ins = { id: slugId(nombre), nombre: nombre, versiones: [version] };
  if (meta && meta.descripcion) ins.descripcion = meta.descripcion;
  let anclas = meta && meta.anclas ? normalizarAnclas(meta.anclas) : [];
  if (!anclas.length && contenido.markdown) anclas = anclasDeMarkdown(contenido.markdown);
  if (anclas.length) ins.anclas = anclas;
  store.instrucciones.push(ins);
  guardarLocal(store);
  return ins;
}

async function guardarVersion(id, contenido) {
  refrescar();
  const actual = state.instrucciones.find(function (ins) { return ins.id === id; });
  if (!actual) throw new Error('No está esa skill.');
  const store = leerStore();
  let entrada = store.instrucciones.find(function (ins) { return ins && ins.id === id; });
  if (!entrada) {
    entrada = { id: id, nombre: actual.nombre, versiones: [] };
    store.instrucciones.push(entrada);
  }
  if (!Array.isArray(entrada.versiones)) entrada.versiones = [];
  const creada = { numero: siguienteNumero(actual.versiones), fecha: todayISO() };
  if (contenido.markdown != null) creada.markdown = contenido.markdown;
  if (contenido.datos) creada.datos = contenido.datos;
  if (contenido.nombreArchivo) creada.nombreArchivo = contenido.nombreArchivo;
  creada.hash = await sha256Hex(
    contenido.markdown != null ? contenido.markdown : (contenido.datos || (id + '|' + creada.numero))
  );
  entrada.versiones.push(creada);
  guardarLocal(store);
  return creada;
}

function abrirInstruccion(id, numero) {
  state.abiertaId = id;
  state.abiertaNumero = numero == null ? null : numero;
  state.historial = false;
  state.historialSkillId = null;
  render();
}

function cerrarHistorial() {
  if (!state.historial) return;
  state.historial = false;
  render();
}

function onClickHistorial(e) {
  const btn = e.target.closest('[data-numero]');
  if (!btn || !state.abiertaId) return;
  state.abiertaNumero = Number(btn.dataset.numero);
  state.historial = false;
  render();
  const nombre = document.getElementById('readerNombre');
  if (nombre) nombre.focus();
}

function alternarHistorial() {
  if (!state.abiertaId) return;
  state.historial = !state.historial;
  const veniaDelBoton = document.activeElement && document.activeElement.id === 'btnHistorial';
  render();
  if (state.historial) {
    const current = document.querySelector('#historialLista [aria-current="true"]');
    if (current) current.focus();
  } else if (veniaDelBoton) {
    const boton = document.getElementById('btnHistorial');
    if (boton) boton.focus();
  }
}

async function onSubmitNueva(e) {
  e.preventDefault();
  const error = document.getElementById('nuevaError');
  error.textContent = '';
  const form = e.currentTarget;
  const submit = form.querySelector('[type="submit"]');
  const nombre = form.nombre.value.trim();
  if (!nombre) {
    error.textContent = 'Escribe un nombre.';
    form.nombre.focus();
    return;
  }
  if (nombre.length > 120) {
    error.textContent = 'El nombre es demasiado largo.';
    return;
  }
  const descripcion = form.descripcion ? form.descripcion.value.trim().slice(0, 280) : '';
  const anclasRaw = form.anclas ? form.anclas.value : '';
  const anclas = anclasRaw
    ? anclasRaw.split(/[\n,]+/).map(function (s) { return s.trim(); }).filter(Boolean)
    : [];
  submit.disabled = true;
  try {
    const contenido = await contenidoDelFormulario(form);
    const ins = await guardarInstruccionNueva(nombre, contenido, {
      descripcion: descripcion,
      anclas: anclas
    });
    document.getElementById('dlgNueva').close();
    state.pendingFocus = ins.id;
    abrirInstruccion(ins.id, 1);
  } catch (err) {
    showApiErrorRaw(error, err, { kind: 'is-err', statusLabel: true });
  } finally {
    submit.disabled = false;
  }
}

async function onSubmitEliminar(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const error = document.getElementById('eliminarError');
  if (error) error.textContent = '';
  const id = form.dataset.id;
  const tipo = form.dataset.tipo || 'skill';
  if (!id) return;
  try {
    if (tipo === 'skill') eliminarBloque(id);
    else if (tipo === 'ancla') eliminarCampoAncla(id);
    else if (tipo === 'mongo') eliminarCampoMongo(id);
    else if (tipo === 'cluster') await eliminarCluster(id);
    else if (tipo === 'proyecto') eliminarProyecto(id);
    else if (tipo === 'agente') eliminarAgente(id);
    else if (tipo === 'fundamento') eliminarFundamento(id);
    else if (tipo === 'system-prompt' && window.SystemPromptsCatalog) window.SystemPromptsCatalog.eliminar(id);
    else if (tipo === 'ejecutor' && window.EjecutoresCatalog) await window.EjecutoresCatalog.eliminar(id);
    else throw new Error('Tipo desconocido.');
    document.getElementById('dlgEliminar').close();
  } catch (err) {
    if (error) showApiErrorRaw(error, err, { kind: 'is-err', statusLabel: true });
  }
}

async function onSubmitVersion(e) {
  e.preventDefault();
  const error = document.getElementById('versionError');
  error.textContent = '';
  const form = e.currentTarget;
  const submit = form.querySelector('[type="submit"]');
  const id = form.dataset.id;
  submit.disabled = true;
  try {
    const contenido = await contenidoDelFormulario(form);
    const creada = await guardarVersion(id, contenido);
    document.getElementById('dlgVersion').close();
    state.pendingFocus = id;
    abrirInstruccion(id, creada.numero);
  } catch (err) {
    showApiErrorRaw(error, err, { kind: 'is-err', statusLabel: true });
  } finally {
    submit.disabled = false;
  }
}

function renderPestanas(listaId, items, actual, attr, panelAttr) {
  const lista = document.getElementById(listaId);
  if (!lista) return;
  lista.replaceChildren();
  items.forEach(function (item) {
    const btn = el('button', 'pestana');
    btn.type = 'button';
    btn.id = 'tab-' + item.id;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-controls', 'panel-' + item.id);
    btn.dataset[attr] = item.id;
    if (item.icono) btn.append(svgPestanaCatalogo(item.icono));
    const label = document.createElement('span');
    label.textContent = item.nombre;
    btn.append(label);
    const on = item.id === actual;
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
    btn.tabIndex = on ? 0 : -1;
    lista.append(btn);
  });
  document.querySelectorAll('[role="tabpanel"][' + panelAttr + ']').forEach(function (panel) {
    const on = panel.getAttribute(panelAttr) === actual;
    panel.hidden = !on;
    if (on) panel.setAttribute('aria-labelledby', 'tab-' + panel.getAttribute(panelAttr));
  });
}

function renderPestanasCatalogo() {
  renderPestanas('catalogoTabs', CATALOGOS, state.catalogoId, 'catalogo', 'data-catalogo');
}

function renderDocPestanas() {
  renderPestanas('docTabs', DOCUMENTOS, state.docId, 'doc', 'data-doc');
}

function seleccionarCatalogo(id) {
  const existe = CATALOGOS.some(function (cat) { return cat.id === id; });
  if (!existe) return;
  state.catalogoId = id;
  renderPestanasCatalogo();
  // Re-fetch from live API on tab focus so agent writes appear without hard reload.
  if (id === 'skills') cargarSkills();
  if (id === 'flujos' && window.FlujosCorridasUI && typeof window.FlujosCorridasUI.cargarCatalogo === 'function') {
    window.FlujosCorridasUI.cargarCatalogo();
  }
  if (id === 'system-prompts' && window.SystemPromptsCatalog) window.SystemPromptsCatalog.cargar();
  if (id === 'ejecutores' && window.EjecutoresCatalog) window.EjecutoresCatalog.cargar();
  if (id === 'campos-ancla') cargarCampos();
  if (id === 'campos-mongodb') cargarMongo();
  if (id === 'clusters') cargarClusters();
  if (id === 'proyectos') cargarProyectos();
  if (id === 'colecciones') cargarColecciones();
  // Agentes vive en Ajustes; al cambiar de catálogo se para el poll si Ajustes no está visible.
  if (!agentesCatalogoVisible()) detenerPollAgentes();
  const tab = document.getElementById('tab-' + id);
  if (tab) tab.focus();
}

function seleccionarDoc(id, opts) {
  const existe = DOCUMENTOS.some(function (doc) { return doc.id === id; });
  if (!existe) return;
  state.docId = id;
  renderDocPestanas();
  if (id === 'fundamentos') {
    cargarFundamentos();
  }
  if (id === 'api') cargarDocumentoApi();
  if (id === 'arquitectura') {
    const subId = opts && opts.subId ? opts.subId : null;
    cargarDocumentoArquitectura(subId, { skipHash: !!(opts && opts.skipHash) });
  } else if (id === 'mongodb') {
    const subId = opts && opts.subId ? opts.subId : null;
    refrescarMongoConnStatus();
    cargarDocumentoMongodb(subId, { skipHash: !!(opts && opts.skipHash) });
  } else if (!(opts && opts.skipHash) && typeof history !== 'undefined' && history.replaceState) {
    const next = '#documentacion/' + id;
    if (location.hash !== next) history.replaceState(null, '', next);
  }
  const tab = document.getElementById('tab-' + id);
  if (tab && !(opts && opts.skipFocus)) tab.focus();
}

function aplicarHashDocumentacion() {
  const h = (location.hash || '').replace(/^#/, '');
  if (h !== 'documentacion' && h.indexOf('documentacion/') !== 0) return;
  const parts = h.split('/');
  const docId = parts[1] || 'api';
  const subId = parts[2] || null;
  if (typeof window.abrirDestino === 'function') window.abrirDestino('documentacion');
  seleccionarDoc(docId, { skipHash: true, skipFocus: true, subId: subId });
}

function teclasPestana(e, selector, actual, elegir) {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  const tabs = Array.from(document.querySelectorAll(selector));
  const i = tabs.indexOf(document.activeElement);
  if (i < 0 || !tabs.length) return;
  e.preventDefault();
  const delta = e.key === 'ArrowRight' ? 1 : -1;
  const next = tabs[(i + delta + tabs.length) % tabs.length];
  elegir(next.dataset[actual]);
}

function nombreDeArchivo(input, destinoId) {
  const file = input.files && input.files[0];
  document.getElementById(destinoId).textContent = file ? file.name : '';
}

function iniciar() {
  registrarColorEntidadKinds();
  renderPestanasCatalogo();
  renderDocPestanas();
  const tabs = document.getElementById('catalogoTabs');
  if (tabs) {
    tabs.addEventListener('click', function (e) {
      const tab = e.target.closest('[data-catalogo]');
      if (!tab) return;
      seleccionarCatalogo(tab.dataset.catalogo);
    });
    tabs.addEventListener('keydown', function (e) {
      teclasPestana(e, '#catalogoTabs [role="tab"]', 'catalogo', seleccionarCatalogo);
    });
  }
  const docTabs = document.getElementById('docTabs');
  if (docTabs) {
    docTabs.addEventListener('click', function (e) {
      const tab = e.target.closest('[data-doc]');
      if (!tab) return;
      seleccionarDoc(tab.dataset.doc);
    });
    docTabs.addEventListener('keydown', function (e) {
      teclasPestana(e, '#docTabs [role="tab"]', 'doc', seleccionarDoc);
    });
  }
  const arqDocTabs = document.getElementById('arqDocTabs');
  if (arqDocTabs) {
    arqDocTabs.addEventListener('click', function (e) {
      const tab = e.target.closest('[data-arq-doc]');
      if (!tab) return;
      seleccionarArqSub(tab.dataset.arqDoc);
    });
    arqDocTabs.addEventListener('keydown', function (e) {
      teclasPestana(e, '#arqDocTabs [role="tab"]', 'arqDoc', seleccionarArqSub);
    });
  }
  const mongoDocTabs = document.getElementById('mongoDocTabs');
  if (mongoDocTabs) {
    mongoDocTabs.addEventListener('click', function (e) {
      const tab = e.target.closest('[data-mongo-doc]');
      if (!tab) return;
      seleccionarMongoSub(tab.dataset.mongoDoc);
    });
    mongoDocTabs.addEventListener('keydown', function (e) {
      teclasPestana(e, '#mongoDocTabs [role="tab"]', 'mongoDoc', seleccionarMongoSub);
    });
  }
  const btnNueva = document.getElementById('btnNueva');
  if (btnNueva) btnNueva.addEventListener('click', abrirDialogoNuevo);
  const nuevaCancelar = document.getElementById('nuevaCancelar');
  if (nuevaCancelar) nuevaCancelar.addEventListener('click', function () {
    document.getElementById('dlgNueva').close();
  });
  const versionCancelar = document.getElementById('versionCancelar');
  if (versionCancelar) versionCancelar.addEventListener('click', function () {
    document.getElementById('dlgVersion').close();
  });
  const editarCancelar = document.getElementById('editarCancelar');
  if (editarCancelar) editarCancelar.addEventListener('click', function () {
    document.getElementById('dlgEditar').close();
  });
  const eliminarCancelar = document.getElementById('eliminarCancelar');
  if (eliminarCancelar) eliminarCancelar.addEventListener('click', function () {
    document.getElementById('dlgEliminar').close();
  });
  const formNueva = document.getElementById('formNueva');
  if (formNueva) formNueva.addEventListener('submit', onSubmitNueva);
  const formVersion = document.getElementById('formVersion');
  if (formVersion) formVersion.addEventListener('submit', onSubmitVersion);
  const formEditar = document.getElementById('formEditar');
  if (formEditar) formEditar.addEventListener('submit', onSubmitEditar);
  const btnEditarAnclas = document.getElementById('btnEditarAnclas');
  if (btnEditarAnclas) btnEditarAnclas.addEventListener('click', abrirDialogoEditarAnclas);
  const formEditarAnclas = document.getElementById('formEditarAnclas');
  if (formEditarAnclas) formEditarAnclas.addEventListener('submit', onSubmitEditarAnclas);
  const editarAnclasCancelar = document.getElementById('editarAnclasCancelar');
  if (editarAnclasCancelar) editarAnclasCancelar.addEventListener('click', function () {
    const dlg = document.getElementById('dlgEditarAnclas');
    if (dlg && dlg.open) dlg.close();
  });
  const readerAnclasSubtabs = document.getElementById('readerAnclasSubtabs');
  if (readerAnclasSubtabs) readerAnclasSubtabs.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-skill-io-sub]');
    if (!btn) return;
    seleccionarReaderIoSub(btn.getAttribute('data-skill-io-sub'));
  });
  const readerAsociadosSubtabs = document.getElementById('readerAsociadosSubtabs');
  if (readerAsociadosSubtabs) readerAsociadosSubtabs.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-reader-asoc-sub]');
    if (!btn) return;
    seleccionarReaderAsocSub(btn.getAttribute('data-reader-asoc-sub'));
  });
  const editarAnclasSubtabs = document.getElementById('editarAnclasSubtabs');
  if (editarAnclasSubtabs) editarAnclasSubtabs.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-editar-io-sub]');
    if (!btn) return;
    seleccionarEditarIoSub(btn.getAttribute('data-editar-io-sub'));
  });
  const formEliminar = document.getElementById('formEliminar');
  if (formEliminar) formEliminar.addEventListener('submit', onSubmitEliminar);
  const formCampo = document.getElementById('formCampo');
  if (formCampo) formCampo.addEventListener('submit', onSubmitCampo);
  const campoCancelar = document.getElementById('campoCancelar');
  if (campoCancelar) campoCancelar.addEventListener('click', function () {
    document.getElementById('dlgCampo').close();
  });
  const formMongo = document.getElementById('formMongo');
  if (formMongo) formMongo.addEventListener('submit', onSubmitMongo);
  const mongoCancelar = document.getElementById('mongoCancelar');
  if (mongoCancelar) mongoCancelar.addEventListener('click', function () {
    document.getElementById('dlgMongo').close();
  });
  const dlgMongoFicha = document.getElementById('dlgMongoFicha');
  if (dlgMongoFicha) dlgMongoFicha.addEventListener('close', function () {
    const reabrirKey = state.mongo.reabrirColeccionKey;
    const reabrirTab = state.mongo.reabrirColeccionTab || 'diagrama';
    state.mongo.reabrirColeccionKey = null;
    state.mongo.reabrirColeccionTab = null;
    state.mongo.abiertoId = null;
    if (window.CamposMongoUI && window.CamposMongoUI.limpiarFicha) window.CamposMongoUI.limpiarFicha();
    pintarMongo();
    if (reabrirKey) {
      setTimeout(function () {
        abrirFichaColeccion(reabrirKey, { volverA: { tipo: 'catalogo' } });
        seleccionarColReaderTab(reabrirTab);
      }, 0);
      return;
    }
    reabrirAnclaTrasMongoSiProcede();
  });
  const nuevaArchivo = document.getElementById('nuevaArchivo');
  if (nuevaArchivo) nuevaArchivo.addEventListener('change', function (e) {
    nombreDeArchivo(e.target, 'nuevaArchivoNombre');
  });
  const versionArchivo = document.getElementById('versionArchivo');
  if (versionArchivo) versionArchivo.addEventListener('change', function (e) {
    nombreDeArchivo(e.target, 'versionArchivoNombre');
  });
  const btnHistorial = document.getElementById('btnHistorial');
  if (btnHistorial) btnHistorial.addEventListener('click', alternarHistorial);
  const historialLista = document.getElementById('historialLista');
  if (historialLista) historialLista.addEventListener('click', onClickHistorial);
  const btnCerrarSkill = document.getElementById('btnCerrarSkill');
  if (btnCerrarSkill) btnCerrarSkill.addEventListener('click', cerrarSkillModal);
  const btnAtrasSkill = document.getElementById('btnAtrasSkill');
  if (btnAtrasSkill) btnAtrasSkill.addEventListener('click', function () { atrasDesdeFicha(cerrarSkillModal); });
  const btnAtrasCampo = document.getElementById('btnAtrasCampo');
  if (btnAtrasCampo) btnAtrasCampo.addEventListener('click', function () { atrasDesdeFicha(cerrarFichaCampo); });
  const btnAtrasMongo = document.getElementById('btnAtrasMongo');
  if (btnAtrasMongo) btnAtrasMongo.addEventListener('click', function () { atrasDesdeFicha(cerrarFichaMongo); });
  window.addEventListener('popstate', cerrarFichasPorPopstate);
  const btnEditarSkill = document.getElementById('btnEditarSkill');
  if (btnEditarSkill) btnEditarSkill.addEventListener('click', function () {
    if (!state.abiertaId) return;
    abrirDialogoEditar(state.abiertaId);
  });
  const btnSubirSkill = document.getElementById('btnSubirSkill');
  if (btnSubirSkill) btnSubirSkill.addEventListener('click', function () {
    if (!state.abiertaId) return;
    abrirDialogoVersion(state.abiertaId);
  });
  const btnEliminarSkill = document.getElementById('btnEliminarSkill');
  if (btnEliminarSkill) btnEliminarSkill.addEventListener('click', function () {
    if (!state.abiertaId) return;
    abrirDialogoEliminar({ tipo: 'skill', id: state.abiertaId });
  });
  const readerTabs = document.getElementById('readerTabs');
  if (readerTabs) readerTabs.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-reader-tab]');
    if (!btn) return;
    seleccionarReaderTab(btn.getAttribute('data-reader-tab'));
  });
  const editarTabs = document.getElementById('editarTabs');
  if (editarTabs) editarTabs.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-editar-tab]');
    if (!btn) return;
    seleccionarEditarTab(btn.getAttribute('data-editar-tab'));
  });
  const readerHashBtn = document.getElementById('readerHashBtn');
  if (readerHashBtn) readerHashBtn.addEventListener('click', function () {
    const full = readerHashBtn.dataset.hash || '';
    if (!full) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(full).catch(function () {});
    }
  });
  const dlgSkill = document.getElementById('dlgSkill');
  if (dlgSkill) dlgSkill.addEventListener('close', function () {
    state.abiertaId = null;
    state.abiertaNumero = null;
    state.historial = false;
    pintarSkills();
    reabrirAnclaTrasSkillSiProcede();
    reabrirProyectoTrasSkillSiProcede();
  });
  const dlgCampoFicha = document.getElementById('dlgCampoFicha');
  if (dlgCampoFicha) dlgCampoFicha.addEventListener('close', function () {
    if (state.campos.abiertoId || (window.CamposAnclaUI && document.getElementById('campo-ficha-mount').childNodes.length)) {
      state.campos.abiertoId = null;
      if (window.CamposAnclaUI && window.CamposAnclaUI.limpiarFicha) window.CamposAnclaUI.limpiarFicha();
      pintarCampos();
    }
    reabrirMongoTrasAnclaSiProcede();
  });
  document.addEventListener('click', function (e) {
    if (state.historial && !e.target.closest('#historial') && !e.target.closest('#btnHistorial')) cerrarHistorial();
    if (state.historialSkillId && !e.target.closest('.skill-historial') && !e.target.closest('.historial-ancla')) {
      state.historialSkillId = null;
      pintarSkills();
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (state.historialSkillId) {
      e.preventDefault();
      state.historialSkillId = null;
      pintarSkills();
      return;
    }
    const fichaAbierta = FICHA_PANE_IDS.map(function (id) { return document.getElementById(id); })
      .filter(function (d) { return d && d.open; })
      .pop();
    if (fichaAbierta) {
      e.preventDefault();
      fichaAbierta.close();
      syncFichaPaneClass();
      return;
    }
    if (state.historial) {
      e.preventDefault();
      state.historial = false;
      render();
      const boton = document.getElementById('btnHistorial');
      if (boton) boton.focus();
      return;
    }
  });

  FICHA_PANE_IDS.forEach(function (id) {
    const d = document.getElementById(id);
    if (!d) return;
    d.addEventListener('close', syncFichaPaneClass);
  });
  iconizarPestanasFicha();
  render();
  cargarSkills();
  cargarCampos();
  cargarMongo();
  cargarClusters();
  wireClustersUi();
  cargarProyectos();
  wireProyectosUi();
  wireColeccionesUi();
  cargarAgentes();
  wireAgentesUi();
  cargarFundamentos();
  wireFundamentosUi();
  if (window.SystemPromptsCatalog) {
    window.SystemPromptsCatalog.wire();
    window.SystemPromptsCatalog.cargar();
  }
  if (window.EjecutoresCatalog) {
    window.EjecutoresCatalog.wire();
    window.EjecutoresCatalog.cargar();
  }
}

function cargarSkillsDesdeSeed() {
  return fetch('catalogo/skills/index.json', { cache: 'no-store' })
    .then(function (res) {
      if (!res.ok) throw new Error('http');
      return res.json();
    })
    .then(function (data) {
      state.remotas = normalizeIndice(data);
      state.indexError = false;
    });
}

function cargarSkills() {
  apiFetch('/v1/skills')
    .then(function (data) {
      state.remotas = normalizeIndice(data);
      state.indexError = false;
    })
    .catch(function () {
      return cargarSkillsDesdeSeed();
    })
    .catch(function () {
      state.remotas = [];
      state.indexError = true;
    })
    .then(function () {
      state.ready = true;
      render();
    });
}

function normalizarSkillsProyecto(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  list.forEach(function (raw) {
    const id = String(raw || '').trim();
    if (!id || !/^[a-z0-9][a-z0-9-]{0,60}$/i.test(id)) return;
    const key = id.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(id);
  });
  return out;
}

function normalizarColeccionesProyecto(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  list.forEach(function (c) {
    if (!c || typeof c !== 'object') return;
    const id = typeof c.id === 'string' ? c.id.trim() : '';
    if (!id || seen.has(id)) return;
    seen.add(id);
    const row = {
      id: id,
      descripcion: typeof c.descripcion === 'string' ? c.descripcion.trim() : ''
    };
    attachEntityColor(row, c);
    out.push(row);
  });
  return out;
}

function normalizeProyecto(item, versionFn) {
  if (!item || typeof item !== 'object') return null;
  if (typeof item.id !== 'string' || !item.id.trim()) return null;
  if (typeof item.nombre !== 'string' || !item.nombre.trim()) return null;
  if (!Array.isArray(item.versiones)) return null;
  const versiones = versionesUnicas(item.versiones.map(versionFn).filter(Boolean));
  if (!versiones.length) return null;
  const out = {
    id: item.id.trim(),
    nombre: item.nombre.trim(),
    versiones: versiones,
    skills: normalizarSkillsProyecto(item.skills),
    baseDatos: typeof item.baseDatos === 'string' ? item.baseDatos.trim() : '',
    colecciones: normalizarColeccionesProyecto(item.colecciones),
    relaciones: Array.isArray(item.relaciones) ? item.relaciones.slice() : [],
    agentes: Array.isArray(item.agentes)
      ? item.agentes.map(function (a) { return String(a || '').trim(); }).filter(Boolean)
      : [],
    clusterId: String(item.clusterId || item.cluster_id || '').trim() || null,
    legacyNegocio: !!(item.legacyNegocio === true || item.legacyNegocio === 1 || item.legacy_negocio === 1)
  };
  if (typeof item.descripcion === 'string' && item.descripcion.trim()) {
    out.descripcion = item.descripcion.trim().slice(0, 280);
  }
  attachEntityColor(out, item);
  return out;
}

function normalizeProyectosIndice(data) {
  const list = Array.isArray(data) ? data : (data && Array.isArray(data.proyectos) ? data.proyectos : []);
  const out = [];
  const seen = new Set();
  list.forEach(function (item) {
    const proy = normalizeProyecto(item, normalizeVersionIndice);
    if (!proy || seen.has(proy.id)) return;
    seen.add(proy.id);
    proy.origen = 'indice';
    out.push(proy);
  });
  return out;
}

function normalizeProyectosLocales(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  list.forEach(function (item) {
    const proy = normalizeProyecto(item, normalizeVersionLocal);
    if (!proy || seen.has(proy.id)) return;
    seen.add(proy.id);
    proy.origen = 'local';
    out.push(proy);
  });
  return out;
}

/** Fusiona colecciones del merge sin dropear `color` si la fuente lo omite. */
function fusionarColeccionesMeta(prevCols, nextCols) {
  const prevMap = new Map();
  (prevCols || []).forEach(function (c) {
    if (c && c.id) prevMap.set(c.id, c);
  });
  return (nextCols || []).map(function (c) {
    if (!c || !c.id) return c;
    const row = {
      id: c.id,
      descripcion: typeof c.descripcion === 'string' ? c.descripcion : ''
    };
    if (Object.prototype.hasOwnProperty.call(c, 'color')) {
      attachEntityColor(row, c);
    } else {
      const prev = prevMap.get(c.id);
      if (prev) attachEntityColor(row, prev);
    }
    return row;
  });
}

function conMetaProyecto(destino, fuente) {
  if (fuente.descripcion) destino.descripcion = fuente.descripcion;
  destino.skills = Array.isArray(fuente.skills) ? fuente.skills.slice() : [];
  if (typeof fuente.baseDatos === 'string') destino.baseDatos = fuente.baseDatos;
  if (Array.isArray(fuente.colecciones)) {
    destino.colecciones = fusionarColeccionesMeta(destino.colecciones, fuente.colecciones);
  }
  if (Array.isArray(fuente.relaciones)) destino.relaciones = fuente.relaciones.slice();
  if (Array.isArray(fuente.agentes)) destino.agentes = fuente.agentes.slice();
  if (fuente.clusterId != null || fuente.cluster_id != null) {
    destino.clusterId = String(fuente.clusterId || fuente.cluster_id || '').trim() || null;
  }
  if (fuente.legacyNegocio != null) destino.legacyNegocio = !!fuente.legacyNegocio;
  copiarColorMeta(destino, fuente);
  return destino;
}

function mergeProyectos(remotas, locales, eliminados) {
  const ban = new Set(Array.isArray(eliminados) ? eliminados : []);
  const map = new Map();
  remotas.forEach(function (proy) {
    if (ban.has(proy.id)) return;
    map.set(proy.id, conMetaProyecto({
      id: proy.id,
      nombre: proy.nombre,
      origen: 'indice',
      versiones: proy.versiones.map(copiaVersion)
    }, proy));
  });
  locales.forEach(function (proy) {
    if (ban.has(proy.id)) return;
    const prev = map.get(proy.id);
    if (!prev) {
      map.set(proy.id, conMetaProyecto({
        id: proy.id,
        nombre: proy.nombre,
        origen: 'local',
        versiones: proy.versiones.map(copiaVersion)
      }, proy));
      return;
    }
    prev.nombre = proy.nombre || prev.nombre;
    conMetaProyecto(prev, proy);
    const nums = new Map();
    prev.versiones.forEach(function (v) { nums.set(v.numero, v); });
    proy.versiones.forEach(function (v) { nums.set(v.numero, copiaVersion(v)); });
    prev.versiones = Array.from(nums.values()).sort(function (a, b) { return a.numero - b.numero; });
  });
  return Array.from(map.values()).sort(function (a, b) {
    return a.nombre.localeCompare(b.nombre, 'es');
  });
}

function leerProyectosStore() {
  try {
    const raw = localStorage.getItem(LS_PROYECTOS);
    if (!raw) return { proyectos: [], eliminados: [] };
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.proyectos)) return { proyectos: [], eliminados: [] };
    return { proyectos: data.proyectos, eliminados: idsEliminados(data.eliminados) };
  } catch (e) {
    return { proyectos: [], eliminados: [] };
  }
}

function guardarProyectosLocal(store) {
  const json = JSON.stringify(store);
  if (json.length > 4500000) throw new Error('No cabe en el almacenamiento de este navegador.');
  try {
    localStorage.setItem(LS_PROYECTOS, json);
  } catch (e) {
    throw new Error('No cabe en el almacenamiento de este navegador.');
  }
}

function refrescarProyectos() {
  const store = leerProyectosStore();
  state.proyectos.lista = mergeProyectos(
    state.proyectos.remotos,
    normalizeProyectosLocales(store.proyectos),
    store.eliminados
  );
}

function proyectosBridge() {
  return {
    getSnapshot: function () {
      const abierta = state.proyectos.abiertoId
        ? state.proyectos.lista.find(function (p) { return p.id === state.proyectos.abiertoId; }) || null
        : null;
      const abiertaVersion = abierta
        ? (abierta.versiones.find(function (v) { return v.numero === state.proyectos.abiertaNumero; }) || versionActual(abierta))
        : null;
      return {
        ready: state.proyectos.ready,
        indexError: state.proyectos.indexError,
        proyectos: state.proyectos.lista,
        abierta: abierta ? { id: abierta.id, version: abiertaVersion } : null
      };
    },
    añadirProyecto: function () { abrirDialogoNuevoProyecto(); },
    abrirProyecto: function (id) {
      if (state.proyectos.abiertoId === id) {
        const dlg = document.getElementById('dlgProyecto');
        if (dlg && dlg.open) {
          cerrarProyectoModal();
          return;
        }
      }
      abrirProyecto(id);
    }
  };
}

function pintarProyectos() {
  if (window.ProyectosUI && typeof window.ProyectosUI.refrescar === 'function') {
    window.ProyectosUI.refrescar(proyectosBridge());
  }
}

function proyectoAbierto() {
  if (!state.proyectos.abiertoId) return null;
  return state.proyectos.lista.find(function (p) { return p.id === state.proyectos.abiertoId; }) || null;
}

function versionProyectoAbierta(proy) {
  return proy.versiones.find(function (v) { return v.numero === state.proyectos.abiertaNumero; }) || versionActual(proy);
}

function cerrarProyectoModal() {
  const dlg = document.getElementById('dlgProyecto');
  if (dlg && dlg.open) {
    dlg.close();
    return;
  }
  state.proyectos.abiertoId = null;
  state.proyectos.abiertaNumero = null;
  state.proyectos.historial = false;
  pintarProyectos();
}

function proyAsocSubActivo() {
  return state.proyectos.asocSub || 'cluster';
}

function proyAsociadosVisible() {
  return !!document.querySelector('#proyReaderTabs [data-proy-tab="asociados"].is-on');
}

function seleccionarProyAsocSub(id) {
  if (id !== 'cluster' && id !== 'colecciones' && id !== 'campos' && id !== 'skills') id = 'cluster';
  state.proyectos.asocSub = id;
  const tabs = document.querySelectorAll('#proyAsociadosSubtabs [data-proy-asoc-sub]');
  tabs.forEach(function (btn) {
    const on = btn.getAttribute('data-proy-asoc-sub') === id;
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  document.querySelectorAll('#proyPanelAsociados [data-proy-asoc-pane]').forEach(function (pane) {
    pane.hidden = pane.getAttribute('data-proy-asoc-pane') !== id;
  });
  const proy = proyectoAbierto();
  if (!proy) return;
  if (id === 'cluster') pintarProyectoCluster(proy);
  if (id === 'colecciones') pintarProyectoColecciones(proy);
  if (id === 'campos') pintarProyectoCampos(proy);
  if (id === 'skills') pintarProyectoSkillsTab(proy);
}

function seleccionarProyReaderTab(id) {
  const tabs = document.querySelectorAll('#proyReaderTabs [data-proy-tab]');
  const panels = {
    resumen: document.getElementById('proyPanelResumen'),
    asociados: document.getElementById('proyPanelAsociados'),
    documento: document.getElementById('proyPanelDocumento'),
    diagrama: document.getElementById('proyPanelDiagrama'),
    operativa: document.getElementById('proyPanelOperativa'),
    flujos: document.getElementById('proyPanelFlujos'),
    empujar: document.getElementById('proyPanelEmpujar'),
    historial: document.getElementById('proyPanelHistorial'),
    interno: document.getElementById('proyPanelInterno')
  };
  // Compat: vínculos movidos a Asociados; agentes/conexión ya no son pestaña de BD
  if (id === 'conexion' || id === 'agentes') id = 'resumen';
  if (id === 'sync') id = 'empujar';
  // Corridas cuelgan del Flujo (no pestaña top-level de BD)
  if (id === 'corridas') {
    if (window.FlujosCorridasUI && typeof window.FlujosCorridasUI.irACorridasDesdeOperativa === 'function') {
      window.FlujosCorridasUI.irACorridasDesdeOperativa();
      return;
    }
    id = 'flujos';
  }
  if (id === 'cluster' || id === 'colecciones' || id === 'campos' || id === 'skills') {
    state.proyectos.asocSub = id;
    id = 'asociados';
  }
  tabs.forEach(function (btn) {
    const on = btn.getAttribute('data-proy-tab') === id;
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  Object.keys(panels).forEach(function (key) {
    if (panels[key]) panels[key].hidden = key !== id;
  });
  const proy = proyectoAbierto();
  if (!proy) return;
  if (id === 'asociados') seleccionarProyAsocSub(proyAsocSubActivo());
  if (id === 'documento') pintarVersionProyecto(versionProyectoAbierta(proy));
  if (id === 'diagrama') cargarProyectoDiagrama(proy);
  if (id === 'operativa') cargarProyectoOperativa(proy);
  if (id === 'flujos') {
    if (window.FlujosCorridasUI && typeof window.FlujosCorridasUI.cargarFlujos === 'function') {
      window.FlujosCorridasUI.cargarFlujos(proy);
    }
  }
  if (id === 'empujar') pintarProyectoEmpujarAuto(proy);
  if (id === 'historial') cargarProyectoHistorialEmpujes(proy, { reset: true });
}

window.seleccionarProyReaderTab = seleccionarProyReaderTab;
window.seleccionarCatalogo = seleccionarCatalogo;
window.abrirProyecto = abrirProyecto;

function cargarProyectoOperativa(proy) {
  const estado = document.getElementById('proyOperativaEstado');
  const render = document.getElementById('proyOperativaRender');
  const huecosEl = document.getElementById('proyOperativaHuecos');
  if (!proy || !proy.id) return;
  if (estado) {
    estado.hidden = false;
    estado.textContent = 'Cargando operativa…';
  }
  if (render) {
    render.hidden = true;
    render.replaceChildren();
  }
  if (huecosEl) {
    huecosEl.hidden = true;
    huecosEl.replaceChildren();
  }
  apiFetch('/v1/proyectos/' + encodeURIComponent(proy.id) + '/operativa')
    .then(function (data) {
      if (!data || !data.ok) throw new Error((data && data.error) || 'Sin operativa');
      if (estado) estado.hidden = true;
      if (render) {
        render.hidden = false;
        renderMermaidEn(render, data.mermaid || 'flowchart LR\n  vacio["Sin skills"]');
      }
      const huecos = data.huecos || [];
      if (huecosEl) {
        if (huecos.length) {
          huecosEl.hidden = false;
          const mkFila = typeof filaCatalogoLista === 'function' ? filaCatalogoLista : null;
          huecos.forEach(function (h) {
            let row;
            if (mkFila) {
              row = mkFila({
                icono: 'errores',
                titulo: String(h),
                secundario: 'Entrada sin productor',
                static: true,
                title: 'Entrada sin productor: ' + h
              });
              row.classList.add('is-warn');
            } else {
              row = document.createElement('div');
              row.className = 'catalogo-fila catalogo-fila-static is-warn';
              row.textContent = 'Entrada sin productor: ' + h;
            }
            huecosEl.append(row);
          });
        } else {
          huecosEl.hidden = true;
        }
      }
      const linkEl = document.getElementById('proyOperativaFlujosLink');
      if (linkEl) linkEl.hidden = false;
    })
    .catch(function (err) {
      if (estado) {
        estado.hidden = false;
        estado.textContent = (err && err.message) || 'No se pudo cargar la operativa.';
      }
    });
}

function seleccionarEditarProyTab(id) {
  const tabs = document.querySelectorAll('#editarProyTabs [data-editar-proy-tab]');
  const panelDoc = document.getElementById('editarProyPanelDoc');
  const panelSkills = document.getElementById('editarProyPanelSkills');
  tabs.forEach(function (btn) {
    const on = btn.getAttribute('data-editar-proy-tab') === id;
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  if (panelDoc) panelDoc.hidden = id !== 'documento';
  if (panelSkills) panelSkills.hidden = id !== 'skills';
}

function pintarVersionProyecto(v) {
  const md = document.getElementById('proyMd');
  if (!md) return;
  if (typeof v.markdown === 'string') {
    md.innerHTML = htmlDeMarkdown(v.markdown);
    return;
  }
  if (!v.ruta) {
    md.textContent = 'No hay documento para esta versión.';
    return;
  }
  if (mdCache.has(v.ruta)) {
    md.innerHTML = htmlDeMarkdown(mdCache.get(v.ruta));
    return;
  }
  if (state.proyectos.inflightRuta === v.ruta) {
    md.textContent = 'Cargando…';
    return;
  }
  state.proyectos.inflightRuta = v.ruta;
  const token = ++state.proyectos.fetchToken;
  const ruta = v.ruta;
  md.textContent = 'Cargando…';
  let url;
  try { url = hrefRuta(ruta); } catch (e) {
    state.proyectos.inflightRuta = null;
    md.textContent = 'No se pudo leer el markdown de esta versión.';
    return;
  }
  fetch(url, { cache: 'no-store' })
    .then(function (res) {
      if (!res.ok) throw new Error('http');
      return res.text();
    })
    .then(function (text) {
      if (token !== state.proyectos.fetchToken) return;
      mdCache.set(ruta, text);
      if (state.proyectos.inflightRuta === ruta) state.proyectos.inflightRuta = null;
      const actual = proyectoAbierto();
      if (!actual) return;
      const abierta = versionProyectoAbierta(actual);
      if (!abierta || abierta.ruta !== ruta) return;
      const box = document.getElementById('proyMd');
      if (box) box.innerHTML = htmlDeMarkdown(text);
    })
    .catch(function () {
      if (token !== state.proyectos.fetchToken) return;
      if (state.proyectos.inflightRuta === ruta) state.proyectos.inflightRuta = null;
      const box = document.getElementById('proyMd');
      if (box) box.textContent = 'No se pudo leer el markdown de esta versión.';
    });
}

function renderHistorialProyecto(proy, abierta) {
  const pop = document.getElementById('historialProyecto');
  const lista = document.getElementById('historialProyectoLista');
  const btn = document.getElementById('btnHistorialProyecto');
  if (!pop || !lista || !btn) return;
  pop.hidden = !state.proyectos.historial;
  btn.setAttribute('aria-expanded', state.proyectos.historial ? 'true' : 'false');
  lista.replaceChildren();
  const orden = (proy.versiones || []).slice().sort(function (a, b) { return b.numero - a.numero; });
  orden.forEach(function (v) {
    const li = document.createElement('li');
    const b = el('button', null, '');
    b.type = 'button';
    b.dataset.numero = String(v.numero);
    const marca = v.numero === abierta.numero;
    if (marca) b.setAttribute('aria-current', 'true');
    b.append(el('span', null, formatVersion(v.numero, v.fecha)));
    if (marca) b.append(el('span', 'marca', 'Abierta'));
    li.append(b);
    lista.append(li);
  });
}

function renderProyectoReader() {
  const dlg = document.getElementById('dlgProyecto');
  const proy = proyectoAbierto();
  if (!proy) {
    state.proyectos.abiertoId = null;
    state.proyectos.abiertaNumero = null;
    state.proyectos.historial = false;
    const lista = document.getElementById('proySkillsTabLista');
    if (lista) lista.replaceChildren();
    if (dlg && dlg.open) dlg.close();
    return;
  }
  const v = versionProyectoAbierta(proy);
  state.proyectos.abiertaNumero = v.numero;
  document.getElementById('proyReaderNombre').textContent = proy.nombre;
  document.getElementById('proyReaderVersion').textContent = formatVersion(v.numero, v.fecha);
  const proyId = document.getElementById('proyReaderId');
  if (proyId) proyId.textContent = proy.id || '—';
  const baseEl = document.getElementById('proyReaderBaseDatos');
  if (baseEl) baseEl.textContent = proy.baseDatos || '—';
  const legacyFila = document.getElementById('proyLegacyFila');
  if (legacyFila) legacyFila.hidden = !proy.legacyNegocio;
  const msgBd = document.getElementById('proyCrearBdMsg');
  if (msgBd) {
    msgBd.hidden = true;
    msgBd.textContent = '';
    msgBd.classList.remove('is-err');
  }
  const planBd = document.getElementById('proyEmpujarPlan');
  if (planBd) {
    planBd.hidden = true;
    planBd.replaceChildren();
  }
  const sinOps = !!proy.legacyNegocio || !proy.baseDatos;
  const btnCrear = document.getElementById('btnCrearBdProyecto');
  if (btnCrear) btnCrear.hidden = sinOps;
  const btnEmpujarTab = document.getElementById('btnEmpujarEsquemaTab');
  if (btnEmpujarTab) btnEmpujarTab.hidden = sinOps;
  const proyVer = document.getElementById('proyInternoVersion');
  if (proyVer) proyVer.textContent = formatVersion(v.numero, v.fecha);
  const full = normalizarHash(v.hash) || hashFnvHex(proy.id + '|' + v.numero + '|' + (v.ruta || v.fecha || ''));
  const hashBtn = document.getElementById('proyHashBtn');
  const hashFull = document.getElementById('proyHashFull');
  const hashVacio = document.getElementById('proyHashVacio');
  if (hashBtn && hashFull && hashVacio) {
    if (full) {
      hashFull.textContent = full;
      hashBtn.hidden = false;
      hashBtn.dataset.hash = full;
      hashVacio.hidden = true;
    } else {
      hashBtn.hidden = true;
      hashBtn.dataset.hash = '';
      hashVacio.hidden = false;
    }
  }
  seleccionarProyReaderTab('resumen');
  pintarVersionProyecto(v);
  renderHistorialProyecto(proy, v);
  openFichaPane(dlg);
  cablearColorFicha(dlg, {
    kind: 'proyecto',
    id: proy.id,
    iconKind: 'proyecto',
    getColor: function () { return proy.color; },
    onSaved: function (hex) { proy.color = hex; }
  });
  const nombre = document.getElementById('proyReaderNombre');
  if (nombre) nombre.focus();
}


function pintarProyectoDiagramaColecciones(proy, colsDiagrama) {
  const lista = document.getElementById('proyDiagramaColeccionesLista');
  if (!lista) return;
  lista.replaceChildren();
  const defs = Array.isArray(proy.colecciones) ? proy.colecciones : [];
  const fromApi = Array.isArray(colsDiagrama) ? colsDiagrama : [];
  const byId = {};
  fromApi.forEach(function (c) {
    if (c && c.id) byId[c.id] = c;
  });
  const ids = [];
  const seen = {};
  defs.forEach(function (c) {
    const id = c && c.id ? String(c.id) : '';
    if (!id || seen[id]) return;
    seen[id] = true;
    ids.push(id);
  });
  fromApi.forEach(function (c) {
    const id = c && c.id ? String(c.id) : '';
    if (!id || seen[id]) return;
    seen[id] = true;
    ids.push(id);
  });
  if (!ids.length) {
    const vacio = el('p', 'ancla-ficha-vacio', 'Sin colecciones en esta base.');
    vacio.style.margin = '0';
    lista.append(vacio);
    return;
  }
  ids.forEach(function (colId) {
    const def = defs.find(function (c) { return c && c.id === colId; }) || null;
    const apiCol = byId[colId] || null;
    const nCampos = apiCol && Array.isArray(apiCol.campos) ? apiCol.campos.length : null;
    const desc = def && def.descripcion ? String(def.descripcion).trim() : '';
    let sub = '';
    if (nCampos != null) sub = nCampos === 1 ? '1 campo' : (nCampos + ' campos');
    if (desc) sub = sub ? (desc + ' · ' + sub) : desc;
    if (!sub) sub = 'Colección';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'col-diagrama-campo col-diagrama-campo-con-icono';
    btn.setAttribute('role', 'listitem');
    btn.title = 'Abrir colección ' + colId;
    btn.setAttribute('aria-label', btn.title);
    // Mismo Lucide layers que catálogo Colecciones / ficha / svgPestanaCatalogo('coleccion').
    const iconWrap = el('span', 'catalogo-fila-icon', null);
    iconWrap.setAttribute('aria-hidden', 'true');
    const svg = svgPestanaCatalogo('coleccion');
    svg.setAttribute('class', 'catalogo-fila-svg');
    iconWrap.append(svg);
    const texto = el('span', 'col-diagrama-campo-texto', null);
    texto.append(el('span', 'col-diagrama-campo-clave', colId));
    texto.append(el('span', 'col-diagrama-campo-tipo', sub));
    btn.append(iconWrap, texto);
    btn.addEventListener('click', function () {
      const key = claveColeccion(proy.id, colId);
      abrirFichaColeccion(key, {
        volverA: { tipo: 'proyecto', id: proy.id, tab: 'diagrama' }
      });
    });
    lista.append(btn);
  });
}

function cargarProyectoDiagrama(proy) {
  const estado = document.getElementById('proyDiagramaEstado');
  const render = document.getElementById('proyDiagramaRender');
  const split = document.getElementById('proyDiagramaSplit');
  const lista = document.getElementById('proyDiagramaColeccionesLista');
  if (!proy || !proy.id) return;
  if (estado) {
    estado.hidden = false;
    estado.textContent = 'Cargando diagrama…';
  }
  if (split) split.hidden = true;
  if (render) render.replaceChildren();
  if (lista) lista.replaceChildren();
  apiFetch('/v1/proyectos/' + encodeURIComponent(proy.id) + '/diagrama')
    .then(function (data) {
      const abierta = proyectoAbierto();
      if (!abierta || abierta.id !== proy.id) return;
      const tabOn = document.querySelector('#proyReaderTabs [data-proy-tab="diagrama"].is-on');
      if (!tabOn) return;
      const d = data && data.diagrama ? data.diagrama : data;
      if (!d) throw new Error('sin diagrama');
      const cols = d.colecciones || [];
      if (!cols.length && !(proy.colecciones && proy.colecciones.length)) {
        if (estado) {
          estado.hidden = false;
          estado.textContent = proy.legacyNegocio
            ? 'Este proyecto no tiene colecciones (¿negocio legado?).'
            : 'No hay entidades para dibujar.';
        }
        return;
      }
      if (estado) estado.hidden = true;
      if (split) split.hidden = false;
      pintarProyectoDiagramaColecciones(proy, cols);
      if (render) {
        renderMermaidEn(render, d.mermaid || 'erDiagram\n');
      }
    })
    .catch(function () {
      const abierta = proyectoAbierto();
      if (!abierta || abierta.id !== proy.id) return;
      if (split) split.hidden = true;
      if (estado) {
        estado.hidden = false;
        estado.textContent = proy.colecciones && proy.colecciones.length
          ? 'No se pudo cargar el diagrama desde la API.'
          : 'Este proyecto no tiene colecciones (¿negocio legado?).';
      }
    });
}

function pintarProyectoColecciones(proy) {
  const mount = document.getElementById('proyColeccionesLista');
  if (!mount || !proy || !window.ProyectosUI || !window.ProyectosUI.montarColecciones) return;
  const cols = Array.isArray(proy.colecciones) ? proy.colecciones : [];
  const emptyMsg = proy.legacyNegocio
    ? 'Esta entrada no define colecciones (legado).'
    : 'Sin colecciones en esta base de datos.';

  function render(conteo) {
    const abierta = proyectoAbierto();
    if (!abierta || abierta.id !== proy.id) return;
    window.ProyectosUI.montarColecciones(mount, {
      colecciones: cols,
      conteo: conteo || {},
      emptyMsg: emptyMsg,
      onAbrir: function (coleccionId) {
        const key = claveColeccion(proy.id, coleccionId);
        abrirFichaColeccion(key, { volverA: { tipo: 'proyecto', id: proy.id } });
      }
    });
  }

  render({});
  if (proy.legacyNegocio || !proy.id || !cols.length) return;
  apiFetch('/v1/mongo?proyecto=' + encodeURIComponent(proy.id))
    .then(function (data) {
      const campos = (data && data.campos) || [];
      const conteo = {};
      campos.forEach(function (c) {
        const k = c && c.coleccion ? String(c.coleccion) : '';
        if (!k) return;
        conteo[k] = (conteo[k] || 0) + 1;
      });
      const tabOn = proyAsociadosVisible() && proyAsocSubActivo() === 'colecciones';
      if (!tabOn) return;
      render(conteo);
    })
    .catch(function () { /* conteo opcional */ });
}

function pintarProyectoCampos(proy) {
  const mount = document.getElementById('proyCamposLista');
  if (!mount || !proy || !window.CamposMongoUI || !window.CamposMongoUI.montarLista) return;

  function bridgeCon(campos, ready, indexError) {
    return {
      getSnapshot: function () {
        return {
          ready: ready,
          indexError: !!indexError,
          campos: campos || [],
          abierta: null
        };
      },
      abrirCampo: function (id) { abrirFichaMongo(id); },
      añadirCampo: function () {}
    };
  }

  window.CamposMongoUI.montarLista(mount, bridgeCon([], false, false), {
    emptyMsg: 'Cargando campos…'
  });

  if (proy.legacyNegocio) {
    window.CamposMongoUI.montarLista(mount, bridgeCon([], true, false), {
      emptyMsg: 'Sin campos Mongo en esta base de datos.'
    });
    return;
  }

  apiFetch('/v1/mongo?proyecto=' + encodeURIComponent(proy.id))
    .then(function (data) {
      const abierta = proyectoAbierto();
      if (!abierta || abierta.id !== proy.id) return;
      const tabOn = proyAsociadosVisible() && proyAsocSubActivo() === 'campos';
      if (!tabOn) return;
      const raw = (data && data.campos) || [];
      const campos = raw.map(normalizeMongoCampo).filter(Boolean);
      window.CamposMongoUI.montarLista(mount, bridgeCon(campos, true, false), {
        emptyMsg: 'Sin campos Mongo en esta base de datos.'
      });
    })
    .catch(function () {
      const abierta = proyectoAbierto();
      if (!abierta || abierta.id !== proy.id) return;
      window.CamposMongoUI.montarLista(mount, bridgeCon([], true, true), {
        emptyMsg: 'No se pudieron cargar los campos.'
      });
    });
}

/** Pestaña Skills de Base de datos: mismas filas que el catálogo Skills (proyecto_skills N:M). */
function pintarProyectoSkillsTab(proy) {
  const mount = document.getElementById('proySkillsTabLista');
  if (!mount || !proy || !window.SkillsUI || !window.SkillsUI.montarLista) return;
  const ids = Array.isArray(proy.skills) ? proy.skills : [];

  function bridgeCon(instrucciones, ready, indexError) {
    return {
      getSnapshot: function () {
        return {
          ready: ready,
          indexError: !!indexError,
          instrucciones: instrucciones || [],
          abierta: null
        };
      },
      abrirSkill: function (id) { abrirVistaSkill(id); },
      añadirSkill: function () {}
    };
  }

  window.SkillsUI.montarLista(mount, bridgeCon([], false, false), {
    emptyMsg: 'Cargando skills…'
  });

  const lista = (state.instrucciones || []).filter(function (ins) {
    return ids.indexOf(ins.id) >= 0;
  });
  if (state.ready) {
    window.SkillsUI.montarLista(mount, bridgeCon(lista, true, false), {
      emptyMsg: 'Ninguna skill asociada.'
    });
    return;
  }

  apiFetch('/v1/skills')
    .then(function (data) {
      const abierta = proyectoAbierto();
      if (!abierta || abierta.id !== proy.id) return;
      const tabOn = proyAsociadosVisible() && proyAsocSubActivo() === 'skills';
      if (!tabOn) return;
      const todos = normalizeIndice(data);
      const filtrados = todos.filter(function (ins) {
        return ins && ids.indexOf(ins.id) >= 0;
      });
      window.SkillsUI.montarLista(mount, bridgeCon(filtrados, true, false), {
        emptyMsg: 'Ninguna skill asociada.'
      });
    })
    .catch(function () {
      const abierta = proyectoAbierto();
      if (!abierta || abierta.id !== proy.id) return;
      window.SkillsUI.montarLista(mount, bridgeCon(lista, true, !lista.length), {
        emptyMsg: lista.length ? 'Ninguna skill asociada.' : 'No se pudieron cargar las skills.'
      });
    });
}

function formatearLastSync(ls) {
  if (!ls || !ls.at) return '';
  const parts = [];
  parts.push(ls.auto ? 'Último sync automático' : 'Último empujón');
  parts.push(ls.at);
  if (ls.proyecto) parts.push('base ' + ls.proyecto);
  if (ls.dryRun || ls.mock) parts.push('simulación (sin URI o dry-run)');
  else if (ls.ok) parts.push('ok');
  else parts.push('error');
  if (ls.db) parts.push(ls.db);
  if (ls.error) parts.push(ls.error);
  else if (ls.hint) parts.push(ls.hint);
  return parts.join(' · ');
}

function pintarLastSyncEl(el, ls) {
  if (!el) return;
  const text = formatearLastSync(ls);
  if (!text) {
    el.hidden = true;
    el.textContent = '';
    el.classList.remove('is-ok', 'is-err');
    return;
  }
  el.hidden = false;
  el.textContent = text;
  el.classList.toggle('is-err', ls && ls.ok === false && !(ls.dryRun || ls.mock));
  el.classList.toggle('is-ok', !!(ls && ls.ok && !(ls.dryRun || ls.mock)));
}

function pintarProyectoEmpujarAuto(proy) {
  const nota = document.getElementById('proyEmpujarAutoNota');
  const lastEl = document.getElementById('proyEmpujarLastSync');
  if (!proy) {
    if (nota) nota.hidden = true;
    if (lastEl) {
      lastEl.hidden = true;
      lastEl.textContent = '';
    }
    return;
  }
  const cid = proy.clusterId ? String(proy.clusterId) : '';
  const cl = cid
    ? (state.clusters.lista || []).find(function (c) { return c.id === cid; })
    : null;
  const autoOn = !!(cl && cl.autoSync);
  if (nota) {
    if (autoOn) {
      nota.hidden = false;
      nota.textContent = 'Sincronizar al guardar está activo en el Cluster «'
        + (cl.nombre || cl.id)
        + '». Los cambios de campos/colecciones/relaciones empujan el DDL a Atlas solos (con retardo). Empujar manual sigue disponible.';
    } else {
      nota.hidden = true;
      nota.textContent = '';
    }
  }
  if (cl && cl.lastSync) {
    pintarLastSyncEl(lastEl, cl.lastSync);
  } else if (cid) {
    fetch(apiBaseUrl() + '/v1/clusters/' + encodeURIComponent(cid) + '/mongo-config', { cache: 'no-store' })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        const abierta = proyectoAbierto();
        if (!abierta || abierta.id !== proy.id) return;
        if (data && data.lastSync) pintarLastSyncEl(lastEl, data.lastSync);
        else if (lastEl) {
          lastEl.hidden = true;
          lastEl.textContent = '';
        }
        if (nota && data && data.autoSync) {
          nota.hidden = false;
          nota.textContent = 'Sincronizar al guardar está activo en el Cluster. Los cambios de esquema empujan el DDL a Atlas solos (con retardo). Empujar manual sigue disponible.';
        }
      })
      .catch(function () {});
  } else if (lastEl) {
    lastEl.hidden = true;
    lastEl.textContent = '';
  }
}

function pintarPlanEmpujarEsquema(data, proy) {
  const planEl = document.getElementById('proyEmpujarPlan');
  const msg = document.getElementById('proyCrearBdMsg');
  if (!planEl) return;
  planEl.hidden = false;
  planEl.replaceChildren();

  const plan = (data && data.plan) || null;
  const cols = plan && Array.isArray(plan.collections) ? plan.collections : [];
  const titulo = document.createElement('p');
  titulo.className = 'historial-titulo';
  const dry = !!(data && (data.mock || data.dryRun));
  titulo.textContent = dry
    ? 'Plan (simulación — sin URI o dry-run)'
    : 'Resultado del empujón';
  planEl.append(titulo);

  if (dry && data && data.hint) {
    const hint = document.createElement('p');
    hint.className = 'ajustes-hint';
    hint.textContent = data.hint;
    planEl.append(hint);
  }

  const meta = document.createElement('p');
  meta.className = 'ajustes-hint';
  meta.textContent = 'Base: ' + ((data && data.db) || (proy && proy.baseDatos) || '—')
    + (cols.length ? (' · ' + cols.length + (cols.length === 1 ? ' colección' : ' colecciones')) : '');
  planEl.append(meta);

  if (cols.length) {
    const lista = document.createElement('div');
    lista.className = 'proy-tab-catalogo catalogo-lista';
    lista.setAttribute('role', 'list');
    const mkFila = typeof filaCatalogoLista === 'function' ? filaCatalogoLista : null;
    cols.forEach(function (c) {
      const nIdx = Array.isArray(c.indexes) ? c.indexes.length : 0;
      const hasVal = !!(c.validator && (c.validator.$jsonSchema || c.validator));
      const sec = (hasVal ? 'validator' : 'sin validator')
        + (nIdx ? (' · ' + nIdx + (nIdx === 1 ? ' índice' : ' índices')) : ' · sin índices');
      if (mkFila) {
        lista.append(mkFila({
          icono: 'coleccion',
          titulo: c.id || '—',
          secundario: sec,
          static: true
        }));
      } else {
        const li = document.createElement('div');
        li.className = 'catalogo-fila catalogo-fila-static';
        li.textContent = (c.id || '—') + ' · ' + sec;
        lista.append(li);
      }
    });
    planEl.append(lista);
  }

  if (!dry) {
    const created = Array.isArray(data.created) ? data.created : [];
    const updated = Array.isArray(data.updated) ? data.updated : [];
    const errors = Array.isArray(data.errors) ? data.errors : [];
    const res = document.createElement('dl');
    res.className = 'ancla-ficha-dl';
    function fila(label, val) {
      const wrap = document.createElement('div');
      wrap.className = 'ancla-ficha-fila';
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = val;
      wrap.append(dt, dd);
      res.append(wrap);
    }
    fila('Creadas', created.length ? created.join(', ') : 'ninguna');
    fila('Actualizadas', updated.length ? updated.join(', ') : 'ninguna');
    if (errors.length) fila('Errores', errors.map(function (e) {
      return typeof e === 'string' ? e : (e && e.message) || JSON.stringify(e);
    }).join('; '));
    planEl.append(res);
  }

  if (msg) {
    msg.hidden = false;
    msg.classList.toggle('is-err', !!(data && data.errors && data.errors.length));
    if (dry) {
      msg.textContent = 'Simulación lista. Configura la URI en Cluster → Conexión y vuelve a empujar para aplicar en Atlas.';
    } else if (data && data.errors && data.errors.length) {
      msg.textContent = 'Empujón con errores. Revisa el detalle abajo.';
    } else {
      msg.textContent = 'Esquema empujado a ' + ((data && data.db) || '') + '.';
    }
  }
}

async function onCrearBaseDatosProyecto() {
  const proy = proyectoAbierto();
  const msg = document.getElementById('proyCrearBdMsg');
  const planEl = document.getElementById('proyEmpujarPlan');
  const btn = document.getElementById('btnCrearBdProyecto');
  const btnTab = document.getElementById('btnEmpujarEsquemaTab');
  if (!proy || !proy.id) return;
  seleccionarProyReaderTab('empujar');
  if (planEl) {
    planEl.hidden = true;
    planEl.replaceChildren();
  }
  if (msg) {
    msg.hidden = false;
    msg.classList.remove('is-err', 'api-error-raw', 'is-ok');
    msg.textContent = 'Empujando esquema…';
  }
  if (btn) btn.disabled = true;
  if (btnTab) btnTab.disabled = true;
  try {
    await asegurarClaveCatalogo();
    const data = await apiFetchAuth('/v1/proyectos/' + encodeURIComponent(proy.id) + '/crear-bd', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    if (!data || data.ok === false) throw new Error((data && data.error) || 'Error');
    pintarPlanEmpujarEsquema(data, proy);
    state.proyectos.empujes.token += 1;
  } catch (err) {
    if (msg) {
      msg.classList.remove('is-ok');
      showApiErrorRaw(msg, err, { kind: 'is-err', statusLabel: true });
    }
    state.proyectos.empujes.token += 1;
  } finally {
    if (btn) btn.disabled = false;
    if (btnTab) btnTab.disabled = false;
  }
}

function datetimeLocalToIso(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString();
}

function formatEmpujeCuando(ts) {
  const s = String(ts || '').trim();
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  try {
    return d.toLocaleString('es-ES', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  } catch (e) {
    return s;
  }
}

function labelEmpujeModo(modo) {
  if (modo === 'auto') return 'auto';
  if (modo === 'dry-run') return 'dry-run';
  return 'real';
}

function pintarProyectoHistorialTabla() {
  const lista = document.getElementById('proyHistorialLista');
  const vacio = document.getElementById('proyHistorialEstadoMsg');
  const pager = document.getElementById('proyHistorialPager');
  const btnMas = document.getElementById('btnProyHistorialMas');
  const detalle = document.getElementById('proyHistorialDetalle');
  const st = state.proyectos.empujes;
  if (!lista) return;
  lista.replaceChildren();
  const items = st.items || [];
  if (!items.length) {
    lista.hidden = true;
    if (vacio && !st.loading) {
      vacio.hidden = false;
      vacio.textContent = 'Sin empujes todavía para esta base.';
    }
  } else {
    lista.hidden = false;
    if (vacio) vacio.hidden = true;
    const mkFila = typeof filaCatalogoLista === 'function' ? filaCatalogoLista : null;
    items.forEach(function (e) {
      const abierto = st.openId === e.id;
      const secundario = labelEmpujeModo(e.modo)
        + ' · '
        + (e.ok ? 'ok' : 'error')
        + (e.resumen ? ' · ' + e.resumen : '');
      let row;
      if (mkFila) {
        row = mkFila({
          icono: 'historial',
          titulo: formatEmpujeCuando(e.ts),
          secundario: secundario,
          open: abierto,
          title: e.resumen || formatEmpujeCuando(e.ts),
          ariaLabel: 'Empuje ' + formatEmpujeCuando(e.ts),
          dataset: { empujeId: e.id },
          onClick: function () {
            st.openId = st.openId === e.id ? null : e.id;
            pintarProyectoHistorialTabla();
          }
        });
      } else {
        row = document.createElement('button');
        row.type = 'button';
        row.className = 'catalogo-fila' + (abierto ? ' is-open' : '');
        row.dataset.empujeId = e.id;
        row.textContent = formatEmpujeCuando(e.ts) + ' — ' + secundario;
        row.addEventListener('click', function () {
          st.openId = st.openId === e.id ? null : e.id;
          pintarProyectoHistorialTabla();
        });
      }
      if (e.ok) row.classList.add('is-ok-tint');
      else row.classList.add('is-err-tint');
      lista.append(row);
    });
  }
  if (pager) pager.hidden = !st.nextCursor;
  if (btnMas) {
    btnMas.hidden = !st.nextCursor;
    btnMas.disabled = !!st.loading;
  }
  if (detalle) {
    const open = items.find(function (x) { return x.id === st.openId; });
    if (open) {
      detalle.hidden = false;
      try {
        detalle.textContent = JSON.stringify(open.detalle != null ? open.detalle : open, null, 2);
      } catch (err) {
        detalle.textContent = String(open.detalle || '');
      }
    } else {
      detalle.hidden = true;
      detalle.textContent = '';
    }
  }
}

function cargarProyectoHistorialEmpujes(proy, opts) {
  const o = opts || {};
  const reset = o.reset !== false && !o.append;
  const append = !!o.append;
  if (!proy || !proy.id) return;
  const st = state.proyectos.empujes;
  if (st.loading && append) return;
  if (reset) {
    st.items = [];
    st.nextCursor = null;
    st.openId = null;
    if (o.readFilters !== false) {
      const estEl = document.getElementById('proyHistorialEstado');
      const desdeEl = document.getElementById('proyHistorialDesde');
      const hastaEl = document.getElementById('proyHistorialHasta');
      st.estado = estEl ? String(estEl.value || '') : '';
      st.desde = datetimeLocalToIso(desdeEl && desdeEl.value);
      st.hasta = datetimeLocalToIso(hastaEl && hastaEl.value);
    }
  }
  if (append && !st.nextCursor) return;

  const token = ++st.token;
  st.loading = true;
  const vacio = document.getElementById('proyHistorialEstadoMsg');
  if (vacio && !append) {
    vacio.hidden = false;
    vacio.textContent = 'Cargando historial…';
  }
  pintarProyectoHistorialTabla();

  const qs = new URLSearchParams();
  qs.set('limit', '50');
  if (append && st.nextCursor) qs.set('cursor', st.nextCursor);
  if (st.estado) qs.set('estado', st.estado);
  if (st.desde) qs.set('desde', st.desde);
  if (st.hasta) qs.set('hasta', st.hasta);

  fetch(apiBaseUrl() + '/v1/proyectos/' + encodeURIComponent(proy.id) + '/empujes?' + qs.toString(), {
    cache: 'no-store'
  })
    .then(function (res) {
      return res.text().then(function (raw) {
        var data = null;
        try { data = raw ? JSON.parse(raw) : {}; } catch (e) { data = null; }
        if (!res.ok || (data && data.ok === false)) {
          var err = new Error((data && data.error) || ('HTTP ' + res.status));
          err.status = res.status;
          err.data = data;
          err.rawBody = raw;
          throw err;
        }
        return data;
      });
    })
    .then(function (data) {
      if (token !== state.proyectos.empujes.token) return;
      const abierta = proyectoAbierto();
      if (!abierta || abierta.id !== proy.id) return;
      const list = (data && Array.isArray(data.empujes)) ? data.empujes : [];
      if (append) st.items = (st.items || []).concat(list);
      else st.items = list;
      st.nextCursor = (data && data.nextCursor) || null;
      st.loading = false;
      pintarProyectoHistorialTabla();
    })
    .catch(function (err) {
      if (token !== state.proyectos.empujes.token) return;
      st.loading = false;
      if (vacio) {
        vacio.hidden = false;
        showApiErrorRaw(vacio, err, { kind: 'is-err', statusLabel: true });
      }
      pintarProyectoHistorialTabla();
    });
}

function pintarProyectoCluster(proy) {
  const mount = document.getElementById('proyClusterLista');
  const vacio = document.getElementById('proyClusterVacio');
  if (!mount) return;
  const cid = proy && proy.clusterId ? String(proy.clusterId) : '';
  const cl = cid
    ? (state.clusters.lista || []).find(function (c) { return c.id === cid; })
    : null;
  if (!cid || !cl) {
    mount.replaceChildren();
    if (vacio) {
      vacio.hidden = false;
      vacio.textContent = cid
        ? 'Cluster ' + cid + ' (carga el catálogo Clusters).'
        : 'Sin cluster asignado. La URI Atlas vive en el Cluster.';
    }
    return;
  }
  if (vacio) vacio.hidden = true;
  if (!window.ClustersUI || typeof window.ClustersUI.montarLista !== 'function') {
    mount.textContent = cl.nombre + ' (' + cl.id + ')';
    return;
  }
  window.ClustersUI.montarLista(mount, {
    getSnapshot: function () {
      return {
        ready: true,
        indexError: false,
        clusters: [cl],
        abierta: state.clusters.abiertoId === cl.id ? { id: cl.id } : null
      };
    },
    añadirCluster: function () {},
    abrirCluster: function (id) { abrirCluster(id); }
  }, { emptyMsg: 'Sin cluster.' });
}

function clusterAbierto() {
  if (!state.clusters.abiertoId) return null;
  return (state.clusters.lista || []).find(function (c) {
    return c.id === state.clusters.abiertoId;
  }) || null;
}

function normalizeCluster(item) {
  if (!item || typeof item !== 'object') return null;
  if (typeof item.id !== 'string' || !item.id.trim()) return null;
  if (typeof item.nombre !== 'string' || !item.nombre.trim()) return null;
  const out = {
    id: item.id.trim(),
    nombre: item.nombre.trim(),
    descripcion: typeof item.descripcion === 'string' ? item.descripcion.trim().slice(0, 280) : '',
    hash: typeof item.hash === 'string' ? item.hash : '',
    proyectos: Array.isArray(item.proyectos) ? item.proyectos : [],
    nProyectos: Array.isArray(item.proyectos) ? item.proyectos.length : 0
  };
  attachEntityColor(out, item);
  return out;
}

function normalizeClustersIndice(data) {
  const list = Array.isArray(data) ? data : (data && Array.isArray(data.clusters) ? data.clusters : []);
  const out = [];
  const seen = new Set();
  list.forEach(function (item) {
    const cl = normalizeCluster(item);
    if (!cl || seen.has(cl.id)) return;
    seen.add(cl.id);
    out.push(cl);
  });
  return out.sort(function (a, b) {
    return a.nombre.localeCompare(b.nombre, 'es');
  });
}

function clustersBridge() {
  return {
    getSnapshot: function () {
      const abierta = state.clusters.abiertoId
        ? (state.clusters.lista || []).find(function (c) { return c.id === state.clusters.abiertoId; }) || null
        : null;
      return {
        ready: state.clusters.ready,
        indexError: state.clusters.indexError,
        clusters: state.clusters.lista || [],
        abierta: abierta ? { id: abierta.id } : null
      };
    },
    añadirCluster: function () { abrirDialogoNuevoCluster(); },
    abrirCluster: function (id) {
      if (state.clusters.abiertoId === id) {
        const dlg = document.getElementById('dlgCluster');
        if (dlg && dlg.open) {
          cerrarClusterModal();
          return;
        }
      }
      abrirCluster(id);
    }
  };
}

function pintarClusters() {
  if (window.ClustersUI && typeof window.ClustersUI.refrescar === 'function') {
    window.ClustersUI.refrescar(clustersBridge());
  }
}

function cargarClusters() {
  apiFetch('/v1/clusters')
    .then(function (data) {
      state.clusters.lista = normalizeClustersIndice(data);
      state.clusters.indexError = false;
    })
    .catch(function () {
      state.clusters.lista = [];
      state.clusters.indexError = true;
    })
    .then(function () {
      state.clusters.ready = true;
      pintarClusters();
      const proy = proyectoAbierto();
      if (proy) pintarProyectoCluster(proy);
    });
}

function cerrarClusterModal() {
  const dlg = document.getElementById('dlgCluster');
  if (dlg && dlg.open) {
    dlg.close();
    return;
  }
  state.clusters.abiertoId = null;
  state.clusters.tab = 'resumen';
  pintarClusters();
}

function seleccionarClusterAsocSub(id) {
  if (id !== 'bases') id = 'bases';
  state.clusters.asocSub = id;
  const tabs = document.querySelectorAll('#clusterAsociadosSubtabs [data-cluster-asoc-sub]');
  tabs.forEach(function (btn) {
    const on = btn.getAttribute('data-cluster-asoc-sub') === id;
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  document.querySelectorAll('#clusterPanelAsociados [data-cluster-asoc-pane]').forEach(function (pane) {
    pane.hidden = pane.getAttribute('data-cluster-asoc-pane') !== id;
  });
  const cl = clusterAbierto();
  if (cl && id === 'bases') pintarClusterBases(cl);
}

function seleccionarClusterReaderTab(id) {
  if (id === 'bases') {
    state.clusters.asocSub = 'bases';
    id = 'asociados';
  }
  const tabs = document.querySelectorAll('#clusterReaderTabs [data-cluster-tab]');
  const panels = {
    resumen: document.getElementById('clusterPanelResumen'),
    conexion: document.getElementById('clusterPanelConexion'),
    asociados: document.getElementById('clusterPanelAsociados')
  };
  tabs.forEach(function (btn) {
    const on = btn.getAttribute('data-cluster-tab') === id;
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  Object.keys(panels).forEach(function (key) {
    if (panels[key]) panels[key].hidden = key !== id;
  });
  state.clusters.tab = id;
  const cl = clusterAbierto();
  if (!cl) return;
  if (id === 'conexion') cargarClusterConexion(cl);
  if (id === 'asociados') seleccionarClusterAsocSub(state.clusters.asocSub || 'bases');
}

function pintarClusterBases(cl) {
  const mount = document.getElementById('clusterBasesLista');
  if (!mount || !cl) return;
  const proyecs = (state.proyectos.lista || []).filter(function (p) {
    return p && p.clusterId === cl.id;
  });
  if (!window.ProyectosUI || typeof window.ProyectosUI.montarLista !== 'function') {
    mount.textContent = proyecs.length
      ? proyecs.map(function (p) { return p.nombre; }).join(', ')
      : 'Sin bases de datos.';
    return;
  }
  window.ProyectosUI.montarLista(mount, {
    getSnapshot: function () {
      return {
        ready: true,
        indexError: false,
        proyectos: proyecs,
        abierta: null
      };
    },
    añadirProyecto: function () {},
    abrirProyecto: function (id) { abrirProyecto(id); }
  }, { emptyMsg: 'Ninguna base de datos en este cluster.' });
}

function pintarClusterResumenConexion(cl) {
  const badge = document.getElementById('clusterResumenConexionBadge');
  const cta = document.getElementById('clusterResumenConexionCta');
  if (!badge) return;
  badge.classList.remove('is-yes', 'is-no', 'is-err');
  badge.textContent = 'Consultando…';
  if (cta) cta.hidden = true;
  if (!cl || !cl.id) {
    badge.textContent = 'Sin configurar';
    badge.classList.add('is-no');
    return;
  }
  fetch(apiBaseUrl() + '/v1/clusters/' + encodeURIComponent(cl.id) + '/mongo-config', {
    cache: 'no-store'
  })
    .then(function (res) {
      return res.json().then(function (data) {
        return { res: res, data: data || {} };
      });
    })
    .then(function (pack) {
      const abierta = clusterAbierto();
      if (!abierta || abierta.id !== cl.id) return;
      if (!pack.res.ok) throw new Error('error');
      const configured = !!pack.data.configured;
      const connected = pack.data.connected;
      badge.classList.remove('is-yes', 'is-no', 'is-err');
      if (!configured) {
        badge.textContent = 'Sin configurar';
        badge.classList.add('is-no');
        if (cta) cta.hidden = false;
      } else if (connected === true) {
        badge.textContent = 'Conectada';
        badge.classList.add('is-yes');
        if (cta) cta.hidden = true;
      } else if (connected === false) {
        badge.textContent = 'URI guardada · sin conexión';
        badge.classList.add('is-err');
        if (cta) cta.hidden = false;
      } else {
        badge.textContent = 'URI configurada';
        badge.classList.add('is-yes');
        if (cta) cta.hidden = true;
      }
    })
    .catch(function () {
      const abierta = clusterAbierto();
      if (!abierta || abierta.id !== cl.id) return;
      badge.classList.remove('is-yes', 'is-no', 'is-err');
      badge.textContent = 'Sin configurar';
      badge.classList.add('is-no');
      if (cta) cta.hidden = false;
    });
}

function renderClusterReader() {
  const dlg = document.getElementById('dlgCluster');
  const cl = clusterAbierto();
  if (!cl) {
    state.clusters.abiertoId = null;
    if (dlg && dlg.open) dlg.close();
    return;
  }
  const nombre = document.getElementById('clusterReaderNombre');
  if (nombre) nombre.textContent = cl.nombre;
  const sub = document.getElementById('clusterReaderSub');
  if (sub) sub.textContent = cl.id;
  const idEl = document.getElementById('clusterReaderId');
  if (idEl) idEl.textContent = cl.id || '—';
  const desc = document.getElementById('clusterReaderDesc');
  if (desc) desc.textContent = cl.descripcion || '—';
  const bases = document.getElementById('clusterResumenBases');
  if (bases) {
    const n = (state.proyectos.lista || []).filter(function (p) {
      return p && p.clusterId === cl.id;
    }).length;
    bases.textContent = n ? String(n) : '0';
  }
  pintarClusterResumenConexion(cl);
  seleccionarClusterReaderTab(state.clusters.tab || 'resumen');
  openFichaPane(dlg);
  cablearColorFicha(dlg, {
    kind: 'cluster',
    id: cl.id,
    iconKind: 'cluster',
    getColor: function () { return cl.color; },
    onSaved: function (hex) { cl.color = hex; }
  });
  if (nombre) nombre.focus();
}

function abrirCluster(id) {
  const cl = (state.clusters.lista || []).find(function (c) { return c.id === id; });
  if (!cl) return;
  state.clusters.abiertoId = id;
  state.clusters.tab = 'resumen';
  renderClusterReader();
  pintarClusters();
}

function abrirDialogoNuevoCluster() {
  const dlg = document.getElementById('dlgNuevoCluster');
  const form = document.getElementById('formNuevoCluster');
  if (!dlg || !form) return;
  form.reset();
  const err = document.getElementById('nuevoClusterError');
  if (err) err.textContent = '';
  dlg.showModal();
  if (form.nombre) form.nombre.focus();
}

function onSubmitNuevoCluster(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const error = document.getElementById('nuevoClusterError');
  if (error) error.textContent = '';
  const nombre = form.nombre.value.trim();
  if (!nombre) {
    if (error) error.textContent = 'Escribe un nombre.';
    return;
  }
  const idRaw = form.id && form.id.value ? String(form.id.value).trim() : '';
  const body = {
    nombre: nombre,
    descripcion: form.descripcion.value.trim().slice(0, 280)
  };
  if (idRaw) body.id = idRaw;
  const submit = form.querySelector('[type="submit"]');
  if (submit) submit.disabled = true;
  asegurarClaveCatalogo()
    .then(function () {
      return apiFetchAuth('/v1/clusters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    })
    .then(function (data) {
      if (!data || data.ok === false) throw new Error((data && data.error) || 'No se pudo crear');
      document.getElementById('dlgNuevoCluster').close();
      return cargarClusters().then(function () {
        const id = data.cluster && data.cluster.id;
        if (id) abrirCluster(id);
      });
    })
    .catch(function (err) {
      if (error) showApiErrorRaw(error, err, { kind: 'is-err', statusLabel: true });
    })
    .then(function () {
      if (submit) submit.disabled = false;
    });
}

function abrirDialogoEditarCluster(id) {
  const cl = (state.clusters.lista || []).find(function (c) { return c.id === id; });
  if (!cl) return;
  const dlg = document.getElementById('dlgEditarCluster');
  const form = document.getElementById('formEditarCluster');
  if (!dlg || !form) return;
  form.reset();
  form.dataset.id = id;
  form.nombre.value = cl.nombre || '';
  form.descripcion.value = cl.descripcion || '';
  const err = document.getElementById('editarClusterError');
  if (err) err.textContent = '';
  dlg.showModal();
  if (form.nombre) form.nombre.focus();
}

function onSubmitEditarCluster(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const id = form.dataset.id;
  const error = document.getElementById('editarClusterError');
  if (error) error.textContent = '';
  if (!id) return;
  const nombre = form.nombre.value.trim();
  if (!nombre) {
    if (error) error.textContent = 'Escribe un nombre.';
    return;
  }
  const submit = form.querySelector('[type="submit"]');
  if (submit) submit.disabled = true;
  asegurarClaveCatalogo()
    .then(function () {
      return apiFetchAuth('/v1/clusters/' + encodeURIComponent(id), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre: nombre,
          descripcion: form.descripcion.value.trim().slice(0, 280)
        })
      });
    })
    .then(function (data) {
      if (!data || data.ok === false) throw new Error((data && data.error) || 'No se pudo guardar');
      document.getElementById('dlgEditarCluster').close();
      return cargarClusters().then(function () {
        if (state.clusters.abiertoId === id) renderClusterReader();
      });
    })
    .catch(function (err) {
      if (error) showApiErrorRaw(error, err, { kind: 'is-err', statusLabel: true });
    })
    .then(function () {
      if (submit) submit.disabled = false;
    });
}

function eliminarCluster(id) {
  return asegurarClaveCatalogo()
    .then(function () {
      return apiFetchAuth('/v1/clusters/' + encodeURIComponent(id), { method: 'DELETE' });
    })
    .then(function (data) {
      if (!data || data.ok === false) throw new Error((data && data.error) || 'No se pudo eliminar');
      if (state.clusters.abiertoId === id) {
        state.clusters.abiertoId = null;
        const dlg = document.getElementById('dlgCluster');
        if (dlg && dlg.open) dlg.close();
      }
      return cargarClusters();
    });
}

function clusterConexionSetBusy(busy) {
  ['clusterConexionGuardar', 'clusterConexionProbar', 'clusterConexionBorrar', 'clusterAutoSyncToggle'].forEach(function (id) {
    const n = document.getElementById(id);
    if (n) n.disabled = !!busy;
  });
}

function clusterConexionSetMsg(text, kind) {
  const n = document.getElementById('clusterConexionMsg');
  if (!n) return;
  n.classList.remove('api-error-raw');
  n.textContent = text || '';
  n.classList.remove('is-ok', 'is-err', 'is-info');
  if (kind) n.classList.add(kind);
}

function clusterConexionSetApiError(err) {
  const n = document.getElementById('clusterConexionMsg');
  showApiErrorRaw(n, err, { kind: 'is-err', statusLabel: true });
}

function pintarClusterConexionStatus(data, cl) {
  const badge = document.getElementById('clusterConexionStatus');
  const hintEl = document.getElementById('clusterConexionHint');
  if (!badge) return;
  const configured = !!(data && data.configured);
  const own = !!(data && data.own);
  const connected = data && data.connected;
  const source = (data && data.source) || 'none';
  const hint = (data && data.hint) || '';

  badge.classList.remove('is-yes', 'is-no', 'is-err');
  let label = 'Sin configurar';
  if (configured) {
    label = own || source === 'cluster' ? 'URI del cluster' : 'Configurada';
    if (connected === true) label += ' · conectada';
    else if (connected === false) label += ' · sin conexión';
    badge.classList.add(connected === false ? 'is-err' : 'is-yes');
  } else {
    badge.classList.add('is-no');
  }
  badge.textContent = label;

  const extra = [];
  if (configured && hint) extra.push('pista ' + hint);
  if (own || source === 'cluster') extra.push('guardada en este cluster');
  if (hintEl) {
    hintEl.textContent = extra.length
      ? extra.join(' · ')
      : 'Sin URI: las Bases de datos de este cluster no pueden hablar con Atlas.';
  }

  const uriInput = document.getElementById('clusterConexionUri');
  if (uriInput) {
    uriInput.value = '';
    uriInput.placeholder = own
      ? 'URI ya configurada — pega una nueva solo para reemplazar'
      : 'mongodb+srv://usuario:contraseña@cluster…/';
  }

  const toggle = document.getElementById('clusterAutoSyncToggle');
  const autoFromData = data && Object.prototype.hasOwnProperty.call(data, 'autoSync')
    ? !!data.autoSync
    : !!(cl && cl.autoSync);
  if (toggle) {
    toggle.checked = autoFromData;
    toggle.disabled = false;
  }
  if (cl) cl.autoSync = autoFromData;
  const ls = (data && data.lastSync) || (cl && cl.lastSync) || null;
  if (cl && ls) cl.lastSync = ls;
  pintarLastSyncEl(document.getElementById('clusterLastSync'), ls);
}

function cargarClusterConexion(cl) {
  const badge = document.getElementById('clusterConexionStatus');
  if (!cl || !cl.id) return;
  clusterConexionSetMsg('');
  if (badge) {
    badge.textContent = 'Consultando…';
    badge.classList.remove('is-yes', 'is-no', 'is-err');
  }
  fetch(apiBaseUrl() + '/v1/clusters/' + encodeURIComponent(cl.id) + '/mongo-config', {
    cache: 'no-store',
    headers: { Accept: 'application/json' }
  })
    .then(function (res) {
      return res.text().then(function (rawBody) {
        var data = null;
        try { data = rawBody ? JSON.parse(rawBody) : {}; } catch (e) { data = null; }
        return { res: res, data: data, rawBody: rawBody || '' };
      });
    })
    .then(function (pack) {
      const abierta = clusterAbierto();
      if (!abierta || abierta.id !== cl.id) return;
      const tabOn = document.querySelector('#clusterReaderTabs [data-cluster-tab="conexion"].is-on');
      if (!tabOn) return;
      if (!pack.res.ok || (pack.data && pack.data.ok === false)) {
        var err = new Error((pack.data && pack.data.error) || ('HTTP ' + pack.res.status));
        err.status = pack.res.status;
        err.data = pack.data;
        err.rawBody = pack.rawBody;
        throw err;
      }
      if (pack.data && Object.prototype.hasOwnProperty.call(pack.data, 'uri')) {
        delete pack.data.uri;
      }
      pintarClusterConexionStatus(pack.data, cl);
    })
    .catch(function (err) {
      const abierta = clusterAbierto();
      if (!abierta || abierta.id !== cl.id) return;
      pintarClusterConexionStatus({ configured: false, connected: false, source: 'none', own: false }, cl);
      clusterConexionSetApiError(err || { ok: false, error: 'No se pudo consultar el estado de conexión.' });
    });
}

function leerFormClusterConexion() {
  const uriEl = document.getElementById('clusterConexionUri');
  return {
    uri: uriEl ? String(uriEl.value || '').trim() : ''
  };
}

function onGuardarClusterConexion(e) {
  if (e) e.preventDefault();
  const cl = clusterAbierto();
  if (!cl || !cl.id) return;
  const form = leerFormClusterConexion();
  if (!form.uri) {
    clusterConexionSetMsg('Pega la URI de Atlas para guardar.', 'is-err');
    return;
  }
  clusterConexionSetBusy(true);
  clusterConexionSetMsg('Guardando…', 'is-info');
  asegurarClaveCatalogo()
    .then(function () {
      return apiFetchAuth('/v1/clusters/' + encodeURIComponent(cl.id) + '/mongo-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uri: form.uri })
      });
    })
    .then(function (data) {
      if (!data || data.ok === false) throw new Error((data && data.error) || 'No se pudo guardar');
      if (data.uri) delete data.uri;
      const uriInput = document.getElementById('clusterConexionUri');
      if (uriInput) uriInput.value = '';
      pintarClusterConexionStatus(data, cl);
      clusterConexionSetMsg(
        data.connected
          ? 'Guardada y conectada. La URI ya no se muestra.'
          : 'Guardada. El cluster no responde aún (revisa red/Atlas); la URI no se reexpone.',
        data.connected ? 'is-ok' : 'is-info'
      );
    })
    .catch(function (err) {
      clusterConexionSetApiError(err);
    })
    .then(function () {
      clusterConexionSetBusy(false);
    });
}

function onProbarClusterConexion(e) {
  if (e) e.preventDefault();
  const cl = clusterAbierto();
  if (!cl || !cl.id) return;
  const form = leerFormClusterConexion();
  if (!form.uri) {
    clusterConexionSetMsg('Pega una URI para probar (no se guarda).', 'is-err');
    return;
  }
  clusterConexionSetBusy(true);
  clusterConexionSetMsg('Probando conexión…', 'is-info');
  asegurarClaveCatalogo()
    .then(function () {
      return apiFetchAuth('/v1/clusters/' + encodeURIComponent(cl.id) + '/mongo-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uri: form.uri, probeOnly: true })
      });
    })
    .then(function (data) {
      if (!data || data.ok === false) throw new Error((data && data.error) || 'Prueba fallida');
      if (data.uri) delete data.uri;
      if (data.connected) {
        clusterConexionSetMsg('Conexión OK (no se ha guardado).', 'is-ok');
      } else {
        clusterConexionSetApiError(data && (data.error || data.mongo)
          ? data
          : { ok: false, error: 'No alcanza el cluster', connected: false });
      }
    })
    .catch(function (err) {
      clusterConexionSetApiError(err);
    })
    .then(function () {
      clusterConexionSetBusy(false);
    });
}

function onBorrarClusterConexion(e) {
  if (e) e.preventDefault();
  const cl = clusterAbierto();
  if (!cl || !cl.id) return;
  if (!window.confirm('¿Borrar la URI de este cluster? Las Bases de datos vinculadas dejarán de poder hablar con Atlas.')) {
    return;
  }
  clusterConexionSetBusy(true);
  clusterConexionSetMsg('Borrando…', 'is-info');
  asegurarClaveCatalogo()
    .then(function () {
      return apiFetchAuth('/v1/clusters/' + encodeURIComponent(cl.id) + '/mongo-config', {
        method: 'DELETE'
      });
    })
    .then(function (data) {
      if (!data || data.ok === false) throw new Error((data && data.error) || 'No se pudo borrar');
      if (data.uri) delete data.uri;
      const uriInput = document.getElementById('clusterConexionUri');
      if (uriInput) uriInput.value = '';
      pintarClusterConexionStatus(data, cl);
      clusterConexionSetMsg('URI del cluster borrada.', 'is-ok');
    })
    .catch(function (err) {
      clusterConexionSetApiError(err);
    })
    .then(function () {
      clusterConexionSetBusy(false);
    });
}

function onToggleClusterAutoSync(e) {
  const toggle = e && e.target ? e.target : document.getElementById('clusterAutoSyncToggle');
  const cl = clusterAbierto();
  if (!cl || !cl.id || !toggle) return;
  const next = !!toggle.checked;
  toggle.disabled = true;
  clusterConexionSetMsg(next ? 'Activando sincronización…' : 'Desactivando sincronización…', 'is-info');
  asegurarClaveCatalogo()
    .then(function () {
      return apiFetchAuth('/v1/clusters/' + encodeURIComponent(cl.id), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoSync: next })
      });
    })
    .then(function (data) {
      if (!data || data.ok === false) throw new Error((data && data.error) || 'No se pudo guardar');
      const updated = data.cluster || {};
      cl.autoSync = !!updated.autoSync;
      if (updated.lastSync) cl.lastSync = updated.lastSync;
      const idx = (state.clusters.lista || []).findIndex(function (c) { return c.id === cl.id; });
      if (idx >= 0) {
        state.clusters.lista[idx].autoSync = cl.autoSync;
        if (cl.lastSync) state.clusters.lista[idx].lastSync = cl.lastSync;
      }
      toggle.checked = cl.autoSync;
      pintarLastSyncEl(document.getElementById('clusterLastSync'), cl.lastSync || null);
      clusterConexionSetMsg(
        cl.autoSync
          ? 'Sincronizar al guardar activado. Tras editar el esquema se empujará a Atlas (si hay URI).'
          : 'Sincronizar al guardar desactivado. Solo Empujar manual.',
        'is-ok'
      );
    })
    .catch(function (err) {
      toggle.checked = !next;
      clusterConexionSetApiError(err);
    })
    .then(function () {
      toggle.disabled = false;
    });
}

function abrirProyecto(id, numero) {
  refrescarProyectos();
  const proy = state.proyectos.lista.find(function (p) { return p.id === id; });
  if (!proy) return;
  state.proyectos.abiertoId = id;
  state.proyectos.abiertaNumero = numero == null ? versionActual(proy).numero : numero;
  state.proyectos.historial = false;
  renderProyectoReader();
  pintarProyectos();
}

/** Lucide external-link para filas de catálogo (mismo trazo que SkillsUI / SystemPromptsUI). */
function svgCatalogoEnlace() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'catalogo-fila-enlace-svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.append(svgPath('M15 3h6v6'), svgPath('M10 14L21 3'), svgPath('M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'));
  return svg;
}

/**
 * Fila de lista/navegación con el mismo aspecto catalogo-fila que Catálogos.
 * opts: { icono, titulo, secundario, color, open, static, title, ariaLabel, onClick, acciones }
 * acciones: Node[] opcionales a la derecha (sustituyen el ↗ si se pasan).
 */
function filaCatalogoLista(opts) {
  opts = opts || {};
  const btn = el(
    'button',
    'catalogo-fila'
      + (opts.open ? ' is-open' : '')
      + (opts.static ? ' catalogo-fila-static' : ''),
    null
  );
  btn.type = 'button';
  btn.setAttribute('role', 'listitem');
  btn.title = opts.title || opts.titulo || '';
  if (opts.ariaLabel) btn.setAttribute('aria-label', opts.ariaLabel);
  if (opts.dataset && typeof opts.dataset === 'object') {
    Object.keys(opts.dataset).forEach(function (k) {
      btn.dataset[k] = opts.dataset[k] == null ? '' : String(opts.dataset[k]);
    });
  }

  const icon = el('span', 'catalogo-fila-icon', null);
  icon.setAttribute('aria-hidden', 'true');
  if (window.ColorEntidad && opts.color) window.ColorEntidad.applyToEl(icon, opts.color);
  if (opts.icono && typeof svgPestanaCatalogo === 'function') {
    const svg = svgPestanaCatalogo(opts.icono);
    svg.setAttribute('class', 'catalogo-fila-svg');
    icon.append(svg);
  }

  const main = el('span', 'catalogo-fila-main', null);
  main.append(el('span', 'catalogo-fila-titulo', opts.titulo || ''));
  if (opts.secundario != null && opts.secundario !== '') {
    const cod = el('span', 'catalogo-fila-codigo', null);
    if (typeof opts.secundario === 'string') cod.textContent = opts.secundario;
    else if (opts.secundario && opts.secundario.nodeType) cod.append(opts.secundario);
    else cod.textContent = String(opts.secundario);
    main.append(cod);
  }

  btn.append(icon, main);

  if (Array.isArray(opts.acciones) && opts.acciones.length) {
    const acc = el('span', 'catalogo-fila-acciones', null);
    opts.acciones.forEach(function (n) {
      if (n) acc.append(n);
    });
    btn.append(acc);
  } else if (!opts.static) {
    const enlace = el('span', 'catalogo-fila-enlace', null);
    enlace.setAttribute('aria-hidden', 'true');
    enlace.append(svgCatalogoEnlace());
    btn.append(enlace);
  }

  if (typeof opts.onClick === 'function' && !opts.static) {
    btn.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('.catalogo-fila-acciones')) return;
      opts.onClick(e, btn);
    });
  }
  return btn;
}

window.filaCatalogoLista = filaCatalogoLista;
window.svgCatalogoEnlace = svgCatalogoEnlace;

/**
 * Fila seleccionable con el mismo aspecto catalogo-fila que Catálogos.
 * opts: { icono, titulo, secundario, value, selected, mode:'multi'|'single', title, ariaLabel }
 */
function filaSeleccionCatalogo(opts) {
  opts = opts || {};
  const mode = opts.mode === 'single' ? 'single' : 'multi';
  const selected = !!opts.selected;
  const btn = el('button', 'catalogo-fila' + (selected ? ' is-selected' : ''), null);
  btn.type = 'button';
  btn.setAttribute('role', mode === 'single' ? 'radio' : 'checkbox');
  btn.setAttribute(mode === 'single' ? 'aria-checked' : 'aria-pressed', selected ? 'true' : 'false');
  btn.dataset.pickerValue = opts.value == null ? '' : String(opts.value);
  btn.title = opts.title || opts.titulo || '';
  if (opts.ariaLabel) btn.setAttribute('aria-label', opts.ariaLabel);

  const icon = el('span', 'catalogo-fila-icon', null);
  icon.setAttribute('aria-hidden', 'true');
  if (window.ColorEntidad && opts.color) window.ColorEntidad.applyToEl(icon, opts.color);
  if (opts.icono && typeof svgPestanaCatalogo === 'function') {
    const svg = svgPestanaCatalogo(opts.icono);
    svg.setAttribute('class', 'catalogo-fila-svg');
    icon.append(svg);
  }
  const main = el('span', 'catalogo-fila-main', null);
  main.append(el('span', 'catalogo-fila-titulo', opts.titulo || ''));
  if (opts.secundario != null && opts.secundario !== '') {
    main.append(el('span', 'catalogo-fila-codigo', opts.secundario));
  }
  const enlace = el('span', 'catalogo-fila-enlace', null);
  enlace.setAttribute('aria-hidden', 'true');
  enlace.append(svgCatalogoEnlace());
  btn.append(icon, main, enlace);

  btn.addEventListener('click', function () {
    const box = btn.parentElement;
    if (!box) return;
    if (mode === 'single') {
      Array.from(box.querySelectorAll('.catalogo-fila[role="radio"]')).forEach(function (peer) {
        const on = peer === btn;
        peer.classList.toggle('is-selected', on);
        peer.setAttribute('aria-checked', on ? 'true' : 'false');
      });
    } else {
      const next = btn.getAttribute('aria-pressed') !== 'true';
      btn.classList.toggle('is-selected', next);
      btn.setAttribute('aria-pressed', next ? 'true' : 'false');
    }
  });
  return btn;
}

function prepararPickerBox(box) {
  if (!box) return;
  box.classList.add('catalogo-lista', 'catalogo-picker');
  box.replaceChildren();
}

/** Picker multi/single con filas catalogo-fila. items: { icono, titulo, secundario, value, title, ariaLabel }[] */
function pintarCatalogoPicker(containerId, items, opts) {
  opts = opts || {};
  const box = document.getElementById(containerId);
  if (!box) return;
  prepararPickerBox(box);
  const mode = opts.mode === 'single' ? 'single' : 'multi';
  box.setAttribute('role', mode === 'single' ? 'radiogroup' : 'group');
  if (opts.ariaLabel) box.setAttribute('aria-label', opts.ariaLabel);

  let selectedSet = null;
  let selectedOne = null;
  if (mode === 'single') {
    selectedOne = opts.selectedId == null ? null : String(opts.selectedId);
  } else {
    selectedSet = new Set((opts.selectedIds || []).map(function (s) { return String(s).toLowerCase(); }));
  }

  const list = Array.isArray(items) ? items : [];
  if (!list.length && opts.emptyMsg) {
    box.classList.remove('catalogo-lista');
    box.append(el('p', 'ancla-ficha-vacio', opts.emptyMsg));
    return;
  }
  list.forEach(function (item) {
    const value = item.value == null ? '' : String(item.value);
    const selected = mode === 'single'
      ? (selectedOne == null ? value === '' : value === selectedOne)
      : selectedSet.has(value.toLowerCase());
    box.append(filaSeleccionCatalogo({
      mode: mode,
      icono: item.icono,
      titulo: item.titulo,
      secundario: item.secundario,
      value: value,
      selected: selected,
      title: item.title,
      ariaLabel: item.ariaLabel
    }));
  });
}

function valoresPickerSeleccionados(containerId) {
  const box = document.getElementById(containerId);
  if (!box) return [];
  return Array.from(box.querySelectorAll('.catalogo-fila[aria-pressed="true"]')).map(function (node) {
    return node.dataset.pickerValue || '';
  }).filter(Boolean);
}

function valorPickerUnico(containerId) {
  const box = document.getElementById(containerId);
  if (!box) return null;
  const checked = box.querySelector('.catalogo-fila[role="radio"][aria-checked="true"]');
  if (!checked) return null;
  const v = String(checked.dataset.pickerValue || '').trim();
  return v || null;
}

function pintarSkillsPicker(containerId, selectedIds) {
  refrescar();
  const skills = state.instrucciones.slice().sort(function (a, b) {
    return a.nombre.localeCompare(b.nombre, 'es');
  });
  const items = skills.map(function (ins) {
    const actual = versionActual(ins);
    let secundario = formatVersion(actual.numero, actual.fecha);
    if (actual.origen === 'local') secundario += ' · local';
    return {
      icono: 'skills',
      titulo: ins.nombre,
      secundario: secundario,
      value: ins.id,
      title: ins.descripcion || ins.nombre,
      ariaLabel: 'Seleccionar skill ' + ins.nombre
    };
  });
  pintarCatalogoPicker(containerId, items, {
    mode: 'multi',
    selectedIds: selectedIds || [],
    emptyMsg: 'No hay skills en el catálogo.',
    ariaLabel: 'Skills del catálogo'
  });
}

function skillsDesdePicker(containerId) {
  return valoresPickerSeleccionados(containerId);
}

window.filaSeleccionCatalogo = filaSeleccionCatalogo;
window.pintarCatalogoPicker = pintarCatalogoPicker;
window.valoresPickerSeleccionados = valoresPickerSeleccionados;
window.valorPickerUnico = valorPickerUnico;
window.pintarSkillsPicker = pintarSkillsPicker;
window.skillsDesdePicker = skillsDesdePicker;

function textoVersionProyectoActual(v) {
  if (!v) return Promise.resolve('');
  if (typeof v.markdown === 'string') return Promise.resolve(v.markdown);
  if (v.ruta && mdCache.has(v.ruta)) return Promise.resolve(mdCache.get(v.ruta));
  if (!v.ruta) return Promise.resolve('');
  try {
    return fetch(hrefRuta(v.ruta), { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('http');
        return res.text();
      })
      .then(function (text) {
        mdCache.set(v.ruta, text);
        return text;
      })
      .catch(function () { return ''; });
  } catch (e) {
    return Promise.resolve('');
  }
}

function abrirDialogoNuevoProyecto() {
  const dlg = document.getElementById('dlgNuevoProyecto');
  const form = document.getElementById('formNuevoProyecto');
  if (!dlg || !form) return;
  form.reset();
  const err = document.getElementById('nuevoProyectoError');
  if (err) err.textContent = '';
  dlg.showModal();
  if (form.nombre) form.nombre.focus();
}

async function onSubmitNuevoProyecto(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const error = document.getElementById('nuevoProyectoError');
  if (error) error.textContent = '';
  const nombre = form.nombre.value.trim();
  if (!nombre) {
    if (error) error.textContent = 'Escribe un nombre.';
    return;
  }
  const markdown = String(form.markdown.value || '');
  if (!markdown.trim()) {
    if (error) error.textContent = 'El contenido no puede estar vacío.';
    return;
  }
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const idBase = String(nombre || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'proyecto';
    let id = idBase;
    refrescarProyectos();
    let n = 2;
    while (state.proyectos.lista.some(function (p) { return p.id === id; })) {
      id = idBase + '-' + n;
      n += 1;
    }
    const hash = await sha256Hex(markdown);
    const store = leerProyectosStore();
    store.proyectos.push({
      id: id,
      nombre: nombre,
      descripcion: form.descripcion.value.trim().slice(0, 280),
      skills: normalizarSkillsProyecto(String(form.skills.value || '').split(/[\n,]+/)),
      versiones: [{
        numero: 1,
        fecha: todayISO(),
        markdown: markdown,
        hash: hash,
        nombreArchivo: id + '.md'
      }]
    });
    guardarProyectosLocal(store);
    document.getElementById('dlgNuevoProyecto').close();
    refrescarProyectos();
    pintarProyectos();
    abrirProyecto(id, 1);
  } catch (err) {
    if (error) showApiErrorRaw(error, err, { kind: 'is-err', statusLabel: true });
  } finally {
    submit.disabled = false;
  }
}

function abrirDialogoEditarProyecto(id) {
  const proy = state.proyectos.lista.find(function (p) { return p.id === id; });
  if (!proy) return;
  const dlg = document.getElementById('dlgEditarProyecto');
  const form = document.getElementById('formEditarProyecto');
  if (!dlg || !form) return;
  form.reset();
  form.dataset.id = id;
  delete form.dataset.snapMarkdown;
  delete form.dataset.snapSkills;
  const err = document.getElementById('editarProyectoError');
  if (err) err.textContent = '';
  form.nombre.value = proy.nombre;
  form.descripcion.value = proy.descripcion || '';
  form.skills.value = (proy.skills || []).join('\n');
  pintarSkillsPicker('editarProySkillsPicker', proy.skills || []);
  form.markdown.value = 'Cargando…';
  seleccionarEditarProyTab('documento');
  dlg.showModal();
  const v = versionActual(proy);
  textoVersionProyectoActual(v).then(function (text) {
    if (form.dataset.id !== id) return;
    const md = text || '';
    form.markdown.value = md;
    form.dataset.snapMarkdown = md;
    form.dataset.snapSkills = (proy.skills || []).join('\n');
    form.nombre.focus();
  });
}

async function onSubmitEditarProyecto(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const error = document.getElementById('editarProyectoError');
  if (error) error.textContent = '';
  const id = form.dataset.id;
  const nombre = form.nombre.value.trim();
  if (!nombre) {
    if (error) error.textContent = 'Escribe un nombre.';
    return;
  }
  const markdown = form.markdown.value;
  if (!String(markdown || '').trim()) {
    if (error) error.textContent = 'El contenido no puede estar vacío.';
    return;
  }
  const skills = normalizarSkillsProyecto(skillsDesdePicker('editarProySkillsPicker'));
  form.skills.value = skills.join('\n');
  const snapMd = form.dataset.snapMarkdown;
  const snapSkills = form.dataset.snapSkills;
  refrescarProyectos();
  const actual = state.proyectos.lista.find(function (p) { return p.id === id; });
  if (!actual) {
    if (error) error.textContent = 'No está ese proyecto.';
    return;
  }
  const desc = form.descripcion.value.trim().slice(0, 280);
  if (
    typeof snapMd === 'string' &&
    typeof snapSkills === 'string' &&
    markdown === snapMd &&
    skills.join('\n') === snapSkills &&
    nombre === actual.nombre &&
    desc === (actual.descripcion || '')
  ) {
    if (error) error.textContent = 'Sin cambios';
    return;
  }
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const hash = await sha256Hex(markdown);
    const store = leerProyectosStore();
    let entrada = store.proyectos.find(function (p) { return p && p.id === id; });
    if (!entrada) {
      entrada = { id: id, nombre: actual.nombre, skills: [], versiones: [] };
      store.proyectos.push(entrada);
    }
    entrada.nombre = nombre;
    entrada.descripcion = desc;
    entrada.skills = skills;
    if (!Array.isArray(entrada.versiones)) entrada.versiones = [];
    const creada = {
      numero: siguienteNumero(actual.versiones),
      fecha: todayISO(),
      markdown: markdown,
      hash: hash,
      nombreArchivo: id + '.md'
    };
    entrada.versiones.push(creada);
    guardarProyectosLocal(store);
    document.getElementById('dlgEditarProyecto').close();
    refrescarProyectos();
    pintarProyectos();
    abrirProyecto(id, creada.numero);
  } catch (err) {
    if (error) showApiErrorRaw(error, err, { kind: 'is-err', statusLabel: true });
  } finally {
    submit.disabled = false;
  }
}

function abrirDialogoEditarProyectoSkills() {
  const proy = proyectoAbierto();
  if (!proy) return;
  const dlg = document.getElementById('dlgEditarProyectoSkills');
  const form = document.getElementById('formEditarProyectoSkills');
  if (!dlg || !form) return;
  const err = document.getElementById('editarProyectoSkillsError');
  if (err) err.textContent = '';
  form.dataset.id = proy.id;
  pintarSkillsPicker('editarProyectoSkillsPicker', proy.skills || []);
  dlg.showModal();
}

function onSubmitEditarProyectoSkills(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const error = document.getElementById('editarProyectoSkillsError');
  if (error) error.textContent = '';
  const id = form.dataset.id;
  const skills = normalizarSkillsProyecto(skillsDesdePicker('editarProyectoSkillsPicker'));
  refrescarProyectos();
  const actual = state.proyectos.lista.find(function (p) { return p.id === id; });
  if (!actual) {
    if (error) error.textContent = 'No está ese proyecto.';
    return;
  }
  try {
    const store = leerProyectosStore();
    let entrada = store.proyectos.find(function (p) { return p && p.id === id; });
    if (!entrada) {
      entrada = {
        id: id,
        nombre: actual.nombre,
        descripcion: actual.descripcion || '',
        skills: [],
        versiones: []
      };
      store.proyectos.push(entrada);
    }
    entrada.nombre = actual.nombre;
    if (actual.descripcion) entrada.descripcion = actual.descripcion;
    entrada.skills = skills;
    guardarProyectosLocal(store);
    document.getElementById('dlgEditarProyectoSkills').close();
    refrescarProyectos();
    pintarProyectos();
    if (state.proyectos.abiertoId === id) {
      const abierto = proyectoAbierto();
      if (abierto) pintarProyectoSkillsTab(abierto);
    }
  } catch (err) {
    if (error) showApiErrorRaw(error, err, { kind: 'is-err', statusLabel: true });
  }
}

function cargarProyectosDesdeSeed() {
  return fetch('catalogo/proyectos/index.json', { cache: 'no-store' })
    .then(function (res) {
      if (!res.ok) throw new Error('http');
      return res.json();
    })
    .then(function (data) {
      state.proyectos.remotos = normalizeProyectosIndice(data);
      state.proyectos.indexError = false;
    });
}

function cargarProyectos() {
  apiFetch('/v1/proyectos')
    .then(function (data) {
      state.proyectos.remotos = normalizeProyectosIndice(data);
      state.proyectos.indexError = false;
    })
    .catch(function () {
      return cargarProyectosDesdeSeed();
    })
    .catch(function () {
      state.proyectos.remotos = [];
      state.proyectos.indexError = true;
    })
    .then(function () {
      state.proyectos.ready = true;
      refrescarProyectos();
      pintarProyectos();
      refrescarListaColecciones();
      state.colecciones.ready = true;
      state.colecciones.indexError = state.proyectos.indexError;
      pintarColecciones();
    });
}

function claveColeccion(proyectoId, coleccionId) {
  return String(proyectoId || '') + '/' + String(coleccionId || '');
}

function coleccionAbierta() {
  if (!state.colecciones.abiertaKey) return null;
  return state.colecciones.lista.find(function (c) {
    return c.key === state.colecciones.abiertaKey;
  }) || null;
}

function conteoCamposPorColeccion() {
  const conteo = {};
  refrescarMongo();
  (state.mongo.lista || []).forEach(function (c) {
    if (!c || !c.coleccion) return;
    let proy = c.proyecto || '';
    if (!proy && c.baseDatos) {
      const match = (state.proyectos.lista || []).find(function (p) {
        return p.baseDatos && p.baseDatos === c.baseDatos;
      });
      if (match) proy = match.id;
    }
    if (!proy) return;
    const key = claveColeccion(proy, c.coleccion);
    conteo[key] = (conteo[key] || 0) + 1;
  });
  return conteo;
}

function construirListaColecciones(proyectos, conteo) {
  const out = [];
  (proyectos || []).forEach(function (p) {
    if (!p || p.legacyNegocio) return;
    (p.colecciones || []).forEach(function (c) {
      if (!c || !c.id) return;
      const key = claveColeccion(p.id, c.id);
      const row = {
        key: key,
        id: c.id,
        descripcion: c.descripcion || '',
        proyectoId: p.id,
        proyectoNombre: p.nombre || p.id,
        baseDatos: p.baseDatos || '',
        nCampos: conteo && conteo[key] != null ? conteo[key] : null
      };
      // Mismo attach que normalizarColeccionesProyecto — sin esto el catálogo
      // top-level Colecciones pierde el tinte (BD→Colecciones sí lo tenía).
      attachEntityColor(row, c);
      out.push(row);
    });
  });
  out.sort(function (a, b) {
    const pa = (a.proyectoId || '').localeCompare(b.proyectoId || '', 'es');
    if (pa !== 0) return pa;
    return (a.id || '').localeCompare(b.id || '', 'es');
  });
  return out;
}

/** Color vivo de una colección (lista catálogo o JSON del proyecto). */
function colorColeccionPorKey(key) {
  if (!key) return null;
  const fromLista = ((state.colecciones && state.colecciones.lista) || []).find(function (c) {
    return c.key === key;
  });
  if (fromLista && Object.prototype.hasOwnProperty.call(fromLista, 'color')) {
    return fromLista.color;
  }
  const parts = String(key).split('/');
  const proyId = parts[0];
  const colId = parts.slice(1).join('/');
  const proy = ((state.proyectos && state.proyectos.lista) || []).find(function (p) {
    return p.id === proyId;
  });
  const c = ((proy && proy.colecciones) || []).find(function (x) { return x.id === colId; });
  return c && Object.prototype.hasOwnProperty.call(c, 'color') ? c.color : null;
}

function refrescarListaColecciones() {
  refrescarProyectos();
  state.colecciones.lista = construirListaColecciones(
    state.proyectos.lista,
    conteoCamposPorColeccion()
  );
}

function coleccionesBridge() {
  return {
    getSnapshot: function () {
      const abierta = coleccionAbierta();
      return {
        ready: state.colecciones.ready,
        indexError: state.colecciones.indexError,
        colecciones: state.colecciones.lista,
        abierta: abierta ? { key: abierta.key } : null
      };
    },
    abrirColeccion: function (key) {
      abrirFichaColeccion(key, { volverA: { tipo: 'catalogo' } });
    }
  };
}

function pintarColecciones() {
  if (window.ColeccionesUI && typeof window.ColeccionesUI.refrescar === 'function') {
    window.ColeccionesUI.refrescar(coleccionesBridge());
  }
}

function cargarColecciones() {
  if (!state.proyectos.ready) {
    cargarProyectos();
    return;
  }
  if (!state.mongo.ready) cargarMongo();
  refrescarListaColecciones();
  state.colecciones.ready = true;
  state.colecciones.indexError = state.proyectos.indexError;
  pintarColecciones();
}

function seleccionarColAsocSub(id) {
  if (id !== 'base-datos' && id !== 'campos') id = 'base-datos';
  state.colecciones.asocSub = id;
  const tabs = document.querySelectorAll('#colAsociadosSubtabs [data-col-asoc-sub]');
  tabs.forEach(function (btn) {
    const on = btn.getAttribute('data-col-asoc-sub') === id;
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  document.querySelectorAll('#colPanelAsociados [data-col-asoc-pane]').forEach(function (pane) {
    pane.hidden = pane.getAttribute('data-col-asoc-pane') !== id;
  });
  if (id === 'base-datos') pintarColeccionBaseDatos(coleccionAbierta());
  if (id === 'campos') pintarColeccionCampos(coleccionAbierta());
}

function seleccionarColReaderTab(id) {
  if (id === 'base-datos' || id === 'campos') {
    state.colecciones.asocSub = id;
    id = 'asociados';
  }
  if (id !== 'resumen' && id !== 'diagrama' && id !== 'asociados') {
    id = 'resumen';
  }
  state.colecciones.tab = id;
  const tabs = document.querySelectorAll('#colReaderTabs [data-col-tab]');
  const panels = {
    resumen: document.getElementById('colPanelResumen'),
    diagrama: document.getElementById('colPanelDiagrama'),
    asociados: document.getElementById('colPanelAsociados')
  };
  tabs.forEach(function (btn) {
    const on = btn.getAttribute('data-col-tab') === id;
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  Object.keys(panels).forEach(function (k) {
    if (panels[k]) panels[k].hidden = k !== id;
  });
  if (id === 'diagrama') cargarColeccionDiagrama(coleccionAbierta());
  if (id === 'asociados') seleccionarColAsocSub(state.colecciones.asocSub || 'base-datos');
}

function cargarMermaidLib() {
  if (window.mermaid) return Promise.resolve(window.mermaid);
  if (state.colecciones._mermaidPromise) return state.colecciones._mermaidPromise;
  state.colecciones._mermaidPromise = new Promise(function (resolve, reject) {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js';
    s.async = true;
    s.onload = function () {
      if (!window.mermaid) {
        reject(new Error('mermaid'));
        return;
      }
      try {
        window.mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'default'
        });
      } catch (err) {}
      resolve(window.mermaid);
    };
    s.onerror = function () { reject(new Error('mermaid-load')); };
    document.head.appendChild(s);
  });
  return state.colecciones._mermaidPromise;
}

function renderMermaidEn(el, fuente, tokenRef) {
  if (!el) return Promise.resolve();
  el.replaceChildren();
  el.hidden = false;
  const token = ++state.colecciones.diagramaToken;
  if (tokenRef) tokenRef.current = token;
  return cargarMermaidLib()
    .then(function (mermaid) {
      if (token !== state.colecciones.diagramaToken) return;
      const renderId = 'colErSvg' + token;
      return Promise.resolve(mermaid.render(renderId, fuente)).then(function (res) {
        if (token !== state.colecciones.diagramaToken) return;
        const svg = res && res.svg ? res.svg : '';
        if (!svg) throw new Error('sin-svg');
        el.innerHTML = svg;
      });
    })
    .catch(function () {
      if (token !== state.colecciones.diagramaToken) return;
      const pre = document.createElement('pre');
      pre.className = 'proy-mermaid-src';
      pre.textContent = fuente || '';
      el.replaceChildren(pre);
    });
}

function abrirMongoDesdeColeccionDiagrama(campoId) {
  const colKey = state.colecciones.abiertaKey;
  if (!campoId) return;
  if (colKey) {
    state.colecciones.volverA = null;
    state.colecciones.navigatingAway = true;
    state.mongo.reabrirColeccionKey = colKey;
    state.mongo.reabrirColeccionTab = 'diagrama';
  }
  abrirFichaMongo(campoId);
}

function pintarColeccionDiagramaCampos(col, camposFocus) {
  const lista = document.getElementById('colDiagramaCamposLista');
  if (!lista) return;
  lista.replaceChildren();
  const campos = Array.isArray(camposFocus) ? camposFocus : [];
  if (!campos.length) {
    const vacio = el('p', 'ancla-ficha-vacio', 'Sin campos catalogados en esta colección.');
    vacio.style.margin = '0';
    lista.append(vacio);
    return;
  }
  refrescarMongo();
  campos.forEach(function (f) {
    const clave = String((f && f.clave) || '').trim() || '?';
    const bson = String((f && f.bsonType) || 'string').trim() || 'string';
    const obligatorio = !!(f && f.obligatorio);
    const match = (state.mongo.lista || []).find(function (c) {
      if (!c || c.coleccion !== col.id || c.clave !== clave) return false;
      if (c.proyecto && col.proyectoId && c.proyecto !== col.proyectoId) return false;
      return true;
    }) || null;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'col-diagrama-campo col-diagrama-campo-con-icono'
      + (obligatorio ? ' is-req' : '')
      + (match ? '' : ' is-static');
    btn.setAttribute('role', 'listitem');
    btn.title = match
      ? ('Abrir campo Mongo ' + col.id + '.' + clave)
      : (col.id + '.' + clave);
    btn.setAttribute('aria-label', btn.title);
    // Mismo Lucide cilindro que catálogo Campos / svgPestanaCatalogo('mongo').
    const iconWrap = el('span', 'catalogo-fila-icon', null);
    iconWrap.setAttribute('aria-hidden', 'true');
    const svg = svgPestanaCatalogo('mongo');
    svg.setAttribute('class', 'catalogo-fila-svg');
    iconWrap.append(svg);
    const texto = el('span', 'col-diagrama-campo-texto', null);
    texto.append(el('span', 'col-diagrama-campo-clave', clave));
    texto.append(el('span', 'col-diagrama-campo-tipo', bson + (obligatorio ? ' · obligatorio' : '')));
    btn.append(iconWrap, texto);
    if (match) {
      btn.addEventListener('click', function () {
        abrirMongoDesdeColeccionDiagrama(match.id);
      });
    } else {
      btn.disabled = true;
    }
    lista.append(btn);
  });
}

function cargarColeccionDiagrama(col) {
  const estado = document.getElementById('colDiagramaEstado');
  const render = document.getElementById('colDiagramaRender');
  const split = document.getElementById('colDiagramaSplit');
  const lista = document.getElementById('colDiagramaCamposLista');
  if (!col || !col.proyectoId) {
    if (estado) {
      estado.hidden = false;
      estado.textContent = 'Sin base de datos padre para dibujar el diagrama.';
    }
    if (split) split.hidden = true;
    if (render) render.replaceChildren();
    if (lista) lista.replaceChildren();
    return;
  }
  if (estado) {
    estado.hidden = false;
    estado.textContent = 'Cargando diagrama…';
  }
  if (split) split.hidden = true;
  if (render) render.replaceChildren();
  if (lista) lista.replaceChildren();
  const url = '/v1/proyectos/' + encodeURIComponent(col.proyectoId)
    + '/diagrama?coleccion=' + encodeURIComponent(col.id);
  apiFetch(url)
    .then(function (data) {
      const abierta = coleccionAbierta();
      if (!abierta || abierta.key !== col.key) return;
      const tabOn = document.querySelector('#colReaderTabs [data-col-tab="diagrama"].is-on');
      if (!tabOn) return;
      const d = data && data.diagrama ? data.diagrama : data;
      if (!d) throw new Error('sin diagrama');
      const cols = d.colecciones || [];
      if (!cols.length) {
        if (estado) {
          estado.hidden = false;
          estado.textContent = 'No hay entidades para esta colección.';
        }
        return;
      }
      if (estado) estado.hidden = true;
      if (split) split.hidden = false;
      const focus = cols.find(function (c) { return c && c.id === col.id; }) || cols[0];
      pintarColeccionDiagramaCampos(col, (focus && focus.campos) || []);
      if (render) {
        renderMermaidEn(render, d.mermaid || 'erDiagram\n');
      }
    })
    .catch(function () {
      const abierta = coleccionAbierta();
      if (!abierta || abierta.key !== col.key) return;
      if (split) split.hidden = true;
      if (estado) {
        estado.hidden = false;
        estado.textContent = 'No se pudo cargar el diagrama de esta colección.';
      }
    });
}

function abrirProyectoDesdeColeccion(proyId) {
  const colKey = state.colecciones.abiertaKey;
  if (!proyId || !colKey) {
    abrirProyecto(proyId);
    return;
  }
  // Evita que el cierre de dlgColeccion salte al catálogo / reabra otro origen.
  state.colecciones.volverA = null;
  state.colecciones.navigatingAway = true;
  state.proyectos.reabrirColeccionKey = colKey;
  state.proyectos.reabrirColeccionTab = 'base-datos';
  abrirProyecto(proyId);
}

function pintarColeccionBaseDatos(col) {
  const mount = document.getElementById('colBaseDatosLista');
  if (!mount || !col || !window.ProyectosUI || !window.ProyectosUI.montarLista) return;

  refrescarProyectos();
  const proy = (state.proyectos.lista || []).find(function (p) {
    return p.id === col.proyectoId;
  }) || null;

  function bridgeCon(proyectos, ready, indexError) {
    return {
      getSnapshot: function () {
        return {
          ready: ready,
          indexError: !!indexError,
          proyectos: proyectos || [],
          abierta: null
        };
      },
      añadirProyecto: function () {},
      abrirProyecto: function (id) { abrirProyectoDesdeColeccion(id); }
    };
  }

  if (!proy) {
    window.ProyectosUI.montarLista(mount, bridgeCon([], true, false), {
      emptyMsg: 'No se encontró la base de datos padre.'
    });
    return;
  }

  window.ProyectosUI.montarLista(mount, bridgeCon([proy], true, false), {
    emptyMsg: 'Sin base de datos padre.'
  });
}

function abrirDialogoMongoDesdeColeccion(col) {
  if (!col) return;
  abrirDialogoMongo();
  const form = document.getElementById('formMongo');
  if (!form) return;
  if (form.coleccion) form.coleccion.value = col.id || '';
  if (form.baseDatos) form.baseDatos.value = col.baseDatos || '';
  if (form.clave) form.clave.focus();
}

function pintarColeccionCampos(col) {
  const mount = document.getElementById('colCamposLista');
  const cta = document.getElementById('colCamposCta');
  const nota = document.getElementById('colCamposNota');
  if (!mount || !col || !window.CamposMongoUI || !window.CamposMongoUI.montarLista) return;

  function bridgeCon(campos, ready, indexError) {
    return {
      getSnapshot: function () {
        return {
          ready: ready,
          indexError: !!indexError,
          campos: campos || [],
          abierta: null
        };
      },
      abrirCampo: function (id) { abrirFichaMongo(id); },
      añadirCampo: function () { abrirDialogoMongoDesdeColeccion(col); }
    };
  }

  if (cta) {
    cta.hidden = false;
    cta.onclick = function () { abrirDialogoMongoDesdeColeccion(col); };
  }
  if (nota) {
    nota.hidden = true;
    nota.textContent = '';
  }

  window.CamposMongoUI.montarLista(mount, bridgeCon([], false, false), {
    emptyMsg: 'Cargando campos…'
  });

  apiFetch('/v1/mongo?proyecto=' + encodeURIComponent(col.proyectoId))
    .then(function (data) {
      const abierta = coleccionAbierta();
      if (!abierta || abierta.key !== col.key) return;
      const tabOn = document.querySelector('#colReaderTabs [data-col-tab="campos"].is-on');
      if (!tabOn) return;
      const raw = (data && data.campos) || [];
      const campos = raw.map(normalizeMongoCampo).filter(function (c) {
        return c && c.coleccion === col.id;
      });
      const emptyMsg = campos.length
        ? 'Sin campos Mongo en esta colección.'
        : (col.id === 'reservas'
          ? 'La colección reservas no tiene campos en el catálogo todavía.'
          : 'Sin campos Mongo en esta colección. Usa «Añadir campo» para crear el primero.');
      window.CamposMongoUI.montarLista(mount, bridgeCon(campos, true, false), {
        emptyMsg: emptyMsg
      });
      if (nota && !campos.length && col.id === 'reservas') {
        nota.hidden = false;
        nota.textContent = 'Nota: el cajón reservas está declarado en el esquema pero aún no tiene campos Mongo.';
      }
    })
    .catch(function () {
      const abierta = coleccionAbierta();
      if (!abierta || abierta.key !== col.key) return;
      window.CamposMongoUI.montarLista(mount, bridgeCon([], true, true), {
        emptyMsg: 'No se pudieron cargar los campos.'
      });
    });
}

function renderColeccionReader(col) {
  const nombre = document.getElementById('colReaderNombre');
  const sub = document.getElementById('colReaderSub');
  const idEl = document.getElementById('colReaderId');
  const descEl = document.getElementById('colReaderDesc');
  const padreEl = document.getElementById('colReaderPadre');
  if (nombre) nombre.textContent = (col && col.id) || '—';
  if (sub) {
    const partes = [];
    if (col && col.proyectoNombre) partes.push(col.proyectoNombre);
    if (col && col.baseDatos) partes.push(col.baseDatos);
    sub.textContent = partes.length ? partes.join(' · ') : 'Colección';
  }
  if (idEl) idEl.textContent = (col && col.id) || '—';
  if (descEl) descEl.textContent = (col && col.descripcion) || '—';
  if (padreEl) {
    const padre = col
      ? ((col.proyectoId || '') + (col.baseDatos ? ' · ' + col.baseDatos : ''))
      : '—';
    padreEl.textContent = padre || '—';
  }
  seleccionarColReaderTab(state.colecciones.tab || 'resumen');
}

function abrirFichaColeccion(key, opts) {
  opts = opts || {};
  refrescarListaColecciones();
  let col = state.colecciones.lista.find(function (c) { return c.key === key; }) || null;
  if (!col && opts.coleccion) col = opts.coleccion;
  if (!col) return;

  let volverA = opts.volverA || null;
  if (!volverA) {
    const dlgProy = document.getElementById('dlgProyecto');
    if (dlgProy && dlgProy.open && state.proyectos.abiertoId) {
      volverA = { tipo: 'proyecto', id: state.proyectos.abiertoId };
    } else {
      volverA = { tipo: 'catalogo' };
    }
  }

  state.colecciones.abiertaKey = col.key;
  state.colecciones.volverA = volverA;
  state.colecciones.tab = 'resumen';
  renderColeccionReader(col);
  const dlgCol = document.getElementById('dlgColeccion');
  openFichaPane(dlgCol);
  const colKey = col.key;
  cablearColorFicha(dlgCol, {
    kind: 'coleccion',
    id: colKey,
    iconKind: 'coleccion',
    getColor: function () { return colorColeccionPorKey(colKey); },
    getUsados: function () { return coloresUsadosCatalogo('coleccion', colKey); },
    onSaved: function (hex) {
      col.color = hex;
      const cur = ((state.colecciones && state.colecciones.lista) || []).find(function (c) {
        return c.key === colKey;
      });
      if (cur) cur.color = hex;
    }
  });
  const focus = document.getElementById('colReaderNombre');
  if (focus) focus.focus();
  pintarColecciones();
}

function cerrarFichaColeccion() {
  const dlg = document.getElementById('dlgColeccion');
  if (dlg && dlg.open) {
    dlg.close();
    return;
  }
  state.colecciones.abiertaKey = null;
  state.colecciones.volverA = null;
  pintarColecciones();
}

function alCerrarFichaColeccion() {
  if (state.colecciones.navigatingAway) {
    state.colecciones.navigatingAway = false;
    state.colecciones.abiertaKey = null;
    state.colecciones.volverA = null;
    pintarColecciones();
    return;
  }
  const volver = state.colecciones.volverA;
  state.colecciones.abiertaKey = null;
  state.colecciones.volverA = null;
  state.colecciones.tab = 'resumen';
  pintarColecciones();
  if (volver && volver.tipo === 'proyecto' && volver.id) {
    const tabVolver = volver.tab || 'colecciones';
    setTimeout(function () {
      abrirProyecto(volver.id);
      seleccionarProyReaderTab(tabVolver);
    }, 0);
    return;
  }
  if (volver && volver.tipo === 'mongo' && volver.id) {
    setTimeout(function () {
      state.mongo.initialTab = 'coleccion';
      abrirFichaMongo(volver.id);
    }, 0);
    return;
  }
  if (volver && volver.tipo === 'catalogo' && state.catalogoId !== 'colecciones') {
    seleccionarCatalogo('colecciones');
  }
}

function wireColeccionesUi() {
  const btnAtras = document.getElementById('btnAtrasColeccion');
  if (btnAtras) {
    btnAtras.addEventListener('click', function () {
      atrasDesdeFicha(cerrarFichaColeccion);
    });
  }
  const tabs = document.getElementById('colReaderTabs');
  if (tabs) {
    tabs.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-col-tab]');
      if (!btn) return;
      seleccionarColReaderTab(btn.getAttribute('data-col-tab'));
    });
  }
  const asocTabs = document.getElementById('colAsociadosSubtabs');
  if (asocTabs) {
    asocTabs.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-col-asoc-sub]');
      if (!btn) return;
      seleccionarColAsocSub(btn.getAttribute('data-col-asoc-sub'));
    });
  }
  const dlg = document.getElementById('dlgColeccion');
  if (dlg) dlg.addEventListener('close', alCerrarFichaColeccion);
}

function wireClustersUi() {
  const btnCerrar = document.getElementById('btnCerrarCluster');
  if (btnCerrar) btnCerrar.addEventListener('click', cerrarClusterModal);
  const btnAtras = document.getElementById('btnAtrasCluster');
  if (btnAtras) btnAtras.addEventListener('click', function () { atrasDesdeFicha(cerrarClusterModal); });
  const btnEditar = document.getElementById('btnEditarCluster');
  if (btnEditar) btnEditar.addEventListener('click', function () {
    if (!state.clusters.abiertoId) return;
    abrirDialogoEditarCluster(state.clusters.abiertoId);
  });
  const btnEliminar = document.getElementById('btnEliminarCluster');
  if (btnEliminar) btnEliminar.addEventListener('click', function () {
    if (!state.clusters.abiertoId) return;
    abrirDialogoEliminar({ tipo: 'cluster', id: state.clusters.abiertoId });
  });
  const tabs = document.getElementById('clusterReaderTabs');
  if (tabs) tabs.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-cluster-tab]');
    if (!btn) return;
    seleccionarClusterReaderTab(btn.getAttribute('data-cluster-tab'));
  });
  const asocTabs = document.getElementById('clusterAsociadosSubtabs');
  if (asocTabs) asocTabs.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-cluster-asoc-sub]');
    if (!btn) return;
    seleccionarClusterAsocSub(btn.getAttribute('data-cluster-asoc-sub'));
  });
  const formConexion = document.getElementById('formClusterConexion');
  if (formConexion) formConexion.addEventListener('submit', onGuardarClusterConexion);
  const autoSyncToggle = document.getElementById('clusterAutoSyncToggle');
  if (autoSyncToggle) autoSyncToggle.addEventListener('change', onToggleClusterAutoSync);
  const btnProbar = document.getElementById('clusterConexionProbar');
  if (btnProbar) btnProbar.addEventListener('click', onProbarClusterConexion);
  const btnBorrar = document.getElementById('clusterConexionBorrar');
  if (btnBorrar) btnBorrar.addEventListener('click', onBorrarClusterConexion);
  const resumenCta = document.getElementById('clusterResumenConexionCta');
  if (resumenCta) resumenCta.addEventListener('click', function () {
    seleccionarClusterReaderTab('conexion');
  });
  const formNuevo = document.getElementById('formNuevoCluster');
  if (formNuevo) formNuevo.addEventListener('submit', onSubmitNuevoCluster);
  const nuevoCancel = document.getElementById('nuevoClusterCancelar');
  if (nuevoCancel) nuevoCancel.addEventListener('click', function () {
    document.getElementById('dlgNuevoCluster').close();
  });
  const formEditar = document.getElementById('formEditarCluster');
  if (formEditar) formEditar.addEventListener('submit', onSubmitEditarCluster);
  const editarCancel = document.getElementById('editarClusterCancelar');
  if (editarCancel) editarCancel.addEventListener('click', function () {
    document.getElementById('dlgEditarCluster').close();
  });
  const dlg = document.getElementById('dlgCluster');
  if (dlg) dlg.addEventListener('close', function () {
    state.clusters.abiertoId = null;
    state.clusters.tab = 'resumen';
    pintarClusters();
  });
}

function wireProyectosUi() {
  const btnCerrar = document.getElementById('btnCerrarProyecto');
  if (btnCerrar) btnCerrar.addEventListener('click', cerrarProyectoModal);
  const btnAtrasProyecto = document.getElementById('btnAtrasProyecto');
  if (btnAtrasProyecto) btnAtrasProyecto.addEventListener('click', function () { atrasDesdeFicha(cerrarProyectoModal); });
  const btnEditar = document.getElementById('btnEditarProyecto');
  if (btnEditar) btnEditar.addEventListener('click', function () {
    if (!state.proyectos.abiertoId) return;
    abrirDialogoEditarProyecto(state.proyectos.abiertoId);
  });
  const btnEliminarProy = document.getElementById('btnEliminarProyecto');
  if (btnEliminarProy) btnEliminarProy.addEventListener('click', function () {
    if (!state.proyectos.abiertoId) return;
    abrirDialogoEliminar({ tipo: 'proyecto', id: state.proyectos.abiertoId });
  });
  const btnHistProy = document.getElementById('btnHistorialProyecto');
  if (btnHistProy) btnHistProy.addEventListener('click', function () {
    if (!state.proyectos.abiertoId) return;
    state.proyectos.historial = !state.proyectos.historial;
    const proy = proyectoAbierto();
    if (proy) renderHistorialProyecto(proy, versionProyectoAbierta(proy));
  });
  const histProyLista = document.getElementById('historialProyectoLista');
  if (histProyLista) histProyLista.addEventListener('click', function (e) {
    const b = e.target.closest('[data-numero]');
    if (!b || !state.proyectos.abiertoId) return;
    state.proyectos.historial = false;
    abrirProyecto(state.proyectos.abiertoId, Number(b.dataset.numero));
  });
  const btnEditSkills = document.getElementById('btnEditarProyectoSkills');
  if (btnEditSkills) btnEditSkills.addEventListener('click', abrirDialogoEditarProyectoSkills);
  const btnCrearBd = document.getElementById('btnCrearBdProyecto');
  if (btnCrearBd) btnCrearBd.addEventListener('click', onCrearBaseDatosProyecto);
  const btnEmpujarTab = document.getElementById('btnEmpujarEsquemaTab');
  if (btnEmpujarTab) btnEmpujarTab.addEventListener('click', onCrearBaseDatosProyecto);
  const btnHistFiltrar = document.getElementById('btnProyHistorialFiltrar');
  if (btnHistFiltrar) btnHistFiltrar.addEventListener('click', function () {
    const proy = proyectoAbierto();
    if (!proy) return;
    cargarProyectoHistorialEmpujes(proy, { reset: true });
  });
  const btnHistMas = document.getElementById('btnProyHistorialMas');
  if (btnHistMas) btnHistMas.addEventListener('click', function () {
    const proy = proyectoAbierto();
    if (!proy) return;
    cargarProyectoHistorialEmpujes(proy, { append: true, reset: false });
  });
  const histLista = document.getElementById('proyHistorialLista');
  if (histLista) histLista.addEventListener('click', function (e) {
    const row = e.target.closest('[data-empuje-id]');
    if (!row || !histLista.contains(row)) return;
    // onClick de filaCatalogoLista ya alterna; este listener cubre el fallback sin helper
    if (typeof filaCatalogoLista === 'function' && row.classList.contains('catalogo-fila')) return;
    const id = row.getAttribute('data-empuje-id');
    const st = state.proyectos.empujes;
    st.openId = st.openId === id ? null : id;
    pintarProyectoHistorialTabla();
  });
  const proyTabs = document.getElementById('proyReaderTabs');
  if (proyTabs) proyTabs.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-proy-tab]');
    if (!btn) return;
    seleccionarProyReaderTab(btn.getAttribute('data-proy-tab'));
  });
  const proyAsocTabs = document.getElementById('proyAsociadosSubtabs');
  if (proyAsocTabs) proyAsocTabs.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-proy-asoc-sub]');
    if (!btn) return;
    seleccionarProyAsocSub(btn.getAttribute('data-proy-asoc-sub'));
  });
  const editarProyTabs = document.getElementById('editarProyTabs');
  if (editarProyTabs) editarProyTabs.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-editar-proy-tab]');
    if (!btn) return;
    seleccionarEditarProyTab(btn.getAttribute('data-editar-proy-tab'));
  });
  const formNuevo = document.getElementById('formNuevoProyecto');
  if (formNuevo) formNuevo.addEventListener('submit', onSubmitNuevoProyecto);
  const nuevoCancel = document.getElementById('nuevoProyectoCancelar');
  if (nuevoCancel) nuevoCancel.addEventListener('click', function () {
    document.getElementById('dlgNuevoProyecto').close();
  });
  const formEditar = document.getElementById('formEditarProyecto');
  if (formEditar) formEditar.addEventListener('submit', onSubmitEditarProyecto);
  const editarCancel = document.getElementById('editarProyectoCancelar');
  if (editarCancel) editarCancel.addEventListener('click', function () {
    document.getElementById('dlgEditarProyecto').close();
  });
  const formSkills = document.getElementById('formEditarProyectoSkills');
  if (formSkills) formSkills.addEventListener('submit', onSubmitEditarProyectoSkills);
  const skillsCancel = document.getElementById('editarProyectoSkillsCancelar');
  if (skillsCancel) skillsCancel.addEventListener('click', function () {
    document.getElementById('dlgEditarProyectoSkills').close();
  });
  const proyHashBtn = document.getElementById('proyHashBtn');
  if (proyHashBtn) proyHashBtn.addEventListener('click', function () {
    const full = proyHashBtn.dataset.hash || '';
    if (!full) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(full).catch(function () {});
    }
  });
  const dlgProyecto = document.getElementById('dlgProyecto');
  if (dlgProyecto) dlgProyecto.addEventListener('close', function () {
    const reabrirKey = state.proyectos.reabrirColeccionKey;
    const reabrirTab = state.proyectos.reabrirColeccionTab || 'base-datos';
    const reabrirSkill = state.reabrirSkillTrasProyecto;
    state.proyectos.reabrirColeccionKey = null;
    state.proyectos.reabrirColeccionTab = null;
    state.reabrirSkillTrasProyecto = null;
    state.proyectos.abiertoId = null;
    state.proyectos.abiertaNumero = null;
    state.proyectos.historial = false;
    pintarProyectos();
    if (reabrirKey) {
      setTimeout(function () {
        abrirFichaColeccion(reabrirKey, { volverA: { tipo: 'catalogo' } });
        seleccionarColReaderTab(reabrirTab);
      }, 0);
      return;
    }
    if (reabrirSkill) {
      setTimeout(function () { abrirInstruccion(reabrirSkill); }, 0);
    }
  });
  document.addEventListener('click', function (e) {
    if (state.proyectos.historial && !e.target.closest('#historialProyecto') && !e.target.closest('#btnHistorialProyecto')) {
      state.proyectos.historial = false;
      const proy = proyectoAbierto();
      if (proy) renderHistorialProyecto(proy, versionProyectoAbierta(proy));
    }
  });
}

function abrirDialogoEditarAgente(id) {
  refrescarAgentes();
  const ag = state.agentes.lista.find(function (a) { return a.id === id; });
  if (!ag) return;
  const dlg = document.getElementById('dlgEditarAgente');
  const form = document.getElementById('formEditarAgente');
  if (!dlg || !form) return;
  form.dataset.id = ag.id;
  form.nombre.value = ag.nombre || '';
  form.foto.value = ag.foto || '';
  const err = document.getElementById('editarAgenteError');
  if (err) err.textContent = '';
  dlg.showModal();
  form.nombre.focus();
}

function onSubmitEditarAgente(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const error = document.getElementById('editarAgenteError');
  if (error) error.textContent = '';
  const id = form.dataset.id;
  const nombre = form.nombre.value.trim();
  if (!nombre) {
    if (error) error.textContent = 'Escribe un nombre.';
    return;
  }
  const foto = form.foto.value.trim();
  refrescarAgentes();
  const actual = state.agentes.lista.find(function (a) { return a.id === id; });
  if (!actual) {
    if (error) error.textContent = 'No está ese agente.';
    return;
  }
  try {
    const store = leerAgentesStore();
    let entrada = store.agentes.find(function (a) { return a && a.id === id; });
    if (!entrada) {
      entrada = {
        id: id,
        nombre: nombre,
        foto: foto,
        lastSeen: actual.lastSeen || '',
        inviteUsada: actual.inviteUsada || '',
        demoEnLinea: !!actual.demoEnLinea
      };
      store.agentes.push(entrada);
    } else {
      entrada.nombre = nombre;
      entrada.foto = foto;
    }
    if (actual.descripcion) entrada.descripcion = actual.descripcion;
    guardarAgentesLocal(store);
    document.getElementById('dlgEditarAgente').close();
    const clave = (actual.inviteUsada || state.agentes.inviteActual || '').trim();
    const afterLocal = function () {
      sincronizarAgentesSilencioso().then(function () {
        if (state.agentes.abiertoId === id) renderAgenteReader();
      });
    };
    if (clave) {
      apiFetch('/v1/agentes/' + encodeURIComponent(id), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + clave
        },
        body: JSON.stringify({ nombre: nombre, foto: foto })
      }).then(afterLocal).catch(afterLocal);
    } else {
      refrescarAgentes();
      pintarAgentes();
      if (state.agentes.abiertoId === id) renderAgenteReader();
    }
  } catch (err) {
    if (error) showApiErrorRaw(error, err, { kind: 'is-err', statusLabel: true });
  }
}

function agenteEnLinea(ag) {
  if (!ag) return false;
  if (ag.demoEnLinea) return true;
  if (!ag.lastSeen) return false;
  const t = Date.parse(ag.lastSeen);
  if (!Number.isFinite(t)) return false;
  return (Date.now() - t) <= AGENTE_LATIDO_MS;
}

function normalizeAgente(item) {
  if (!item || typeof item !== 'object') return null;
  if (typeof item.id !== 'string' || !item.id.trim()) return null;
  if (typeof item.nombre !== 'string' || !item.nombre.trim()) return null;
  const out = {
    id: item.id.trim(),
    nombre: item.nombre.trim(),
    foto: typeof item.foto === 'string' ? item.foto.trim() : '',
    lastSeen: typeof item.lastSeen === 'string' ? item.lastSeen : '',
    inviteUsada: typeof item.inviteUsada === 'string' ? item.inviteUsada.trim() : '',
    demoEnLinea: !!item.demoEnLinea,
    proyectos: Array.isArray(item.proyectos)
      ? item.proyectos.map(function (p) { return String(p || '').trim(); }).filter(Boolean)
      : [],
    lee: Array.isArray(item.lee)
      ? item.lee.map(function (a) { return String(a || '').trim(); }).filter(Boolean)
      : [],
    escribe: Array.isArray(item.escribe)
      ? item.escribe.map(function (a) { return String(a || '').trim(); }).filter(Boolean)
      : []
  };
  if (typeof item.descripcion === 'string' && item.descripcion.trim()) {
    out.descripcion = item.descripcion.trim().slice(0, 280);
  }
  const hash = normalizarHash(item.hash);
  out.hash = hash || hashFnvHex(out.id + '|' + out.nombre + '|' + out.inviteUsada);
  attachEntityColor(out, item);
  return out;
}

function enmascararInvite(clave) {
  const s = String(clave || '').trim();
  if (!s) return '—';
  if (s.length <= 8) return s.slice(0, 3) + '…';
  return s.slice(0, 4) + '…' + s.slice(-4);
}

function pintarListaAclAgente(elId, items, vacio) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.replaceChildren();
  const list = Array.isArray(items) ? items : [];
  if (!list.length) {
    el.textContent = vacio || '—';
    return;
  }
  const wrap = document.createElement('div');
  wrap.className = 'agente-acl-pills';
  list.forEach(function (t) {
    const code = document.createElement('code');
    code.className = 'ancla-pill';
    code.textContent = t;
    wrap.append(code);
  });
  el.append(wrap);
}

function normalizeAgentesIndice(data) {
  const list = Array.isArray(data) ? data : (data && Array.isArray(data.agentes) ? data.agentes : []);
  const out = [];
  const seen = new Set();
  list.forEach(function (item) {
    const ag = normalizeAgente(item);
    if (!ag || seen.has(ag.id)) return;
    seen.add(ag.id);
    ag.origen = 'indice';
    out.push(ag);
  });
  return out;
}

function leerAgentesStore() {
  try {
    const raw = localStorage.getItem(LS_AGENTES);
    if (!raw) return { agentes: [], invites: [], eliminados: [] };
    const data = JSON.parse(raw);
    return {
      agentes: Array.isArray(data.agentes) ? data.agentes : [],
      invites: Array.isArray(data.invites) ? data.invites : [],
      eliminados: idsEliminados(data.eliminados)
    };
  } catch (e) {
    return { agentes: [], invites: [], eliminados: [] };
  }
}

function guardarAgentesLocal(store) {
  const json = JSON.stringify(store);
  if (json.length > 4500000) throw new Error('No cabe en el almacenamiento de este navegador.');
  try {
    localStorage.setItem(LS_AGENTES, json);
  } catch (e) {
    throw new Error('No cabe en el almacenamiento de este navegador.');
  }
}

function mergeAgentes(remotas, locales, eliminados) {
  const ban = new Set(Array.isArray(eliminados) ? eliminados : []);
  const map = new Map();
  remotas.forEach(function (ag) {
    if (ban.has(ag.id)) return;
    map.set(ag.id, Object.assign({}, ag));
  });
  locales.forEach(function (raw) {
    const ag = normalizeAgente(raw);
    if (!ag || ban.has(ag.id)) return;
    ag.origen = 'local';
    const prev = map.get(ag.id);
    if (!prev) {
      map.set(ag.id, ag);
      return;
    }
    map.set(ag.id, Object.assign({}, prev, ag, {
      origen: prev.origen === 'indice' ? 'indice' : 'local',
      demoEnLinea: !!(prev.demoEnLinea || ag.demoEnLinea)
    }));
  });
  return Array.from(map.values()).map(function (ag) {
    ag.enLinea = agenteEnLinea(ag);
    return ag;
  }).sort(function (a, b) {
    if (a.enLinea !== b.enLinea) return a.enLinea ? -1 : 1;
    return a.nombre.localeCompare(b.nombre, 'es');
  });
}

function refrescarAgentes() {
  const store = leerAgentesStore();
  state.agentes.lista = mergeAgentes(state.agentes.remotos, store.agentes, store.eliminados);
}

function textoAgentesActualizado() {
  const t = state.agentes.lastSyncAt;
  if (!t) return '';
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 6) return 'Actualizado ahora';
  if (s < 60) return 'Actualizado hace ' + s + ' s';
  const m = Math.floor(s / 60);
  return 'Actualizado hace ' + m + ' min';
}

function agentesCatalogoVisible() {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return false;
  const ajustes = document.getElementById('ajustes');
  if (!ajustes || ajustes.hidden) return false;
  const panel = document.getElementById('panel-agentes');
  if (panel && panel.hidden) return false;
  return true;
}

/** Abre/refresca el catálogo Agentes dentro de Ajustes. */
function mostrarAgentesAjustes() {
  refrescarAgentes();
  pintarAgentes();
  arrancarPollAgentes();
}
window.mostrarAgentesAjustes = mostrarAgentesAjustes;

function detenerPollAgentes() {
  if (state.agentes.pollTimer) {
    clearInterval(state.agentes.pollTimer);
    state.agentes.pollTimer = null;
  }
}

/** Silent in-place refresh from GET /v1/agentes — no loading spinner. */
function sincronizarAgentesSilencioso() {
  if (state.agentes.pollInflight) return Promise.resolve(state.agentes.lista);
  state.agentes.pollInflight = true;
  return apiFetch('/v1/agentes')
    .then(function (data) {
      state.agentes.remotos = normalizeAgentesIndice(data);
      state.agentes.indexError = false;
      state.agentes.fuente = 'api';
    })
    .catch(function () {
      /* Keep last known list; still recompute En línea from lastSeen. */
    })
    .then(function () {
      state.agentes.pollInflight = false;
      state.agentes.lastSyncAt = Date.now();
      refrescarAgentes();
      if (state.agentes.abiertoId) renderAgenteReader();
      pintarAgentes();
      return state.agentes.lista;
    });
}

function arrancarPollAgentes() {
  detenerPollAgentes();
  if (!agentesCatalogoVisible()) return;
  sincronizarAgentesSilencioso();
  state.agentes.pollTimer = setInterval(function () {
    if (!agentesCatalogoVisible()) {
      detenerPollAgentes();
      return;
    }
    sincronizarAgentesSilencioso();
  }, AGENTE_POLL_MS);
}

function agentesBridge() {
  return {
    getSnapshot: function () {
      const abierta = state.agentes.abiertoId
        ? state.agentes.lista.find(function (a) { return a.id === state.agentes.abiertoId; }) || null
        : null;
      return {
        ready: state.agentes.ready,
        indexError: state.agentes.indexError,
        agentes: state.agentes.lista,
        abierta: abierta ? { id: abierta.id } : null,
        syncLabel: textoAgentesActualizado()
      };
    },
    darAcceso: function () { abrirDialogoDarAcceso(); },
    abrirAgente: function (id) {
      if (state.agentes.abiertoId === id) {
        const dlg = document.getElementById('dlgAgenteFicha');
        if (dlg && dlg.open) {
          cerrarAgenteModal();
          return;
        }
      }
      abrirAgente(id);
    }
  };
}

function pintarAgentes() {
  if (window.AgentesUI && typeof window.AgentesUI.refrescar === 'function') {
    window.AgentesUI.refrescar(agentesBridge());
  }
}

function apiBaseUrl() {
  if (typeof window !== 'undefined' && window.ARQ_API_BASE) return String(window.ARQ_API_BASE).replace(/\/$/, '');
  try {
    const ls = localStorage.getItem('API_BASE') || localStorage.getItem('ARQ_API_BASE');
    if (ls) return String(ls).replace(/\/$/, '');
  } catch (e) {}
  if (typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1)$/i.test(location.hostname || '')) {
    return 'http://127.0.0.1:8787';
  }
  return 'https://campos-ancla-api.web-legal-es.workers.dev';
}

/**
 * Formatea el body de error de API tal cual llega: JSON pretty si parsea; si no, texto crudo.
 * Sin wrappers tipo "Error: failed to…". Preferencia 2026-10-23.
 */
function formatApiErrorRaw(errOrBody, statusHint) {
  let status = statusHint;
  let rawBody = '';
  let data = null;

  if (errOrBody && typeof errOrBody === 'object' && !(errOrBody instanceof Error) &&
      !Object.prototype.hasOwnProperty.call(errOrBody, 'rawBody') &&
      !Object.prototype.hasOwnProperty.call(errOrBody, 'status') &&
      (Object.prototype.hasOwnProperty.call(errOrBody, 'error') ||
        Object.prototype.hasOwnProperty.call(errOrBody, 'ok'))) {
    data = errOrBody;
  } else if (errOrBody instanceof Error || (errOrBody && typeof errOrBody === 'object')) {
    const err = errOrBody;
    if (typeof err.status === 'number') status = err.status;
    if (typeof err.rawBody === 'string') rawBody = err.rawBody;
    if (err.data != null && typeof err.data === 'object') data = err.data;
    else if (typeof err.data === 'string') rawBody = rawBody || err.data;
  } else if (typeof errOrBody === 'string') {
    rawBody = errOrBody;
  }

  if (data && typeof data === 'object') {
    try {
      return JSON.stringify(data, null, 2);
    } catch (e) {
      /* fall through */
    }
  }

  const text = String(rawBody || '').trim();
  if (text) {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch (e) {
      return text;
    }
  }

  if (typeof status === 'number' && status > 0) {
    return JSON.stringify({ ok: false, error: 'HTTP ' + status, status: status }, null, 2);
  }
  return JSON.stringify({ ok: false, error: 'unknown' }, null, 2);
}

/**
 * Pinta el body crudo en un elemento de estado (msg / form-error / proy-crear-bd-msg).
 * kind: clase is-err / is-ok / is-info (opcional). statusLabel: true → línea mínima "HTTP N" encima.
 */
function showApiErrorRaw(el, errOrBody, opts) {
  if (!el) return '';
  const o = opts || {};
  const status = typeof o.status === 'number'
    ? o.status
    : (errOrBody && typeof errOrBody.status === 'number' ? errOrBody.status : undefined);
  const raw = formatApiErrorRaw(errOrBody, status);
  const withStatus = o.statusLabel && status
    ? ('HTTP ' + status + '\n' + raw)
    : raw;
  el.hidden = false;
  el.textContent = withStatus;
  el.classList.add('api-error-raw');
  if (typeof el.classList.remove === 'function') {
    el.classList.remove('is-ok', 'is-err', 'is-info');
  }
  if (o.kind) el.classList.add(o.kind);
  else el.classList.add('is-err');
  return withStatus;
}

function apiFetch(path, opts) {
  const base = apiBaseUrl();
  const init = Object.assign({ cache: 'no-store' }, opts || {});
  init.headers = Object.assign({ Accept: 'application/json' }, init.headers || {});
  return fetch(base + path, init).then(function (res) {
    return res.text().then(function (rawBody) {
      var data = null;
      var text = rawBody == null ? '' : String(rawBody);
      if (text) {
        try {
          data = JSON.parse(text);
        } catch (e) {
          data = null;
        }
      } else {
        data = {};
      }
      if (!res.ok || (data && typeof data === 'object' && data.ok === false)) {
        var summary = (data && data.error) || (text && text.slice(0, 200)) || ('HTTP ' + res.status);
        var err = new Error(typeof summary === 'string' ? summary : 'API error');
        err.status = res.status;
        err.data = data;
        err.rawBody = text;
        throw err;
      }
      return data;
    });
  });
}

window.formatApiErrorRaw = formatApiErrorRaw;
window.showApiErrorRaw = showApiErrorRaw;
window.apiBaseUrl = apiBaseUrl;
window.apiFetch = apiFetch;
window.apiFetchAuth = apiFetchAuth;
window.asegurarClaveCatalogo = asegurarClaveCatalogo;
window.renderMermaidEn = renderMermaidEn;
window.atrasDesdeFicha = atrasDesdeFicha;
window.iconizarPestanasFicha = iconizarPestanasFicha;
window.openFichaPane = openFichaPane;
window.abrirProyecto = abrirProyecto;
window.proyectoAbierto = proyectoAbierto;
window.cargarProyectos = cargarProyectos;
window.listaProyectosCatalogo = function () {
  return (state.proyectos && state.proyectos.lista) || [];
};

const UI_PROD_BASE = 'https://campos-ancla.web-legal-es.workers.dev/';
const API_PROD_BASE = 'https://campos-ancla-api.web-legal-es.workers.dev';

function urlsProdParaInvite() {
  const onLocalHost =
    typeof location !== 'undefined' &&
    /^(localhost|127\.0\.0\.1)$/i.test(location.hostname || '');
  const base = onLocalHost
    ? UI_PROD_BASE
    : typeof location !== 'undefined' && location.origin
      ? location.origin.replace(/\/$/, '') + '/'
      : UI_PROD_BASE;
  const apiBase = onLocalHost ? API_PROD_BASE : apiBaseUrl();
  return { base: base, apiBase: apiBase };
}

function textoInstruccionesInvite(clave) {
  // Invite = acceso + apuntar al contrato. Todo el detalle vive en Documentación → API.
  const urls = urlsProdParaInvite();
  const apiDoc = urls.base + 'documentacion/api.md';
  const apiUi = urls.base + '#documentacion/api';
  const apiDocsEndpoint = urls.apiBase + '/v1/docs';
  return [
    '# Campos ancla — acceso de agente',
    '',
    'Te han dado acceso. Conserva esta clave. No uses localhost ni GITHUB_TOKEN.',
    '',
    'API_BASE=' + urls.apiBase,
    'AGENTE_CLAVE=' + clave,
    'CATALOGO_UI=' + urls.base,
    '',
    '## 1. Lee el contrato API (obligatorio; ahí está todo)',
    apiDoc,
    'UI: ' + apiUi,
    'o: GET ' + apiDocsEndpoint,
    '',
    '## 2. Conéctate según ese documento',
    'Registro: POST $API_BASE/v1/agentes/registro  { clave, nombre, foto?, id? }',
    'Latido (~30 s): POST $API_BASE/v1/agentes/latido  { id, clave }',
    'Lecturas de catálogo: GET $API_BASE/v1/… (públicas).',
    'Escrituras: Authorization: Bearer $AGENTE_CLAVE.',
    '',
    'La clave no caduca. La fuente viva es Cloudflare Worker + D1.'
  ].join('\n');
}

function cargarDocumentoApi() {
  const mount = document.getElementById('apiDocMount');
  if (!mount) return;
  if (state.apiDoc.loaded || state.apiDoc.loading) return;
  state.apiDoc.loading = true;
  mount.innerHTML = '<p class="estado">Cargando el contrato API…</p>';
  fetch('documentacion/api.md', { cache: 'no-store' })
    .then(function (res) {
      if (!res.ok) throw new Error('http');
      return res.text();
    })
    .then(function (text) {
      state.apiDoc.loaded = true;
      state.apiDoc.loading = false;
      state.apiDoc.error = false;
      mount.innerHTML = htmlDeMarkdown(text);
    })
    .catch(function () {
      state.apiDoc.loading = false;
      state.apiDoc.error = true;
      mount.innerHTML = '<p class="estado">No se pudo cargar <code>documentacion/api.md</code>.</p>';
    });
}

function normalizarDocSubpestanas(data) {
  const list = data && Array.isArray(data.subpestanas) ? data.subpestanas : [];
  const out = [];
  const seen = new Set();
  list.forEach(function (item) {
    if (!item || typeof item !== 'object') return;
    if (typeof item.id !== 'string' || !item.id.trim()) return;
    if (typeof item.titulo !== 'string' || !item.titulo.trim()) return;
    if (typeof item.archivo !== 'string' || !item.archivo.trim()) return;
    const id = item.id.trim();
    if (seen.has(id)) return;
    seen.add(id);
    const orden = Number(item.orden);
    const icono = typeof item.icono === 'string' && item.icono.trim() ? item.icono.trim() : null;
    out.push({
      id: id,
      titulo: item.titulo.trim(),
      orden: Number.isFinite(orden) ? orden : out.length + 1,
      archivo: item.archivo.trim(),
      icono: icono
    });
  });
  out.sort(function (a, b) { return a.orden - b.orden; });
  return out;
}

function normalizarMongoSubpestanas(data) {
  return normalizarDocSubpestanas(data);
}

function hidratarMermaidEnDocs(root) {
  if (!root) return;
  const nodes = root.querySelectorAll('.doc-mermaid');
  if (!nodes.length) return;
  Array.prototype.forEach.call(nodes, function (node) {
    const pre = node.querySelector('.doc-mermaid-src');
    const fuente = pre ? pre.textContent : '';
    if (!fuente.trim()) return;
    renderMermaidEn(node, fuente);
  });
}

function arqSubpestanas() {
  return state.arqDoc.index || [];
}

function arqSubPorId(id) {
  return arqSubpestanas().find(function (s) { return s.id === id; }) || null;
}

function renderArqDocPestanas() {
  const lista = document.getElementById('arqDocTabs');
  if (!lista) return;
  const items = arqSubpestanas();
  const actual = state.arqDoc.subId;
  lista.replaceChildren();
  items.forEach(function (item) {
    const btn = el('button', 'pestana');
    btn.type = 'button';
    btn.id = 'arq-tab-' + item.id;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-controls', 'arqDocMount');
    btn.dataset.arqDoc = item.id;
    if (item.icono) btn.append(svgPestanaCatalogo(item.icono));
    const label = document.createElement('span');
    label.textContent = item.titulo;
    btn.append(label);
    const on = item.id === actual;
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
    btn.tabIndex = on ? 0 : -1;
    lista.append(btn);
  });
}

function pintarArqDocMount(markdown) {
  const mount = document.getElementById('arqDocMount');
  if (!mount) return;
  mount.replaceChildren();
  const body = document.createElement('div');
  body.className = 'arq-doc-md';
  body.innerHTML = htmlDeMarkdown(markdown);
  // ASCII diagramas sin lenguaje → mismo marco que el diagrama histórico
  body.querySelectorAll('pre > code').forEach(function (code) {
    const pre = code.parentElement;
    if (!pre || pre.closest('.doc-mermaid')) return;
    const wrap = document.createElement('div');
    wrap.className = 'diagrama';
    wrap.setAttribute('aria-label', 'Diagrama');
    pre.replaceWith(wrap);
    const next = document.createElement('pre');
    next.textContent = code.textContent;
    wrap.append(next);
  });
  mount.append(body);
  hidratarMermaidEnDocs(mount);
}

function seleccionarArqSub(id, opts) {
  const items = arqSubpestanas();
  if (!items.length) return;
  const sub = arqSubPorId(id) || items[0];
  state.arqDoc.subId = sub.id;
  const token = ++state.arqDoc.fetchToken;
  renderArqDocPestanas();
  if (!(opts && opts.skipHash) && typeof history !== 'undefined' && history.replaceState) {
    const next = '#documentacion/arquitectura/' + sub.id;
    if (location.hash !== next) history.replaceState(null, '', next);
  }
  const mount = document.getElementById('arqDocMount');
  if (!mount) return;
  const cached = state.arqDoc.cache[sub.id];
  if (cached) {
    pintarArqDocMount(cached);
    return;
  }
  mount.innerHTML = '<p class="estado">Cargando…</p>';
  fetch('documentacion/arquitectura/' + sub.archivo, { cache: 'no-store' })
    .then(function (res) {
      if (!res.ok) throw new Error('http');
      return res.text();
    })
    .then(function (text) {
      if (token !== state.arqDoc.fetchToken || state.arqDoc.subId !== sub.id) return;
      state.arqDoc.cache[sub.id] = text;
      pintarArqDocMount(text);
    })
    .catch(function () {
      if (token !== state.arqDoc.fetchToken || state.arqDoc.subId !== sub.id) return;
      mount.innerHTML = '<p class="estado">No se pudo cargar <code>documentacion/arquitectura/' +
        escapeHtml(sub.archivo) + '</code>.</p>';
    });
}

function cargarDocumentoArquitectura(subIdPreferido, opts) {
  const mount = document.getElementById('arqDocMount');
  if (!mount) return;
  if (state.arqDoc.index) {
    seleccionarArqSub(subIdPreferido || state.arqDoc.subId || state.arqDoc.index[0].id, opts);
    return;
  }
  if (state.arqDoc.loading) return;
  state.arqDoc.loading = true;
  state.arqDoc.indexError = false;
  mount.innerHTML = '<p class="estado">Cargando índice de arquitectura…</p>';
  fetch('documentacion/arquitectura/index.json', { cache: 'no-store' })
    .then(function (res) {
      if (!res.ok) throw new Error('http');
      return res.json();
    })
    .then(function (data) {
      state.arqDoc.loading = false;
      state.arqDoc.index = normalizarDocSubpestanas(data);
      if (!state.arqDoc.index.length) {
        state.arqDoc.indexError = true;
        mount.innerHTML = '<p class="estado">El índice de arquitectura no tiene subpestañas.</p>';
        return;
      }
      const preferida = subIdPreferido && arqSubPorId(subIdPreferido)
        ? subIdPreferido
        : state.arqDoc.index[0].id;
      seleccionarArqSub(preferida, opts);
    })
    .catch(function () {
      state.arqDoc.loading = false;
      state.arqDoc.indexError = true;
      mount.innerHTML = '<p class="estado">No se pudo cargar <code>documentacion/arquitectura/index.json</code>.</p>';
    });
}

function mongoSubpestanas() {
  return state.mongoDoc.index || [];
}

function mongoSubPorId(id) {
  return mongoSubpestanas().find(function (s) { return s.id === id; }) || null;
}

function renderMongoDocPestanas() {
  const lista = document.getElementById('mongoDocTabs');
  if (!lista) return;
  const items = mongoSubpestanas();
  const actual = state.mongoDoc.subId;
  lista.replaceChildren();
  items.forEach(function (item) {
    const btn = el('button', 'pestana');
    btn.type = 'button';
    btn.id = 'mongo-tab-' + item.id;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-controls', 'mongoDocMount');
    btn.dataset.mongoDoc = item.id;
    const label = document.createElement('span');
    label.textContent = item.titulo;
    btn.append(label);
    const on = item.id === actual;
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
    btn.tabIndex = on ? 0 : -1;
    lista.append(btn);
  });
}

function tablaTiposMongodb(tipos) {
  const wrap = document.createElement('div');
  wrap.className = 'md-table-wrap mongo-tipos-wrap';
  const table = document.createElement('table');
  table.className = 'mongo-tipos-table';
  table.setAttribute('aria-label', 'Tipos BSON (mongodb-tipos.json)');
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  ['bsonType', 'alias', 'numero', 'descripcion', 'ejemplo', 'reglas_aplicables'].forEach(function (h) {
    const th = document.createElement('th');
    th.textContent = h;
    hr.append(th);
  });
  thead.append(hr);
  table.append(thead);
  const tbody = document.createElement('tbody');
  (Array.isArray(tipos) ? tipos : []).forEach(function (t) {
    if (!t || typeof t !== 'object') return;
    const tr = document.createElement('tr');
    if (t.obsoleto === true) tr.className = 'is-obsoleto';
    const reglas = Array.isArray(t.reglas_aplicables) ? t.reglas_aplicables.join(', ') : '';
    [
      t.bsonType != null ? String(t.bsonType) : '',
      t.alias != null ? String(t.alias) : '',
      t.numero != null ? String(t.numero) : '',
      t.descripcion != null ? String(t.descripcion) : '',
      t.ejemplo != null ? String(t.ejemplo) : '',
      reglas
    ].forEach(function (val) {
      const td = document.createElement('td');
      td.textContent = val;
      tr.append(td);
    });
    tbody.append(tr);
  });
  table.append(tbody);
  wrap.append(table);
  return wrap;
}

function pintarMongoDocMount(markdown, sub) {
  const mount = document.getElementById('mongoDocMount');
  if (!mount) return;
  mount.replaceChildren();
  const body = document.createElement('div');
  body.className = 'mongo-doc-md';
  body.innerHTML = htmlDeMarkdown(markdown);
  mount.append(body);
  if (sub && sub.id === 'tipos' && state.mongoDoc.tipos) {
    const heading = document.createElement('h2');
    heading.textContent = 'Catálogo máquina (mongodb-tipos.json)';
    mount.append(heading);
    mount.append(tablaTiposMongodb(state.mongoDoc.tipos.tipos || state.mongoDoc.tipos));
  }
  refrescarMongoConnStatus();
}

/** Solo estado sí/no (+ pista host) — Documentación no pide pegar la URI. */
function refrescarMongoConnStatus() {
  const el = document.getElementById('mongoConnStatus');
  const catalogHint = document.getElementById('mongoCatalogConnStatus');
  const targets = [el, catalogHint].filter(Boolean);
  if (!targets.length) return;
  targets.forEach(function (n) {
    n.classList.remove('is-yes', 'is-no', 'is-err');
    n.textContent = 'URI configurada: …';
  });
  const base = apiBaseUrl();
  fetch(base + '/v1/mongo/status', { cache: 'no-store' })
    .then(function (res) {
      return res.json().then(function (data) {
        return { res: res, data: data };
      });
    })
    .then(function (pack) {
      const data = pack.data || {};
      const configured = !!(data.configured || (data.ok && data.mongo === 'configured'));
      const connected = data.connected;
      const db = data.db ? String(data.db) : '';
      const hint = data.hint ? String(data.hint) : '';
      let text = 'URI configurada: ' + (configured ? 'sí' : 'no');
      if (configured && hint) text += ' (' + hint + ')';
      if (configured && connected === true) text += ' · conectada';
      if (configured && connected === false) text += ' · no alcanza el cluster';
      if (db) text += ' · db ' + db;
      text += ' — por Cluster → Conexión' + (data.source === 'env' ? ' (ops: secret Worker)' : '');
      targets.forEach(function (n) {
        n.textContent = text;
        n.classList.add(configured ? (connected === false ? 'is-err' : 'is-yes') : 'is-no');
      });
    })
    .catch(function () {
      // Fallback health (mongo: configured|disconnected)
      return fetch(base + '/health', { cache: 'no-store' })
        .then(function (res) { return res.json(); })
        .then(function (h) {
          const configured = h && h.mongo === 'configured';
          const text =
            'URI configurada: ' +
            (configured ? 'sí' : 'no') +
            ' — por Cluster → Conexión';
          targets.forEach(function (n) {
            n.textContent = text;
            n.classList.add(configured ? 'is-yes' : 'is-no');
          });
        });
    })
    .catch(function () {
      targets.forEach(function (n) {
        n.textContent = 'URI configurada: no se pudo consultar la API';
        n.classList.add('is-err');
      });
    });
}
window.refrescarMongoConnStatus = refrescarMongoConnStatus;

function seleccionarMongoSub(id, opts) {
  const items = mongoSubpestanas();
  if (!items.length) return;
  const sub = mongoSubPorId(id) || items[0];
  state.mongoDoc.subId = sub.id;
  const token = ++state.mongoDoc.fetchToken;
  renderMongoDocPestanas();
  if (!(opts && opts.skipHash) && typeof history !== 'undefined' && history.replaceState) {
    const next = '#documentacion/mongodb/' + sub.id;
    if (location.hash !== next) history.replaceState(null, '', next);
  }
  const mount = document.getElementById('mongoDocMount');
  if (!mount) return;
  const cached = state.mongoDoc.cache[sub.id];
  const tiposListos = sub.id !== 'tipos' || !!state.mongoDoc.tipos;
  if (cached && tiposListos) {
    pintarMongoDocMount(cached, sub);
    return;
  }
  mount.innerHTML = '<p class="estado">Cargando…</p>';
  const jobs = [];
  if (cached) {
    jobs.push(Promise.resolve(cached));
  } else {
    jobs.push(
      fetch('documentacion/mongodb/' + sub.archivo, { cache: 'no-store' }).then(function (res) {
        if (!res.ok) throw new Error('http');
        return res.text();
      })
    );
  }
  if (sub.id === 'tipos' && !state.mongoDoc.tipos) {
    jobs.push(
      fetch('documentacion/mongodb/mongodb-tipos.json', { cache: 'no-store' }).then(function (res) {
        if (!res.ok) throw new Error('http');
        return res.json();
      })
    );
  }
  Promise.all(jobs)
    .then(function (results) {
      if (token !== state.mongoDoc.fetchToken || state.mongoDoc.subId !== sub.id) return;
      const text = results[0];
      state.mongoDoc.cache[sub.id] = text;
      if (sub.id === 'tipos' && results[1]) state.mongoDoc.tipos = results[1];
      pintarMongoDocMount(text, sub);
    })
    .catch(function () {
      if (token !== state.mongoDoc.fetchToken || state.mongoDoc.subId !== sub.id) return;
      mount.innerHTML = '<p class="estado">No se pudo cargar <code>documentacion/mongodb/' +
        escapeHtml(sub.archivo) + '</code>.</p>';
    });
}

function cargarDocumentoMongodb(subIdPreferido, opts) {
  const mount = document.getElementById('mongoDocMount');
  if (!mount) return;
  if (state.mongoDoc.index) {
    seleccionarMongoSub(subIdPreferido || state.mongoDoc.subId || state.mongoDoc.index[0].id, opts);
    return;
  }
  if (state.mongoDoc.loading) return;
  state.mongoDoc.loading = true;
  state.mongoDoc.indexError = false;
  mount.innerHTML = '<p class="estado">Cargando índice MongoDB…</p>';
  fetch('documentacion/mongodb/index.json', { cache: 'no-store' })
    .then(function (res) {
      if (!res.ok) throw new Error('http');
      return res.json();
    })
    .then(function (data) {
      state.mongoDoc.loading = false;
      state.mongoDoc.index = normalizarMongoSubpestanas(data);
      if (!state.mongoDoc.index.length) {
        state.mongoDoc.indexError = true;
        mount.innerHTML = '<p class="estado">El índice MongoDB no tiene subpestañas.</p>';
        return;
      }
      const preferida = subIdPreferido && mongoSubPorId(subIdPreferido)
        ? subIdPreferido
        : state.mongoDoc.index[0].id;
      seleccionarMongoSub(preferida, opts);
    })
    .catch(function () {
      state.mongoDoc.loading = false;
      state.mongoDoc.indexError = true;
      mount.innerHTML = '<p class="estado">No se pudo cargar <code>documentacion/mongodb/index.json</code>.</p>';
    });
}

function cacheInviteLocal(clave, creada) {
  const store = leerAgentesStore();
  if (!store.invites.some(function (i) { return i && i.clave === clave; })) {
    store.invites.push({ clave: clave, creada: creada || new Date().toISOString(), usadaPor: null });
    try { guardarAgentesLocal(store); } catch (e) {}
  }
}

function abrirDialogoDarAcceso() {
  const dlg = document.getElementById('dlgDarAcceso');
  const err = document.getElementById('darAccesoError');
  const claveNodo = document.getElementById('darAccesoClave');
  const texto = document.getElementById('darAccesoTexto');
  if (!dlg || !claveNodo || !texto) return;
  if (err) err.textContent = '';
  claveNodo.textContent = '…';
  texto.value = 'Creando clave API en ' + apiBaseUrl() + ' …';
  dlg.showModal();
  apiFetch('/v1/invites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  }).then(function (data) {
    const inv = data && data.invite;
    const clave = inv && inv.clave;
    if (!clave) throw new Error('La API no devolvió una clave.');
    cacheInviteLocal(clave, inv.creada);
    state.agentes.inviteActual = clave;
    claveNodo.textContent = clave;
    texto.value = textoInstruccionesInvite(clave);
    texto.focus();
    texto.select();
    sincronizarAgentesSilencioso();
    if (agentesCatalogoVisible()) arrancarPollAgentes();
  }).catch(function (e) {
    claveNodo.textContent = '—';
    texto.value = '';
    if (err) {
      err.textContent = (e && e.message)
        ? (e.message + ' Comprueba API_BASE (' + apiBaseUrl() + '). Sin API no se crea la clave.')
        : 'No se pudo crear la clave en la API.';
    }
  });
}

function copiarTextoPortapapeles(body, btnId, errId) {
  const err = errId ? document.getElementById(errId) : null;
  const done = function () {
    const btn = btnId ? document.getElementById(btnId) : null;
    if (btn) {
      const prev = btn.getAttribute('data-label') || btn.textContent;
      btn.setAttribute('data-label', prev);
      btn.textContent = 'Copiado';
      setTimeout(function () { btn.textContent = prev; }, 1400);
    }
  };
  const fail = function () {
    if (err) err.textContent = 'No se pudo copiar. Selecciona el texto a mano.';
  };
  if (!body) {
    fail();
    return;
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(body).then(done).catch(fail);
    return;
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = body;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    done();
  } catch (e) {
    fail();
  }
}

function copiarInstruccionesAcceso() {
  const texto = document.getElementById('darAccesoTexto');
  if (!texto) return;
  copiarTextoPortapapeles(texto.value || '', 'darAccesoCopiar', 'darAccesoError');
}

function copiarClaveAcceso() {
  const claveNodo = document.getElementById('darAccesoClave');
  const clave = claveNodo ? String(claveNodo.textContent || '').trim() : '';
  if (!clave || clave === '…' || clave === '—') return;
  copiarTextoPortapapeles(clave, 'darAccesoCopiarClave', 'darAccesoError');
}

function espejoAgenteLocal(entrada) {
  const store = leerAgentesStore();
  store.agentes = (store.agentes || []).filter(function (a) { return !(a && a.id === entrada.id); });
  store.agentes.push(entrada);
  const inv = store.invites.find(function (i) { return i && i.clave === entrada.inviteUsada; });
  if (inv) inv.usadaPor = entrada.id;
  else if (entrada.inviteUsada) {
    store.invites.push({
      clave: entrada.inviteUsada,
      creada: new Date().toISOString(),
      usadaPor: entrada.id
    });
  }
  try { guardarAgentesLocal(store); } catch (e) {}
}

function registrarAgenteApi(opts) {
  const clave = String(opts && opts.clave || '').trim();
  const nombre = String(opts && opts.nombre || '').trim();
  const foto = typeof (opts && opts.foto) === 'string' ? opts.foto.trim() : '';
  if (!clave || clave.indexOf('inv_') !== 0) return Promise.reject(new Error('Falta una clave de invitación válida.'));
  if (!nombre) return Promise.reject(new Error('Elige un nombre.'));
  const body = { clave: clave, nombre: nombre, foto: foto };
  if (opts && opts.id) body.id = String(opts.id).trim();
  return apiFetch('/v1/agentes/registro', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(function (data) {
    const id = data.id;
    const lastSeen = data.lastSeen || new Date().toISOString();
    espejoAgenteLocal({
      id: id,
      nombre: nombre,
      foto: foto,
      lastSeen: lastSeen,
      inviteUsada: clave,
      demoEnLinea: false,
      hash: hashFnvHex(id + '|' + nombre + '|' + clave + '|' + lastSeen)
    });
    return cargarAgentesDesdeApi().then(function () {
      return { id: id, nombre: nombre, lastSeen: lastSeen };
    });
  });
}

function latidoAgenteApi(opts) {
  const id = String(opts && opts.id || '').trim();
  const clave = String(opts && opts.clave || '').trim();
  if (!id || !clave) return Promise.reject(new Error('Faltan id y clave.'));
  return apiFetch('/v1/agentes/latido', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: id, clave: clave })
  }).then(function (data) {
    const lastSeen = data.lastSeen || new Date().toISOString();
    const store = leerAgentesStore();
    let entrada = store.agentes.find(function (a) { return a && a.id === id; });
    if (!entrada) {
      entrada = { id: id, nombre: id, foto: '', inviteUsada: clave, demoEnLinea: false };
      store.agentes.push(entrada);
    }
    entrada.lastSeen = lastSeen;
    entrada.inviteUsada = clave;
    entrada.demoEnLinea = false;
    try { guardarAgentesLocal(store); } catch (e) {}
    return cargarAgentesDesdeApi().then(function () {
      if (state.agentes.abiertoId === id) renderAgenteReader();
      return { id: id, lastSeen: lastSeen, enLinea: true };
    });
  });
}

function cerrarAgenteModal() {
  const dlg = document.getElementById('dlgAgenteFicha');
  if (dlg && dlg.open) {
    dlg.close();
    return;
  }
  state.agentes.abiertoId = null;
  pintarAgentes();
}

function seleccionarAgenteReaderTab(id) {
  const tabs = document.querySelectorAll('#agenteReaderTabs [data-agente-tab]');
  const panels = {
    resumen: document.getElementById('agentePanelResumen'),
    acl: document.getElementById('agentePanelAcl')
  };
  if (id !== 'acl') id = 'resumen';
  tabs.forEach(function (btn) {
    const on = btn.getAttribute('data-agente-tab') === id;
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  Object.keys(panels).forEach(function (key) {
    if (panels[key]) panels[key].hidden = key !== id;
  });
}

function renderAgenteReader() {
  const dlg = document.getElementById('dlgAgenteFicha');
  const ag = state.agentes.lista.find(function (a) { return a.id === state.agentes.abiertoId; });
  if (!ag) {
    state.agentes.abiertoId = null;
    if (dlg && dlg.open) dlg.close();
    return;
  }
  document.getElementById('agenteReaderNombre').textContent = ag.nombre;
  const enLinea = agenteEnLinea(ag);
  document.getElementById('agenteReaderEstado').textContent = enLinea ? 'En línea' : 'Desconectado';
  document.getElementById('agenteReaderId').textContent = ag.id;
  document.getElementById('agenteReaderEstadoDetalle').textContent = enLinea ? 'En línea' : 'Desconectado';
  document.getElementById('agenteReaderLastSeen').textContent = ag.lastSeen || '—';
  const inviteEl = document.getElementById('agenteReaderInvite');
  if (inviteEl) inviteEl.textContent = enmascararInvite(ag.inviteUsada);
  pintarListaAclAgente('agenteReaderProyectos', ag.proyectos, 'Ninguna base de datos en el alcance.');
  pintarListaAclAgente('agenteReaderLee', ag.lee, 'Sin anclas de lectura.');
  pintarListaAclAgente('agenteReaderEscribe', ag.escribe, 'Sin anclas de escritura.');
  const hubNota = document.getElementById('agenteReaderHubNota');
  if (hubNota) {
    hubNota.hidden = false;
    hubNota.textContent = 'Quién entra en Campos ancla (API + invite). No son los bots del software de la Base de datos.';
  }
  const desc = document.getElementById('agenteReaderDesc');
  if (desc) {
    if (ag.descripcion) {
      desc.hidden = false;
      desc.textContent = ag.descripcion;
    } else {
      desc.hidden = true;
      desc.textContent = '';
    }
  }
  const avatar = document.getElementById('agenteFichaAvatar');
  if (avatar) {
    avatar.replaceChildren();
    avatar.className = 'ficha-titulo-icon agente-ficha-avatar';
    if (ag.foto) {
      const img = document.createElement('img');
      img.src = ag.foto;
      img.alt = '';
      img.className = 'agente-avatar-img';
      avatar.append(img);
    } else {
      avatar.textContent = String(ag.nombre).trim().charAt(0).toUpperCase() || '?';
      if (window.ColorEntidad) window.ColorEntidad.applyToEl(avatar, ag.color);
    }
  }
  iconizarPestanasFicha(dlg);
  seleccionarAgenteReaderTab('resumen');
  openFichaPane(dlg);
  if (avatar && !ag.foto) {
    cablearColorFicha(avatar, {
      kind: 'agente',
      id: ag.id,
      iconKind: 'agente',
      getColor: function () { return ag.color; },
      onSaved: function (hex) { ag.color = hex; }
    });
  }
  const nombre = document.getElementById('agenteReaderNombre');
  if (nombre) nombre.focus();
}

function abrirAgente(id) {
  refrescarAgentes();
  const ag = state.agentes.lista.find(function (a) { return a.id === id; });
  if (!ag) return;
  state.agentes.abiertoId = id;
  renderAgenteReader();
  pintarAgentes();
}

function cargarAgentesDesdeApi() {
  return apiFetch('/v1/agentes')
    .then(function (data) {
      state.agentes.remotos = normalizeAgentesIndice(data);
      state.agentes.indexError = false;
      state.agentes.fuente = 'api';
      refrescarAgentes();
      pintarAgentes();
      return state.agentes.lista;
    });
}

function cargarAgentesDesdeSeed() {
  return fetch('catalogo/agentes/index.json', { cache: 'no-store' })
    .then(function (res) {
      if (!res.ok) throw new Error('http');
      return res.json();
    })
    .then(function (data) {
      state.agentes.remotos = normalizeAgentesIndice(data);
      state.agentes.indexError = false;
      state.agentes.fuente = 'seed';
    });
}

function cargarAgentes() {
  cargarAgentesDesdeApi()
    .catch(function () {
      return cargarAgentesDesdeSeed().catch(function () {
        state.agentes.remotos = [];
        state.agentes.indexError = true;
        state.agentes.fuente = 'ninguna';
      });
    })
    .then(function () {
      state.agentes.ready = true;
      state.agentes.lastSyncAt = Date.now();
      refrescarAgentes();
      pintarAgentes();
      if (agentesCatalogoVisible()) arrancarPollAgentes();
    });
}

function wireAgentesUi() {
  const btnCerrar = document.getElementById('btnCerrarAgente');
  if (btnCerrar) btnCerrar.addEventListener('click', cerrarAgenteModal);
  const btnAtrasAgente = document.getElementById('btnAtrasAgente');
  if (btnAtrasAgente) btnAtrasAgente.addEventListener('click', function () { atrasDesdeFicha(cerrarAgenteModal); });
  const btnEditarAg = document.getElementById('btnEditarAgente');
  if (btnEditarAg) btnEditarAg.addEventListener('click', function () {
    if (!state.agentes.abiertoId) return;
    abrirDialogoEditarAgente(state.agentes.abiertoId);
  });
  const btnEliminarAg = document.getElementById('btnEliminarAgente');
  if (btnEliminarAg) btnEliminarAg.addEventListener('click', function () {
    if (!state.agentes.abiertoId) return;
    abrirDialogoEliminar({
      tipo: 'agente',
      id: state.agentes.abiertoId,
      aviso: 'Se quita del catálogo de este navegador. La clave de invite no se regenera aquí.'
    });
  });
  const agenteTabs = document.getElementById('agenteReaderTabs');
  if (agenteTabs) agenteTabs.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-agente-tab]');
    if (!btn) return;
    seleccionarAgenteReaderTab(btn.getAttribute('data-agente-tab'));
  });
  const formEditarAg = document.getElementById('formEditarAgente');
  if (formEditarAg) formEditarAg.addEventListener('submit', onSubmitEditarAgente);
  const editarAgCancel = document.getElementById('editarAgenteCancelar');
  if (editarAgCancel) editarAgCancel.addEventListener('click', function () {
    document.getElementById('dlgEditarAgente').close();
  });
  const dlg = document.getElementById('dlgAgenteFicha');
  if (dlg) dlg.addEventListener('close', function () {
    state.agentes.abiertoId = null;
    pintarAgentes();
  });
  const cerrarAcceso = document.getElementById('darAccesoCerrar');
  if (cerrarAcceso) cerrarAcceso.addEventListener('click', function () {
    const d = document.getElementById('dlgDarAcceso');
    if (d && d.open) d.close();
  });
  const copiar = document.getElementById('darAccesoCopiar');
  if (copiar) copiar.addEventListener('click', copiarInstruccionesAcceso);
  const copiarClave = document.getElementById('darAccesoCopiarClave');
  if (copiarClave) copiarClave.addEventListener('click', copiarClaveAcceso);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') detenerPollAgentes();
    else if (agentesCatalogoVisible()) arrancarPollAgentes();
  });
  window.addEventListener('hashchange', function () {
    aplicarHashDocumentacion();
    if (agentesCatalogoVisible()) arrancarPollAgentes();
    else detenerPollAgentes();
  });
  aplicarHashDocumentacion();
  if (typeof window.abrirDestino === 'function') {
    const abrirPrev = window.abrirDestino;
    window.abrirDestino = function (id) {
      abrirPrev(id);
      if (agentesCatalogoVisible()) arrancarPollAgentes();
      else detenerPollAgentes();
    };
  }
  window.AgentesCatalogo = {
    apiBase: apiBaseUrl,
    registrar: registrarAgenteApi,
    latido: latidoAgenteApi,
    listar: function () {
      return cargarAgentesDesdeApi().then(function (lista) {
        return (lista || state.agentes.lista).map(function (a) {
          return { id: a.id, nombre: a.nombre, enLinea: a.enLinea, lastSeen: a.lastSeen };
        });
      }).catch(function () {
        refrescarAgentes();
        return state.agentes.lista.map(function (a) {
          return { id: a.id, nombre: a.nombre, enLinea: a.enLinea, lastSeen: a.lastSeen };
        });
      });
    }
  };
}

function normalizeFundamento(item, versionFn) {
  if (!item || typeof item !== 'object') return null;
  if (typeof item.id !== 'string' || !item.id.trim()) return null;
  if (typeof item.nombre !== 'string' || !item.nombre.trim()) return null;
  if (!Array.isArray(item.versiones)) return null;
  const versiones = versionesUnicas(item.versiones.map(versionFn).filter(Boolean));
  if (!versiones.length) return null;
  const out = {
    id: item.id.trim(),
    nombre: item.nombre.trim(),
    versiones: versiones
  };
  if (typeof item.descripcion === 'string' && item.descripcion.trim()) {
    out.descripcion = item.descripcion.trim().slice(0, 280);
  }
  attachEntityColor(out, item);
  return out;
}

function normalizeFundamentosIndice(data) {
  const list = Array.isArray(data) ? data : (data && Array.isArray(data.fundamentos) ? data.fundamentos : []);
  const out = [];
  const seen = new Set();
  list.forEach(function (item) {
    const f = normalizeFundamento(item, normalizeVersionIndice);
    if (!f || seen.has(f.id)) return;
    seen.add(f.id);
    f.origen = 'indice';
    out.push(f);
  });
  return out;
}

function normalizeFundamentosLocales(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  list.forEach(function (item) {
    const f = normalizeFundamento(item, normalizeVersionLocal);
    if (!f || seen.has(f.id)) return;
    seen.add(f.id);
    f.origen = 'local';
    out.push(f);
  });
  return out;
}

function conMetaFundamento(destino, fuente) {
  if (fuente.descripcion) destino.descripcion = fuente.descripcion;
  copiarColorMeta(destino, fuente);
  return destino;
}

function mergeFundamentos(remotas, locales, eliminados) {
  const ban = new Set(Array.isArray(eliminados) ? eliminados : []);
  const map = new Map();
  remotas.forEach(function (f) {
    if (ban.has(f.id)) return;
    map.set(f.id, conMetaFundamento({
      id: f.id,
      nombre: f.nombre,
      origen: 'indice',
      versiones: f.versiones.map(copiaVersion)
    }, f));
  });
  locales.forEach(function (f) {
    if (ban.has(f.id)) return;
    const prev = map.get(f.id);
    if (!prev) {
      map.set(f.id, conMetaFundamento({
        id: f.id,
        nombre: f.nombre,
        origen: 'local',
        versiones: f.versiones.map(copiaVersion)
      }, f));
      return;
    }
    prev.nombre = f.nombre || prev.nombre;
    conMetaFundamento(prev, f);
    const nums = new Map();
    prev.versiones.forEach(function (v) { nums.set(v.numero, v); });
    // Remoto (índice/API) gana si ya hay ese numero; local solo rellena huecos.
    f.versiones.forEach(function (v) {
      if (!nums.has(v.numero)) nums.set(v.numero, copiaVersion(v));
    });
    prev.versiones = Array.from(nums.values()).sort(function (a, b) { return a.numero - b.numero; });
  });
  return Array.from(map.values()).sort(function (a, b) {
    return a.nombre.localeCompare(b.nombre, 'es');
  });
}

function leerFundamentosStore() {
  try {
    const raw = localStorage.getItem(LS_FUNDAMENTOS);
    if (!raw) return { fundamentos: [], eliminados: [] };
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.fundamentos)) return { fundamentos: [], eliminados: [] };
    return { fundamentos: data.fundamentos, eliminados: idsEliminados(data.eliminados) };
  } catch (e) {
    return { fundamentos: [], eliminados: [] };
  }
}

function guardarFundamentosLocal(store) {
  const json = JSON.stringify(store);
  if (json.length > 4500000) throw new Error('No cabe en el almacenamiento de este navegador.');
  try {
    localStorage.setItem(LS_FUNDAMENTOS, json);
  } catch (e) {
    throw new Error('No cabe en el almacenamiento de este navegador.');
  }
}

function refrescarFundamentos() {
  const store = leerFundamentosStore();
  state.fundamentos.lista = mergeFundamentos(
    state.fundamentos.remotos,
    normalizeFundamentosLocales(store.fundamentos),
    store.eliminados
  );
}

function fundamentosBridge() {
  return {
    getSnapshot: function () {
      const abierta = state.fundamentos.abiertoId
        ? state.fundamentos.lista.find(function (f) { return f.id === state.fundamentos.abiertoId; }) || null
        : null;
      const abiertaVersion = abierta
        ? (abierta.versiones.find(function (v) { return v.numero === state.fundamentos.abiertaNumero; }) || versionActual(abierta))
        : null;
      return {
        ready: state.fundamentos.ready,
        indexError: state.fundamentos.indexError,
        fundamentos: state.fundamentos.lista,
        abierta: abierta ? { id: abierta.id, version: abiertaVersion } : null
      };
    },
    añadirFundamento: function () { abrirDialogoNuevoFundamento(); },
    abrirFundamento: function (id) {
      if (state.fundamentos.abiertoId === id) {
        const dlg = document.getElementById('dlgFundamento');
        if (dlg && dlg.open) {
          cerrarFundamentoModal();
          return;
        }
      }
      abrirFundamento(id);
    }
  };
}

function pintarFundamentos() {
  if (window.FundamentosUI && typeof window.FundamentosUI.refrescar === 'function') {
    window.FundamentosUI.refrescar(fundamentosBridge());
  }
}

function fundamentoAbierto() {
  if (!state.fundamentos.abiertoId) return null;
  return state.fundamentos.lista.find(function (f) { return f.id === state.fundamentos.abiertoId; }) || null;
}

function versionFundamentoAbierta(f) {
  return f.versiones.find(function (v) { return v.numero === state.fundamentos.abiertaNumero; }) || versionActual(f);
}

function cerrarFundamentoModal() {
  const dlg = document.getElementById('dlgFundamento');
  if (dlg && dlg.open) {
    dlg.close();
    return;
  }
  state.fundamentos.abiertoId = null;
  state.fundamentos.abiertaNumero = null;
  state.fundamentos.historial = false;
  pintarFundamentos();
}

function seleccionarFundReaderTab(id) {
  const tabs = document.querySelectorAll('#fundReaderTabs [data-fund-tab]');
  const panelDoc = document.getElementById('fundPanelDoc');
  const panelInterno = document.getElementById('fundPanelInterno');
  tabs.forEach(function (btn) {
    const on = btn.getAttribute('data-fund-tab') === id;
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  if (panelDoc) panelDoc.hidden = id !== 'documento';
  if (panelInterno) panelInterno.hidden = id !== 'interno';
}

function pintarVersionFundamento(v) {
  const md = document.getElementById('fundMd');
  if (!md) return;
  if (typeof v.markdown === 'string') {
    md.innerHTML = htmlDeMarkdown(v.markdown);
    return;
  }
  if (!v.ruta) {
    md.textContent = 'No hay documento para esta versión.';
    return;
  }
  if (mdCache.has(v.ruta)) {
    md.innerHTML = htmlDeMarkdown(mdCache.get(v.ruta));
    return;
  }
  if (state.fundamentos.inflightRuta === v.ruta) {
    md.textContent = 'Cargando…';
    return;
  }
  state.fundamentos.inflightRuta = v.ruta;
  const token = ++state.fundamentos.fetchToken;
  const ruta = v.ruta;
  md.textContent = 'Cargando…';
  let url;
  try { url = hrefRuta(ruta); } catch (e) {
    state.fundamentos.inflightRuta = null;
    md.textContent = 'No se pudo leer el markdown de esta versión.';
    return;
  }
  fetch(url, { cache: 'no-store' })
    .then(function (res) {
      if (!res.ok) throw new Error('http');
      return res.text();
    })
    .then(function (text) {
      if (token !== state.fundamentos.fetchToken) return;
      mdCache.set(ruta, text);
      if (state.fundamentos.inflightRuta === ruta) state.fundamentos.inflightRuta = null;
      const actual = fundamentoAbierto();
      if (!actual) return;
      const abierta = versionFundamentoAbierta(actual);
      if (!abierta || abierta.ruta !== ruta) return;
      const box = document.getElementById('fundMd');
      if (box) box.innerHTML = htmlDeMarkdown(text);
    })
    .catch(function () {
      if (token !== state.fundamentos.fetchToken) return;
      if (state.fundamentos.inflightRuta === ruta) state.fundamentos.inflightRuta = null;
      const box = document.getElementById('fundMd');
      if (box) box.textContent = 'No se pudo leer el markdown de esta versión.';
    });
}

function renderHistorialFund(f, abierta) {
  const pop = document.getElementById('historialFund');
  const lista = document.getElementById('historialFundLista');
  const btn = document.getElementById('btnHistorialFund');
  if (!pop || !lista || !btn) return;
  pop.hidden = !state.fundamentos.historial;
  btn.setAttribute('aria-expanded', state.fundamentos.historial ? 'true' : 'false');
  lista.replaceChildren();
  const orden = f.versiones.slice().sort(function (a, b) { return b.numero - a.numero; });
  orden.forEach(function (v) {
    const li = document.createElement('li');
    const b = el('button', null, '');
    b.type = 'button';
    b.dataset.numero = String(v.numero);
    const marca = v.numero === abierta.numero;
    if (marca) b.setAttribute('aria-current', 'true');
    b.append(el('span', null, formatVersion(v.numero, v.fecha)));
    if (marca) b.append(el('span', 'marca', 'Abierta'));
    li.append(b);
    lista.append(li);
  });
}

function renderFundamentoReader() {
  const dlg = document.getElementById('dlgFundamento');
  const f = fundamentoAbierto();
  if (!f) {
    state.fundamentos.abiertoId = null;
    state.fundamentos.abiertaNumero = null;
    state.fundamentos.historial = false;
    if (dlg && dlg.open) dlg.close();
    return;
  }
  const v = versionFundamentoAbierta(f);
  state.fundamentos.abiertaNumero = v.numero;
  document.getElementById('fundReaderNombre').textContent = f.nombre;
  document.getElementById('fundReaderVersion').textContent = formatVersion(v.numero, v.fecha);
  const idNodo = document.getElementById('fundReaderId');
  if (idNodo) idNodo.textContent = f.id || '—';
  const verNodo = document.getElementById('fundInternoVersion');
  if (verNodo) verNodo.textContent = formatVersion(v.numero, v.fecha);
  const full = normalizarHash(v.hash) || hashFnvHex(f.id + '|' + v.numero + '|' + (v.ruta || v.fecha || ''));
  const hashBtn = document.getElementById('fundHashBtn');
  const hashFull = document.getElementById('fundHashFull');
  const hashVacio = document.getElementById('fundHashVacio');
  if (hashBtn && hashFull && hashVacio) {
    if (full) {
      hashFull.textContent = full;
      hashBtn.hidden = false;
      hashBtn.dataset.hash = full;
      hashVacio.hidden = true;
    } else {
      hashBtn.hidden = true;
      hashBtn.dataset.hash = '';
      hashVacio.hidden = false;
    }
  }
  seleccionarFundReaderTab('documento');
  renderHistorialFund(f, v);
  pintarVersionFundamento(v);
  openFichaPane(dlg);
  cablearColorFicha(dlg, {
    kind: 'fundamento',
    id: f.id,
    iconKind: 'fundamento',
    getColor: function () { return f.color; },
    onSaved: function (hex) { f.color = hex; }
  });
  const nombre = document.getElementById('fundReaderNombre');
  if (nombre) nombre.focus();
}

function abrirFundamento(id, numero) {
  refrescarFundamentos();
  const f = state.fundamentos.lista.find(function (item) { return item.id === id; });
  if (!f) return;
  state.fundamentos.abiertoId = id;
  state.fundamentos.abiertaNumero = numero == null ? versionActual(f).numero : numero;
  state.fundamentos.historial = false;
  renderFundamentoReader();
  pintarFundamentos();
}

function textoVersionFundamentoActual(v) {
  if (!v) return Promise.resolve('');
  if (typeof v.markdown === 'string') return Promise.resolve(v.markdown);
  if (v.ruta && mdCache.has(v.ruta)) return Promise.resolve(mdCache.get(v.ruta));
  if (!v.ruta) return Promise.resolve('');
  try {
    return fetch(hrefRuta(v.ruta), { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('http');
        return res.text();
      })
      .then(function (text) {
        mdCache.set(v.ruta, text);
        return text;
      })
      .catch(function () { return ''; });
  } catch (e) {
    return Promise.resolve('');
  }
}

function abrirDialogoNuevoFundamento() {
  const dlg = document.getElementById('dlgNuevoFundamento');
  const form = document.getElementById('formNuevoFundamento');
  if (!dlg || !form) return;
  form.reset();
  const err = document.getElementById('nuevoFundamentoError');
  if (err) err.textContent = '';
  dlg.showModal();
  if (form.nombre) form.nombre.focus();
}

async function onSubmitNuevoFundamento(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const error = document.getElementById('nuevoFundamentoError');
  if (error) error.textContent = '';
  const nombre = form.nombre.value.trim();
  if (!nombre) {
    if (error) error.textContent = 'Escribe un nombre.';
    return;
  }
  const markdown = String(form.markdown.value || '');
  if (!markdown.trim()) {
    if (error) error.textContent = 'El contenido no puede estar vacío.';
    return;
  }
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const idBase = String(nombre || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'fundamento';
    let id = idBase;
    refrescarFundamentos();
    let n = 2;
    while (state.fundamentos.lista.some(function (f) { return f.id === id; })) {
      id = idBase + '-' + n;
      n += 1;
    }
    const hash = await sha256Hex(markdown);
    const store = leerFundamentosStore();
    store.fundamentos.push({
      id: id,
      nombre: nombre,
      descripcion: form.descripcion.value.trim().slice(0, 280),
      versiones: [{
        numero: 1,
        fecha: todayISO(),
        markdown: markdown,
        hash: hash,
        nombreArchivo: id + '.md'
      }]
    });
    guardarFundamentosLocal(store);
    document.getElementById('dlgNuevoFundamento').close();
    refrescarFundamentos();
    pintarFundamentos();
    abrirFundamento(id, 1);
  } catch (err) {
    if (error) showApiErrorRaw(error, err, { kind: 'is-err', statusLabel: true });
  } finally {
    submit.disabled = false;
  }
}

function abrirDialogoEditarFundamento(id) {
  const f = state.fundamentos.lista.find(function (item) { return item.id === id; });
  if (!f) return;
  const dlg = document.getElementById('dlgEditarFundamento');
  const form = document.getElementById('formEditarFundamento');
  if (!dlg || !form) return;
  form.reset();
  form.dataset.id = id;
  delete form.dataset.snapMarkdown;
  const err = document.getElementById('editarFundamentoError');
  if (err) err.textContent = '';
  form.nombre.value = f.nombre;
  form.descripcion.value = f.descripcion || '';
  form.markdown.value = 'Cargando…';
  dlg.showModal();
  const v = versionActual(f);
  textoVersionFundamentoActual(v).then(function (text) {
    if (form.dataset.id !== id) return;
    const md = text || '';
    form.markdown.value = md;
    form.dataset.snapMarkdown = md;
    form.nombre.focus();
  });
}

async function onSubmitEditarFundamento(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const error = document.getElementById('editarFundamentoError');
  if (error) error.textContent = '';
  const id = form.dataset.id;
  const nombre = form.nombre.value.trim();
  if (!nombre) {
    if (error) error.textContent = 'Escribe un nombre.';
    return;
  }
  const markdown = form.markdown.value;
  if (!String(markdown || '').trim()) {
    if (error) error.textContent = 'El contenido no puede estar vacío.';
    return;
  }
  refrescarFundamentos();
  const actual = state.fundamentos.lista.find(function (f) { return f.id === id; });
  if (!actual) {
    if (error) error.textContent = 'No está ese fundamento.';
    return;
  }
  const desc = form.descripcion.value.trim().slice(0, 280);
  const snapMd = form.dataset.snapMarkdown;
  if (
    typeof snapMd === 'string' &&
    markdown === snapMd &&
    nombre === actual.nombre &&
    desc === (actual.descripcion || '')
  ) {
    if (error) error.textContent = 'Sin cambios';
    return;
  }
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const hash = await sha256Hex(markdown);
    const store = leerFundamentosStore();
    let entrada = store.fundamentos.find(function (f) { return f && f.id === id; });
    if (!entrada) {
      entrada = { id: id, nombre: actual.nombre, versiones: [] };
      store.fundamentos.push(entrada);
    }
    entrada.nombre = nombre;
    entrada.descripcion = desc;
    if (!Array.isArray(entrada.versiones)) entrada.versiones = [];
    const creada = {
      numero: siguienteNumero(actual.versiones),
      fecha: todayISO(),
      markdown: markdown,
      hash: hash,
      nombreArchivo: id + '.md'
    };
    entrada.versiones.push(creada);
    guardarFundamentosLocal(store);
    document.getElementById('dlgEditarFundamento').close();
    refrescarFundamentos();
    pintarFundamentos();
    abrirFundamento(id, creada.numero);
  } catch (err) {
    if (error) showApiErrorRaw(error, err, { kind: 'is-err', statusLabel: true });
  } finally {
    submit.disabled = false;
  }
}

function cargarFundamentosDesdeSeed() {
  return fetch('catalogo/fundamentos/index.json', { cache: 'no-store' })
    .then(function (res) {
      if (!res.ok) throw new Error('http');
      return res.json();
    })
    .then(function (data) {
      state.fundamentos.remotos = normalizeFundamentosIndice(data);
      state.fundamentos.indexError = false;
    });
}

function cargarFundamentos() {
  apiFetch('/v1/fundamentos')
    .then(function (data) {
      state.fundamentos.remotos = normalizeFundamentosIndice(data);
      state.fundamentos.indexError = false;
    })
    .catch(function () {
      return cargarFundamentosDesdeSeed();
    })
    .catch(function () {
      state.fundamentos.remotos = [];
      state.fundamentos.indexError = true;
    })
    .then(function () {
      state.fundamentos.ready = true;
      refrescarFundamentos();
      pintarFundamentos();
    });
}

function wireFundamentosUi() {
  const btnCerrar = document.getElementById('btnCerrarFundamento');
  if (btnCerrar) btnCerrar.addEventListener('click', cerrarFundamentoModal);
  const btnAtrasFundamento = document.getElementById('btnAtrasFundamento');
  if (btnAtrasFundamento) btnAtrasFundamento.addEventListener('click', function () { atrasDesdeFicha(cerrarFundamentoModal); });
  const btnEditar = document.getElementById('btnEditarFundamento');
  if (btnEditar) btnEditar.addEventListener('click', function () {
    if (!state.fundamentos.abiertoId) return;
    abrirDialogoEditarFundamento(state.fundamentos.abiertoId);
  });
  const btnEliminarFund = document.getElementById('btnEliminarFundamento');
  if (btnEliminarFund) btnEliminarFund.addEventListener('click', function () {
    if (!state.fundamentos.abiertoId) return;
    abrirDialogoEliminar({ tipo: 'fundamento', id: state.fundamentos.abiertoId });
  });
  const btnHist = document.getElementById('btnHistorialFund');
  if (btnHist) btnHist.addEventListener('click', function () {
    state.fundamentos.historial = !state.fundamentos.historial;
    const f = fundamentoAbierto();
    if (f) renderHistorialFund(f, versionFundamentoAbierta(f));
  });
  const histLista = document.getElementById('historialFundLista');
  if (histLista) histLista.addEventListener('click', function (e) {
    const b = e.target.closest('[data-numero]');
    if (!b || !state.fundamentos.abiertoId) return;
    state.fundamentos.historial = false;
    abrirFundamento(state.fundamentos.abiertoId, Number(b.dataset.numero));
  });
  const tabs = document.getElementById('fundReaderTabs');
  if (tabs) tabs.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-fund-tab]');
    if (!btn) return;
    seleccionarFundReaderTab(btn.getAttribute('data-fund-tab'));
  });
  const formNuevo = document.getElementById('formNuevoFundamento');
  if (formNuevo) formNuevo.addEventListener('submit', onSubmitNuevoFundamento);
  const nuevoCancel = document.getElementById('nuevoFundamentoCancelar');
  if (nuevoCancel) nuevoCancel.addEventListener('click', function () {
    document.getElementById('dlgNuevoFundamento').close();
  });
  const formEditar = document.getElementById('formEditarFundamento');
  if (formEditar) formEditar.addEventListener('submit', onSubmitEditarFundamento);
  const editarCancel = document.getElementById('editarFundamentoCancelar');
  if (editarCancel) editarCancel.addEventListener('click', function () {
    document.getElementById('dlgEditarFundamento').close();
  });
  const hashBtn = document.getElementById('fundHashBtn');
  if (hashBtn) hashBtn.addEventListener('click', function () {
    const full = hashBtn.dataset.hash || '';
    if (!full) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(full).catch(function () {});
    }
  });
  const dlg = document.getElementById('dlgFundamento');
  if (dlg) dlg.addEventListener('close', function () {
    state.fundamentos.abiertoId = null;
    state.fundamentos.abiertaNumero = null;
    state.fundamentos.historial = false;
    pintarFundamentos();
  });
  document.addEventListener('click', function (e) {
    if (state.fundamentos.historial && !e.target.closest('#historialFund') && !e.target.closest('#btnHistorialFund')) {
      state.fundamentos.historial = false;
      const f = fundamentoAbierto();
      if (f) renderHistorialFund(f, versionFundamentoAbierta(f));
    }
  });
}

const api = {
  CATALOGOS: CATALOGOS,
  DOCUMENTOS: DOCUMENTOS,
  formatVersion: formatVersion,
  todayISO: todayISO,
  siguienteNumero: siguienteNumero,
  slugId: slugId,
  esMarkdownNombre: esMarkdownNombre,
  normalizeIndice: normalizeIndice,
  normalizeLocales: normalizeLocales,
  mergeInstrucciones: mergeInstrucciones,
  renderMarkdown: renderMarkdown,
  htmlDeMarkdown: htmlDeMarkdown
};

if (typeof module !== 'undefined' && module.exports) module.exports = api;

if (typeof document !== 'undefined' && document.getElementById && document.getElementById('skills-root')) {
  iniciar();
}
