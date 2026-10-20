// Canje del código OAuth. Los secretos solo viven en el entorno:
// GITHUB_OAUTH_CLIENT_ID y GITHUB_OAUTH_CLIENT_SECRET. No registra el token.

const ORIGEN = 'https://frescofresco.github.io';
const REDIRECT_URI = 'https://frescofresco.github.io/arquitectura-reservas/';
const REPOSITORIO = 'FrescoFresco/arquitectura-reservas';
const CODE_RE = /^[A-Za-z0-9._-]{8,200}$/;
const VERIFIER_RE = /^[A-Za-z0-9_-]{43,128}$/;

function cors() {
  return {
    'Access-Control-Allow-Origin': ORIGEN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    Vary: 'Origin',
    'Cache-Control': 'no-store'
  };
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, cors())
  });
}

function origenPermitido(request) {
  return request.headers.get('Origin') === ORIGEN;
}

function alcanceValido(scope) {
  const partes = String(scope || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  return partes.indexOf('public_repo') !== -1 || partes.indexOf('repo') !== -1;
}

async function revocar(fetchFn, clientId, clientSecret, access) {
  try {
    await fetchFn('https://api.github.com/applications/' + encodeURIComponent(clientId) + '/token', {
      method: 'DELETE',
      headers: {
        Authorization: 'Basic ' + btoa(clientId + ':' + clientSecret),
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'arquitectura-reservas-token'
      },
      body: JSON.stringify({ access_token: access })
    });
  } catch (e) {}
}

export async function manejar(request, env, fetchImpl) {
  const fetchFn = fetchImpl || fetch;
  if (request.method === 'OPTIONS') {
    if (!origenPermitido(request)) return new Response(null, { status: 403 });
    return new Response(null, { status: 204, headers: cors() });
  }
  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);
  if (!origenPermitido(request)) return json({ error: 'Origen no permitido.' }, 403);

  const clientId = env && env.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = env && env.GITHUB_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return json({ error: 'Falta la configuración del canje.' }, 500);

  let body;
  try {
    const text = await request.text();
    if (text.length > 4000) return json({ error: 'La petición no es válida.' }, 400);
    body = JSON.parse(text);
  } catch (e) {
    return json({ error: 'La petición no es válida.' }, 400);
  }
  const code = body && typeof body.code === 'string' ? body.code : '';
  const verifier = body && typeof body.code_verifier === 'string' ? body.code_verifier : '';
  if (!CODE_RE.test(code) || !VERIFIER_RE.test(verifier)) {
    return json({ error: 'La vuelta de GitHub no es válida.' }, 400);
  }

  let tokenRes;
  try {
    const params = new URLSearchParams();
    params.set('client_id', clientId);
    params.set('client_secret', clientSecret);
    params.set('code', code);
    params.set('code_verifier', verifier);
    params.set('redirect_uri', REDIRECT_URI);
    tokenRes = await fetchFn('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'arquitectura-reservas-token'
      },
      body: params.toString()
    });
  } catch (e) {
    return json({ error: 'No se pudo hablar con GitHub.' }, 502);
  }

  let tokenData = null;
  try { tokenData = await tokenRes.json(); } catch (e) { tokenData = null; }
  const access = tokenData && typeof tokenData.access_token === 'string' ? tokenData.access_token : '';
  if (!tokenRes.ok || !access || !alcanceValido(tokenData.scope)) {
    if (access) await revocar(fetchFn, clientId, clientSecret, access);
    return json({ error: 'GitHub no entregó un token de escritura.' }, 400);
  }

  let repoRes;
  try {
    repoRes = await fetchFn('https://api.github.com/repos/' + REPOSITORIO, {
      headers: {
        Authorization: 'Bearer ' + access,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'arquitectura-reservas-token'
      }
    });
  } catch (e) {
    await revocar(fetchFn, clientId, clientSecret, access);
    return json({ error: 'No se pudo comprobar la cuenta.' }, 502);
  }
  let repo = null;
  try { repo = await repoRes.json(); } catch (e) { repo = null; }
  const push = !!(repo && repo.permissions && repo.permissions.push === true);
  if (!repoRes.ok || !push) {
    await revocar(fetchFn, clientId, clientSecret, access);
    return json({ error: 'Esta cuenta no puede escribir en FrescoFresco/arquitectura-reservas.' }, 403);
  }
  return json({ access_token: access }, 200);
}

export default {
  fetch(request, env) {
    return manejar(request, env);
  }
};
