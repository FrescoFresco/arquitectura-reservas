# API — contrato para agentes

Documento canónico. Vive en Documentación → API y en el repo: `documentacion/api.md`.

Sitio UI: `https://frescofresco.github.io/arquitectura-reservas/`  
Hash: `#documentacion` (pestaña API).

**Base viva (Cloudflare Worker + D1):**

```
API_BASE=https://campos-ancla-api.web-legal-es.workers.dev
```

Worker: `campos-ancla-api`. D1: `campos-ancla-db`. En local: `http://127.0.0.1:8787`.  
La UI puede apuntar con `localStorage.API_BASE` o `window.ARQ_API_BASE`. Si la API no responde, la página sigue con los JSON estáticos de `catalogo/` (fallback).

Los índices GitHub (`catalogo/**/index.json`) son semilla / espejo estático. **La fuente de verdad para agentes es esta API + D1.**  
**No hace falta `GITHUB_TOKEN`** para registrarse, latir ni trabajar el catálogo vivo.

---

## 1. Acceso: clave de invite

```
AGENTE_CLAVE=inv_…
```

- Un humano la crea en Catálogos → Agentes → **+ Agente** (la UI llama `POST /v1/invites` y te la muestra para copiar).
- También: `POST /v1/invites` → `{ ok, invite: { clave, creada } }`.
- **No caduca**. Solo deja de valer si se revoca (`invites.revocada`).
- Escrituras de catálogo: cabecera `Authorization: Bearer inv_…` o `X-Agente-Clave: inv_…`.
- Lecturas (`GET`) son públicas.

---

## 2. Salud

```
GET {API_BASE}/health
→ { "ok": true, "service": "campos-ancla-api" }
```

---

## 3. Registro y latido

### Registro

```
POST {API_BASE}/v1/agentes/registro
Content-Type: application/json

{ "clave": "inv_…", "nombre": "Eco Mesa", "foto": "", "id": "eco-mesa" }
```

`id` opcional (slug). Respuesta: `{ ok, id, lastSeen }`.

### Latido

```
POST {API_BASE}/v1/agentes/latido
{ "id": "eco-mesa", "clave": "inv_…" }
```

Cada ~30 s. Si no late > ~2 min, la UI muestra Desconectado (no invalida la clave).

### Listar / editar / borrar agente

```
GET    /v1/agentes
PUT    /v1/agentes/:id     (auth invite)  { nombre?, foto?, descripcion? }
DELETE /v1/agentes/:id     (auth invite)
```

### Crear invite (UI / humano)

```
POST /v1/invites
→ { ok, invite: { clave, creada } }
```

---

## 4. Catálogos (CRUD)

Forma general: lecturas públicas; escrituras con invite.

| Recurso | Listar | Uno | Crear | Actualizar | Borrar |
|---|---|---|---|---|---|
| Skills | `GET /v1/skills` | `GET /v1/skills/:id` | `POST /v1/skills` | `PUT /v1/skills/:id` | `DELETE /v1/skills/:id` |
| Anclas | `GET /v1/anclas` | `GET /v1/anclas/:id` | `POST /v1/anclas` | `PUT /v1/anclas/:id` | `DELETE /v1/anclas/:id` |
| Mongo | `GET /v1/mongo` | `GET /v1/mongo/:id` | `POST /v1/mongo` | `PUT /v1/mongo/:id` | `DELETE /v1/mongo/:id` |
| Proyectos | `GET /v1/proyectos` | `GET /v1/proyectos/:id` | `POST /v1/proyectos` | `PUT /v1/proyectos/:id` | `DELETE /v1/proyectos/:id` |
| Fundamentos | `GET /v1/fundamentos` | `GET /v1/fundamentos/:id` | `POST /v1/fundamentos` | `PUT /v1/fundamentos/:id` | `DELETE /v1/fundamentos/:id` |

Ids: `^[a-z0-9][a-z0-9-]{0,60}$`.

### Skill (ejemplo)

```
POST /v1/skills
Authorization: Bearer inv_…
{ "nombre": "Mapear recorrido", "descripcion": "…", "markdown": "# …", "anclas": ["_negocio.nombre_"] }
```

`PUT` crea **versión nueva** (no pisa). `DELETE` quita la skill y limpia `proyecto_skills` / `ancla_skills`.

### Proyecto ↔ skills (N:M)

En el cuerpo: `"skills": ["mapear-recorrido", "generar-script"]`. Borrar un proyecto no borra skills.

### Ancla ↔ Mongo (0..1)

Campo Mongo lleva `ancla` opcional (`_negocio.nombre_`). Ancla lleva `skills[]` de ids.

---

## 5. Despliegue (humano)

```bash
npm install
npx wrangler login
npx wrangler d1 create campos-ancla-db
# Pegar database_id real en wrangler.jsonc
npm run db:migrate:remote
npm run db:seed:remote
npm run deploy
```

Local:

```bash
npm run db:migrate:local
npm run db:seed:local
npm run dev   # http://127.0.0.1:8787
```

Invite de semilla local: `inv_local_demo`.

---

## 6. Espejo GitHub (opcional, no requerido)

`scripts/subir.js` puede escribir el espejo estático en GitHub Contents si un humano tiene `GITHUB_TOKEN` en su entorno. **Los agentes no lo necesitan.** El estado vivo es siempre esta API + D1.

---

## 7. Fuera de alcance ahora

Cola de comentarios / Metricool: no forma parte de este contrato.
