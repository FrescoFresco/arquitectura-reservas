# Patrones de diseño

Verificado contra la documentación oficial el 21 oct 2026. Ejemplos con el archivador de la peluquería **Pelo Sur** (`pelo_sur`).

### Patrones de diseño

Fuente: https://www.mongodb.com/docs/manual/data-modeling/design-patterns/

- **Atributos (attribute)**: muchas etiquetas parecidas se convierten en una lista de pares clave/valor, para poder indexarlas todas con un solo índice. Antes: `{ talla_s: 3, talla_m: 5 }`. Después: `{ stock: [ {k:"S", v:3}, {k:"M", v:5} ] }` + índice en `stock.k, stock.v`. Fuente: https://www.mongodb.com/docs/manual/data-modeling/design-patterns/group-data/attribute-pattern/
- **Versionado de esquema (schema versioning)**: cada ficha lleva `schema_version: 2`; el programa sabe leer fichas viejas y nuevas mientras conviven. Fuente: https://www.mongodb.com/docs/manual/data-modeling/design-patterns/data-versioning/schema-versioning/
- **Historial / solo añadir (document versioning / append-only)**: nunca se sobrescribe; la versión actual vive en un cajón (`precios`) y cada cambio se copia a otro (`precios_historial`) con fecha y nº de versión. Así puedes saber qué decía la ficha el día X. Fuente: https://www.mongodb.com/docs/manual/data-modeling/design-patterns/data-versioning/document-versioning/
- **Polimórfico (polymorphic)**: fichas de formas distintas conviven en el mismo cajón, distinguidas por una etiqueta tipo: `{ tipo:"corte", minutos:30 }` y `{ tipo:"producto", sku:"CH-01", precio: NumberDecimal("9.90") }`. Fuente: https://www.mongodb.com/docs/manual/data-modeling/design-patterns/polymorphic-data/polymorphic-schema-pattern/
- Otros oficiales: subconjunto, referencia extendida, cálculo, bucket, valores atípicos, árbol, archivo.
