'use strict';

(function () {
  if (typeof React === 'undefined' || typeof ReactDOM === 'undefined') return;

  var e = React.createElement;

  function IconoBot() {
    // Lucide: bot
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
      e('path', { d: 'M12 8V4H8' }),
      e('rect', { width: '16', height: '12', x: '4', y: '8', rx: '2' }),
      e('path', { d: 'M2 14h2' }),
      e('path', { d: 'M20 14h2' }),
      e('path', { d: 'M15 13v2' }),
      e('path', { d: 'M9 13v2' })
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

  function Avatar(props) {
    var nombre = props.nombre || '?';
    var foto = props.foto;
    var inicial = String(nombre).trim().charAt(0).toUpperCase() || '?';
    var colorProps = (typeof window !== 'undefined' && window.ColorEntidad && !foto && window.ColorEntidad.reactProps)
      ? window.ColorEntidad.reactProps(props.color)
      : (typeof window !== 'undefined' && window.ColorEntidad && !foto)
        ? { style: window.ColorEntidad.reactStyle(props.color) }
        : {};
    if (foto) {
      return e('span', { className: 'agente-avatar', 'aria-hidden': 'true' },
        e('img', { src: foto, alt: '', className: 'agente-avatar-img' })
      );
    }
    return e('span', Object.assign({
      className: 'agente-avatar agente-avatar-inicial',
      'aria-hidden': 'true'
    }, colorProps), inicial);
  }

  function AgenteFila(props) {
    var ag = props.agente;
    var abierta = props.abierta;
    var isOpen = abierta && abierta.id === ag.id;
    var enLinea = !!ag.enLinea;
    var estado = enLinea ? 'En línea' : 'Desconectado';

    return e('button', {
      type: 'button',
      className: 'catalogo-fila' + (isOpen ? ' is-open' : ''),
      role: 'listitem',
      'data-accion': 'abrir',
      'data-id': ag.id,
      title: ag.descripcion || ag.nombre,
      'aria-label': 'Ver agente ' + ag.nombre,
      onClick: function () { props.onAbrir(ag.id); }
    },
      e(Avatar, { nombre: ag.nombre, foto: ag.foto, color: ag.color }),
      e('span', { className: 'catalogo-fila-main' },
        e('span', { className: 'catalogo-fila-titulo' }, ag.nombre),
        e('span', { className: 'catalogo-fila-codigo agente-fila-meta' },
          e('span', {
            className: 'agente-estado' + (enLinea ? ' is-on' : ' is-off')
          }, estado),
          e('span', { className: 'agente-fila-sep' }, '·'),
          e('code', null, ag.id)
        )
      ),
      e('span', { className: 'catalogo-fila-enlace', 'aria-hidden': 'true' }, e(IconoEnlace))
    );
  }

  function AgentesApp(props) {
    var bridge = props.bridge;
    var embed = !!props.embed;
    var snapshot = bridge.getSnapshot();
    var agentes = snapshot.agentes || [];
    var ready = snapshot.ready;
    var indexError = snapshot.indexError;
    var abierta = snapshot.abierta;

    var syncLabel = snapshot.syncLabel || '';
    var emptyMsg = props.emptyMsg || 'No hay agentes. Da acceso con + Agente.';
    var estado = '';
    if (!ready) estado = 'Cargando el índice…';
    else if (indexError) estado = 'No se pudo leer el índice compartido.';
    else if (!agentes.length) estado = emptyMsg;

    return e('div', { className: 'agentes-app' + (embed ? ' is-embed' : '') },
      embed ? null : e('div', { className: 'catalogo-toolbar' },
        syncLabel
          ? e('span', { className: 'agentes-sync', 'aria-live': 'polite' }, syncLabel)
          : null,
        e('button', {
          type: 'button',
          className: 'btn primary btn-anadir',
          onClick: function () { bridge.darAcceso(); }
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
            e('path', { d: 'M12 8V4H8' }),
            e('rect', { width: '16', height: '12', x: '4', y: '8', rx: '2' }),
            e('path', { d: 'M2 14h2' }),
            e('path', { d: 'M20 14h2' }),
            e('path', { d: 'M15 13v2' }),
            e('path', { d: 'M9 13v2' })
          ),
          e('span', null, 'Agente')
        )
      ),
      estado
        ? e('div', {
            className: 'catalogo-vacio',
            role: 'status',
            key: 'vacio-' + estado,
            ref: function (node) {
              if (!node) return;
              var fn = typeof window !== 'undefined' && window.svgPestanaCatalogo;
              if (typeof fn !== 'function') {
                node.textContent = estado;
                return;
              }
              if (node.dataset.txt === estado && node.querySelector('.catalogo-fila-svg')) return;
              node.dataset.txt = estado;
              var tile = document.createElement('span');
              tile.className = 'catalogo-vacio-icon';
              tile.setAttribute('aria-hidden', 'true');
              var svg = fn('agente');
              svg.setAttribute('class', 'catalogo-fila-svg');
              tile.append(svg);
              var p = document.createElement('p');
              p.className = 'catalogo-vacio-texto';
              p.textContent = estado;
              node.replaceChildren(tile, p);
            }
          })
        : null,
      e('div', { className: 'catalogo-lista', role: 'list' },
        agentes.map(function (ag) {
          return e(AgenteFila, {
            key: ag.id,
            agente: ag,
            abierta: abierta,
            onAbrir: function (id) { bridge.abrirAgente(id); }
          });
        })
      )
    );
  }

  var reactRoot = null;
  var listaRoots = {};

  function montar(bridge) {
    var root = document.getElementById('agentes-root');
    if (!root || !bridge) return;
    if (!reactRoot) reactRoot = ReactDOM.createRoot(root);
    reactRoot.render(e(AgentesApp, { bridge: bridge }));
  }

  /** Lista embebible (pestaña Agentes de una Base de datos). Reutiliza AgenteFila. */
  function montarLista(elOrId, bridge, opts) {
    opts = opts || {};
    var el = typeof elOrId === 'string' ? document.getElementById(elOrId) : elOrId;
    if (!el || !bridge) return;
    var key = el.id || 'agentes-embed';
    if (!listaRoots[key]) listaRoots[key] = ReactDOM.createRoot(el);
    listaRoots[key].render(e(AgentesApp, {
      bridge: bridge,
      embed: true,
      emptyMsg: opts.emptyMsg || 'Ningún agente asignado.'
    }));
  }

  window.AgentesUI = {
    montar: montar,
    refrescar: function (bridge) { montar(bridge); },
    montarLista: montarLista
  };
})();
