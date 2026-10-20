// Datos iniciales metidos a mano. Pasan por el gestor (alta) igual que la salida de un agente.
import { conectar } from './db.js';
import { alta } from './gestor.js';

const DATOS = {
  'neg-templo-de-pandora': `
_negocio.nombre_: Templo de Pandora
_negocio.url_: https://templodepandora.com/
_negocio.zona_horaria_: Atlantic/Canary
_negocio.telefono_: +34 614 20 16 43`,
  'neg-rincon-del-amazonas': `
_negocio.nombre_: Rincón del Amazonas
_negocio.url_: https://restaurantmogan.com/
_negocio.zona_horaria_: Atlantic/Canary
_negocio.telefono_: +34 928 565 098`,
  'proc-rincon-del-amazonas': `
_proceso.id_negocio_: neg-rincon-del-amazonas
_proceso.url_inicio_: https://restaurantmogan.com/reservation/
_proceso.alcance_: hasta_B`,
};

const { cliente, db } = await conectar();
try {
  for (const [id, texto] of Object.entries(DATOS)) {
    await alta(db, id, texto);
    console.log(`  alta: ${id}`);
  }
} finally {
  await cliente.close();
}
