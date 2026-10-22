'use strict';

(function () {
  if (typeof React === 'undefined' || typeof ReactDOM === 'undefined') return;

  var e = React.createElement;

  function IconoColeccion() {
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
      e('path', { d: 'M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z' }),
      e('path', { d: 'M2 12l8.58 3.91a2 2 0 0 0 1.66 0L21 12' }),
      e('path', { d: 'M2 17l8.58 3.91a2 2 0 0 0 1.66 0L21 17' })
    );
  }

  function IconoEnlace() {
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

  function ColeccionCatalogoFila(props) {
    var col = props.coleccion || {};
    var abierta = props.abierta;
    var isOpen = abierta && abierta.key === col.key;
    var partes = [];
    if (col.descripcion) partes.push(col.descripcion);
    var padre = col.proyectoNombre || col.proyectoId || '';
    if (col.baseDatos) {
      partes.push(padre ? (padre + ' · ' + col.baseDatos) : col.baseDatos);
    } else if (padre) {
      partes.push(padre);
    }
    if (col.nCampos != null) {
      partes.push(col.nCampos + (col.nCampos === 1 ? ' campo' : ' campos'));
    }
    var secundario = partes.length ? partes.join(' · ') : 'Colección';

    return e('button', {
      type: 'button',
      className: 'catalogo-fila' + (isOpen ? ' is-open' : ''),
      role: 'listitem',
      title: col.descripcion || col.id,
      'aria-label': 'Abrir colección ' + (col.id || ''),
      onClick: function () { props.onAbrir(col.key); }
    },
      e('span', { className: 'catalogo-fila-icon', 'aria-hidden': 'true' }, e(IconoColeccion)),
      e('span', { className: 'catalogo-fila-main' },
        e('span', { className: 'catalogo-fila-titulo' }, col.id || '—'),
        e('span', { className: 'catalogo-fila-codigo' }, secundario)
      ),
      e('span', { className: 'catalogo-fila-enlace', 'aria-hidden': 'true' }, e(IconoEnlace))
    );
  }

  function ColeccionesApp(props) {
    var bridge = props.bridge;
    var snap = bridge.getSnapshot();
    var colecciones = snap.colecciones || [];
    var ready = snap.ready;
    var indexError = snap.indexError;
    var abierta = snap.abierta;

    var estado = '';
    if (!ready) estado = 'Cargando el índice…';
    else if (indexError) estado = 'No se pudo leer el índice compartido.';
    else if (!colecciones.length) estado = 'No hay colecciones.';

    return e('div', { className: 'colecciones-app' },
      estado ? e('p', { className: 'estado', role: 'status' }, estado) : null,
      e('div', { className: 'catalogo-lista', role: 'list' },
        colecciones.map(function (col) {
          return e(ColeccionCatalogoFila, {
            key: col.key,
            coleccion: col,
            abierta: abierta,
            onAbrir: function (key) { bridge.abrirColeccion(key); }
          });
        })
      )
    );
  }

  var reactRoot = null;

  function montar(bridge) {
    var root = document.getElementById('colecciones-root');
    if (!root || !bridge) return;
    if (!reactRoot) reactRoot = ReactDOM.createRoot(root);
    reactRoot.render(e(ColeccionesApp, { bridge: bridge }));
  }

  window.ColeccionesUI = {
    montar: montar,
    refrescar: function (bridge) { montar(bridge); }
  };
})();
