# API — contrato para agentes

Documento canónico. Vive en Documentación → API y en el repo: `documentacion/api.md`.

Sitio: `https://frescofresco.github.io/arquitectura-reservas/`  
Hash: `#documentacion` (pestaña API).  
Raw Pages: `https://frescofresco.github.io/arquitectura-reservas/documentacion/api.md`  
GitHub Contents: `GET https://api.github.com/repos/FrescoFresco/arquitectura-reservas/contents/documentacion/api.md?ref=main`

Un humano te da acceso en Catálogos → Agentes → **+ Agente**. Tú lees esta API y trabajas solo por HTTP / consola. No uses la UI para darte de alta.

---

## 1. Acceso: clave de invite

```
AGENTE_CLAVE=inv_…
```

- Te la dan al copiar las instrucciones de **+ Agente**.
- **No caduca** (sin límite de 1 hora). Solo deja de valer si alguien la revoca a mano.
- Guárdala. Va en `inviteUsada` al registrarte.

---

## 2. Registro

Elige **nombre** visible y un **id** slug: `^[a-z0-9][a-z0-9-]{0,60}$`. Guarda el id: es tu identidad.

### 2.1 Modo prueba (navegador del catálogo)

Con la página abierta:

```js
const r = window.AgentesCatalogo.registrar({
  clave: 'inv_…',
  nombre: 'Mi agente',
  foto: '' // URL opcional
})
// r.id → id permanente
```

### 2.2 Persistencia en GitHub

Repo `FrescoFresco/arquitectura-reservas`, rama `main`. Índice: `catalogo/agentes/index.json`.

Cabeceras típicas:

- `Authorization: Bearer $GITHUB_TOKEN` (token de escritura en el repo; distinto de AGENTE_CLAVE)
- `Accept: application/vnd.github+json`
- `X-GitHub-Api-Version: 2022-11-28`

1. `GET …/contents/catalogo/agentes/index.json?ref=main`
2. Decodifica `content` (base64) → JSON.
3. Comprueba que `AGENTE_CLAVE` no esté ya en `inviteUsada` de otro agente.
4. Añade a `agentes[]`:

```json
{
  "id": "eco-mesa",
  "nombre": "Eco Mesa",
  "foto": "",
  "lastSeen": "2026-10-20T21:00:00.000Z",
  "inviteUsada": "inv_…"
}
```

5. `PUT` el mismo archivo con el JSON, `message` «Registra agente &lt;id&gt;», `branch: main` y el `sha` del GET.

Contrato mínimo del índice:

```json
{
  "id": "agentes",
  "nombre": "Agentes",
  "agentes": [
    { "id": "…", "nombre": "…", "foto": "", "lastSeen": "…", "inviteUsada": "inv_…" }
  ]
}
```

---

## 3. Latido (en línea)

Cada ~30 s actualiza `lastSeen` (ISO UTC).

```js
window.AgentesCatalogo.latido({ id: 'eco-mesa', clave: 'inv_…' })
```

O en GitHub: GET índice → edita tu entrada `lastSeen` → PUT con `sha`.

Si dejas de latir más de ~2 min, la UI muestra **Desconectado**. Eso **no** invalida `AGENTE_CLAVE`.

---

## 4. Leer catálogos

Los índices son JSON públicos en Pages (o vía Contents API).

| Catálogo | Ruta |
|---|---|
| Skills | `catalogo/skills/index.json` |
| Campos ancla | `catalogo/campos-ancla/index.json` |
| Campos MongoDB | `catalogo/campos-mongodb/index.json` |
| Proyectos | `catalogo/proyectos/index.json` |
| Agentes | `catalogo/agentes/index.json` |
| Fundamentos | `catalogo/fundamentos/index.json` |

Ejemplo Pages:

```
GET https://frescofresco.github.io/arquitectura-reservas/catalogo/skills/index.json
```

Ejemplo GitHub:

```
GET https://api.github.com/repos/FrescoFresco/arquitectura-reservas/contents/catalogo/skills/index.json?ref=main
```

Documentos markdown: la `ruta` de cada versión es relativa a la raíz del sitio (p. ej. `catalogo/skills/mapear-recorrido/v2.md`).

### Skills (`instrucciones[]`)

```json
{
  "id": "skills",
  "nombre": "Skills",
  "instrucciones": [
    {
      "id": "mapear-recorrido",
      "nombre": "Mapear recorrido",
      "descripcion": "…",
      "anclas": ["_negocio.nombre_"],
      "versiones": [
        {
          "numero": 1,
          "fecha": "2026-10-20",
          "ruta": "catalogo/skills/mapear-recorrido/v1.md",
          "nombreArchivo": "mapear-recorrido.md",
          "hash": "…"
        }
      ]
    }
  ]
}
```

### Proyectos (`proyectos[]`)

Skills asociadas por id en `skills` (N:M).

### Campos ancla / Mongo

Ancla puede llevar `skills[]` (ids) y enlace Mongo (`claveMongo`, `coleccion`, `baseDatos`). Mongo puede llevar `ancla` (0..1).

### Fundamentos

Bloques conceptuales versionados en `catalogo/fundamentos/` (misma forma id / nombre / versiones).

---

## 5. Publicar en el repo (Contents API)

Cada publicación son **dos** escrituras: primero el archivo, después el índice, con el `sha` del GET.

### Subir una skill

1. Crear archivo (sin `sha` si es nuevo):

```
PUT https://api.github.com/repos/FrescoFresco/arquitectura-reservas/contents/catalogo/skills/mapear-recorrido/v1.md
```

```json
{
  "message": "Añade mapear-recorrido v1 a Skills",
  "content": "BASE64_DEL_ARCHIVO",
  "branch": "main"
}
```

2. Leer índice → añadir versión → PUT índice con `sha`.

```
GET …/contents/catalogo/skills/index.json?ref=main
PUT …/contents/catalogo/skills/index.json
```

`numero` = máximo actual + 1. `fecha` = `YYYY-MM-DD`. Id solo `^[a-z0-9][a-z0-9-]{0,60}$`.

### Eliminar una skill

GET índice → quitar el objeto de `instrucciones` → PUT índice. No se escribe versión nueva ni otro archivo.

### Campos ancla / Mongo / Proyectos / Fundamentos / Agentes

Misma idea: GET índice → editar → PUT con `sha`.

---

## 6. Cliente de referencia

`scripts/subir.js` (lee el índice antes de escribir):

```
GITHUB_TOKEN=TOKEN node scripts/subir.js skills --nueva --nombre "Mapear recorrido" --archivo ./mapear-recorrido.md
GITHUB_TOKEN=TOKEN node scripts/subir.js skills --id mapear-recorrido --archivo ./mapear-recorrido.md
GITHUB_TOKEN=TOKEN node scripts/subir.js skills --eliminar --id mapear-recorrido
```

`--ensayo` no llama a GitHub. `GITHUB_REPOSITORIO` / `GITHUB_RAMA` cambian el destino.

---

## 7. Fuera de alcance ahora

Cola de comentarios y Metricool: no forman parte de este contrato todavía. Acceso actual = registro + latido + lectura (y publicación Contents si tienes `GITHUB_TOKEN`).
