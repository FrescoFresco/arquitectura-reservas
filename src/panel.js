// npm run panel: la web de npm run web, servida en http://localhost:3000 con un puente a MongoDB.
// Solo escucha en 127.0.0.1, solo acepta Host localhost/127.0.0.1 y toda la API exige el token de esta sesión,
// así otra web abierta en el navegador no puede usarlo. Crear, editar y borrar pasan por el gestor.
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { MongoClient, BSON } from 'mongodb';
import { pagina } from './web.js';
import { cargar, COLECCIONES } from './catalogo.js';
import { leerConexiones, guardarConexion, borrarConexion, claveDe, enmascarar, nombreValido, baseActual, clavesIgnoradas } from './conexiones.js';
import { raizEditable, crearManual, editarManual, borrarManual, Rechazo } from './gestor.js';

const { EJSON } = BSON;
const POR_PAGINA = 20;
const sinUri = (t) => String(t).replace(/mongodb(\+srv)?:\/\/\S+/g, (u) => `mongodb://${enmascarar(u) ?? '…'}`);

class Peticion extends Error {}

// Documento de ejemplo para «Nuevo»: los campos que escribe «manual», con el prefijo del _id.
function plantillaNuevo(raiz) {
  const doc = { _id: `${COLECCIONES[raiz].prefijo}-` };
  for (const d of cargar().filter((d) => d.id.startsWith(raiz + '.') && d.estado === 'activo' && d.escribe.includes('manual') && !d.id.includes('.N'))) {
    const ruta = d.id.split('.').slice(1);
    let nodo = doc;
    ruta.slice(0, -1).forEach((k) => (nodo = nodo[k] ??= {}));
    nodo[ruta.at(-1)] = d.tipo === 'enum' ? d.valores[0] : '';
  }
  return doc;
}

export function crearPanel() {
  const token = randomBytes(24).toString('hex');
  const clientes = new Map();
  const conectar = async (base) => {
    const { uri } = claveDe(base);
    if (!uri) throw new Rechazo([`${base} no tiene clave: pégala en su ficha o pon MONGODB_URI en .env`]);
    if (!clientes.has(uri)) {
      clientes.set(uri, MongoClient.connect(uri, { serverSelectionTimeoutMS: 8000 }).catch((e) => (clientes.delete(uri), Promise.reject(e))));
    }
    return (await clientes.get(uri)).db(base);
  };

  const bases = () =>
    [...new Set([baseActual(), ...Object.keys(leerConexiones())])].map((nombre) => {
      const { uri, origen } = claveDe(nombre);
      return { nombre, host: enmascarar(uri), origen };
    });

  const avisos = () =>
    clavesIgnoradas().map((b) => `conexiones.local.json tiene una clave para «${b}», que no es el nombre de ninguna base: se ignora. Pega la URI en la ficha de tu base y borra esa entrada del fichero.`);

  async function estado(base) {
    const { uri, origen } = claveDe(base);
    const ficha = { base, host: enmascarar(uri), origen };
    if (!uri) return { ...ficha, conectado: false, error: 'sin clave' };
    try {
      const db = await conectar(base);
      await db.command({ ping: 1 });
      return { ...ficha, conectado: true, version: (await db.admin().serverInfo()).version };
    } catch (e) {
      return { ...ficha, conectado: false, error: sinUri(e.message) };
    }
  }

  async function api(metodo, partes, cuerpo, url) {
    const [recurso, base, sub, coleccion, que, id] = partes;
    if (recurso !== 'bases') throw new Peticion('ruta desconocida');
    if (!base) return { bases: bases(), avisos: avisos() };
    if (!nombreValido(base)) throw new Peticion(`«${base}» no es un nombre de base válido: elige una base en la ficha`);

    if (sub === 'estado' && metodo === 'GET') return estado(base);
    if (sub === 'conexion' && metodo === 'POST') {
      try {
        guardarConexion(base, cuerpo.uri);
      } catch (e) {
        throw new Peticion(e.message);
      }
      return estado(base);
    }
    if (sub === 'conexion' && metodo === 'DELETE') {
      borrarConexion(base);
      return estado(base);
    }
    if (sub !== 'colecciones') throw new Peticion('ruta desconocida');

    const db = await conectar(base);
    if (!coleccion) {
      const lista = await db.listCollections({}, { nameOnly: true }).toArray();
      const colecciones = await Promise.all(
        lista.map(async ({ name }) => {
          const raiz = raizEditable(name);
          return { nombre: name, documentos: await db.collection(name).estimatedDocumentCount(), editable: !!raiz, nuevo: raiz ? plantillaNuevo(raiz) : null };
        }),
      );
      return { colecciones: colecciones.sort((a, b) => a.nombre.localeCompare(b.nombre)) };
    }
    const col = db.collection(coleccion);
    if (que === 'esquema' && metodo === 'GET') {
      const [info] = await db.listCollections({ name: coleccion }).toArray();
      return { validador: info?.options?.validator ?? null, indices: await col.indexes() };
    }
    if (que !== 'documentos') throw new Peticion('ruta desconocida');
    if (metodo === 'GET' && !id) {
      let filtro;
      try {
        filtro = EJSON.parse(url.searchParams.get('filtro') || '{}', { relaxed: true });
      } catch (e) {
        throw new Peticion(`el filtro no es JSON válido: ${e.message}`);
      }
      if (!filtro || typeof filtro !== 'object' || Array.isArray(filtro)) throw new Peticion('el filtro tiene que ser un objeto JSON, por ejemplo {"zona_horaria": "Atlantic/Canary"}');
      const pagina = Math.max(1, Number.parseInt(url.searchParams.get('pagina'), 10) || 1);
      const [total, docs] = await Promise.all([
        col.countDocuments(filtro),
        col.find(filtro).sort({ _id: 1 }).skip((pagina - 1) * POR_PAGINA).limit(POR_PAGINA).toArray(),
      ]);
      return { total, pagina, porPagina: POR_PAGINA, documentos: EJSON.serialize(docs, { relaxed: true }) };
    }
    const documento = () => {
      try {
        return EJSON.parse(cuerpo.documento ?? '', { relaxed: true });
      } catch (e) {
        throw new Rechazo([`el documento no es JSON válido: ${e.message}`]);
      }
    };
    if (metodo === 'POST' && !id) {
      const doc = documento();
      await crearManual(db, coleccion, doc);
      return { creado: doc._id };
    }
    if (metodo === 'PUT' && id) return editarManual(db, coleccion, id, documento());
    if (metodo === 'DELETE' && id) {
      if (cuerpo.confirmacion !== id) throw new Rechazo([`para borrar, escribe exactamente el _id: ${id}`]);
      await borrarManual(db, coleccion, id);
      return { borrado: id };
    }
    throw new Peticion('ruta desconocida');
  }

  const servidor = createServer(async (req, res) => {
    const enviar = (codigo, cuerpo, tipo = 'application/json; charset=utf-8') => {
      res.writeHead(codigo, { 'content-type': tipo, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      res.end(tipo.startsWith('application/json') ? JSON.stringify(cuerpo) : cuerpo);
    };
    const puerto = servidor.address().port;
    if (![`localhost:${puerto}`, `127.0.0.1:${puerto}`].includes(req.headers.host)) return enviar(403, { error: 'Host no permitido' });
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === 'GET' && url.pathname === '/') return enviar(200, pagina({ panel: { token } }), 'text/html; charset=utf-8');
    if (!url.pathname.startsWith('/api/')) return enviar(404, { error: 'no existe' });
    if (req.headers['x-panel-token'] !== token) return enviar(403, { error: 'falta el token del panel: recarga la página' });
    try {
      let texto = '';
      for await (const trozo of req) {
        texto += trozo;
        if (texto.length > 1_000_000) throw new Peticion('el cuerpo es demasiado grande');
      }
      let cuerpo = {};
      try {
        cuerpo = texto ? JSON.parse(texto) : {};
      } catch {
        throw new Peticion('el cuerpo no es JSON');
      }
      const partes = url.pathname.slice('/api/'.length).split('/').map(decodeURIComponent);
      enviar(200, await api(req.method, partes, cuerpo, url));
    } catch (e) {
      if (e instanceof Rechazo) enviar(422, { error: 'No se ha hecho', detalles: e.errores.map(sinUri) });
      else if (e instanceof Peticion) enviar(400, { error: e.message });
      else enviar(500, { error: sinUri(e.message) });
    }
  });

  return {
    servidor,
    token,
    avisos,
    async cerrar() {
      await new Promise((r) => servidor.close(r));
      for (const c of clientes.values()) await c.then((x) => x.close(), () => {});
    },
  };
}

function abrirNavegador(url) {
  const [orden, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : [process.platform === 'darwin' ? 'open' : 'xdg-open', [url]];
  spawn(orden, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}

if (import.meta.main) {
  const i = process.argv.indexOf('--puerto');
  const puerto = i > 0 ? Number(process.argv[i + 1]) : 3000;
  const { servidor, avisos } = crearPanel();
  servidor.on('error', (e) => {
    console.error(e.code === 'EADDRINUSE' ? `El puerto ${puerto} está ocupado: ¿ya tienes el panel abierto en otra terminal?` : e.message);
    process.exit(1);
  });
  servidor.listen(puerto, '127.0.0.1', () => {
    const url = `http://localhost:${servidor.address().port}/#base-de-datos`;
    console.log(`Panel en ${url}  (Ctrl+C para pararlo) · base por defecto: ${baseActual()}`);
    for (const a of avisos()) console.warn(`Aviso: ${a}`);
    if (!process.argv.includes('--sin-navegador')) abrirNavegador(url);
  });
}
