# reservas-v3: reservas en la web de cada restaurante, hasta B

Primera fase del sistema de reservas. Un script de Playwright recorre la web de reserva de un restaurante y se para en **B**: el formulario relleno, sin errores y con el botón de confirmar a la vista. **Nunca pulsa confirmar ni envía una reserva.**

El plan completo y sus principios están en [CLAUDE.md](CLAUDE.md). El negocio de esta fase es **Rincón del Amazonas** (Puerto de Mogán), en <https://restaurantmogan.com/reservation/>.

## Repetir la prueba

### Lo que necesitas

| Qué | Cómo comprobarlo |
|---|---|
| Node.js 24.2 o superior | `node --version` |
| MongoDB, local o en Atlas | Local: servicio en `127.0.0.1:27017`. Atlas: una URI `mongodb+srv://…` con permiso para crear colecciones |
| Microsoft Edge o Google Chrome | Si no tienes ninguno, usa el Chromium de Playwright (ver paso 2) |

### Pasos

Todos los comandos se lanzan desde la carpeta `reservas-v3/`.

**1. Clonar e instalar**

```bash
git clone https://github.com/FrescoFresco/arquitectura-reservas.git
cd arquitectura-reservas/reservas-v3
npm install
```

**2. Configurar.** Copia `.env.example` como `.env` y ajústalo:
- Mac o Linux: `cp .env.example .env`
- Windows PowerShell: `Copy-Item .env.example .env`

```
MONGODB_URI=mongodb://127.0.0.1:27017   # o tu URI de Atlas
MONGODB_DB=reservas_v3
NAVEGADOR=msedge                        # msedge, chrome o chromium
```

Con `NAVEGADOR=chromium`, descarga antes el navegador: `npx playwright install chromium`. El `.env` nunca se sube a git.

**3. Comprobar que todo funciona**

```bash
npm test
```

Deben pasar las 23 pruebas. Una de ellas abre el navegador sin ventana para probar el seguro que impide confirmar.

**4. Crear las colecciones y meter los datos iniciales**

```bash
npm run generar
npm run semilla
```

- `generar` lee el catálogo y crea las cinco colecciones con sus validadores. También regenera las tablas de las plantillas y `docs/catalogo.md`.
- `semilla` da de alta los dos negocios y el proceso de Rincón del Amazonas, a través del gestor.

**5. Cargar el recorrido y el script**

```bash
npm run cargar-demo
```

No repite el trabajo del agente. Prepara las plantillas `mapear-recorrido` y `generar-script` con los datos de tu base y le pasa al gestor las respuestas que ya dio el agente ([demo/](demo/)). El gestor las valida contra el catálogo, guarda el recorrido y el script en una versión en borrador y registra las dos corridas.

Al terminar te dice el id de la versión, normalmente `ver-rincon-del-amazonas-1`.

**6. Probar el borrador hasta B**

```bash
npm run ejecutar -- --version ver-rincon-del-amazonas-1
```

Se abre el navegador, rellena el formulario con datos de prueba y se para en B: fecha dentro de 3 días, 20:00, 2 personas. Debe terminar con `"estado":"disponible"`. La ejecución queda guardada en la colección `ejecuciones`.

**7. Aprobar la versión.** Esto es revisión humana: lo lanzas tú.

```bash
npm run gestor -- aprobar ver-rincon-del-amazonas-1 --por "Francesco"
```

Solo se aprueba si hay una ejecución que llegó a B después del último cambio de la versión. Guarda quién aprobó y cuándo.

**8. La demo**

```bash
npm run demo
```

Primero muestra el recorrido guardado:
- los pasos;
- los campos, marcando los obligatorios y con su evidencia;
- los obstáculos;
- el botón de confirmar;
- la función con sus parámetros.

Después ejecuta la versión aprobada hasta B con el navegador visible y se queda en B hasta que pulses Enter.

### Si algo falla

| Síntoma | Qué hacer |
|---|---|
| `Faltan MONGODB_URI y MONGODB_DB` | No existe `.env`: haz el paso 2 |
| `connect ECONNREFUSED 127.0.0.1:27017` | MongoDB no está arrancado, o usa la URI de Atlas |
| `browserType.launch: Chromium distribution 'msedge' is not found` | Pon `NAVEGADOR=chrome`, o `NAVEGADOR=chromium` y `npx playwright install chromium` |
| `"estado":"sin_hueco"` | No es un error: ese día no había mesa a esa hora. Si la hora no estaba libre, la respuesta trae las alternativas más cercanas |
| `"estado":"error"`, `"motivo":"fallo_recorrido"` | La web ha cambiado o tardó demasiado. La traza está en `ejecuciones`. Si se repite, hay que volver a lanzar `mapear-recorrido` y `generar-script` |
| Cargaste la demo dos veces | Cada carga crea otra versión en borrador (`-2`, `-3`…): usa el id que imprime `cargar-demo` |

## Cómo está hecho

```
catalogo/     catálogo único de campos ancla (un JSON por colección)
plantillas/   mapear-recorrido.md y generar-script.md; sus tablas las escribe el generador
src/
  catalogo.js   carga y comprueba el catálogo; reglas de cada tipo
  generador.js  catálogo → validadores de MongoDB, tablas de plantillas y docs/catalogo.md
  gestor.js     preparar | leer | guardar | propuestas | aprobar (y alta, para los datos manuales)
  ejecutor.js   corre el script de una versión hasta B, con el seguro que bloquea el envío
  semilla.js    datos iniciales metidos a mano
  cargar-demo.js, demo.js
demo/         respuestas del agente usadas en esta prueba
docs/         catalogo.md, generado
test/         pruebas del gestor, del generador y del ejecutor
trabajo/      entradas y respuestas temporales (no va a git)
```

**Cómo trabaja un agente.**
1. `npm run gestor -- preparar <plantilla> --proceso …` (o `--version …`) crea `trabajo/<base>.entrada.md`.
2. El agente sigue la plantilla y escribe `trabajo/<base>.respuesta.md`, con las secciones «Explicación» y «Salida».
3. `npm run gestor -- leer trabajo/<base>` muestra qué entendió el gestor.
4. `npm run gestor -- guardar trabajo/<base>` lo escribe en MongoDB y registra la corrida.

Ningún agente escribe en la base.

**Datos de la prueba.** Rincón del Amazonas usa un plugin propio de WordPress («Amazonas Booking System»), con fecha, hora y comensales, un plano de mesas y los datos del cliente. No hay CAPTCHA, inicio de sesión ni pago. El formulario final tiene un campo oculto anti-robots que el script deja vacío.
