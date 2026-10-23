# API — contrato para agentes (Campos ancla)

Documento canónico. Todo lo que necesitas para **entrar y operar** el hub está aquí (auth, catálogos, skills I/O, ejecutar, errores).

**No uses** `localhost`, `127.0.0.1`, GitHub Pages ni `GITHUB_TOKEN`. La fuente viva es esta API + D1.

**Agentes** = operadores ACL del hub (invite `inv_…` + Bearer), no bots del software de la BD. En la UI viven en **Ajustes → Agentes**.

## Credenciales

```
API_BASE=https://campos-ancla-api.web-legal-es.workers.dev
AGENTE_CLAVE=inv_…          # te la da un humano (Ajustes → Agentes → + Agente)
CATALOGO_UI=https://campos-ancla.web-legal-es.workers.dev/
```

Misma documentación en:

- Markdown: `https://campos-ancla.web-legal-es.workers.dev/documentacion/api.md`
- UI: `https://campos-ancla.web-legal-es.workers.dev/#documentacion/api`
- API markdown: `GET {API_BASE}/v1/docs` → `text/markdown`
- API índice JSON: `GET {API_BASE}/v1/docs.json` → lista de rutas + auth

Worker: `campos-ancla-api`. D1: `campos-ancla-db`. Los JSON de `catalogo/` en la UI son semilla/fallback, no el estado vivo.

---

## Flujo (haz esto en orden)

1. Guarda `API_BASE` y `AGENTE_CLAVE`.
2. `GET {API_BASE}/health` — comprueba que la API responde.
3. `GET {API_BASE}/v1/docs` (o `/v1/docs.json`) — lee este contrato.
4. `POST {API_BASE}/v1/agentes/registro` — eliges nombre (e `id` opcional); guarda el `id` de la respuesta.
5. Cada ~30 s: `POST {API_BASE}/v1/agentes/latido` con ese `id` + clave → aparece **En línea** en la UI.
6. Lee catálogos con `GET` (público). Escribe / ejecuta salidas con `Authorization: Bearer {AGENTE_CLAVE}`.
7. Para una skill suelta: `GET /v1/ejecutar/:skillId` → contrato I/O + `systemPrompts`; luego entradas (GET) / salidas (POST).
8. Para una **cadena** (n8n solo orquesta): `POST /v1/corridas` → repetir `GET /v1/corridas/:id/siguiente` → IA con `systemPrompt`+skill+`entradas` → `POST …/salidas` con `corrida_id`+`nodo_id` → hasta `tipo: "fin"`.

La clave **no caduca**. Solo deja de valer si un humano la revoca.

**Límites:** no hay rate limit de producto en el Worker. No dispares latidos más de ~1/30 s ni bucles agresivos de escritura.

---

## 1. Salud

```
GET {API_BASE}/health
→ { "ok": true, "service": "campos-ancla-api" }
```

---

## 2. Registro

```
POST {API_BASE}/v1/agentes/registro
Content-Type: application/json

{
  "clave": "inv_…",
  "nombre": "Eco Mesa",
  "foto": "",
  "id": "eco-mesa",
  "descripcion": ""
}
```

| Campo | Obligatorio | Notas |
|-------|-------------|--------|
| `clave` | sí | Tu invite `inv_…` |
| `nombre` | sí | Cómo te ven en el catálogo |
| `id` | no | Slug `^[a-z0-9][a-z0-9-]{0,60}$`; si falta, se deriva del nombre |
| `foto` | no | URL |
| `descripcion` | no | Máx. ~280 caracteres |

Respuesta `200`/`201`:

```
{ "ok": true, "id": "eco-mesa", "lastSeen": "2026-10-21T12:00:00.000Z" }
```

Errores habituales: `403` invite inválida/revocada; `409` invite ya usada por otro agente; `400` campos inválidos.

---

## 3. Latido

```
POST {API_BASE}/v1/agentes/latido
Content-Type: application/json

{ "id": "eco-mesa", "clave": "inv_…" }
```

→ `{ "ok": true, "id": "eco-mesa", "lastSeen": "…" }`

Si no late ~2 minutos, la UI muestra Desconectado (la clave sigue válida).

---

## 4. Agentes (listar / editar / borrar)

```
GET    {API_BASE}/v1/agentes
PUT    {API_BASE}/v1/agentes/:id     Authorization: Bearer inv_…
DELETE {API_BASE}/v1/agentes/:id     Authorization: Bearer inv_…
```

`PUT` body: `{ "nombre"?, "foto"?, "descripcion"?, "proyectos"?, "lee"?, "escribe"? }`.

### Crear invite (solo humanos / UI)

```
POST {API_BASE}/v1/invites
Content-Type: application/json
{}
→ { "ok": true, "invite": { "clave": "inv_…", "creada": "…", "usadaPor": null } }
```

Los agentes normales no necesitan crear invites: ya tienen la suya.

---

## 5. Autenticación y alcance del Bearer

Cabecera (una de las dos):

```
Authorization: Bearer inv_…
X-Agente-Clave: inv_…
```

| Qué | Auth |
|-----|------|
| `GET` / `HEAD` / `OPTIONS` (catálogos, docs, ejecutar/entradas, operativa…) | Público |
| `POST`/`PUT`/`PATCH`/`DELETE` bajo `/v1/*` | Invite válida no revocada |
| `POST /v1/agentes/registro` y `/v1/agentes/latido` | `clave` en el **body** (no Bearer) |
| `POST /v1/invites` | Abierto (UI/humanos crean invites) |

Códigos auth:

| HTTP | Cuándo |
|------|--------|
| `401` | Falta Bearer / `X-Agente-Clave` |
| `403` | Invite inválida o revocada |

Campos del agente `proyectos`, `lee`, `escribe` son **metadatos ACL del hub** (UI / ficha). Hoy **no** se aplican como filtro en `/v1/ejecutar` ni en CRUD de catálogo: basta una invite válida. La frontera operativa de escritura en ejecutar es la lista **`salidas`** de la skill.

---

## 5b. Forma de errores (JSON crudo)

Todos los fallos de API responden body JSON (el panel lo muestra **crudo**, sin wrappers):

```json
{ "ok": false, "error": "mensaje legible", …camposExtra }
```

Ejemplos:

```json
{ "ok": false, "error": "Falta query negocio." }
{ "ok": false, "error": "Ancla(s) no están en salidas de esta skill.", "invalidas": ["_foo_"], "salidas": ["_bar_"] }
{ "ok": false, "error": "configure MONGODB_URI", "hint": "Configura la URI en Cluster → Conexión …" }
{ "ok": false, "error": "…", "mongo": { "message": "…", "name": "MongoServerError", "code": 8000 } }
```

**Nunca** aparece la URI Mongo en el body. Los mensajes del driver se scrubbean (`mongodb://***`). No loguees URIs ni invites.

---

## 5c. Naming de anclas

- Canónico en API/skills: `_segmento.campo_` (guiones bajos envolventes).
- Si omites `_` al escribir en `valores`, el Worker las añade.
- Aliases (sin `_`) en la ficha del ancla; resolución: `GET /v1/anclas/resolve?q=…`.
- Un ancla ↔ 0..1 campo Mongo (`coleccion` + `claveMongo` + `baseDatos` vía proyecto).

---

## 6. Catálogos (CRUD)

| Recurso | Listar | Uno | Crear | Actualizar | Borrar |
|---------|--------|-----|-------|------------|--------|
| Skills | `GET /v1/skills` | `GET /v1/skills/:id` | `POST /v1/skills` | `PUT /v1/skills/:id` | `DELETE /v1/skills/:id` |
| System prompts | `GET /v1/system-prompts` | `GET /v1/system-prompts/:id` | `POST /v1/system-prompts` | `PUT /v1/system-prompts/:id` | `DELETE /v1/system-prompts/:id` |
| Ejecutar | — | `GET /v1/ejecutar/:skillId` | — | `POST …/salidas` (Bearer; +`corrida_id`?) | — |
| Flujos | `POST /v1/flujos` | `GET /v1/flujos[/:id]` | — | — | — |
| Corridas | `POST /v1/corridas` | `GET /v1/corridas[/:id[/siguiente]]` | — | — | — |
| | | `GET …/entradas?negocio=` | | | |
| Anclas | `GET /v1/anclas` | `GET /v1/anclas/:id` | `POST /v1/anclas` | `PUT /v1/anclas/:id` | `DELETE /v1/anclas/:id` |
| Mongo | `GET /v1/mongo` | `GET /v1/mongo/:id` | `POST /v1/mongo` | `PUT /v1/mongo/:id` | `DELETE /v1/mongo/:id` |
| Clusters | `GET /v1/clusters` | `GET /v1/clusters/:id` | `POST /v1/clusters` | `PUT /v1/clusters/:id` | `DELETE /v1/clusters/:id` |
| Base de datos (API: proyectos / alias esquemas) | `GET /v1/proyectos` · `GET /v1/esquemas` | `GET /v1/proyectos/:id` · `/v1/esquemas/:id` | `POST` igual | `PUT` igual | `DELETE` igual |
| Fundamentos | `GET /v1/fundamentos` | `GET /v1/fundamentos/:id` | `POST /v1/fundamentos` | `PUT /v1/fundamentos/:id` | `DELETE /v1/fundamentos/:id` |

Prefijo completo: `{API_BASE}` + ruta. Ids: `^[a-z0-9][a-z0-9-]{0,60}$`.

### Skill (ejemplo de escritura)

Cada skill declara **entradas** (anclas que lee) y **salidas** (anclas que escribe). El campo `anclas` es la **unión** de ambas (compatibilidad).

```
POST {API_BASE}/v1/skills
Authorization: Bearer inv_…
Content-Type: application/json

{
  "nombre": "Mapear recorrido",
  "descripcion": "…",
  "markdown": "# Mapear recorrido\n\n…",
  "entradas": ["_proceso.url_inicio_"],
  "salidas": ["_version.recorrido.campos_"],
  "anclas": ["_proceso.url_inicio_", "_version.recorrido.campos_"]
}
```

Respuesta de listado/ficha incluye `entradas`, `salidas` y `anclas` (unión).  
Si solo envías `anclas` (legado), se tratan como **salidas**.

`PUT /v1/skills/:id` crea **versión nueva** (no pisa el markdown anterior).  
`DELETE` quita la skill y limpia asociaciones N:M (`proyecto_skills`, `ancla_skills`, `system_prompt_skills`).

Ficha / listado de skill incluyen `systemPrompts`: **array de longitud 0..1** (compat; una skill tiene como máximo un system prompt). Campos: id, nombre, descripcion, hash. Vacío `[]` si no hay.

Al crear/editar skill puedes enviar `systemPromptId` (string o `null`) o `systemPrompts` (array de 0 o 1 id). Si el PUT solo lleva ese campo (sin markdown/I/O), **no** crea versión nueva de MD: solo actualiza el vínculo.

### System prompts

MD versionado (comportamiento estable del agente). Relación: **un prompt → muchas skills**; **cada skill → como máximo 1 prompt** (`system_prompt_skills.skill_id` UNIQUE).

```
POST {API_BASE}/v1/system-prompts
Authorization: Bearer inv_…
Content-Type: application/json

{
  "nombre": "Agente reservas",
  "descripcion": "Tono y límites",
  "markdown": "# Rol\n\n…",
  "skills": ["mapear-recorrido"]
}
```

`PUT` crea **versión nueva** del markdown; si envías `skills`, sustituye la lista de skills de ese prompt.  
Si una skill ya estaba ligada a **otro** prompt, se **mueve** automáticamente a este (auto-replace); la respuesta incluye `movedSkills: [{ skillId, fromSystemPromptId }]`.

UI: Catálogos → **System prompts** (Documento | Skills | Interno). En la ficha skill, pestaña **System prompts** elige **uno** (o ninguno).

### Ejecutar skill (entradas / salidas → Mongo)

El agente lee las **entradas** y escribe las **salidas** vía Campo Mongo vinculado a cada ancla (`claveMongo` + `coleccion`). `negocio` = id del documento de negocio (p. ej. `pelo-sur`), **no** el id del software/`proyecto`.

#### 0) Contrato I/O (sin Mongo)

```
GET {API_BASE}/v1/ejecutar/:skillId
→ {
  ok, skill, nombre, descripcion, entradas, salidas, anclas,
  systemPrompts: [
    { id, nombre, descripcion, hash, markdown, version: { numero, fecha, hash } }
  ]
}
```

`systemPrompts`: array de longitud **0..1** (máx. un prompt por skill). Si no hay vínculo → `[]`. El agente carga el MD de sistema (si existe) + el MD de la skill.

#### 1) Leer entradas (público)

```bash
curl -sS "{API_BASE}/v1/ejecutar/mapear-recorrido/entradas?negocio=pelo-sur"
```

```
→ {
  "ok": true,
  "skill": "mapear-recorrido",
  "negocio": "pelo-sur",
  "valores": { "_proceso.url_inicio_": "https://…", "_negocio.nombre_": null },
  "mongo": { "configured": true|false, "db": "software_reservas", "source": "cluster"|"env"|"none" }
}
```

Resolución por ancla: Campo Mongo → documento de la colección (por `negocio` / `negocio_id`) → `getByPath(claveMongo)`. Si Mongo no tiene valor → fallback `ancla_valores_negocio` en D1. Sin URI: valores quedan `null` (no 503 en lectura).

#### 2) Escribir salidas (Bearer)

```bash
curl -sS -X POST "{API_BASE}/v1/ejecutar/mapear-recorrido/salidas" \
  -H "Authorization: Bearer inv_…" \
  -H "Content-Type: application/json" \
  -d '{
    "negocio": "pelo-sur",
    "valores": {
      "_version.recorrido.campos_": [
        { "nombre": "Teléfono", "selector": "#phone", "clase": "sensible" }
      ]
    }
  }'
```

```
→ { "ok": true, "skill": "mapear-recorrido", "negocio": "pelo-sur", "escritos": ["_version.recorrido.campos_"] }
```

`negocio_id` en el body es alias de `negocio`.

Opcional (bucle de corrida): añade `corrida_id` + `nodo_id` → escribe igual + copia `valores` a `corrida.datos`, marca el paso `hecho` y avanza el flujo. Sin esos campos el comportamiento no cambia.

#### Reglas de validación (salidas)

| Regla | HTTP | Body |
|-------|------|------|
| Falta `negocio` / id inválido | `400` | `{ ok:false, error }` |
| Falta `valores` | `400` | `{ ok:false, error }` |
| Clave de `valores` **no** ∈ `salidas` de la skill | `400` | `{ ok:false, error, invalidas, salidas }` |
| Skill inexistente | `404` | |
| Sin URI en el Cluster del esquema | `503` | `{ ok:false, error:"configure MONGODB_URI", hint }` |
| Fallo driver Mongo | `502` | `{ ok:false, error }` (URI scrubbeada) |
| Invite ausente / revocada | `401` / `403` | |

Solo se persisten anclas que tienen mapa Mongo (`coleccion`+`claveMongo`). Tras escribir Mongo, se espeja `valor_actual` en D1 cuando existe fila de ancla.

#### Cómo se resuelve negocio → URI

1. Anclas de la skill → filas Campos ancla → Campo Mongo (`baseDatos`, `coleccion`, `claveMongo`).
2. `baseDatos` (p. ej. `software_reservas`) → proyecto/esquema (`reservas`) → `clusterId`.
3. URI cifrada en `mongo_config_cluster` de ese Cluster (nunca en la respuesta).
4. Documento: colección `negocios` → `_id = negocio`; otras colecciones suelen usar `negocio_id` o stubs `{_id, negocio_id}`.

### Operativa (cadena de skills de una Base de datos)

```
GET {API_BASE}/v1/proyectos/:id/operativa
GET {API_BASE}/v1/esquemas/:id/operativa
→ { ok, proyecto, skills, mermaid, huecos, enlaces }
  ?format=mermaid → text/plain
```

Une **salidas** de skill A con **entradas** de skill B (mismo id de ancla). `huecos` = entradas que **ninguna** skill escribe (en el Mermaid van en rojo). UI: ficha Base de datos → pestaña **Operativa**.

La operativa es el **grafo derivado** (diseño). La **ejecución ordenada** con decisiones / espera / subflujo es un **flujo** + **corridas** (abajo).

### Flujos y corridas (bucle n8n)

n8n **solo orquesta**; la lógica vive aquí.

**Flujos** (D1, versionados, ligados a un `proyecto` / Base de datos):

| Tipo de nodo | Comportamiento |
|--------------|----------------|
| `inicio` | Arranque; se salta al avanzar |
| `skill` | Paso IA: `GET /siguiente` devuelve skill + systemPrompt + entradas |
| `decision` | Evalúa `condicion` sobre `datos` y elige arista `cuando: true\|false` |
| `espera` | `estado=esperando` hasta reanudación (aprobación humana) |
| `subflujo` | Crea corrida hija (`flujo_id`); padre `esperando` hasta hija `terminada` |
| `fin` | `estado=terminada` |

Condiciones seguras (sin `eval`): `{ "eq": ["_ancla_", valor] }`, `{ "neq": [...] }`, `{ "exists": "_ancla_" }`, `{ "truthy": "_ancla_" }`. Paths = claves de ancla en `corrida.datos`.

```
GET  {API_BASE}/v1/flujos?proyecto=reservas
GET  {API_BASE}/v1/flujos/:id
POST {API_BASE}/v1/flujos   Authorization: Bearer inv_…
     { id, nombre, proyecto_id, nodos[], aristas[], descripcion? }
```

Semilla viva: `reservas-descubrir-mapear` → `inicio → descubrir-negocio → mapear-recorrido → fin`.

**Corridas** (Mongo colección `corridas` en la BD del proyecto; índice liviano en D1):

```
POST {API_BASE}/v1/corridas
Authorization: Bearer inv_…
{ "flujo_id": "reservas-descubrir-mapear", "negocio": "pelo-sur", "datos_iniciales": { "_negocio.url_": "https://…" } }
→ { ok, corrida: { id, flujo_id, flujo_version, estado, paso_actual, pasos, datos, … } }

GET  {API_BASE}/v1/corridas?flujo_id=&negocio=&estado=&proyecto=
GET  {API_BASE}/v1/corridas/:id
GET  {API_BASE}/v1/corridas/:id/siguiente
→ skill: { corrida_id, nodo_id, tipo:"skill", skill, systemPrompt, entradas, negocio }
→ fin:   { tipo:"fin" }
→ espera:{ tipo:"espera", motivo:"aprobacion"|"subflujo", hijo_id? }
```

`entradas` en `/siguiente`: primero `corrida.datos`; si falta, Mongo por `negocio` (mismo mapa ancla→campo que ejecutar).

**Bucle n8n de referencia:**

```
POST /v1/corridas
loop:
  GET  /v1/corridas/:id/siguiente
  if tipo == "fin": break
  if tipo == "espera": poll / wait approval
  if tipo == "skill":
    call AI(systemPrompt + skill markdown + entradas)
    POST /v1/ejecutar/:skill/salidas
         { negocio, valores, corrida_id, nodo_id }
```

Estados de corrida: `en_curso` | `esperando` | `terminada` | `error`. Pasos: `pendiente` | `hecho` | `error`.

### Clusters (URI Atlas)

Modelo: **Cluster → Bases de datos → Colecciones → Campos**. La URI Atlas vive en el Cluster (`mongo_config_cluster`), no en cada Base de datos. Catálogo top-level **Clusters** (ficha Resumen / Conexión / Bases de datos).

```json
{ "id": "atlas-principal", "nombre": "Cluster Atlas", "descripcion": "…", "autoSync": false }
```

```
GET|POST|PUT|DELETE {API_BASE}/v1/clusters[/:id]
PUT body: { nombre?, descripcion?, autoSync? }   # autoSync = «Sincronizar al guardar» (opt-in)
GET|POST|DELETE     {API_BASE}/v1/clusters/:id/mongo-config
→ { ok, cluster, configured, own, connected, db, source: "cluster"|"none", autoSync, lastSync?, hint? }
  # nunca uri; POST body { uri, probeOnly? }
  # lastSync: { at, ok, proyecto, auto, dryRun?, mock?, db?, error?, hint? } — sin secretos
```

`autoSync: true` → tras guardar Campos (`/v1/mongo`) o cambios de colecciones/relaciones/`baseDatos`/`clusterId` en un proyecto del cluster, el Worker agenda `crear-bd` (debounce ~1,5 s por `proyecto_id`). Unidireccional hub→Atlas. Sin URI → mismo dry-run que Empujar. Empujar manual siempre disponible. Skills/anclas/agentes no disparan sync.

`DELETE` de un cluster con bases asociadas → `409`. Migración: esquemas sin cluster → `atlas-principal`; URIs de `mongo_config_proyecto` se suben al cluster.

### Base de datos (= softwares; rutas `/v1/proyectos` y alias `/v1/esquemas`)

En la UI el panel se llama **Base de datos**. En API el recurso canónico sigue en `/v1/proyectos`; `/v1/esquemas` es alias idéntico (no se renombran las rutas). Cada entrada es un software (`reservas`, `llamadas`, …), no un negocio. Campo `clusterId` (cluster padre). La ficha tiene pestañas Resumen → **Colecciones** → Diagrama → Campos → Agentes (`colecciones[]` con `id` + `descripcion`). Además hay un catálogo top-level **Colecciones** (todas las colecciones de todas las bases; ficha con Campos Mongo filtrados). No hay ruta `/v1/colecciones`: la UI las ensambla desde proyectos + mongo. Campos:

```json
{
  "id": "reservas",
  "nombre": "Software de reservas",
  "baseDatos": "software_reservas",
  "clusterId": "atlas-principal",
  "colecciones": [{ "id": "negocios", "descripcion": "…" }],
  "relaciones": [{ "desde": "reservas.negocio_id", "hacia": "negocios._id", "tipo": "N:1" }],
  "skills": ["descubrir-negocio"],
  "agentes": ["reservas-pagweb"]
}
```

- `PUT` crea **versión nueva**.
- Cada colección citada en `relaciones` debe existir en `colecciones` (si no → `400`).
- Negocios (`pelo-sur`, `la-mesa-norte`) viven como documentos del cajón `negocios` del schema `reservas`. Si aún quedan filas legado: `DELETE` con `{ "confirmLegacy": true }`.

```
GET  {API_BASE}/v1/proyectos/:id/diagrama
GET  {API_BASE}/v1/esquemas/:id/diagrama
→ { ok, proyecto, diagrama: { mermaid, colecciones, relaciones, baseDatos } }
  ?coleccion=negocios → erDiagram centrado en esa colección + vecinas por relaciones
  ?format=mermaid → text/plain con el erDiagram

POST {API_BASE}/v1/proyectos/:id/crear-bd
POST {API_BASE}/v1/esquemas/:id/crear-bd
Authorization: Bearer inv_…
→ crea DB/colecciones/índices/$jsonSchema desde campos Mongo de la base de datos
  URI: la del Cluster del esquema. Sin fallback a URI global ni a env.
  Sin URI → { mock:true, dryRun:true, plan, source } (default db del schema, p. ej. software_reservas)
```

### Campos MongoDB ↔ base de datos

Campo obligatorio `"proyecto": "reservas"` (id de la base de datos). `baseDatos` se toma de esa entrada (no a mano). `coleccion` debe estar en `colecciones`. Tipos `object` / `array` admiten `"hijos": […]`; `enum` opcional (p. ej. resultado de llamada).

```
GET {API_BASE}/v1/mongo?proyecto=reservas
GET {API_BASE}/v1/mongo?proyecto=llamadas
```

### Agentes — permisos por base de datos

```json
{ "proyectos": ["reservas"], "lee": ["_negocio.telefono_"], "escribe": ["_ejecucion.respuesta.estado_"] }
```

`PUT /v1/agentes/:id` acepta `proyectos`, `lee`, `escribe`.

### Base de datos ↔ skills (N:M)

En el cuerpo: `"skills": ["mapear-recorrido", "generar-script"]`. Borrar una base de datos no borra las skills.

### Ancla ↔ Mongo (0..1)

Campo Mongo puede llevar `"ancla": "_negocio.nombre_"`. Un ancla puede listar `"skills": ["…"]`.

### Forma de listados

Los listados suelen responder con `{ "ok": true, … }` y el array del recurso (p. ej. skills en `instrucciones`, agentes en `agentes`). Si `ok` es `false`, mira `error`.

---

## 6b. Anclas — aliases, valores por negocio, sensible, PII

### Aliases (unicidad)

Cada ancla guarda `aliases: ["contacto.telefono", "telefono_local"]` (sinónimos del software).

Reglas: un alias **no se repite** entre anclas; un alias **no puede coincidir** con el id/nombre de otra ancla. Teléfono canónico: `_negocio.telefono_` (alias `contacto.telefono`).

```
GET {API_BASE}/v1/anclas/resolve?q=contacto.telefono
→ { "ok": true, "via": "alias", "canonical": "negocio.telefono", "ancla": "_negocio.telefono_", "campo": { … } }

GET {API_BASE}/v1/anclas/resolve?q=negocio.telefono
→ { "ok": true, "via": "canonical", "canonical": "negocio.telefono", … }
```

Si el mismo alias está en dos fichas → `409`.

### Observaciones por negocio (no en la ficha)

La ficha del ancla es **definición** (tipo, formato, aliases, ejemplo genérico). `valorActual` / `observaciones` van por `negocio_id`:

```
POST {API_BASE}/v1/anclas/:id/observaciones
Authorization: Bearer inv_…
Content-Type: application/json

{
  "negocio_id": "pelo-sur",
  "valor": "+34 699 111 222",
  "url": "https://pelosur.es/contacto",
  "skill_id": "descubrir-negocio",
  "visto_en": "web"
}
→ guarda valor `+34699111222` (E.164) y puede devolver `e164Normalizado: true`
```

Si el valor no se puede normalizar a E.164 → `400`.

```
GET {API_BASE}/v1/anclas/:id/valores?negocio_id=pelo-sur
GET {API_BASE}/v1/anclas/:id?negocio_id=pelo-sur
```

`POST|PUT /v1/anclas` **rechaza** `observaciones` / `valorActual` en el body (usa el endpoint de observaciones). En la ficha, `ejemplo` con formato E.164 también se normaliza.

### E.164 (teléfono)

Si `formato` declara `E.164` / `e164`, al guardar observación o `ejemplo` la API **normaliza** (`+34 699 111 222` → `+34699111222`) o **rechaza** con `400`. Aplica a valores por `negocio_id` (no hay `valorActual` en la ficha).

### Sensible (máscara de ejemplo en la ficha)

`"sensible": true` en la **definición** del ancla (o formato con `sensible`) enmascara `ejemplo` en listados públicos. Eso **no** es la clase del campo de formulario.

### Clase de campo de formulario (X3)

Cada elemento de `versiones.recorrido.campos` lleva `clase` ∈ `normal` | `texto_libre` | `identificador` | `sensible` | `consentimiento` (`_version.recorrido.campos.N.clase_`). Sustituye el sí/no `sensible` del formulario. **Sin** guardar el valor PII del cliente. No existe ancla `_cliente.tarjeta_sanitaria_`.

En la proyección array, los booleanos salen como `true`/`false` reales (nunca `"false"` como texto).

### PII en URLs (strict por defecto)

Si el ancla parece URL (`formato` uri/url/`sin_pii`, o el id contiene `.url`), al persistir `ejemplo` / observación la API **rechaza** query PII (`nombre`, `tel`, `email`, …) con `400`. Opt-out: `"strict": false` (entonces redacta `[REDACTED]`). Ejemplo limpio: `https://book.pelosur.es/`.

### Relación (sin anclas huérfanas)

Todo hecho de un negocio (p. ej. Pelo Sur) entra como skill del proyecto; no persistir anclas sin skill/proyecto. Si solo hay URL↔negocio: `_proceso.url_inicio_` dentro de la skill de Punto A del mismo proyecto.

### Reserva de prueba (X4)

Cajón Mongo `reservas_prueba` en `/v1/mongo` (tipos `date` en `cuando` / `cancelada_en`; índices en `cuando` y `estado`):

| Ancla | Mongo | Tipo |
|-------|-------|------|
| `_reserva_prueba.cuando_` | `reservas_prueba.cuando` | date / datetime |
| `_reserva_prueba.estado_` | `reservas_prueba.estado` | string enum |
| `_reserva_prueba.cancelada_en_` | `reservas_prueba.cancelada_en` | date / datetime |
| `_reserva_prueba.nota_` | `reservas_prueba.nota` | string |

### Lista canónica de campos (X1/X3) — `versiones.recorrido.campos`

**Un solo sitio:** la lista de campos del formulario vive en la **versión del recorrido** (`versiones.recorrido.campos`). No existe `formularios.campos` ni plantillas `_campos.N_*` en `formularios`.

Plantillas: `_version.recorrido.campos.N_` (lista), `_version.recorrido.campos.N.nombre_`, `_version.recorrido.campos.N.selector_`, `_version.recorrido.campos.N.clase_`.

Campo Mongo: `"proyeccionMongo": "array"` + elemento con esas rutas. Helper:

```
POST {API_BASE}/v1/helpers/proyeccion-array
Authorization: Bearer inv_…
Content-Type: application/json

{
  "mongo_id": "versiones-recorrido-campos",
  "valores": {
    "version.recorrido.campos.0.nombre": "Nombre",
    "version.recorrido.campos.0.selector": "#client-name",
    "version.recorrido.campos.0.clase": "normal",
    "version.recorrido.campos.1.nombre": "Teléfono",
    "version.recorrido.campos.1.selector": "#client-phone",
    "version.recorrido.campos.1.clase": "sensible",
    "version.recorrido.campos.2.nombre": "Acepto la política",
    "version.recorrido.campos.2.selector": "#privacy",
    "version.recorrido.campos.2.clase": "consentimiento"
  }
}
→ { "ok": true, "clave": "version.recorrido.campos", "array": [
    { "nombre": "Nombre", "selector": "#client-name", "clase": "normal" },
    …
  ] }
```

---

## 6c. MongoDB Atlas (conexión + sync)

Driver: **`mongodb`** oficial en el Worker (TCP; no Data API).

**Origen de la URI:**
- Contexto de Base de datos / Cluster (`crear-bd`, `sync/proyecto`, ficha Cluster → **Conexión**): URI del cluster (`mongo_config_cluster` vía `proyectos.cluster_id`). **Sin** URI global ni fallback a env.
- Sin contexto (`/health`, `/v1/mongo/status`, `sync/negocio`): secret ops `MONGODB_URI` (no es producto / Ajustes).
- Opcional `MONGODB_DB` / campo `db` (default del schema, p. ej. `software_reservas`).

```
GET  {API_BASE}/health
→ { "ok": true, "service": "campos-ancla-api", "mongo": "configured" | "disconnected" }

GET  {API_BASE}/v1/mongo/status
→ { "ok": true, "configured": true|false, "connected": true|false, "db": "…",
    "source": "env"|"none", "hint"? }   # ops: secret Worker; nunca la URI

POST {API_BASE}/v1/mongo/config   # deprecated → 410
DELETE {API_BASE}/v1/mongo/config  # deprecated → 410

GET  {API_BASE}/v1/clusters/:id/mongo-config
POST {API_BASE}/v1/clusters/:id/mongo-config   # { uri, probeOnly? }
DELETE {API_BASE}/v1/clusters/:id/mongo-config

GET  {API_BASE}/v1/proyectos/:id/mongo-config   # solo estado (lee el cluster); escritura → 410
POST|DELETE {API_BASE}/v1/proyectos/:id/mongo-config  # deprecated → 410

POST {API_BASE}/v1/mongo/sync/negocio
Authorization: Bearer inv_…
{ "negocio_id": "pelo-sur" }
→ upsert en colección `negocios` desde ancla_valores_negocio (nombre, telefono, url, zona_horaria)

POST {API_BASE}/v1/mongo/sync/proyecto
Authorization: Bearer inv_…
{ "proyecto_id": "reservas", "negocio_id"? }
→ mismo upsert; usa URI del cluster del esquema; `negocio_id` por defecto = `proyecto_id`
```

Sin URI de cluster (ni ops env): sync → **503** `{ "error": "configure MONGODB_URI" }`. **Nunca** se devuelve la URI en ningún GET.

---

## 7. Seguridad (obligatorio)

- **Nunca** loguees, pegues en chat ni commits: URI Atlas, passwords, `ENCRYPTION_KEY`, invites `inv_…`.
- La API **no** reexpone la URI en ningún GET; errores scrubbean `mongodb://…`.
- Lecturas de catálogo son públicas: no guardes secretos en markdown de skills/fundamentos.
- Agentes del hub ≠ agentes de telefonía/n8n del software: esta API es el catálogo Campos ancla.

---

## 8. CORS / UI

Origen de producción del panel: `https://campos-ancla.web-legal-es.workers.dev`.  
Los agentes hablan con la API por HTTP desde su runtime; no necesitan la UI salvo para leer este contrato (Documentación → API) o registrarse vía invite en Ajustes → Agentes.

---

## 9. Checklist mínimo del agente

```bash
# 1 salud
curl -sS "$API_BASE/health"
# 2 contrato
curl -sS "$API_BASE/v1/docs.json" | head
# 3 registro (una vez)
curl -sS -X POST "$API_BASE/v1/agentes/registro" -H 'Content-Type: application/json' \
  -d "{\"clave\":\"$AGENTE_CLAVE\",\"nombre\":\"Eco Mesa\",\"id\":\"eco-mesa\"}"
# 4 latido
curl -sS -X POST "$API_BASE/v1/agentes/latido" -H 'Content-Type: application/json' \
  -d "{\"id\":\"eco-mesa\",\"clave\":\"$AGENTE_CLAVE\"}"
# 5 skills + I/O
curl -sS "$API_BASE/v1/skills/mapear-recorrido"
curl -sS "$API_BASE/v1/ejecutar/mapear-recorrido"
curl -sS "$API_BASE/v1/ejecutar/mapear-recorrido/entradas?negocio=pelo-sur"
# 6 escritura (Bearer)
curl -sS -X POST "$API_BASE/v1/ejecutar/mapear-recorrido/salidas" \
  -H "Authorization: Bearer $AGENTE_CLAVE" -H 'Content-Type: application/json' \
  -d '{"negocio":"pelo-sur","valores":{"_version.recorrido.campos_":[]}}'
```

---

## Apéndice — solo humanos (no agentes)

Desplegar Worker/UI: ver `CLOUDFLARE.md` en el repo.  
Espejo estático opcional a GitHub (`scripts/subir.js`): **no** sustituye D1; los agentes no lo usan.  
Cola Metricool / comentarios: fuera de alcance.  
URI Atlas: ficha **Cluster → Conexión** (no Ajustes → Conexiones; no por Base de datos).
