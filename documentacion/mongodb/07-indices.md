# Índices

Verificado contra la documentación oficial el 21 oct 2026. Ejemplos con el archivador de la peluquería **Pelo Sur** (`pelo_sur`).

### Índices

Fuente: https://www.mongodb.com/docs/manual/indexes/ y https://www.mongodb.com/docs/manual/core/indexes/index-types/

Un índice es el **índice alfabético del cajón**: sin él, MongoDB mira ficha por ficha.

| Tipo | Qué hace | Ejemplo |
|---|---|---|
| Simple | una etiqueta | `db.citas.createIndex({ cuando: 1 })` (1 asc, -1 desc) |
| Compuesto | varias, el orden importa (regla ESR: igualdad, orden, rango) | `createIndex({ estado: 1, cuando: -1 })` |
| Único | prohíbe repetidos | `createIndex({ telefono: 1 }, { unique: true })` |
| Parcial | solo fichas que cumplen un filtro | `createIndex({ cuando: 1 }, { partialFilterExpression: { estado: "confirmada" } })` |
| TTL | borra fichas solas al caducar (etiqueta debe ser Date) | `createIndex({ creada: 1 }, { expireAfterSeconds: 86400 })` |
| Multikey | automático si la etiqueta es lista; indexa cada elemento | `createIndex({ "servicios.nombre": 1 })` |
| Texto | búsqueda por palabras; máximo uno por cajón | `createIndex({ nota: "text" }, { default_language: "spanish" })` → `find({ $text: { $search: "tinte" } })` |

También existen: geoespaciales (2dsphere), hashed, wildcard, clustered y, en Atlas, Atlas Search/Vector Search. Fuentes: https://www.mongodb.com/docs/manual/core/index-ttl/ , https://www.mongodb.com/docs/manual/core/index-partial/ , https://www.mongodb.com/docs/manual/core/index-unique/ , https://www.mongodb.com/docs/manual/core/indexes/index-types/index-multikey/ , https://www.mongodb.com/docs/manual/core/indexes/index-types/index-text/

Notas: el borrado TTL lo hace una tarea de fondo que se ejecuta cada 60 s, así que una ficha caducada puede seguir ahí un rato; si la ficha no tiene la etiqueta indexada, nunca caduca. Un índice compuesto solo puede tener una etiqueta que sea lista.
