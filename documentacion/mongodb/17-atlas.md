# Atlas, drivers y cadena de conexión

Verificado contra la documentación oficial el 21 oct 2026. Ejemplos con el archivador de la peluquería **Pelo Sur** (`pelo_sur`).

### MongoDB Atlas

Fuente: https://www.mongodb.com/docs/atlas/

Atlas es MongoDB **como servicio en la nube**: en vez de tener tú los servidores, Atlas los ejecuta en **AWS, Azure o Google Cloud** y se ocupa del trabajo operativo: **aprovisionar, parchear, copias de seguridad, monitorizar y escalar**. Se trabaja con los datos con la misma API de consultas, así que el código, los drivers y las herramientas funcionan igual que con una instalación propia. Atlas ofrece dos ediciones, **Atlas Core** y **Atlas Infinite**, que se diferencian en cómo gestionan cómputo y almacenamiento.

Ejemplo Pelo Sur: el archivador `pelo_sur` puede vivir en un cluster de Atlas y la web de reservas se conecta a él por Internet.

### Drivers: cómo habla tu programa con MongoDB

Fuente: https://www.mongodb.com/docs/drivers/

Un driver es la **librería oficial** para cada lenguaje (Node.js, Python, Java, C#…). MongoDB mantiene las oficiales (nuevas funciones, rendimiento, parches de seguridad); hay otras de la comunidad que MongoDB no soporta.

### Cadena de conexión

Fuente: https://www.mongodb.com/docs/manual/reference/connection-string/

Es la "dirección" del archivador. Hay dos formatos:
- Estándar: `mongodb://servidor1:27017,servidor2:27017/?replicaSet=miReplica`
- **SRV**: `mongodb+srv://...`, que incluye automáticamente todos los servidores del cluster y permite rotarlos sin tocar la aplicación. **La documentación recomienda SRV cuando sea posible.**

Ejemplo (Node.js), sin poner la contraseña en el código:
```js
const { MongoClient } = require("mongodb")
const client = new MongoClient(process.env.MONGODB_URI) // p. ej. mongodb+srv://recepcion:<contraseña>@<cluster>/
const citas = client.db("pelo_sur").collection("citas")
```

### Búsqueda de texto completo (Atlas Search, ahora "MongoDB Search")

Fuente: https://www.mongodb.com/docs/atlas/atlas-search/

Es una **búsqueda de texto completo integrada** en el cluster: no hace falta montar un buscador aparte. Ofrece varios analizadores de texto, un lenguaje de consulta rico y puntuación por relevancia. Es distinta del índice `text` clásico (subpestaña *Índices*).

Ejemplo Pelo Sur: buscar "mechas rubias" en las notas de las citas y obtener primero las más relevantes.

### Conectar Campos ancla (Worker API)

Usa **[Ajustes → Conexiones](#ajustes/conexiones)** en el panel: pega la URI ahí (campo tipo contraseña). Queda cifrada en D1; **nunca se reexpone** en GET. Esta pestaña de Documentación es solo lectura.

El Worker `campos-ancla-api` usa el driver oficial **`mongodb`** (TCP en Cloudflare Workers; ver [docs CF](https://developers.cloudflare.com/workers/databases/third-party-integrations/mongodb/)).

1. Crea un cluster en Atlas y copia la cadena SRV (`mongodb+srv://…`).
2. En el panel: **Ajustes → Conexiones** → pega URI (+ base opcional) → **Guardar** / **Probar**. Alternativa ops: secret `MONGODB_URI` (`wrangler secret put`) como fallback si no hay URI en el panel.
3. Comprueba: `GET /health` → `mongo: "configured"`; `GET /v1/mongo/status` → `{ configured, connected, db, source, hint? }` (sin URI).
4. Sincroniza un negocio (invite Bearer): `POST /v1/mongo/sync/negocio` con `{ "negocio_id": "pelo-sur" }`.

Detalle: `CLOUDFLARE.md` (sección MongoDB) y el doc del proyecto en el store.
