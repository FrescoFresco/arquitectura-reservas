'use strict';

(function () {
  if (typeof React === 'undefined' || typeof ReactDOM === 'undefined') return;

  var e = React.createElement;
  var useState = React.useState;

  function Fila(props) {
    return e('div', { className: 'ancla-ficha-fila' },
      e('dt', null, props.label),
      e('dd', null, props.children)
    );
  }

  function HashCopiable(props) {
    var full = typeof props.hash === 'string' ? props.hash.trim().toLowerCase() : '';
    if (!full) return e(Fila, { label: 'Hash' }, '—');
    return e(Fila, { label: 'Hash' },
      e('button', {
        type: 'button',
        className: 'hash-full-btn',
        title: 'Clic para copiar',
        'aria-label': 'Copiar hash',
        onClick: function (ev) {
          ev.preventDefault();
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(full).catch(function () {});
          }
        }
      }, e('code', { className: 'hash-full' }, full))
    );
  }

  function Pestanas(props) {
    var tab = props.tab;
    var setTab = props.setTab;
    var items = [
      { id: 'definicion', label: 'Definición' },
      { id: 'interno', label: 'Interno' }
    ];
    return e('div', { className: 'ancla-ficha-tabs', role: 'tablist', 'aria-label': 'Secciones del campo MongoDB' },
      items.map(function (item) {
        var selected = tab === item.id;
        return e('button', {
          type: 'button',
          key: item.id,
          role: 'tab',
          className: 'ancla-ficha-tab' + (selected ? ' is-on' : ''),
          'aria-selected': selected ? 'true' : 'false',
          onClick: function () { setTab(item.id); }
        }, item.label);
      })
    );
  }

  function Ficha(props) {
    var c = props.campo;
    var tabState = useState('definicion');
    var tab = tabState[0];
    var setTab = tabState[1];
    if (!c) {
      return e('div', { className: 'ancla-ficha' },
        e('div', { className: 'ancla-ficha-header' },
          e('div', { className: 'ancla-ficha-header-text' },
            e('h3', { className: 'ancla-ficha-titulo' }, 'Campo MongoDB')
          ),
          e('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Cerrar', onClick: props.onCerrar }, '×')
        ),
        e('p', { className: 'ancla-ficha-vacio ancla-ficha-body' }, props.mensaje || 'No está en el catálogo Campos MongoDB.')
      );
    }
    var label = c.campo || (c.coleccion + '.' + c.clave);
    return e('div', { className: 'ancla-ficha', role: 'document', 'aria-label': 'Ficha del campo MongoDB' },
      e('div', { className: 'ancla-ficha-header' },
        e('div', { className: 'ancla-ficha-header-text' },
          e('h3', { className: 'ancla-ficha-titulo' }, label),
          c.ancla ? e('code', { className: 'ancla-ficha-codigo' }, c.ancla) : null
        ),
        e('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Cerrar', onClick: props.onCerrar }, '×')
      ),
      e(Pestanas, { tab: tab, setTab: setTab }),
      e('div', { className: 'ancla-ficha-body' },
        tab === 'definicion'
          ? e('dl', { className: 'ancla-ficha-dl', role: 'tabpanel' },
            e(Fila, { label: 'Base' }, e('code', null, c.baseDatos || '—')),
            e(Fila, { label: 'Colección' }, e('code', null, c.coleccion || '—')),
            e(Fila, { label: 'Clave' }, e('code', null, c.clave || '—')),
            e(Fila, { label: 'bsonType' }, e('code', null, c.bsonType || '—')),
            e(Fila, { label: 'Obligatorio' }, c.obligatorio ? 'Sí' : 'No'),
            e(Fila, { label: 'Descripción' }, c.descripcion || '—'),
            e(Fila, { label: 'Enlazado a ancla' },
              c.ancla ? e('code', { className: 'ancla-code' }, c.ancla) : '—'
            )
          )
          : e('dl', { className: 'ancla-ficha-dl', role: 'tabpanel' },
            e(Fila, { label: 'Id' }, e('code', null, c.id || '—')),
            e(HashCopiable, { hash: c.hash })
          )
      ),
      c.origen === 'local'
        ? e('p', { className: 'origen ancla-ficha-local' }, 'En este navegador. No está en GitHub.')
        : null
    );
  }

  function etiquetaMongo(c) {
    var clave = String(c.clave || '').trim();
    if (clave) {
      return clave.split(/[._]/).filter(Boolean).map(function (p) {
        if (p.length === 1) return p.toUpperCase();
        return p.charAt(0).toUpperCase() + p.slice(1);
      }).join(' ');
    }
    return c.campo || c.id || 'Campo';
  }

  function IconoMongo() {
    return e('svg', {
      className: 'catalogo-fila-svg',
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: '2',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': 'true'
    },
      e('ellipse', { cx: '12', cy: '6', rx: '7', ry: '3' }),
      e('path', { d: 'M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6' }),
      e('path', { d: 'M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6' })
    );
  }

  function IconoEnlace() {
    // Lucide: external-link
    return e('svg', {
      className: 'catalogo-fila-enlace-svg',
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: '2',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': 'true'
    },
      e('path', { d: 'M15 3h6v6' }),
      e('path', { d: 'M10 14L21 3' }),
      e('path', { d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' })
    );
  }

  function FilaLista(props) {
    var c = props.campo;
    var abierta = props.abierta;
    var codigo = c.campo || ((c.coleccion || '') + '.' + (c.clave || ''));
    var titulo = etiquetaMongo(c);
    return e('button', {
      type: 'button',
      className: 'catalogo-fila' + (abierta ? ' is-open' : ''),
      role: 'listitem',
      title: c.descripcion || titulo,
      'aria-label': 'Abrir ' + titulo,
      onClick: function () { props.onAbrir(c.id); }
    },
      e('span', { className: 'catalogo-fila-icon', 'aria-hidden': 'true' }, e(IconoMongo)),
      e('span', { className: 'catalogo-fila-main' },
        e('span', { className: 'catalogo-fila-titulo' }, titulo),
        e('code', { className: 'catalogo-fila-codigo' }, codigo)
      ),
      e('span', { className: 'catalogo-fila-enlace', 'aria-hidden': 'true' }, e(IconoEnlace))
    );
  }

  function MongoApp(props) {
    var bridge = props.bridge;
    var snap = bridge.getSnapshot();
    var campos = snap.campos || [];
    var abierta = snap.abierta;
    var ready = snap.ready;
    var indexError = snap.indexError;

    var estado = '';
    if (!ready) estado = 'Cargando el índice…';
    else if (indexError) estado = 'No se pudo leer el índice compartido.';
    else if (!campos.length) estado = 'No hay campos MongoDB.';

    return e('div', { className: 'campos-app' },
      e('div', { className: 'catalogo-toolbar' },
        e('button', {
          type: 'button',
          className: 'btn primary btn-anadir',
          onClick: function () { bridge.añadirCampo(); }
        },
          e('span', { className: 'btn-anadir-plus', 'aria-hidden': 'true' }, '+'),
          e('svg', {
            className: 'btn-anadir-svg',
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: '2',
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            'aria-hidden': 'true'
          },
            e('ellipse', { cx: '12', cy: '6', rx: '7', ry: '3' }),
            e('path', { d: 'M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6' }),
            e('path', { d: 'M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6' })
          ),
          e('span', null, 'Añadir campo')
        )
      ),
      estado ? e('p', { className: 'estado', role: 'status' }, estado) : null,
      e('div', { className: 'catalogo-lista', role: 'list' },
        campos.map(function (c) {
          return e(FilaLista, {
            key: c.id,
            campo: c,
            abierta: !!(abierta && abierta.id === c.id),
            onAbrir: function (id) { bridge.abrirCampo(id); }
          });
        })
      )
    );
  }

  var gridRoot = null;
  var fichaRoot = null;

  function montarGrid(bridge) {
    var root = document.getElementById('campos-mongodb-root');
    if (!root || !bridge) return;
    if (!gridRoot) gridRoot = ReactDOM.createRoot(root);
    gridRoot.render(e(MongoApp, { bridge: bridge }));
  }

  function mostrarFicha(campo, onCerrar, mensaje) {
    var mount = document.getElementById('mongo-ficha-mount');
    if (!mount) return;
    if (!fichaRoot) fichaRoot = ReactDOM.createRoot(mount);
    fichaRoot.render(e(Ficha, { campo: campo || null, mensaje: mensaje, onCerrar: onCerrar }));
  }

  function limpiarFicha() {
    if (!fichaRoot) return;
    fichaRoot.render(null);
  }

  window.CamposMongoUI = {
    montar: montarGrid,
    refrescar: function (bridge) { montarGrid(bridge); },
    mostrarFicha: mostrarFicha,
    limpiarFicha: limpiarFicha
  };
})();
