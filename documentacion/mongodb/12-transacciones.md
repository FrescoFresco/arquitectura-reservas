# Transacciones: todo o nada

Verificado contra la documentación oficial el 21 oct 2026. Ejemplos con el archivador de la peluquería **Pelo Sur** (`pelo_sur`).

Fuentes: https://www.mongodb.com/docs/manual/core/transactions/ y https://www.mongodb.com/docs/manual/core/transactions-production-consideration/

### Una ficha ya es "todo o nada"

En MongoDB, **una operación sobre una sola ficha es atómica**: o se aplica entera o no se aplica. Como puedes guardar listas y fichas anidadas dentro de una ficha, muchas veces no hace falta nada más.

Ejemplo Pelo Sur: `updateOne` que cambia a la vez `estado` y `servicios` de una cita nunca deja la cita a medias.

### Transacciones de varias fichas

Cuando un cambio afecta a varias fichas o cajones y tiene que salir todo o nada, MongoDB ofrece **transacciones ACID** (atomicidad, consistencia, aislamiento y durabilidad). Pueden abarcar varias operaciones, cajones, archivadores, fichas y shards. Se usan en **replica sets** y **clusters con sharding** (los ejemplos oficiales se conectan a uno de ellos).

Ejemplo Pelo Sur: cancelar una cita **y** devolver el bono a la clienta.
```js
const session = db.getMongo().startSession()
session.startTransaction()
try {
  const s = session.getDatabase("pelo_sur")
  s.citas.updateOne({ _id: ObjectId("671650a1c2f4e9b1a3d0e001") }, { $set: { estado: "cancelada" } })
  s.clientes.updateOne({ nombre: "Ana" }, { $inc: { bonos: 1 } })
  session.commitTransaction()     // se guardan las dos cosas
} catch (e) {
  session.abortTransaction()      // no se guarda ninguna
} finally { session.endSession() }
```

### Cosas a saber

- Por defecto una transacción debe durar **menos de un minuto**; se cambia con el parámetro `transactionLifetimeLimitSeconds`.
- Las lecturas dentro de una transacción deben usar read preference `primary` (fuente: https://www.mongodb.com/docs/manual/core/read-preference/).
- Regla práctica de la documentación: si puedes diseñar para que el cambio quepa en una sola ficha, no necesitas transacción.
