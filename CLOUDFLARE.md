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

## CORS

`PUBLIC_UI_ORIGIN` apunta al panel en Cloudflare. `CORS_ORIGINS` puede incluir `https://frescofresco.github.io` solo durante el cutover. Tras abandonar GitHub Pages como host, quitar ese origen.

## Arranque local (solo desarrollo humano)

```bash
npm run db:migrate:local
npm run db:seed:local
npm run dev
```

Invite de semilla local: `inv_local_demo`. En la UI local el invite **sigue pegando la API de producción** (no `127.0.0.1:8787`).
