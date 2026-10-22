# Arquitectura de reservas

Un agente de voz reservará mesas en la web de reserva que ya tiene cada restaurante, mediante un script de Playwright. En esta primera fase el script llega a **B** y se para: el formulario relleno, sin errores y con el botón de confirmar a la vista. **Nunca pulsa confirmar ni envía una reserva.**

El negocio de la primera fase es Rincón del Amazonas (Puerto de Mogán), en <https://restaurantmogan.com/reservation/>. El plan y sus principios están en [CLAUDE.md](CLAUDE.md).

La arquitectura en una frase: **los agentes juzgan; el código calcula, ejecuta y guarda.**
- **Catálogo:** un único catálogo de campos ([catalogo/](catalogo/)) define cada dato. De él salen los validadores de MongoDB, las tablas de las plantillas, la documentación y la web.
- **Agentes:** siguen una plantilla ([plantillas/](plantillas/)) y entregan un `.md`.
- **Gestor:** valida ese `.md` contra el catálogo y lo guarda en MongoDB, registrando cada trabajo en `corridas`.
- **Ejecutor:** corre el script aprobado hasta B.

## Consultar sin instalar nada

[index.html](index.html) es una página de solo lectura. Tiene seis pestañas:
- **Skills:** las plantillas;
- **Campos ancla:** el catálogo, con la ruta de cada campo en MongoDB;
- **Base de datos:** colecciones, validadores y diagrama;
- **Agentes:** qué skill escribe y lee cada campo;
- **Fundamentos:** los principios;
- **Documentación:** la práctica de MongoDB.

GitHub Pages la publica desde la raíz de `main` en <https://frescofresco.github.io/arquitectura-reservas/>. También se puede abrir el fichero directamente en el navegador. Se regenera con `npm run web`.

## Repetir la demo

### Lo que necesitas

| Qué | Cómo comprobarlo |
|---|---|
| Node.js 24.2 o superior | `node --version` |
| Acceso a la base compartida `Prueba_software` (Atlas), o un MongoDB local | La URI te la da quien administra el proyecto en Atlas |
| Microsoft Edge o Google Chrome | Si no tienes ninguno, usa el Chromium de Playwright (paso 2) |

### Pasos

Todos los comandos se lanzan desde la raíz del repositorio.

**1. Clonar e instalar**

```bash
git clone https://github.com/FrescoFresco/arquitectura-reservas.git
cd arquitectura-reservas
npm install
```

**2. Configurar.** Copia `.env.example` como `.env` y rellena la URI:
- Mac o Linux: `cp .env.example .env`
- Windows PowerShell: `Copy-Item .env.example .env`

```
MONGODB_URI=mongodb+srv://…            # la de Atlas, o mongodb://127.0.0.1:27017 en local
MONGODB_DB=Prueba_software
NAVEGADOR=msedge                       # msedge, chrome o chromium
```

Con `NAVEGADOR=chromium`, descarga antes el navegador: `npx playwright install chromium`. El `.env` nunca se sube a git.

**3. Comprobar que todo funciona**

```bash
npm test
```

**4. Preparar la base (solo si está vacía, por ejemplo en local).** En `Prueba_software` ya está hecho.

```bash
npm run generar
npm run semilla
npm run cargar-demo
```

- `generar` crea las cinco colecciones con sus validadores. También regenera las tablas de las plantillas, `docs/catalogo.md` y `docs/esquema.md`.
- `semilla` da de alta los negocios y el proceso de Rincón del Amazonas, a través del gestor.
- `cargar-demo` pasa por el gestor las respuestas del agente guardadas en [demo/](demo/): el recorrido y el script. Imprime el id de la versión, normalmente `ver-rincon-del-amazonas-1`.

**5. Probar la versión hasta B**

```bash
npm run ejecutar -- --version ver-rincon-del-amazonas-1
```

Se abre el navegador, rellena el formulario con datos de prueba (fecha dentro de 3 días, 20:00, 2 personas) y se para en B. Termina con `"estado":"disponible"` y guarda la ejecución en `ejecuciones`.

**6. Aprobarla.** Lo hace una persona; si ya está aprobada, salta al paso 7.

```bash
npm run gestor -- aprobar ver-rincon-del-amazonas-1 --por "Tu nombre"
```

Solo aprueba si hay una ejecución que llegó a B después del último cambio de la versión.

**7. La demo**

```bash
npm run demo
```

Primero muestra el recorrido guardado:
- los pasos;
- los campos, con su clase, si son obligatorios y la evidencia;
- los obstáculos;
- el botón de confirmar;
- la función.

Después ejecuta la versión aprobada hasta B con el navegador visible y se queda ahí hasta que pulses Enter.

### Si algo falla

| Síntoma | Qué hacer |
|---|---|
| `Faltan MONGODB_URI y MONGODB_DB` | No existe `.env`: haz el paso 2 |
| `connect ECONNREFUSED` o `querySrv` | Revisa la URI. En Atlas, comprueba que tu IP está en *Network Access* |
| `Chromium distribution 'msedge' is not found` | Pon `NAVEGADOR=chrome`, o `NAVEGADOR=chromium` y `npx playwright install chromium` |
| `Ningún proceso tiene una versión aprobada` | Haz los pasos 5 y 6 |
| `"estado":"sin_hueco"` | No es un error: ese día no había mesa a esa hora |
| `"estado":"error"`, `"motivo":"fallo_recorrido"` | La web cambió o tardó demasiado. La traza está en `ejecuciones` |

## Entrar a la base

La base compartida es **`Prueba_software`**, con cinco colecciones: `negocios`, `procesos`, `versiones`, `ejecuciones` y `corridas`.

- **En la web.** En Atlas (<https://cloud.mongodb.com>), abre **Data Explorer** y elige `Prueba_software`.
- **En la consola.** Usa `mongosh` con la cadena de conexión de Atlas (**Connect → Shell**) y después `use Prueba_software`.
- **Para practicar.** [docs/aprender-mongo.md](docs/aprender-mongo.md) tiene seis ejercicios en las dos versiones: insertar, buscar, actualizar, ver el validador, crear un índice y una agregación.

Los datos reales solo se escriben a través del gestor. Los ejercicios trabajan sobre un negocio de práctica que se borra al final.

## Qué hay en cada carpeta

```
CLAUDE.md           plan y principios del proyecto
catalogo/           catálogo de campos ancla: un JSON por colección
plantillas/         skills de los agentes: mapear-recorrido y generar-script
demo/               respuestas del agente usadas en la demo (Rincón del Amazonas)
docs/
  catalogo.md       el catálogo en una tabla (generado)
  esquema.md        diagrama de colecciones y relaciones (generado con npm run esquema)
  aprender-mongo.md práctica de MongoDB
src/
  catalogo.js       carga y comprueba el catálogo; reglas de cada tipo
  generador.js      validadores, tablas de plantillas, docs/catalogo.md y docs/esquema.md
  gestor.js         preparar | leer | guardar | propuestas | aprobar
  ejecutor.js       corre un script hasta B, con un seguro que bloquea el envío
  semilla.js        datos iniciales metidos a mano (pasan por el gestor)
  cargar-demo.js    carga demo/ a través del gestor
  demo.js           npm run demo
  web.js            genera index.html
  db.js             conexión a MongoDB
test/               pruebas (npm test)
index.html          web de consulta (generada con npm run web)
```

### Órdenes

| Orden | Qué hace |
|---|---|
| `npm run generar` | Validadores en MongoDB, tablas de plantillas, `docs/catalogo.md` y `docs/esquema.md` |
| `npm run esquema` | Solo `docs/esquema.md` (no necesita base) |
| `npm run web` | `index.html` (no necesita base) |
| `npm run semilla` | Datos iniciales a mano, por el gestor |
| `npm run cargar-demo` | Recorrido y script de la demo, por el gestor |
| `npm run gestor -- preparar <plantilla> --proceso proc-… \| --version ver-…` | Prepara la Entrada de una plantilla en `trabajo/` |
| `npm run gestor -- leer trabajo/<base>` | Muestra qué entiende el gestor de una respuesta |
| `npm run gestor -- guardar trabajo/<base>` | Valida, guarda y registra la corrida |
| `npm run propuestas` | Propuestas de campos pendientes, agrupadas |
| `npm run gestor -- aprobar ver-… --por "Nombre"` | Aprueba una versión probada hasta B |
| `npm run ejecutar -- --version ver-…` | Prueba una versión hasta B |
| `npm run demo` | Muestra el recorrido y ejecuta la versión aprobada hasta B |
| `npm test` | Pruebas |
