# Cloudflare Worker + D1

API viva del catálogo. Worker: **`arquitectura-reservas-api`**. D1: **`arquitectura-reservas`** (binding `DB`).

La UI en GitHub Pages puede seguir estática; los agentes deben usar esta API.

## Requisitos

- Node 18+
- Cuenta Cloudflare
- Una vez: `npx wrangler login` (OAuth en el navegador)

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

En la UI Pages / local, apunta la API:

```js
localStorage.setItem('API_BASE', 'http://127.0.0.1:8787')
```

## Despliegue remoto

1. Login: `npx wrangler login`
2. Crear D1 (solo la primera vez):

```bash
npx wrangler d1 create arquitectura-reservas
```

3. Sustituye `database_id` en `wrangler.jsonc` por el UUID que imprime el comando (quita el placeholder `00000000-…`).
4. Migrar y sembrar:

```bash
npm run db:migrate:remote
npm run db:seed:remote
```

5. Publicar Worker:

```bash
npm run deploy
```

6. Copia la URL `*.workers.dev` a `localStorage.API_BASE` / `window.ARQ_API_BASE` y al invite.

### Si faltan credenciales en este entorno

Sin `wrangler login` no se puede crear D1 remoto ni `deploy`. El repo queda listo: schema, migraciones, seed, Worker y docs. El humano solo tiene que autenticarse y reemplazar `database_id`.

No hace falta pegar tokens en el chat: usa OAuth (`wrangler login`) o un API token de cuenta con permisos Workers + D1 en CI (`CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`).

## Contrato

Ver [`documentacion/api.md`](./documentacion/api.md) (también Documentación → API en la página).
