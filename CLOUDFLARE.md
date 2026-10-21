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

## MongoDB Atlas (URI solo en secrets)

El Worker habla con Atlas con el **driver oficial `mongodb`** (TCP). No uses Data API. No pegues la URI en el chat ni en la UI.

| Secret / var | Obligatorio | Dónde |
|--------------|-------------|--------|
| `MONGODB_URI` | sí, para escribir | Cursor **Environment Secrets** + `npx wrangler secret put MONGODB_URI` (Worker `campos-ancla-api`) |
| `MONGODB_DB` | no | default `arquitectura_reservas` (coincide con `baseDatos` del catálogo). Opcional: `wrangler secret put MONGODB_DB` o var |

```bash
# Tras crear el cluster en Atlas y copiar la SRV:
npx wrangler secret put MONGODB_URI
# (pega la URI en el prompt; no la commits)
npm run deploy
```

Comprobar (sin filtrar secretos):

```bash
curl -s https://campos-ancla-api.web-legal-es.workers.dev/health
# → { "ok": true, "service": "campos-ancla-api", "mongo": "configured" | "disconnected" }

curl -s https://campos-ancla-api.web-legal-es.workers.dev/v1/mongo/status
# → { "ok": true, "configured": true|false, "connected": true|false|null, "db": "arquitectura_reservas" }
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

Sin `MONGODB_URI`, esos POST responden **503** `configure MONGODB_URI`. El panel solo muestra «URI configurada: sí/no».

## CORS

`PUBLIC_UI_ORIGIN` apunta al panel en Cloudflare. `CORS_ORIGINS` puede incluir `https://frescofresco.github.io` solo durante el cutover. Tras abandonar GitHub Pages como host, quitar ese origen.

## Arranque local (solo desarrollo humano)

```bash
npm run db:migrate:local
npm run db:seed:local
npm run dev
```

Invite de semilla local: `inv_local_demo`. En la UI local el invite **sigue pegando la API de producción** (no `127.0.0.1:8787`).
