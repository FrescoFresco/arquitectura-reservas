'use strict';

(function () {
  if (typeof React === 'undefined' || typeof ReactDOM === 'undefined') return;

  var e = React.createElement;
  var useState = React.useState;
  var NOMBRES_SKILL = {
    'mapear-recorrido': 'Mapear recorrido',
    'generar-script': 'Generar script',
    'descubrir-negocio': 'Descubrir negocio',
    'diagnosticar-alerta': 'Diagnosticar alerta'
  };

  function nombreSkill(id, mapa) {
    if (mapa && mapa[id]) return mapa[id];
    return NOMBRES_SKILL[id] || id;
  }

  function bsonDesdeTipo(tipo) {
    var t = String(tipo || '').toLowerCase();
    if (t === 'bool' || t === 'boolean') return 'bool';
    if (t === 'int' || t === 'integer' || t === 'long') return 'int';
    if (t === 'double' || t === 'number' || t === 'decimal') return 'double';
    if (t === 'date' || t === 'datetime') return 'date';
    if (t === 'object' || t === 'document') return 'object';
    if (t === 'array') return 'array';
    if (t === 'objectid') return 'objectId';
    return t || 'string';
  }

  function Fila(props) {
    return e('div', { className: 'ancla-ficha-fila' },
      e('dt', null, props.label),
      e('dd', null, props.children)
    );
  }

  function HashCopiable(props) {
    var full = typeof props.hash === 'string' ? props.hash.trim().toLowerCase() : '';
    if (!full) {
      return e(Fila, { label: 'Hash' }, '—');
    }
    return e(Fila, { label: 'Hash' },
      e('button', {
        type: 'button',
        className: 'hash-full-btn',
        title: 'Clic para copiar',
        'aria-label': 'Copiar hash',
        onClick: function (ev) {
          ev.preventDefault();
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(full).catch(function () {});
          }
        }
      }, e('code', { className: 'hash-full' }, full))
    );
  }

  function Pestanas(props) {
    var tab = props.tab;
    var setTab = props.setTab;
    var items = [
      { id: 'definicion', label: 'Definición' },
      { id: 'mongo', label: 'Mongo' },
      { id: 'skills', label: 'Skills' },
      { id: 'interno', label: 'Interno' }
    ];
    return e('div', { className: 'ancla-ficha-tabs', role: 'tablist', 'aria-label': 'Secciones del ancla' },
      items.map(function (item) {
        var selected = tab === item.id;
        return e('button', {
          type: 'button',
          key: item.id,
          role: 'tab',
          id: 'ancla-tab-' + item.id,
          className: 'ancla-ficha-tab' + (selected ? ' is-on' : ''),
          'aria-selected': selected ? 'true' : 'false',
          'aria-controls': 'ancla-panel-' + item.id,
          onClick: function () { setTab(item.id); }
        }, item.label);
      })
    );
  }

  function PanelDefinicion(props) {
    var c = props.campo;
    return e('dl', { className: 'ancla-ficha-dl', id: 'ancla-panel-definicion', role: 'tabpanel' },
      e(Fila, { label: 'Tipo' }, c.tipo ? e('code', null, c.tipo) : '—'),
      e(Fila, { label: 'Obligatorio' }, c.obligatorio ? 'Sí' : 'No'),
      e(Fila, { label: 'Formato' }, c.formato ? e('code', null, c.formato) : '—'),
      e(Fila, { label: 'Descripción' }, c.descripcion || '—'),
      e(Fila, { label: 'Ejemplo' }, c.ejemplo ? e('code', null, c.ejemplo) : '—')
    );
  }

  function PanelMongo(props) {
    var c = props.campo;
    var mongo = props.mongo || null;
    var coleccion = (mongo && mongo.coleccion) || c.coleccion || '';
    var clave = (mongo && mongo.clave) || c.claveMongo || '';
    var base = (mongo && mongo.baseDatos) || c.baseDatos || '';
    var bson = (mongo && mongo.bsonType) || bsonDesdeTipo(c.tipo);
    var completo = coleccion && clave ? coleccion + '.' + clave : (mongo && mongo.campo) || '—';
    return e('dl', { className: 'ancla-ficha-dl', id: 'ancla-panel-mongo', role: 'tabpanel' },
      e(Fila, { label: 'Base' }, base ? e('code', null, base) : '—'),
      e(Fila, { label: 'Colección' }, coleccion ? e('code', null, coleccion) : '—'),
      e(Fila, { label: 'Clave' }, clave ? e('code', null, clave) : '—'),
      e(Fila, { label: 'bsonType' }, bson ? e('code', null, bson) : '—'),
      e(Fila, { label: 'Campo completo' }, completo !== '—' ? e('code', { className: 'ancla-code' }, completo) : '—')
    );
  }

  function PanelSkills(props) {
    var skills = props.skills || [];
    var nombres = props.nombres || {};
    if (!skills.length) {
      return e('p', { className: 'ancla-ficha-vacio', id: 'ancla-panel-skills', role: 'tabpanel' },
        'Ninguna skill usa este ancla todavía.'
      );
    }
    return e('div', { className: 'ancla-ficha-skills', id: 'ancla-panel-skills', role: 'tabpanel' },
      skills.map(function (id) {
        return e('div', { className: 'ancla-skill-card', key: id },
          e('span', { className: 'ancla-skill-nombre' }, nombreSkill(id, nombres)),
          e('code', { className: 'ancla-skill-id' }, id)
        );
      })
    );
  }

  function PanelInterno(props) {
    var c = props.campo;
    return e('dl', { className: 'ancla-ficha-dl', id: 'ancla-panel-interno', role: 'tabpanel' },
      e(Fila, { label: 'Id' }, e('code', null, c.id || '—')),
      e(HashCopiable, { hash: c.hash })
    );
  }

  function Ficha(props) {
    var c = props.campo;
    var tabState = useState('definicion');
    var tab = tabState[0];
    var setTab = tabState[1];
    if (!c) {
      return e('div', { className: 'ancla-ficha' },
        e('div', { className: 'ancla-ficha-header' },
          e('div', { className: 'ancla-ficha-header-text' },
            e('h3', { className: 'ancla-ficha-titulo' }, 'Campo ancla')
          ),
          e('button', {
            type: 'button',
            className: 'icon-btn',
            'aria-label': 'Cerrar',
            onClick: props.onCerrar
          }, '×')
        ),
        e('p', { className: 'ancla-ficha-vacio ancla-ficha-body' }, props.mensaje || 'No está en el catálogo Campos ancla.')
      );
    }
    var skills = Array.isArray(c.skills) ? c.skills : [];
    return e('div', { className: 'ancla-ficha', role: 'document', 'aria-label': 'Ficha del campo ancla' },
      e('div', { className: 'ancla-ficha-header' },
        e('div', { className: 'ancla-ficha-header-text' },
          e('h3', { className: 'ancla-ficha-titulo' }, c.etiqueta || 'Campo ancla'),
          e('code', { className: 'ancla-ficha-codigo' }, c.ancla)
        ),
        e('button', {
          type: 'button',
          className: 'icon-btn',
          'aria-label': 'Cerrar',
          onClick: props.onCerrar
        }, '×')
      ),
      e(Pestanas, { tab: tab, setTab: setTab }),
      e('div', { className: 'ancla-ficha-body' },
        tab === 'definicion' ? e(PanelDefinicion, { campo: c }) : null,
        tab === 'mongo' ? e(PanelMongo, { campo: c, mongo: props.mongo }) : null,
        tab === 'skills' ? e(PanelSkills, { skills: skills, nombres: props.nombresSkill }) : null,
        tab === 'interno' ? e(PanelInterno, { campo: c }) : null
      ),
      c.origen === 'local'
        ? e('p', { className: 'origen ancla-ficha-local' }, 'En este navegador. No está en GitHub.')
        : null
    );
  }

  function IconoAncla() {
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
      e('circle', { cx: '12', cy: '5', r: '2.5' }),
      e('path', { d: 'M12 7.5v10.5' }),
      e('path', { d: 'M8 14c0 2.5 1.8 4.5 4 4.5s4-2 4-4.5' }),
      e('path', { d: 'M7 11h10' })
    );
  }

  function FilaLista(props) {
    var c = props.campo;
    var abierta = props.abierta;
    var titulo = c.etiqueta || c.ancla;
    function abrir() { props.onAbrir(c.id); }
    return e('div', {
      className: 'catalogo-fila' + (abierta ? ' is-open' : ''),
      role: 'listitem'
    },
      e('span', { className: 'catalogo-fila-icon', 'aria-hidden': 'true' }, e(IconoAncla)),
      e('button', {
        type: 'button',
        className: 'catalogo-fila-main',
        onClick: abrir,
        title: titulo
      },
        e('span', { className: 'catalogo-fila-titulo' }, titulo),
        e('code', { className: 'catalogo-fila-codigo' }, c.ancla)
      ),
      e('button', {
        type: 'button',
        className: 'catalogo-fila-abrir',
        onClick: abrir,
        'aria-label': 'Abrir ' + titulo
      },
        e('span', null, 'Abrir'),
        e('svg', {
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: '2',
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true'
        }, e('path', { d: 'M9 6l6 6-6 6' }))
      )
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
        'Cada fila es un campo ancla. Abrir muestra la ficha en un popup. Añadir ancla se queda en este navegador.'
      ),
      estado ? e('p', { className: 'estado', role: 'status' }, estado) : null,
      e('div', { className: 'catalogo-lista', role: 'list' },
        campos.map(function (c) {
          return e(FilaLista, {
            key: c.id,
            campo: c,
            abierta: !!(abierta && abierta.id === c.id),
            onAbrir: function (id) { bridge.abrirCampo(id); }
          });
        })
      )
    );
  }

  var gridRoot = null;
  var fichaRoot = null;

  function montarGrid(bridge) {
    var root = document.getElementById('campos-ancla-root');
    if (!root || !bridge) return;
    if (!gridRoot) gridRoot = ReactDOM.createRoot(root);
    gridRoot.render(e(CamposApp, { bridge: bridge }));
  }

  function mostrarFicha(campo, onCerrar, mensaje, extras) {
    var mount = document.getElementById('campo-ficha-mount');
    if (!mount) return;
    if (!fichaRoot) fichaRoot = ReactDOM.createRoot(mount);
    var opts = extras || {};
    fichaRoot.render(e(Ficha, {
      campo: campo || null,
      mensaje: mensaje,
      onCerrar: onCerrar,
      mongo: opts.mongo || null,
      nombresSkill: opts.nombresSkill || {}
    }));
  }

  function limpiarFicha() {
    var mount = document.getElementById('campo-ficha-mount');
    if (!mount || !fichaRoot) return;
    fichaRoot.render(null);
  }

  window.CamposAnclaUI = {
    montar: montarGrid,
    refrescar: function (bridge) { montarGrid(bridge); },
    mostrarFicha: mostrarFicha,
    limpiarFicha: limpiarFicha
  };
})();
