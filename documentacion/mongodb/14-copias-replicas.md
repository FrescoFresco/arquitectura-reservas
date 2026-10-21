# Réplicas y copias de seguridad

Verificado contra la documentación oficial el 21 oct 2026. Ejemplos con el archivador de la peluquería **Pelo Sur** (`pelo_sur`).

### Replica set: varias copias vivas del archivador

Fuentes: https://www.mongodb.com/docs/manual/replication/ , https://www.mongodb.com/docs/manual/reference/limits/ , https://www.mongodb.com/docs/manual/core/replica-set-elections/

Un **replica set** es un grupo de servidores que guardan **el mismo archivador**. Uno, y solo uno, es el **primario** (recibe las escrituras); los demás son **secundarios** y copian sus cambios. Puede haber opcionalmente un **árbitro**, que vota pero no guarda datos.

- Hasta **50 miembros**, de los que como mucho **7 votan**.
- Si el primario deja de responder más tiempo que `electionTimeoutMillis` (**10 segundos** por defecto), los demás **eligen** un nuevo primario.
- Cada servidor pertenece a un solo replica set.

Ejemplo Pelo Sur: tres servidores con `pelo_sur`; si el primario se cae, la agenda sigue funcionando con el nuevo primario.

### Write concern: "¿cuántos tienen que confirmar que lo han guardado?"

Fuente: https://www.mongodb.com/docs/manual/reference/write-concern/

`w: 1` = basta el primario; `w: "majority"` = la mayoría de miembros. **El valor global por defecto es `majority`.**
```js
db.citas.insertOne({ cliente_id: ObjectId("671650a1c2f4e9b1a3d0e002"), cuando: ISODate("2026-10-22T09:00:00Z"), estado: "pendiente" }, { writeConcern: { w: "majority" } })
```

### Read concern: "¿qué garantía quiero sobre lo que leo?"

Fuente: https://www.mongodb.com/docs/manual/reference/read-concern/

Niveles: `"local"` (lo que tiene ese servidor; puede deshacerse en un rollback), `"available"`, `"majority"` (solo lo confirmado por la mayoría), `"linearizable"` y `"snapshot"`.

### Read preference: "¿a qué copia le pregunto?"

Fuente: https://www.mongodb.com/docs/manual/core/read-preference/

Modos: `primary` (por defecto), `primaryPreferred` (el primario y, si no está, un secundario), `secondary`, `secondaryPreferred`, `nearest`. Las transacciones con lecturas deben usar `primary`.

### Copias de seguridad

Fuente: https://www.mongodb.com/docs/manual/core/backups/

Una réplica **no es una copia de seguridad**: si borras una ficha por error, el borrado se copia a todos. Métodos oficiales:
- **Atlas**: copias gestionadas del cluster.
- **MongoDB Cloud Manager / Ops Manager**: herramientas con interfaz gráfica.
- **Copiar los archivos de datos** (instantáneas del sistema de archivos): incluyen los índices, por eso ocupan más.
- **`mongodump` / `mongorestore`**: copias más pequeñas.
```bash
mongodump --db=pelo_sur --out=/copias/2026-10-21
mongorestore /copias/2026-10-21
```
