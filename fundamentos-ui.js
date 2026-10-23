'use strict';

(function () {
  if (typeof React === 'undefined' || typeof ReactDOM === 'undefined') return;

  var e = React.createElement;
  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  function formatVersion(numero, fecha) {
    var match = /^(\d{4})-(\d{2})-(\d{2})/.exec(fecha || '');
    if (!match) return 'v' + numero;
    var mes = MESES[Number(match[2]) - 1];
    if (!mes) return 'v' + numero;
    return 'v' + numero + ' · ' + Number(match[3]) + ' ' + mes;
  }

  function versionActual(item) {
    return item.versiones[item.versiones.length - 1];
  }

  function IconoFundamento() {
    // Lucide: book-open
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
      e('path', { d: 'M12 7v14' }),
      e('path', { d: 'M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z' })
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

  function FundamentoFila(props) {
    var item = props.item;
    var abierta = props.abierta;
    var actual = versionActual(item);
    var isOpen = abierta && abierta.id === item.id;
    var secundario = formatVersion(actual.numero, actual.fecha);
    if (actual.origen === 'local') secundario += ' · local';

    return e('button', {
      type: 'button',
      className: 'catalogo-fila' + (isOpen ? ' is-open' : ''),
      role: 'listitem',
      'data-accion': 'abrir',
      'data-id': item.id,
      title: item.descripcion || item.nombre,
      'aria-label': 'Ver fundamento ' + item.nombre,
      onClick: function () { props.onAbrir(item.id); }
    },
      e('span', Object.assign({
        className: 'catalogo-fila-icon',
        'aria-hidden': 'true'
      }, (typeof window !== 'undefined' && window.ColorEntidad && window.ColorEntidad.reactProps)
        ? window.ColorEntidad.reactProps(item.color)
        : {}), e(IconoFundamento)),
      e('span', { className: 'catalogo-fila-main' },
        e('span', { className: 'catalogo-fila-titulo' }, item.nombre),
        e('span', { className: 'catalogo-fila-codigo' }, secundario)
      ),
      e('span', { className: 'catalogo-fila-enlace', 'aria-hidden': 'true' }, e(IconoEnlace))
    );
  }

  function FundamentosApp(props) {
    var bridge = props.bridge;
    var snapshot = bridge.getSnapshot();
    var lista = snapshot.fundamentos || [];
    var ready = snapshot.ready;
    var indexError = snapshot.indexError;
    var abierta = snapshot.abierta;

    var estado = '';
    if (!ready) estado = 'Cargando el índice…';
    else if (indexError) estado = 'No se pudo leer el índice compartido.';
    else if (!lista.length) estado = 'No hay fundamentos.';

    return e('div', { className: 'fundamentos-app' },
      e('div', { className: 'catalogo-toolbar' },
        e('button', {
          type: 'button',
          className: 'btn primary btn-anadir',
          onClick: function () { bridge.añadirFundamento(); }
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
            e('path', { d: 'M12 7v14' }),
            e('path', { d: 'M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z' })
          ),
          e('span', null, 'Añadir fundamento')
        )
      ),
      estado ? e('p', { className: 'estado', role: 'status' }, estado) : null,
      e('div', { className: 'catalogo-lista', role: 'list' },
        lista.map(function (item) {
          return e(FundamentoFila, {
            key: item.id,
            item: item,
            abierta: abierta,
            onAbrir: function (id) { bridge.abrirFundamento(id); }
          });
        })
      )
    );
  }

  var reactRoot = null;

  function montar(bridge) {
    var root = document.getElementById('fundamentos-root');
    if (!root || !bridge) return;
    if (!reactRoot) reactRoot = ReactDOM.createRoot(root);
    reactRoot.render(e(FundamentosApp, { bridge: bridge }));
  }

  window.FundamentosUI = {
    montar: montar,
    refrescar: function (bridge) { montar(bridge); }
  };
})();
