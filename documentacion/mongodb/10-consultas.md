# Consultas: crear, leer, actualizar y borrar fichas (CRUD)

Verificado contra la documentación oficial el 21 oct 2026. Ejemplos con el archivador de la peluquería **Pelo Sur** (`pelo_sur`).

### Qué es CRUD

Fuente: https://www.mongodb.com/docs/manual/crud/

Son las cuatro cosas que se hacen con las fichas de un cajón: **meter** (Create), **buscar** (Read), **cambiar** (Update) y **sacar** (Delete).

| Acción | Métodos oficiales |
|---|---|
| Meter fichas | `insertOne()`, `insertMany()` |
| Buscar | `find()` |
| Cambiar | `updateOne()`, `updateMany()`, `replaceOne()` |
| Sacar | `deleteOne()`, `deleteMany()` |

Ejemplo Pelo Sur:
```js
use pelo_sur
db.clientes.insertOne({ nombre: "Ana", telefono: "+34699111222" })
db.citas.find({ estado: "confirmada" })
db.citas.updateOne({ _id: ObjectId("671650a1c2f4e9b1a3d0e001") }, { $set: { estado: "cancelada" } })
db.citas.deleteMany({ estado: "cancelada" })
```
`updateOne`/`deleteOne` actúan sobre **la primera** ficha que encaja; `updateMany`/`deleteMany` sobre **todas**.

### Filtros: operadores de comparación y lógicos

Fuentes: https://www.mongodb.com/docs/manual/reference/operator/query-comparison/ y https://www.mongodb.com/docs/manual/reference/operator/query-logical/

El filtro es la "descripción" de las fichas que buscas.

| Operador | Significa | Ejemplo Pelo Sur |
|---|---|---|
| `$eq` | igual a | `{ estado: { $eq: "confirmada" } }` (equivale a `{ estado: "confirmada" }`) |
| `$ne` | distinto de | `{ estado: { $ne: "cancelada" } }` |
| `$gt` / `$gte` | mayor / mayor o igual | `{ precio: { $gte: NumberDecimal("20") } }` |
| `$lt` / `$lte` | menor / menor o igual | `{ cuando: { $lt: ISODate("2026-11-01T00:00:00Z") } }` |
| `$in` / `$nin` | está / no está en una lista | `{ estado: { $in: ["pendiente","confirmada"] } }` |
| `$and` | se cumplen todas | `{ $and: [ { estado: "confirmada" }, { precio: { $gt: 0 } } ] }` |
| `$or` | se cumple al menos una | `{ $or: [ { estado: "pendiente" }, { nota: null } ] }` |
| `$not` | invierte una condición | `{ precio: { $not: { $gt: 50 } } }` |
| `$nor` | no se cumple ninguna | `{ $nor: [ { estado: "cancelada" }, { nota: null } ] }` |

Para listas de fichas y `$elemMatch`, mira la subpestaña *Diseño*.

### Proyección: elegir qué etiquetas ver

Fuente: https://www.mongodb.com/docs/manual/tutorial/project-fields-from-query-results/

Es el segundo argumento de `find`: `1` = mostrar, `0` = ocultar. `_id` sale **siempre por defecto** salvo que pongas `_id: 0`. Salvo `_id`, **no se pueden mezclar** 1 y 0 en la misma proyección.
```js
db.clientes.find({}, { nombre: 1, telefono: 1 })          // nombre, telefono y _id
db.clientes.find({}, { nombre: 1, _id: 0 })               // solo nombre
db.clientes.find({}, { telefono: 0 })                     // todo menos telefono
```

### Operadores para cambiar fichas

Fuentes: https://www.mongodb.com/docs/manual/reference/operator/update-field/ y https://www.mongodb.com/docs/manual/reference/operator/update-array/

| Operador | Qué hace | Ejemplo |
|---|---|---|
| `$set` | pone un valor | `{ $set: { estado: "confirmada" } }` |
| `$unset` | quita la etiqueta | `{ $unset: { nota: "" } }` |
| `$inc` | suma una cantidad | `{ $inc: { visitas: 1 } }` |
| `$min` / `$max` | cambia solo si el valor nuevo es menor / mayor | `{ $max: { ultima_visita: ISODate("2026-10-21T10:00:00Z") } }` |
| `$currentDate` | pone la fecha actual (Date o Timestamp) | `{ $currentDate: { modificada: true } }` |
| `$push` | añade a una lista | `{ $push: { servicios: { nombre: "lavado" } } }` |
| `$addToSet` | añade solo si no estaba | `{ $addToSet: { etiquetas: "vip" } }` |
| `$pop` | quita el primero o el último | `{ $pop: { servicios: 1 } }` |
| `$pull` | quita los que cumplan una condición | `{ $pull: { servicios: { nombre: "lavado" } } }` |
