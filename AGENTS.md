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
2. Lees Documentación → API (`/v1/docs` o `/v1/docs.json`) — sección **Agente: cómo conectar y modificar todo**.
3. Te registras y late según ese contrato (`lee`/`escribe` → `["*"]`; ACL fino aún no filtra rutas).
4. Bearer invite = escritura completa del hub. Skills: `GET/POST /v1/ejecutar/:skillId[/entradas|/salidas]` (`negocio` = id del local). Corridas: `POST /v1/corridas` → `GET …/siguiente` → salidas con `corrida_id`.

## Qué puedes modificar (vía API)

Skills (I/O + `ejecutorId`), ejecutores (CRUD `/v1/ejecutores` + `…/ejecuciones`), system prompts, anclas, campos Mongo, clusters (+ URI), bases (`/v1/proyectos` · `/v1/esquemas`), colecciones (vía PUT BD o `GET /v1/colecciones`), flujos (CRUD incl. DELETE), disparadores (CRUD + motor: eventos, webhook `/v1/disparar`, cron horario), corridas (crear/listar/siguiente/DELETE; cola `pasos` avanza sola si el ejecutor no es `agente_externo`; `disparador_id`/`evento_id`; `proyectoId` canónico), fundamentos, Empujar (`…/crear-bd`), sync Mongo, color de entidades. Ejecutar salidas: Bearer + anclas ∈ `salidas` + URI en el Cluster (encola el siguiente paso).

No hay cola de comentarios / Metricool todavía.

`scripts/subir.js` es un espejo opcional a GitHub Contents; no sustituye D1.
