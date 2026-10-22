# Cloudflare — Campos ancla

Producción vive en Cloudflare. GitHub es solo código (opcional espejo), no el host vivo.

| Pieza | Recurso | URL |
|-------|---------|-----|
| Panel UI | Worker Static Assets `campos-ancla` | https://campos-ancla.web-legal-es.workers.dev/ |
| API | Worker `campos-ancla-api` | https://campos-ancla-api.web-legal-es.workers.dev |
| Base de datos | D1 `campos-ancla-db` (`42cb5187-a922-4e40-8227-0e72c1002f15`) | binding `DB` |

Contrato para agentes: [`documentacion/api.md`](./documentacion/api.md). **Siempre `API_BASE=https://campos-ancla-api.web-legal-es.workers.dev`.** Nunca localhost en invites.

> Nota: el token de cuenta actual puede editar Workers pero **no** Cloudflare Pages (`Account → Cloudflare Pages → Edit`). Por eso el panel se publica como Worker Static Assets (recomendado por Cloudflare frente a Pages para sitios nuevos). Cuando el token tenga Pages Edit: `npm run deploy:pages` (proyecto `campos-ancla` → `*.pages.dev`) y actualizar `PUBLIC_UI_ORIGIN` / CORS.

## Requisitos

- Node 18+
- `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`, o `npx wrangler login`

## Desplegar API (Worker + D1)

```bash
npm install
npm run db:migrate:remote   # solo si hay migraciones nuevas
# npm run db:seed:remote    # solo semilla inicial; no pisa datos vivos
npm run deploy
```

## Desplegar panel UI

```bash
npm run deploy:ui
```

Equivale a `npm run build:ui` (arma `dist-ui/`) + `wrangler deploy -c wrangler.ui.jsonc`.

## Proyectos = softwares

Cada proyecto de catálogo es un **software** con `baseDatos` propia (p. ej. `software_reservas`). Los negocios viven como documentos Mongo en la colección `negocios`, no como proyectos. Migración D1: `0006_proyectos_software.sql`. Crear la base Atlas: `POST /v1/proyectos/:id/crear-bd` (URI desde Ajustes → Conexiones; sin URI responde plan en seco).

## MongoDB Atlas (Ajustes → Conexiones)

El Worker habla con Atlas con el **driver oficial `mongodb`** (TCP). No uses Data API. **No pegues la URI en el chat.**

**Preferido:** panel **Ajustes → Conexiones** → form URI (password) → `POST /v1/mongo/config`. Se cifra en D1 (AES-GCM) con secret `ENCRYPTION_KEY`. La URI **nunca** se reexpone en GET (solo `configured` + pista de host).

| Secret / var | Obligatorio | Dónde |
|--------------|-------------|--------|
| `ENCRYPTION_KEY` | sí, para guardar URI desde el panel | `npx wrangler secret put ENCRYPTION_KEY` (Worker `campos-ancla-api`) |
| `MONGODB_URI` | no (fallback) | Solo si no hay URI en D1; Cursor env + `wrangler secret put MONGODB_URI` |
| `MONGODB_DB` | no | default `software_reservas` (schema reservas). Opcional en el form o secret |

```bash
# Una vez (cifrado en reposo de la URI del panel):
npx wrangler secret put ENCRYPTION_KEY
# Alternativa ops sin panel:
npx wrangler secret put MONGODB_URI
npm run deploy
npm run db:migrate:remote   # incluye tabla mongo_config
```

Comprobar (sin filtrar secretos):

```bash
curl -s https://campos-ancla-api.web-legal-es.workers.dev/health
# → { "ok": true, "service": "campos-ancla-api", "mongo": "configured" | "disconnected" }

curl -s https://campos-ancla-api.web-legal-es.workers.dev/v1/mongo/status
# → { "ok": true, "configured": true|false, "connected": …, "db": "…", "source": "stored"|"env"|"none", "hint"? }
```

Sync (invite Bearer; proyección anclas → colección `negocios`):

```bash
curl -s -X POST https://campos-ancla-api.web-legal-es.workers.dev/v1/mongo/sync/negocio \
  -H "Authorization: Bearer inv_…" -H "Content-Type: application/json" \
  -d '{"negocio_id":"pelo-sur"}'

curl -s -X POST https://campos-ancla-api.web-legal-es.workers.dev/v1/mongo/sync/proyecto \
  -H "Authorization: Bearer inv_…" -H "Content-Type: application/json" \
  -d '{"proyecto_id":"pelo-sur"}'
```

Sin URI (ni panel ni secret), esos POST responden **503** `configure MONGODB_URI`. Documentación → MongoDB es solo lectura; el enlace a Atlas apunta a `#ajustes/conexiones`.

## CORS

`PUBLIC_UI_ORIGIN` apunta al panel en Cloudflare. `CORS_ORIGINS` puede incluir `https://frescofresco.github.io` solo durante el cutover. Tras abandonar GitHub Pages como host, quitar ese origen.

## Arranque local (solo desarrollo humano)

```bash
npm run db:migrate:local
npm run db:seed:local
npm run dev
```

Invite de semilla local: `inv_local_demo`. En la UI local el invite **sigue pegando la API de producción** (no `127.0.0.1:8787`).
