'use strict';

const fs = require('fs');
const path = require('path');

const ID_RE = /^[a-z0-9][a-z0-9-]{0,60}$/;
const REPO_DEFECTO = 'FrescoFresco/arquitectura-reservas';
const RAMA_DEFECTO = 'main';

function extensionDe(nombre) {
  const base = path.basename(String(nombre || ''));
  const i = base.lastIndexOf('.');
  if (i <= 0) return '';
  const ext = base.slice(i).toLowerCase();
  if (!/^\.[a-z0-9]{1,12}$/.test(ext)) {
    throw new Error('La extensión del archivo no es válida.');
  }
  return ext;
}

function slugId(nombre) {
  const base = String(nombre || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  if (!ID_RE.test(base)) throw new Error('El nombre no produce un id válido.');
  return base;
}

function fechaHoy(date) {
  const d = date || new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + m + '-' + day;
}

function clonar(valor) {
  return JSON.parse(JSON.stringify(valor));
}

function siguienteNumero(versiones) {
  return (versiones || []).reduce(function (max, v) {
    return Math.max(max, Number(v && v.numero) || 0);
  }, 0) + 1;
}

const TABLAS_ACTIVACION = {
  reglas: 'Tabla de reglas',
  pasos: 'Tabla de pasos'
};

function validarTabla(texto) {
  let data;
  try { data = JSON.parse(String(texto)); } catch (e) { throw new Error('El archivo de la tabla no es JSON.'); }
  if (!data || !Array.isArray(data.columnas) || !data.columnas.length) throw new Error('La tabla necesita columnas.');
  if (!data.columnas.every(function (c) { return typeof c === 'string' && c.trim() !== ''; })) {
    throw new Error('Cada columna necesita nombre.');
  }
  if (!Array.isArray(data.filas)) throw new Error('La tabla necesita filas.');
  data.filas.forEach(function (fila) {
    if (!Array.isArray(fila) || fila.length !== data.columnas.length) {
      throw new Error('Hay una fila que no coincide con las columnas.');
    }
    if (!fila.every(function (c) { return typeof c === 'string'; })) {
      throw new Error('Las celdas tienen que ser texto.');
    }
  });
  return data;
}

function planificarSubida(opts) {
  const fecha = opts.fecha;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || '')) throw new Error('La fecha tiene que ser YYYY-MM-DD.');
  const tipo = opts.tipo === 'microoperaciones' ? 'bloques' : opts.tipo;
  if (tipo === 'tabla-activacion') {
    const tabla = String(opts.tabla || '');
    if (!Object.prototype.hasOwnProperty.call(TABLAS_ACTIVACION, tabla)) {
      throw new Error('La tabla tiene que ser reglas o pasos.');
    }
    const indice = clonar(opts.indice && typeof opts.indice === 'object' ? opts.indice : {});
    if (!Array.isArray(indice.versiones)) indice.versiones = [];
    const numero = siguienteNumero(indice.versiones);
    const ruta = 'catalogo/tabla-activacion/' + tabla + '/v' + numero + '.json';
    indice.id = indice.id || tabla;
    indice.nombre = indice.nombre || TABLAS_ACTIVACION[tabla];
    indice.versiones.push({ numero: numero, fecha: fecha, ruta: ruta });
    return {
      archivo: { ruta: ruta, mensaje: 'Publica ' + TABLAS_ACTIVACION[tabla] + ' v' + numero },
      indiceRuta: 'catalogo/tabla-activacion/' + tabla + '/index.json',
      indiceMensaje: 'Actualiza el índice de ' + TABLAS_ACTIVACION[tabla],
      indice: indice
    };
  }
  if (tipo === 'mapa') {
    const indice = clonar(opts.indice && typeof opts.indice === 'object' ? opts.indice : {});
    if (!Array.isArray(indice.versiones)) indice.versiones = [];
    const numero = siguienteNumero(indice.versiones);
    const ruta = 'mapa/v' + numero + '.mmd';
    indice.id = indice.id || 'flujo';
    indice.nombre = indice.nombre || 'Flujo del sistema';
    indice.versiones.push({ numero: numero, fecha: fecha, ruta: ruta });
    return {
      archivo: { ruta: ruta, mensaje: 'Publica el mapa v' + numero },
      indiceRuta: 'mapa/index.json',
      indiceMensaje: 'Actualiza el índice del mapa',
      indice: indice
    };
  }
  if (tipo !== 'bloques') throw new Error('El destino tiene que ser bloques, mapa o tabla-activacion.');
  const indice = clonar(opts.indice && typeof opts.indice === 'object' ? opts.indice : {});
  if (!Array.isArray(indice.instrucciones)) indice.instrucciones = [];
  indice.id = indice.id || 'microoperaciones';
  if (!indice.nombre || indice.nombre === 'Microoperaciones') indice.nombre = 'Bloques';
  const nombreArchivo = path.basename(String(opts.nombreArchivo || ''));
  if (!nombreArchivo || nombreArchivo === '.' || nombreArchivo === '..') {
    throw new Error('Falta el archivo.');
  }
  const ext = extensionDe(nombreArchivo);
  if (opts.nueva) {
    const id = opts.id ? String(opts.id) : slugId(opts.nombre);
    if (!ID_RE.test(id)) throw new Error('El id no es válido.');
    if (indice.instrucciones.some(function (item) { return item && item.id === id; })) {
      throw new Error('Ya existe un bloque con el id ' + id + '.');
    }
    const nombre = String(opts.nombre || '').trim();
    if (!nombre) throw new Error('Falta el nombre del bloque.');
    const ruta = 'catalogo/microoperaciones/' + id + '/v1' + ext;
    indice.instrucciones.push({
      id: id,
      nombre: nombre,
      versiones: [{ numero: 1, fecha: fecha, ruta: ruta, nombreArchivo: nombreArchivo }]
    });
    return {
      archivo: { ruta: ruta, mensaje: 'Añade ' + id + ' v1 a Bloques' },
      indiceRuta: 'catalogo/microoperaciones/index.json',
      indiceMensaje: 'Actualiza el índice de Bloques',
      indice: indice
    };
  }
  const id = String(opts.id || '');
  if (!ID_RE.test(id)) throw new Error('El id no es válido.');
  const ins = indice.instrucciones.find(function (item) { return item && item.id === id; });
  if (!ins) throw new Error('No está ese bloque: ' + id + '.');
  if (!Array.isArray(ins.versiones)) ins.versiones = [];
  const numero = siguienteNumero(ins.versiones);
  const ruta = 'catalogo/microoperaciones/' + id + '/v' + numero + ext;
  ins.versiones.push({ numero: numero, fecha: fecha, ruta: ruta, nombreArchivo: nombreArchivo });
  return {
    archivo: { ruta: ruta, mensaje: 'Añade ' + id + ' v' + numero + ' a Bloques' },
    indiceRuta: 'catalogo/microoperaciones/index.json',
    indiceMensaje: 'Actualiza el índice de Bloques',
    indice: indice
  };
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--nueva') out.nueva = true;
    else if (a === '--ensayo') out.ensayo = true;
    else if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1];
      if (!val || val.startsWith('--')) throw new Error('Falta el valor de --' + key + '.');
      out[key] = val;
      i += 1;
    } else out._.push(a);
  }
  return out;
}

function tokenDeEntorno() {
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
}

async function gh(method, repo, rama, ruta, token, body) {
  const base = 'https://api.github.com/repos/' + repo + '/contents/' + ruta.split('/').map(encodeURIComponent).join('/');
  const url = method === 'GET' ? base + '?ref=' + encodeURIComponent(rama) : base;
  const res = await fetch(url, {
    method: method,
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'arquitectura-reservas-subir'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch (e) { data = { message: text }; }
  }
  if (!res.ok) {
    const err = new Error((data && data.message) || ('GitHub respondió ' + res.status));
    err.status = res.status;
    throw err;
  }
  return data;
}

async function leerIndice(repo, rama, token, ruta) {
  try {
    const data = await gh('GET', repo, rama, ruta, token);
    const json = JSON.parse(Buffer.from(data.content, 'base64').toString('utf8'));
    return { sha: data.sha, json: json };
  } catch (e) {
    if (e.status === 404) return { sha: null, json: null };
    throw e;
  }
}

async function ponerArchivo(repo, rama, token, ruta, mensaje, bytes) {
  let sha;
  try {
    const actual = await gh('GET', repo, rama, ruta, token);
    sha = actual.sha;
  } catch (e) {
    if (e.status !== 404) throw e;
  }
  const body = {
    message: mensaje,
    content: Buffer.from(bytes).toString('base64'),
    branch: rama
  };
  if (sha) body.sha = sha;
  await gh('PUT', repo, rama, ruta, token, body);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const destino = args._[0];
  if (!destino || args._.length !== 1) {
    throw new Error('Uso: node scripts/subir.js bloques|mapa|tabla-activacion --archivo ./fichero [--tabla reglas|pasos] [--nueva --nombre "Nombre"] [--id id] [--ensayo]');
  }
  const tipo = destino === 'microoperaciones' ? 'bloques' : destino;
  if (tipo !== 'bloques' && tipo !== 'mapa' && tipo !== 'tabla-activacion') {
    throw new Error('El destino tiene que ser bloques, mapa o tabla-activacion.');
  }
  if (!args.archivo) throw new Error('Falta --archivo.');
  const bytes = fs.readFileSync(args.archivo);
  if (tipo === 'mapa') {
    if (bytes.includes(0)) throw new Error('El mapa tiene que ser texto UTF-8.');
    const texto = bytes.toString('utf8');
    if (!texto.trim()) throw new Error('El mapa está vacío.');
  }
  if (tipo === 'tabla-activacion') validarTabla(bytes.toString('utf8'));
  const fecha = args.fecha || fechaHoy();
  const repo = process.env.GITHUB_REPOSITORIO || REPO_DEFECTO;
  const rama = process.env.GITHUB_RAMA || RAMA_DEFECTO;
  const indiceRuta = tipo === 'mapa'
    ? 'mapa/index.json'
    : (tipo === 'tabla-activacion'
      ? 'catalogo/tabla-activacion/' + String(args.tabla || '') + '/index.json'
      : 'catalogo/microoperaciones/index.json');
  let indice = null;
  if (args.ensayo) {
    const local = tipo === 'mapa'
      ? path.join(process.cwd(), 'mapa', 'index.json')
      : (tipo === 'tabla-activacion'
        ? path.join(process.cwd(), 'catalogo', 'tabla-activacion', String(args.tabla || ''), 'index.json')
        : path.join(process.cwd(), 'catalogo', 'microoperaciones', 'index.json'));
    if (fs.existsSync(local)) indice = JSON.parse(fs.readFileSync(local, 'utf8'));
  } else {
    const token = tokenDeEntorno();
    if (!token) throw new Error('Falta GITHUB_TOKEN o GH_TOKEN en el entorno. No va en la página.');
    const leido = await leerIndice(repo, rama, token, indiceRuta);
    indice = leido.json;
  }
  const plan = planificarSubida({
    tipo: tipo,
    nueva: !!args.nueva,
    nombre: args.nombre,
    id: args.id,
    nombreArchivo: path.basename(args.archivo),
    tabla: args.tabla,
    fecha: fecha,
    indice: indice
  });
  if (args.ensayo) {
    process.stdout.write(JSON.stringify({
      archivo: plan.archivo,
      indiceRuta: plan.indiceRuta,
      indice: plan.indice
    }, null, 2) + '\n');
    return;
  }
  const token = tokenDeEntorno();
  await ponerArchivo(repo, rama, token, plan.archivo.ruta, plan.archivo.mensaje, bytes);
  const fresco = await leerIndice(repo, rama, token, plan.indiceRuta);
  const body = {
    message: plan.indiceMensaje,
    content: Buffer.from(JSON.stringify(plan.indice, null, 2) + '\n', 'utf8').toString('base64'),
    branch: rama
  };
  if (fresco.sha) body.sha = fresco.sha;
  await gh('PUT', repo, rama, plan.indiceRuta, token, body);
  process.stdout.write(plan.archivo.ruta + '\n');
}

module.exports = {
  planificarSubida: planificarSubida,
  validarTabla: validarTabla,
  extensionDe: extensionDe,
  slugId: slugId,
  fechaHoy: fechaHoy
};

if (require.main === module) {
  main().catch(function (err) {
    process.stderr.write(String(err && err.message ? err.message : err) + '\n');
    process.exit(1);
  });
}
