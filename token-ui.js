'use strict';

const OAUTH = {
  clientId: '',
  intercambio: '',
  alcance: 'public_repo',
  redirectUri: 'https://frescofresco.github.io/arquitectura-reservas/',
  autorizar: 'https://github.com/login/oauth/authorize'
};

const SS_STATE = 'arquitectura-reservas.oauth.state';
const SS_VERIFIER = 'arquitectura-reservas.oauth.verifier';
const SS_VUELTA = 'arquitectura-reservas.oauth.vuelta';

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

function reto(verifier) {
  const data = new TextEncoder().encode(verifier);
  return crypto.subtle.digest('SHA-256', data).then(function (buf) {
    return base64url(new Uint8Array(buf));
  });
}

function intercambioPermitido(url) {
  let parsed;
  try { parsed = new URL(url); } catch (e) { return false; }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  if (host === 'github.com' || host.endsWith('.github.com')) return false;
  if (host === 'githubusercontent.com' || host.endsWith('.githubusercontent.com')) return false;
  return true;
}

function oauthListo() {
  return typeof OAUTH.clientId === 'string'
    && OAUTH.clientId.trim() !== ''
    && intercambioPermitido(OAUTH.intercambio);
}

function avisoNodo() {
  return document.getElementById('tokenAviso');
}

function pintarPropietario(nodo) {
  nodo.replaceChildren();
  nodo.append('Este botón todavía no puede emitir el token. Falta registrar la aplicación OAuth en ');
  const enlace = document.createElement('a');
  enlace.href = 'https://github.com/settings/applications/new';
  enlace.rel = 'noopener noreferrer';
  enlace.textContent = 'https://github.com/settings/applications/new';
  nodo.append(enlace);
  nodo.append('. Application name: Arquitectura de reservas. Homepage URL: https://frescofresco.github.io/arquitectura-reservas/. Authorization callback URL: https://frescofresco.github.io/arquitectura-reservas/. El client secret no va en esta página.');
  nodo.hidden = false;
}

function mensajeSeguro(texto) {
  const t = String(texto || '').trim();
  if (!t || t.length > 240) return 'No se pudo obtener el token.';
  if (/gh[pousr]_/i.test(t) || /github_pat_/i.test(t)) return 'No se pudo obtener el token.';
  return t;
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

function leerVuelta() {
  let raw = '';
  try { raw = sessionStorage.getItem(SS_VUELTA) || ''; } catch (e) { raw = ''; }
  try { sessionStorage.removeItem(SS_VUELTA); } catch (e) {}
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    return {
      code: typeof data.code === 'string' ? data.code : '',
      state: typeof data.state === 'string' ? data.state : '',
      error: typeof data.error === 'string' ? data.error : ''
    };
  } catch (e) {
    return null;
  }
}

function guardarSesion(state, verifier) {
  sessionStorage.setItem(SS_STATE, state);
  sessionStorage.setItem(SS_VERIFIER, verifier);
}

function leerYBorrar(clave) {
  let valor = '';
  try { valor = sessionStorage.getItem(clave) || ''; } catch (e) { valor = ''; }
  try { sessionStorage.removeItem(clave); } catch (e) {}
  return valor;
}

function empezar() {
  ocultarToken();
  if (!oauthListo()) {
    const nodo = avisoNodo();
    if (nodo) {
      nodo.textContent = '';
      pintarPropietario(nodo);
      nodo.scrollIntoView({ block: 'nearest' });
      nodo.focus();
    }
    return;
  }
  if (!crypto.subtle || !crypto.getRandomValues) {
    mostrarAviso('Este navegador no puede preparar la autorización.');
    return;
  }
  const state = aleatorio(16);
  const verifier = aleatorio(32);
  reto(verifier).then(function (challenge) {
    try {
      guardarSesion(state, verifier);
    } catch (e) {
      mostrarAviso('Este navegador no pudo guardar la autorización en curso.');
      return;
    }
    const url = new URL(OAUTH.autorizar);
    url.searchParams.set('client_id', OAUTH.clientId.trim());
    url.searchParams.set('redirect_uri', OAUTH.redirectUri);
    url.searchParams.set('scope', OAUTH.alcance);
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('allow_signup', 'false');
    location.assign(url.toString());
  }).catch(function () {
    mostrarAviso('Este navegador no puede preparar la autorización.');
  });
}

function canjear(code, verifier) {
  return fetch(OAUTH.intercambio, {
    method: 'POST',
    mode: 'cors',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      code: code,
      code_verifier: verifier,
      redirect_uri: OAUTH.redirectUri
    })
  }).then(function (res) {
    return res.json().catch(function () { return null; }).then(function (data) {
      const token = data && typeof data.access_token === 'string' ? data.access_token : '';
      if (!res.ok || !token) {
        const error = data && typeof data.error === 'string' ? data.error : '';
        throw new Error(mensajeSeguro(error));
      }
      return token;
    });
  });
}

function alVolver() {
  const vuelta = leerVuelta();
  if (!vuelta) return;
  if (window.abrirDestino) window.abrirDestino('documentacion');
  if (location.hash !== '#documentacion') location.hash = '#documentacion';
  if (!oauthListo()) {
    leerYBorrar(SS_STATE);
    leerYBorrar(SS_VERIFIER);
    const nodo = avisoNodo();
    if (nodo) pintarPropietario(nodo);
    return;
  }
  if (vuelta.error) {
    mostrarAviso('GitHub no autorizó el token.');
    return;
  }
  const esperado = leerYBorrar(SS_STATE);
  const verifier = leerYBorrar(SS_VERIFIER);
  if (!vuelta.code || !vuelta.state || !esperado || vuelta.state !== esperado || !verifier) {
    mostrarAviso('La vuelta de GitHub no coincide. Pulsa Generar token otra vez.');
    return;
  }
  const btn = document.getElementById('btnGenerarToken');
  if (btn) btn.disabled = true;
  mostrarAviso('Confirmando con GitHub…');
  canjear(vuelta.code, verifier).then(function (token) {
    mostrarToken(token);
  }).catch(function (err) {
    ocultarToken();
    mostrarAviso(mensajeSeguro(err && err.message));
  }).then(function () {
    if (btn) btn.disabled = false;
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
  btn.addEventListener('click', empezar);
  const copiarBtn = document.getElementById('btnCopiarToken');
  if (copiarBtn) copiarBtn.addEventListener('click', copiar);
  if (!oauthListo()) {
    const nodo = avisoNodo();
    if (nodo) pintarPropietario(nodo);
  } else {
    mostrarAviso('');
  }
  alVolver();
}

if (typeof document !== 'undefined' && document.getElementById) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciarToken);
  else iniciarToken();
}
