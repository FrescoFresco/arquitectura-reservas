# Arquitectura de reservas

Documento interactivo (HTML) de la arquitectura del sistema de reservas. Cualquier persona con acceso de escritura al repositorio puede clonarlo, editar `index.html` y publicar los cambios con un push a `main`.

## Sitio publicado

- **GitHub Pages:** https://frescofresco.github.io/arquitectura-reservas/
- **Repositorio:** https://github.com/FrescoFresco/arquitectura-reservas

El sitio se sirve desde la rama `main`, carpeta raíz (`/`). Tras un push a `main`, Pages se actualiza solo (suele tardar uno o dos minutos).

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

## Seed MongoDB

El archivo [`seed-arquitectura-reservas.js`](./seed-arquitectura-reservas.js) crea de una vez la base `arquitectura_reservas`, las 10 colecciones y los documentos de ejemplo de la sección MongoDB.

```bash
mongosh "mongodb://localhost:27017" seed-arquitectura-reservas.js
```

También está el botón **Descargar seed mongosh** en la sección MongoDB del sitio.

## Visibilidad

Este repositorio es **público**: cualquiera puede ver el código y el sitio en Pages. Solo quienes sean colaboradores (o tengan permisos en la org/cuenta) pueden hacer push.

Si en el futuro quisieras hacerlo privado: **Settings → General → Danger Zone → Change repository visibility**. En privado, Pages sigue siendo usable para quien tenga acceso al repo; para editar hace falta invitación de colaborador (o permisos equivalentes).
