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

  function versionActual(proy) {
    return proy.versiones[proy.versiones.length - 1];
  }

  function IconoProyecto() {
    // Lucide: folder
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
      e('path', { d: 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9l-.81-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z' })
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

  function ProyectoFila(props) {
    var proy = props.proy;
    var abierta = props.abierta;
    var actual = versionActual(proy);
    var isOpen = abierta && abierta.id === proy.id;
    var secundario = formatVersion(actual.numero, actual.fecha);
    if (actual.origen === 'local') secundario += ' · local';
    if (proy.baseDatos) secundario += ' · ' + proy.baseDatos;
    else if (proy.legacyNegocio) secundario += ' · negocio legado';
    var nSkills = Array.isArray(proy.skills) ? proy.skills.length : 0;
    if (nSkills) secundario += ' · ' + nSkills + (nSkills === 1 ? ' skill' : ' skills');

    return e('button', {
      type: 'button',
      className: 'catalogo-fila' + (isOpen ? ' is-open' : ''),
      role: 'listitem',
      'data-accion': 'abrir',
      'data-id': proy.id,
      title: proy.descripcion || proy.nombre,
      'aria-label': 'Ver esquema ' + proy.nombre,
      onClick: function () { props.onAbrir(proy.id); }
    },
      e('span', { className: 'catalogo-fila-icon', 'aria-hidden': 'true' }, e(IconoProyecto)),
      e('span', { className: 'catalogo-fila-main' },
        e('span', { className: 'catalogo-fila-titulo' }, proy.nombre),
        e('span', { className: 'catalogo-fila-codigo' }, secundario)
      ),
      e('span', { className: 'catalogo-fila-enlace', 'aria-hidden': 'true' }, e(IconoEnlace))
    );
  }

  function ProyectosApp(props) {
    var bridge = props.bridge;
    var snapshot = bridge.getSnapshot();
    var proyectos = snapshot.proyectos || [];
    var ready = snapshot.ready;
    var indexError = snapshot.indexError;
    var abierta = snapshot.abierta;

    var estado = '';
    if (!ready) estado = 'Cargando el índice…';
    else if (indexError) estado = 'No se pudo leer el índice compartido.';
    else if (!proyectos.length) estado = 'No hay esquemas de BD.';

    return e('div', { className: 'proyectos-app' },
      e('div', { className: 'catalogo-toolbar' },
        e('button', {
          type: 'button',
          className: 'btn primary btn-anadir',
          onClick: function () { bridge.añadirProyecto(); }
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
            e('path', { d: 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9l-.81-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z' })
          ),
          e('span', null, 'Añadir esquema')
        )
      ),
      estado ? e('p', { className: 'estado', role: 'status' }, estado) : null,
      e('div', { className: 'catalogo-lista', role: 'list' },
        proyectos.map(function (proy) {
          return e(ProyectoFila, {
            key: proy.id,
            proy: proy,
            abierta: abierta,
            onAbrir: function (id) { bridge.abrirProyecto(id); }
          });
        })
      )
    );
  }

  var reactRoot = null;

  function montar(bridge) {
    var root = document.getElementById('proyectos-root');
    if (!root || !bridge) return;
    if (!reactRoot) reactRoot = ReactDOM.createRoot(root);
    reactRoot.render(e(ProyectosApp, { bridge: bridge }));
  }

  window.ProyectosUI = {
    montar: montar,
    refrescar: function (bridge) { montar(bridge); }
  };
})();
