# Arquitectura de reservas

Documento interactivo (HTML) de la arquitectura del sistema de reservas. Cualquier persona con acceso de escritura al repositorio puede clonarlo, editar `index.html` y publicar los cambios con un push a `main`.

## Sitio publicado

- **GitHub Pages:** https://frescofresco.github.io/arquitectura-reservas/
- **Repositorio:** https://github.com/FrescoFresco/arquitectura-reservas

El sitio se sirve desde la rama `main`, carpeta raíz (`/`). Tras un push a `main`, Pages se actualiza solo (suele tardar uno o dos minutos).

El menú principal tiene tres destinos: **Mapa**, **Catálogos** y **Documentación**. En pantalla estrecha esa barra queda fija abajo. Dentro de Catálogos hay dos pestañas: **Bloques** (el id interno y la carpeta siguen siendo `microoperaciones`) y **tabla-activación**. Dentro de Documentación hay una pestaña, **API**.

El índice de Bloques está en [`catalogo/microoperaciones/index.json`](./catalogo/microoperaciones/index.json). Si `instrucciones` está vacío, el catálogo se muestra vacío. Cada bloque lleva `id`, `nombre` y `versiones`. Cada versión lleva `numero`, `fecha` (ISO `YYYY-MM-DD`), `ruta` relativa a la raíz del sitio y, si hace falta, `nombreArchivo`. Vale cualquier tipo de archivo: la página pinta markdown y el resto se descarga.

El mapa también está versionado en [`mapa/index.json`](./mapa/index.json). La versión 1 es el diagrama actual, [`mapa/v1.mmd`](./mapa/v1.mmd). El lápiz abre ese fuente. Cancelar no cambia nada. Guardar crea la versión siguiente en ese navegador y el mapa pasa a mostrarla.

tabla-activación tiene dos tablas, cada una con su versión: [`reglas`](./catalogo/tabla-activacion/reglas/index.json) y [`pasos`](./catalogo/tabla-activacion/pasos/index.json). Añadir columna y Añadir valor solo cambian la tabla abierta, en ese navegador.

Para publicar un bloque, una versión del mapa o una de esas tablas, un agente usa la API de contenidos de GitHub (el token no está en la página). El contrato está en Documentación → API. El cliente de referencia es [`scripts/subir.js`](./scripts/subir.js):

```bash
GITHUB_TOKEN=… node scripts/subir.js bloques --nueva --nombre "Abrir ficha" --archivo ./nota.md
GITHUB_TOKEN=… node scripts/subir.js bloques --id abrir-ficha --archivo ./nota.pdf
GITHUB_TOKEN=… node scripts/subir.js mapa --archivo ./flujo.mmd
GITHUB_TOKEN=… node scripts/subir.js tabla-activacion --tabla reglas --archivo ./reglas.json
GITHUB_TOKEN=… node scripts/subir.js tabla-activacion --tabla pasos --archivo ./pasos.json
```

`--ensayo` no llama a GitHub. En el navegador, **Subir instrucción nueva** y **Subir versión** siguen guardándose solo en ese navegador.

Ejemplo de bloque en el índice:

```json
{
  "id": "id-estable",
  "nombre": "Nombre visible",
  "versiones": [
    { "numero": 1, "fecha": "2026-10-19", "ruta": "catalogo/microoperaciones/id-estable/v1.md" }
  ]
}
```

**Subir instrucción nueva** crea otro bloque. **Subir versión** añade una versión a ese bloque. Las dos guardan el archivo en el `localStorage` de ese navegador, encima del índice. No hacen commit ni actualizan GitHub.

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
