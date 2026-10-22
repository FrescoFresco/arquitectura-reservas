// npm run web: genera index.html, una página estática de solo lectura con lo que hay en el repositorio.
// Sin API, sin base de datos y sin formularios: todo sale de catalogo/, plantillas/, CLAUDE.md y docs/.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { cargar, COLECCIONES } from './catalogo.js';
import { validador, diagrama, rutaMongo } from './generador.js';

const RAIZ = new URL('../', import.meta.url);
const leer = (ruta) => readFileSync(new URL(ruta, RAIZ), 'utf8').replace(/\r\n/g, '\n');
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const code = (t) => `<code>${esc(t)}</code>`;
const tabla = (cabecera, filas) =>
  `<div class="tabla"><table><thead><tr>${cabecera.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${filas
    .map((f) => `<tr>${f.map((c) => `<td>${c}</td>`).join('')}</tr>`)
    .join('')}</tbody></table></div>`;
const tipo = (d) => (d.tipo === 'enum' ? `enum: ${d.valores.join(', ')}` : d.tipo);
const mongo = (d) => `${COLECCIONES[d.id.split('.')[0]].nombre}.${rutaMongo(d.id)}`;

// Sección «## Título» de un markdown, sin el título.
const seccion = (md, titulo) => {
  const m = md.match(new RegExp(`^## ${titulo}\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm'));
  if (!m) throw new Error(`No encuentro la sección «${titulo}»`);
  return m[1].trim();
};

// Ficha de cada base en el panel: clave (URI de Atlas), estado y las subpestañas Esquema y Datos.
const fichaPanel = (esquema) => `<div class="panel-ficha">
<div class="panel-fila"><label for="panel-base"><strong>Base de datos</strong></label><select id="panel-base"></select><input id="panel-nueva-base" placeholder="Otra base (nombre)" aria-label="Nombre de otra base"><button type="button" id="panel-anadir">Añadir</button></div>
<div class="panel-fila"><label for="panel-uri"><strong>Conexión (URI de Atlas)</strong></label><input id="panel-uri" type="password" autocomplete="off" spellcheck="false" placeholder="mongodb+srv://usuario:contraseña@cluster…/"><button type="button" id="panel-guardar">Guardar</button><button type="button" id="panel-probar">Probar</button><button type="button" id="panel-borrar">Borrar</button></div>
<div id="panel-avisos"></div><div id="panel-aviso-conexion"></div><div id="panel-estado"></div>
</div>
<div class="panel-sub"><button type="button" data-ir="datos" class="activo">Datos</button><button type="button" data-ir="esquema">Esquema</button></div>
<div data-sub="datos"><div id="panel-datos"></div></div>
<div data-sub="esquema" hidden>${esquema}</div>`;

const CSS_PANEL = `<style>
:root { --error: #b3261e; --aviso: #8a5a00; }
@media (prefers-color-scheme: dark) { :root { --error: #f28b82; --aviso: #f6c26b; } }
.panel-ficha, .panel-editor { background: var(--panel); border: 1px solid var(--borde); border-radius: 6px; padding: 12px; margin-bottom: 12px; }
.panel-fila { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 6px 0; }
.panel-fila input, #panel-base, textarea { font: inherit; padding: 5px 8px; border: 1px solid var(--borde); border-radius: 4px; background: var(--fondo); color: var(--texto); min-width: 0; }
#panel-uri, #panel-filtro { flex: 1 1 260px; font-family: ui-monospace, monospace; font-size: 13px; }
textarea { width: 100%; font: 12.5px/1.4 ui-monospace, monospace; }
button { font: inherit; padding: 5px 10px; border: 1px solid var(--borde); border-radius: 4px; background: var(--panel); color: var(--texto); cursor: pointer; }
button.activo { border-color: var(--acento); color: var(--acento); font-weight: 600; }
button.peligro { color: var(--error); }
button:disabled { opacity: 0.5; cursor: default; }
.panel-sub { display: flex; gap: 6px; margin: 12px 0; }
.panel-datos { display: grid; grid-template-columns: minmax(180px, 240px) 1fr; gap: 16px; }
@media (max-width: 700px) { .panel-datos { grid-template-columns: 1fr; } }
.panel-colecciones { list-style: none; padding: 0; margin: 0; }
.panel-colecciones li { margin-bottom: 6px; }
.panel-error { color: var(--error); }
.panel-ok { color: var(--acento); }
.panel-aviso { color: var(--aviso); }
.panel-ayuda { max-width: 860px; }
.panel-doc pre { max-height: 360px; }
</style>`;

export function pagina({ panel } = {}) {
  const orden = Object.keys(COLECCIONES);
  const defs = cargar().sort((a, b) => orden.indexOf(a.id.split('.')[0]) - orden.indexOf(b.id.split('.')[0]));
  const activos = defs.filter((d) => d.estado === 'activo');
  const plantillas = readdirSync(new URL('plantillas/', RAIZ))
    .filter((f) => f.endsWith('.md'))
    .map((f) => ({ nombre: f.replace(/\.md$/, ''), md: leer(`plantillas/${f}`).replace(/<!--[\s\S]*?-->\n?/g, '') }));
  const actores = [...plantillas.map((p) => p.nombre), ...new Set(defs.flatMap((d) => [...d.escribe, ...d.lee]))].filter(
    (a, i, todos) => todos.indexOf(a) === i,
  );

  const skills = plantillas
    .map((p) => {
      const lee = activos.filter((d) => d.lee.includes(p.nombre)).length;
      const escribe = activos.filter((d) => d.escribe.includes(p.nombre)).length;
      return `<details class="skill"><summary><strong>${esc(p.nombre)}</strong> · versión ${esc(p.md.match(/^## Versión\s+(\d+)/m)?.[1] ?? '?')} · lee ${lee} campos · escribe ${escribe}</summary><div class="md" data-md="${esc(p.md)}"></div></details>`;
    })
    .join('');

  const campos = tabla(
    ['Campo', 'Tipo', 'Nivel', 'MongoDB', 'Escribe', 'Lee', 'Sensible', 'Estado', 'Alias', 'Descripción'],
    defs.map((d) => [
      code(d.id),
      esc(tipo(d)),
      `<span class="nivel ${d.nivel}">${d.nivel}</span>`,
      code(mongo(d)),
      esc(d.escribe.join(', ')),
      esc(d.lee.join(', ')),
      d.sensible ? 'sí' : 'no',
      d.estado === 'obsoleto' ? `obsoleto → ${code(d.sustituido_por)}` : esc(d.estado),
      (d.alias ?? []).map(code).join(', '),
      esc(d.descripcion),
    ]),
  );

  const colecciones = Object.entries(COLECCIONES)
    .map(([raiz, c]) => {
      const suyos = defs.filter((d) => d.id.startsWith(raiz + '.'));
      return `<details><summary>${code(c.nombre)} · ids ${code(c.prefijo + '-…')} · ${suyos.length} campos, ${suyos.filter((d) => d.nivel === 'blindado').length} blindados</summary><pre>${esc(JSON.stringify({ $jsonSchema: validador(defs, raiz) }, null, 2))}</pre></details>`;
    })
    .join('');

  const agentes = tabla(
    ['Campo', ...actores.map(esc)],
    activos.map((d) => [
      code(d.id),
      ...actores.map((a) => [d.escribe.includes(a) && '<span class="escribe">escribe</span>', d.lee.includes(a) && 'lee'].filter(Boolean).join(' · ')),
    ]),
  );

  const fundamentos = seccion(leer('CLAUDE.md'), 'Principios');
  const documentacion = leer('docs/aprender-mongo.md').replace(/\]\(esquema\.md\)/g, '](#base-de-datos)');

  const pestanas = [
    ['skills', 'Skills', `<p class="nota">Las plantillas que sigue cada agente. Sus tablas «Entrada» y «Campos ancla» salen del catálogo.</p>${skills}`],
    ['campos-ancla', 'Campos ancla', `<p class="nota">El catálogo único: ${defs.length} campos. «MongoDB» es la ruta que se escribe en una consulta (colección.campo).</p>${campos}`],
    ['base-de-datos', 'Base de datos', ((esquema) => (panel ? fichaPanel(esquema) : esquema))(`<p class="nota">Cinco colecciones. Sus validadores los genera <code>npm run generar</code> desde el catálogo: blindado = obligatorio; estable = puede faltar o ser null; flexible = contenedor libre.</p>${colecciones}<h2>Diagrama</h2><div id="diagrama" class="diagrama" data-mermaid="${esc(diagrama(defs))}"></div>`)],
    ['agentes', 'Agentes', `<p class="nota">Qué skill (o parte del código) escribe y lee cada campo. Una plantilla solo puede escribir los campos que la nombran en «escribe»; el gestor rechaza el resto.</p>${agentes}`],
    ['fundamentos', 'Fundamentos', `<div class="md" data-md="${esc(fundamentos)}"></div>`],
    ['documentacion', 'Documentación', `<div class="md" data-md="${esc(documentacion)}"></div>`],
  ];

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${panel ? `<meta name="panel-token" content="${panel.token}">
` : ''}<title>Reservas: arquitectura</title>
<style>
:root { --fondo: #fbfbf9; --texto: #1d1f21; --suave: #5f6368; --borde: #dcdcd6; --panel: #ffffff; --acento: #2f6f4f; --codigo: #f1f1ec; }
@media (prefers-color-scheme: dark) { :root { --fondo: #16181a; --texto: #e6e6e3; --suave: #9aa0a6; --borde: #33363a; --panel: #1e2124; --acento: #7cc39b; --codigo: #262a2e; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--fondo); color: var(--texto); font: 15px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
header { padding: 20px 16px 0; max-width: 1200px; margin: 0 auto; }
h1 { margin: 0 0 4px; font-size: 22px; }
header p { margin: 0 0 14px; color: var(--suave); }
nav { display: flex; gap: 4px; overflow-x: auto; border-bottom: 1px solid var(--borde); }
nav a { padding: 8px 12px; color: var(--suave); text-decoration: none; border-bottom: 2px solid transparent; white-space: nowrap; }
nav a[aria-selected="true"] { color: var(--texto); border-color: var(--acento); font-weight: 600; }
main { max-width: 1200px; margin: 0 auto; padding: 16px; }
section[hidden] { display: none; }
.nota { color: var(--suave); margin-top: 0; }
.tabla { overflow-x: auto; border: 1px solid var(--borde); border-radius: 6px; background: var(--panel); }
table { border-collapse: collapse; width: 100%; font-size: 13.5px; }
th, td { text-align: left; vertical-align: top; padding: 6px 10px; border-bottom: 1px solid var(--borde); }
th { position: sticky; top: 0; background: var(--panel); white-space: nowrap; }
code { background: var(--codigo); padding: 1px 4px; border-radius: 4px; font-size: 12.5px; }
td code { white-space: nowrap; }
pre { background: var(--codigo); padding: 12px; border-radius: 6px; overflow-x: auto; font-size: 12.5px; }
pre code { padding: 0; background: none; }
details { border: 1px solid var(--borde); border-radius: 6px; background: var(--panel); margin-bottom: 8px; }
summary { cursor: pointer; padding: 10px 12px; }
details > :not(summary) { margin: 0 12px 12px; }
.nivel.blindado { color: var(--acento); font-weight: 600; }
.escribe { color: var(--acento); font-weight: 600; }
.md { max-width: 860px; }
.md table { margin: 8px 0; }
.diagrama { overflow-x: auto; background: var(--panel); border: 1px solid var(--borde); border-radius: 6px; padding: 12px; }
footer { max-width: 1200px; margin: 0 auto; padding: 0 16px 24px; color: var(--suave); font-size: 13px; }
</style>
${panel ? `${CSS_PANEL}
` : ''}</head>
<body>
<header>
<h1>Reservas: arquitectura</h1>
${panel ? '<p>Panel local: la web del repositorio y, en «Base de datos», tus datos de MongoDB. Solo en este ordenador.</p>' : '<p>Consulta de solo lectura, generada con <code>npm run web</code> a partir de los ficheros del repositorio.</p>'}
<nav role="tablist">${pestanas.map(([id, nombre]) => `<a role="tab" href="#${id}" aria-controls="${id}">${nombre}</a>`).join('')}</nav>
</header>
<main>${pestanas.map(([id, nombre, html]) => `<section id="${id}" role="tabpanel" aria-label="${nombre}" hidden>${html}</section>`).join('')}</main>
<footer>Catálogo: ${defs.length} campos en ${Object.keys(COLECCIONES).length} colecciones · Generada el ${new Date().toISOString().slice(0, 10)}</footer>
<script src="https://cdn.jsdelivr.net/npm/marked@15.0.6/marked.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js"></script>
<script>
for (const el of document.querySelectorAll('[data-md]')) el.innerHTML = marked.parse(el.dataset.md);
const oscuro = matchMedia('(prefers-color-scheme: dark)').matches;
mermaid.initialize({ startOnLoad: false, theme: oscuro ? 'dark' : 'default' });
const caja = document.getElementById('diagrama');
mermaid.render('diagrama-svg', caja.dataset.mermaid).then(({ svg }) => { caja.innerHTML = svg; });
function mostrar() {
  const id = (location.hash.slice(1) || 'skills');
  const existe = document.getElementById(id)?.matches('section') ? id : 'skills';
  for (const s of document.querySelectorAll('main > section')) s.hidden = s.id !== existe;
  for (const a of document.querySelectorAll('nav a')) a.setAttribute('aria-selected', a.getAttribute('href') === '#' + existe);
}
addEventListener('hashchange', mostrar);
mostrar();
</script>
${panel ? `<script>
${leer('src/panel-cliente.js')}</script>
` : ''}</body>
</html>
`;
}

if (import.meta.main) {
  writeFileSync(new URL('index.html', RAIZ), pagina());
  console.log('Web: index.html');
}
