// Parte de la web que solo existe cuando la sirve npm run panel: la clave de cada base y la pestaña «Datos».
// Todo lo que viene de MongoDB se pinta con textContent, nunca como HTML.
(() => {
  const token = document.querySelector('meta[name="panel-token"]').content;
  const $ = (sel) => document.querySelector(sel);
  const el = (tag, props = {}, ...hijos) => {
    const e = Object.assign(document.createElement(tag), props);
    e.append(...hijos.filter((h) => h != null && h !== false));
    return e;
  };
  const boton = (texto, alPulsar, clase = '') => el('button', { type: 'button', textContent: texto, className: clase, onclick: alPulsar });

  async function api(metodo, ruta, cuerpo) {
    const r = await fetch('/api' + ruta, {
      method: metodo,
      headers: { 'content-type': 'application/json', 'x-panel-token': token },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
    const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
    if (!r.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { detalles: j.detalles || [] });
    return j;
  }
  const rutaBase = () => '/bases/' + encodeURIComponent(estado.base);
  const rutaColeccion = () => `${rutaBase()}/colecciones/${encodeURIComponent(estado.coleccion.nombre)}`;
  const estado = { base: null, coleccion: null, pagina: 1, filtro: '{}', vista: 'documentos' };

  // Caja de avisos: un error con sus motivos (p. ej. lo que rechazó el validador) o un mensaje de éxito.
  function avisar(caja, e, ok) {
    caja.replaceChildren();
    if (ok) return caja.append(el('p', { className: 'panel-ok', textContent: ok }));
    caja.append(el('p', { className: 'panel-error', textContent: e.message }));
    if (e.detalles?.length) caja.append(el('ul', { className: 'panel-error' }, ...e.detalles.map((d) => el('li', { textContent: d }))));
  }

  // ---------- Ficha: base y clave ----------

  async function cargarBases(elegir) {
    const { bases, avisos } = await api('GET', '/bases');
    const nombres = bases.map((b) => b.nombre);
    if (elegir && !nombres.includes(elegir)) nombres.push(elegir);
    estado.base = elegir || (nombres.includes(estado.base) ? estado.base : nombres[0]) || null;
    $('#panel-base').replaceChildren(...nombres.map((n) => el('option', { value: n, textContent: n, selected: n === estado.base })));
    for (const id of ['#panel-guardar', '#panel-probar', '#panel-borrar']) $(id).disabled = !estado.base;
    $('#panel-avisos').replaceChildren(...avisos.map((a) => el('p', { className: 'panel-aviso', textContent: '⚠ ' + a })));
    await mostrarEstado();
  }

  async function mostrarEstado(dado) {
    const caja = $('#panel-estado');
    if (!estado.base) return caja.replaceChildren(el('p', { textContent: 'Añade una base de datos para empezar.' }));
    caja.replaceChildren(el('p', { textContent: 'Comprobando la conexión…' }));
    const s = dado ?? (await api('GET', `${rutaBase()}/estado`));
    const clave = s.origen === 'ficha' ? `propia, de esta ficha (${s.host})` : s.origen === '.env' ? `la de MONGODB_URI del .env (${s.host})` : 'ninguna';
    caja.replaceChildren(
      el('p', {}, el('strong', { textContent: 'Clave: ' }), clave),
      el('p', {}, el('strong', { textContent: 'Estado: ' }), s.conectado ? `conectado · base ${s.base} · MongoDB ${s.version}` : `sin conexión${s.error ? ` (${s.error})` : ''}`),
    );
    $('#panel-estado').dataset.conectado = s.conectado;
    if (s.conectado) await cargarColecciones();
    else $('#panel-datos').replaceChildren(el('p', { className: 'nota', textContent: 'Sin conexión: guarda o prueba la clave de esta base.' }));
  }

  async function conexion(metodo) {
    const caja = $('#panel-aviso-conexion');
    try {
      if (metodo === 'GET') {
        await mostrarEstado();
        return avisar(caja, null, 'Prueba hecha: el estado está debajo.');
      }
      if (metodo === 'DELETE' && !confirm(`¿Borrar la clave guardada de ${estado.base}? Si hay MONGODB_URI en .env, se usará esa.`)) return;
      await api(metodo, `${rutaBase()}/conexion`, metodo === 'POST' ? { uri: $('#panel-uri').value.trim() } : undefined);
      $('#panel-uri').value = '';
      avisar(caja, null, metodo === 'POST' ? 'Clave guardada en conexiones.local.json.' : 'Clave borrada.');
      await cargarBases(estado.base);
    } catch (e) {
      avisar(caja, e);
    }
  }

  // ---------- Datos: colecciones y documentos ----------

  async function cargarColecciones() {
    const caja = $('#panel-datos');
    try {
      const { colecciones } = await api('GET', `${rutaBase()}/colecciones`);
      const lista = el(
        'ul',
        { className: 'panel-colecciones' },
        ...colecciones.map((c) =>
          el('li', {}, boton(`${c.nombre} (${c.documentos})`, () => abrirColeccion(c), c.nombre === estado.coleccion?.nombre ? 'activo' : ''), el('span', { className: 'nota', textContent: c.editable ? ' editable' : ' solo lectura' })),
        ),
      );
      const ayuda = el('p', { className: 'nota panel-ayuda' },
        'Cómo se usa: pulsa una colección de la izquierda para ver sus documentos. Para filtrar, escribe JSON en «Filtro», por ejemplo ',
        el('code', { textContent: '{"nombre": "Rincón del Amazonas"}' }),
        ', y pulsa Buscar (o Enter). En las colecciones editables (negocios y procesos), «Nuevo documento» abre el editor con una plantilla; Guardar lo valida y lo crea.',
      );
      const derecha = el('div', { id: 'panel-coleccion' },
        el('p', { className: 'nota', textContent: colecciones.length ? '← Elige una colección para ver sus documentos.' : 'Esta base no tiene colecciones todavía: npm run generar crea las del catálogo con sus validadores.' }),
      );
      caja.replaceChildren(ayuda, el('div', { className: 'panel-datos' }, el('div', {}, el('h3', { textContent: 'Colecciones' }), lista), derecha));
      const actual = colecciones.find((c) => c.nombre === estado.coleccion?.nombre);
      if (actual) abrirColeccion(actual, true);
    } catch (e) {
      avisar(caja, e);
    }
  }

  function abrirColeccion(c, conservar) {
    if (!conservar) Object.assign(estado, { pagina: 1, filtro: '{}', vista: 'documentos' });
    estado.coleccion = c;
    for (const b of document.querySelectorAll('.panel-colecciones button')) b.classList.toggle('activo', b.textContent.startsWith(c.nombre + ' '));
    const filtro = el('input', { id: 'panel-filtro', value: estado.filtro, spellcheck: false, ariaLabel: 'Filtro en JSON' });
    filtro.onkeydown = (ev) => ev.key === 'Enter' && buscar();
    const buscar = () => ((estado.filtro = filtro.value.trim() || '{}'), (estado.pagina = 1), cargarDocumentos());
    $('#panel-coleccion').replaceChildren(
      el('h3', { textContent: `${c.nombre} · ${c.editable ? 'editable a través del gestor' : 'solo lectura'}` }),
      el('div', { className: 'panel-sub' }, boton('Documentos', () => vista('documentos')), boton('Validador e índices', () => vista('esquema'))),
      el('div', { id: 'panel-vista-documentos' },
        el('div', { className: 'panel-fila' }, el('label', { htmlFor: 'panel-filtro', textContent: 'Filtro (JSON) ' }), filtro, boton('Buscar', buscar), c.editable && boton('Nuevo documento', () => editor(null, c.nuevo))),
        el('div', { id: 'panel-aviso-datos' }),
        el('div', { id: 'panel-editor' }),
        el('div', { id: 'panel-documentos' }),
      ),
      el('div', { id: 'panel-vista-esquema', hidden: true }),
    );
    vista(estado.vista);
  }

  function vista(cual) {
    estado.vista = cual;
    $('#panel-vista-documentos').hidden = cual !== 'documentos';
    $('#panel-vista-esquema').hidden = cual !== 'esquema';
    for (const b of document.querySelectorAll('.panel-sub button')) b.classList.toggle('activo', (b.textContent === 'Documentos') === (cual === 'documentos'));
    if (cual === 'documentos') cargarDocumentos();
    else cargarEsquema();
  }

  async function cargarDocumentos() {
    const caja = $('#panel-documentos');
    try {
      const q = new URLSearchParams({ filtro: estado.filtro, pagina: estado.pagina });
      const r = await api('GET', `${rutaColeccion()}/documentos?${q}`);
      const paginas = Math.max(1, Math.ceil(r.total / r.porPagina));
      caja.replaceChildren(
        el('p', { className: 'nota', textContent: `${r.total} documento(s) · página ${r.pagina} de ${paginas}` }),
        ...r.documentos.map((d) => {
          const texto = JSON.stringify(d, null, 2);
          const resumen = JSON.stringify(Object.fromEntries(Object.entries(d).filter(([k]) => k !== '_id').slice(0, 3))).slice(0, 110);
          return el('details', { className: 'panel-doc' },
            el('summary', {}, el('code', { textContent: String(d._id?.$oid ?? d._id) }), el('span', { className: 'nota', textContent: ' ' + resumen })),
            el('pre', { textContent: texto }),
            estado.coleccion.editable && el('div', { className: 'panel-fila' }, boton('Editar', () => editor(d._id, d)), boton('Borrar', () => borrar(d._id), 'peligro')),
          );
        }),
        el('div', { className: 'panel-fila' },
          boton('← Anterior', () => (estado.pagina--, cargarDocumentos())),
          boton('Siguiente →', () => (estado.pagina++, cargarDocumentos())),
        ),
      );
      const [ant, sig] = caja.lastChild.children;
      ant.disabled = r.pagina <= 1;
      sig.disabled = r.pagina >= paginas;
    } catch (e) {
      avisar(caja, e);
    }
  }

  function editor(id, doc) {
    const caja = $('#panel-editor');
    $('#panel-aviso-datos').replaceChildren();
    const texto = el('textarea', { value: JSON.stringify(doc, null, 2), rows: 14, spellcheck: false, ariaLabel: 'Documento en JSON' });
    const aviso = el('div');
    const guardar = async () => {
      try {
        if (id === null) await api('POST', `${rutaColeccion()}/documentos`, { documento: texto.value });
        else await api('PUT', `${rutaColeccion()}/documentos/${encodeURIComponent(id)}`, { documento: texto.value });
        caja.replaceChildren();
        await cargarColecciones();
        avisar($('#panel-aviso-datos'), null, id === null ? 'Documento creado.' : 'Documento guardado.');
      } catch (e) {
        avisar(aviso, e);
      }
    };
    caja.replaceChildren(el('div', { className: 'panel-editor' },
      el('h4', { textContent: id === null ? 'Nuevo documento' : `Editar ${id}` }),
      el('p', { className: 'nota', textContent: 'Se valida contra el catálogo como un alta manual (teléfono E.164, URL sin datos personales, solo campos que escribe «manual») y después contra el validador de MongoDB.' }),
      texto, aviso,
      el('div', { className: 'panel-fila' }, boton('Guardar', guardar), boton('Cancelar', () => caja.replaceChildren())),
    ));
    texto.focus();
  }

  async function borrar(id) {
    const escrito = prompt(`Para borrar este documento escribe su _id:\n${id}`);
    if (escrito === null) return;
    try {
      await api('DELETE', `${rutaColeccion()}/documentos/${encodeURIComponent(id)}`, { confirmacion: escrito });
      await cargarColecciones();
      avisar($('#panel-aviso-datos'), null, `Borrado ${id}.`);
    } catch (e) {
      avisar($('#panel-aviso-datos'), e);
    }
  }

  async function cargarEsquema() {
    const caja = $('#panel-vista-esquema');
    try {
      const r = await api('GET', `${rutaColeccion()}/esquema`);
      caja.replaceChildren(
        el('h4', { textContent: 'Validador' }),
        r.validador ? el('pre', { textContent: JSON.stringify(r.validador, null, 2) }) : el('p', { className: 'nota', textContent: 'Esta colección no tiene validador.' }),
        el('h4', { textContent: 'Índices' }),
        el('ul', {}, ...r.indices.map((i) => el('li', {}, el('code', { textContent: i.name }), ' ', JSON.stringify(i.key), i.unique ? ' · único' : ''))),
      );
    } catch (e) {
      avisar(caja, e);
    }
  }

  // ---------- Arranque ----------

  $('#panel-base').onchange = (ev) => ((estado.base = ev.target.value), (estado.coleccion = null), mostrarEstado());
  $('#panel-anadir').onclick = () => {
    const nombre = $('#panel-nueva-base').value.trim();
    if (!/^[A-Za-z0-9_-]{1,63}$/.test(nombre)) return avisar($('#panel-aviso-conexion'), new Error('Nombre de base: letras, números, _ o -'));
    $('#panel-nueva-base').value = '';
    estado.coleccion = null;
    cargarBases(nombre);
  };
  $('#panel-guardar').onclick = () => conexion('POST');
  $('#panel-probar').onclick = () => conexion('GET');
  $('#panel-borrar').onclick = () => conexion('DELETE');
  for (const b of document.querySelectorAll('[data-ir]')) {
    b.onclick = () => {
      for (const p of document.querySelectorAll('[data-sub]')) p.hidden = p.dataset.sub !== b.dataset.ir;
      for (const x of document.querySelectorAll('[data-ir]')) x.classList.toggle('activo', x === b);
    };
  }
  cargarBases().catch((e) => avisar($('#panel-aviso-conexion'), e));
})();
