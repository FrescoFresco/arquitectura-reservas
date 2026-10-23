'use strict';

(function () {
  if (typeof React === 'undefined' || typeof ReactDOM === 'undefined') return;

  var e = React.createElement;
  var useState = React.useState;

  function Fila(props) {
    return e('div', { className: 'ancla-ficha-fila' },
      e('dt', null, props.label),
      e('dd', null, props.children)
    );
  }

  function HashCopiable(props) {
    var full = typeof props.hash === 'string' ? props.hash.trim().toLowerCase() : '';
    if (!full) return e(Fila, { label: 'Hash' }, '—');
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

  function IconoPestanaFicha(props) {
    return e('span', {
      className: 'pestana-svg-host',
      'aria-hidden': 'true',
      ref: function (node) {
        if (!node) return;
        var tipo = props.tipo;
        var fn = typeof window !== 'undefined' && window.svgPestanaCatalogo;
        var map = typeof window !== 'undefined' && window.iconoDePestanaFicha;
        var icon = (map && map(tipo)) || tipo;
        if (typeof fn !== 'function' || !icon) return;
        if (node.dataset.icon === icon && node.querySelector('.pestana-svg')) return;
        node.replaceChildren(fn(icon));
        node.dataset.icon = icon;
      }
    });
  }

  function Pestanas(props) {
    var tab = props.tab;
    var setTab = props.setTab;
    var items = [
      { id: 'definicion', label: 'Definición' },
      { id: 'coleccion', label: 'Colección' },
      { id: 'ancla', label: 'Ancla' },
      { id: 'interno', label: 'Interno' }
    ];
    return e('div', { className: 'ancla-ficha-tabs', role: 'tablist', 'aria-label': 'Secciones del campo MongoDB' },
      items.map(function (item) {
        var selected = tab === item.id;
        return e('button', {
          type: 'button',
          key: item.id,
          role: 'tab',
          className: 'ancla-ficha-tab' + (selected ? ' is-on' : ''),
          'aria-selected': selected ? 'true' : 'false',
          onClick: function () { setTab(item.id); }
        }, e(IconoPestanaFicha, { tipo: item.id }), item.label);
      })
    );
  }

  function IconoColeccionFila() {
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

  function IconoEnlaceFila() {
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

  function IconoAnclaFila() {
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

  function PanelAncla(props) {
    var items = props.anclaItems || [];
    var onAbrirAncla = props.onAbrirAncla;
    if (!items.length) {
      return e('p', { className: 'ancla-ficha-vacio' }, 'Sin ancla asociada.');
    }
    return e('div', {
      className: 'catalogo-lista proy-tab-catalogo',
      role: 'list',
      'aria-label': 'Ancla asociada'
    },
      items.map(function (a) {
        var titulo = a.etiqueta || a.ancla || a.id || '—';
        return e('button', {
          type: 'button',
          key: a.id || a.ancla,
          className: 'catalogo-fila',
          role: 'listitem',
          title: a.descripcion || titulo,
          'aria-label': 'Abrir ancla ' + titulo,
          onClick: function () { if (onAbrirAncla) onAbrirAncla(a.ancla || a.id); }
        },
          e('span', { className: 'catalogo-fila-icon', 'aria-hidden': 'true' }, e(IconoAnclaFila)),
          e('span', { className: 'catalogo-fila-main' },
            e('span', { className: 'catalogo-fila-titulo' }, titulo),
            e('code', { className: 'catalogo-fila-codigo' }, a.ancla || a.id || '—')
          ),
          e('span', { className: 'catalogo-fila-enlace', 'aria-hidden': 'true' }, e(IconoEnlaceFila))
        );
      })
    );
  }

  function PanelColeccion(props) {
    var items = props.coleccionItems || [];
    var onAbrirColeccion = props.onAbrirColeccion;
    if (!items.length) {
      return e('p', {
        className: 'ancla-ficha-vacio',
        role: 'tabpanel',
        'aria-label': 'Colección padre'
      }, 'No hay colección padre asociada a este campo.');
    }
    // Misma apariencia que ColeccionesUI / ColeccionCatalogoFila.
    return e('div', {
      className: 'catalogo-lista proy-tab-catalogo',
      role: 'list',
      'aria-label': 'Colección padre'
    },
      items.map(function (col) {
        var partes = [];
        if (col.descripcion) partes.push(col.descripcion);
        var padre = col.proyectoNombre || col.proyectoId || '';
        if (col.baseDatos) {
          partes.push(padre ? (padre + ' · ' + col.baseDatos) : col.baseDatos);
        } else if (padre) {
          partes.push(padre);
        }
        if (col.nCampos != null) {
          partes.push(col.nCampos + (col.nCampos === 1 ? ' campo' : ' campos'));
        }
        var secundario = partes.length ? partes.join(' · ') : 'Colección';
        return e('button', {
          type: 'button',
          key: col.key || col.id,
          className: 'catalogo-fila',
          role: 'listitem',
          title: col.descripcion || col.id,
          'aria-label': 'Abrir colección ' + (col.id || ''),
          onClick: function () { if (onAbrirColeccion) onAbrirColeccion(col.key); }
        },
          e('span', { className: 'catalogo-fila-icon', 'aria-hidden': 'true' }, e(IconoColeccionFila)),
          e('span', { className: 'catalogo-fila-main' },
            e('span', { className: 'catalogo-fila-titulo' }, col.id || '—'),
            e('span', { className: 'catalogo-fila-codigo' }, secundario)
          ),
          e('span', { className: 'catalogo-fila-enlace', 'aria-hidden': 'true' }, e(IconoEnlaceFila))
        );
      })
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
        'aria-label': 'Editar campo MongoDB',
        title: 'Editar',
        onClick: props.onEditar
      }, e(IconoLapiz)));
    }
    if (props.onEliminar) {
      nodos.push(e('button', {
        key: 'eliminar',
        type: 'button',
        className: 'icon-btn',
        'aria-label': 'Eliminar campo MongoDB',
        title: 'Eliminar',
        onClick: props.onEliminar
      }, e(IconoPapelera)));
    }
    // Atrás vive en la barra superior del dialog (.ficha-atras-bar), no aquí.
    return e('div', { className: 'ancla-ficha-acciones' }, nodos);
  }

  function Ficha(props) {
    var c = props.campo;
    var initial = props.initialTab === 'coleccion' || props.initialTab === 'interno' || props.initialTab === 'ancla'
      ? props.initialTab
      : 'definicion';
    var tabState = useState(initial);
    var tab = tabState[0];
    var setTab = tabState[1];
    if (!c) {
      return e('div', { className: 'ancla-ficha' },
        e('div', { className: 'ancla-ficha-header' },
          e('span', { className: 'ficha-titulo-icon', 'aria-hidden': 'true' }, e(IconoMongo)),
          e('div', { className: 'ancla-ficha-header-text' },
            e('h3', { className: 'ancla-ficha-titulo' }, 'Campo MongoDB')
          ),
          e(AccionesFicha, { onCerrar: props.onCerrar })
        ),
        e('p', { className: 'ancla-ficha-vacio ancla-ficha-body' }, props.mensaje || 'No está en el catálogo Campos MongoDB.')
      );
    }
    var label = c.campo || (c.coleccion + '.' + c.clave);
    return e('div', { className: 'ancla-ficha', role: 'document', 'aria-label': 'Ficha del campo MongoDB' },
      e('div', { className: 'ancla-ficha-header' },
        e('button', {
          type: 'button',
          className: 'ficha-titulo-icon ficha-titulo-icon-color',
          'aria-label': 'Color',
          title: 'Color',
          style: (typeof window !== 'undefined' && window.ColorEntidad)
            ? window.ColorEntidad.reactStyle(c.color)
            : undefined,
          onClick: function (ev) {
            if (!window.ColorEntidad) return;
            window.ColorEntidad.openPicker({
              anchor: ev.currentTarget,
              color: c.color,
              usados: typeof props.getUsadosColor === 'function' ? props.getUsadosColor() : [],
              iconKind: 'mongo',
              onChange: function (hex) {
                if (typeof props.onColor === 'function') props.onColor(hex);
              }
            });
          }
        }, e(IconoMongo)),
        e('div', { className: 'ancla-ficha-header-text' },
          e('h3', { className: 'ancla-ficha-titulo' }, label),
          c.ancla ? e('code', { className: 'ancla-ficha-codigo' }, c.ancla) : null
        ),
        e(AccionesFicha, {
          onCerrar: props.onCerrar,
          onEditar: props.onEditar,
          onEliminar: props.onEliminar
        })
      ),
      e(Pestanas, { tab: tab, setTab: setTab }),
      e('div', { className: 'ancla-ficha-body' },
        tab === 'definicion'
          ? e('dl', { className: 'ancla-ficha-dl', role: 'tabpanel' },
            e(Fila, { label: 'Base' }, e('code', null, c.baseDatos || '—')),
            e(Fila, { label: 'Clave' }, e('code', null, c.clave || '—')),
            e(Fila, { label: 'Proyección' }, c.proyeccionMongo ? e('code', null, c.proyeccionMongo) : '—'),
            e(Fila, { label: 'Elemento N→array' },
              c.proyeccionElemento && Object.keys(c.proyeccionElemento).length
                ? e('code', null, JSON.stringify(c.proyeccionElemento))
                : '—'
            ),
            e(Fila, { label: 'bsonType' }, e('code', null, c.bsonType || '—')),
            e(Fila, { label: 'Índices' },
              Array.isArray(c.indices) && c.indices.length
                ? e('code', null, JSON.stringify(c.indices))
                : '—'
            ),
            e(Fila, { label: 'Obligatorio' }, c.obligatorio ? 'Sí' : 'No'),
            e(Fila, { label: 'Descripción' }, c.descripcion || '—')
          )
          : null,
        tab === 'coleccion'
          ? e(PanelColeccion, {
            coleccionItems: props.coleccionItems || [],
            onAbrirColeccion: props.onAbrirColeccion
          })
          : null,
        tab === 'ancla'
          ? e(PanelAncla, {
            anclaItems: props.anclaItems || [],
            onAbrirAncla: props.onAbrirAncla
          })
          : null,
        tab === 'interno'
          ? e('dl', { className: 'ancla-ficha-dl', role: 'tabpanel' },
            e(Fila, { label: 'Id' }, e('code', null, c.id || '—')),
            e(HashCopiable, { hash: c.hash })
          )
          : null
      ),
      c.origen === 'local'
        ? e('p', { className: 'origen ancla-ficha-local' }, 'En este navegador. No está en GitHub.')
        : null
    );
  }

  function etiquetaMongo(c) {
    var clave = String(c.clave || '').trim();
    if (clave) {
      return clave.split(/[._]/).filter(Boolean).map(function (p) {
        if (p.length === 1) return p.toUpperCase();
        return p.charAt(0).toUpperCase() + p.slice(1);
      }).join(' ');
    }
    return c.campo || c.id || 'Campo';
  }

  function IconoMongo() {
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
      e('ellipse', { cx: '12', cy: '6', rx: '7', ry: '3' }),
      e('path', { d: 'M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6' }),
      e('path', { d: 'M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6' })
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
    var codigo = c.campo || ((c.coleccion || '') + '.' + (c.clave || ''));
    var titulo = etiquetaMongo(c);
    return e('button', {
      type: 'button',
      className: 'catalogo-fila' + (abierta ? ' is-open' : ''),
      role: 'listitem',
      title: c.descripcion || titulo,
      'aria-label': 'Abrir ' + titulo,
      onClick: function () { props.onAbrir(c.id); }
    },
      e('span', {
        className: 'catalogo-fila-icon',
        'aria-hidden': 'true',
        style: (typeof window !== 'undefined' && window.ColorEntidad)
          ? window.ColorEntidad.reactStyle(c.color)
          : undefined
      }, e(IconoMongo)),
      e('span', { className: 'catalogo-fila-main' },
        e('span', { className: 'catalogo-fila-titulo' }, titulo),
        e('code', { className: 'catalogo-fila-codigo' }, codigo)
      ),
      e('span', { className: 'catalogo-fila-enlace', 'aria-hidden': 'true' }, e(IconoEnlace))
    );
  }

  function MongoApp(props) {
    var bridge = props.bridge;
    var embed = !!props.embed;
    var snap = bridge.getSnapshot();
    var campos = snap.campos || [];
    var abierta = snap.abierta;
    var ready = snap.ready;
    var indexError = snap.indexError;
    var emptyMsg = props.emptyMsg || 'No hay campos MongoDB.';

    var estado = '';
    if (!ready) estado = 'Cargando el índice…';
    else if (indexError) estado = 'No se pudo leer el índice compartido.';
    else if (!campos.length) estado = emptyMsg;

    return e('div', { className: 'campos-app' + (embed ? ' is-embed' : '') },
      embed ? null : e('div', { className: 'catalogo-toolbar' },
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
            e('ellipse', { cx: '12', cy: '6', rx: '7', ry: '3' }),
            e('path', { d: 'M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6' }),
            e('path', { d: 'M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6' })
          ),
          e('span', null, 'Añadir campo')
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
  var listaRoots = {};

  function montarGrid(bridge) {
    var root = document.getElementById('campos-mongodb-root');
    if (!root || !bridge) return;
    if (!gridRoot) gridRoot = ReactDOM.createRoot(root);
    gridRoot.render(e(MongoApp, { bridge: bridge }));
  }

  /** Lista embebible (p. ej. pestaña Campos de una Base de datos). Reutiliza FilaLista. */
  function montarLista(elOrId, bridge, opts) {
    opts = opts || {};
    var el = typeof elOrId === 'string' ? document.getElementById(elOrId) : elOrId;
    if (!el || !bridge) return;
    var key = el.id || 'mongo-embed';
    if (!listaRoots[key]) listaRoots[key] = ReactDOM.createRoot(el);
    listaRoots[key].render(e(MongoApp, {
      bridge: bridge,
      embed: true,
      emptyMsg: opts.emptyMsg || 'Sin campos Mongo en esta base de datos.'
    }));
  }

  function mostrarFicha(campo, onCerrar, mensaje, extras) {
    var mount = document.getElementById('mongo-ficha-mount');
    if (!mount) return;
    if (!fichaRoot) fichaRoot = ReactDOM.createRoot(mount);
    var opts = extras || {};
    fichaRoot.render(e(Ficha, {
      campo: campo || null,
      mensaje: mensaje,
      onCerrar: onCerrar,
      onEditar: opts.onEditar || null,
      onEliminar: opts.onEliminar || null,
      onColor: opts.onColor || null,
      getUsadosColor: opts.getUsadosColor || null,
      initialTab: opts.initialTab || 'definicion',
      coleccionItems: opts.coleccionItems || [],
      onAbrirColeccion: opts.onAbrirColeccion || null,
      anclaItems: opts.anclaItems || [],
      onAbrirAncla: opts.onAbrirAncla || null
    }));
  }

  function limpiarFicha() {
    if (!fichaRoot) return;
    fichaRoot.render(null);
  }

  window.CamposMongoUI = {
    montar: montarGrid,
    refrescar: function (bridge) { montarGrid(bridge); },
    montarLista: montarLista,
    mostrarFicha: mostrarFicha,
    limpiarFicha: limpiarFicha
  };
})();
