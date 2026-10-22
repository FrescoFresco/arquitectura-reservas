# Diseño: incrustar, referenciar y listas

Verificado contra la documentación oficial el 21 oct 2026. Ejemplos con el archivador de la peluquería **Pelo Sur** (`pelo_sur`).

### Incrustar vs referenciar

Fuente: https://www.mongodb.com/docs/manual/data-modeling/best-practices/#link-related-data (la antigua página embedding-vs-references redirige aquí)

- **Incrustar** = grapar una mini-ficha dentro de la ficha: `{ nombre:"Ana", direccion:{ calle:"Mayor", ciudad:"Sevilla" } }`. Se lee todo de una vez. Úsalo cuando los datos se consultan juntos y son "de" esa ficha (relación 1:1 o 1:pocos).
- **Referenciar** = apuntar el `_id` de una ficha de otro cajón: la cita guarda `cliente_id: ObjectId("...")`. Úsalo cuando la lista crecería sin límite (miles de citas), cuando el dato se comparte entre muchas fichas o cambia a menudo. Se juntan al leer con `$lookup`.
- Regla de oro de MongoDB: "los datos que se consultan juntos, se guardan juntos".

### Listas de fichas (arrays de objetos)

Fuente: https://www.mongodb.com/docs/manual/core/document/#dot-notation , https://www.mongodb.com/docs/manual/tutorial/query-array-of-documents/ , https://www.mongodb.com/docs/manual/reference/operator/update/positional/

Ejemplo: `servicios: [ { nombre:"corte", minutos:30 }, { nombre:"tinte", minutos:60 } ]`

- **Notación de punto**: `servicios.nombre` busca en *todos* los elementos: `find({ "servicios.nombre": "tinte" })`.
- **Por posición** (empieza en 0): `servicios.1.minutos` es el segundo elemento. En la base de datos real **no existe una "N" literal**: `campos.N.nombre` es solo una forma de escribir plantillas en documentación; en MongoDB se usa un número real (`campos.0.nombre`) o un operador posicional.
- **Que el mismo elemento cumpla varias condiciones**: `$elemMatch`: `find({ servicios: { $elemMatch: { nombre:"tinte", minutos: { $gt: 45 } } } })`.
- **Operadores posicionales al actualizar**:
  - `$` = el primer elemento que coincidió: `updateOne({ "servicios.nombre":"tinte" }, { $set: { "servicios.$.minutos": 75 } })`
  - `$[]` = todos: `{ $inc: { "servicios.$[].minutos": 5 } }`
  - `$[x]` con `arrayFilters` = los que cumplan un filtro: `{ $set: { "servicios.$[s].minutos": 40 } }, { arrayFilters: [ { "s.nombre": "corte" } ] }`
- Añadir/quitar: `$push`, `$addToSet` (sin repetir), `$pull`.
