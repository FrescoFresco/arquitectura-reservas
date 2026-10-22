# Agregaciones: la cadena de montaje

Verificado contra la documentación oficial el 21 oct 2026. Ejemplos con el archivador de la peluquería **Pelo Sur** (`pelo_sur`).

### Qué es un pipeline

Fuente: https://www.mongodb.com/docs/manual/core/aggregation-pipeline/

Una agregación es una **cadena de montaje**: las fichas del cajón pasan por varias **etapas** en orden; cada etapa recibe las fichas de la anterior, las filtra, agrupa o transforma, y pasa el resultado a la siguiente. Las fichas originales no se modifican.

### Etapas principales

Fuente: https://www.mongodb.com/docs/manual/reference/operator/aggregation-pipeline/

| Etapa | Qué hace | Ejemplo Pelo Sur |
|---|---|---|
| `$match` | deja pasar solo las fichas que cumplen un filtro (mismos operadores que `find`) | `{ $match: { estado: "confirmada" } }` |
| `$group` | agrupa por una clave (`_id`) y calcula totales | `{ $group: { _id: "$cliente_id", total: { $sum: "$precio" }, citas: { $sum: 1 } } }` |
| `$project` | elige o calcula etiquetas de salida | `{ $project: { _id: 0, cuando: 1, estado: 1 } }` |
| `$lookup` | une con fichas de **otro cajón del mismo archivador** (unión externa izquierda) y las añade como lista | ver abajo |
| `$unwind` | "desdobla" una lista: saca una ficha por cada elemento | `{ $unwind: "$servicios" }` |
| `$sort` | ordena (1 ascendente, -1 descendente) | `{ $sort: { total: -1 } }` |

Fuentes por etapa: https://www.mongodb.com/docs/manual/reference/operator/aggregation/lookup/ , https://www.mongodb.com/docs/manual/reference/operator/aggregation/unwind/ , https://www.mongodb.com/docs/manual/reference/operator/aggregation/group/

### Ejemplo completo: cuánto ha gastado cada clienta de Pelo Sur

```js
db.citas.aggregate([
  { $match: { estado: "confirmada" } },
  { $group: { _id: "$cliente_id", total: { $sum: "$precio" }, citas: { $sum: 1 } } },
  { $lookup: { from: "clientes", localField: "_id", foreignField: "_id", as: "cliente" } },
  { $unwind: "$cliente" },
  { $project: { _id: 0, nombre: "$cliente.nombre", total: 1, citas: 1 } },
  { $sort: { total: -1 } }
])
```
Con `$unwind` sobre `servicios`, una cita con "corte" y "tinte" se convierte en dos fichas (una por servicio), útil para contar qué servicio se pide más.

### Límite de memoria

Fuente: https://www.mongodb.com/docs/manual/reference/limits/

Una etapa que necesita más de **100 megabytes** de memoria puede escribir archivos temporales en disco; el parámetro `allowDiskUseByDefault` controla si lo hace por defecto.
