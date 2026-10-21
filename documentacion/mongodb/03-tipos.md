# Tipos de datos (BSON)

Verificado contra la documentación oficial el 21 oct 2026. Ejemplos con el archivador de la peluquería **Pelo Sur** (`pelo_sur`).

### Todos los tipos BSON

Fuente: https://www.mongodb.com/docs/manual/reference/bson-types/ , https://www.mongodb.com/docs/manual/reference/operator/query/type/ , https://www.mongodb.com/docs/manual/reference/operator/query/jsonSchema/

El **alias** es el nombre en texto que se usa en `$type` y en `bsonType` de `$jsonSchema`. El **número** también vale en `$type`.

| Tipo | Nº | Alias | Ejemplo (mongosh) | Para qué |
|---|---|---|---|---|
| Double | 1 | `double` | `4.5` | números con decimales aproximados |
| String | 2 | `string` | `"Ana"` | texto UTF-8 |
| Object | 3 | `object` | `{ calle: "Mayor", num: 3 }` | ficha dentro de ficha |
| Array | 4 | `array` | `["corte","tinte"]` | lista |
| Binary data | 5 | `binData` | `BinData(0,"SGVsbG8=")` | bytes (archivos pequeños, UUID, datos cifrados) |
| Undefined | 6 | `undefined` | — | **obsoleto** |
| ObjectId | 7 | `objectId` | `ObjectId()` | identificador |
| Boolean | 8 | `bool` | `true` | sí/no |
| Date | 9 | `date` | `ISODate("2026-10-21T10:00:00Z")` | fecha+hora (ms desde 1970, UTC) |
| Null | 10 | `null` | `null` | "vacío a propósito" |
| Regular Expression | 11 | `regex` | `/^Ana/i` | patrón de texto |
| DBPointer | 12 | `dbPointer` | — | **obsoleto** |
| JavaScript | 13 | `javascript` | `Code("function(){}")` | código |
| Symbol | 14 | `symbol` | — | **obsoleto** |
| JavaScript with scope | 15 | `javascriptWithScope` | — | **obsoleto desde 4.4** |
| 32-bit integer | 16 | `int` | `NumberInt(3)` | entero pequeño (±2.147 millones) |
| Timestamp | 17 | `timestamp` | `Timestamp(1729500000,1)` | uso **interno** (replicación); no lo uses para fechas |
| 64-bit integer | 18 | `long` | `NumberLong("9007199254740993")` | entero grande |
| Decimal128 | 19 | `decimal` | `NumberDecimal("19.99")` | decimales exactos (dinero) |
| Min key | -1 | `minKey` | `MinKey()` | valor menor que todos (interno/comparaciones) |
| Max key | 127 | `maxKey` | `MaxKey()` | valor mayor que todos |

Extra: en `$type` existe el alias **`number`**, que equivale a double, int, long o decimal a la vez. Ejemplo: `db.citas.find({ precio: { $type: "number" } })`.

Orden de comparación entre tipos (de menor a mayor): MinKey, Null, números (int, long, double, decimal), Symbol/String, Object, Array, BinData, ObjectId, Boolean, Date, Timestamp, Regular Expression, JavaScript Code, JavaScript Code with Scope, MaxKey. Fuente: https://www.mongodb.com/docs/manual/reference/bson-type-comparison-order/

### Catálogo en JSON

El mismo listado en formato máquina está en `mongodb-tipos.json`.
