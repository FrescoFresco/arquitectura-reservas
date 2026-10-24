'use strict';

/**
 * Color por entidad de catálogo: tint del tile del icono + popup (paleta / Generar ΔE76 / Restablecer).
 * API: window.ColorEntidad
 */
(function (global) {
  var DEFAULT_INK = '#1c63d5';
  var DEFAULT_TINT = '#edf3ff';
  var COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

  /** Paleta fija ~16 swatches (acento / ink); L/S acotados para Lucide sobre tint claro. */
  var PALETA = [
    '#c45c3a', '#c47a2a', '#b89a1a', '#5a9a3a',
    '#2a9a7a', '#2a8aaa', '#1c63d5', '#3a5ac4',
    '#6a4ac4', '#9a3ab4', '#c43a8a', '#c43a5a',
    '#7a5a4a', '#5a6a7a', '#3a7a6a', '#8a6a2a'
  ];

  var popoverEl = null;
  var popoverClose = null;

  function normalizeHex(raw) {
    if (raw == null || raw === '') return null;
    var s = String(raw).trim();
    if (!COLOR_RE.test(s)) return null;
    return s.toLowerCase();
  }

  function hexToRgb(hex) {
    var h = normalizeHex(hex);
    if (!h) return null;
    return {
      r: parseInt(h.slice(1, 3), 16),
      g: parseInt(h.slice(3, 5), 16),
      b: parseInt(h.slice(5, 7), 16)
    };
  }

  function hexToLab(hex) {
    var rgb = hexToRgb(hex);
    if (!rgb) return null;
    var r = rgb.r / 255;
    var g = rgb.g / 255;
    var b = rgb.b / 255;
    r = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
    g = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
    b = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;
    var x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
    var y = (r * 0.2126729 + g * 0.7151522 + b * 0.072175) / 1;
    var z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883;
    function f(t) {
      return t > 0.008856 ? Math.pow(t, 1 / 3) : 7.787 * t + 16 / 116;
    }
    var fx = f(x);
    var fy = f(y);
    var fz = f(z);
    return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
  }

  function deltaE76(a, b) {
    var dL = a.L - b.L;
    var da = a.a - b.a;
    var db = a.b - b.b;
    return Math.sqrt(dL * dL + da * da + db * db);
  }

  /** Mezcla ink con blanco (~0.88) → tint de fondo del tile. */
  function tintFromInk(ink) {
    var rgb = hexToRgb(ink) || hexToRgb(DEFAULT_INK);
    var t = 0.88;
    function mix(c) {
      return Math.round(c + (255 - c) * t);
    }
    function hx(n) {
      return n.toString(16).padStart(2, '0');
    }
    return '#' + hx(mix(rgb.r)) + hx(mix(rgb.g)) + hx(mix(rgb.b));
  }

  function inkOf(color) {
    return normalizeHex(color) || DEFAULT_INK;
  }

  function tintOf(color) {
    var n = normalizeHex(color);
    if (!n) return DEFAULT_TINT;
    return tintFromInk(n);
  }

  function tileCss(color) {
    return {
      background: tintOf(color),
      color: inkOf(color),
      /* Evita que el tint “pinte” vecinos (stacking / overflow en grid). */
      isolation: 'isolate'
    };
  }

  function applyToEl(el, color) {
    if (!el) return;
    var css = tileCss(color);
    el.style.background = css.background;
    el.style.color = css.color;
    el.style.isolation = css.isolation;
    var n = normalizeHex(color);
    if (n) el.setAttribute('data-color', n);
    else el.removeAttribute('data-color');
  }

  /**
   * Max-min ΔE76: elige el swatch de la paleta con mayor distancia mínima
   * a los colores ya usados (null/default no cuentan).
   */
  function generarColor(usadosHex) {
    var usados = [];
    (usadosHex || []).forEach(function (h) {
      var n = normalizeHex(h);
      if (!n) return;
      var lab = hexToLab(n);
      if (lab) usados.push(lab);
    });
    var best = PALETA[0];
    var bestScore = -1;
    var defaultLab = hexToLab(DEFAULT_INK);
    for (var i = 0; i < PALETA.length; i++) {
      var p = PALETA[i];
      var lab = hexToLab(p);
      if (!lab) continue;
      var score = usados.length
        ? Math.min.apply(null, usados.map(function (u) { return deltaE76(lab, u); }))
        : Infinity;
      if (score > bestScore) {
        bestScore = score;
        best = p;
      } else if (score === bestScore && defaultLab) {
        var dBest = deltaE76(hexToLab(best), defaultLab);
        var dNew = deltaE76(lab, defaultLab);
        if (dNew > dBest) best = p;
      }
    }
    return best.toLowerCase();
  }

  function closePopover() {
    if (popoverClose) {
      document.removeEventListener('pointerdown', popoverClose, true);
      document.removeEventListener('keydown', popoverClose, true);
      popoverClose = null;
    }
    if (popoverEl) {
      popoverEl.remove();
      popoverEl = null;
    }
  }

  function openPicker(opts) {
    opts = opts || {};
    closePopover();
    var anchor = opts.anchor;
    if (!anchor) return;
    var current = normalizeHex(opts.color);
    var usados = opts.usados || [];
    var onChange = typeof opts.onChange === 'function' ? opts.onChange : function () {};

    var pop = document.createElement('div');
    pop.className = 'color-entidad-pop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Color');
    pop.innerHTML =
      '<p class="color-entidad-pop-titulo">Color</p>' +
      '<div class="color-entidad-swatches" role="listbox" aria-label="Paleta"></div>' +
      '<div class="color-entidad-acciones">' +
      '<button type="button" class="btn ghost color-entidad-generar">Generar color</button>' +
      '<button type="button" class="btn ghost color-entidad-reset">Restablecer</button>' +
      '</div>' +
      '<div class="color-entidad-preview-row">' +
      '<span class="color-entidad-preview-label">Vista previa</span>' +
      '<span class="color-entidad-preview-tile catalogo-fila-icon" aria-hidden="true"></span>' +
      '</div>';

    var grid = pop.querySelector('.color-entidad-swatches');
    var preview = pop.querySelector('.color-entidad-preview-tile');
    var selected = current;

    function paintPreview() {
      applyToEl(preview, selected);
      if (!preview.querySelector('svg') && typeof global.svgPestanaCatalogo === 'function') {
        var kind = opts.iconKind || 'skill';
        var svg = global.svgPestanaCatalogo(kind);
        if (svg) {
          svg.classList.add('catalogo-fila-svg');
          preview.append(svg);
        }
      }
    }

    function markSelected() {
      grid.querySelectorAll('.color-entidad-swatch').forEach(function (btn) {
        var on = btn.getAttribute('data-hex') === selected;
        btn.classList.toggle('is-selected', on);
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      paintPreview();
    }

    PALETA.forEach(function (hex) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'color-entidad-swatch';
      btn.setAttribute('role', 'option');
      btn.setAttribute('data-hex', hex);
      btn.style.background = hex;
      btn.title = hex;
      btn.setAttribute('aria-label', hex);
      btn.addEventListener('click', function () {
        selected = hex;
        markSelected();
        onChange(hex);
        closePopover();
      });
      grid.append(btn);
    });

    pop.querySelector('.color-entidad-generar').addEventListener('click', function () {
      var gen = generarColor(usados.filter(function (u) {
        return normalizeHex(u) !== selected;
      }));
      selected = gen;
      markSelected();
      onChange(gen);
      closePopover();
    });

    pop.querySelector('.color-entidad-reset').addEventListener('click', function () {
      selected = null;
      markSelected();
      onChange(null);
      closePopover();
    });

    markSelected();
    /* Siempre en body + fixed: dialog.ficha-pane tiene overflow:auto y recortaría
       un pop absolute; z-index alto evita solape bajo hub/ficha. */
    document.body.append(pop);
    popoverEl = pop;
    pop.style.position = 'fixed';
    pop.style.zIndex = '120';

    var rect = anchor.getBoundingClientRect();
    var pad = 8;
    var left = rect.left;
    var top = rect.bottom + pad;
    requestAnimationFrame(function () {
      var w = pop.offsetWidth;
      var h = pop.offsetHeight;
      if (left + w > window.innerWidth - 12) left = Math.max(12, window.innerWidth - w - 12);
      if (top + h > window.innerHeight - 12) top = Math.max(12, rect.top - h - pad);
      pop.style.left = Math.round(left) + 'px';
      pop.style.top = Math.round(top) + 'px';
    });

    popoverClose = function (ev) {
      if (ev.type === 'keydown' && ev.key === 'Escape') {
        closePopover();
        return;
      }
      if (ev.type === 'pointerdown') {
        if (pop.contains(ev.target) || anchor.contains(ev.target)) return;
        closePopover();
      }
    };
    setTimeout(function () {
      document.addEventListener('pointerdown', popoverClose, true);
      document.addEventListener('keydown', popoverClose, true);
    }, 0);
  }

  /**
   * Convierte / cablea un tile de ficha como botón Color.
   * opts: { getColor, getUsados, onSave, iconKind }
   */
  function bindFichaIcon(el, opts) {
    if (!el) return el;
    opts = opts || {};
    el._colorEntidadOpts = opts;
    if (el.tagName !== 'BUTTON') {
      el.setAttribute('role', 'button');
      el.tabIndex = 0;
    }
    el.setAttribute('aria-label', 'Color');
    el.classList.add('ficha-titulo-icon-color');
    el.title = 'Color';
    function refresh() {
      var o = el._colorEntidadOpts || {};
      var c = typeof o.getColor === 'function' ? o.getColor() : null;
      applyToEl(el, c);
    }
    refresh();
    if (el._colorEntidadBound) {
      el._colorEntidadRefresh = refresh;
      return el;
    }
    el._colorEntidadBound = true;
    function open() {
      var o = el._colorEntidadOpts || {};
      openPicker({
        anchor: el,
        color: typeof o.getColor === 'function' ? o.getColor() : null,
        usados: typeof o.getUsados === 'function' ? o.getUsados() : [],
        iconKind: o.iconKind,
        onChange: function (hex) {
          applyToEl(el, hex);
          if (typeof o.onSave === 'function') o.onSave(hex);
        }
      });
    }
    el.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      open();
    });
    el.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        open();
      }
    });
    el._colorEntidadRefresh = refresh;
    return el;
  }

  /** Estilo React para el span del icono de fila. */
  function reactStyle(color) {
    return tileCss(color);
  }

  /** Props React del tile: style + data-color (aislado de la fila). */
  function reactProps(color) {
    var n = normalizeHex(color);
    var props = { style: tileCss(color) };
    if (n) props['data-color'] = n;
    return props;
  }

  /* ─── Capa catálogo (persistencia + cableado único) ─────────────────
   * Un solo módulo para todos los tipos: skills, proyectos, anclas, …
   * catalogo-ui registra kinds y pasa fetch/auth; las fichas/filas reutilizan esto.
   */

  var PATHS = {
    skill: '/v1/skills/',
    ancla: '/v1/anclas/',
    mongo: '/v1/mongo/',
    cluster: '/v1/clusters/',
    proyecto: '/v1/proyectos/',
    'system-prompt': '/v1/system-prompts/',
    ejecutor: '/v1/ejecutores/',
    fundamento: '/v1/fundamentos/',
    agente: '/v1/agentes/',
    flujo: '/v1/flujos/'
  };

  var catalogCfg = {
    ensureAuth: null,
    apiFetchAuth: null
  };
  /** kind → { listItems(), itemId(item), applyLocal(id,color), refresh() } */
  var kindRegistry = {};

  function configureCatalog(opts) {
    opts = opts || {};
    if (typeof opts.ensureAuth === 'function') catalogCfg.ensureAuth = opts.ensureAuth;
    if (typeof opts.apiFetchAuth === 'function') catalogCfg.apiFetchAuth = opts.apiFetchAuth;
  }

  function registerKind(kind, hooks) {
    if (!kind || !hooks) return;
    kindRegistry[kind] = hooks;
  }

  function listForKind(kind) {
    var h = kindRegistry[kind];
    if (!h || typeof h.listItems !== 'function') return [];
    var list = h.listItems();
    return Array.isArray(list) ? list : [];
  }

  function itemIdOf(kind, item) {
    var h = kindRegistry[kind];
    if (h && typeof h.itemId === 'function') return h.itemId(item);
    if (!item) return null;
    return item.key != null ? item.key : item.id;
  }

  function coloresUsados(kind, excludeId) {
    var out = [];
    listForKind(kind).forEach(function (x) {
      var xid = itemIdOf(kind, x);
      if (xid === excludeId) return;
      var c = x && x.color;
      if (c && typeof c === 'string') out.push(c);
    });
    return out;
  }

  function aplicarLocal(kind, id, color) {
    var h = kindRegistry[kind];
    if (h && typeof h.applyLocal === 'function') {
      h.applyLocal(id, color);
      return;
    }
    listForKind(kind).forEach(function (x) {
      if (itemIdOf(kind, x) === id) x.color = color;
    });
  }

  function refrescarKind(kind) {
    var h = kindRegistry[kind];
    if (h && typeof h.refresh === 'function') {
      try { h.refresh(); } catch (e) {}
    }
  }

  function entidadDeRespuesta(data) {
    if (!data || typeof data !== 'object') return null;
    return (
      data.skill ||
      data.ancla ||
      data.campo ||
      data.cluster ||
      data.proyecto ||
      data.systemPrompt ||
      data.fundamento ||
      data.agente ||
      data.flujo ||
      null
    );
  }

  function assertPersistido(data, color, kind, coleccionId) {
    var want = color == null || color === '' ? null : String(color).toLowerCase();
    if (kind === 'coleccion') {
      var proy = data && data.proyecto;
      var cols = proy && Array.isArray(proy.colecciones) ? proy.colecciones : null;
      if (!cols) throw new Error('La API no devolvió colecciones con color. ¿Worker desactualizado?');
      if (coleccionId) {
        var hit = null;
        for (var i = 0; i < cols.length; i++) {
          if (cols[i] && cols[i].id === coleccionId) { hit = cols[i]; break; }
        }
        if (!hit || !Object.prototype.hasOwnProperty.call(hit, 'color')) {
          throw new Error('La colección no devolvió color tras guardar.');
        }
        var gotCol = hit.color == null || hit.color === '' ? null : String(hit.color).toLowerCase();
        if (gotCol !== want) throw new Error('El color de colección no coincidió tras guardar.');
      }
      return;
    }
    var ent = entidadDeRespuesta(data);
    if (!ent || !Object.prototype.hasOwnProperty.call(ent, 'color')) {
      throw new Error('La API no devolvió el campo color (Worker desactualizado). No se guardó el tinte.');
    }
    var got = ent.color == null || ent.color === '' ? null : String(ent.color).toLowerCase();
    if (got !== want) {
      throw new Error('El color no coincidió tras guardar (API: ' + got + ', pedido: ' + want + ').');
    }
  }

  /**
   * Persiste color vía PUT {color} (o colecciones JSON).
   * optsColeccion: { getProyecto(proyId), onProyectoUpdated(proyId, data) }
   */
  function guardar(kind, id, color, optsColeccion) {
    optsColeccion = optsColeccion || {};
    if (!catalogCfg.ensureAuth || !catalogCfg.apiFetchAuth) {
      return Promise.reject(new Error('ColorEntidad.configure({ ensureAuth, apiFetchAuth }) pendiente.'));
    }
    if (kind === 'coleccion') {
      var parts = String(id).split('/');
      var proyId = parts[0];
      var colId = parts.slice(1).join('/') || parts[1];
      var proy = typeof optsColeccion.getProyecto === 'function'
        ? optsColeccion.getProyecto(proyId)
        : null;
      if (!proy) return Promise.reject(new Error('Base de datos no encontrada.'));
      var cols = (proy.colecciones || []).map(function (c) {
        var o = { id: c.id, descripcion: c.descripcion || '' };
        if (c.id === colId) o.color = color;
        else if (Object.prototype.hasOwnProperty.call(c, 'color')) o.color = c.color;
        return o;
      });
      return catalogCfg.ensureAuth().then(function () {
        return catalogCfg.apiFetchAuth('/v1/proyectos/' + encodeURIComponent(proyId), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ colecciones: cols })
        });
      }).then(function (data) {
        assertPersistido(data, color, kind, colId);
        aplicarLocal(kind, id, color);
        if (typeof optsColeccion.onProyectoUpdated === 'function') {
          optsColeccion.onProyectoUpdated(proyId, data);
        }
        refrescarKind(kind);
        return data;
      });
    }
    var base = PATHS[kind];
    if (!base) return Promise.reject(new Error('Tipo de color desconocido: ' + kind));
    return catalogCfg.ensureAuth().then(function () {
      return catalogCfg.apiFetchAuth(base + encodeURIComponent(id), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ color: color })
      });
    }).then(function (data) {
      assertPersistido(data, color, kind);
      aplicarLocal(kind, id, color);
      refrescarKind(kind);
      return data;
    });
  }

  /**
   * Cablea el tile del header de ficha (cualquier catálogo).
   * dlgOrEl: dialog, selector, o el propio .ficha-titulo-icon
   */
  function bindCatalogFicha(dlgOrEl, opts) {
    opts = opts || {};
    var icon = null;
    if (typeof dlgOrEl === 'string') icon = document.querySelector(dlgOrEl);
    else if (dlgOrEl && dlgOrEl.querySelector) {
      icon = dlgOrEl.querySelector('.ficha-titulo-icon') || dlgOrEl;
    } else {
      icon = dlgOrEl;
    }
    if (!icon) return null;
    var kind = opts.kind;
    var id = opts.id;
    return bindFichaIcon(icon, {
      iconKind: opts.iconKind || kind || 'skill',
      getColor: function () {
        if (typeof opts.getColor === 'function') return opts.getColor();
        return opts.color || null;
      },
      getUsados: function () {
        if (typeof opts.getUsados === 'function') return opts.getUsados();
        return coloresUsados(kind, id);
      },
      onSave: function (hex) {
        opts.color = hex;
        guardar(kind, id, hex, opts.coleccionOpts).then(function () {
          if (typeof opts.onSaved === 'function') opts.onSaved(hex);
        }).catch(function (err) {
          console.error(err);
          alert((err && err.message) || 'No se pudo guardar el color.');
        });
      }
    });
  }

  /** Copia color normalizado a un objeto de catálogo (normalizers). */
  function attachNormalized(out, item) {
    if (!out || !item || typeof item !== 'object') return out;
    if (!Object.prototype.hasOwnProperty.call(item, 'color')) return out;
    var c = item.color;
    if (c == null || c === '') out.color = null;
    else if (typeof c === 'string' && COLOR_RE.test(c.trim())) out.color = c.trim().toLowerCase();
    return out;
  }

  global.ColorEntidad = {
    DEFAULT_INK: DEFAULT_INK,
    DEFAULT_TINT: DEFAULT_TINT,
    PALETA: PALETA.slice(),
    PATHS: PATHS,
    normalizeHex: normalizeHex,
    tintFromInk: tintFromInk,
    tintOf: tintOf,
    inkOf: inkOf,
    tileCss: tileCss,
    applyToEl: applyToEl,
    generarColor: generarColor,
    openPicker: openPicker,
    closePopover: closePopover,
    bindFichaIcon: bindFichaIcon,
    reactStyle: reactStyle,
    reactProps: reactProps,
    /* catálogo */
    configure: configureCatalog,
    registerKind: registerKind,
    coloresUsados: coloresUsados,
    guardar: guardar,
    bindCatalogFicha: bindCatalogFicha,
    attachNormalized: attachNormalized,
    entidadDeRespuesta: entidadDeRespuesta
  };
})(typeof window !== 'undefined' ? window : globalThis);
