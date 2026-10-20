# Cloudflare Worker + D1

API viva del catálogo **Campos ancla**. Worker: **`campos-ancla-api`**. D1: **`campos-ancla-db`** (binding `DB`).

URL producción: `https://campos-ancla-api.web-legal-es.workers.dev`

La UI en GitHub Pages puede seguir estática; los agentes deben usar esta API.

## Requisitos

- Node 18+
- Cuenta Cloudflare
- Una vez: `npx wrangler login` (OAuth en el navegador), o `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` en CI

## Arranque local

```bash
npm install
npm run db:migrate:local
npm run db:seed:local
npm run dev
```

Prueba:

```bash
curl -s http://127.0.0.1:8787/health
curl -s http://127.0.0.1:8787/v1/skills | head
```

Invite de semilla: `inv_local_demo`.

En la UI Pages / local, apunta la API (opcional; por defecto ya usa producción):

```js
localStorage.setItem('API_BASE', 'https://campos-ancla-api.web-legal-es.workers.dev')
// o local:
localStorage.setItem('API_BASE', 'http://127.0.0.1:8787')
```

## Despliegue remoto

1. Login: `npx wrangler login` (o token de cuenta)
2. Crear D1 (solo la primera vez):

```bash
npx wrangler d1 create campos-ancla-db
```

3. Sustituye `database_id` en `wrangler.jsonc` por el UUID que imprime el comando.
4. Migrar y sembrar:

```bash
npm run db:migrate:remote
npm run db:seed:remote
```

5. Publicar Worker:

```bash
npm run deploy
```

D1 actual: `campos-ancla-db` → `42cb5187-a922-4e40-8227-0e72c1002f15`.

### Si faltan credenciales en este entorno

Sin `wrangler login` / token no se puede crear D1 remoto ni `deploy`. No hace falta pegar tokens en el chat: usa OAuth o un API token de cuenta con permisos Workers + D1 (`CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`).

## Contrato

Ver [`documentacion/api.md`](./documentacion/api.md) (también Documentación → API en la página).
