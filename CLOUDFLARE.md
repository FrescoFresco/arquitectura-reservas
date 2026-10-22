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

Cada proyecto de catálogo es un **software** con `baseDatos` propia (p. ej. `software_reservas`) y `clusterId` hacia un **Cluster**. Los negocios viven como documentos Mongo en la colección `negocios`, no como proyectos. Migraciones D1: `0006_proyectos_software.sql`, `0009_clusters.sql`. Crear la base Atlas: `POST /v1/proyectos/:id/crear-bd` (URI del Cluster; sin URI responde plan en seco).

## MongoDB Atlas (por Cluster)

El Worker habla con Atlas con el **driver oficial `mongodb`** (TCP). No uses Data API. **No pegues la URI en el chat.**

**Producto:** ficha **Cluster → Conexión** → `POST /v1/clusters/:id/mongo-config`. Se cifra en D1 (`mongo_config_cluster`, AES-GCM) con secret `ENCRYPTION_KEY`. La URI **nunca** se reexpone en GET. **No hay** pestaña Ajustes → Conexiones ni URI por Base de datos.

| Secret / var | Obligatorio | Dónde |
|--------------|-------------|--------|
| `ENCRYPTION_KEY` | sí, para guardar URI del cluster | `npx wrangler secret put ENCRYPTION_KEY` (Worker `campos-ancla-api`) |
| `MONGODB_URI` | no (solo ops) | health / status / sync sin proyecto; **no** sustituye la URI del cluster |
| `MONGODB_DB` | no | default `software_reservas` (schema reservas) |

```bash
# Una vez (cifrado en reposo de la URI del cluster):
npx wrangler secret put ENCRYPTION_KEY
# Opcional ops (no producto):
npx wrangler secret put MONGODB_URI
npm run deploy
npm run db:migrate:remote   # incluye clusters + mongo_config_cluster
```

Comprobar (sin filtrar secretos):

```bash
curl -s https://campos-ancla-api.web-legal-es.workers.dev/health
# → { "ok": true, "service": "campos-ancla-api", "mongo": "configured" | "disconnected" }

curl -s https://campos-ancla-api.web-legal-es.workers.dev/v1/mongo/status
# → ops: { configured, connected, db, source: "env"|"none", hint? }

curl -s https://campos-ancla-api.web-legal-es.workers.dev/v1/clusters/atlas-principal/mongo-config
# → producto: { configured, own, connected, db, source: "cluster"|"none", hint? }
```

Sync (invite Bearer; proyección anclas → colección `negocios`):

```bash
curl -s -X POST https://campos-ancla-api.web-legal-es.workers.dev/v1/mongo/sync/negocio \
  -H "Authorization: Bearer inv_…" -H "Content-Type: application/json" \
  -d '{"negocio_id":"pelo-sur"}'

curl -s -X POST https://campos-ancla-api.web-legal-es.workers.dev/v1/mongo/sync/proyecto \
  -H "Authorization: Bearer inv_…" -H "Content-Type: application/json" \
  -d '{"proyecto_id":"reservas"}'
```

Sin URI del cluster, `crear-bd` / `sync/proyecto` fallan en claro (503 o plan en seco). Documentación → MongoDB es solo lectura.

## CORS

`PUBLIC_UI_ORIGIN` apunta al panel en Cloudflare. `CORS_ORIGINS` puede incluir `https://frescofresco.github.io` solo durante el cutover. Tras abandonar GitHub Pages como host, quitar ese origen.

## Arranque local (solo desarrollo humano)

```bash
npm run db:migrate:local
npm run db:seed:local
npm run dev
```

Invite de semilla local: `inv_local_demo`. En la UI local el invite **sigue pegando la API de producción** (no `127.0.0.1:8787`).
