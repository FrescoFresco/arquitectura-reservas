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

  function enmascararSiSensible(campo, valor) {
    if (!campo || !campo.sensible) return valor || '—';
    var v = String(valor || '');
    if (!v) return '—';
    return '••••••••';
  }

  function Pestanas(props) {
    var tab = props.tab;
    var setTab = props.setTab;
    var items = [
      { id: 'definicion', label: 'Definición' },
      { id: 'historial', label: 'Historial' },
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
    var aliases = Array.isArray(c.aliases) ? c.aliases : [];
    var ejemploMostrado = enmascararSiSensible(c, c.ejemplo);
    var valorMostrado = enmascararSiSensible(c, c.valorActual || c.valor_actual);
    return e('dl', { className: 'ancla-ficha-dl', id: 'ancla-panel-definicion', role: 'tabpanel' },
      e(Fila, { label: 'Tipo' }, c.tipo ? e('code', null, c.tipo) : '—'),
      e(Fila, { label: 'Obligatorio' }, c.obligatorio ? 'Sí' : 'No'),
      e(Fila, { label: 'Sensible' }, c.sensible ? 'Sí (enmascarado)' : 'No'),
      e(Fila, { label: 'Formato' }, c.formato ? e('code', null, c.formato) : '—'),
      e(Fila, { label: 'Descripción' }, c.descripcion || '—'),
      e(Fila, { label: 'Ejemplo' }, ejemploMostrado !== '—' ? e('code', null, ejemploMostrado) : '—'),
      e(Fila, { label: 'Valor actual' }, valorMostrado !== '—' ? e('code', null, valorMostrado) : '—'),
      e(Fila, { label: 'Aliases' },
        aliases.length
          ? e('span', { className: 'ancla-aliases' }, aliases.map(function (a, i) {
            return e('code', { key: a + i, className: 'ancla-alias-pill' }, a);
          }))
          : '—'
      )
    );
  }

  function PanelHistorial(props) {
    var c = props.campo;
    var obs = Array.isArray(c.observaciones) ? c.observaciones.slice().reverse() : [];
    if (!obs.length) {
      return e('p', { className: 'ancla-ficha-vacio', id: 'ancla-panel-historial', role: 'tabpanel' },
        'Sin observaciones todavía. Al actualizar desde extracción se hace append aquí.'
      );
    }
    return e('div', { className: 'ancla-historial', id: 'ancla-panel-historial', role: 'tabpanel' },
      obs.map(function (o, idx) {
        var valor = enmascararSiSensible(c, o.valor);
        return e('div', { className: 'ancla-historial-fila', key: (o.timestamp || '') + idx },
          e('time', { dateTime: o.timestamp || '' }, o.timestamp ? String(o.timestamp).replace('T', ' ').replace(/\.\d+Z$/, 'Z') : '—'),
          e('code', null, valor),
          o.url ? e('a', { href: o.url, target: '_blank', rel: 'noopener noreferrer', className: 'ancla-historial-url' }, o.url) : null
        );
      })
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

  function IconoEnlaceExterno() {
    // Lucide: external-link
    return e('svg', {
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

  function PanelSkills(props) {
    var skills = props.skills || [];
    var nombres = props.nombres || {};
    var onAbrirSkill = props.onAbrirSkill;
    if (!skills.length) {
      return e('p', { className: 'ancla-ficha-vacio', id: 'ancla-panel-skills', role: 'tabpanel' },
        'Ninguna skill usa este ancla todavía.'
      );
    }
    return e('div', { className: 'ancla-ficha-skills', id: 'ancla-panel-skills', role: 'tabpanel' },
      skills.map(function (id) {
        var nombre = nombreSkill(id, nombres);
        return e('button', {
          type: 'button',
          className: 'ancla-skill-card',
          key: id,
          title: 'Ver skill',
          'aria-label': 'Ver skill ' + nombre,
          onClick: function () {
            if (onAbrirSkill) onAbrirSkill(id);
          }
        },
          e('span', { className: 'ancla-skill-main' },
            e('span', { className: 'ancla-skill-nombre' }, nombre),
            e('code', { className: 'ancla-skill-id' }, id)
          ),
          e('span', { className: 'ancla-skill-enlace', 'aria-hidden': 'true' }, e(IconoEnlaceExterno))
        );
      })
    );
  }

  function PanelInterno(props) {
    var c = props.campo;
    var aliases = Array.isArray(c.aliases) ? c.aliases : [];
    return e('dl', { className: 'ancla-ficha-dl', id: 'ancla-panel-interno', role: 'tabpanel' },
      e(Fila, { label: 'Id' }, e('code', null, c.id || '—')),
      e(Fila, { label: 'Sensible' }, c.sensible ? 'true' : 'false'),
      e(Fila, { label: 'Aliases (JSON)' },
        aliases.length ? e('code', null, JSON.stringify(aliases)) : '[]'
      ),
      e(HashCopiable, { hash: c.hash })
    );
  }

  function IconoLapiz() {
    return e('svg', {
      viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '2',
      strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true'
    },
      e('path', { d: 'M12 20h9' }),
      e('path', { d: 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z' })
    );
  }

  function IconoPapelera() {
    return e('svg', {
      viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '2',
      strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true'
    },
      e('polyline', { points: '3 6 5 6 21 6' }),
      e('path', { d: 'M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6' }),
      e('path', { d: 'M10 11v6' }),
      e('path', { d: 'M14 11v6' }),
      e('path', { d: 'M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2' })
    );
  }

  function AccionesFicha(props) {
    var nodos = [];
    if (props.onEditar) {
      nodos.push(e('button', {
        key: 'editar',
        type: 'button',
        className: 'icon-btn',
        'aria-label': 'Editar ancla',
        title: 'Editar',
        onClick: props.onEditar
      }, e(IconoLapiz)));
    }
    if (props.onEliminar) {
      nodos.push(e('button', {
        key: 'eliminar',
        type: 'button',
        className: 'icon-btn',
        'aria-label': 'Eliminar ancla',
        title: 'Eliminar',
        onClick: props.onEliminar
      }, e(IconoPapelera)));
    }
    nodos.push(e('button', {
      key: 'cerrar',
      type: 'button',
      className: 'icon-btn',
      'aria-label': 'Cerrar',
      onClick: props.onCerrar
    }, '×'));
    return e('div', { className: 'ancla-ficha-acciones' }, nodos);
  }

  function Ficha(props) {
    var c = props.campo;
    var tabState = useState('definicion');
    var tab = tabState[0];
    var setTab = tabState[1];
    if (!c) {
      return e('div', { className: 'ancla-ficha' },
        e('div', { className: 'ancla-ficha-header' },
          e('span', { className: 'ficha-titulo-icon', 'aria-hidden': 'true' }, e(IconoAncla)),
          e('div', { className: 'ancla-ficha-header-text' },
            e('h3', { className: 'ancla-ficha-titulo' }, 'Campo ancla')
          ),
          e(AccionesFicha, { onCerrar: props.onCerrar })
        ),
        e('p', { className: 'ancla-ficha-vacio ancla-ficha-body' }, props.mensaje || 'No está en el catálogo Campos ancla.')
      );
    }
    var skills = Array.isArray(c.skills) ? c.skills : [];
    return e('div', { className: 'ancla-ficha', role: 'document', 'aria-label': 'Ficha del campo ancla' },
      e('div', { className: 'ancla-ficha-header' },
        e('span', { className: 'ficha-titulo-icon', 'aria-hidden': 'true' }, e(IconoAncla)),
        e('div', { className: 'ancla-ficha-header-text' },
          e('h3', { className: 'ancla-ficha-titulo' }, c.etiqueta || 'Campo ancla'),
          e('code', { className: 'ancla-ficha-codigo' }, c.ancla)
        ),
        e(AccionesFicha, {
          onCerrar: props.onCerrar,
          onEditar: props.onEditar,
          onEliminar: props.onEliminar
        })
      ),
      e(Pestanas, { tab: tab, setTab: setTab }),
      e('div', { className: 'ancla-ficha-body' },
        tab === 'definicion' ? e(PanelDefinicion, { campo: c }) : null,
        tab === 'historial' ? e(PanelHistorial, { campo: c }) : null,
        tab === 'mongo' ? e(PanelMongo, { campo: c, mongo: props.mongo }) : null,
        tab === 'skills' ? e(PanelSkills, {
          skills: skills,
          nombres: props.nombresSkill,
          onAbrirSkill: props.onAbrirSkill
        }) : null,
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

  function FilaLista(props) {
    var c = props.campo;
    var abierta = props.abierta;
    var titulo = c.etiqueta || c.ancla;
    return e('button', {
      type: 'button',
      className: 'catalogo-fila' + (abierta ? ' is-open' : ''),
      role: 'listitem',
      title: titulo,
      'aria-label': 'Abrir ' + titulo,
      onClick: function () { props.onAbrir(c.id); }
    },
      e('span', { className: 'catalogo-fila-icon', 'aria-hidden': 'true' }, e(IconoAncla)),
      e('span', { className: 'catalogo-fila-main' },
        e('span', { className: 'catalogo-fila-titulo' }, titulo),
        e('code', { className: 'catalogo-fila-codigo' }, c.ancla)
      ),
      e('span', { className: 'catalogo-fila-enlace', 'aria-hidden': 'true' }, e(IconoEnlace))
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
      e('div', { className: 'catalogo-toolbar' },
        e('button', {
          type: 'button',
          className: 'btn primary btn-anadir',
          onClick: function () { bridge.añadirCampo(); }
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
            e('circle', { cx: '12', cy: '5', r: '2.5' }),
            e('path', { d: 'M12 7.5v10.5' }),
            e('path', { d: 'M8 14c0 2.5 1.8 4.5 4 4.5s4-2 4-4.5' }),
            e('path', { d: 'M7 11h10' })
          ),
          e('span', null, 'Añadir ancla')
        )
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
      onEditar: opts.onEditar || null,
      onEliminar: opts.onEliminar || null,
      mongo: opts.mongo || null,
      nombresSkill: opts.nombresSkill || {},
      onAbrirSkill: opts.onAbrirSkill || null
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
