// Carga el recorrido y el script de la demo sin repetir el trabajo del agente: prepara cada plantilla con los datos
// de esta base y le pasa al gestor la respuesta que el agente ya dio (demo/*.respuesta.md). El gestor valida y guarda.
import { copyFileSync } from 'node:fs';
import { conectar } from './db.js';
import { preparar, guardar } from './gestor.js';

const DEMO = new URL('../demo/', import.meta.url);
const PROCESO = 'proc-rincon-del-amazonas';

const { cliente, db } = await conectar();
try {
  if (!(await db.collection('procesos').findOne({ _id: PROCESO }))) throw new Error(`Falta ${PROCESO}: ejecuta antes npm run generar y npm run semilla`);
  let version;
  for (const plantilla of ['mapear-recorrido', 'generar-script']) {
    const base = await preparar(db, plantilla, plantilla === 'mapear-recorrido' ? { proceso: PROCESO } : { version });
    copyFileSync(new URL(`${plantilla}.respuesta.md`, DEMO), `${base}.respuesta.md`);
    const r = await guardar(db, base);
    if (!r.corrida.guardada) throw new Error(`${plantilla}: el gestor no guardó la respuesta:\n- ${r.corrida.errores.join('\n- ')}`);
    version = r.meta.id_version;
    console.log(`  ${plantilla}: guardado en ${version} (corrida ${r.corrida._id})`);
  }
  console.log(`\nSiguiente paso: npm run ejecutar -- --version ${version}`);
} catch (e) {
  console.error(`Error: ${e.message}`);
  process.exitCode = 1;
} finally {
  await cliente.close();
}
