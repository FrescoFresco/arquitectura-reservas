'use strict';

(function () {
  if (typeof React === 'undefined' || typeof ReactDOM === 'undefined') return;

  var e = React.createElement;
  var NOMBRES_SKILL = {
    'mapear-recorrido': 'Mapear recorrido',
    'generar-script': 'Generar script',
    'descubrir-negocio': 'Descubrir negocio',
    'diagnosticar-alerta': 'Diagnosticar alerta'
  };

  function nombreSkill(id) {
    return NOMBRES_SKILL[id] || id;
  }

  function Fila(props) {
    return e('div', { className: 'ancla-ficha-fila' },
      e('dt', null, props.label),
      e('dd', null, props.children)
    );
  }

  function Ficha(props) {
    var c = props.campo;
    if (!c) return null;
    var skills = Array.isArray(c.skills) ? c.skills : [];
    return e('div', { className: 'ancla-ficha', role: 'dialog', 'aria-label': 'Ficha del campo ancla' },
      e('div', { className: 'ancla-ficha-top' },
        e('h3', { className: 'ancla-ficha-titulo' }, 'Campo ancla'),
        e('button', {
          type: 'button',
          className: 'icon-btn',
          'aria-label': 'Cerrar',
          onClick: props.onCerrar
        }, '×')
      ),
      e('dl', { className: 'ancla-ficha-dl' },
        e(Fila, { label: 'Ancla' }, e('code', { className: 'ancla-code' }, c.ancla)),
        e(Fila, { label: 'Etiqueta' }, c.etiqueta || '—'),
        e(Fila, { label: 'Clave Mongo' }, e('code', null, c.claveMongo || '—')),
        e(Fila, { label: 'Colección' }, e('code', null, c.coleccion || '—')),
        e(Fila, { label: 'Base de datos' }, e('code', null, c.baseDatos || '—')),
        e(Fila, { label: 'Tipo' }, c.tipo || '—'),
        e(Fila, { label: 'Obligatorio' }, c.obligatorio ? 'Sí' : 'No'),
        e(Fila, { label: 'Formato' }, c.formato ? e('code', null, c.formato) : '—'),
        e(Fila, { label: 'Descripción' }, c.descripcion || '—'),
        e(Fila, { label: 'Ejemplo' }, c.ejemplo ? e('code', null, c.ejemplo) : '—'),
        e(Fila, { label: 'Usado en skills' },
          skills.length
            ? e('div', { className: 'skill-anclas-list' },
              skills.map(function (id) {
                return e('span', { className: 'ancla-pill skill-pill', key: id }, nombreSkill(id));
              })
            )
            : '—'
        )
      ),
      c.origen === 'local'
        ? e('p', { className: 'origen' }, 'En este navegador. No está en GitHub.')
        : null
    );
  }

  function Celda(props) {
    var c = props.campo;
    var abierta = props.abierta;
    return e('button', {
      type: 'button',
      className: 'ancla-celda' + (abierta ? ' is-open' : ''),
      'aria-pressed': abierta ? 'true' : 'false',
      title: c.etiqueta || c.ancla,
      onClick: function () { props.onAbrir(c.id); }
    },
      e('code', null, c.ancla)
    );
  }

  function CamposApp(props) {
    var bridge = props.bridge;
    var snap = bridge.getSnapshot();
    var campos = snap.campos || [];
    var abierta = snap.abierta;
    var ready = snap.ready;
    var indexError = snap.indexError;

    var estado = '';
    if (!ready) estado = 'Cargando el índice…';
    else if (indexError) estado = 'No se pudo leer el índice compartido.';
    else if (!campos.length) estado = 'No hay campos ancla.';

    return e('div', { className: 'campos-app' },
      e('div', { className: 'skills-toolbar' },
        e('button', {
          type: 'button',
          className: 'btn primary',
          onClick: function () { bridge.añadirCampo(); }
        }, '+ Añadir ancla')
      ),
      e('p', { className: 'limite' },
        'Cada celda es un campo ancla. Al pulsarla se abre la ficha con el enlace a Mongo y las skills que lo usan. Añadir ancla se queda en este navegador.'
      ),
      estado ? e('p', { className: 'estado', role: 'status' }, estado) : null,
      e('div', { className: 'campos-layout' + (abierta ? ' is-open' : '') },
        e('div', { className: 'ancla-grid', role: 'list' },
          campos.map(function (c) {
            return e('div', { key: c.id, role: 'listitem', className: 'ancla-grid-item' },
              e(Celda, {
                campo: c,
                abierta: !!(abierta && abierta.id === c.id),
                onAbrir: function (id) { bridge.abrirCampo(id); }
              })
            );
          })
        ),
        abierta ? e(Ficha, {
          campo: abierta,
          onCerrar: function () { bridge.cerrarCampo(); }
        }) : null
      )
    );
  }

  var reactRoot = null;

  function montar(bridge) {
    var root = document.getElementById('campos-ancla-root');
    if (!root || !bridge) return;
    if (!reactRoot) reactRoot = ReactDOM.createRoot(root);
    reactRoot.render(e(CamposApp, { bridge: bridge }));
  }

  window.CamposAnclaUI = {
    montar: montar,
    refrescar: function (bridge) { montar(bridge); }
  };
})();
