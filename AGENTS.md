# Agente y catálogos

Empieza leyendo el contrato API (todo está ahí):

- https://campos-ancla.web-legal-es.workers.dev/documentacion/api.md
- UI: https://campos-ancla.web-legal-es.workers.dev/#documentacion/api
- `GET https://campos-ancla-api.web-legal-es.workers.dev/v1/docs`

```
API_BASE=https://campos-ancla-api.web-legal-es.workers.dev
```

Los JSON de `catalogo/` son semilla/fallback de la UI. **No uses `GITHUB_TOKEN` ni localhost.**

## Acceso

1. Un humano abre Catálogos → Agentes → **+ Agente** y te pega el bloque (clave + URLs).
2. Lees Documentación → API.
3. Te registras y late según ese contrato.

## Qué puedes modificar (vía API)

Skills, Campos ancla, Campos MongoDB, Esquemas de BD (`/v1/proyectos` + alias `/v1/esquemas`), Fundamentos — cada cambio versionado donde aplica. Eliminar skill limpia asociaciones N:M en esquemas.

No hay cola de comentarios / Metricool todavía.

`scripts/subir.js` es un espejo opcional a GitHub Contents; no sustituye D1.
