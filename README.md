# Arquitectura de reservas

## Arquitectura nueva: `reservas-v3/`

La primera fase del sistema nuevo está en [`reservas-v3/`](./reservas-v3/): el catálogo de campos ancla, el gestor, las plantillas de agente y el ejecutor que rellena la web del restaurante hasta B, sin confirmar nunca. Para repetir la prueba hasta B con Rincón del Amazonas, sigue [reservas-v3/README.md](./reservas-v3/README.md#repetir-la-prueba). El plan y sus principios están en [reservas-v3/CLAUDE.md](./reservas-v3/CLAUDE.md).

Lo que sigue describe la página publicada en la raíz, que no cambia.

---

Documento interactivo (HTML) de la arquitectura del sistema de reservas. Cualquier persona con acceso de escritura al repositorio puede clonarlo, editar `index.html` y publicar los cambios con un push a `main`.

## Sitio publicado

- **GitHub Pages:** https://frescofresco.github.io/arquitectura-reservas/
- **Repositorio:** https://github.com/FrescoFresco/arquitectura-reservas

El sitio se sirve desde la rama `main`, carpeta raíz (`/`). Tras un push a `main`, Pages se actualiza solo (suele tardar uno o dos minutos).

El menú principal tiene dos destinos: **Catálogos** y **Documentación**. En escritorio es una barra lateral izquierda; en pantalla estrecha queda fija abajo. Dentro de Catálogos hay tres pestañas: **Skills**, **Campos ancla** y **Campos MongoDB**. Dentro de Documentación hay una pestaña, **API**.

El índice de Skills está en [`catalogo/skills/index.json`](./catalogo/skills/index.json). Cada skill lleva `id`, `nombre`, `versiones` y, si hace falta, `descripcion` y `anclas` (nombres completos como `_negocio.nombre_`). Cada versión lleva `numero`, `fecha` (ISO `YYYY-MM-DD`), `ruta` relativa a la raíz del sitio, `hash` (SHA-256 del contenido cuando aplica) y, si hace falta, `nombreArchivo`. Vale cualquier tipo de archivo: la página pinta markdown y el resto se descarga. La cuadrícula de Skills se renderiza con React (CDN). En cada tarjeta: historial, editar (versión nueva al guardar si hubo cambios), subir versión (documento completo) y eliminar; el título abre la skill en popup. Las cápsulas de anclas abren la ficha de Campos ancla.

El índice de Campos ancla está en [`catalogo/campos-ancla/index.json`](./catalogo/campos-ancla/index.json). Cada celda muestra el ancla completo; al pulsarla se abre un popup con pestañas Definición / Mongo / Skills. Campos MongoDB está en [`catalogo/campos-mongodb/index.json`](./catalogo/campos-mongodb/index.json): celdas `colección.clave` y ficha con bsonType y ancla enlazada. Ambos índices incluyen `hash` estable por campo.

Los archivos del mapa pueden seguir en [`mapa/`](./mapa/), pero la página ya no tiene hub ni editor del mapa.

Para publicar una skill o esos catálogos, un agente usa la API de contenidos de GitHub. El token se obtiene con **Generar token**, en Documentación → Conectar un agente. Dura 1 hora y no se guarda en la página. El contrato está en Documentación → API. El cliente de referencia es [`scripts/subir.js`](./scripts/subir.js):

```bash
GITHUB_TOKEN=… node scripts/subir.js skills --nueva --nombre "Mapear recorrido" --archivo ./mapear-recorrido.md
GITHUB_TOKEN=… node scripts/subir.js skills --id mapear-recorrido --archivo ./mapear-recorrido.md
GITHUB_TOKEN=… node scripts/subir.js skills --eliminar --id mapear-recorrido
```

`--ensayo` no llama a GitHub. En el navegador, **+ Añadir skill**, **Editar**, **Subir versión** y **+ Añadir ancla** siguen guardándose solo en ese navegador.

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

4. Esperar a que GitHub Pages reconstruya. Recarga https://frescofresco.github.io/arquitectura-reservas/ (si no ves el cambio, prueba recarga forzada).

No hace falta configurar nada extra: con push a `main`, Pages se actualiza solo.

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
