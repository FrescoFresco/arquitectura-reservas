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

  function IconoSystemPrompt() {
    // Lucide: message-square
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
      e('path', { d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' })
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

  function SystemPromptFila(props) {
    var item = props.item;
    var abierta = props.abierta;
    var actual = versionActual(item);
    var isOpen = abierta && abierta.id === item.id;
    var partes = [formatVersion(actual.numero, actual.fecha)];
    var nSkills = Array.isArray(item.skills) ? item.skills.length : 0;
    if (nSkills) partes.push(nSkills + (nSkills === 1 ? ' skill' : ' skills'));
    if (actual.origen === 'local') partes.push('local');
    var secundario = partes.join(' · ');

    return e('button', {
      type: 'button',
      className: 'catalogo-fila' + (isOpen ? ' is-open' : ''),
      role: 'listitem',
      'data-accion': 'abrir',
      'data-id': item.id,
      title: item.descripcion || item.nombre,
      'aria-label': 'Ver system prompt ' + item.nombre,
      onClick: function () { props.onAbrir(item.id); }
    },
      e('span', Object.assign({
        className: 'catalogo-fila-icon',
        'aria-hidden': 'true'
      }, (typeof window !== 'undefined' && window.ColorEntidad && window.ColorEntidad.reactProps)
        ? window.ColorEntidad.reactProps(item.color)
        : {}), e(IconoSystemPrompt)),
      e('span', { className: 'catalogo-fila-main' },
        e('span', { className: 'catalogo-fila-titulo' }, item.nombre),
        e('span', { className: 'catalogo-fila-codigo' }, secundario)
      ),
      e('span', { className: 'catalogo-fila-enlace', 'aria-hidden': 'true' }, e(IconoEnlace))
    );
  }

  function SystemPromptsApp(props) {
    var bridge = props.bridge;
    var embed = !!props.embed;
    var snapshot = bridge.getSnapshot();
    var lista = snapshot.systemPrompts || [];
    var ready = snapshot.ready;
    var indexError = snapshot.indexError;
    var abierta = snapshot.abierta;
    var emptyMsg = props.emptyMsg || 'No hay system prompts.';

    var estado = '';
    if (!ready) estado = 'Cargando el índice…';
    else if (indexError) estado = 'No se pudo leer el índice compartido.';
    else if (!lista.length) estado = emptyMsg;

    return e('div', { className: 'system-prompts-app' + (embed ? ' is-embed' : '') },
      embed ? null : e('div', { className: 'catalogo-toolbar' },
        e('button', {
          type: 'button',
          className: 'btn primary btn-anadir',
          onClick: function () { bridge.añadirSystemPrompt(); }
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
            e('path', { d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' })
          ),
          e('span', null, 'Añadir system prompt')
        )
      ),
      estado ? e('p', { className: 'estado', role: 'status' }, estado) : null,
      e('div', { className: 'catalogo-lista', role: 'list' },
        lista.map(function (item) {
          return e(SystemPromptFila, {
            key: item.id,
            item: item,
            abierta: abierta,
            onAbrir: function (id) { bridge.abrirSystemPrompt(id); }
          });
        })
      )
    );
  }

  var reactRoot = null;
  var listaRoots = {};

  function montar(bridge) {
    var root = document.getElementById('system-prompts-root');
    if (!root || !bridge) return;
    if (!reactRoot) reactRoot = ReactDOM.createRoot(root);
    reactRoot.render(e(SystemPromptsApp, { bridge: bridge }));
  }

  function montarLista(elOrId, bridge, opts) {
    opts = opts || {};
    var el = typeof elOrId === 'string' ? document.getElementById(elOrId) : elOrId;
    if (!el || !bridge) return;
    var key = el.id || 'system-prompts-embed';
    if (!listaRoots[key]) listaRoots[key] = ReactDOM.createRoot(el);
    listaRoots[key].render(e(SystemPromptsApp, {
      bridge: bridge,
      embed: true,
      emptyMsg: opts.emptyMsg || 'Ningún system prompt asociado.'
    }));
  }

  window.SystemPromptsUI = {
    montar: montar,
    refrescar: function (bridge) { montar(bridge); },
    montarLista: montarLista
  };
})();
