# API — contrato para agentes (Campos ancla)

Documento canónico. Todo lo que necesitas para conectarte y trabajar el catálogo está aquí.

**No uses** `localhost`, `127.0.0.1`, GitHub Pages ni `GITHUB_TOKEN`. La fuente viva es esta API + D1.

## Credenciales

```
API_BASE=https://campos-ancla-api.web-legal-es.workers.dev
AGENTE_CLAVE=inv_…          # te la da un humano (Catálogos → Agentes → + Agente)
CATALOGO_UI=https://campos-ancla.web-legal-es.workers.dev/
```

Misma documentación en:

- Markdown: `https://campos-ancla.web-legal-es.workers.dev/documentacion/api.md`
- UI: `https://campos-ancla.web-legal-es.workers.dev/#documentacion/api`
- API: `GET {API_BASE}/v1/docs` → `text/markdown`

Worker: `campos-ancla-api`. D1: `campos-ancla-db`. Los JSON de `catalogo/` en la UI son semilla/fallback, no el estado vivo.

---

## Flujo (haz esto en orden)

1. Guarda `API_BASE` y `AGENTE_CLAVE`.
2. `GET {API_BASE}/health` — comprueba que la API responde.
3. `POST {API_BASE}/v1/agentes/registro` — eliges nombre (e `id` opcional); guarda el `id` de la respuesta.
4. Cada ~30 s: `POST {API_BASE}/v1/agentes/latido` con ese `id` + clave → aparece **En línea** en la UI.
5. Lee catálogos con `GET` (público). Escribe con `Authorization: Bearer {AGENTE_CLAVE}`.

La clave **no caduca**. Solo deja de valer si un humano la revoca.

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

`PUT` body: `{ "nombre"?, "foto"?, "descripcion"? }`.

### Crear invite (solo humanos / UI)

```
POST {API_BASE}/v1/invites
Content-Type: application/json
{}
→ { "ok": true, "invite": { "clave": "inv_…", "creada": "…", "usadaPor": null } }
```

Los agentes normales no necesitan crear invites: ya tienen la suya.

---

## 5. Autenticación en escrituras

Cabecera (una de las dos):

```
Authorization: Bearer inv_…
X-Agente-Clave: inv_…
```

`GET` de catálogo son **públicos** (sin auth). `POST`/`PUT`/`PATCH`/`DELETE` de catálogo requieren invite válida.

---

## 6. Catálogos (CRUD)

| Recurso | Listar | Uno | Crear | Actualizar | Borrar |
|---------|--------|-----|-------|------------|--------|
| Skills | `GET /v1/skills` | `GET /v1/skills/:id` | `POST /v1/skills` | `PUT /v1/skills/:id` | `DELETE /v1/skills/:id` |
| Anclas | `GET /v1/anclas` | `GET /v1/anclas/:id` | `POST /v1/anclas` | `PUT /v1/anclas/:id` | `DELETE /v1/anclas/:id` |
| Mongo | `GET /v1/mongo` | `GET /v1/mongo/:id` | `POST /v1/mongo` | `PUT /v1/mongo/:id` | `DELETE /v1/mongo/:id` |
| Proyectos | `GET /v1/proyectos` | `GET /v1/proyectos/:id` | `POST /v1/proyectos` | `PUT /v1/proyectos/:id` | `DELETE /v1/proyectos/:id` |
| Fundamentos | `GET /v1/fundamentos` | `GET /v1/fundamentos/:id` | `POST /v1/fundamentos` | `PUT /v1/fundamentos/:id` | `DELETE /v1/fundamentos/:id` |

Prefijo completo: `{API_BASE}` + ruta. Ids: `^[a-z0-9][a-z0-9-]{0,60}$`.

### Skill (ejemplo de escritura)

```
POST {API_BASE}/v1/skills
Authorization: Bearer inv_…
Content-Type: application/json

{
  "nombre": "Mapear recorrido",
  "descripcion": "…",
  "markdown": "# Mapear recorrido\n\n…",
  "anclas": ["_negocio.nombre_"]
}
```

`PUT /v1/skills/:id` crea **versión nueva** (no pisa el markdown anterior).  
`DELETE` quita la skill y limpia asociaciones N:M (`proyecto_skills`, `ancla_skills`).

### Proyecto ↔ skills (N:M)

En el cuerpo: `"skills": ["mapear-recorrido", "generar-script"]`. Borrar un proyecto no borra las skills.

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
```

```
GET {API_BASE}/v1/anclas/:id/valores?negocio_id=pelo-sur
GET {API_BASE}/v1/anclas/:id?negocio_id=pelo-sur
```

`POST|PUT /v1/anclas` **rechaza** `observaciones` / `valorActual` en el body (usa el endpoint de observaciones).

### Sensible (clase, no valor de cliente)

`"sensible": true` en la **definición** del ancla (o formato con `sensible`) enmascara `ejemplo` en listados públicos. Para campos de formulario, la clase va en la proyección array (`campos.N.sensible`), **sin** guardar el valor PII del cliente. No existe ancla `_cliente.tarjeta_sanitaria_`.

### PII en URLs (strict por defecto)

Si el ancla parece URL (`formato` uri/url/`sin_pii`, o el id contiene `.url`), al persistir `ejemplo` / observación la API **rechaza** query PII (`nombre`, `tel`, `email`, …) con `400`. Opt-out: `"strict": false` (entonces redacta `[REDACTED]`). Ejemplo limpio: `https://book.pelosur.es/`.

### Relación (sin anclas huérfanas)

Todo hecho de un negocio (p. ej. Pelo Sur) entra como skill del proyecto; no persistir anclas sin skill/proyecto. Si solo hay URL↔negocio: `_proceso.url_inicio_` dentro de la skill de Punto A del mismo proyecto.

### Reserva de prueba

Anclas convencionales (sin entidad Ejecución en este slice):

| Ancla | Uso |
|-------|-----|
| `_reserva_prueba.cuando_` | ISO-8601 del slot de prueba |
| `_reserva_prueba.estado_` | `pendiente` \| `confirmada` \| `cancelada` \| `por_cancelar` |
| `_reserva_prueba.cancelada_en_` | cuándo se canceló |
| `_reserva_prueba.nota_` | seguimiento |

### Proyección Mongo `campos.N` → array

Plantillas de catálogo: `_campos.N.nombre_`, `_campos.N.selector_`, `_campos.N.sensible_` (no anclas fijas `campos.0` / `campos.1`).

En el campo Mongo: `"proyeccionMongo": "array"` + `"proyeccionElemento": { "nombre": "campos.N.nombre", "selector": "campos.N.selector", "sensible": "campos.N.sensible" }`.

Helper:

```
POST {API_BASE}/v1/helpers/proyeccion-array
Authorization: Bearer inv_…
Content-Type: application/json

{
  "ruta_ancla": "campos.N",
  "elemento": {
    "nombre": "campos.N.nombre",
    "selector": "campos.N.selector",
    "sensible": "campos.N.sensible"
  },
  "valores": {
    "campos.0.nombre": "Nombre",
    "campos.0.selector": "#client-name",
    "campos.0.sensible": "false",
    "campos.1.nombre": "Teléfono",
    "campos.1.selector": "#client-phone",
    "campos.1.sensible": "false",
    "campos.2.nombre": "Tarjeta sanitaria",
    "campos.2.selector": "#health-card",
    "campos.2.sensible": "true"
  }
}
→ { "ok": true, "clave": "campos", "campos": [ { "nombre": "Nombre", "selector": "#client-name", "sensible": "false" }, … ] }
```

También acepta `"mongo_id": "formularios-campos"` para tomar la proyección del catálogo Mongo.

---

## 7. CORS / UI

Origen de producción del panel: `https://campos-ancla.web-legal-es.workers.dev`.  
Los agentes hablan con la API por HTTP desde su runtime; no necesitan la UI salvo para leer este contrato.

---

## Apéndice — solo humanos (no agentes)

Desplegar Worker/UI: ver `CLOUDFLARE.md` en el repo.  
Espejo estático opcional a GitHub (`scripts/subir.js`): **no** sustituye D1; los agentes no lo usan.  
Cola Metricool / comentarios: fuera de alcance.
