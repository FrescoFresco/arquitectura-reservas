# Aprender MongoDB con nuestros datos

Seis ejercicios para empezar con MongoDB sobre la base compartida **`Prueba_software`**, con los datos de Rincón del Amazonas. Cada ejercicio se puede hacer de dos maneras: en la web de Atlas (Data Explorer) y en la consola `mongosh`. Haz la que prefieras, o las dos.

## Antes de empezar

### Qué hay en la base

`Prueba_software` tiene cinco colecciones. Una colección es como una tabla y cada documento, como una fila con forma de JSON.

| Colección | Qué guarda | Ejemplo de `_id` |
|---|---|---|
| `negocios` | Los restaurantes | `neg-rincon-del-amazonas` |
| `procesos` | Dónde empieza la reserva de cada negocio (punto A) | `proc-rincon-del-amazonas` |
| `versiones` | El recorrido de A a B, el script y la función | `ver-rincon-del-amazonas-1` |
| `ejecuciones` | Cada vez que el script corrió hasta B | `ejec-…` |
| `corridas` | Cada trabajo de un agente, entero | `corr-…` |

Cada colección tiene un **validador**: unas reglas que MongoDB comprueba antes de guardar. Las genera `npm run generar` a partir de `catalogo/`. El diagrama de las colecciones y sus relaciones está en [esquema.md](esquema.md).

### Una regla importante

En este proyecto los datos reales solo se escriben a través del gestor (`npm run gestor`), nunca a mano. Por eso, en estos ejercicios:
- **Solo insertas, cambias y borras tu negocio de práctica**, con el `_id` `neg-practica-<tu-nombre>`. En los ejemplos es `neg-practica-ana`; cámbialo por tu nombre, en minúsculas y sin tildes.
- **Rincón del Amazonas y el resto de datos solo se leen.**
- **El último paso borra tu negocio de práctica.**

### Cómo entrar

**En la web (Atlas)**
1. Entra en <https://cloud.mongodb.com> y abre el proyecto.
2. En el menú, abre **Data Explorer**. En algunas cuentas se llama **Browse Collections**, dentro de *Database* o *Clusters*.
3. Elige la base **`Prueba_software`** y la colección del ejercicio.

**En la consola (`mongosh`)**
1. Instálalo: <https://www.mongodb.com/try/download/shell>.
2. En Atlas, en el clúster, ve a **Connect → Shell**, copia la cadena de conexión y ejecútala en tu terminal. Te pedirá la contraseña de tu usuario de base de datos.
3. Ya dentro, elige la base:

```js
use Prueba_software
```

Deberías ver `switched to db Prueba_software`. Nunca pegues la cadena de conexión con la contraseña en un chat ni en el repositorio.

---

## 1. Insertar un negocio

**Objetivo.** Crear tu negocio de práctica con los datos de Rincón del Amazonas.

**En Atlas**
1. Abre la colección `negocios`.
2. Pulsa **Insert Document** (o **Add Data → Insert document**).
3. Cambia a la vista de JSON (`{}`), pega esto y pulsa **Insert**:

```json
{
  "_id": "neg-practica-ana",
  "nombre": "Práctica de Ana",
  "url": "https://restaurantmogan.com/",
  "zona_horaria": "Atlantic/Canary",
  "telefono": "+34928565098"
}
```

**En mongosh**

```js
db.negocios.insertOne({
  _id: "neg-practica-ana",
  nombre: "Práctica de Ana",
  url: "https://restaurantmogan.com/",
  zona_horaria: "Atlantic/Canary",
  telefono: "+34928565098"
})
```

**Qué deberías ver**

```js
{ acknowledged: true, insertedId: 'neg-practica-ana' }
```

En Atlas, el documento aparece en la lista de `negocios`. Si te sale `E11000 duplicate key error`, ese `_id` ya existe: alguien lo creó antes (o tú). Usa otro nombre.

## 2. Buscarlo

**Objetivo.** Encontrar un documento por su `_id` y después filtrar por otro campo y elegir qué campos ver.

**En Atlas**
1. En `negocios`, escribe en la barra **Filter** `{ "_id": "neg-practica-ana" }` y pulsa **Find** (o **Apply**). Sale solo tu negocio.
2. Cambia el filtro a `{ "zona_horaria": "Atlantic/Canary" }`.
3. En **Options → Project** escribe `{ "nombre": 1, "telefono": 1 }` y pulsa **Find**.

**En mongosh**

```js
db.negocios.find({ _id: "neg-practica-ana" })
db.negocios.find({ zona_horaria: "Atlantic/Canary" }, { nombre: 1, telefono: 1 })
```

**Qué deberías ver.** La primera consulta devuelve tu documento completo:

```js
[
  {
    _id: 'neg-practica-ana',
    nombre: 'Práctica de Ana',
    url: 'https://restaurantmogan.com/',
    zona_horaria: 'Atlantic/Canary',
    telefono: '+34928565098'
  }
]
```

La segunda devuelve todos los negocios de Canarias, solo con `nombre` y `telefono` (el `_id` sale siempre):

```js
[
  { _id: 'neg-templo-de-pandora', nombre: 'Templo de Pandora', telefono: '+34614201643' },
  { _id: 'neg-rincon-del-amazonas', nombre: 'Rincón del Amazonas', telefono: '+34928565098' },
  { _id: 'neg-practica-ana', nombre: 'Práctica de Ana', telefono: '+34928565098' }
]
```

Si otras personas están haciendo los ejercicios a la vez, verás también sus negocios de práctica.

## 3. Actualizarlo

**Objetivo.** Cambiar un campo de tu negocio sin tocar el resto.

**En Atlas**
1. Filtra por `{ "_id": "neg-practica-ana" }`.
2. Pasa el ratón por el documento y pulsa el lápiz (**Edit document**).
3. Cambia `nombre` a `Práctica de Ana (cambiado)` y pulsa **Update**.

**En mongosh**

```js
db.negocios.updateOne(
  { _id: "neg-practica-ana" },
  { $set: { nombre: "Práctica de Ana (cambiado)" } }
)
db.negocios.findOne({ _id: "neg-practica-ana" }, { nombre: 1 })
```

**Qué deberías ver**

```js
{
  acknowledged: true,
  insertedId: null,
  matchedCount: 1,
  modifiedCount: 1,
  upsertedCount: 0
}
{ _id: 'neg-practica-ana', nombre: 'Práctica de Ana (cambiado)' }
```

`matchedCount: 1` significa que encontró el documento, y `modifiedCount: 1`, que lo cambió. `$set` solo toca los campos que le das. Si repites la orden, `modifiedCount` será `0`, porque el valor ya era ese.

## 4. Ver cómo el validador rechaza un documento mal hecho

**Objetivo.** Comprobar que MongoDB no deja guardar un negocio que incumple las reglas del catálogo. Este documento tiene tres errores a propósito:
- `url` no empieza por `http://` ni `https://`;
- `telefono` no está en formato E.164 (`+34…` sin espacios);
- falta `zona_horaria`, que es un campo blindado, es decir, obligatorio.

**En Atlas**
1. En `negocios`, abre la pestaña **Validation** para ver las reglas: verás `required` con `_id`, `nombre`, `url` y `zona_horaria`.
2. Inserta este documento como en el ejercicio 1:

```json
{ "_id": "neg-practica-ana-mal", "nombre": "Mal hecho", "url": "restaurantmogan.com", "telefono": "928 565 098" }
```

**En mongosh**

```js
db.getCollectionInfos({ name: "negocios" })[0].options.validator.$jsonSchema.required
db.negocios.insertOne({
  _id: "neg-practica-ana-mal",
  nombre: "Mal hecho",
  url: "restaurantmogan.com",
  telefono: "928 565 098"
})
```

**Qué deberías ver.** Primero, los campos obligatorios:

```js
[ '_id', 'nombre', 'url', 'zona_horaria' ]
```

Después, el rechazo:

```
MongoServerError: Document failed validation
```

En la consola interactiva (y en Atlas) sale debajo el detalle. Resumido, dice:
- `url`: `regular expression did not match` con el patrón `^https?://`;
- `telefono`: `regular expression did not match` con el patrón `^\+[1-9][0-9]{7,14}$`;
- `required`: `missingProperties: [ 'zona_horaria' ]`.

No se ha guardado nada: `db.negocios.findOne({ _id: "neg-practica-ana-mal" })` devuelve `null`.

## 5. Crear un índice

**Objetivo.** Hacer rápida la consulta «las ejecuciones de una versión, de la más reciente a la más antigua», y comprobar que MongoDB usa el índice.

**En Atlas**
1. Abre la colección `ejecuciones` y la pestaña **Indexes**.
2. Pulsa **Create Index**, escribe estos campos y pulsa **Create Index**:

```json
{ "id_version": 1, "inicio": -1 }
```

3. En la pestaña **Documents**, filtra por `{ "id_version": "ver-rincon-del-amazonas-1" }`, ordena (**Sort**) por `{ "inicio": -1 }` y pulsa **Explain**. El plan muestra un `IXSCAN` sobre `id_version_1_inicio_-1`.

**En mongosh**

```js
db.ejecuciones.createIndex({ id_version: 1, inicio: -1 })
db.ejecuciones.getIndexes()
db.ejecuciones.find({ id_version: "ver-rincon-del-amazonas-1" }).sort({ inicio: -1 }).explain().queryPlanner.winningPlan
```

**Qué deberías ver.** El nombre del índice, la lista de índices y el plan:

```js
id_version_1_inicio_-1

[
  { v: 2, key: { _id: 1 }, name: '_id_' },
  { v: 2, key: { id_version: 1, inicio: -1 }, name: 'id_version_1_inicio_-1' }
]

{
  stage: 'FETCH',
  inputStage: {
    stage: 'IXSCAN',
    keyPattern: { id_version: 1, inicio: -1 },
    indexName: 'id_version_1_inicio_-1',
    …
  }
}
```

`IXSCAN` quiere decir que la consulta recorre el índice. Sin índice verías `COLLSCAN`, que lee toda la colección. Si el índice ya existe porque otra persona hizo el ejercicio, `createIndex` devuelve el mismo nombre y no cambia nada.

## 6. Una agregación que cruza versiones y ejecuciones

**Objetivo.** Para cada versión, contar cuántas veces se ha ejecutado, cuántas llegaron a B y cuándo fue la última. Es lo que comprueba `npm run gestor -- aprobar` antes de aprobar una versión.

Una agregación es una cadena de pasos (*stages*):
- `$lookup` trae, para cada versión, sus documentos de `ejecuciones`, como un `JOIN`;
- `$project` calcula los totales.

**En Atlas**
1. Abre la colección `versiones` y la pestaña **Aggregation**.
2. Cambia a modo texto (`</> Text`) y pega el *pipeline*:

```json
[
  { "$lookup": { "from": "ejecuciones", "localField": "_id", "foreignField": "id_version", "as": "ejecuciones" } },
  { "$project": {
      "estado": 1,
      "ejecuciones": { "$size": "$ejecuciones" },
      "llegaron_a_b": { "$size": { "$filter": { "input": "$ejecuciones", "cond": { "$eq": ["$$this.respuesta.estado", "disponible"] } } } },
      "ultima": { "$max": "$ejecuciones.inicio" }
  } }
]
```

3. Pulsa **Run**.

**En mongosh**

```js
db.versiones.aggregate([
  { $lookup: { from: "ejecuciones", localField: "_id", foreignField: "id_version", as: "ejecuciones" } },
  { $project: {
      estado: 1,
      ejecuciones: { $size: "$ejecuciones" },
      llegaron_a_b: { $size: { $filter: { input: "$ejecuciones", cond: { $eq: ["$$this.respuesta.estado", "disponible"] } } } },
      ultima: { $max: "$ejecuciones.inicio" }
  } }
])
```

**Qué deberías ver.** Un documento por versión, con esta forma:

```js
[
  {
    _id: 'ver-rincon-del-amazonas-1',
    estado: 'borrador',
    ejecuciones: 1,
    llegaron_a_b: 1,
    ultima: ISODate('2026-10-22T08:12:35.222Z')
  }
]
```

Los números y la fecha dependen de cuántas veces se haya ejecutado la demo. `estado` será `aprobada` si alguien ya la aprobó. `llegaron_a_b` cuenta las ejecuciones con `respuesta.estado` igual a `disponible`, es decir, las que llegaron al formulario relleno sin pulsar confirmar.

---

## Para terminar: borra tu negocio de práctica

**En Atlas.** En `negocios`, filtra por `{ "_id": "neg-practica-ana" }`, pasa el ratón por el documento y pulsa la papelera (**Delete document**). Confirma.

**En mongosh**

```js
db.negocios.deleteOne({ _id: "neg-practica-ana" })
```

**Qué deberías ver**

```js
{ acknowledged: true, deletedCount: 1 }
```

El índice del ejercicio 5 se puede quedar: no es un dato y hace más rápida una consulta que el proyecto usa.
