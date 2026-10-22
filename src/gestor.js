import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { userInfo } from 'node:os';
import { cargar, huella, patron, COLECCIONES, TIPOS, referida } from './catalogo.js';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const META = /^<!-- gestor (\{.*\}) -->/;
const MARCA_VALORES = '<!-- valores -->';

// ---------- Funciones puras: texto de un agente → valores validados ----------

export function separar(texto) {
  const exp = texto.match(/^#{1,6}[ \t]*Explicaci[oó]n[ \t]*$/im);
  const sal = texto.match(/^#{1,6}[ \t]*Salida[ \t]*$/im);
  if (!exp || !sal || sal.index < exp.index) throw new Error('La respuesta debe tener una sección «Explicación» y después una «Salida»');
  const explicacion = texto.slice(exp.index + exp[0].length, sal.index).trim();
  if (!explicacion) throw new Error('La sección «Explicación» está vacía');
  return { explicacion, salida: texto.slice(sal.index + sal[0].length) };
}

export function anclas(salida) {
  const lineas = salida.split(/\r?\n/);
  const lista = [];
  const errores = [];
  for (let i = 0; i < lineas.length; i++) {
    if (!lineas[i].trim()) continue;
    const m = lineas[i].match(/^_([\w.]+?)_:[ \t]*(.*?)[ \t]*$/);
    if (!m) {
      errores.push(`línea no entendida en la Salida (debe ser _ruta_: valor): «${lineas[i]}»`);
      continue;
    }
    let texto = m[2];
    if (texto === '' && /^```/.test(lineas[i + 1] ?? '')) {
      const fin = lineas.findIndex((l, j) => j > i + 1 && l.trim() === '```');
      if (fin < 0) {
        errores.push(`${m[1]}: el bloque entre \`\`\` no se cierra`);
        break;
      }
      texto = lineas.slice(i + 2, fin).join('\n');
      i = fin;
    } else if (texto === '') {
      errores.push(`${m[1]}: sin valor (escribe null si no hay dato)`);
      continue;
    }
    lista.push({ ruta: m[1], texto });
  }
  return { anclas: lista, errores };
}

// Si `ruta` es un alias del catálogo, devuelve la ruta canónica con los mismos números de lista.
export function resolverAlias(ruta, defs) {
  const d = defs.find((x) => x.alias?.includes(patron(ruta)));
  if (!d) return null;
  const nums = ruta.split('.').filter((s) => /^\d+$/.test(s));
  return d.id
    .split('.')
    .map((s) => (s === 'N' ? nums.shift() : s))
    .join('.');
}

export function validar(lista, defs, plantilla) {
  const mapa = new Map(defs.map((d) => [d.id, d]));
  const valores = [];
  const propuestas = [];
  const errores = [];
  const alias = [];
  const vistas = new Set();
  const conocidas = [];
  for (const { ruta: escrita, texto } of lista) {
    if (escrita.startsWith('propuesta.')) {
      const r = escrita.slice('propuesta.'.length);
      const canon = mapa.has(patron(r)) ? r : resolverAlias(r, defs);
      if (canon) errores.push(`${escrita}: ${r} ya existe en el catálogo${canon !== r ? ` como alias de ${canon}` : ''}; escríbelo sin «propuesta.»`);
      else propuestas.push({ ruta: r, valor: texto });
      continue;
    }
    const canon = mapa.has(patron(escrita)) ? null : resolverAlias(escrita, defs);
    if (canon) alias.push({ de: escrita, a: canon });
    const ruta = canon ?? escrita;
    if (vistas.has(ruta)) {
      errores.push(`${ruta}: repetido${canon ? ` (llega también por el alias ${escrita})` : ''}`);
      continue;
    }
    vistas.add(ruta);
    const d = mapa.get(patron(ruta));
    if (!d) {
      errores.push(`${ruta}: no existe en el catálogo; si hace falta, propónlo como _propuesta.${ruta}_`);
      continue;
    }
    conocidas.push(ruta);
    if (d.estado !== 'activo') {
      errores.push(`${ruta}: está ${d.estado}${d.sustituido_por ? `; usa ${d.sustituido_por}` : ''}`);
      continue;
    }
    if (!d.escribe.includes(plantilla)) {
      errores.push(`${ruta}: ${plantilla} no puede escribirlo (lo escribe: ${d.escribe.join(', ')})`);
      continue;
    }
    if (texto === 'null') {
      if (d.nivel === 'blindado') errores.push(`${ruta}: es blindado (obligatorio); no puede ser null`);
      else valores.push({ ruta, valor: null });
      continue;
    }
    try {
      valores.push({ ruta, valor: TIPOS[d.tipo].leer(texto, d) });
    } catch (e) {
      errores.push(`${ruta}: ${e.message}`);
    }
  }
  errores.push(...revisarListas(conocidas, defs), ...revisarIdentificadores(valores));
  return { valores, propuestas, errores, alias };
}

// Un campo de clase identificador (DNI, NIE, pasaporte) nunca lleva valor de prueba: podría ser el de alguien real.
function revisarIdentificadores(valores) {
  const valor = new Map(valores.map((v) => [v.ruta, v.valor]));
  return valores
    .filter((v) => /\.campos\.\d+\.clase$/.test(v.ruta) && v.valor === 'identificador')
    .map((v) => v.ruta.replace(/clase$/, 'valor_prueba'))
    .filter((r) => valor.get(r) != null)
    .map((r) => `${r}: un campo de clase identificador no lleva valor de prueba; escribe null`);
}

// Cada campo de clase consentimiento exige que la función pida esa aceptación al cliente: un parámetro const: true.
export function revisarConsentimiento(campos = [], parametros) {
  const consentimientos = campos.filter((c) => c.clase === 'consentimiento').length;
  const constTrue = Object.values(parametros?.properties ?? {}).filter((p) => p.const === true).length;
  if (constTrue >= consentimientos) return null;
  return `version.funcion.parametros: el recorrido tiene ${consentimientos} campo(s) de consentimiento y el JSON Schema solo ${constTrue} parámetro(s) con const: true; el cliente tiene que aceptarlo`;
}

// Listas numeradas 1..n sin huecos, y cada elemento con sus campos blindados.
function revisarListas(rutas, defs) {
  const errores = [];
  const indices = new Map();
  for (const r of rutas) {
    const segs = r.split('.');
    segs.forEach((s, i) => {
      if (!/^\d+$/.test(s)) return;
      const lista = segs.slice(0, i).join('.');
      if (!indices.has(lista)) indices.set(lista, new Set());
      indices.get(lista).add(Number(s));
    });
  }
  for (const [lista, nums] of indices) {
    if (nums.size !== Math.max(...nums) || nums.has(0)) {
      errores.push(`${lista}: numera los elementos 1, 2, 3… sin huecos (hay ${[...nums].sort((a, b) => a - b).join(', ')})`);
    }
    for (const n of nums) {
      const elemento = `${lista}.${n}`;
      const base = patron(elemento) + '.';
      for (const d of defs) {
        const resto = d.id.slice(base.length);
        if (d.nivel !== 'blindado' || d.estado !== 'activo' || !d.id.startsWith(base) || resto.split('.').includes('N')) continue;
        if (!rutas.includes(`${elemento}.${resto}`)) errores.push(`${elemento}.${resto}: falta (es blindado)`);
      }
    }
  }
  return errores;
}

// [{ruta: 'version.recorrido.campos.1.nombre', valor}] -> { version: { recorrido: { campos: [{ nombre }] } } }
export function anidar(valores) {
  const raiz = {};
  for (const { ruta, valor } of valores) {
    const segs = ruta.split('.');
    let nodo = raiz;
    segs.forEach((s, i) => {
      const clave = /^\d+$/.test(s) ? Number(s) - 1 : s;
      if (i === segs.length - 1) nodo[clave] = valor;
      else nodo = nodo[clave] ??= /^\d+$/.test(segs[i + 1]) ? [] : {};
    });
  }
  return raiz;
}

// Documento de Mongo -> [{ruta, valor, def}] con N sustituida por 1, 2, 3…
export function aplanar(valor, ruta, mapa, salida = []) {
  const def = mapa.get(patron(ruta));
  if (def) salida.push({ ruta, valor, def });
  else if (Array.isArray(valor)) valor.forEach((v, i) => aplanar(v, `${ruta}.${i + 1}`, mapa, salida));
  else if (valor && typeof valor === 'object' && !(valor instanceof Date)) {
    for (const [k, v] of Object.entries(valor)) if (k !== '_id') aplanar(v, `${ruta}.${k}`, mapa, salida);
  }
  return salida;
}

export function formatear({ ruta, valor, def }) {
  if (valor === null || valor === undefined) return `_${ruta}_: null`;
  if (def.tipo === 'json') return `_${ruta}_:\n\`\`\`json\n${JSON.stringify(valor, null, 2)}\n\`\`\``;
  if (def.tipo === 'texto_largo') return `_${ruta}_:\n\`\`\`\n${valor}\n\`\`\``;
  if (valor instanceof Date) return `_${ruta}_: ${valor.toISOString()}`;
  return `_${ruta}_: ${valor}`;
}

function versionPlantilla(texto) {
  const m = texto.match(/^## Versión\s+(\d+)/m);
  if (!m) throw new Error('La plantilla no tiene una sección «## Versión» con un número');
  return Number(m[1]);
}

// ---------- Órdenes ----------

export async function preparar(db, plantilla, { proceso: idProceso, version: idVersion } = {}) {
  const defs = cargar();
  const fichero = join(RAIZ, 'plantillas', `${plantilla}.md`);
  if (!existsSync(fichero)) throw new Error(`No existe la plantilla ${plantilla}`);
  let texto = readFileSync(fichero, 'utf8');
  if (!texto.includes(MARCA_VALORES)) throw new Error(`La plantilla no tiene la marca ${MARCA_VALORES}`);

  const leeVersion = defs.some((d) => d.id.startsWith('version.') && d.lee.includes(plantilla));
  if (leeVersion && !idVersion) throw new Error(`${plantilla} trabaja sobre una versión existente: usa --version ver-…`);
  let version = null;
  if (idVersion) {
    version = await db.collection('versiones').findOne({ _id: idVersion });
    if (!version) throw new Error(`No existe la versión ${idVersion}`);
    idProceso = version.id_proceso;
  }
  const proceso = idProceso && (await db.collection('procesos').findOne({ _id: idProceso }));
  if (!proceso) throw new Error(`No existe el proceso ${idProceso ?? '(falta --proceso)'}`);
  const negocio = await db.collection('negocios').findOne({ _id: proceso.id_negocio });
  if (!version) {
    const n = (await db.collection('versiones').countDocuments({ id_proceso: idProceso })) + 1;
    idVersion = `ver-${idProceso.replace(/^proc-/, '')}-${n}`;
  }

  const mapa = new Map(defs.map((d) => [d.id, d]));
  const lineas = [['negocio', negocio], ['proceso', proceso], ['version', version]]
    .filter(([, doc]) => doc)
    .flatMap(([raiz, doc]) => aplanar(doc, raiz, mapa))
    .filter((a) => a.def.estado === 'activo' && a.def.lee.includes(plantilla) && !a.def.sensible)
    .map(formatear);
  const contexto = `Trabajas sobre: negocio \`${negocio._id}\` · proceso \`${proceso._id}\` · versión \`${idVersion}\`${version ? '' : ' (nueva)'}.`;
  texto = texto.replace(MARCA_VALORES, () => `${contexto}\n\n${lineas.join('\n')}`);

  const meta = { plantilla, version_plantilla: versionPlantilla(texto), id_negocio: negocio._id, id_proceso: proceso._id, id_version: idVersion };
  const sello = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '-');
  const base = join(RAIZ, 'trabajo', `${plantilla}-${idVersion}-${sello}`);
  mkdirSync(dirname(base), { recursive: true });
  writeFileSync(`${base}.entrada.md`, `<!-- gestor ${JSON.stringify(meta)} -->\n${texto}`);
  return base;
}

export function leer(base) {
  const entrada = readFileSync(`${base}.entrada.md`, 'utf8');
  const respuesta = readFileSync(`${base}.respuesta.md`, 'utf8');
  const m = entrada.match(META);
  if (!m) throw new Error('La entrada no tiene la cabecera del gestor; prepárala con «gestor preparar»');
  const meta = JSON.parse(m[1]);
  let explicacion = '';
  let valores = [];
  let propuestas = [];
  let alias = [];
  let errores;
  try {
    const s = separar(respuesta);
    explicacion = s.explicacion;
    const a = anclas(s.salida);
    const v = validar(a.anclas, cargar(), meta.plantilla);
    ({ valores, propuestas, alias } = v);
    errores = [...a.errores, ...v.errores];
  } catch (e) {
    errores = [e.message];
  }
  return { meta, entrada, respuesta, explicacion, valores, propuestas, alias, errores, entendido: anidar(valores) };
}

async function escribir(db, meta, entendido) {
  const destino = { negocio: meta.id_negocio, proceso: meta.id_proceso, version: meta.id_version };
  const otras = Object.keys(entendido).filter((k) => !destino[k]);
  if (otras.length) throw new Error(`una plantilla no escribe en ${otras.join(', ')}`);
  if (entendido.version) {
    const v = await db.collection('versiones').findOne({ _id: meta.id_version }, { projection: { estado: 1, recorrido: 1 } });
    if (v && v.estado !== 'borrador') throw new Error(`la versión ${meta.id_version} está ${v.estado}; solo se modifica un borrador`);
    if (entendido.version.funcion?.parametros) {
      const error = revisarConsentimiento((entendido.version.recorrido ?? v?.recorrido)?.campos, entendido.version.funcion.parametros);
      if (error) throw new Error(error);
    }
  }
  // ponytail: sin transacción entre colecciones (Mongo local sin réplica); se escribe primero la versión,
  // que es lo que más puede fallar. Con un replica set, envolverlo en una sesión con transacción.
  for (const raiz of ['version', 'proceso', 'negocio']) {
    if (!entendido[raiz]) continue;
    const nueva = raiz === 'version' ? { $setOnInsert: { id_proceso: meta.id_proceso, estado: 'borrador', creada: new Date() } } : {};
    const res = await db
      .collection(COLECCIONES[raiz].nombre)
      .updateOne({ _id: destino[raiz] }, { $set: entendido[raiz], ...nueva }, { upsert: raiz === 'version' });
    if (!res.matchedCount && !res.upsertedCount) throw new Error(`no existe ${destino[raiz]}`);
  }
}

const detalle = (e) => e.message + (e.errInfo ? ` ${JSON.stringify(e.errInfo.details)}` : '');

export async function guardar(db, base) {
  const r = leer(base);
  const id = `corr-${basename(base)}`;
  if (await db.collection('corridas').findOne({ _id: id }, { projection: { _id: 1 } })) throw new Error(`${id} ya está guardada`);
  const errores = [...r.errores];
  if (!errores.length) {
    try {
      await escribir(db, r.meta, r.entendido);
    } catch (e) {
      errores.push(`no se guardó: ${detalle(e)}`);
    }
  }
  const corrida = {
    _id: id,
    plantilla: r.meta.plantilla,
    version_plantilla: r.meta.version_plantilla,
    version_catalogo: huella(),
    fecha: new Date(),
    id_negocio: r.meta.id_negocio,
    id_proceso: r.meta.id_proceso,
    id_version: r.meta.id_version,
    entrada: r.entrada,
    respuesta: r.respuesta,
    guardada: !errores.length,
    entendido: r.entendido,
    errores,
    propuestas: r.propuestas.map((p) => ({ ...p, estado: 'pendiente' })),
  };
  await db.collection('corridas').insertOne(corrida);
  return { ...r, corrida };
}

// Datos metidos a mano: pasan por la misma validación, con «manual» como quien escribe.
export async function alta(db, id, texto) {
  const a = anclas(texto);
  const v = validar(a.anclas, cargar(), 'manual');
  const errores = [...a.errores, ...v.errores, ...v.propuestas.map((p) => `un alta manual no admite propuestas: ${p.ruta}`)];
  const anidado = anidar(v.valores);
  const raices = Object.keys(anidado);
  if (raices.length !== 1) errores.push('un alta escribe en un solo documento');
  if (errores.length) throw new Error(`Alta de ${id} rechazada:\n- ${errores.join('\n- ')}`);
  await db.collection(COLECCIONES[raices[0]].nombre).updateOne({ _id: id }, { $set: anidado[raices[0]] }, { upsert: true });
}

// ---------- Escrituras manuales desde el panel: pasan por el catálogo como un alta manual ----------

// Colección de MongoDB → raíz del catálogo, solo si «manual» escribe algún campo suyo (negocios, procesos).
export function raizEditable(coleccion, defs = cargar()) {
  const raiz = Object.keys(COLECCIONES).find((r) => COLECCIONES[r].nombre === coleccion);
  return raiz && defs.some((d) => d.id.startsWith(raiz + '.') && d.estado === 'activo' && d.escribe.includes('manual')) ? raiz : null;
}

// Documento → líneas de anclaje { ruta, texto }, con todas sus hojas (también las que no están en el catálogo).
function aLineas(doc, raiz, mapa) {
  const lineas = [];
  const texto = (v) => (v === null ? 'null' : v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v));
  const recorrer = (v, ruta) => {
    if (mapa.get(patron(ruta))?.tipo === 'json' || v === null || typeof v !== 'object' || v instanceof Date) lineas.push({ ruta, texto: texto(v) });
    else if (Array.isArray(v)) v.forEach((x, i) => recorrer(x, `${ruta}.${i + 1}`));
    else for (const [k, x] of Object.entries(v)) recorrer(x, `${ruta}.${k}`);
  };
  for (const [k, v] of Object.entries(doc)) if (k !== '_id') recorrer(v, `${raiz}.${k}`);
  return lineas;
}

const rutaMongo = (ruta) => ruta.split('.').slice(1).map((s) => (/^\d+$/.test(s) ? String(Number(s) - 1) : s)).join('.');

// Valida un documento editado a mano contra el catálogo. Solo comprueba lo que cambia respecto a `anterior`,
// así un campo que no escribe «manual» (proceso.id_version_activa) se conserva sin poder tocarse.
export function documentoManual(raiz, nuevo, anterior = null, defs = cargar()) {
  const mapa = new Map(defs.map((d) => [d.id, d]));
  const antes = new Map(anterior ? aLineas(anterior, raiz, mapa).map((l) => [l.ruta, l.texto]) : []);
  const ahora = aLineas(nuevo, raiz, mapa);
  const cambiadas = ahora.filter((l) => antes.get(l.ruta) !== l.texto);
  const v = validar(cambiadas, defs, 'manual');
  const errores = [...v.errores, ...v.propuestas.map((p) => `${p.ruta}: el panel no admite propuestas`)];
  const quitadas = [...antes.keys()].filter((r) => !ahora.some((l) => l.ruta === r));
  for (const r of quitadas) {
    const d = mapa.get(patron(r));
    if (d?.nivel === 'blindado') errores.push(`${r}: es blindado (obligatorio); no se puede quitar`);
    else if (d && !d.escribe.includes('manual')) errores.push(`${r}: el panel no puede quitarlo (lo escribe: ${d.escribe.join(', ')})`);
  }
  const $set = Object.fromEntries(v.valores.map((x) => [rutaMongo(x.ruta), x.valor]));
  const $unset = Object.fromEntries(quitadas.map((r) => [rutaMongo(r), '']));
  return { errores, valores: v.valores, $set, $unset };
}

// El rechazo del validador de MongoDB, en frases: «url: no cumple el patrón ^https?://», «falta zona_horaria».
export function motivoValidador(e) {
  const reglas = e?.errInfo?.details?.schemaRulesNotSatisfied;
  if (!reglas) return [e.message];
  const frases = [];
  const leer = (detalles, ruta) => {
    for (const d of detalles ?? []) {
      if (d.missingProperties) frases.push(`${ruta}falta ${d.missingProperties.join(', ')} (obligatorio)`);
      for (const p of d.propertiesNotSatisfied ?? []) leer(p.details, `${ruta}${p.propertyName}: `);
      if (d.additionalProperties) frases.push(`${ruta}campos que no están en el catálogo: ${d.additionalProperties.join(', ')}`);
      if (d.operatorName === 'pattern') frases.push(`${ruta}no cumple el patrón ${d.specifiedAs.pattern} (valor: ${JSON.stringify(d.consideredValue)})`);
      if (d.operatorName === 'enum') frases.push(`${ruta}tiene que ser uno de: ${d.specifiedAs.enum.join(', ')} (valor: ${JSON.stringify(d.consideredValue)})`);
      if (d.operatorName === 'bsonType') frases.push(`${ruta}tipo ${d.consideredType}, se esperaba ${[].concat(d.specifiedAs.bsonType).join(' o ')}`);
      if (d.operatorName === 'minLength') frases.push(`${ruta}no puede estar vacío`);
      // En un campo estable (anyOf: [tipo, null]) solo interesa por qué no cumple el tipo; el null no aplica.
      if (d.operatorName === 'anyOf') leer(d.schemasNotSatisfied?.[0]?.details, ruta);
    }
  };
  leer(reglas, '');
  return frases.length ? [...new Set(frases)] : [e.message];
}

export class Rechazo extends Error {
  constructor(errores) {
    super(errores.join('\n'));
    this.errores = errores;
  }
}

export async function crearManual(db, coleccion, doc) {
  const raiz = raizEditable(coleccion);
  if (!raiz) throw new Rechazo([`${coleccion} es de solo lectura en el panel`]);
  if (typeof doc?._id !== 'string') throw new Rechazo([`falta _id (texto, por ejemplo ${COLECCIONES[raiz].prefijo}-…)`]);
  const r = documentoManual(raiz, doc);
  if (r.errores.length) throw new Rechazo(r.errores);
  try {
    await db.collection(coleccion).insertOne({ _id: doc._id, ...anidar(r.valores)[raiz] });
  } catch (e) {
    throw new Rechazo(e.code === 11000 ? [`ya existe un documento con _id ${doc._id}`] : motivoValidador(e));
  }
}

export async function editarManual(db, coleccion, id, doc) {
  const raiz = raizEditable(coleccion);
  if (!raiz) throw new Rechazo([`${coleccion} es de solo lectura en el panel`]);
  if (doc?._id !== undefined && doc._id !== id) throw new Rechazo(['el _id no se cambia']);
  const anterior = await db.collection(coleccion).findOne({ _id: id });
  if (!anterior) throw new Rechazo([`no existe ${id}`]);
  const r = documentoManual(raiz, doc, anterior);
  if (r.errores.length) throw new Rechazo(r.errores);
  const cambio = { ...(Object.keys(r.$set).length && { $set: r.$set }), ...(Object.keys(r.$unset).length && { $unset: r.$unset }) };
  if (!Object.keys(cambio).length) return { cambiado: false };
  try {
    await db.collection(coleccion).updateOne({ _id: id }, cambio);
  } catch (e) {
    throw new Rechazo(motivoValidador(e));
  }
  return { cambiado: true };
}

// Borra solo si ningún otro documento apunta a este (proceso.id_negocio, corrida.id_version…).
export async function borrarManual(db, coleccion, id) {
  const raiz = raizEditable(coleccion);
  if (!raiz) throw new Rechazo([`${coleccion} es de solo lectura en el panel`]);
  const defs = cargar();
  for (const d of defs.filter((d) => referida(d) === raiz)) {
    const [r, ...ruta] = d.id.split('.');
    const n = await db.collection(COLECCIONES[r].nombre).countDocuments({ [ruta.join('.')]: id });
    if (n) throw new Rechazo([`no se borra: ${n} documento(s) de ${COLECCIONES[r].nombre} apuntan a ${id} por ${ruta.join('.')}`]);
  }
  const res = await db.collection(coleccion).deleteOne({ _id: id });
  if (!res.deletedCount) throw new Rechazo([`no existe ${id}`]);
}

export async function aprobar(db, idVersion, por) {
  const versiones = db.collection('versiones');
  const v = await versiones.findOne({ _id: idVersion });
  if (!v) throw new Error(`No existe la versión ${idVersion}`);
  if (v.estado !== 'borrador') throw new Error(`${idVersion} está ${v.estado}; solo se aprueba un borrador`);
  // La prueba hasta B tiene que ser posterior al último cambio de la versión (su última corrida guardada).
  const cambio = await db.collection('corridas').findOne({ id_version: idVersion, guardada: true }, { sort: { fecha: -1 } });
  const prueba = await db.collection('ejecuciones').findOne(
    { id_version: idVersion, modo: 'hasta_B', 'respuesta.estado': 'disponible', inicio: { $gt: cambio?.fecha ?? new Date(0) } },
    { sort: { inicio: -1 } },
  );
  if (!prueba) throw new Error(`${idVersion} no tiene ninguna ejecución que llegara a B después de su último cambio; pruébala con: npm run ejecutar -- --version ${idVersion}`);
  const proceso = await db.collection('procesos').findOne({ _id: v.id_proceso });
  if (proceso.id_version_activa) await versiones.updateOne({ _id: proceso.id_version_activa }, { $set: { estado: 'retirada' } });
  await versiones.updateOne({ _id: idVersion }, { $set: { estado: 'aprobada', aprobacion: { por, fecha: new Date() } } });
  await db.collection('procesos').updateOne({ _id: v.id_proceso }, { $set: { id_version_activa: idVersion } });
  return { prueba, anterior: proceso.id_version_activa ?? null };
}

const normalizar = (t) => t.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
const palabras = (t) => new Set(normalizar(t).split(/[^a-z0-9]+/).filter((p) => p.length > 2));

// Campos del catálogo que se parecen a una ruta propuesta: palabras en común con su id y su descripción.
export function parecidos(ruta, defs, n = 3) {
  const buscadas = palabras(ruta);
  return defs
    .map((d) => {
      const suyas = palabras(`${d.id} ${d.descripcion}`);
      return { id: d.id, puntos: [...buscadas].filter((p) => suyas.has(p)).length / buscadas.size };
    })
    .filter((p) => p.puntos > 0)
    .sort((a, b) => b.puntos - a.puntos)
    .slice(0, n);
}

export async function propuestas(db) {
  const grupos = new Map();
  for (const c of await db.collection('corridas').find({ 'propuestas.estado': 'pendiente' }).toArray()) {
    for (const p of c.propuestas.filter((p) => p.estado === 'pendiente')) {
      const g = grupos.get(p.ruta) ?? { ruta: p.ruta, veces: 0, negocios: new Set(), ejemplos: [] };
      g.veces++;
      if (c.id_negocio) g.negocios.add(c.id_negocio);
      if (g.ejemplos.length < 3) g.ejemplos.push({ valor: p.valor, corrida: c._id });
      grupos.set(p.ruta, g);
    }
  }
  return [...grupos.values()].sort((a, b) => b.veces - a.veces);
}

// ---------- Línea de órdenes ----------

function mostrar(r) {
  console.log(`\nPlantilla: ${r.meta.plantilla} v${r.meta.version_plantilla} · versión ${r.meta.id_version}`);
  console.log(`Explicación: ${r.explicacion.length} caracteres`);
  console.log(`\nValores válidos (${r.valores.length}):`);
  for (const { ruta, valor } of r.valores) {
    const t = valor instanceof Date ? valor.toISOString() : typeof valor === 'object' && valor ? JSON.stringify(valor) : String(valor);
    console.log(`  ${ruta} = ${t.length > 90 ? t.slice(0, 87).replace(/\s+/g, ' ') + '…' : t.replace(/\s+/g, ' ')}`);
  }
  if (r.alias?.length) console.log(`\nAlias resueltos: ${r.alias.map((x) => `${x.de} → ${x.a}`).join(', ')}`);
  console.log(`\nPropuestas (${r.propuestas.length}):`);
  for (const p of r.propuestas) console.log(`  ${p.ruta} = ${p.valor.slice(0, 80)}`);
  console.log(`\nErrores (${r.errores.length}):`);
  for (const e of r.errores) console.log(`  ✗ ${e}`);
}

const AYUDA = `Uso:
  npm run gestor -- preparar <plantilla> (--proceso proc-… | --version ver-…)
  npm run gestor -- leer <trabajo/base>        (lee <base>.entrada.md y <base>.respuesta.md)
  npm run gestor -- guardar <trabajo/base>
  npm run gestor -- propuestas
  npm run gestor -- aprobar <ver-…> [--por "Nombre"]`;

if (import.meta.main) {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { proceso: { type: 'string' }, version: { type: 'string' }, por: { type: 'string' } },
  });
  const [orden, arg] = positionals;
  const base = arg && resolve(arg.replace(/\.(entrada|respuesta)\.md$/, ''));
  try {
    if (orden === 'leer') {
      const r = leer(base);
      mostrar(r);
      process.exitCode = r.errores.length ? 1 : 0;
    } else if (['preparar', 'guardar', 'propuestas', 'aprobar'].includes(orden)) {
      const { conectar } = await import('./db.js');
      const { cliente, db } = await conectar();
      try {
        if (orden === 'preparar') {
          const b = await preparar(db, arg, values);
          console.log(`Entrada preparada: ${b}.entrada.md\nEl agente escribe su respuesta en:  ${b}.respuesta.md`);
        } else if (orden === 'guardar') {
          const r = await guardar(db, base);
          mostrar({ ...r, errores: r.corrida.errores });
          console.log(`\nCorrida ${r.corrida._id}: ${r.corrida.guardada ? 'valores GUARDADOS' : 'NO se guardó ningún valor (hay errores)'}.`);
          process.exitCode = r.corrida.guardada ? 0 : 1;
        } else if (orden === 'propuestas') {
          const grupos = await propuestas(db);
          const defs = cargar();
          if (!grupos.length) console.log('No hay propuestas pendientes.');
          for (const g of grupos) {
            console.log(`\n${g.ruta}  — ${g.veces} vez/veces en ${g.negocios.size} negocio(s)`);
            for (const e of g.ejemplos) console.log(`  ejemplo (${e.corrida}): ${e.valor.slice(0, 100)}`);
            const p = parecidos(g.ruta, defs);
            console.log(`  parecidos: ${p.length ? p.map((x) => `${x.id} (${Math.round(x.puntos * 100)}%)`).join(', ') : 'ninguno'}`);
          }
        } else {
          const por = values.por ?? userInfo().username;
          const r = await aprobar(db, arg, por);
          console.log(`${arg} aprobada por ${por} (prueba hasta B: ${r.prueba._id}).${r.anterior ? ` ${r.anterior} pasa a retirada.` : ''}`);
        }
      } finally {
        await cliente.close();
      }
    } else {
      console.log(AYUDA);
    }
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exitCode = 1;
  }
}
