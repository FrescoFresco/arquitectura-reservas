# Agente y catálogos

Empieza leyendo el contrato API (todo está ahí):

- https://campos-ancla.web-legal-es.workers.dev/documentacion/api.md
- UI: https://campos-ancla.web-legal-es.workers.dev/#documentacion/api
- `GET https://campos-ancla-api.web-legal-es.workers.dev/v1/docs`
- `GET https://campos-ancla-api.web-legal-es.workers.dev/v1/docs.json`

```
API_BASE=https://campos-ancla-api.web-legal-es.workers.dev
```

Los JSON de `catalogo/` son semilla/fallback de la UI. **No uses `GITHUB_TOKEN` ni localhost.**

## Acceso

1. Un humano abre **Ajustes → Agentes → + Agente** y te pega el bloque (clave + URLs).
2. Lees Documentación → API (`/v1/docs` o `/v1/docs.json`).
3. Te registras y late según ese contrato.
4. Operas skills con `GET/POST /v1/ejecutar/:skillId[/entradas|/salidas]` (`negocio` = id del local).

## Qué puedes modificar (vía API)

Skills (incl. `entradas`/`salidas`), Campos ancla, Campos MongoDB, Clusters (`/v1/clusters` + URI), Base de datos (`/v1/proyectos` + alias `/v1/esquemas`, con `cluster_id`), Fundamentos — cada cambio versionado donde aplica. Eliminar skill limpia asociaciones N:M en bases de datos. Ejecutar salidas exige Bearer + anclas ∈ `salidas` de la skill + URI en el Cluster.

No hay cola de comentarios / Metricool todavía.

`scripts/subir.js` es un espejo opcional a GitHub Contents; no sustituye D1.
