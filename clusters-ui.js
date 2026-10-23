'use strict';

(function () {
  if (typeof React === 'undefined' || typeof ReactDOM === 'undefined') return;

  var e = React.createElement;

  function IconoCluster() {
    // Lucide: server
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
      e('rect', { width: '20', height: '8', x: '2', y: '2', rx: '2', ry: '2' }),
      e('rect', { width: '20', height: '8', x: '2', y: '14', rx: '2', ry: '2' }),
      e('line', { x1: '6', x2: '6.01', y1: '6', y2: '6' }),
      e('line', { x1: '6', x2: '6.01', y1: '18', y2: '18' })
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

  function ClusterFila(props) {
    var cl = props.cluster || {};
    var abierta = props.abierta;
    var isOpen = abierta && abierta.id === cl.id;
    var nBd = Array.isArray(cl.proyectos) ? cl.proyectos.length : (cl.nProyectos || 0);
    var partes = [];
    if (cl.id) partes.push(cl.id);
    if (nBd) partes.push(nBd + (nBd === 1 ? ' base de datos' : ' bases de datos'));
    else partes.push('sin bases');
    var secundario = partes.join(' · ');

    return e('button', {
      type: 'button',
      className: 'catalogo-fila' + (isOpen ? ' is-open' : ''),
      role: 'listitem',
      'data-accion': 'abrir',
      'data-id': cl.id,
      title: cl.descripcion || cl.nombre,
      'aria-label': 'Ver cluster ' + cl.nombre,
      onClick: function () { props.onAbrir(cl.id); }
    },
      e('span', Object.assign({
        className: 'catalogo-fila-icon',
        'aria-hidden': 'true'
      }, (typeof window !== 'undefined' && window.ColorEntidad && window.ColorEntidad.reactProps)
        ? window.ColorEntidad.reactProps(cl.color)
        : {}), e(IconoCluster)),
      e('span', { className: 'catalogo-fila-main' },
        e('span', { className: 'catalogo-fila-titulo' }, cl.nombre),
        e('span', { className: 'catalogo-fila-codigo' }, secundario)
      ),
      e('span', { className: 'catalogo-fila-enlace', 'aria-hidden': 'true' }, e(IconoEnlace))
    );
  }

  function ClustersApp(props) {
    var bridge = props.bridge;
    var embed = !!props.embed;
    var snapshot = bridge.getSnapshot();
    var clusters = snapshot.clusters || [];
    var ready = snapshot.ready;
    var indexError = snapshot.indexError;
    var abierta = snapshot.abierta;
    var emptyMsg = props.emptyMsg || 'No hay clusters.';

    var estado = '';
    if (!ready) estado = 'Cargando el índice…';
    else if (indexError) estado = 'No se pudo leer el índice compartido.';
    else if (!clusters.length) estado = emptyMsg;

    return e('div', { className: 'clusters-app' + (embed ? ' is-embed' : '') },
      embed ? null : e('div', { className: 'catalogo-toolbar' },
        e('button', {
          type: 'button',
          className: 'btn primary btn-anadir',
          onClick: function () { bridge.añadirCluster(); }
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
            e('rect', { width: '20', height: '8', x: '2', y: '2', rx: '2', ry: '2' }),
            e('rect', { width: '20', height: '8', x: '2', y: '14', rx: '2', ry: '2' }),
            e('line', { x1: '6', x2: '6.01', y1: '6', y2: '6' }),
            e('line', { x1: '6', x2: '6.01', y1: '18', y2: '18' })
          ),
          e('span', null, 'Añadir cluster')
        )
      ),
      estado ? e('p', { className: 'estado', role: 'status' }, estado) : null,
      e('div', { className: 'catalogo-lista', role: 'list' },
        clusters.map(function (cl) {
          return e(ClusterFila, {
            key: cl.id,
            cluster: cl,
            abierta: abierta,
            onAbrir: function (id) { bridge.abrirCluster(id); }
          });
        })
      )
    );
  }

  var reactRoot = null;
  var listaRoots = {};

  function montar(bridge) {
    var root = document.getElementById('clusters-root');
    if (!root || !bridge) return;
    if (!reactRoot) reactRoot = ReactDOM.createRoot(root);
    reactRoot.render(e(ClustersApp, { bridge: bridge }));
  }

  function montarLista(elOrId, bridge, opts) {
    opts = opts || {};
    var el = typeof elOrId === 'string' ? document.getElementById(elOrId) : elOrId;
    if (!el || !bridge) return;
    var key = el.id || 'clusters-embed';
    if (!listaRoots[key]) listaRoots[key] = ReactDOM.createRoot(el);
    listaRoots[key].render(e(ClustersApp, {
      bridge: bridge,
      embed: true,
      emptyMsg: opts.emptyMsg || 'Sin cluster.'
    }));
  }

  window.ClustersUI = {
    montar: montar,
    refrescar: function (bridge) { montar(bridge); },
    montarLista: montarLista
  };
})();
