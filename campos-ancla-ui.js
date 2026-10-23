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
        }, e(IconoPestanaFicha, { tipo: item.id }), item.label);
      })
    );
  }

  function PanelDefinicion(props) {
    var c = props.campo;
    var aliases = Array.isArray(c.aliases) ? c.aliases : [];
    var ejemploMostrado = enmascararSiSensible(c, c.ejemplo);
    return e('dl', { className: 'ancla-ficha-dl', id: 'ancla-panel-definicion', role: 'tabpanel' },
      e(Fila, { label: 'Tipo' }, c.tipo ? e('code', null, c.tipo) : '—'),
      e(Fila, { label: 'Obligatorio' }, c.obligatorio ? 'Sí' : 'No'),
      e(Fila, { label: 'Sensible' }, c.sensible ? 'Sí (clase; enmascara ejemplo)' : 'No'),
      e(Fila, { label: 'Formato' }, c.formato ? e('code', null, c.formato) : '—'),
      e(Fila, { label: 'Descripción' }, c.descripcion || '—'),
      e(Fila, { label: 'Ejemplo' }, ejemploMostrado !== '—' ? e('code', null, ejemploMostrado) : '—'),
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
    var negocioId = props.negocioId || 'pelo-sur';
    var state = useState({ loading: true, obs: [], valorActual: '', error: '' });
    var pack = state[0];
    var setPack = state[1];

    React.useEffect(function () {
      var cancelled = false;
      setPack({ loading: true, obs: [], valorActual: '', error: '' });
      var base = (typeof window !== 'undefined' && (window.ARQ_API_BASE || window.CAMPOS_API_BASE)) ||
        'https://campos-ancla-api.web-legal-es.workers.dev';
      var url = String(base).replace(/\/$/, '') +
        '/v1/anclas/' + encodeURIComponent(c.id) +
        '/valores?negocio_id=' + encodeURIComponent(negocioId);
      fetch(url, { headers: { Accept: 'application/json' } })
        .then(function (r) {
          return r.text().then(function (rawBody) {
            var j = null;
            try { j = rawBody ? JSON.parse(rawBody) : {}; } catch (e) { j = null; }
            return { ok: r.ok, j: j, rawBody: rawBody || '', status: r.status };
          });
        })
        .then(function (res) {
          if (cancelled) return;
          if (!res.ok || (res.j && res.j.ok === false)) {
            var raw = (typeof window.formatApiErrorRaw === 'function')
              ? window.formatApiErrorRaw({ data: res.j, rawBody: res.rawBody, status: res.status }, res.status)
              : (res.rawBody || JSON.stringify(res.j || { ok: false, error: 'HTTP ' + res.status }, null, 2));
            setPack({ loading: false, obs: [], valorActual: '', error: raw });
            return;
          }
          var obs = Array.isArray(res.j.observaciones) ? res.j.observaciones.slice().reverse() : [];
          setPack({ loading: false, obs: obs, valorActual: res.j.valorActual || '', error: '' });
        })
        .catch(function (err) {
          if (cancelled) return;
          var raw = (typeof window.formatApiErrorRaw === 'function')
            ? window.formatApiErrorRaw(err)
            : JSON.stringify({ ok: false, error: (err && err.message) || 'network' }, null, 2);
          setPack({ loading: false, obs: [], valorActual: '', error: raw });
        });
      return function () { cancelled = true; };
    }, [c.id, negocioId]);

    if (pack.loading) {
      return e('p', { className: 'ancla-ficha-vacio', id: 'ancla-panel-historial', role: 'tabpanel' },
        'Cargando historial de ' + negocioId + '…'
      );
    }
    if (pack.error) {
      return e('pre', {
        className: 'ancla-ficha-vacio api-error-raw',
        id: 'ancla-panel-historial',
        role: 'tabpanel'
      }, pack.error);
    }
    if (!pack.obs.length) {
      return e('p', { className: 'ancla-ficha-vacio', id: 'ancla-panel-historial', role: 'tabpanel' },
        'Sin observaciones para negocio «' + negocioId + '». Los valores van por negocio_id, no en la ficha.'
      );
    }
    return e('div', { className: 'ancla-historial', id: 'ancla-panel-historial', role: 'tabpanel' },
      e('p', { className: 'ancla-historial-meta' },
        'Negocio ', e('code', null, negocioId),
        pack.valorActual
          ? e('span', null, ' · vigente ', e('code', null, enmascararSiSensible(c, pack.valorActual)))
          : null
      ),
      pack.obs.map(function (o, idx) {
        var valor = enmascararSiSensible(c, o.valor);
        return e('div', { className: 'ancla-historial-fila', key: (o.timestamp || '') + idx },
          e('time', { dateTime: o.timestamp || '' }, o.timestamp ? String(o.timestamp).replace('T', ' ').replace(/\.\d+Z$/, 'Z') : '—'),
          e('code', null, valor),
          o.url ? e('a', { href: o.url, target: '_blank', rel: 'noopener noreferrer', className: 'ancla-historial-url' }, o.url) : null
        );
      })
    );
  }

  function IconoMongoFila() {
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

  function etiquetaMongoFila(m) {
    var clave = String((m && m.clave) || '').trim();
    if (clave) {
      return clave.split(/[._]/).filter(Boolean).map(function (p) {
        if (p.length === 1) return p.toUpperCase();
        return p.charAt(0).toUpperCase() + p.slice(1);
      }).join(' ');
    }
    return (m && (m.campo || m.id)) || 'Campo';
  }

  function PanelMongo(props) {
    var mongo = props.mongo || null;
    var onAbrirCampo = props.onAbrirCampo;
    // Solo pintar enlace real del catálogo Campos. Sin match → vacío (no inferir desde el ancla).
    if (!mongo || !mongo.id) {
      return e('p', {
        className: 'ancla-ficha-vacio',
        id: 'ancla-panel-mongo',
        role: 'tabpanel'
      }, 'Ningún campo del catálogo Campos está enlazado a este ancla.');
    }
    var codigo = mongo.campo || ((mongo.coleccion || '') + '.' + (mongo.clave || ''));
    var titulo = etiquetaMongoFila(mongo);
    var secundario = codigo;
    if (mongo.baseDatos) secundario = codigo + ' · ' + mongo.baseDatos;
    return e('div', {
      className: 'catalogo-lista proy-tab-catalogo',
      id: 'ancla-panel-mongo',
      role: 'list',
      'aria-label': 'Campo Mongo asociado'
    },
      e('button', {
        type: 'button',
        className: 'catalogo-fila',
        role: 'listitem',
        title: mongo.descripcion || titulo,
        'aria-label': 'Abrir campo ' + titulo,
        onClick: function () { if (onAbrirCampo) onAbrirCampo(mongo.id); }
      },
        e('span', { className: 'catalogo-fila-icon', 'aria-hidden': 'true' }, e(IconoMongoFila)),
        e('span', { className: 'catalogo-fila-main' },
          e('span', { className: 'catalogo-fila-titulo' }, titulo),
          e('code', { className: 'catalogo-fila-codigo' }, secundario)
        ),
        e('span', { className: 'catalogo-fila-enlace', 'aria-hidden': 'true' }, e(IconoEnlaceExterno))
      )
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

  function IconoSkillFila() {
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

  function PanelSkills(props) {
    var skillItems = props.skillItems || [];
    var onAbrirSkill = props.onAbrirSkill;
    if (!skillItems.length) {
      return e('p', { className: 'ancla-ficha-vacio', id: 'ancla-panel-skills', role: 'tabpanel' },
        'Ninguna skill usa este ancla todavía.'
      );
    }
    // Misma apariencia que SkillsUI / SkillFila (catalogo-fila). Sin createRoot anidado.
    return e('div', {
      className: 'catalogo-lista proy-tab-catalogo',
      id: 'ancla-panel-skills',
      role: 'list'
    },
      skillItems.map(function (ins) {
        var id = ins && ins.id;
        var nombre = (ins && ins.nombre) || id || '—';
        var versiones = (ins && Array.isArray(ins.versiones)) ? ins.versiones : [];
        var actual = versiones.length ? versiones[versiones.length - 1] : null;
        var secundario = actual
          ? ('v' + actual.numero + (actual.fecha ? '' : ''))
          : (id || 'Skill');
        if (actual && actual.fecha) {
          var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(actual.fecha);
          if (m) {
            var meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
            secundario = 'v' + actual.numero + ' · ' + Number(m[3]) + ' ' + (meses[Number(m[2]) - 1] || '');
          } else {
            secundario = 'v' + actual.numero;
          }
        } else if (actual) {
          secundario = 'v' + actual.numero;
        }
        if (id && id !== nombre) secundario = id + (secundario ? ' · ' + secundario : '');
        return e('button', {
          type: 'button',
          key: id || nombre,
          className: 'catalogo-fila',
          role: 'listitem',
          title: (ins && ins.descripcion) || nombre,
          'aria-label': 'Ver skill ' + nombre,
          onClick: function () { if (onAbrirSkill) onAbrirSkill(id); }
        },
          e('span', { className: 'catalogo-fila-icon', 'aria-hidden': 'true' }, e(IconoSkillFila)),
          e('span', { className: 'catalogo-fila-main' },
            e('span', { className: 'catalogo-fila-titulo' }, nombre),
            e('span', { className: 'catalogo-fila-codigo' }, secundario)
          ),
          e('span', { className: 'catalogo-fila-enlace', 'aria-hidden': 'true' }, e(IconoEnlaceExterno))
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
    // Atrás vive en la barra superior del dialog (.ficha-atras-bar), no aquí.
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
              iconKind: 'ancla',
              onChange: function (hex) {
                if (typeof props.onColor === 'function') props.onColor(hex);
              }
            });
          }
        }, e(IconoAncla)),
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
        tab === 'historial' ? e(PanelHistorial, { campo: c, negocioId: props.negocioId || 'pelo-sur' }) : null,
        tab === 'mongo' ? e(PanelMongo, {
          campo: c,
          mongo: props.mongo,
          onAbrirCampo: props.onAbrirCampo
        }) : null,
        tab === 'skills' ? e(PanelSkills, {
          skills: skills,
          skillItems: props.skillItems || [],
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
      e('span', {
        className: 'catalogo-fila-icon',
        'aria-hidden': 'true',
        style: (typeof window !== 'undefined' && window.ColorEntidad)
          ? window.ColorEntidad.reactStyle(c.color)
          : undefined
      }, e(IconoAncla)),
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
      onColor: opts.onColor || null,
      getUsadosColor: opts.getUsadosColor || null,
      mongo: opts.mongo || null,
      onAbrirCampo: opts.onAbrirCampo || null,
      nombresSkill: opts.nombresSkill || {},
      skillItems: opts.skillItems || [],
      onAbrirSkill: opts.onAbrirSkill || null,
      negocioId: opts.negocioId || 'pelo-sur'
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
