# Reglas de validación ($jsonSchema)

Verificado contra la documentación oficial el 21 oct 2026. Ejemplos con el archivador de la peluquería **Pelo Sur** (`pelo_sur`).

### Validación de esquema con `$jsonSchema`

Fuente: https://www.mongodb.com/docs/manual/core/schema-validation/ , https://www.mongodb.com/docs/manual/core/schema-validation/specify-json-schema/ , https://www.mongodb.com/docs/manual/reference/operator/query/jsonSchema/

Es la **lista de reglas pegada en la puerta del cajón**: MongoDB revisa cada ficha nueva o modificada contra esas reglas.

Palabras clave soportadas (MongoDB implementa el borrador 4 de JSON Schema, con añadidos y omisiones):

| Palabra | Qué comprueba | Ejemplo |
|---|---|---|
| `bsonType` | tipo BSON (alias de la sección 4); acepta lista | `bsonType: ["string","null"]` |
| `type` | tipo JSON (`object, array, number, boolean, string, null`); **no** acepta `integer` | `type: "string"` |
| `required` | etiquetas obligatorias | `required: ["nombre","telefono"]` |
| `properties` | reglas por etiqueta | `properties: { nombre: {bsonType:"string"} }` |
| `additionalProperties` | permitir o no etiquetas no listadas (`true/false` o un esquema) | `additionalProperties: false` (¡entonces lista `_id`!) |
| `patternProperties` | reglas para etiquetas cuyo nombre cumple un patrón | `patternProperties: { "^tel_": {bsonType:"string"} }` |
| `minProperties` / `maxProperties` | nº mínimo/máximo de etiquetas | `minProperties: 2` |
| `dependencies` | si existe A, debe existir B | `dependencies: { factura: ["nif"] }` |
| `enum` | solo valores de una lista | `enum: ["pendiente","confirmada","cancelada"]` |
| `minimum` / `maximum` | número mínimo/máximo | `minimum: 0, maximum: 500` |
| `exclusiveMinimum` / `exclusiveMaximum` | (booleanos) el límite no se incluye | `minimum: 0, exclusiveMinimum: true` |
| `multipleOf` | múltiplo de | `multipleOf: 5` |
| `minLength` / `maxLength` | longitud del texto | `maxLength: 280` |
| `pattern` | expresión regular del texto | `pattern: "^\\+[1-9][0-9]{6,14}$"` (E.164) |
| `items` | reglas para elementos de la lista (esquema o lista de esquemas) | `items: { bsonType: "object" }` |
| `additionalItems` | elementos extra cuando `items` es lista | `additionalItems: false` |
| `minItems` / `maxItems` | tamaño de la lista | `minItems: 1` |
| `uniqueItems` | sin repetidos | `uniqueItems: true` |
| `allOf` / `anyOf` / `oneOf` / `not` | combinar reglas | `oneOf: [{bsonType:"int"},{bsonType:"decimal"}]` |
| `title` / `description` | texto explicativo (sin efecto) | `description: "Teléfono en E.164"` |

**No soportados**: `$ref`, `$schema`, `default`, `definitions`, `format`, `id`, el tipo `"integer"` (usa `bsonType: "int"` o `"long"`), las definiciones de hipertexto/hipermedia (JSON References, JSON Pointers) y **cualquier palabra desconocida**. Desde 5.1, si pones `description`, MongoDB la incluye en el mensaje de error.

### `validationLevel` y `validationAction`

Fuente: https://www.mongodb.com/docs/manual/core/schema-validation/specify-validation-level/ y https://www.mongodb.com/docs/manual/core/schema-validation/handle-invalid-documents/

- `validationLevel`:
  - `"strict"` (por defecto): revisa todas las fichas que se crean o modifican.
  - `"moderate"`: revisa fichas nuevas y las modificaciones de fichas que ya cumplían; las antiguas que no cumplían se pueden modificar sin revisión.
  - `"constraint"` (nuevo en 9.0, no existe en 8.x): como strict pero además garantiza que *todas* las fichas del cajón cumplen; exige `validationAction` `error` o `errorAndLog` y no permite cambiar las reglas sin bajar antes a strict.
  - `"off"`: sin revisión.
- `validationAction`:
  - `"error"` (por defecto): rechaza la ficha inválida.
  - `"warn"`: la guarda pero apunta un aviso en el registro.
  - `"errorAndLog"` (nuevo en 8.1): rechaza y además registra el error en el log de mongod. Mientras un cajón lo use, no se puede bajar a una versión anterior.
- Se cambia en un cajón existente con `collMod`: `db.runCommand({ collMod: "clientes", validator: {...}, validationLevel: "moderate" })`.

### Crear un cajón con reglas (`db.createCollection`)

Fuente: https://www.mongodb.com/docs/manual/reference/method/db.createCollection/

```js
use pelo_sur
db.createCollection("citas", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      title: "Cita",
      required: ["cliente_id", "cuando", "estado"],
      additionalProperties: false,
      properties: {
        _id:        { bsonType: "objectId" },
        cliente_id: { bsonType: "objectId", description: "referencia a clientes._id" },
        cuando:     { bsonType: "date", description: "fecha real, no texto" },
        estado:     { enum: ["pendiente", "confirmada", "cancelada"] },
        precio:     { bsonType: "decimal", minimum: 0 },
        nota:       { bsonType: ["string", "null"], maxLength: 500 },
        servicios:  {
          bsonType: "array", minItems: 1,
          items: {
            bsonType: "object", required: ["nombre"],
            properties: { nombre: { bsonType: "string" }, minutos: { bsonType: "int", minimum: 5 } }
          }
        }
      }
    }
  },
  validationLevel: "strict",
  validationAction: "error"
})
```
Si alguien intenta guardar `estado: "quizás"` o `cuando: "21/10/2026"` (texto), MongoDB responde *Document failed validation* y explica qué regla falló.
