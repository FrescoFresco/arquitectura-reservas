# Agente y catálogos

Empieza leyendo Documentación → API (`documentacion/api.md`) y `CLOUDFLARE.md`. No inventes rutas.

**Fuente de verdad:** `{API_BASE}/v1/…` en Cloudflare Worker + D1  
(`https://campos-ancla-api.web-legal-es.workers.dev`).  
Los JSON de `catalogo/` son semilla/fallback de la UI. **No uses `GITHUB_TOKEN` para darte de alta ni para el catálogo vivo.**

## Acceso

1. Un humano abre Catálogos → Agentes → **+ Agente**.
2. La UI llama `POST /v1/invites` y muestra una clave `inv_…` (sin caducidad) + instrucciones.
3. Tú te registras: `POST /v1/agentes/registro` con `{ clave, nombre, foto? }`.
4. Late ~cada 30 s: `POST /v1/agentes/latido` con `{ id, clave }` → En línea en la UI.
5. Escrituras de catálogo: `Authorization: Bearer inv_…`. Lecturas `GET` públicas.

## Qué puedes modificar (vía API)

Skills, Campos ancla, Campos MongoDB, Proyectos, Fundamentos — cada cambio versionado donde aplica. Eliminar skill limpia asociaciones N:M en proyectos.

No hay cola de comentarios / Metricool todavía.

`scripts/subir.js` es un espejo opcional a GitHub Contents; no sustituye D1.
