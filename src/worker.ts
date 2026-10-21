import { Hono } from 'hono';
import { cors } from 'hono/cors';
// Bundled via wrangler rules (Text) — same canonical contract as Documentación → API.
import apiDocsMd from '../documentacion/api.md';
import {
  appendObservacion,
  canonicalFromAncla,
  defaultStrictPii,
  findAliasConflicts,
  looksLikeUrlAncla,
  maskSensitive,
  normalizeAliasList,
  normalizeObservaciones,
  parseJsonObject,
  proyectarArrayN,
  scrubPiiFromUrl,
  type Observacion,
} from './pelo-sur';

export type Env = {
  DB: D1Database;
  PUBLIC_UI_ORIGIN?: string;
  /** Optional extra origin for local UI (comma-separated). */
  CORS_ORIGINS?: string;
};

type Variables = {
  inviteClave?: string;
  agenteId?: string;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const ID_RE = /^[a-z0-9][a-z0-9-]{0,60}$/;

function nowIso() {
  return new Date().toISOString();
}

function todayIso() {
  return nowIso().slice(0, 10);
}

function jsonError(c: { json: (b: unknown, s?: number) => Response }, status: number, error: string) {
  return c.json({ ok: false, error }, status);
}

function extractClave(c: { req: { header: (n: string) => string | undefined } }) {
  const auth = c.req.header('Authorization') || '';
  if (auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  return (c.req.header('X-Agente-Clave') || '').trim();
}

app.use('*', async (c, next) => {
  const ui = c.env.PUBLIC_UI_ORIGIN || 'https://campos-ancla.web-legal-es.workers.dev';
  const extra = (c.env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  // github.io solo durante el cutover; la UI primaria es Cloudflare (Workers Assets / Pages).
  const origins = new Set([
    ui,
    'https://frescofresco.github.io',
    'http://127.0.0.1:8787',
    'http://localhost:8787',
    ...extra,
  ]);
  const mw = cors({
    origin: (origin) => (origin && origins.has(origin) ? origin : ui),
    allowHeaders: ['Content-Type', 'Authorization', 'X-Agente-Clave'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  return mw(c, next);
});

app.get('/health', (c) => c.json({ ok: true, service: 'campos-ancla-api' }));

/** Canonical agent contract (same markdown as UI Documentación → API). */
app.get('/v1/docs', (c) =>
  c.text(String(apiDocsMd), 200, {
    'Content-Type': 'text/markdown; charset=utf-8',
    'Cache-Control': 'public, max-age=60',
  })
);
app.get('/docs', (c) => c.redirect('/v1/docs', 302));

/** Public catalog reads — no auth. */
app.get('/v1/skills', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT id, nombre, descripcion, hash, created_at, updated_at FROM skills ORDER BY nombre'
  ).all();
  const out = [];
  for (const row of rows.results || []) {
    out.push(await hydrateSkill(c.env.DB, row as Record<string, unknown>));
  }
  return c.json({ ok: true, id: 'skills', nombre: 'Skills', instrucciones: out });
});

app.get('/v1/skills/:id', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare(
    'SELECT id, nombre, descripcion, hash, created_at, updated_at FROM skills WHERE id = ?'
  )
    .bind(id)
    .first();
  if (!row) return jsonError(c, 404, 'Skill no encontrada.');
  return c.json({ ok: true, skill: await hydrateSkill(c.env.DB, row as Record<string, unknown>) });
});

app.get('/v1/anclas', async (c) => {
  const reveal = await mayRevealSensitive(c);
  const rows = await c.env.DB.prepare('SELECT * FROM anclas ORDER BY ancla').all();
  const out = [];
  for (const row of rows.results || []) {
    out.push(await hydrateAncla(c.env.DB, row as Record<string, unknown>, { reveal }));
  }
  return c.json({ ok: true, id: 'campos-ancla', nombre: 'Campos ancla', campos: out });
});

/**
 * Resolve alias or canonical name → ancla. Public.
 * Canonical id wins over alias when both match (avoids alias=`negocio.telefono` colliding with id).
 * Duplicate aliases across anclas → 409.
 */
app.get('/v1/anclas/resolve', async (c) => {
  const q = String(c.req.query('q') || c.req.query('alias') || '')
    .trim()
    .replace(/^_+|_+$/g, '');
  if (!q) return jsonError(c, 400, 'Falta q o alias.');
  const reveal = await mayRevealSensitive(c);
  const rows = await c.env.DB.prepare('SELECT * FROM anclas').all();
  const needle = q.toLowerCase();
  type Hit = { row: Record<string, unknown>; mapped: ReturnType<typeof mapAnclaRow> };
  const aliasHits: Hit[] = [];
  let idHit: Hit | null = null;
  for (const row of rows.results || []) {
    const mapped = mapAnclaRow(row as Record<string, unknown>);
    const canon = canonicalFromAncla(mapped.ancla).toLowerCase();
    const id = mapped.id.toLowerCase();
    const aliases = mapped.aliases.map((a) => a.toLowerCase());
    if (aliases.includes(needle)) {
      aliasHits.push({ row: row as Record<string, unknown>, mapped });
    }
    if (!idHit && (canon === needle || id === needle)) {
      idHit = { row: row as Record<string, unknown>, mapped };
    }
  }
  if (aliasHits.length > 1) {
    return jsonError(
      c,
      409,
      'Alias ambiguo («' + q + '»): ' + aliasHits.map((h) => h.mapped.id).join(', ')
    );
  }
  // Prefer canonical id match over alias (N4: alias must not collide with another name).
  const hit = idHit || aliasHits[0] || null;
  if (!hit) return jsonError(c, 404, 'Ningún ancla coincide con ese alias o canónico.');
  const via = idHit ? 'canonical' : 'alias';
  return c.json({
    ok: true,
    query: q,
    via,
    canonical: canonicalFromAncla(hit.mapped.ancla),
    ancla: hit.mapped.ancla,
    campo: await hydrateAncla(c.env.DB, hit.row, { reveal }),
  });
});

app.get('/v1/anclas/:id', async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM anclas WHERE id = ?').bind(c.req.param('id')).first();
  if (!row) return jsonError(c, 404, 'Ancla no encontrada.');
  const reveal = await mayRevealSensitive(c);
  const negocioId = String(c.req.query('negocio_id') || '').trim();
  const campo = await hydrateAncla(c.env.DB, row as Record<string, unknown>, { reveal });
  if (negocioId) {
    const valores = await loadValoresNegocio(c.env.DB, negocioId, String(row.id), {
      mask: !!campo.sensible && !reveal,
    });
    return c.json({
      ok: true,
      campo: { ...campo, ...valores, negocio_id: negocioId },
    });
  }
  return c.json({ ok: true, campo });
});

/** Valores / historial por negocio (N2). Definición del ancla no guarda valorActual. */
app.get('/v1/anclas/:id/valores', async (c) => {
  const id = c.req.param('id');
  const negocioId = String(c.req.query('negocio_id') || '').trim();
  if (!negocioId) return jsonError(c, 400, 'Falta negocio_id.');
  const row = await c.env.DB.prepare('SELECT * FROM anclas WHERE id = ?').bind(id).first();
  if (!row) return jsonError(c, 404, 'Ancla no encontrada.');
  const mapped = mapAnclaRow(row as Record<string, unknown>);
  const reveal = await mayRevealSensitive(c);
  const valores = await loadValoresNegocio(c.env.DB, negocioId, id, {
    mask: mapped.sensible && !reveal,
  });
  return c.json({
    ok: true,
    negocio_id: negocioId,
    ancla_id: id,
    ancla: mapped.ancla,
    ...valores,
  });
});

app.get('/v1/mongo', async (c) => {
  const rows = await c.env.DB.prepare('SELECT * FROM campos_mongo ORDER BY campo').all();
  return c.json({
    ok: true,
    id: 'campos-mongodb',
    nombre: 'Campos MongoDB',
    campos: (rows.results || []).map(mapMongo),
  });
});

app.get('/v1/mongo/:id', async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM campos_mongo WHERE id = ?').bind(c.req.param('id')).first();
  if (!row) return jsonError(c, 404, 'Campo Mongo no encontrado.');
  return c.json({ ok: true, campo: mapMongo(row as Record<string, unknown>) });
});

app.get('/v1/proyectos', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT id, nombre, descripcion, hash, created_at, updated_at FROM proyectos ORDER BY nombre'
  ).all();
  const out = [];
  for (const row of rows.results || []) {
    out.push(await hydrateProyecto(c.env.DB, row as Record<string, unknown>));
  }
  return c.json({ ok: true, id: 'proyectos', nombre: 'Proyectos', proyectos: out });
});

app.get('/v1/proyectos/:id', async (c) => {
  const row = await c.env.DB.prepare(
    'SELECT id, nombre, descripcion, hash, created_at, updated_at FROM proyectos WHERE id = ?'
  )
    .bind(c.req.param('id'))
    .first();
  if (!row) return jsonError(c, 404, 'Proyecto no encontrado.');
  return c.json({ ok: true, proyecto: await hydrateProyecto(c.env.DB, row as Record<string, unknown>) });
});

app.get('/v1/fundamentos', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT id, nombre, descripcion, hash, created_at, updated_at FROM fundamentos ORDER BY nombre'
  ).all();
  const out = [];
  for (const row of rows.results || []) {
    out.push(await hydrateFundamento(c.env.DB, row as Record<string, unknown>));
  }
  return c.json({ ok: true, id: 'fundamentos', nombre: 'Fundamentos', fundamentos: out });
});

app.get('/v1/fundamentos/:id', async (c) => {
  const row = await c.env.DB.prepare(
    'SELECT id, nombre, descripcion, hash, created_at, updated_at FROM fundamentos WHERE id = ?'
  )
    .bind(c.req.param('id'))
    .first();
  if (!row) return jsonError(c, 404, 'Fundamento no encontrado.');
  return c.json({ ok: true, fundamento: await hydrateFundamento(c.env.DB, row as Record<string, unknown>) });
});

app.get('/v1/agentes', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT id, nombre, foto, descripcion, invite_usada, last_seen, hash FROM agentes ORDER BY nombre'
  ).all();
  return c.json({
    ok: true,
    id: 'agentes',
    nombre: 'Agentes',
    agentes: (rows.results || []).map(mapAgente),
  });
});

/** Writes require a valid non-revoked invite key. */
app.use('/v1/*', async (c, next) => {
  if (c.req.method === 'GET' || c.req.method === 'OPTIONS' || c.req.method === 'HEAD') {
    return next();
  }
  // Public agent self-registration / heartbeat use body.clave instead.
  const path = new URL(c.req.url).pathname;
  if (path === '/v1/agentes/registro' || path === '/v1/agentes/latido' || path === '/v1/invites') {
    return next();
  }
  const clave = extractClave(c);
  if (!clave) return jsonError(c, 401, 'Falta AGENTE_CLAVE (Authorization: Bearer inv_… o X-Agente-Clave).');
  const inv = await c.env.DB.prepare('SELECT clave, revocada, usada_por FROM invites WHERE clave = ?')
    .bind(clave)
    .first<{ clave: string; revocada: number; usada_por: string | null }>();
  if (!inv || inv.revocada) return jsonError(c, 403, 'Invite inválida o revocada.');
  c.set('inviteClave', clave);
  if (inv.usada_por) c.set('agenteId', inv.usada_por);
  return next();
});

app.post('/v1/invites', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { clave?: string };
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  const clave =
    (body.clave && String(body.clave).trim()) ||
    'inv_' + Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  if (!clave.startsWith('inv_')) return jsonError(c, 400, 'La clave debe empezar por inv_.');
  const creada = nowIso();
  try {
    await c.env.DB.prepare('INSERT INTO invites (clave, creada, usada_por, revocada) VALUES (?, ?, NULL, 0)')
      .bind(clave, creada)
      .run();
  } catch {
    return jsonError(c, 409, 'Esa invite ya existe.');
  }
  return c.json({ ok: true, invite: { clave, creada, usadaPor: null } }, 201);
});

app.post('/v1/agentes/registro', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    clave?: string;
    nombre?: string;
    foto?: string;
    id?: string;
    descripcion?: string;
  };
  const clave = String(body.clave || '').trim();
  const nombre = String(body.nombre || '').trim();
  if (!clave || !nombre) return jsonError(c, 400, 'clave y nombre son obligatorios.');
  const inv = await c.env.DB.prepare('SELECT clave, revocada, usada_por FROM invites WHERE clave = ?')
    .bind(clave)
    .first<{ clave: string; revocada: number; usada_por: string | null }>();
  if (!inv || inv.revocada) return jsonError(c, 403, 'Invite inválida o revocada.');

  let id = String(body.id || '').trim();
  if (!id) id = slugId(nombre);
  if (!ID_RE.test(id)) return jsonError(c, 400, 'id inválido (^[a-z0-9][a-z0-9-]{0,60}$).');

  if (inv.usada_por && inv.usada_por !== id) {
    return jsonError(c, 409, 'Esta invite ya está usada por otro agente.');
  }

  const existingInvite = await c.env.DB.prepare('SELECT id FROM agentes WHERE invite_usada = ? AND id != ?')
    .bind(clave, id)
    .first();
  if (existingInvite) return jsonError(c, 409, 'Invite ya asignada a otro agente.');

  const ts = nowIso();
  const foto = String(body.foto || '').trim();
  const descripcion = String(body.descripcion || '').trim().slice(0, 280);
  const hash = await sha256Hex(id + '|' + nombre + '|' + clave);

  const prev = await c.env.DB.prepare('SELECT id FROM agentes WHERE id = ?').bind(id).first();
  if (prev) {
    await c.env.DB.prepare(
      'UPDATE agentes SET nombre = ?, foto = ?, descripcion = ?, invite_usada = ?, last_seen = ?, hash = ?, updated_at = ? WHERE id = ?'
    )
      .bind(nombre, foto, descripcion, clave, ts, hash, ts, id)
      .run();
  } else {
    await c.env.DB.prepare(
      'INSERT INTO agentes (id, nombre, foto, descripcion, invite_usada, last_seen, hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
      .bind(id, nombre, foto, descripcion, clave, ts, hash, ts, ts)
      .run();
  }
  await c.env.DB.prepare('UPDATE invites SET usada_por = ? WHERE clave = ?').bind(id, clave).run();
  return c.json({ ok: true, id, lastSeen: ts }, prev ? 200 : 201);
});

app.post('/v1/agentes/latido', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { id?: string; clave?: string };
  const id = String(body.id || '').trim();
  const clave = String(body.clave || '').trim();
  if (!id || !clave) return jsonError(c, 400, 'id y clave son obligatorios.');
  const ag = await c.env.DB.prepare('SELECT id, invite_usada FROM agentes WHERE id = ?')
    .bind(id)
    .first<{ id: string; invite_usada: string }>();
  if (!ag) return jsonError(c, 404, 'Agente no encontrado.');
  if (ag.invite_usada !== clave) return jsonError(c, 403, 'Clave incorrecta.');
  const inv = await c.env.DB.prepare('SELECT revocada FROM invites WHERE clave = ?')
    .bind(clave)
    .first<{ revocada: number }>();
  if (inv && inv.revocada) return jsonError(c, 403, 'Invite revocada.');
  const ts = nowIso();
  await c.env.DB.prepare('UPDATE agentes SET last_seen = ?, updated_at = ? WHERE id = ?').bind(ts, ts, id).run();
  return c.json({ ok: true, id, lastSeen: ts, enLinea: true });
});

app.delete('/v1/agentes/:id', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM agentes WHERE id = ?').bind(id).run();
  return c.json({ ok: true, deleted: id });
});

app.put('/v1/agentes/:id', async (c) => {
  const id = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as { nombre?: string; foto?: string; descripcion?: string };
  const ag = await c.env.DB.prepare('SELECT * FROM agentes WHERE id = ?').bind(id).first();
  if (!ag) return jsonError(c, 404, 'Agente no encontrado.');
  const nombre = String(body.nombre ?? (ag as { nombre: string }).nombre).trim();
  const foto = String(body.foto ?? ((ag as { foto: string }).foto || '')).trim();
  const descripcion = String(body.descripcion ?? ((ag as { descripcion: string }).descripcion || ''))
    .trim()
    .slice(0, 280);
  const ts = nowIso();
  const hash = await sha256Hex(id + '|' + nombre + '|' + ((ag as { invite_usada: string }).invite_usada || ''));
  await c.env.DB.prepare(
    'UPDATE agentes SET nombre = ?, foto = ?, descripcion = ?, hash = ?, updated_at = ? WHERE id = ?'
  )
    .bind(nombre, foto, descripcion, hash, ts, id)
    .run();
  return c.json({ ok: true, id, nombre, foto });
});

app.post('/v1/skills', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    id?: string;
    nombre?: string;
    descripcion?: string;
    markdown?: string;
    anclas?: string[];
  };
  const nombre = String(body.nombre || '').trim();
  if (!nombre) return jsonError(c, 400, 'nombre obligatorio.');
  const id = String(body.id || slugId(nombre)).trim();
  if (!ID_RE.test(id)) return jsonError(c, 400, 'id inválido.');
  const markdown = String(body.markdown || '');
  const descripcion = String(body.descripcion || '').trim().slice(0, 280);
  const anclas = normalizeAnclas(body.anclas);
  const ts = nowIso();
  const hash = await sha256Hex(markdown || id + '|1');
  try {
    await c.env.DB.prepare(
      'INSERT INTO skills (id, nombre, descripcion, hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
      .bind(id, nombre, descripcion, hash, ts, ts)
      .run();
  } catch {
    return jsonError(c, 409, 'Ya existe esa skill.');
  }
  await c.env.DB.prepare(
    'INSERT INTO skill_versions (skill_id, numero, fecha, markdown, ruta, nombre_archivo, hash) VALUES (?, 1, ?, ?, ?, ?, ?)'
  )
    .bind(id, todayIso(), markdown, '', id + '.md', hash)
    .run();
  await replaceSkillAnclas(c.env.DB, id, anclas);
  const skill = await hydrateSkill(
    c.env.DB,
    (await c.env.DB.prepare('SELECT * FROM skills WHERE id = ?').bind(id).first()) as Record<string, unknown>
  );
  return c.json({ ok: true, skill }, 201);
});

app.put('/v1/skills/:id', async (c) => {
  const id = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as {
    nombre?: string;
    descripcion?: string;
    markdown?: string;
    anclas?: string[];
  };
  const row = await c.env.DB.prepare('SELECT * FROM skills WHERE id = ?').bind(id).first();
  if (!row) return jsonError(c, 404, 'Skill no encontrada.');
  const nombre = String(body.nombre ?? (row as { nombre: string }).nombre).trim();
  const descripcion = String(body.descripcion ?? ((row as { descripcion: string }).descripcion || ''))
    .trim()
    .slice(0, 280);
  const max = await c.env.DB.prepare('SELECT COALESCE(MAX(numero), 0) AS m FROM skill_versions WHERE skill_id = ?')
    .bind(id)
    .first<{ m: number }>();
  const numero = (max?.m || 0) + 1;
  const markdown =
    body.markdown != null
      ? String(body.markdown)
      : (
          await c.env.DB.prepare(
            'SELECT markdown FROM skill_versions WHERE skill_id = ? ORDER BY numero DESC LIMIT 1'
          )
            .bind(id)
            .first<{ markdown: string }>()
        )?.markdown || '';
  const hash = await sha256Hex(markdown || id + '|' + numero);
  const ts = nowIso();
  await c.env.DB.prepare('UPDATE skills SET nombre = ?, descripcion = ?, hash = ?, updated_at = ? WHERE id = ?')
    .bind(nombre, descripcion, hash, ts, id)
    .run();
  await c.env.DB.prepare(
    'INSERT INTO skill_versions (skill_id, numero, fecha, markdown, ruta, nombre_archivo, hash) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(id, numero, todayIso(), markdown, '', id + '.md', hash)
    .run();
  if (body.anclas) await replaceSkillAnclas(c.env.DB, id, normalizeAnclas(body.anclas));
  const skill = await hydrateSkill(
    c.env.DB,
    (await c.env.DB.prepare('SELECT * FROM skills WHERE id = ?').bind(id).first()) as Record<string, unknown>
  );
  return c.json({ ok: true, skill });
});

app.delete('/v1/skills/:id', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM proyecto_skills WHERE skill_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM ancla_skills WHERE skill_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM skills WHERE id = ?').bind(id),
  ]);
  return c.json({ ok: true, deleted: id });
});

app.post('/v1/anclas', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const prepared = await prepareAnclaPersistAsync(c.env.DB, body);
  if ('error' in prepared) return jsonError(c, 400, prepared.error);
  const campo = prepared.campo;
  const ts = nowIso();
  try {
    await c.env.DB.prepare(
      `INSERT INTO anclas (id, ancla, etiqueta, clave_mongo, coleccion, base_datos, tipo, obligatorio, formato, descripcion, ejemplo, hash, aliases, observaciones, valor_actual, sensible, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        campo.id,
        campo.ancla,
        campo.etiqueta,
        campo.claveMongo,
        campo.coleccion,
        campo.baseDatos,
        campo.tipo,
        campo.obligatorio ? 1 : 0,
        campo.formato,
        campo.descripcion,
        campo.ejemplo,
        campo.hash,
        JSON.stringify(campo.aliases),
        '[]',
        '',
        campo.sensible ? 1 : 0,
        ts,
        ts
      )
      .run();
  } catch {
    return jsonError(c, 409, 'Ya existe ese ancla.');
  }
  await replaceAnclaSkills(c.env.DB, campo.id, campo.skills);
  const row = await c.env.DB.prepare('SELECT * FROM anclas WHERE id = ?').bind(campo.id).first();
  return c.json(
    {
      ok: true,
      piiRedactado: prepared.piiRedactado || undefined,
      campo: await hydrateAncla(c.env.DB, row as Record<string, unknown>, { reveal: true }),
    },
    201
  );
});

app.put('/v1/anclas/:id', async (c) => {
  const id = c.req.param('id');
  const prev = await c.env.DB.prepare('SELECT * FROM anclas WHERE id = ?').bind(id).first();
  if (!prev) return jsonError(c, 404, 'Ancla no encontrada.');
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const prevMapped = mapAnclaRow(prev as Record<string, unknown>);
  const prepared = await prepareAnclaPersistAsync(c.env.DB, { ...prevMapped, ...body, id }, id);
  if ('error' in prepared) return jsonError(c, 400, prepared.error);
  const merged = prepared.campo;
  const ts = nowIso();
  await c.env.DB.prepare(
    `UPDATE anclas SET ancla = ?, etiqueta = ?, clave_mongo = ?, coleccion = ?, base_datos = ?, tipo = ?,
     obligatorio = ?, formato = ?, descripcion = ?, ejemplo = ?, hash = ?, aliases = ?, observaciones = ?,
     valor_actual = ?, sensible = ?, updated_at = ? WHERE id = ?`
  )
    .bind(
      merged.ancla,
      merged.etiqueta,
      merged.claveMongo,
      merged.coleccion,
      merged.baseDatos,
      merged.tipo,
      merged.obligatorio ? 1 : 0,
      merged.formato,
      merged.descripcion,
      merged.ejemplo,
      merged.hash,
      JSON.stringify(merged.aliases),
      '[]',
      '',
      merged.sensible ? 1 : 0,
      ts,
      id
    )
    .run();
  if (body.skills) await replaceAnclaSkills(c.env.DB, id, merged.skills);
  const row = await c.env.DB.prepare('SELECT * FROM anclas WHERE id = ?').bind(id).first();
  return c.json({
    ok: true,
    piiRedactado: prepared.piiRedactado || undefined,
    campo: await hydrateAncla(c.env.DB, row as Record<string, unknown>, { reveal: true }),
  });
});

/**
 * Append observación por negocio (N2). No se escribe en la ficha global del ancla.
 * Body: { negocio_id, valor, url?, … }. URL/sin_pii: strict por defecto.
 */
app.post('/v1/anclas/:id/observaciones', async (c) => {
  const id = c.req.param('id');
  const prev = await c.env.DB.prepare('SELECT * FROM anclas WHERE id = ?').bind(id).first();
  if (!prev) return jsonError(c, 404, 'Ancla no encontrada.');
  const mapped = mapAnclaRow(prev as Record<string, unknown>);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const negocioId = String(body.negocio_id || body.negocioId || '').trim();
  if (!negocioId) return jsonError(c, 400, 'Falta negocio_id (los valores van por negocio, no en la ficha ancla).');
  const strictExplicit = body.strict === true || body.strict_pii === true;
  const strictOff = body.strict === false || body.strict_pii === false;
  const strict = strictExplicit || (!strictOff && defaultStrictPii(mapped));
  const prevValores = await loadValoresNegocio(c.env.DB, negocioId, id);
  const result = appendObservacion(prevValores.observaciones, body, {
    scrubUrlValue: looksLikeUrlAncla(mapped),
    strictPii: strict,
  });
  if (result.piiError) return jsonError(c, 400, result.piiError);
  const ts = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO ancla_valores_negocio (negocio_id, ancla_id, observaciones, valor_actual, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(negocio_id, ancla_id) DO UPDATE SET
       observaciones = excluded.observaciones,
       valor_actual = excluded.valor_actual,
       updated_at = excluded.updated_at`
  )
    .bind(negocioId, id, JSON.stringify(result.observaciones), result.valorActual, ts)
    .run();
  const valores = await loadValoresNegocio(c.env.DB, negocioId, id);
  return c.json({
    ok: true,
    piiRedactado: result.piiRedactado || undefined,
    negocio_id: negocioId,
    ancla_id: id,
    ...valores,
    campo: {
      ...(await hydrateAncla(c.env.DB, prev as Record<string, unknown>, { reveal: true })),
      ...valores,
      negocio_id: negocioId,
    },
  });
});

app.delete('/v1/anclas/:id', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM anclas WHERE id = ?').bind(id).run();
  return c.json({ ok: true, deleted: id });
});

/** Helper: flat campos.N.* → array BSON projection. */
app.post('/v1/helpers/proyeccion-array', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    ruta_ancla?: string;
    elemento?: Record<string, string>;
    valores?: Record<string, string>;
    mongo_id?: string;
  };
  let ruta = body.ruta_ancla;
  let elemento = body.elemento;
  if (body.mongo_id) {
    const mongo = await c.env.DB.prepare('SELECT * FROM campos_mongo WHERE id = ?')
      .bind(body.mongo_id)
      .first();
    if (!mongo) return jsonError(c, 404, 'Campo Mongo no encontrado.');
    const m = mapMongo(mongo as Record<string, unknown>);
    if (m.proyeccionMongo === 'array') {
      if (!ruta && m.ancla) {
        const canon = canonicalFromAncla(m.ancla);
        // `_campos.N_` → `campos.N` (no añadir otro `.N`)
        ruta = /\.N\b/.test(canon) ? canon.replace(/\.\d+\b/g, '.N') : canon.replace(/\.\d+.*$/, '') + '.N';
      }
      ruta = ruta || 'campos.N';
      if (!elemento && Object.keys(m.proyeccionElemento).length) elemento = m.proyeccionElemento;
    }
  }
  const out = proyectarArrayN({ ruta_ancla: ruta, elemento, valores: body.valores || {} });
  if (!out.ok) return jsonError(c, 400, out.error);
  return c.json({ ok: true, clave: out.clave, [out.clave]: out.array, array: out.array });
});

app.post('/v1/mongo', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const campo = normalizeMongoBody(body);
  if (!campo) return jsonError(c, 400, 'colección/clave obligatorias.');
  const ts = nowIso();
  try {
    await c.env.DB.prepare(
      `INSERT INTO campos_mongo (id, campo, base_datos, coleccion, clave, bson_type, obligatorio, descripcion, ancla, hash, proyeccion_mongo, proyeccion_elemento, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        campo.id,
        campo.campo,
        campo.baseDatos,
        campo.coleccion,
        campo.clave,
        campo.bsonType,
        campo.obligatorio ? 1 : 0,
        campo.descripcion,
        campo.ancla,
        campo.hash,
        campo.proyeccionMongo,
        JSON.stringify(campo.proyeccionElemento),
        ts,
        ts
      )
      .run();
  } catch {
    return jsonError(c, 409, 'Ya existe ese campo.');
  }
  return c.json({ ok: true, campo }, 201);
});

app.put('/v1/mongo/:id', async (c) => {
  const id = c.req.param('id');
  const prev = await c.env.DB.prepare('SELECT * FROM campos_mongo WHERE id = ?').bind(id).first();
  if (!prev) return jsonError(c, 404, 'Campo Mongo no encontrado.');
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const merged = normalizeMongoBody({ ...mapMongo(prev as Record<string, unknown>), ...body, id });
  if (!merged) return jsonError(c, 400, 'Datos inválidos.');
  const ts = nowIso();
  await c.env.DB.prepare(
    `UPDATE campos_mongo SET campo = ?, base_datos = ?, coleccion = ?, clave = ?, bson_type = ?,
     obligatorio = ?, descripcion = ?, ancla = ?, hash = ?, proyeccion_mongo = ?, proyeccion_elemento = ?, updated_at = ? WHERE id = ?`
  )
    .bind(
      merged.campo,
      merged.baseDatos,
      merged.coleccion,
      merged.clave,
      merged.bsonType,
      merged.obligatorio ? 1 : 0,
      merged.descripcion,
      merged.ancla,
      merged.hash,
      merged.proyeccionMongo,
      JSON.stringify(merged.proyeccionElemento),
      ts,
      id
    )
    .run();
  return c.json({ ok: true, campo: merged });
});

app.delete('/v1/mongo/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM campos_mongo WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true, deleted: c.req.param('id') });
});

app.post('/v1/proyectos', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    id?: string;
    nombre?: string;
    descripcion?: string;
    markdown?: string;
    skills?: string[];
  };
  const nombre = String(body.nombre || '').trim();
  if (!nombre) return jsonError(c, 400, 'nombre obligatorio.');
  const id = String(body.id || slugId(nombre)).trim();
  if (!ID_RE.test(id)) return jsonError(c, 400, 'id inválido.');
  const markdown = String(body.markdown || '');
  const descripcion = String(body.descripcion || '').trim().slice(0, 280);
  const skills = (body.skills || []).map(String).filter(Boolean);
  const ts = nowIso();
  const hash = await sha256Hex(markdown || id + '|1');
  try {
    await c.env.DB.prepare(
      'INSERT INTO proyectos (id, nombre, descripcion, hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
      .bind(id, nombre, descripcion, hash, ts, ts)
      .run();
  } catch {
    return jsonError(c, 409, 'Ya existe ese proyecto.');
  }
  await c.env.DB.prepare(
    'INSERT INTO proyecto_versions (proyecto_id, numero, fecha, markdown, ruta, nombre_archivo, hash) VALUES (?, 1, ?, ?, ?, ?, ?)'
  )
    .bind(id, todayIso(), markdown, '', id + '.md', hash)
    .run();
  await replaceProyectoSkills(c.env.DB, id, skills);
  return c.json({
    ok: true,
    proyecto: await hydrateProyecto(
      c.env.DB,
      (await c.env.DB.prepare('SELECT * FROM proyectos WHERE id = ?').bind(id).first()) as Record<string, unknown>
    ),
  }, 201);
});

app.put('/v1/proyectos/:id', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT * FROM proyectos WHERE id = ?').bind(id).first();
  if (!row) return jsonError(c, 404, 'Proyecto no encontrado.');
  const body = (await c.req.json().catch(() => ({}))) as {
    nombre?: string;
    descripcion?: string;
    markdown?: string;
    skills?: string[];
  };
  const nombre = String(body.nombre ?? (row as { nombre: string }).nombre).trim();
  const descripcion = String(body.descripcion ?? ((row as { descripcion: string }).descripcion || ''))
    .trim()
    .slice(0, 280);
  const max = await c.env.DB.prepare(
    'SELECT COALESCE(MAX(numero), 0) AS m FROM proyecto_versions WHERE proyecto_id = ?'
  )
    .bind(id)
    .first<{ m: number }>();
  const numero = (max?.m || 0) + 1;
  const markdown =
    body.markdown != null
      ? String(body.markdown)
      : (
          await c.env.DB.prepare(
            'SELECT markdown FROM proyecto_versions WHERE proyecto_id = ? ORDER BY numero DESC LIMIT 1'
          )
            .bind(id)
            .first<{ markdown: string }>()
        )?.markdown || '';
  const hash = await sha256Hex(markdown || id + '|' + numero);
  const ts = nowIso();
  await c.env.DB.prepare('UPDATE proyectos SET nombre = ?, descripcion = ?, hash = ?, updated_at = ? WHERE id = ?')
    .bind(nombre, descripcion, hash, ts, id)
    .run();
  if (body.markdown != null) {
    await c.env.DB.prepare(
      'INSERT INTO proyecto_versions (proyecto_id, numero, fecha, markdown, ruta, nombre_archivo, hash) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
      .bind(id, numero, todayIso(), markdown, '', id + '.md', hash)
      .run();
  }
  if (body.skills) await replaceProyectoSkills(c.env.DB, id, body.skills.map(String).filter(Boolean));
  return c.json({
    ok: true,
    proyecto: await hydrateProyecto(
      c.env.DB,
      (await c.env.DB.prepare('SELECT * FROM proyectos WHERE id = ?').bind(id).first()) as Record<string, unknown>
    ),
  });
});

app.delete('/v1/proyectos/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM proyectos WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true, deleted: c.req.param('id') });
});

app.post('/v1/fundamentos', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    id?: string;
    nombre?: string;
    descripcion?: string;
    markdown?: string;
  };
  const nombre = String(body.nombre || '').trim();
  if (!nombre) return jsonError(c, 400, 'nombre obligatorio.');
  const id = String(body.id || slugId(nombre)).trim();
  if (!ID_RE.test(id)) return jsonError(c, 400, 'id inválido.');
  const markdown = String(body.markdown || '');
  const descripcion = String(body.descripcion || '').trim().slice(0, 280);
  const ts = nowIso();
  const hash = await sha256Hex(markdown || id + '|1');
  try {
    await c.env.DB.prepare(
      'INSERT INTO fundamentos (id, nombre, descripcion, hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
      .bind(id, nombre, descripcion, hash, ts, ts)
      .run();
  } catch {
    return jsonError(c, 409, 'Ya existe ese fundamento.');
  }
  await c.env.DB.prepare(
    'INSERT INTO fundamento_versions (fundamento_id, numero, fecha, markdown, ruta, nombre_archivo, hash) VALUES (?, 1, ?, ?, ?, ?, ?)'
  )
    .bind(id, todayIso(), markdown, '', id + '.md', hash)
    .run();
  return c.json({
    ok: true,
    fundamento: await hydrateFundamento(
      c.env.DB,
      (await c.env.DB.prepare('SELECT * FROM fundamentos WHERE id = ?').bind(id).first()) as Record<string, unknown>
    ),
  }, 201);
});

app.put('/v1/fundamentos/:id', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT * FROM fundamentos WHERE id = ?').bind(id).first();
  if (!row) return jsonError(c, 404, 'Fundamento no encontrado.');
  const body = (await c.req.json().catch(() => ({}))) as {
    nombre?: string;
    descripcion?: string;
    markdown?: string;
  };
  const nombre = String(body.nombre ?? (row as { nombre: string }).nombre).trim();
  const descripcion = String(body.descripcion ?? ((row as { descripcion: string }).descripcion || ''))
    .trim()
    .slice(0, 280);
  const max = await c.env.DB.prepare(
    'SELECT COALESCE(MAX(numero), 0) AS m FROM fundamento_versions WHERE fundamento_id = ?'
  )
    .bind(id)
    .first<{ m: number }>();
  const numero = (max?.m || 0) + 1;
  const markdown =
    body.markdown != null
      ? String(body.markdown)
      : (
          await c.env.DB.prepare(
            'SELECT markdown FROM fundamento_versions WHERE fundamento_id = ? ORDER BY numero DESC LIMIT 1'
          )
            .bind(id)
            .first<{ markdown: string }>()
        )?.markdown || '';
  const hash = await sha256Hex(markdown || id + '|' + numero);
  const ts = nowIso();
  await c.env.DB.prepare('UPDATE fundamentos SET nombre = ?, descripcion = ?, hash = ?, updated_at = ? WHERE id = ?')
    .bind(nombre, descripcion, hash, ts, id)
    .run();
  await c.env.DB.prepare(
    'INSERT INTO fundamento_versions (fundamento_id, numero, fecha, markdown, ruta, nombre_archivo, hash) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(id, numero, todayIso(), markdown, '', id + '.md', hash)
    .run();
  return c.json({
    ok: true,
    fundamento: await hydrateFundamento(
      c.env.DB,
      (await c.env.DB.prepare('SELECT * FROM fundamentos WHERE id = ?').bind(id).first()) as Record<string, unknown>
    ),
  });
});

app.delete('/v1/fundamentos/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM fundamentos WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true, deleted: c.req.param('id') });
});

app.notFound((c) => jsonError(c, 404, 'Ruta no encontrada.'));
app.onError((err, c) => {
  console.error(err);
  return jsonError(c, 500, err instanceof Error ? err.message : 'Error interno.');
});

export default app;

/* ——— helpers ——— */

function slugId(nombre: string) {
  return String(nombre || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 61) || 'item';
}

function normalizeAnclas(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    let a = String(raw || '').trim();
    if (!a) continue;
    if (a[0] !== '_') a = '_' + a;
    if (a[a.length - 1] !== '_') a = a + '_';
    if (seen.has(a)) continue;
    seen.add(a);
    out.push(a);
  }
  return out;
}

async function sha256Hex(texto: string) {
  const data = new TextEncoder().encode(String(texto || ''));
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function replaceSkillAnclas(db: D1Database, skillId: string, anclas: string[]) {
  await db.prepare('DELETE FROM skill_anclas WHERE skill_id = ?').bind(skillId).run();
  for (const a of anclas) {
    await db.prepare('INSERT INTO skill_anclas (skill_id, ancla) VALUES (?, ?)').bind(skillId, a).run();
  }
}

async function replaceAnclaSkills(db: D1Database, anclaId: string, skills: string[]) {
  await db.prepare('DELETE FROM ancla_skills WHERE ancla_id = ?').bind(anclaId).run();
  for (const s of skills) {
    await db.prepare('INSERT OR IGNORE INTO ancla_skills (ancla_id, skill_id) VALUES (?, ?)').bind(anclaId, s).run();
  }
}

async function replaceProyectoSkills(db: D1Database, proyectoId: string, skills: string[]) {
  await db.prepare('DELETE FROM proyecto_skills WHERE proyecto_id = ?').bind(proyectoId).run();
  for (const s of skills) {
    await db.prepare('INSERT OR IGNORE INTO proyecto_skills (proyecto_id, skill_id) VALUES (?, ?)').bind(proyectoId, s).run();
  }
}

async function hydrateSkill(db: D1Database, row: Record<string, unknown>) {
  const id = String(row.id);
  const versiones = await db
    .prepare(
      'SELECT numero, fecha, markdown, ruta, nombre_archivo AS nombreArchivo, hash FROM skill_versions WHERE skill_id = ? ORDER BY numero'
    )
    .bind(id)
    .all();
  const anclas = await db.prepare('SELECT ancla FROM skill_anclas WHERE skill_id = ? ORDER BY ancla').bind(id).all();
  return {
    id,
    nombre: row.nombre,
    descripcion: row.descripcion || '',
    hash: row.hash || '',
    anclas: (anclas.results || []).map((r) => (r as { ancla: string }).ancla),
    versiones: versiones.results || [],
  };
}

async function mayRevealSensitive(c: {
  req: { method: string; header: (n: string) => string | undefined; query: (n: string) => string | undefined };
  env: Env;
}): Promise<boolean> {
  if (String(c.req.query('reveal') || '') !== '1') return false;
  const clave = extractClave(c);
  if (!clave) return false;
  const inv = await c.env.DB.prepare('SELECT clave, revocada FROM invites WHERE clave = ?')
    .bind(clave)
    .first<{ clave: string; revocada: number }>();
  return !!(inv && !inv.revocada);
}

async function hydrateAncla(
  db: D1Database,
  row: Record<string, unknown>,
  opts?: { reveal?: boolean }
) {
  const id = String(row.id);
  const skills = await db.prepare('SELECT skill_id FROM ancla_skills WHERE ancla_id = ?').bind(id).all();
  const mapped = mapAnclaRow(row);
  const reveal = !!opts?.reveal;
  let ejemplo = mapped.ejemplo;
  if (mapped.sensible && !reveal) {
    ejemplo = ejemplo ? maskSensitive(ejemplo) : '';
  }
  // N2: definición = sin valorActual/observaciones (van por negocio_id).
  return {
    ...mapped,
    ejemplo,
    valorActual: '',
    observaciones: [] as Observacion[],
    skills: (skills.results || []).map((r) => (r as { skill_id: string }).skill_id),
  };
}

async function loadValoresNegocio(
  db: D1Database,
  negocioId: string,
  anclaId: string,
  opts?: { mask?: boolean }
): Promise<{ valorActual: string; observaciones: Observacion[] }> {
  const row = await db
    .prepare(
      'SELECT observaciones, valor_actual FROM ancla_valores_negocio WHERE negocio_id = ? AND ancla_id = ?'
    )
    .bind(negocioId, anclaId)
    .first<{ observaciones: string; valor_actual: string }>();
  const observaciones = normalizeObservaciones(row?.observaciones);
  let valorActual =
    String(row?.valor_actual || '').trim() ||
    (observaciones.length ? observaciones[observaciones.length - 1].valor : '');
  let obs = observaciones;
  if (opts?.mask) {
    valorActual = valorActual ? maskSensitive(valorActual) : '';
    obs = observaciones.map((o) => ({ ...o, valor: maskSensitive(o.valor) }));
  }
  return { valorActual, observaciones: obs };
}

function mapAnclaRow(row: Record<string, unknown>) {
  const aliases = normalizeAliasList(row.aliases ?? row.alias);
  return {
    id: String(row.id),
    ancla: String(row.ancla || ''),
    etiqueta: String(row.etiqueta || ''),
    claveMongo: String(row.clave_mongo ?? row.claveMongo ?? ''),
    coleccion: String(row.coleccion || ''),
    baseDatos: String(row.base_datos ?? row.baseDatos ?? 'arquitectura_reservas'),
    tipo: String(row.tipo || 'string'),
    obligatorio: !!(row.obligatorio === 1 || row.obligatorio === true),
    formato: String(row.formato || ''),
    descripcion: String(row.descripcion || ''),
    ejemplo: String(row.ejemplo || ''),
    hash: String(row.hash || ''),
    aliases,
    // N2: ficha = definición. Valores por negocio en ancla_valores_negocio.
    observaciones: [] as Observacion[],
    valorActual: '',
    sensible: !!(row.sensible === 1 || row.sensible === true || row.sensible === '1'),
  };
}

function mapMongo(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    campo: String(row.campo || ''),
    baseDatos: String(row.base_datos ?? row.baseDatos ?? 'arquitectura_reservas'),
    coleccion: String(row.coleccion || ''),
    clave: String(row.clave || ''),
    bsonType: String(row.bson_type ?? row.bsonType ?? 'string'),
    obligatorio: !!(row.obligatorio === 1 || row.obligatorio === true),
    descripcion: String(row.descripcion || ''),
    ancla: String(row.ancla || ''),
    hash: String(row.hash || ''),
    proyeccionMongo: String(row.proyeccion_mongo ?? row.proyeccionMongo ?? '').trim(),
    proyeccionElemento: parseJsonObject(row.proyeccion_elemento ?? row.proyeccionElemento),
  };
}

function mapAgente(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    nombre: String(row.nombre || ''),
    foto: String(row.foto || ''),
    descripcion: String(row.descripcion || ''),
    inviteUsada: String(row.invite_usada ?? row.inviteUsada ?? ''),
    lastSeen: String(row.last_seen ?? row.lastSeen ?? ''),
    hash: String(row.hash || ''),
  };
}

async function hydrateProyecto(db: D1Database, row: Record<string, unknown>) {
  const id = String(row.id);
  const versiones = await db
    .prepare(
      'SELECT numero, fecha, markdown, ruta, nombre_archivo AS nombreArchivo, hash FROM proyecto_versions WHERE proyecto_id = ? ORDER BY numero'
    )
    .bind(id)
    .all();
  const skills = await db.prepare('SELECT skill_id FROM proyecto_skills WHERE proyecto_id = ?').bind(id).all();
  return {
    id,
    nombre: row.nombre,
    descripcion: row.descripcion || '',
    hash: row.hash || '',
    skills: (skills.results || []).map((r) => (r as { skill_id: string }).skill_id),
    versiones: versiones.results || [],
  };
}

async function hydrateFundamento(db: D1Database, row: Record<string, unknown>) {
  const id = String(row.id);
  const versiones = await db
    .prepare(
      'SELECT numero, fecha, markdown, ruta, nombre_archivo AS nombreArchivo, hash FROM fundamento_versions WHERE fundamento_id = ? ORDER BY numero'
    )
    .bind(id)
    .all();
  return {
    id,
    nombre: row.nombre,
    descripcion: row.descripcion || '',
    hash: row.hash || '',
    versiones: versiones.results || [],
  };
}

function normalizeAnclaBody(body: Record<string, unknown>) {
  let ancla = String(body.ancla || '').trim();
  let id = String(body.id || '').trim();
  if (!ancla && id) ancla = '_' + id + '_';
  if (!ancla) return null;
  if (ancla[0] !== '_') ancla = '_' + ancla;
  if (ancla[ancla.length - 1] !== '_') ancla = ancla + '_';
  if (!id) id = ancla.replace(/^_|_$/g, '');
  if (!id) return null;
  const skills = Array.isArray(body.skills) ? body.skills.map(String).filter(Boolean) : [];
  const aliases = normalizeAliasList(body.aliases ?? body.alias);
  const formato = String(body.formato || '').trim();
  const sensible =
    body.sensible === true ||
    body.sensible === 1 ||
    body.sensible === '1' ||
    /\bsensible\b/i.test(formato);
  return {
    id,
    ancla,
    etiqueta: String(body.etiqueta || '').trim(),
    claveMongo: String(body.claveMongo || body.clave_mongo || id.split('.').pop() || '').trim(),
    coleccion: String(body.coleccion || 'negocios').trim(),
    baseDatos: String(body.baseDatos || body.base_datos || 'arquitectura_reservas').trim(),
    tipo: String(body.tipo || 'string').trim(),
    obligatorio: !!(body.obligatorio === true || body.obligatorio === 1 || body.obligatorio === '1'),
    formato,
    descripcion: String(body.descripcion || '').trim(),
    ejemplo: String(body.ejemplo || '').trim(),
    skills,
    hash: String(body.hash || ''),
    aliases,
    // N2: nunca en la ficha; usar POST …/observaciones con negocio_id.
    observaciones: [] as Observacion[],
    valorActual: '',
    sensible,
  };
}

async function prepareAnclaPersistAsync(
  db: D1Database,
  body: Record<string, unknown>,
  selfId?: string
): Promise<
  | { campo: NonNullable<ReturnType<typeof normalizeAnclaBody>>; piiRedactado?: boolean }
  | { error: string }
> {
  const campo = normalizeAnclaBody(body);
  if (!campo) return { error: 'ancla/id inválidos.' };
  const hasObs =
    (Array.isArray(body.observaciones) && body.observaciones.length > 0) ||
    (typeof body.observaciones === 'string' && body.observaciones.trim() && body.observaciones.trim() !== '[]');
  const hasValor =
    (typeof body.valorActual === 'string' && body.valorActual.trim()) ||
    (typeof body.valor_actual === 'string' && body.valor_actual.trim());
  if (hasObs || hasValor) {
    return {
      error:
        'valorActual/observaciones no van en la ficha ancla; usa POST /v1/anclas/:id/observaciones con negocio_id.',
    };
  }
  const rows = await db.prepare('SELECT id, ancla, aliases FROM anclas').all();
  const catalog = (rows.results || []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: String(row.id),
      ancla: String(row.ancla || ''),
      aliases: normalizeAliasList(row.aliases),
    };
  });
  const conflict = findAliasConflicts({
    selfId: selfId || campo.id,
    aliases: campo.aliases,
    catalog,
  });
  if (conflict) return { error: conflict };

  const strictExplicit = body.strict === true || body.strict_pii === true;
  const strictOff = body.strict === false || body.strict_pii === false;
  const strict = strictExplicit || (!strictOff && defaultStrictPii(campo));
  let piiRedactado = false;
  if (looksLikeUrlAncla(campo) && campo.ejemplo) {
    const scrubbed = scrubPiiFromUrl(campo.ejemplo, { strict });
    if (strict && scrubbed.rejectedKeys.length) {
      return { error: 'ejemplo URL con PII en query: ' + scrubbed.rejectedKeys.join(', ') };
    }
    if (scrubbed.redacted) {
      campo.ejemplo = scrubbed.url;
      piiRedactado = true;
    }
  }
  return { campo, piiRedactado };
}

function normalizeMongoBody(body: Record<string, unknown>) {
  const coleccion = String(body.coleccion || '').trim();
  const clave = String(body.clave || '').trim();
  let campo = String(body.campo || '').trim();
  if (!campo && coleccion && clave) campo = coleccion + '.' + clave;
  if (!campo) return null;
  const id = String(body.id || campo.replace(/\./g, '-')).trim();
  let ancla = String(body.ancla || '').trim();
  if (ancla && ancla[0] !== '_') ancla = '_' + ancla;
  if (ancla && ancla[ancla.length - 1] !== '_') ancla = ancla + '_';
  const proyeccionMongo = String(body.proyeccionMongo || body.proyeccion_mongo || '').trim();
  let proyeccionElemento = parseJsonObject(body.proyeccionElemento ?? body.proyeccion_elemento);
  if (typeof body.proyeccion_elemento === 'string' && body.proyeccion_elemento.trim().startsWith('{')) {
    proyeccionElemento = parseJsonObject(body.proyeccion_elemento);
  }
  if (proyeccionMongo === 'array' && !Object.keys(proyeccionElemento).length && ancla) {
    const base = canonicalFromAncla(ancla).replace(/\.N$/, '');
    proyeccionElemento = {
      nombre: base + '.N.nombre',
      selector: base + '.N.selector',
      sensible: base + '.N.sensible',
    };
  }
  return {
    id,
    campo,
    baseDatos: String(body.baseDatos || body.base_datos || 'arquitectura_reservas').trim(),
    coleccion: coleccion || campo.split('.')[0],
    clave: clave || campo.split('.').slice(1).join('.'),
    bsonType: String(body.bsonType || body.bson_type || (proyeccionMongo === 'array' ? 'array' : 'string')).trim(),
    obligatorio: !!(body.obligatorio === true || body.obligatorio === 1 || body.obligatorio === '1'),
    descripcion: String(body.descripcion || '').trim(),
    ancla,
    hash: String(body.hash || ''),
    proyeccionMongo,
    proyeccionElemento,
  };
}
