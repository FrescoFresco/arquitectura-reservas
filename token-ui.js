'use strict';

const SITIO = 'https://frescofresco.github.io/arquitectura-reservas/';
const LS_APP = 'arquitectura-reservas.app';
const SS_STATE = 'arquitectura-reservas.app.state';
const SS_INSTALAR = 'arquitectura-reservas.app.instalar';
const SS_VUELTA = 'arquitectura-reservas.app.vuelta';

let epoca = 0;
let salida = 0;

function base64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function aleatorio(n) {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

function unir(partes) {
  let n = 0;
  for (let i = 0; i < partes.length; i++) n += partes[i].length;
  const out = new Uint8Array(n);
  let o = 0;
  for (let i = 0; i < partes.length; i++) {
    out.set(partes[i], o);
    o += partes[i].length;
  }
  return out;
}

function derLongitud(n) {
  if (n < 0x80) return Uint8Array.of(n);
  const bytes = [];
  let x = n;
  while (x > 0) {
    bytes.unshift(x & 0xff);
    x = Math.floor(x / 256);
  }
  return Uint8Array.of(0x80 | bytes.length, ...bytes);
}

function der(etiqueta, contenido) {
  const len = derLongitud(contenido.length);
  const out = new Uint8Array(1 + len.length + contenido.length);
  out[0] = etiqueta;
  out.set(len, 1);
  out.set(contenido, 1 + len.length);
  return out;
}

function bytesDeBase64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function pkcs8DesdePkcs1(pkcs1) {
  const oid = Uint8Array.of(0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01);
  const algoritmo = der(0x30, unir([oid, Uint8Array.of(0x05, 0x00)]));
  const version = Uint8Array.of(0x02, 0x01, 0x00);
  return der(0x30, unir([version, algoritmo, der(0x04, pkcs1)]));
}

function pkcs8DesdePem(pem) {
  const texto = String(pem || '').replace(/\r/g, '');
  const match = /-----BEGIN ([A-Z0-9 ]+)-----([^-]+)-----END \1-----/.exec(texto);
  if (!match) throw new Error('pem');
  const derClave = bytesDeBase64(match[2].replace(/\s/g, ''));
  if (match[1] === 'PRIVATE KEY') return derClave;
  if (match[1] === 'RSA PRIVATE KEY') return pkcs8DesdePkcs1(derClave);
  throw new Error('pem');
}

function pemValido(pem) {
  return typeof pem === 'string'
    && pem.length > 80
    && pem.length < 20000
    && /-----BEGIN (?:RSA )?PRIVATE KEY-----/.test(pem)
    && /-----END (?:RSA )?PRIVATE KEY-----/.test(pem);
}

function slugValido(slug) {
  return typeof slug === 'string' && /^[a-z0-9][a-z0-9-]{0,98}$/.test(slug);
}

function manifiesto() {
  return {
    name: 'Arquitectura reservas',
    url: SITIO,
    redirect_url: SITIO,
    callback_urls: [SITIO],
    setup_url: SITIO,
    public: false,
    default_permissions: { contents: 'write' },
    request_oauth_on_install: false,
    hook_attributes: { url: SITIO, active: false }
  };
}

function urlAlta(state) {
  return 'https://github.com/settings/apps/new?state=' + encodeURIComponent(state);
}

function textoB64url(texto) {
  return base64url(new TextEncoder().encode(texto));
}

async function jwtDeApp(appId, pem) {
  const clave = await crypto.subtle.importKey(
    'pkcs8',
    pkcs8DesdePem(pem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const ahora = Math.floor(Date.now() / 1000);
  const cuerpo = textoB64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    + '.'
    + textoB64url(JSON.stringify({ iat: ahora - 60, exp: ahora + 300, iss: String(appId) }));
  const firma = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', clave, new TextEncoder().encode(cuerpo));
  return cuerpo + '.' + base64url(new Uint8Array(firma));
}

function mensajeSeguro(texto) {
  const t = String(texto || '').replace(/\s+/g, ' ').trim();
  if (!t || t.length > 180) return 'GitHub no completó la autorización.';
  if (/private key|begin |ghs_|ghp_|gho_|ghu_|ghr_|github_pat_|-----/i.test(t)) {
    return 'GitHub no completó la autorización.';
  }
  if (/failed to fetch|networkerror|cors/i.test(t)) return 'El navegador no pudo hablar con la API de GitHub.';
  return t;
}

function avisoNodo() {
  return document.getElementById('tokenAviso');
}

function mostrarAviso(texto) {
  const nodo = avisoNodo();
  if (!nodo) return;
  if (!texto) {
    nodo.hidden = true;
    nodo.textContent = '';
    return;
  }
  nodo.hidden = false;
  nodo.textContent = texto;
}

function ocupado(si) {
  const nodo = document.getElementById('btnGenerarToken');
  if (nodo) nodo.disabled = !!si;
}

function cancelarSalida() {
  if (!salida) return;
  clearTimeout(salida);
  salida = 0;
}

function ocultarToken() {
  const box = document.getElementById('tokenResultado');
  const input = document.getElementById('tokenValor');
  if (input) input.value = '';
  if (box) box.hidden = true;
}

function mostrarToken(token) {
  const box = document.getElementById('tokenResultado');
  const input = document.getElementById('tokenValor');
  mostrarAviso('');
  if (!box || !input) return;
  input.value = token;
  box.hidden = false;
  input.focus();
  input.select();
}

function leerApp() {
  try {
    const data = JSON.parse(localStorage.getItem(LS_APP) || '');
    if (!data || typeof data !== 'object') return null;
    const id = Number(data.id);
    const slug = data.slug;
    const pem = data.pem;
    if (!Number.isInteger(id) || id < 1 || !slugValido(slug) || !pemValido(pem)) return null;
    const app = { id: id, slug: slug, pem: pem };
    const installationId = Number(data.installationId);
    if (Number.isInteger(installationId) && installationId > 0) app.installationId = installationId;
    return app;
  } catch (e) {
    return null;
  }
}

function guardarApp(app) {
  const dato = { id: app.id, slug: app.slug, pem: app.pem };
  if (app.installationId) dato.installationId = app.installationId;
  localStorage.setItem(LS_APP, JSON.stringify(dato));
}

function borrarSesion() {
  try {
    sessionStorage.removeItem(SS_STATE);
    sessionStorage.removeItem(SS_INSTALAR);
    sessionStorage.removeItem(SS_VUELTA);
  } catch (e) {}
}

function leerYBorrar(clave) {
  let valor = '';
  try { valor = sessionStorage.getItem(clave) || ''; } catch (e) { valor = ''; }
  try { sessionStorage.removeItem(clave); } catch (e) {}
  return valor;
}

function leerVuelta() {
  const raw = leerYBorrar(SS_VUELTA);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    return {
      code: typeof data.code === 'string' ? data.code : '',
      state: typeof data.state === 'string' ? data.state : '',
      error: typeof data.error === 'string' ? data.error : '',
      installationId: typeof data.installationId === 'string' ? data.installationId : ''
    };
  } catch (e) {
    return null;
  }
}

function enviarManifiesto(state) {
  const form = document.createElement('form');
  form.method = 'post';
  form.action = urlAlta(state);
  form.acceptCharset = 'UTF-8';
  const input = document.createElement('input');
  input.type = 'hidden';
  input.name = 'manifest';
  input.value = JSON.stringify(manifiesto());
  form.append(input);
  document.body.append(form);
  form.submit();
}

function irAInstalar(slug) {
  const marca = epoca;
  try {
    sessionStorage.setItem(SS_INSTALAR, '1');
  } catch (e) {
    ocupado(false);
    mostrarAviso('Este navegador no pudo guardar la autorización en curso.');
    return;
  }
  mostrarAviso('instálala solo en FrescoFresco/arquitectura-reservas.');
  const nodo = avisoNodo();
  if (nodo) {
    nodo.scrollIntoView({ block: 'nearest' });
    nodo.focus();
  }
  cancelarSalida();
  ocupado(true);
  salida = setTimeout(function () {
    salida = 0;
    if (marca !== epoca) return;
    location.assign('https://github.com/apps/' + slug + '/installations/new');
  }, 1600);
}

async function convertir(code) {
  let res;
  try {
    res = await fetch('https://api.github.com/app-manifests/' + encodeURIComponent(code) + '/conversions', {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });
  } catch (e) {
    throw new Error('El navegador no pudo hablar con la API de GitHub.');
  }
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  const id = data ? Number(data.id) : 0;
  const slug = data && typeof data.slug === 'string' ? data.slug : '';
  const pem = data && typeof data.pem === 'string' ? data.pem : '';
  if (!res.ok || !Number.isInteger(id) || id < 1 || !slugValido(slug) || !pemValido(pem)) {
    const msg = data && typeof data.message === 'string' ? data.message : '';
    throw new Error(mensajeSeguro(msg) || 'GitHub no entregó la aplicación.');
  }
  return { id: id, slug: slug, pem: pem };
}

async function emitirToken(app) {
  let jwt;
  try {
    jwt = await jwtDeApp(app.id, app.pem);
  } catch (e) {
    throw new Error('No se pudo preparar la autorización de este navegador.');
  }
  let res;
  try {
    res = await fetch('https://api.github.com/app/installations/' + app.installationId + '/access_tokens', {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer ' + jwt,
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });
  } catch (e) {
    throw new Error('El navegador no pudo hablar con la API de GitHub.');
  }
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  const token = data && typeof data.token === 'string' ? data.token : '';
  if (!res.ok || !token) {
    const error = new Error(mensajeSeguro(data && data.message) || 'GitHub no entregó el token.');
    if (res.status === 404) error.recuperarInstalacion = true;
    throw error;
  }
  return token;
}

function emitirYMostrar(app) {
  const marca = epoca;
  ocupado(true);
  mostrarAviso('Emitiendo el token…');
  emitirToken(app).then(function (token) {
    if (marca !== epoca) return;
    mostrarToken(token);
  }).catch(function (err) {
    if (marca !== epoca) return;
    ocultarToken();
    if (err && err.recuperarInstalacion) {
      const copia = leerApp();
      if (copia) {
        delete copia.installationId;
        try { guardarApp(copia); } catch (e) {}
        irAInstalar(copia.slug);
        return;
      }
    }
    mostrarAviso(mensajeSeguro(err && err.message));
  }).then(function () {
    if (marca === epoca && !salida) ocupado(false);
  });
}

function generar() {
  cancelarSalida();
  ocupado(true);
  const app = leerApp();
  if (app && app.installationId) {
    emitirYMostrar(app);
    return;
  }
  if (app && app.slug) {
    irAInstalar(app.slug);
    return;
  }
  let state = '';
  try {
    state = aleatorio(16);
    sessionStorage.setItem(SS_STATE, state);
  } catch (e) {
    ocupado(false);
    mostrarAviso('Este navegador no pudo guardar la autorización en curso.');
    return;
  }
  enviarManifiesto(state);
}

function olvidar() {
  epoca += 1;
  cancelarSalida();
  ocupado(false);
  try { localStorage.removeItem(LS_APP); } catch (e) {}
  borrarSesion();
  ocultarToken();
  mostrarAviso('Autorización olvidada.');
}

function codeValido(code) {
  return /^[a-f0-9]{20,80}$/i.test(code || '');
}

function stateValido(state) {
  return /^[A-Za-z0-9_-]{16,80}$/.test(state || '');
}

function idInstalacion(valor) {
  if (!/^\d{1,12}$/.test(valor || '')) return 0;
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

function alVolver() {
  const vuelta = leerVuelta();
  if (!vuelta) return;
  if (window.abrirDestino) window.abrirDestino('documentacion');
  if (location.hash !== '#documentacion') location.hash = '#documentacion';
  const instalacion = idInstalacion(vuelta.installationId);
  if (instalacion) {
    const esperada = leerYBorrar(SS_INSTALAR);
    const app = leerApp();
    if (esperada !== '1' || !app) {
      mostrarAviso('La vuelta de GitHub no coincide. Pulsa Generar token otra vez.');
      return;
    }
    app.installationId = instalacion;
    try {
      guardarApp(app);
    } catch (e) {
      mostrarAviso('Este navegador no pudo guardar la autorización.');
      return;
    }
    emitirYMostrar(app);
    return;
  }
  if (vuelta.error) {
    leerYBorrar(SS_STATE);
    mostrarAviso('GitHub no autorizó la aplicación.');
    return;
  }
  const esperado = leerYBorrar(SS_STATE);
  if (!codeValido(vuelta.code) || !stateValido(vuelta.state) || vuelta.state !== esperado) {
    mostrarAviso('La vuelta de GitHub no coincide. Pulsa Generar token otra vez.');
    return;
  }
  const marca = epoca;
  ocupado(true);
  mostrarAviso('Confirmando con GitHub…');
  convertir(vuelta.code).then(function (app) {
    if (marca !== epoca) return;
    guardarApp(app);
    irAInstalar(app.slug);
  }).catch(function (err) {
    if (marca !== epoca) return;
    ocupado(false);
    mostrarAviso(mensajeSeguro(err && err.message));
  });
}

function copiar() {
  const input = document.getElementById('tokenValor');
  const btn = document.getElementById('btnCopiarToken');
  if (!input || !input.value) return;
  const texto = input.value;
  function ok() {
    if (!btn) return;
    btn.textContent = 'Copiado';
    setTimeout(function () { btn.textContent = 'Copiar'; }, 2000);
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(texto).then(ok).catch(function () {
      input.focus();
      input.select();
    });
    return;
  }
  input.focus();
  input.select();
  try {
    if (document.execCommand('copy')) ok();
  } catch (e) {}
}

function iniciarToken() {
  const btn = document.getElementById('btnGenerarToken');
  if (!btn) return;
  btn.addEventListener('click', generar);
  const olvidarBtn = document.getElementById('btnOlvidar');
  if (olvidarBtn) olvidarBtn.addEventListener('click', olvidar);
  const copiarBtn = document.getElementById('btnCopiarToken');
  if (copiarBtn) copiarBtn.addEventListener('click', copiar);
  alVolver();
}

if (typeof document !== 'undefined' && document.getElementById) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciarToken);
  else iniciarToken();
}

const apiToken = {
  SITIO: SITIO,
  manifiesto: manifiesto,
  urlAlta: urlAlta,
  pkcs8DesdePem: pkcs8DesdePem,
  jwtDeApp: jwtDeApp,
  pemValido: pemValido,
  slugValido: slugValido
};

if (typeof module !== 'undefined' && module.exports) module.exports = apiToken;
