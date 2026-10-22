# Change streams: avisar cuando algo cambia

Verificado contra la documentación oficial el 21 oct 2026. Ejemplos con el archivador de la peluquería **Pelo Sur** (`pelo_sur`).

Fuentes: https://www.mongodb.com/docs/manual/changeStreams/ , https://www.mongodb.com/docs/manual/reference/method/db.collection.watch/ , https://www.mongodb.com/docs/manual/reference/change-events/

### La idea

Un change stream es como pedirle al archivador: **"avísame cada vez que cambie una ficha de este cajón"**. La aplicación abre un cursor con `watch()` y recibe un evento por cada cambio, en tiempo real, sin tener que preguntar una y otra vez.

- Solo funcionan en **replica sets** y **clusters con sharding** (no en un servidor suelto), con el motor de almacenamiento **WiredTiger**.
- El cursor sigue abierto mientras haya conexión y exista el cajón.

### Tipos de evento más comunes

| `operationType` | Cuándo |
|---|---|
| `insert` | se añaden fichas |
| `update` | se modifica una ficha |
| `replace` | se sustituye una ficha entera |
| `delete` | se borra una ficha |
| `drop`, `rename` | se borra o renombra el cajón |
| `invalidate` | el stream deja de ser válido |

### Ejemplo Pelo Sur: avisar a recepción de cada cita nueva o cancelada

```js
const cursor = db.citas.watch([
  { $match: { $or: [ { operationType: "insert" }, { "updateDescription.updatedFields.estado": "cancelada" } ] } }
], { fullDocument: "updateLookup" })
while (cursor.hasNext()) { printjson(cursor.next()) }
```
- Puedes filtrar con una pipeline de agregación (`$match`, `$addFields`…), pero **no debes modificar ni quitar el `_id` del evento**.
- Ese `_id` es el **resume token**: guárdalo y podrás reanudar desde ahí tras un corte.
- `fullDocument: "updateLookup"` añade a los eventos de `update` la versión más reciente confirmada por mayoría de la ficha completa.
