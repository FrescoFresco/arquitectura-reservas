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

  function versionActual(ins) {
    return ins.versiones[ins.versiones.length - 1];
  }

  function IconoSkill() {
    // Lucide: file-text (mismo tono que pestaña Skills)
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
      e('path', { d: 'M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z' }),
      e('polyline', { points: '14 2 14 8 20 8' }),
      e('line', { x1: '16', y1: '13', x2: '8', y2: '13' }),
      e('line', { x1: '16', y1: '17', x2: '8', y2: '17' }),
      e('line', { x1: '10', y1: '9', x2: '8', y2: '9' })
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

  function SkillFila(props) {
    var ins = props.ins;
    var abierta = props.abierta;
    var actual = versionActual(ins);
    var isOpen = abierta && abierta.id === ins.id;
    var secundario = formatVersion(actual.numero, actual.fecha);
    if (actual.origen === 'local') secundario += ' · local';

    return e('button', {
      type: 'button',
      className: 'catalogo-fila' + (isOpen ? ' is-open' : ''),
      role: 'listitem',
      'data-accion': 'abrir',
      'data-id': ins.id,
      title: ins.descripcion || ins.nombre,
      'aria-label': 'Ver skill ' + ins.nombre,
      onClick: function () { props.onAbrir(ins.id); }
    },
      e('span', Object.assign({
        className: 'catalogo-fila-icon',
        'aria-hidden': 'true'
      }, (typeof window !== 'undefined' && window.ColorEntidad && window.ColorEntidad.reactProps)
        ? window.ColorEntidad.reactProps(ins.color)
        : {}), e(IconoSkill)),
      e('span', { className: 'catalogo-fila-main' },
        e('span', { className: 'catalogo-fila-titulo' }, ins.nombre),
        e('span', { className: 'catalogo-fila-codigo' }, secundario)
      ),
      e('span', { className: 'catalogo-fila-enlace', 'aria-hidden': 'true' }, e(IconoEnlace))
    );
  }

  function SkillsApp(props) {
    var bridge = props.bridge;
    var embed = !!props.embed;
    var snapshot = bridge.getSnapshot();
    var skills = snapshot.instrucciones || [];
    var ready = snapshot.ready;
    var indexError = snapshot.indexError;
    var abierta = snapshot.abierta;
    var emptyMsg = props.emptyMsg || 'No hay skills.';

    var estado = '';
    if (!ready) estado = 'Cargando el índice…';
    else if (indexError) estado = 'No se pudo leer el índice compartido.';
    else if (!skills.length) estado = emptyMsg;

    return e('div', { className: 'skills-app' + (embed ? ' is-embed' : '') },
      embed ? null : e('div', { className: 'catalogo-toolbar' },
        e('button', {
          type: 'button',
          className: 'btn primary btn-anadir',
          onClick: function () { bridge.añadirSkill(); }
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
            e('path', { d: 'M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z' }),
            e('polyline', { points: '14 2 14 8 20 8' }),
            e('line', { x1: '16', y1: '13', x2: '8', y2: '13' }),
            e('line', { x1: '16', y1: '17', x2: '8', y2: '17' }),
            e('line', { x1: '10', y1: '9', x2: '8', y2: '9' })
          ),
          e('span', null, 'Añadir skill')
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
              var svg = fn('skills');
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
        skills.map(function (ins) {
          return e(SkillFila, {
            key: ins.id,
            ins: ins,
            abierta: abierta,
            onAbrir: function (id) { bridge.abrirSkill(id); }
          });
        })
      )
    );
  }

  var reactRoot = null;
  var listaRoots = {};

  function montar(bridge) {
    var root = document.getElementById('skills-root');
    if (!root || !bridge) return;
    if (!reactRoot) reactRoot = ReactDOM.createRoot(root);
    reactRoot.render(e(SkillsApp, { bridge: bridge }));
  }

  /** Lista embebible (p. ej. pestaña Skills de un ancla). Reutiliza SkillFila. */
  function montarLista(elOrId, bridge, opts) {
    opts = opts || {};
    var el = typeof elOrId === 'string' ? document.getElementById(elOrId) : elOrId;
    if (!el || !bridge) return;
    var key = el.id || 'skills-embed';
    if (!listaRoots[key]) listaRoots[key] = ReactDOM.createRoot(el);
    listaRoots[key].render(e(SkillsApp, {
      bridge: bridge,
      embed: true,
      emptyMsg: opts.emptyMsg || 'Ninguna skill usa este ancla todavía.'
    }));
  }

  window.SkillsUI = {
    montar: montar,
    refrescar: function (bridge) { montar(bridge); },
    montarLista: montarLista
  };
})();
