import { MongoClient } from 'mongodb';
import { claveDe, baseActual } from './conexiones.js';

// Conecta a una base (por defecto MONGODB_DB o la del repositorio) con su propia clave
// (conexiones.local.json) o, si no tiene, con MONGODB_URI del .env.
export async function conectar(base = baseActual()) {
  const { uri } = claveDe(base);
  if (!uri) throw new Error(`La base ${base} no tiene clave: pégala en su ficha del panel o pon MONGODB_URI en .env`);
  const cliente = await MongoClient.connect(uri, { serverSelectionTimeoutMS: 15000 });
  return { cliente, db: cliente.db(base) };
}
