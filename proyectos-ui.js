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
    var partes = [];
    if (proy.id) partes.push(proy.id);
    if (proy.baseDatos) partes.push(proy.baseDatos);
    else if (proy.legacyNegocio) partes.push('negocio legado');
    partes.push(formatVersion(actual.numero, actual.fecha));
    if (actual.origen === 'local') partes.push('local');
    var nSkills = Array.isArray(proy.skills) ? proy.skills.length : 0;
    if (nSkills) partes.push(nSkills + (nSkills === 1 ? ' skill' : ' skills'));
    var secundario = partes.join(' · ');

    return e('button', {
      type: 'button',
      className: 'catalogo-fila' + (isOpen ? ' is-open' : ''),
      role: 'listitem',
      'data-accion': 'abrir',
      'data-id': proy.id,
      title: proy.descripcion || proy.nombre,
      'aria-label': 'Ver base de datos ' + proy.nombre,
      onClick: function () { props.onAbrir(proy.id); }
    },
      e('span', {
        className: 'catalogo-fila-icon',
        'aria-hidden': 'true',
        style: (typeof window !== 'undefined' && window.ColorEntidad)
          ? window.ColorEntidad.reactStyle(proy.color)
          : undefined
      }, e(IconoProyecto)),
      e('span', { className: 'catalogo-fila-main' },
        e('span', { className: 'catalogo-fila-titulo' }, proy.nombre),
        e('span', { className: 'catalogo-fila-codigo' }, secundario)
      ),
      e('span', { className: 'catalogo-fila-enlace', 'aria-hidden': 'true' }, e(IconoEnlace))
    );
  }

  function ProyectosApp(props) {
    var bridge = props.bridge;
    var embed = !!props.embed;
    var snapshot = bridge.getSnapshot();
    var proyectos = snapshot.proyectos || [];
    var ready = snapshot.ready;
    var indexError = snapshot.indexError;
    var abierta = snapshot.abierta;
    var emptyMsg = props.emptyMsg || 'No hay bases de datos.';

    var estado = '';
    if (!ready) estado = 'Cargando el índice…';
    else if (indexError) estado = 'No se pudo leer el índice compartido.';
    else if (!proyectos.length) estado = emptyMsg;

    return e('div', { className: 'proyectos-app' + (embed ? ' is-embed' : '') },
      embed ? null : e('div', { className: 'catalogo-toolbar' },
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
          e('span', null, 'Añadir base de datos')
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

  function IconoColeccion() {
    // Lucide: layers — mismo patrón icono de fila de catálogo
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

  function ColeccionFila(props) {
    var col = props.coleccion || {};
    var id = col.id || '—';
    var desc = col.descripcion || '';
    var n = props.nCampos;
    var secundario = desc || 'Colección';
    var clickable = typeof props.onAbrir === 'function';
    if (n != null) {
      secundario += (desc ? ' · ' : '') + n + (n === 1 ? ' campo' : ' campos');
    }
    var kids = [
      e('span', {
        className: 'catalogo-fila-icon',
        'aria-hidden': 'true',
        style: (typeof window !== 'undefined' && window.ColorEntidad)
          ? window.ColorEntidad.reactStyle(col.color)
          : undefined
      }, e(IconoColeccion)),
      e('span', { className: 'catalogo-fila-main' },
        e('span', { className: 'catalogo-fila-titulo' }, id),
        e('span', { className: 'catalogo-fila-codigo' }, secundario)
      )
    ];
    if (clickable) {
      kids.push(e('span', { className: 'catalogo-fila-enlace', 'aria-hidden': 'true' }, e(IconoEnlace)));
      return e('button', {
        type: 'button',
        className: 'catalogo-fila',
        role: 'listitem',
        title: desc || id,
        'aria-label': 'Abrir colección ' + id,
        onClick: function () { props.onAbrir(id); }
      }, kids);
    }
    // Sin ficha de colección aún: fila informativa (no navega a Campos).
    return e('div', {
      className: 'catalogo-fila catalogo-fila-static',
      role: 'listitem',
      title: desc || id
    }, kids);
  }

  function ColeccionesLista(props) {
    var cols = props.colecciones || [];
    var conteo = props.conteo || {};
    var emptyMsg = props.emptyMsg || 'Sin colecciones en esta base de datos.';
    if (!cols.length) {
      return e('p', { className: 'estado', role: 'status' }, emptyMsg);
    }
    return e('div', { className: 'catalogo-lista', role: 'list' },
      cols.map(function (col) {
        var id = col && col.id;
        return e(ColeccionFila, {
          key: id || Math.random(),
          coleccion: col,
          nCampos: id != null && conteo[id] != null ? conteo[id] : null,
          onAbrir: props.onAbrir
        });
      })
    );
  }

  var reactRoot = null;
  var coleccionesRoots = {};
  var listaRoots = {};

  function montar(bridge) {
    var root = document.getElementById('proyectos-root');
    if (!root || !bridge) return;
    if (!reactRoot) reactRoot = ReactDOM.createRoot(root);
    reactRoot.render(e(ProyectosApp, { bridge: bridge }));
  }

  /** Lista embebible (p. ej. pestaña Base de datos de una colección). Reutiliza ProyectoFila. */
  function montarLista(elOrId, bridge, opts) {
    opts = opts || {};
    var el = typeof elOrId === 'string' ? document.getElementById(elOrId) : elOrId;
    if (!el || !bridge) return;
    var key = el.id || 'proyectos-embed';
    if (!listaRoots[key]) listaRoots[key] = ReactDOM.createRoot(el);
    listaRoots[key].render(e(ProyectosApp, {
      bridge: bridge,
      embed: true,
      emptyMsg: opts.emptyMsg || 'Sin base de datos padre.'
    }));
  }

  /** Lista de colecciones con el mismo patrón catalogo-fila que Skills/Anclas/Agentes. */
  function montarColecciones(elOrId, opts) {
    opts = opts || {};
    var el = typeof elOrId === 'string' ? document.getElementById(elOrId) : elOrId;
    if (!el) return;
    var key = el.id || 'proy-colecciones';
    if (!coleccionesRoots[key]) coleccionesRoots[key] = ReactDOM.createRoot(el);
    coleccionesRoots[key].render(e(ColeccionesLista, {
      colecciones: opts.colecciones || [],
      conteo: opts.conteo || {},
      emptyMsg: opts.emptyMsg,
      onAbrir: opts.onAbrir || null
    }));
  }

  window.ProyectosUI = {
    montar: montar,
    refrescar: function (bridge) { montar(bridge); },
    montarLista: montarLista,
    montarColecciones: montarColecciones
  };
})();
