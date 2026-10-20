'use strict';

(function () {
  if (typeof React === 'undefined' || typeof ReactDOM === 'undefined') return;

  var e = React.createElement;

  function Fila(props) {
    return e('div', { className: 'ancla-ficha-fila' },
      e('dt', null, props.label),
      e('dd', null, props.children)
    );
  }

  function Ficha(props) {
    var c = props.campo;
    if (!c) {
      return e('div', { className: 'ancla-ficha' },
        e('div', { className: 'ancla-ficha-top' },
          e('h3', { className: 'ancla-ficha-titulo' }, 'Campo MongoDB'),
          e('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Cerrar', onClick: props.onCerrar }, '×')
        ),
        e('p', { className: 'ancla-ficha-vacio' }, props.mensaje || 'No está en el catálogo Campos MongoDB.')
      );
    }
    return e('div', { className: 'ancla-ficha', role: 'document', 'aria-label': 'Ficha del campo MongoDB' },
      e('div', { className: 'ancla-ficha-top' },
        e('h3', { className: 'ancla-ficha-titulo' }, 'Campo MongoDB'),
        e('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Cerrar', onClick: props.onCerrar }, '×')
      ),
      e('dl', { className: 'ancla-ficha-dl' },
        e(Fila, { label: 'Campo' }, e('code', { className: 'ancla-code' }, c.campo || (c.coleccion + '.' + c.clave))),
        e(Fila, { label: 'Base' }, e('code', null, c.baseDatos || '—')),
        e(Fila, { label: 'Colección' }, e('code', null, c.coleccion || '—')),
        e(Fila, { label: 'Clave' }, e('code', null, c.clave || '—')),
        e(Fila, { label: 'bsonType' }, e('code', null, c.bsonType || '—')),
        e(Fila, { label: 'Obligatorio' }, c.obligatorio ? 'Sí' : 'No'),
        e(Fila, { label: 'Descripción' }, c.descripcion || '—'),
        e(Fila, { label: 'Enlazado a ancla' },
          c.ancla ? e('code', { className: 'ancla-code' }, c.ancla) : '—'
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
    var label = c.campo || (c.coleccion + '.' + c.clave);
    return e('button', {
      type: 'button',
      className: 'ancla-celda' + (abierta ? ' is-open' : ''),
      'aria-pressed': abierta ? 'true' : 'false',
      title: c.descripcion || label,
      onClick: function () { props.onAbrir(c.id); }
    }, e('code', null, label));
  }

  function MongoApp(props) {
    var bridge = props.bridge;
    var snap = bridge.getSnapshot();
    var campos = snap.campos || [];
    var abierta = snap.abierta;
    var ready = snap.ready;
    var indexError = snap.indexError;

    var estado = '';
    if (!ready) estado = 'Cargando el índice…';
    else if (indexError) estado = 'No se pudo leer el índice compartido.';
    else if (!campos.length) estado = 'No hay campos MongoDB.';

    return e('div', { className: 'campos-app' },
      e('div', { className: 'skills-toolbar' },
        e('button', {
          type: 'button',
          className: 'btn primary',
          onClick: function () { bridge.añadirCampo(); }
        }, '+ Añadir campo')
      ),
      e('p', { className: 'limite' },
        'Cada celda es un campo MongoDB (colección.clave). Al pulsarla se abre la ficha en un popup. Añadir campo se queda en este navegador.'
      ),
      estado ? e('p', { className: 'estado', role: 'status' }, estado) : null,
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
      )
    );
  }

  var gridRoot = null;
  var fichaRoot = null;

  function montarGrid(bridge) {
    var root = document.getElementById('campos-mongodb-root');
    if (!root || !bridge) return;
    if (!gridRoot) gridRoot = ReactDOM.createRoot(root);
    gridRoot.render(e(MongoApp, { bridge: bridge }));
  }

  function mostrarFicha(campo, onCerrar, mensaje) {
    var mount = document.getElementById('mongo-ficha-mount');
    if (!mount) return;
    if (!fichaRoot) fichaRoot = ReactDOM.createRoot(mount);
    fichaRoot.render(e(Ficha, { campo: campo || null, mensaje: mensaje, onCerrar: onCerrar }));
  }

  function limpiarFicha() {
    if (!fichaRoot) return;
    fichaRoot.render(null);
  }

  window.CamposMongoUI = {
    montar: montarGrid,
    refrescar: function (bridge) { montarGrid(bridge); },
    mostrarFicha: mostrarFicha,
    limpiarFicha: limpiarFicha
  };
})();
