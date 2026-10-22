import { MongoClient } from 'mongodb';

export async function conectar() {
  if (!process.env.MONGODB_URI || !process.env.MONGODB_DB) throw new Error('Faltan MONGODB_URI y MONGODB_DB en .env (copia .env.example)');
  const cliente = await MongoClient.connect(process.env.MONGODB_URI);
  return { cliente, db: cliente.db(process.env.MONGODB_DB) };
}
