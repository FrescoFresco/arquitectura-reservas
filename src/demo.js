// npm run demo: muestra el recorrido guardado y ejecuta la versión aprobada hasta B con el navegador visible.
import { conectar } from './db.js';
import { ejecutar } from './ejecutor.js';

const { cliente, db } = await conectar();
try {
  const proceso = await db.collection('procesos').findOne({ id_version_activa: { $type: 'string' } });
  if (!proceso) {
    throw new Error(
      'Ningún proceso tiene una versión aprobada.\n' +
        '  1. Prueba el borrador:  npm run ejecutar -- --version ver-…\n' +
        '  2. Apruébalo:           npm run gestor -- aprobar ver-… --por "Tu nombre"',
    );
  }
  const negocio = await db.collection('negocios').findOne({ _id: proceso.id_negocio });
  const version = await db.collection('versiones').findOne({ _id: proceso.id_version_activa });
  const r = version.recorrido;
  const fecha = (d) => d.toLocaleString('es-ES', { timeZone: negocio.zona_horaria });

  console.log(`\n══ ${negocio.nombre} · ${negocio.url} · ${negocio.zona_horaria} · ${negocio.telefono ?? ''}`);
  console.log(`   Proceso ${proceso._id} · alcance ${proceso.alcance}`);
  console.log(`   A: ${proceso.url_inicio}`);
  console.log(`   Versión ${version._id} · ${version.estado} por ${version.aprobacion.por} el ${fecha(version.aprobacion.fecha)}`);
  console.log(`   Sistema de reservas: ${r.sistema?.nombre ?? '?'}`);

  console.log('\n── Recorrido de A a B');
  r.pasos.forEach((p, i) => console.log(`   ${String(i + 1).padStart(2)}. ${p.accion}${p.selector ? `   → ${p.selector}` : ''}`));

  console.log('\n── Campos (✱ obligatorio)');
  for (const c of r.campos) console.log(`   ${c.obligatorio ? '✱' : ' '} ${c.nombre} (${c.control ?? '?'}) — ${c.evidencia ?? ''}`);

  console.log('\n── Obstáculos');
  if (!r.obstaculos?.length) console.log('   ninguno');
  for (const o of r.obstaculos ?? []) console.log(`   ${o.tipo}: ${o.descripcion}`);

  console.log(`\n── B: botón «${r.boton_confirmar.texto}» (${r.boton_confirmar.selector}) — NUNCA se pulsa en esta fase`);
  console.log(`── Mensaje de sin hueco: ${r.mensaje_sin_hueco ?? '(no visto al mapear)'}`);
  const p = version.funcion.parametros;
  console.log(`── Función ${version.funcion.nombre}(${Object.keys(p.properties).map((k) => (p.required?.includes(k) ? k : `${k}?`)).join(', ')})`);

  console.log('\n══ Ejecución hasta B con el navegador visible\n');
  const e = await ejecutar(db, version._id, { soloAprobada: true, pausa: true });
  console.log(`\n══ Respuesta de la función: ${JSON.stringify(e.respuesta)}`);
  console.log(`   Traza guardada en ejecuciones: ${e._id}\n`);
  process.exitCode = e.respuesta.estado === 'disponible' ? 0 : 1;
} catch (e) {
  console.error(`\n${e.message}\n`);
  process.exitCode = 1;
} finally {
  await cliente.close();
}
