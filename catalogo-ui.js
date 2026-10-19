'use strict';

const CATALOGOS = [
  { id: 'microoperaciones', nombre: 'Microoperaciones' }
];
const LS_KEY = 'arquitectura-reservas.catalogo.microoperaciones';
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const state = {
  catalogoId: CATALOGOS[0].id,
  ready: false,
  indexError: false,
  remotas: [],
  instrucciones: [],
  abiertaId: null,
  abiertaNumero: null,
  historial: false,
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
  if (!rutaValida(v.ruta)) return null;
  return {
    numero: numero,
    fecha: fecha.slice(0, 10),
    ruta: String(v.ruta).trim(),
    origen: 'indice'
  };
}

function normalizeVersionLocal(v) {
  if (!v || typeof v !== 'object') return null;
  const numero = Number(v.numero);
  if (!Number.isInteger(numero) || numero < 1) return null;
  const fecha = typeof v.fecha === 'string' ? v.fecha : '';
  if (!/^(\d{4})-(\d{2})-(\d{2})/.test(fecha)) return null;
  if (typeof v.markdown !== 'string') return null;
  return {
    numero: numero,
    fecha: fecha.slice(0, 10),
    markdown: v.markdown,
    origen: 'local'
  };
}

function normalizeInstruccion(item, versionFn) {
  if (!item || typeof item !== 'object') return null;
  if (typeof item.id !== 'string' || !item.id.trim()) return null;
  if (typeof item.nombre !== 'string' || !item.nombre.trim()) return null;
  if (!Array.isArray(item.versiones)) return null;
  const versiones = versionesUnicas(item.versiones.map(versionFn).filter(Boolean));
  if (!versiones.length) return null;
  return {
    id: item.id.trim(),
    nombre: item.nombre.trim(),
    versiones: versiones
  };
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

function mergeInstrucciones(remotas, locales) {
  const map = new Map();
  remotas.forEach(function (ins) {
    map.set(ins.id, {
      id: ins.id,
      nombre: ins.nombre,
      origen: 'indice',
      versiones: ins.versiones.map(function (v) {
        return {
          numero: v.numero,
          fecha: v.fecha,
          ruta: v.ruta,
          origen: 'indice'
        };
      })
    });
  });
  locales.forEach(function (ins) {
    const prev = map.get(ins.id);
    if (!prev) {
      map.set(ins.id, {
        id: ins.id,
        nombre: ins.nombre,
        origen: 'local',
        versiones: ins.versiones.map(function (v) {
          return {
            numero: v.numero,
            fecha: v.fecha,
            markdown: v.markdown,
            origen: 'local'
          };
        })
      });
      return;
    }
    const byNum = new Map(prev.versiones.map(function (v) { return [v.numero, v]; }));
    ins.versiones.forEach(function (v) {
      byNum.set(v.numero, {
        numero: v.numero,
        fecha: v.fecha,
        markdown: v.markdown,
        origen: 'local'
      });
    });
    prev.versiones = Array.from(byNum.values()).sort(function (a, b) { return a.numero - b.numero; });
  });
  return Array.from(map.values());
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
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" rel="noopener noreferrer">$1</a>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  t = t.replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>');
  return t;
}

function renderMarkdown(src) {
  const lines = String(src || '').replace(/\r\n/g, '\n').split('\n');
  let html = '';
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const buf = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i])) {
        buf.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      html += '<pre><code>' + escapeHtml(buf.join('\n')) + '</code></pre>';
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      html += '<h' + level + '>' + inlineMarkdown(heading[2]) + '</h' + level + '>';
      i += 1;
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

function leerStore() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { instrucciones: [] };
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.instrucciones)) return { instrucciones: [] };
    return { instrucciones: data.instrucciones };
  } catch (e) {
    return { instrucciones: [] };
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
  state.instrucciones = mergeInstrucciones(state.remotas, normalizeLocales(leerStore().instrucciones));
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

function renderEstado() {
  const nodo = document.getElementById('catalogoEstado');
  const partes = [];
  if (!state.ready) partes.push('Cargando el índice…');
  else if (state.indexError) partes.push('No se pudo leer el índice compartido.');
  if (state.ready && state.instrucciones.length === 0) partes.push('No hay instrucciones.');
  nodo.textContent = partes.join(' ');
  nodo.hidden = partes.length === 0;
}

function bloqueDe(ins) {
  const actual = versionActual(ins);
  const li = el('li', 'bloque' + (ins.id === state.abiertaId ? ' is-open' : ''));
  if (ins.id === state.abiertaId) li.setAttribute('aria-current', 'true');
  li.append(el('h4', 'bloque-nombre', ins.nombre));
  li.append(el('p', 'bloque-ver', formatVersion(actual.numero, actual.fecha)));
  const ver = el('button', 'btn ver', 'Ver');
  ver.type = 'button';
  ver.dataset.accion = 'ver';
  ver.dataset.id = ins.id;
  const subir = el('button', 'btn version', 'Subir versión');
  subir.type = 'button';
  subir.dataset.accion = 'subir-version';
  subir.dataset.id = ins.id;
  li.append(ver, subir);
  if (actual.origen === 'local') li.append(el('p', 'en-navegador', 'En este navegador'));
  return li;
}

function renderBloques() {
  const ul = document.getElementById('bloques');
  ul.replaceChildren.apply(ul, state.instrucciones.map(bloqueDe));
}

function pintarMarkdown(v) {
  const md = document.getElementById('md');
  if (!md) return;
  if (typeof v.markdown === 'string') {
    state.inflightRuta = null;
    state.fetchToken += 1;
    md.innerHTML = htmlDeMarkdown(v.markdown);
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
    const etiqueta = el('span', null, formatVersion(v.numero, v.fecha));
    b.append(etiqueta);
    if (marca) b.append(el('span', 'marca', 'Abierta'));
    li.append(b);
    lista.append(li);
  });
}

function renderReader() {
  const split = document.getElementById('catalogoSplit');
  const reader = document.getElementById('reader');
  const ins = instruccionAbierta();
  if (!ins) {
    state.abiertaId = null;
    state.abiertaNumero = null;
    state.historial = false;
    reader.hidden = true;
    split.classList.remove('is-open');
    return;
  }
  const v = versionAbierta(ins);
  state.abiertaNumero = v.numero;
  reader.hidden = false;
  split.classList.add('is-open');
  document.getElementById('readerNombre').textContent = ins.nombre;
  document.getElementById('readerVersion').textContent = formatVersion(v.numero, v.fecha);
  const origen = document.getElementById('readerOrigen');
  if (v.origen === 'local') {
    origen.hidden = false;
    origen.textContent = 'En este navegador. No está en GitHub.';
  } else {
    origen.hidden = true;
    origen.textContent = '';
  }
  renderHistorial(ins, v);
  pintarMarkdown(v);
}

function render() {
  if (typeof document === 'undefined') return;
  const focoEnHistorial = !!(document.activeElement && document.activeElement.closest && document.activeElement.closest('#historial, #btnHistorial'));
  refrescar();
  renderEstado();
  renderBloques();
  renderReader();
  if (state.pendingFocus) {
    const id = state.pendingFocus;
    state.pendingFocus = null;
    const btn = document.querySelector('#bloques [data-accion="ver"][data-id="' + CSS.escape(id) + '"]');
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
  form.markdown.focus();
}

function archivoMarkdown(file) {
  const nombre = file.name.toLowerCase();
  const tipoOk = !file.type || file.type.indexOf('text/') === 0 || file.type === 'application/octet-stream';
  const extOk = nombre.endsWith('.md') || nombre.endsWith('.markdown') || nombre.endsWith('.txt');
  return tipoOk && extOk;
}

function leerArchivo(file) {
  return new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.onload = function () { resolve(String(reader.result || '')); };
    reader.onerror = function () { reject(new Error('No se pudo leer el archivo.')); };
    reader.readAsText(file);
  });
}

async function markdownDelFormulario(form) {
  const file = form.archivo.files && form.archivo.files[0];
  if (file) {
    if (!archivoMarkdown(file)) throw new Error('El archivo tiene que ser markdown (.md).');
    const text = await leerArchivo(file);
    if (!text.trim()) throw new Error('El archivo está vacío.');
    if (text.length > 400000) throw new Error('El markdown es demasiado grande para este navegador.');
    return text;
  }
  const pasted = form.markdown.value;
  if (!pasted.trim()) throw new Error('Elige un archivo markdown o pega el texto.');
  if (pasted.length > 400000) throw new Error('El markdown es demasiado grande para este navegador.');
  return pasted;
}

function guardarInstruccionNueva(nombre, markdown) {
  const store = leerStore();
  const ins = {
    id: slugId(nombre),
    nombre: nombre,
    versiones: [{ numero: 1, fecha: todayISO(), markdown: markdown }]
  };
  store.instrucciones.push(ins);
  guardarLocal(store);
  return ins;
}

function guardarVersion(id, markdown) {
  refrescar();
  const actual = state.instrucciones.find(function (ins) { return ins.id === id; });
  if (!actual) throw new Error('No está esa instrucción.');
  const store = leerStore();
  let entrada = store.instrucciones.find(function (ins) { return ins && ins.id === id; });
  if (!entrada) {
    entrada = { id: id, nombre: actual.nombre, versiones: [] };
    store.instrucciones.push(entrada);
  }
  if (!Array.isArray(entrada.versiones)) entrada.versiones = [];
  const creada = { numero: siguienteNumero(actual.versiones), fecha: todayISO(), markdown: markdown };
  entrada.versiones.push(creada);
  guardarLocal(store);
  return creada;
}

function abrirInstruccion(id, numero) {
  state.abiertaId = id;
  state.abiertaNumero = numero == null ? null : numero;
  state.historial = false;
  render();
  if (window.matchMedia('(max-width: 800px)').matches) {
    const reader = document.getElementById('reader');
    if (reader) reader.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function cerrarHistorial() {
  if (!state.historial) return;
  state.historial = false;
  render();
}

function onClickBloques(e) {
  const ver = e.target.closest('[data-accion="ver"]');
  if (ver) {
    const ins = state.instrucciones.find(function (item) { return item.id === ver.dataset.id; });
    if (!ins) return;
    state.pendingFocus = null;
    abrirInstruccion(ins.id, versionActual(ins).numero);
    return;
  }
  const subir = e.target.closest('[data-accion="subir-version"]');
  if (subir) abrirDialogoVersion(subir.dataset.id);
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
  submit.disabled = true;
  try {
    const markdown = await markdownDelFormulario(form);
    const ins = guardarInstruccionNueva(nombre, markdown);
    document.getElementById('dlgNueva').close();
    state.pendingFocus = ins.id;
    abrirInstruccion(ins.id, 1);
  } catch (err) {
    error.textContent = err.message;
  } finally {
    submit.disabled = false;
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
    const markdown = await markdownDelFormulario(form);
    const creada = guardarVersion(id, markdown);
    document.getElementById('dlgVersion').close();
    state.pendingFocus = id;
    abrirInstruccion(id, creada.numero);
  } catch (err) {
    error.textContent = err.message;
  } finally {
    submit.disabled = false;
  }
}

function renderPestanas() {
  const lista = document.getElementById('catalogoTabs');
  if (!lista) return;
  const actual = state.catalogoId || CATALOGOS[0].id;
  lista.replaceChildren();
  CATALOGOS.forEach(function (cat) {
    const btn = el('button', 'pestana', cat.nombre);
    btn.type = 'button';
    btn.id = 'tab-' + cat.id;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-controls', 'panel-' + cat.id);
    btn.dataset.catalogo = cat.id;
    const on = cat.id === actual;
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
    btn.tabIndex = on ? 0 : -1;
    lista.append(btn);
  });
  document.querySelectorAll('[role="tabpanel"][data-catalogo]').forEach(function (panel) {
    const on = panel.dataset.catalogo === actual;
    panel.hidden = !on;
    if (on) panel.setAttribute('aria-labelledby', 'tab-' + panel.dataset.catalogo);
  });
}

function seleccionarCatalogo(id) {
  const existe = CATALOGOS.some(function (cat) { return cat.id === id; });
  if (!existe) return;
  state.catalogoId = id;
  renderPestanas();
  const tab = document.getElementById('tab-' + id);
  if (tab) tab.focus();
}

function destinoDeHash() {
  return location.hash === '#catalogos' ? 'catalogos' : 'mapa';
}

function mostrarDestino(destino, push) {
  const id = destino === 'catalogos' ? 'catalogos' : 'mapa';
  const mapa = document.getElementById('mapa');
  const catalogos = document.getElementById('catalogos');
  if (mapa) mapa.hidden = id !== 'mapa';
  if (catalogos) catalogos.hidden = id !== 'catalogos';
  document.querySelectorAll('#hub [data-destino]').forEach(function (btn) {
    if (btn.dataset.destino === id) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });
  const hash = '#' + id;
  if (push && location.hash !== hash) history.pushState({ destino: id }, '', hash);
  if (push) window.scrollTo(0, 0);
}

function nombreDeArchivo(input, destinoId) {
  const file = input.files && input.files[0];
  document.getElementById(destinoId).textContent = file ? file.name : '';
}

function iniciar() {
  renderPestanas();
  mostrarDestino(destinoDeHash(), false);
  document.getElementById('hub').addEventListener('click', function (e) {
    const btn = e.target.closest('[data-destino]');
    if (!btn) return;
    mostrarDestino(btn.dataset.destino, true);
  });
  document.getElementById('catalogoTabs').addEventListener('click', function (e) {
    const tab = e.target.closest('[data-catalogo]');
    if (!tab) return;
    seleccionarCatalogo(tab.dataset.catalogo);
  });
  document.getElementById('catalogoTabs').addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const tabs = Array.from(document.querySelectorAll('#catalogoTabs [role="tab"]'));
    const i = tabs.indexOf(document.activeElement);
    if (i < 0 || !tabs.length) return;
    e.preventDefault();
    const delta = e.key === 'ArrowRight' ? 1 : -1;
    const next = tabs[(i + delta + tabs.length) % tabs.length];
    seleccionarCatalogo(next.dataset.catalogo);
  });
  window.addEventListener('popstate', function () {
    mostrarDestino(destinoDeHash(), false);
  });
  document.getElementById('btnNueva').addEventListener('click', abrirDialogoNuevo);
  document.getElementById('nuevaCancelar').addEventListener('click', function () {
    document.getElementById('dlgNueva').close();
  });
  document.getElementById('versionCancelar').addEventListener('click', function () {
    document.getElementById('dlgVersion').close();
  });
  document.getElementById('formNueva').addEventListener('submit', onSubmitNueva);
  document.getElementById('formVersion').addEventListener('submit', onSubmitVersion);
  document.getElementById('nuevaArchivo').addEventListener('change', function (e) {
    nombreDeArchivo(e.target, 'nuevaArchivoNombre');
  });
  document.getElementById('versionArchivo').addEventListener('change', function (e) {
    nombreDeArchivo(e.target, 'versionArchivoNombre');
  });
  document.getElementById('bloques').addEventListener('click', onClickBloques);
  document.getElementById('btnHistorial').addEventListener('click', alternarHistorial);
  document.getElementById('historialLista').addEventListener('click', onClickHistorial);
  document.addEventListener('click', function (e) {
    if (!state.historial) return;
    if (e.target.closest('#historial') || e.target.closest('#btnHistorial')) return;
    cerrarHistorial();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.historial) {
      e.preventDefault();
      state.historial = false;
      render();
      const boton = document.getElementById('btnHistorial');
      if (boton) boton.focus();
    }
  });
  render();
  fetch('catalogo/microoperaciones/index.json', { cache: 'no-store' })
    .then(function (res) {
      if (!res.ok) throw new Error('http');
      return res.json();
    })
    .then(function (data) {
      state.remotas = normalizeIndice(data);
      state.indexError = false;
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

const api = {
  CATALOGOS: CATALOGOS,
  formatVersion: formatVersion,
  todayISO: todayISO,
  siguienteNumero: siguienteNumero,
  slugId: slugId,
  normalizeIndice: normalizeIndice,
  normalizeLocales: normalizeLocales,
  mergeInstrucciones: mergeInstrucciones,
  renderMarkdown: renderMarkdown,
  htmlDeMarkdown: htmlDeMarkdown
};

if (typeof module !== 'undefined' && module.exports) module.exports = api;

if (typeof document !== 'undefined' && document.getElementById && document.getElementById('bloques')) {
  iniciar();
}
