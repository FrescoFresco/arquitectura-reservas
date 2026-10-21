# Límites y buenas prácticas

Verificado contra la documentación oficial el 21 oct 2026. Ejemplos con el archivador de la peluquería **Pelo Sur** (`pelo_sur`).

### Límite de 16 MB por ficha

Fuente: https://www.mongodb.com/docs/manual/reference/limits/#mongodb-limit-BSON-Document-Size

Una ficha BSON no puede pasar de **16 MB**, ni anidar más de **100 niveles**. Por eso las listas que crecen sin fin (todas las citas de un cliente durante años) van en otro cajón con referencia. Para archivos grandes existe **GridFS** (https://www.mongodb.com/docs/manual/core/gridfs/).

### Fechas como Date, no como texto

Fuente: https://www.mongodb.com/docs/manual/reference/method/Date/

- `ISODate("2026-10-21T10:00:00Z")` guarda un instante real en UTC (milisegundos desde 1970). Se puede ordenar, comparar (`$gte`), usar en TTL y en `$dateToString`.
- `"21/10/2026"` es solo texto: "02/11" queda antes que "21/10" al ordenar y no sirve para TTL.
- MongoDB guarda siempre en UTC; la zona horaria (p. ej. Atlantic/Canary) se guarda aparte si hace falta y se aplica al mostrar.

### Decimales para dinero

Fuente: https://www.mongodb.com/docs/manual/tutorial/model-monetary-data/

- `double` es aproximado: `0.1 + 0.2 = 0.30000000000000004`.
- Para dinero usa **`decimal`** (`NumberDecimal("19.99")`, 34 dígitos exactos), o enteros en céntimos (`precio_cent: NumberInt(1999)`).

### `null` vs etiqueta ausente

Fuente: https://www.mongodb.com/docs/manual/tutorial/query-for-null-fields/

- `nota: null` = la etiqueta existe y está vacía a propósito. Ausente = la ficha no tiene la etiqueta.
- `find({ nota: null })` encuentra **ambas** (vacía y ausente).
- `find({ nota: { $type: "null" } })` solo las que tienen `null`.
- `find({ nota: { $exists: false } })` solo las que no tienen la etiqueta.
- En `$jsonSchema`, `required` exige que exista (aunque sea `null`); para permitir null pon `bsonType: ["string","null"]`.
