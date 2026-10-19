'use strict';

const CATALOGOS = [
  { id: 'microoperaciones', nombre: 'Bloques' }
];
const DOCUMENTOS = [
  { id: 'api', nombre: 'API' }
];
const LS_KEY = 'arquitectura-reservas.catalogo.microoperaciones';
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const OJO_ABIERTO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const OJO_CERRADO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-10-8-10-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M1 1l22 22"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/></svg>';

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
  fetchToken: 0,
  inflightRuta: null,
  pendingFocus: null,
  mapa: {
    versiones: [],
    abiertaNumero: null,
    historial: false,
    fuente: '',
    preview: false,
    token: 0,
    dibujo: 0,
    mermaidListo: false
  }
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
  if (!rutaValida(v.ruta)) return null;
  const out = {
    numero: numero,
    fecha: fecha.slice(0, 10),
    ruta: String(v.ruta).trim(),
    origen: 'indice'
  };
  const nombre = nombreArchivoDe(v);
  if (nombre) out.nombreArchivo = nombre;
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
  return out;
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

function copiaVersion(v) {
  const o = { numero: v.numero, fecha: v.fecha, origen: v.origen };
  if (v.ruta) o.ruta = v.ruta;
  if (typeof v.markdown === 'string') o.markdown = v.markdown;
  if (v.datos) o.datos = v.datos;
  if (v.nombreArchivo) o.nombreArchivo = v.nombreArchivo;
  return o;
}

function mergeInstrucciones(remotas, locales) {
  const map = new Map();
  remotas.forEach(function (ins) {
    map.set(ins.id, {
      id: ins.id,
      nombre: ins.nombre,
      origen: 'indice',
      versiones: ins.versiones.map(copiaVersion)
    });
  });
  locales.forEach(function (ins) {
    const prev = map.get(ins.id);
    if (!prev) {
      map.set(ins.id, {
        id: ins.id,
        nombre: ins.nombre,
        origen: 'local',
        versiones: ins.versiones.map(copiaVersion)
      });
      return;
    }
    const byNum = new Map(prev.versiones.map(function (v) { return [v.numero, v]; }));
    ins.versiones.forEach(function (v) {
      byNum.set(v.numero, copiaVersion(v));
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
  if (!nodo) return;
  const partes = [];
  if (!state.ready) partes.push('Cargando el índice…');
  else if (state.indexError) partes.push('No se pudo leer el índice compartido.');
  if (state.ready && state.instrucciones.length === 0) partes.push('No hay bloques.');
  nodo.textContent = partes.join(' ');
  nodo.hidden = partes.length === 0;
}

function bloqueDe(ins) {
  const actual = versionActual(ins);
  const abierto = ins.id === state.abiertaId;
  const li = el('li', 'bloque' + (abierto ? ' is-open' : ''));
  if (abierto) li.setAttribute('aria-current', 'true');
  const ojo = el('span', 'ojo');
  ojo.setAttribute('aria-hidden', 'true');
  ojo.innerHTML = abierto ? OJO_ABIERTO : OJO_CERRADO;
  const abrir = el('button', 'bloque-abrir');
  abrir.type = 'button';
  abrir.dataset.accion = 'abrir';
  abrir.dataset.id = ins.id;
  abrir.append(el('h4', 'bloque-nombre', ins.nombre));
  abrir.append(el('p', 'bloque-ver', formatVersion(actual.numero, actual.fecha)));
  if (actual.origen === 'local') abrir.append(el('p', 'en-navegador', 'En este navegador'));
  const subir = el('button', 'btn version', 'Subir versión');
  subir.type = 'button';
  subir.dataset.accion = 'subir-version';
  subir.dataset.id = ins.id;
  li.append(ojo, abrir, subir);
  return li;
}

function renderBloques() {
  const ul = document.getElementById('bloques');
  if (!ul) return;
  ul.replaceChildren.apply(ul, state.instrucciones.map(bloqueDe));
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

function renderReader() {
  const split = document.getElementById('catalogoSplit');
  const reader = document.getElementById('reader');
  if (!split || !reader) return;
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
  pintarVersion(v);
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
    const btn = document.querySelector('#bloques [data-accion="abrir"][data-id="' + CSS.escape(id) + '"]');
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

function guardarInstruccionNueva(nombre, contenido) {
  const store = leerStore();
  const version = { numero: 1, fecha: todayISO() };
  if (contenido.markdown != null) version.markdown = contenido.markdown;
  if (contenido.datos) version.datos = contenido.datos;
  if (contenido.nombreArchivo) version.nombreArchivo = contenido.nombreArchivo;
  const ins = { id: slugId(nombre), nombre: nombre, versiones: [version] };
  store.instrucciones.push(ins);
  guardarLocal(store);
  return ins;
}

function guardarVersion(id, contenido) {
  refrescar();
  const actual = state.instrucciones.find(function (ins) { return ins.id === id; });
  if (!actual) throw new Error('No está ese bloque.');
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
  const subir = e.target.closest('[data-accion="subir-version"]');
  if (subir) {
    e.preventDefault();
    abrirDialogoVersion(subir.dataset.id);
    return;
  }
  const abrir = e.target.closest('[data-accion="abrir"]');
  if (!abrir) return;
  const ins = state.instrucciones.find(function (item) { return item.id === abrir.dataset.id; });
  if (!ins) return;
  state.pendingFocus = null;
  abrirInstruccion(ins.id, versionActual(ins).numero);
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
    const contenido = await contenidoDelFormulario(form);
    const ins = guardarInstruccionNueva(nombre, contenido);
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
    const contenido = await contenidoDelFormulario(form);
    const creada = guardarVersion(id, contenido);
    document.getElementById('dlgVersion').close();
    state.pendingFocus = id;
    abrirInstruccion(id, creada.numero);
  } catch (err) {
    error.textContent = err.message;
  } finally {
    submit.disabled = false;
  }
}

function renderPestanas(listaId, items, actual, attr, panelAttr) {
  const lista = document.getElementById(listaId);
  if (!lista) return;
  lista.replaceChildren();
  items.forEach(function (item) {
    const btn = el('button', 'pestana', item.nombre);
    btn.type = 'button';
    btn.id = 'tab-' + item.id;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-controls', 'panel-' + item.id);
    btn.dataset[attr] = item.id;
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
  const tab = document.getElementById('tab-' + id);
  if (tab) tab.focus();
}

function seleccionarDoc(id) {
  const existe = DOCUMENTOS.some(function (doc) { return doc.id === id; });
  if (!existe) return;
  state.docId = id;
  renderDocPestanas();
  const tab = document.getElementById('tab-' + id);
  if (tab) tab.focus();
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

function versionMapaAbierta() {
  return state.mapa.versiones.find(function (v) { return v.numero === state.mapa.abiertaNumero; }) || null;
}

function pintarMapaChrome() {
  const v = versionMapaAbierta();
  const label = document.getElementById('mapaVersion');
  if (label) label.textContent = v ? formatVersion(v.numero, v.fecha) : '';
  const pop = document.getElementById('mapaHistorial');
  const lista = document.getElementById('mapaHistorialLista');
  const btn = document.getElementById('btnHistMapa');
  if (!pop || !lista || !btn) return;
  pop.hidden = !state.mapa.historial;
  btn.setAttribute('aria-expanded', state.mapa.historial ? 'true' : 'false');
  lista.replaceChildren();
  const orden = state.mapa.versiones.slice().sort(function (a, b) { return b.numero - a.numero; });
  orden.forEach(function (item) {
    const li = document.createElement('li');
    const b = el('button', null, '');
    b.type = 'button';
    b.dataset.mapaVersion = String(item.numero);
    const marca = item.numero === state.mapa.abiertaNumero;
    if (marca) b.setAttribute('aria-current', 'true');
    b.append(el('span', null, formatVersion(item.numero, item.fecha)));
    if (marca) b.append(el('span', 'marca', 'Abierta'));
    li.append(b);
    lista.append(li);
  });
}

function asegurarMermaid() {
  if (!window.mermaid) return false;
  if (!state.mapa.mermaidListo) {
    window.mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'default',
      flowchart: { useMaxWidth: true, htmlLabels: true, nodeSpacing: 28, rankSpacing: 36 }
    });
    state.mapa.mermaidListo = true;
  }
  return true;
}

function montarDiagrama(fuente) {
  const status = document.getElementById('mapStatus');
  const actual = document.getElementById('flowMermaid');
  if (!actual) return;
  const token = ++state.mapa.dibujo;
  const el = document.createElement('div');
  el.id = 'flowMermaid';
  el.className = 'mermaid';
  el.textContent = fuente;
  actual.replaceWith(el);
  const nota = state.mapa.preview ? 'Vista previa sin publicar. No crea una versión.' : '';
  function fallo(texto) {
    if (token !== state.mapa.dibujo) return;
    el.className = 'map-fallback';
    el.textContent = fuente;
    if (status) status.textContent = nota || texto;
  }
  if (!asegurarMermaid()) {
    fallo('Mapa en texto: requiere conexión para visualizar el diagrama.');
    return;
  }
  if (status) status.textContent = nota || 'Cargando diagrama…';
  const renderId = 'flowSvg' + token;
  let done;
  try {
    done = window.mermaid.render(renderId, fuente);
  } catch (e) {
    fallo('Mapa en texto.');
    return;
  }
  Promise.resolve(done).then(function (res) {
    if (token !== state.mapa.dibujo) return;
    const svg = res && res.svg ? res.svg : '';
    if (!svg) {
      fallo('Mapa en texto.');
      return;
    }
    el.innerHTML = svg;
    const suelto = document.getElementById(renderId);
    if (suelto && !el.contains(suelto)) suelto.remove();
    if (status) status.textContent = nota;
  }).catch(function () {
    fallo('Mapa en texto.');
  });
}

function normalizarMapa(data) {
  const list = data && Array.isArray(data.versiones) ? data.versiones : [];
  const seen = new Set();
  const versiones = [];
  list.forEach(function (v) {
    const n = normalizeVersionIndice(v);
    if (!n || seen.has(n.numero)) return;
    seen.add(n.numero);
    versiones.push(n);
  });
  versiones.sort(function (a, b) { return a.numero - b.numero; });
  return versiones;
}

function elegirVersionMapa(numero) {
  const v = state.mapa.versiones.find(function (item) { return item.numero === numero; });
  if (!v) return;
  state.mapa.abiertaNumero = v.numero;
  state.mapa.preview = false;
  state.mapa.historial = false;
  pintarMapaChrome();
  const token = ++state.mapa.token;
  const status = document.getElementById('mapStatus');
  if (status) status.textContent = 'Cargando diagrama…';
  let url;
  try { url = hrefRuta(v.ruta); } catch (e) {
    if (status) status.textContent = 'No se pudo leer esta versión del mapa.';
    return;
  }
  fetch(url, { cache: 'no-store' })
    .then(function (res) {
      if (!res.ok) throw new Error('http');
      return res.text();
    })
    .then(function (text) {
      if (token !== state.mapa.token) return;
      state.mapa.fuente = text;
      state.mapa.preview = false;
      const ta = document.getElementById('mapaFuente');
      if (ta) ta.value = text;
      montarDiagrama(text);
      pintarMapaChrome();
    })
    .catch(function () {
      if (token !== state.mapa.token) return;
      if (status) status.textContent = 'No se pudo leer esta versión del mapa.';
    });
}

function cargarMapa() {
  const status = document.getElementById('mapStatus');
  fetch('mapa/index.json', { cache: 'no-store' })
    .then(function (res) {
      if (!res.ok) throw new Error('http');
      return res.json();
    })
    .then(function (data) {
      state.mapa.versiones = normalizarMapa(data);
      if (!state.mapa.versiones.length) {
        if (status) status.textContent = 'No hay versiones del mapa.';
        pintarMapaChrome();
        return;
      }
      const ultima = state.mapa.versiones[state.mapa.versiones.length - 1];
      elegirVersionMapa(ultima.numero);
    })
    .catch(function () {
      if (status) status.textContent = 'No se pudo leer el índice del mapa.';
    });
}

function alternarEdicion() {
  const box = document.getElementById('edicion');
  const btn = document.getElementById('btnEdicion');
  if (!box || !btn) return;
  const abrir = box.hidden;
  box.hidden = !abrir;
  btn.setAttribute('aria-expanded', abrir ? 'true' : 'false');
  if (abrir) {
    const ta = document.getElementById('mapaFuente');
    if (ta && !state.mapa.preview) ta.value = state.mapa.fuente;
    if (ta) ta.focus();
  }
}

function previsualizarMapa() {
  const ta = document.getElementById('mapaFuente');
  const status = document.getElementById('mapStatus');
  if (!ta) return;
  if (!ta.value.trim()) {
    if (status) status.textContent = 'El diagrama está vacío.';
    return;
  }
  state.mapa.preview = true;
  montarDiagrama(ta.value);
  pintarMapaChrome();
}

function alternarHistMapa() {
  if (!state.mapa.versiones.length) return;
  state.mapa.historial = !state.mapa.historial;
  const venia = document.activeElement && document.activeElement.id === 'btnHistMapa';
  pintarMapaChrome();
  if (state.mapa.historial) {
    const current = document.querySelector('#mapaHistorialLista [aria-current="true"]');
    if (current) current.focus();
  } else if (venia) {
    const boton = document.getElementById('btnHistMapa');
    if (boton) boton.focus();
  }
}

function iniciar() {
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
  const btnEdicion = document.getElementById('btnEdicion');
  if (btnEdicion) btnEdicion.addEventListener('click', alternarEdicion);
  const btnPrev = document.getElementById('btnPrevisualizar');
  if (btnPrev) btnPrev.addEventListener('click', previsualizarMapa);
  const btnHistMapa = document.getElementById('btnHistMapa');
  if (btnHistMapa) btnHistMapa.addEventListener('click', alternarHistMapa);
  const listaMapa = document.getElementById('mapaHistorialLista');
  if (listaMapa) listaMapa.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-mapa-version]');
    if (!btn) return;
    elegirVersionMapa(Number(btn.dataset.mapaVersion));
  });
  document.addEventListener('click', function (e) {
    if (state.historial && !e.target.closest('#historial') && !e.target.closest('#btnHistorial')) cerrarHistorial();
    if (state.mapa.historial && !e.target.closest('#mapaHistorial') && !e.target.closest('#btnHistMapa')) {
      state.mapa.historial = false;
      pintarMapaChrome();
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (state.historial) {
      e.preventDefault();
      state.historial = false;
      render();
      const boton = document.getElementById('btnHistorial');
      if (boton) boton.focus();
      return;
    }
    if (state.mapa.historial) {
      e.preventDefault();
      state.mapa.historial = false;
      pintarMapaChrome();
      const boton = document.getElementById('btnHistMapa');
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
  cargarMapa();
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
  htmlDeMarkdown: htmlDeMarkdown,
  normalizarMapa: normalizarMapa
};

if (typeof module !== 'undefined' && module.exports) module.exports = api;

if (typeof document !== 'undefined' && document.getElementById && document.getElementById('bloques')) {
  iniciar();
}
