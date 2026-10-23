# Arquitectura de reservas

## API viva (Cloudflare Worker + D1)

La fuente de verdad para agentes es el Worker **`campos-ancla-api`** con D1 **`campos-ancla-db`**: `https://campos-ancla-api.web-legal-es.workers.dev`. Guía: [`CLOUDFLARE.md`](./CLOUDFLARE.md). Contrato: [`documentacion/api.md`](./documentacion/api.md).

```bash
npm install
npm run db:migrate:local && npm run db:seed:local
npm run dev
```

Despliegue: `npx wrangler login` → crear D1 → pegar `database_id` en `wrangler.jsonc` → `npm run db:migrate:remote && npm run db:seed:remote && npm run deploy`.

Los JSON en `catalogo/` son semilla/fallback para la UI estática. **Agentes:** Catálogos → Agentes → **+ Agente** crea una clave `inv_…` en D1 (sin caducidad). Registro y latido van solo a la API Worker. **No hace falta `GITHUB_TOKEN`.**

## Arquitectura nueva: `reservas-v3/`

La primera fase del sistema nuevo está en [`reservas-v3/`](./reservas-v3/): el catálogo de campos ancla, el gestor, las plantillas de agente y el ejecutor que rellena la web del restaurante hasta B, sin confirmar nunca. Para repetir la prueba hasta B con Rincón del Amazonas, sigue [reservas-v3/README.md](./reservas-v3/README.md#repetir-la-prueba). El plan y sus principios están en [reservas-v3/CLAUDE.md](./reservas-v3/CLAUDE.md).

Lo que sigue describe la página publicada en la raíz, que no cambia.

---

Documento interactivo (HTML) de la arquitectura del sistema de reservas. Cualquier persona con acceso de escritura al repositorio puede clonarlo, editar `index.html` y publicar los cambios con un push a `main`.

## Sitio publicado (producción = Cloudflare)

- **Panel UI:** https://campos-ancla.web-legal-es.workers.dev/
- **API Worker:** https://campos-ancla-api.web-legal-es.workers.dev
- **Repositorio (código):** https://github.com/FrescoFresco/arquitectura-reservas

Despliegue UI: `npm run deploy:ui`. Despliegue API: `npm run deploy`. GitHub Pages (`frescofresco.github.io`) queda solo como legado durante el cutover; no es el host de producción.

El menú principal tiene dos destinos: **Catálogos** y **Documentación**. En escritorio es una barra lateral izquierda; en pantalla estrecha queda fija abajo. Dentro de Catálogos hay tres pestañas: **Skills**, **Campos ancla** y **Campos MongoDB**. Dentro de Documentación hay una pestaña, **API**.

El índice de Skills está en [`catalogo/skills/index.json`](./catalogo/skills/index.json). Cada skill lleva `id`, `nombre`, `versiones` y, si hace falta, `descripcion` y `anclas` (nombres completos como `_negocio.nombre_`). Cada versión lleva `numero`, `fecha` (ISO `YYYY-MM-DD`), `ruta` relativa a la raíz del sitio, `hash` (SHA-256 del contenido cuando aplica) y, si hace falta, `nombreArchivo`. Vale cualquier tipo de archivo: la página pinta markdown y el resto se descarga. La cuadrícula de Skills se renderiza con React (CDN). En cada tarjeta: historial, editar (versión nueva al guardar si hubo cambios), subir versión (documento completo) y eliminar; el título abre la skill en popup. Las cápsulas de anclas abren la ficha de Campos ancla.

El índice de Campos ancla está en [`catalogo/campos-ancla/index.json`](./catalogo/campos-ancla/index.json). Cada celda muestra el ancla completo; al pulsarla se abre un popup con pestañas Definición / Mongo / Skills. Campos MongoDB está en [`catalogo/campos-mongodb/index.json`](./catalogo/campos-mongodb/index.json): celdas `colección.clave` y ficha con bsonType y ancla enlazada. Ambos índices incluyen `hash` estable por campo.

El hub del mapa y las tablas de activación se eliminaron del panel; el espejo opcional [`scripts/subir.js`](./scripts/subir.js) solo publica `skills` o `proyectos`.

Los agentes trabajan contra la API Worker (`documentacion/api.md`): invite → registro → latido → CRUD con `Authorization: Bearer inv_…`. No usan GitHub Contents ni token de GitHub.

Opcional (solo espejo estático del repo, no el estado vivo): `scripts/subir.js` con `GITHUB_TOKEN` en el entorno. En el navegador, **+ Añadir skill** / ancla siguen pudiendo guardar overlay local encima del seed.

Ejemplo de skill en el índice:

```json
{
  "id": "mapear-recorrido",
  "nombre": "Mapear recorrido",
  "descripcion": "Recorre la web de reserva desde A hasta B.",
  "anclas": ["_negocio.nombre_", "_proceso.url_inicio_"],
  "versiones": [
    { "numero": 1, "fecha": "2026-10-20", "ruta": "catalogo/skills/mapear-recorrido/v1.md" }
  ]
}
```

**+ Añadir skill** crea otra skill. **Subir versión** añade una versión a esa skill. Las dos guardan el archivo en el `localStorage` de ese navegador, encima del índice. No hacen commit ni actualizan GitHub.

## Cómo editar

1. Clonar el repositorio:

```bash
git clone https://github.com/FrescoFresco/arquitectura-reservas.git
cd arquitectura-reservas
```

2. Abrir y modificar `index.html` (editor local, VS Code, Cursor, etc.). Puedes previsualizarlo abriendo el archivo en el navegador.

3. Guardar, hacer commit y push a `main`:

```bash
git add index.html
git commit -m "Actualiza arquitectura de reservas"
git push origin main
```

4. Publicar el panel en Cloudflare:

```bash
npm run deploy:ui
```

Recarga https://campos-ancla.web-legal-es.workers.dev/ (recarga forzada si hace falta).

## Dar acceso a otra persona

Para que un compañero pueda editar y hacer push (sin hacer el repo privado ni compartir contraseñas):

1. En GitHub: **Settings → Collaborators → Add people → Invite** (elige permiso **Write** / push), o desde la terminal:

```bash
gh repo add-collaborator USUARIO_GITHUB --permission push
```

2. Esa persona acepta la invitación (le llega por email o en https://github.com/FrescoFresco/arquitectura-reservas/invitations).

3. Luego clona, edita `index.html`, hace commit y push como arriba.

No invites a nadie concreto hasta tener su handle de GitHub.

## Importar datos en MongoDB

Los JSON de importación siguen en el repositorio: [`arquitectura-reservas-mongo-import.zip`](./arquitectura-reservas-mongo-import.zip). El sitio publicado no enlaza estas descargas.

Dentro hay un `.json` (array Extended JSON) por colección: `negocios`, `procesos`, `software`, `integraciones`, `observaciones`, `justificantes`, `funciones`, `scripts`, `canales`, `ejecuciones`. Base lógica: `arquitectura_reservas`.

- **Atlas:** Add Data → Import JSON file → eliges la colección
- **Compass:** Import data → eliges el archivo de esa colección

Los mismos JSON sueltos están en [`mongo-import/`](./mongo-import/).

### Avanzado: seed mongosh

[`seed-arquitectura-reservas.js`](./seed-arquitectura-reservas.js) crea la base y hace upsert por `_id` en un comando:

```bash
mongosh "mongodb://localhost:27017" seed-arquitectura-reservas.js
```

## Visibilidad

Este repositorio es **público**: cualquiera puede ver el código y el sitio en Pages. Solo quienes sean colaboradores (o tengan permisos en la org/cuenta) pueden hacer push.

Si en el futuro quisieras hacerlo privado: **Settings → General → Danger Zone → Change repository visibility**. En privado, Pages sigue siendo usable para quien tenga acceso al repo; para editar hace falta invitación de colaborador (o permisos equivalentes).
