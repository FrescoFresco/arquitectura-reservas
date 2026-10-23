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

function planificarSubida(opts) {
  const fecha = opts.fecha;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || '')) throw new Error('La fecha tiene que ser YYYY-MM-DD.');
  const tipo = (opts.tipo === 'microoperaciones' || opts.tipo === 'bloques') ? 'skills' : opts.tipo;
  if (tipo === 'proyectos') {
    const indice = clonar(opts.indice && typeof opts.indice === 'object' ? opts.indice : {});
    if (!Array.isArray(indice.proyectos)) indice.proyectos = [];
    indice.id = 'proyectos';
    indice.nombre = indice.nombre || 'Proyectos';
    const nombreArchivo = path.basename(String(opts.nombreArchivo || ''));
    if (!nombreArchivo || nombreArchivo === '.' || nombreArchivo === '..') {
      throw new Error('Falta el archivo.');
    }
    const ext = extensionDe(nombreArchivo);
    if (opts.nueva) {
      const id = opts.id ? String(opts.id) : slugId(opts.nombre);
      if (!ID_RE.test(id)) throw new Error('El id no es válido.');
      if (indice.proyectos.some(function (item) { return item && item.id === id; })) {
        throw new Error('Ya existe un proyecto con el id ' + id + '.');
      }
      const nombre = String(opts.nombre || '').trim();
      if (!nombre) throw new Error('Falta el nombre del proyecto.');
      const ruta = 'catalogo/proyectos/' + id + '/v1' + ext;
      const entrada = {
        id: id,
        nombre: nombre,
        skills: Array.isArray(opts.skills) ? opts.skills : [],
        versiones: [{ numero: 1, fecha: fecha, ruta: ruta, nombreArchivo: nombreArchivo }]
      };
      if (opts.descripcion) entrada.descripcion = String(opts.descripcion).trim().slice(0, 280);
      indice.proyectos.push(entrada);
      return {
        archivo: { ruta: ruta, mensaje: 'Añade ' + id + ' v1 a Proyectos' },
        indiceRuta: 'catalogo/proyectos/index.json',
        indiceMensaje: 'Actualiza el índice de Proyectos',
        indice: indice
      };
    }
    const id = String(opts.id || '');
    if (!ID_RE.test(id)) throw new Error('El id no es válido.');
    const proy = indice.proyectos.find(function (item) { return item && item.id === id; });
    if (!proy) throw new Error('No está ese proyecto: ' + id + '.');
    if (!Array.isArray(proy.versiones)) proy.versiones = [];
    if (Array.isArray(opts.skills)) proy.skills = opts.skills;
    const numero = siguienteNumero(proy.versiones);
    const ruta = 'catalogo/proyectos/' + id + '/v' + numero + ext;
    proy.versiones.push({ numero: numero, fecha: fecha, ruta: ruta, nombreArchivo: nombreArchivo });
    return {
      archivo: { ruta: ruta, mensaje: 'Añade ' + id + ' v' + numero + ' a Proyectos' },
      indiceRuta: 'catalogo/proyectos/index.json',
      indiceMensaje: 'Actualiza el índice de Proyectos',
      indice: indice
    };
  }
  if (tipo !== 'skills') throw new Error('El destino tiene que ser skills o proyectos.');
  const indice = clonar(opts.indice && typeof opts.indice === 'object' ? opts.indice : {});
  if (!Array.isArray(indice.instrucciones)) indice.instrucciones = [];
  indice.id = 'skills';
  if (!indice.nombre || indice.nombre === 'Microoperaciones' || indice.nombre === 'Bloques') indice.nombre = 'Skills';
  const nombreArchivo = path.basename(String(opts.nombreArchivo || ''));
  if (!nombreArchivo || nombreArchivo === '.' || nombreArchivo === '..') {
    throw new Error('Falta el archivo.');
  }
  const ext = extensionDe(nombreArchivo);
  if (opts.nueva) {
    const id = opts.id ? String(opts.id) : slugId(opts.nombre);
    if (!ID_RE.test(id)) throw new Error('El id no es válido.');
    if (indice.instrucciones.some(function (item) { return item && item.id === id; })) {
      throw new Error('Ya existe una skill con el id ' + id + '.');
    }
    const nombre = String(opts.nombre || '').trim();
    if (!nombre) throw new Error('Falta el nombre de la skill.');
    const ruta = 'catalogo/skills/' + id + '/v1' + ext;
    const entrada = {
      id: id,
      nombre: nombre,
      versiones: [{ numero: 1, fecha: fecha, ruta: ruta, nombreArchivo: nombreArchivo }]
    };
    if (opts.descripcion) entrada.descripcion = String(opts.descripcion).trim().slice(0, 280);
    if (Array.isArray(opts.anclas) && opts.anclas.length) entrada.anclas = opts.anclas;
    indice.instrucciones.push(entrada);
    return {
      archivo: { ruta: ruta, mensaje: 'Añade ' + id + ' v1 a Skills' },
      indiceRuta: 'catalogo/skills/index.json',
      indiceMensaje: 'Actualiza el índice de Skills',
      indice: indice
    };
  }
  const id = String(opts.id || '');
  if (!ID_RE.test(id)) throw new Error('El id no es válido.');
  const ins = indice.instrucciones.find(function (item) { return item && item.id === id; });
  if (!ins) throw new Error('No está esa skill: ' + id + '.');
  if (!Array.isArray(ins.versiones)) ins.versiones = [];
  const numero = siguienteNumero(ins.versiones);
  const ruta = 'catalogo/skills/' + id + '/v' + numero + ext;
  ins.versiones.push({ numero: numero, fecha: fecha, ruta: ruta, nombreArchivo: nombreArchivo });
  return {
    archivo: { ruta: ruta, mensaje: 'Añade ' + id + ' v' + numero + ' a Skills' },
    indiceRuta: 'catalogo/skills/index.json',
    indiceMensaje: 'Actualiza el índice de Skills',
    indice: indice
  };
}

function planificarEliminacion(opts) {
  const id = String(opts.id || '');
  if (!ID_RE.test(id)) throw new Error('El id no es válido.');
  const indice = clonar(opts.indice && typeof opts.indice === 'object' ? opts.indice : {});
  if (!Array.isArray(indice.instrucciones)) indice.instrucciones = [];
  indice.id = 'skills';
  if (!indice.nombre || indice.nombre === 'Microoperaciones' || indice.nombre === 'Bloques') indice.nombre = 'Skills';
  const antes = indice.instrucciones.length;
  indice.instrucciones = indice.instrucciones.filter(function (item) {
    return !(item && item.id === id);
  });
  if (indice.instrucciones.length === antes) throw new Error('No está esa skill: ' + id + '.');
  return {
    indiceRuta: 'catalogo/skills/index.json',
    indiceMensaje: 'Elimina ' + id + ' de Skills',
    indice: indice
  };
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--nueva') out.nueva = true;
    else if (a === '--ensayo') out.ensayo = true;
    else if (a === '--eliminar') out.eliminar = true;
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
    throw new Error('Uso: node scripts/subir.js skills|proyectos --archivo ./fichero [--nueva --nombre "Nombre"] [--id id] [--eliminar --id id] [--ensayo]');
  }
  const tipo = (destino === 'microoperaciones' || destino === 'bloques') ? 'skills' : destino;
  if (tipo !== 'skills' && tipo !== 'proyectos') {
    throw new Error('El destino tiene que ser skills o proyectos.');
  }
  if (args.eliminar) {
    if (tipo !== 'skills') throw new Error('Eliminar solo vale para una skill.');
    if (args.archivo || args.nueva || args.nombre) throw new Error('Eliminar no crea una versión ni lleva archivo.');
    if (!args.id) throw new Error('Falta --id.');
  } else if (!args.archivo) {
    throw new Error('Falta --archivo.');
  }
  const bytes = args.eliminar ? null : fs.readFileSync(args.archivo);
  const fecha = args.fecha || fechaHoy();
  const repo = process.env.GITHUB_REPOSITORIO || REPO_DEFECTO;
  const rama = process.env.GITHUB_RAMA || RAMA_DEFECTO;
  const indiceRuta = tipo === 'proyectos' ? 'catalogo/proyectos/index.json' : 'catalogo/skills/index.json';
  let indice = null;
  if (args.ensayo) {
    const local = tipo === 'proyectos'
      ? path.join(process.cwd(), 'catalogo', 'proyectos', 'index.json')
      : path.join(process.cwd(), 'catalogo', 'skills', 'index.json');
    if (fs.existsSync(local)) indice = JSON.parse(fs.readFileSync(local, 'utf8'));
  } else {
    const token = tokenDeEntorno();
    if (!token) throw new Error('Falta GITHUB_TOKEN o GH_TOKEN en el entorno (solo para espejo estático del repo). Los agentes del catálogo vivo usan la API Worker + clave inv_…; no hace falta este token.');
    const leido = await leerIndice(repo, rama, token, indiceRuta);
    indice = leido.json;
  }
  const plan = args.eliminar
    ? planificarEliminacion({ id: args.id, indice: indice })
    : planificarSubida({
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
      archivo: plan.archivo || null,
      indiceRuta: plan.indiceRuta,
      indice: plan.indice
    }, null, 2) + '\n');
    return;
  }
  const token = tokenDeEntorno();
  if (plan.archivo) await ponerArchivo(repo, rama, token, plan.archivo.ruta, plan.archivo.mensaje, bytes);
  const fresco = await leerIndice(repo, rama, token, plan.indiceRuta);
  const body = {
    message: plan.indiceMensaje,
    content: Buffer.from(JSON.stringify(plan.indice, null, 2) + '\n', 'utf8').toString('base64'),
    branch: rama
  };
  if (fresco.sha) body.sha = fresco.sha;
  await gh('PUT', repo, rama, plan.indiceRuta, token, body);
  process.stdout.write((plan.archivo ? plan.archivo.ruta : plan.indiceRuta) + '\n');
}

module.exports = {
  planificarSubida: planificarSubida,
  planificarEliminacion: planificarEliminacion,
  slugId: slugId,
  fechaHoy: fechaHoy
};

if (require.main === module) {
  main().catch(function (err) {
    process.stderr.write(String(err && err.message ? err.message : err) + '\n');
    process.exit(1);
  });
}
