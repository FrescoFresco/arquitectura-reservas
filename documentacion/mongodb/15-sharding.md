# Sharding: repartir un archivador enorme en varias máquinas

Verificado contra la documentación oficial el 21 oct 2026. Ejemplos con el archivador de la peluquería **Pelo Sur** (`pelo_sur`).

Fuentes: https://www.mongodb.com/docs/manual/sharding/ y https://www.mongodb.com/docs/manual/core/sharding-shard-key/

### La idea

Cuando un cajón no cabe (o no rinde) en una sola máquina, se **reparte** entre varias. Cada trozo vive en un **shard**.

Piezas de un cluster con sharding:
- **Shards**: guardan cada uno una parte de los datos (cada shard se despliega como replica set).
- **`mongos`**: el **recepcionista**: la aplicación le habla a él y él sabe a qué shard ir.
- **Config servers**: guardan el "mapa" (metadatos y configuración); se despliegan como replica set (CSRS).

### La clave de reparto (shard key)

Es la etiqueta (o etiquetas, con un índice compuesto) que decide en qué shard va cada ficha. MongoDB divide los valores de la clave en **rangos sin solapes** llamados **chunks** e intenta repartirlos por igual entre los shards.

- **Por rangos**: fichas con valores cercanos quedan juntas.
- **Hashed**: se calcula un hash del valor y se reparte por ese hash, lo que esparce mejor los valores consecutivos.

Ejemplo Pelo Sur (si algún día fuera una cadena con millones de citas):
```js
sh.shardCollection("pelo_sur.citas", { cliente_id: "hashed" })
```
Para una sola peluquería no hace falta sharding: un replica set basta de sobra.
