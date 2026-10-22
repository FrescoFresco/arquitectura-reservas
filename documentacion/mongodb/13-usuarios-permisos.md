# Usuarios y permisos

Verificado contra la documentación oficial el 21 oct 2026. Ejemplos con el archivador de la peluquería **Pelo Sur** (`pelo_sur`).

### Autenticación: demostrar quién eres

Fuente: https://www.mongodb.com/docs/manual/core/authentication/

Es la **llave** del archivador. Mecanismos según la edición:

| Mecanismo | Community | Enterprise | Atlas (M10+) |
|---|---|---|---|
| SCRAM (usuario + contraseña) | ✓ | ✓ | ✓ |
| X.509 (certificados) | ✓ | ✓ | ✓ |
| Kerberos | | ✓ | |
| LDAP | | ✓ | ✓ |
| OIDC | | ✓ | ✓ |
| AWS-IAM | | | ✓ |

**SCRAM es el mecanismo por defecto.**

### Ojo: el control de acceso no viene activado

Fuente: https://www.mongodb.com/docs/manual/core/authorization/

En una instalación propia, MongoDB **no activa el control de acceso por defecto**. Se activa con la opción `--auth` o el ajuste `security.authorization`.

### Autorización: qué puedes hacer (RBAC)

Fuentes: https://www.mongodb.com/docs/manual/core/authorization/ y https://www.mongodb.com/docs/manual/reference/built-in-roles/

MongoDB usa **control de acceso basado en roles (RBAC)**: cada usuario recibe uno o varios **roles**, y fuera de esos roles **no tiene acceso a nada**. Un rol es como un juego de llaves: "puede leer el cajón", "puede escribir", "puede crear usuarios".

Roles incorporados principales:

| Rol | Para qué |
|---|---|
| `read` | leer los cajones (no de sistema) de un archivador |
| `readWrite` | leer y escribir |
| `dbAdmin` | tareas de administración del archivador (índices, estadísticas) |
| `userAdmin` | crear y modificar usuarios y roles de ese archivador |
| `dbOwner` | todo lo anterior junto en ese archivador |
| `readAnyDatabase`, `readWriteAnyDatabase`, `userAdminAnyDatabase`, `dbAdminAnyDatabase` | lo mismo para todos los archivadores (se crean en `admin`) |
| `clusterAdmin`, `clusterManager`, `clusterMonitor`, `hostManager` | administrar el cluster |
| `backup`, `restore` | copias de seguridad |
| `root` | superusuario |

Aviso oficial: `userAdmin` o `dbOwner` sobre el archivador `admin` permiten a quien los tiene darse **a sí mismo cualquier permiso**, así que equivalen a superusuario.

Ejemplo Pelo Sur: la recepcionista solo necesita leer y apuntar citas.
```js
use pelo_sur
db.createUser({ user: "recepcion", pwd: passwordPrompt(), roles: [ { role: "readWrite", db: "pelo_sur" } ] })
```
