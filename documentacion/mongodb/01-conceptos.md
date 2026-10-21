# Conceptos básicos

Verificado contra la documentación oficial el 21 oct 2026. Ejemplos con el archivador de la peluquería **Pelo Sur** (`pelo_sur`).

### La analogía que usamos en todo el documento

| MongoDB | Analogía | Ejemplo |
|---|---|---|
| Base de datos | **Archivador** | `pelo_sur` |
| Colección | **Cajón** del archivador | `clientes`, `citas` |
| Documento | **Ficha** dentro del cajón | la ficha de Ana |
| Campo | **Etiqueta** de la ficha con su valor | `nombre: "Ana"` |

### Bases de datos, colecciones y documentos

Fuente: https://www.mongodb.com/docs/manual/core/databases-and-collections/ y https://www.mongodb.com/docs/manual/core/document/

- Un **archivador** (base de datos) guarda varios **cajones** (colecciones).
- Un cajón guarda **fichas** (documentos). Las fichas de un mismo cajón *no tienen por qué* tener las mismas etiquetas, salvo que pongas reglas (validación, sección 5).
- Una ficha es un conjunto de pares *etiqueta: valor*, escrito como JSON pero guardado en **BSON** (JSON binario con más tipos, p. ej. fechas reales).
- Si escribes en un archivador o cajón que no existe, MongoDB **lo crea solo** al guardar la primera ficha.

Ejemplo de ficha:
```js
{ _id: ObjectId("671650a1c2f4e9b1a3d0e001"), nombre: "Ana", telefono: "+34699111222", alta: ISODate("2026-10-21T10:00:00Z") }
```

### `_id` y ObjectId

Fuente: https://www.mongodb.com/docs/manual/core/document/#the-_id-field y https://www.mongodb.com/docs/manual/reference/method/ObjectId/

- **Toda ficha tiene una etiqueta `_id`**, que es su número de expediente: único dentro del cajón. Si no lo pones, MongoDB pone un **ObjectId** automáticamente.
- `_id` siempre tiene índice único; no se puede cambiar una vez guardada la ficha; puede ser de cualquier tipo **excepto array o regex**. Si `_id` es una ficha anidada, sus etiquetas internas no pueden empezar por `$`.
- Un **ObjectId** ocupa 12 bytes (24 caracteres hexadecimales): 4 bytes de fecha/hora de creación (segundos desde 1970), 5 bytes aleatorios generados una vez por proceso y 3 bytes de contador que empieza en un valor aleatorio. Por eso se puede saber *cuándo* se creó: `ObjectId("...").getTimestamp()`.
- Ejemplo: puedes usar tu propio `_id`, como `_id: "cita-2026-10-21-ana"`, si es único.
