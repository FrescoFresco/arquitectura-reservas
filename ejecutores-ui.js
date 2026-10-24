'use strict';

(function () {
  if (typeof React === 'undefined' || typeof ReactDOM === 'undefined') return;

  var e = React.createElement;

  function IconoEjecutor() {
    // Lucide: cog
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
      e('path', { d: 'M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z' }),
      e('path', { d: 'M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z' }),
      e('path', { d: 'M12 2v2' }),
      e('path', { d: 'M12 20v2' }),
      e('path', { d: 'm4.93 4.93 1.41 1.41' }),
      e('path', { d: 'm17.66 17.66 1.41 1.41' }),
      e('path', { d: 'M2 12h2' }),
      e('path', { d: 'M20 12h2' }),
      e('path', { d: 'm6.34 17.66-1.41 1.41' }),
      e('path', { d: 'm19.07 4.93-1.41 1.41' })
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

  function EjecutorFila(props) {
    var item = props.item;
    var abierta = props.abierta;
    var isOpen = abierta && abierta.id === item.id;
    var nSkills = Array.isArray(item.skills) ? item.skills.length : 0;
    var partes = [item.tipo || '—', 'v' + (item.version || 1)];
    if (nSkills) partes.push(nSkills + (nSkills === 1 ? ' skill' : ' skills'));
    if (item.activo === false) partes.push('inactivo');
    var secundario = partes.join(' · ');

    return e('button', {
      type: 'button',
      className: 'catalogo-fila' + (isOpen ? ' is-open' : ''),
      role: 'listitem',
      'data-accion': 'abrir',
      'data-id': item.id,
      title: item.nombre,
      'aria-label': 'Ver ejecutor ' + item.nombre,
      onClick: function () { props.onAbrir(item.id); }
    },
      e('span', Object.assign({
        className: 'catalogo-fila-icon',
        'aria-hidden': 'true'
      }, (typeof window !== 'undefined' && window.ColorEntidad && window.ColorEntidad.reactProps)
        ? window.ColorEntidad.reactProps(item.color)
        : {}), e(IconoEjecutor)),
      e('span', { className: 'catalogo-fila-main' },
        e('span', { className: 'catalogo-fila-titulo' }, item.nombre),
        e('span', { className: 'catalogo-fila-codigo' }, secundario)
      ),
      e('span', { className: 'catalogo-fila-enlace', 'aria-hidden': 'true' }, e(IconoEnlace))
    );
  }

  function EjecutoresApp(props) {
    var bridge = props.bridge;
    var embed = !!props.embed;
    var snapshot = bridge.getSnapshot();
    var lista = snapshot.ejecutores || [];
    var ready = snapshot.ready;
    var indexError = snapshot.indexError;
    var abierta = snapshot.abierta;
    var emptyMsg = props.emptyMsg || 'No hay ejecutores.';

    var estado = '';
    if (!ready) estado = 'Cargando el índice…';
    else if (indexError) estado = 'No se pudo leer el índice.';
    else if (!lista.length) estado = emptyMsg;

    return e('div', { className: 'ejecutores-app' + (embed ? ' is-embed' : '') },
      embed ? null : e('div', { className: 'catalogo-toolbar' },
        e('button', {
          type: 'button',
          className: 'btn primary btn-anadir',
          onClick: function () { bridge.añadirEjecutor(); }
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
            e('path', { d: 'M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z' }),
            e('path', { d: 'M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z' })
          ),
          e('span', null, 'Añadir ejecutor')
        )
      ),
      estado ? e('p', { className: 'estado', role: 'status' }, estado) : null,
      e('div', { className: 'catalogo-lista', role: 'list' },
        lista.map(function (item) {
          return e(EjecutorFila, {
            key: item.id,
            item: item,
            abierta: abierta,
            onAbrir: function (id) { bridge.abrirEjecutor(id); }
          });
        })
      )
    );
  }

  var reactRoot = null;
  var listaRoots = {};

  function montar(bridge) {
    var root = document.getElementById('ejecutores-root');
    if (!root || !bridge) return;
    if (!reactRoot) reactRoot = ReactDOM.createRoot(root);
    reactRoot.render(e(EjecutoresApp, { bridge: bridge }));
  }

  function montarLista(mountEl, bridge, opts) {
    if (!mountEl || !bridge) return;
    opts = opts || {};
    var key = mountEl.id || 'ej-lista';
    if (!listaRoots[key]) listaRoots[key] = ReactDOM.createRoot(mountEl);
    listaRoots[key].render(e(EjecutoresApp, {
      bridge: bridge,
      embed: true,
      emptyMsg: opts.emptyMsg
    }));
  }

  window.EjecutoresUI = {
    montar: montar,
    montarLista: montarLista,
    Fila: EjecutorFila
  };
})();
