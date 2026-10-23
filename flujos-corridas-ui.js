'use strict';

/**
 * Flujos + Corridas UI.
 * - Catálogos → Flujos (lista global + ficha)
 * - Base de datos → Flujos (filtrado por proyecto)
 * - Corridas: canónicas en ficha Flujo → pestaña Corridas (filtro flujo_id)
 * Depende de helpers globales de catalogo-ui: apiFetch, apiFetchAuth,
 * asegurarClaveCatalogo, showApiErrorRaw, renderMermaidEn, svgPestanaCatalogo,
 * iconizarPestanasFicha, atrasDesdeFicha, apiBaseUrl, openFichaPane, abrirProyecto,
 * seleccionarCatalogo.
 */
(function () {
  var PAGE_SIZE = 25;

  var st = {
    proyectoId: null,
    flujos: [],
    flujosToken: 0,
    catalogFlujos: [],
    catalogToken: 0,
    origenLista: 'proyecto', // 'proyecto' | 'catalogo'
    flujoAbierto: null,
    flujoVersion: null,
    flujoHistorial: false,
    flujoEdit: false,
    corridaAbierta: null,
    flujoCorridas: [],
    flujoCorridasToken: 0,
    flujoCorridasPage: 0,
    flujoCorridasFiltros: { estado: '', negocio: '' },
    flujoDisparadores: [],
    flujoDisparadoresToken: 0,
    flujoDispEditId: null,
    flujoDispFormOpen: false,
    flujoEventos: [],
    flujoEventosToken: 0,
    flujoCorrSub: 'corridas'
  };

  function apiBase() {
    return typeof window.apiBaseUrl === 'function'
      ? window.apiBaseUrl()
      : 'https://campos-ancla-api.web-legal-es.workers.dev';
  }

  function esc(s) {
    return String(s == null ? '' : s);
  }

  function formatCuando(ts) {
    var s = String(ts || '').trim();
    if (!s) return '—';
    var d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    try {
      return d.toLocaleString('es-ES', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    } catch (e) {
      return s;
    }
  }

  function formatVersionLabel(numero, fecha) {
    var n = numero != null ? 'v' + numero : '—';
    if (!fecha) return n;
    return n + ' · ' + String(fecha).slice(0, 10);
  }

  function asciiGrafo(nodos, aristas) {
    var lines = [];
    var byId = {};
    (nodos || []).forEach(function (n) {
      byId[n.id] = n;
      var extra = n.skill || n.flujo_id || '';
      lines.push(
        '• [' + n.tipo + '] ' + n.id + (extra ? ' → ' + extra : '') + (n.label ? ' (' + n.label + ')' : '')
      );
    });
    if ((aristas || []).length) {
      lines.push('');
      lines.push('Aristas:');
      aristas.forEach(function (a) {
        var when = typeof a.cuando === 'boolean' ? ' [' + (a.cuando ? 'sí' : 'no') + ']' : '';
        lines.push('  ' + a.desde + ' → ' + a.hacia + when);
      });
    }
    return lines.join('\n') || '(sin nodos)';
  }

  function mermaidLocal(nodos, aristas) {
    var lines = ['flowchart LR'];
    function safe(id) {
      return String(id || '').replace(/[^a-zA-Z0-9_]/g, '_');
    }
    (nodos || []).forEach(function (n) {
      var sid = safe(n.id);
      var label = String(n.label || n.skill || n.flujo_id || n.tipo || n.id).replace(/"/g, "'");
      if (n.tipo === 'inicio' || n.tipo === 'fin') lines.push('  ' + sid + '((' + label + '))');
      else if (n.tipo === 'decision') lines.push('  ' + sid + '{' + label + '}');
      else lines.push('  ' + sid + '["' + label + '"]');
    });
    (aristas || []).forEach(function (a) {
      var d = safe(a.desde);
      var h = safe(a.hacia);
      if (typeof a.cuando === 'boolean') {
        lines.push('  ' + d + ' -->|"' + (a.cuando ? 'sí' : 'no') + '"| ' + h);
      } else {
        lines.push('  ' + d + ' --> ' + h);
      }
    });
    if (!(nodos || []).length) lines.push('  vacio["Sin nodos"]');
    return lines.join('\n');
  }

  function filaFlujo(f, onAbrir, opts) {
    var o = opts || {};
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'catalogo-fila';
    btn.setAttribute('role', 'listitem');
    btn.dataset.id = f.id;
    btn.title = f.descripcion || f.nombre || f.id;
    btn.setAttribute('aria-label', 'Ver flujo ' + (f.nombre || f.id));
    btn.addEventListener('click', function () {
      onAbrir(f.id);
    });

    var icon = document.createElement('span');
    icon.className = 'catalogo-fila-icon';
    icon.setAttribute('aria-hidden', 'true');
    if (window.ColorEntidad) window.ColorEntidad.applyToEl(icon, f.color);
    if (typeof window.svgPestanaCatalogo === 'function') {
      var svg = window.svgPestanaCatalogo('flujo');
      if (svg) {
        svg.classList.add('catalogo-fila-svg');
        svg.classList.remove('pestana-svg');
        icon.append(svg);
      }
    }
    var main = document.createElement('span');
    main.className = 'catalogo-fila-main';
    var tit = document.createElement('span');
    tit.className = 'catalogo-fila-titulo';
    tit.textContent = f.nombre || f.id;
    var cod = document.createElement('span');
    cod.className = 'catalogo-fila-codigo';
    var partes = [f.id, formatVersionLabel(f.version, null)];
    if (o.showProyecto && (f.proyectoId || f.proyecto_id)) {
      partes.push(f.proyectoId || f.proyecto_id);
    }
    cod.textContent = partes.filter(Boolean).join(' · ');
    main.append(tit, cod);

    var enlace = document.createElement('span');
    enlace.className = 'catalogo-fila-enlace';
    enlace.setAttribute('aria-hidden', 'true');
    enlace.innerHTML =
      '<svg class="catalogo-fila-enlace-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14L21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>';

    btn.append(icon, main, enlace);
    return btn;
  }

  function fetchFlujosJson(qs) {
    var url = apiBase() + '/v1/flujos' + (qs ? '?' + qs : '');
    return fetch(url, { cache: 'no-store' }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok || (data && data.ok === false)) {
          var err = new Error((data && data.error) || 'HTTP ' + res.status);
          err.data = data;
          throw err;
        }
        return data;
      });
    });
  }

  function cargarFlujos(proy, opts) {
    var o = opts || {};
    if (!proy || !proy.id) return;
    st.proyectoId = proy.id;
    st.origenLista = 'proyecto';
    var token = ++st.flujosToken;
    var estado = document.getElementById('proyFlujosEstado');
    var lista = document.getElementById('proyFlujosLista');
    if (estado) {
      estado.hidden = false;
      estado.textContent = 'Cargando flujos…';
    }
    if (lista && !o.keep) lista.replaceChildren();

    fetchFlujosJson('proyecto=' + encodeURIComponent(proy.id))
      .then(function (data) {
        if (token !== st.flujosToken) return;
        st.flujos = (data && data.flujos) || [];
        pintarListaFlujosProyecto();
      })
      .catch(function (err) {
        if (token !== st.flujosToken) return;
        if (estado) {
          estado.hidden = false;
          if (typeof window.showApiErrorRaw === 'function') {
            window.showApiErrorRaw(estado, err, { kind: 'is-err', statusLabel: true });
          } else {
            estado.textContent = err.message || 'Error';
          }
        }
      });
  }

  function pintarListaFlujosProyecto() {
    var estado = document.getElementById('proyFlujosEstado');
    var lista = document.getElementById('proyFlujosLista');
    if (!lista) return;
    lista.replaceChildren();
    if (!st.flujos.length) {
      if (estado) {
        estado.hidden = false;
        estado.textContent = 'Sin flujos en esta base. Crea uno o usa la semilla reservas-descubrir-mapear.';
      }
      return;
    }
    if (estado) estado.hidden = true;
    st.flujos.forEach(function (f) {
      lista.append(filaFlujo(f, abrirFlujo, { showProyecto: false }));
    });
  }

  /** Catálogo top-level: todos los flujos de todas las BDs. */
  function cargarCatalogo() {
    st.origenLista = 'catalogo';
    var token = ++st.catalogToken;
    var estado = document.getElementById('flujosEstado');
    var lista = document.getElementById('flujos-root');
    if (estado) {
      estado.hidden = false;
      estado.textContent = 'Cargando flujos…';
    }
    if (lista) lista.replaceChildren();

    fetchFlujosJson('')
      .then(function (data) {
        if (token !== st.catalogToken) return;
        st.catalogFlujos = (data && data.flujos) || [];
        pintarListaFlujosCatalogo();
      })
      .catch(function (err) {
        if (token !== st.catalogToken) return;
        if (estado) {
          estado.hidden = false;
          if (typeof window.showApiErrorRaw === 'function') {
            window.showApiErrorRaw(estado, err, { kind: 'is-err', statusLabel: true });
          } else {
            estado.textContent = err.message || 'Error';
          }
        }
      });
  }

  function pintarListaFlujosCatalogo() {
    var estado = document.getElementById('flujosEstado');
    var lista = document.getElementById('flujos-root');
    if (!lista) return;
    lista.replaceChildren();
    if (!st.catalogFlujos.length) {
      if (estado) {
        estado.hidden = false;
        estado.textContent = 'Sin flujos. Crea uno desde aquí o desde una Base de datos.';
      }
      return;
    }
    if (estado) estado.hidden = true;
    st.catalogFlujos.forEach(function (f) {
      lista.append(filaFlujo(f, abrirFlujo, { showProyecto: true }));
    });
  }

  function refrescarListasTrasCambio() {
    if (st.proyectoId) cargarFlujos({ id: st.proyectoId });
    var panel = document.getElementById('panel-flujos');
    if (panel && !panel.hidden) cargarCatalogo();
  }

  var flujoAsocSub = 'base-datos';

  function skillsDelGrafo(f) {
    var ids = [];
    var seen = {};
    (f && f.nodos || []).forEach(function (n) {
      var sid = n && n.skill ? String(n.skill).trim() : '';
      if (!sid || seen[sid]) return;
      seen[sid] = true;
      ids.push(sid);
    });
    return ids;
  }

  function pintarFlujoSkillsGrafo(f) {
    var mount = document.getElementById('flujoSkillsGrafoLista');
    var vacio = document.getElementById('flujoSkillsGrafoVacio');
    if (!mount) return;
    var ids = skillsDelGrafo(f);
    if (!ids.length) {
      mount.replaceChildren();
      if (vacio) {
        vacio.hidden = false;
        vacio.textContent = 'Ninguna skill en los nodos del grafo.';
      }
      return;
    }
    if (vacio) vacio.hidden = true;
    if (!window.SkillsUI || typeof window.SkillsUI.montarLista !== 'function') {
      mount.textContent = ids.join(', ');
      return;
    }
    function bridgeCon(instrucciones, ready, indexError) {
      return {
        getSnapshot: function () {
          return {
            ready: ready,
            indexError: !!indexError,
            instrucciones: instrucciones || [],
            abierta: null
          };
        },
        abrirSkill: function (id) {
          if (typeof window.abrirVistaSkill === 'function') window.abrirVistaSkill(id);
        },
        añadirSkill: function () {}
      };
    }
    var listaLocal = (typeof state !== 'undefined' && state.instrucciones || []).filter(function (ins) {
      return ids.indexOf(ins.id) >= 0;
    });
    window.SkillsUI.montarLista(mount, bridgeCon(listaLocal, true, false), {
      emptyMsg: 'Ninguna skill en los nodos del grafo.'
    });
  }

  function seleccionarFlujoAsocSub(id) {
    if (id !== 'base-datos' && id !== 'skills') id = 'base-datos';
    flujoAsocSub = id;
    var tabs = document.querySelectorAll('#flujoAsociadosSubtabs [data-flujo-asoc-sub]');
    tabs.forEach(function (btn) {
      var on = btn.getAttribute('data-flujo-asoc-sub') === id;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('#flujoPanelAsociados [data-flujo-asoc-pane]').forEach(function (pane) {
      pane.hidden = pane.getAttribute('data-flujo-asoc-pane') !== id;
    });
    var f = st.flujoAbierto;
    if (!f) return;
    if (id === 'base-datos') pintarFlujoBaseDatos();
    if (id === 'skills') pintarFlujoSkillsGrafo(f);
  }

  function seleccionarFlujoCorrSub(id) {
    if (id !== 'corridas' && id !== 'eventos') id = 'corridas';
    st.flujoCorrSub = id;
    var tabs = document.querySelectorAll('#flujoCorridasSubtabs [data-flujo-corr-sub]');
    tabs.forEach(function (btn) {
      var on = btn.getAttribute('data-flujo-corr-sub') === id;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('#flujoPanelCorridas [data-flujo-corr-pane]').forEach(function (pane) {
      pane.hidden = pane.getAttribute('data-flujo-corr-pane') !== id;
    });
    if (id === 'corridas') cargarFlujoCorridas();
    if (id === 'eventos') cargarFlujoEventos();
  }

  function seleccionarFlujoTab(id) {
    if (id === 'base-datos' || id === 'skills') {
      flujoAsocSub = id === 'skills' ? 'skills' : 'base-datos';
      id = 'asociados';
    }
    var tabs = document.querySelectorAll('#flujoReaderTabs [data-flujo-tab]');
    var panels = {
      resumen: document.getElementById('flujoPanelResumen'),
      asociados: document.getElementById('flujoPanelAsociados'),
      documento: document.getElementById('flujoPanelDocumento'),
      versiones: document.getElementById('flujoPanelVersiones'),
      disparadores: document.getElementById('flujoPanelDisparadores'),
      corridas: document.getElementById('flujoPanelCorridas'),
      interno: document.getElementById('flujoPanelInterno')
    };
    tabs.forEach(function (btn) {
      var on = btn.getAttribute('data-flujo-tab') === id;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    Object.keys(panels).forEach(function (key) {
      if (panels[key]) panels[key].hidden = key !== id;
    });
    if (id === 'resumen') pintarFlujoResumenGrafo();
    if (id === 'asociados') seleccionarFlujoAsocSub(flujoAsocSub || 'base-datos');
    if (id === 'documento') pintarFlujoDocumento();
    if (id === 'versiones') pintarFlujoVersionesTab();
    if (id === 'disparadores') cargarFlujoDisparadores();
    if (id === 'corridas') seleccionarFlujoCorrSub(st.flujoCorrSub || 'corridas');
  }

  function renderHistorialFlujo() {
    var pop = document.getElementById('historialFlujo');
    var lista = document.getElementById('historialFlujoLista');
    var btn = document.getElementById('btnHistorialFlujo');
    if (!pop || !lista) return;
    pop.hidden = !st.flujoHistorial;
    if (btn) btn.setAttribute('aria-expanded', st.flujoHistorial ? 'true' : 'false');
    lista.replaceChildren();
    var f = st.flujoAbierto;
    if (!f) return;
    var vers = f.versiones || [];
    vers
      .slice()
      .reverse()
      .forEach(function (v) {
        var li = document.createElement('li');
        var b = document.createElement('button');
        b.type = 'button';
        b.dataset.numero = String(v.numero);
        b.textContent = formatVersionLabel(v.numero, v.fecha);
        if (st.flujoVersion === v.numero || (!st.flujoVersion && v.numero === f.version)) {
          b.setAttribute('aria-current', 'true');
        }
        li.append(b);
        lista.append(li);
      });
  }

  function pintarFlujoFicha() {
    var f = st.flujoAbierto;
    if (!f) return;
    var nombre = document.getElementById('flujoReaderNombre');
    var ver = document.getElementById('flujoReaderVersion');
    if (nombre) nombre.textContent = f.nombre || f.id;
    if (ver) ver.textContent = formatVersionLabel(f.version, null);
    var idEl = document.getElementById('flujoReaderId');
    var proyEl = document.getElementById('flujoReaderProyecto');
    var descEl = document.getElementById('flujoReaderDesc');
    var countEl = document.getElementById('flujoReaderNodosCount');
    if (idEl) idEl.textContent = f.id || '—';
    if (proyEl) proyEl.textContent = f.proyectoId || '—';
    if (descEl) descEl.textContent = f.descripcion || '—';
    if (countEl) {
      countEl.textContent =
        (f.nodos || []).length + ' nodos · ' + (f.aristas || []).length + ' aristas';
    }
    var iv = document.getElementById('flujoInternoVersion');
    var ih = document.getElementById('flujoInternoHash');
    if (iv) iv.textContent = String(f.version != null ? f.version : '—');
    if (ih) ih.textContent = f.hash || '—';
    renderHistorialFlujo();
    var editWrap = document.getElementById('flujoEditWrap');
    if (editWrap) editWrap.hidden = !st.flujoEdit;
    if (st.flujoEdit) rellenarEditorFlujo();
    var onRes = document.querySelector('#flujoReaderTabs [data-flujo-tab="resumen"].is-on');
    if (onRes) pintarFlujoResumenGrafo();
    var onAsoc = document.querySelector('#flujoReaderTabs [data-flujo-tab="asociados"].is-on');
    if (onAsoc) seleccionarFlujoAsocSub(flujoAsocSub || 'base-datos');
    var onDoc = document.querySelector('#flujoReaderTabs [data-flujo-tab="documento"].is-on');
    if (onDoc) pintarFlujoDocumento();
    var onVer = document.querySelector('#flujoReaderTabs [data-flujo-tab="versiones"].is-on');
    if (onVer) pintarFlujoVersionesTab();
    var onDisp = document.querySelector('#flujoReaderTabs [data-flujo-tab="disparadores"].is-on');
    if (onDisp) cargarFlujoDisparadores();
    var onCor = document.querySelector('#flujoReaderTabs [data-flujo-tab="corridas"].is-on');
    if (onCor) seleccionarFlujoCorrSub(st.flujoCorrSub || 'corridas');
    var dlg = document.getElementById('dlgFlujo');
    if (dlg && typeof window.cablearColorFicha === 'function') {
      window.cablearColorFicha(dlg, {
        kind: 'flujo',
        id: f.id,
        iconKind: 'flujo',
        getColor: function () { return f.color; },
        getUsados: function () {
          return typeof window.coloresUsadosCatalogo === 'function'
            ? window.coloresUsadosCatalogo('flujo', f.id)
            : [];
        },
        onSaved: function (hex) {
          f.color = hex;
          if (st.flujoAbierto) st.flujoAbierto.color = hex;
          st.flujos.forEach(function (x) { if (x.id === f.id) x.color = hex; });
          st.catalogFlujos.forEach(function (x) { if (x.id === f.id) x.color = hex; });
          pintarListaFlujosProyecto();
          pintarListaFlujosCatalogo();
        }
      });
    }
  }

  function renderGrafoEn(el, src) {
    if (!el) return;
    if (typeof window.renderMermaidEn === 'function') {
      window.renderMermaidEn(el, src);
    } else {
      el.textContent = src;
    }
  }

  function pintarFlujoResumenGrafo() {
    var f = st.flujoAbierto;
    if (!f) return;
    var src = f.mermaid || mermaidLocal(f.nodos, f.aristas);
    renderGrafoEn(document.getElementById('flujoGrafoResumen'), src);
  }

  function pintarFlujoDocumento() {
    var f = st.flujoAbierto;
    if (!f) return;
    var render = document.getElementById('flujoGrafoRender');
    var ascii = document.getElementById('flujoGrafoAscii');
    var lista = document.getElementById('flujoNodosLista');
    var src = f.mermaid || mermaidLocal(f.nodos, f.aristas);
    renderGrafoEn(render, src);
    if (ascii) {
      ascii.hidden = false;
      ascii.textContent = asciiGrafo(f.nodos, f.aristas);
    }
    if (lista) {
      lista.replaceChildren();
      (f.nodos || []).forEach(function (n) {
        var li = document.createElement('li');
        var parts = ['[' + n.tipo + ']', n.id];
        if (n.skill) parts.push('skill=' + n.skill);
        if (n.flujo_id) parts.push('flujo_id=' + n.flujo_id);
        if (n.condicion) parts.push('cond=' + JSON.stringify(n.condicion));
        li.innerHTML = parts
          .map(function (p, i) {
            return i === 1 ? '<code>' + esc(p) + '</code>' : esc(p);
          })
          .join(' ');
        lista.append(li);
      });
    }
  }

  function pintarFlujoBaseDatos() {
    var mount = document.getElementById('flujoBaseDatosLista');
    var vacio = document.getElementById('flujoBaseDatosVacio');
    var f = st.flujoAbierto;
    if (!mount || !f) return;
    var pid = f.proyectoId || f.proyecto_id;
    if (!pid) {
      mount.replaceChildren();
      if (vacio) {
        vacio.hidden = false;
        vacio.textContent = 'Sin base de datos vinculada.';
      }
      return;
    }
    if (vacio) vacio.hidden = true;
    if (!window.ProyectosUI || typeof window.ProyectosUI.montarLista !== 'function') {
      mount.textContent = pid || '—';
      return;
    }

    function bridgeCon(proyectos, ready, indexError) {
      return {
        getSnapshot: function () {
          return {
            ready: ready,
            indexError: !!indexError,
            proyectos: proyectos || [],
            abierta: null
          };
        },
        añadirProyecto: function () {},
        abrirProyecto: function (id) {
          cerrarFlujo();
          if (typeof window.abrirProyecto === 'function') window.abrirProyecto(id);
        }
      };
    }

    var lista =
      (typeof window.listaProyectosCatalogo === 'function' && window.listaProyectosCatalogo()) ||
      (window.state && window.state.proyectos && window.state.proyectos.lista) ||
      [];
    var proy = (lista || []).find(function (p) {
      return p && p.id === pid;
    });
    if (proy) {
      window.ProyectosUI.montarLista(mount, bridgeCon([proy], true, false), {
        emptyMsg: 'Sin base de datos padre.'
      });
      return;
    }
    // Fallback: fila mínima si el índice aún no cargó el proyecto.
    if (pid) {
      window.ProyectosUI.montarLista(
        mount,
        bridgeCon(
          [
            {
              id: pid,
              nombre: pid,
              descripcion: '',
              versiones: [{ numero: 1, fecha: '' }],
              skills: []
            }
          ],
          true,
          false
        ),
        { emptyMsg: 'Sin base de datos padre.' }
      );
    } else {
      window.ProyectosUI.montarLista(mount, bridgeCon([], true, false), {
        emptyMsg: 'No se encontró la base de datos padre.'
      });
    }
  }

  function cargarFlujoCorridas(opts) {
    var o = opts || {};
    var f = st.flujoAbierto;
    var estado = document.getElementById('flujoCorridasEstado');
    var wrap = document.getElementById('flujoCorridasTablaWrap');
    var pager = document.getElementById('flujoCorridasPager');
    if (!f) return;
    if (o.resetPage !== false) st.flujoCorridasPage = 0;
    if (o.readFilters !== false) {
      var est = document.getElementById('flujoCorridasEstadoFiltro');
      var neg = document.getElementById('flujoCorridasNegocio');
      st.flujoCorridasFiltros = {
        estado: est ? String(est.value || '').trim() : '',
        negocio: neg ? String(neg.value || '').trim() : ''
      };
    }
    var token = ++st.flujoCorridasToken;
    if (estado) {
      estado.hidden = false;
      estado.textContent = 'Cargando corridas…';
    }
    if (wrap) wrap.hidden = true;
    if (pager) pager.hidden = true;
    var qs = new URLSearchParams();
    qs.set('flujo_id', f.id);
    if (f.proyectoId || f.proyecto_id) qs.set('proyecto', f.proyectoId || f.proyecto_id);
    if (st.flujoCorridasFiltros.estado) qs.set('estado', st.flujoCorridasFiltros.estado);
    if (st.flujoCorridasFiltros.negocio) qs.set('negocio', st.flujoCorridasFiltros.negocio);
    fetch(apiBase() + '/v1/corridas?' + qs.toString(), { cache: 'no-store' })
      .then(function (res) {
        return res.text().then(function (raw) {
          var data = null;
          try {
            data = raw ? JSON.parse(raw) : {};
          } catch (e) {
            data = null;
          }
          if (!res.ok || (data && data.ok === false)) {
            var err = new Error((data && data.error) || 'HTTP ' + res.status);
            err.status = res.status;
            err.data = data;
            err.rawBody = raw;
            throw err;
          }
          return data;
        });
      })
      .then(function (data) {
        if (token !== st.flujoCorridasToken) return;
        st.flujoCorridas = (data && data.corridas) || [];
        pintarTablaFlujoCorridas();
      })
      .catch(function (err) {
        if (token !== st.flujoCorridasToken) return;
        if (estado && typeof window.showApiErrorRaw === 'function') {
          estado.hidden = false;
          window.showApiErrorRaw(estado, err, { kind: 'is-err', statusLabel: true });
        } else if (estado) {
          estado.hidden = false;
          estado.textContent = err.message || 'Error';
        }
      });
  }

  function pintarTablaFlujoCorridas() {
    var body = document.getElementById('flujoCorridasBody');
    var wrap = document.getElementById('flujoCorridasTablaWrap');
    var vacio = document.getElementById('flujoCorridasEstado');
    var pager = document.getElementById('flujoCorridasPager');
    var btnPrev = document.getElementById('btnFlujoCorridasPrev');
    var btnNext = document.getElementById('btnFlujoCorridasNext');
    var info = document.getElementById('flujoCorridasPagerInfo');
    if (!body) return;
    body.replaceChildren();
    var all = st.flujoCorridas || [];
    if (!all.length) {
      if (wrap) wrap.hidden = true;
      if (pager) pager.hidden = true;
      if (vacio) {
        vacio.hidden = false;
        vacio.textContent = 'Sin corridas de este flujo.';
      }
      return;
    }
    if (vacio) vacio.hidden = true;
    if (wrap) wrap.hidden = false;
    var totalPages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
    if (st.flujoCorridasPage >= totalPages) st.flujoCorridasPage = totalPages - 1;
    if (st.flujoCorridasPage < 0) st.flujoCorridasPage = 0;
    var start = st.flujoCorridasPage * PAGE_SIZE;
    var slice = all.slice(start, start + PAGE_SIZE);
    slice.forEach(function (c) {
      var tr = document.createElement('tr');
      tr.dataset.corridaId = c.id;
      var tdNeg = document.createElement('td');
      tdNeg.textContent = c.negocio || '—';
      var tdEst = document.createElement('td');
      var badge = document.createElement('span');
      badge.className = 'corrida-badge is-' + (c.estado || '');
      badge.textContent = c.estado || '—';
      tdEst.append(badge);
      var tdCre = document.createElement('td');
      tdCre.textContent = formatCuando(c.creada || c.actualizada);
      var tdPaso = document.createElement('td');
      tdPaso.textContent = c.paso_actual || '—';
      tr.append(tdNeg, tdEst, tdCre, tdPaso);
      body.append(tr);
    });
    if (pager) pager.hidden = all.length <= PAGE_SIZE;
    if (info) {
      info.textContent =
        'Pág. ' + (st.flujoCorridasPage + 1) + ' / ' + totalPages + ' · ' + all.length + ' corridas';
    }
    if (btnPrev) {
      btnPrev.hidden = st.flujoCorridasPage <= 0;
      btnPrev.disabled = st.flujoCorridasPage <= 0;
    }
    if (btnNext) {
      btnNext.hidden = st.flujoCorridasPage >= totalPages - 1;
      btnNext.disabled = st.flujoCorridasPage >= totalPages - 1;
    }
  }

  function pintarFlujoVersionesTab() {
    var lista = document.getElementById('flujoVersionesLista');
    var f = st.flujoAbierto;
    if (!lista || !f) return;
    lista.replaceChildren();
    (f.versiones || [])
      .slice()
      .reverse()
      .forEach(function (v) {
        var li = document.createElement('li');
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'catalogo-fila';
        b.style.width = '100%';
        b.dataset.numero = String(v.numero);
        var main = document.createElement('span');
        main.className = 'catalogo-fila-main';
        var tit = document.createElement('span');
        tit.className = 'catalogo-fila-titulo';
        tit.textContent = formatVersionLabel(v.numero, v.fecha);
        var cod = document.createElement('span');
        cod.className = 'catalogo-fila-codigo';
        cod.textContent = v.hash || '';
        main.append(tit, cod);
        b.append(main);
        if (v.numero === f.version) b.classList.add('is-open');
        b.addEventListener('click', function () {
          abrirFlujo(f.id, v.numero);
        });
        li.append(b);
        lista.append(li);
      });
    if (!(f.versiones || []).length) {
      var empty = document.createElement('li');
      empty.textContent = 'Sin versiones.';
      lista.append(empty);
    }
  }

  function rellenarEditorFlujo() {
    var f = st.flujoAbierto;
    if (!f) return;
    var nEl = document.getElementById('flujoEditNombre');
    var dEl = document.getElementById('flujoEditDesc');
    var noEl = document.getElementById('flujoEditNodos');
    var arEl = document.getElementById('flujoEditAristas');
    if (nEl) nEl.value = f.nombre || '';
    if (dEl) dEl.value = f.descripcion || '';
    if (noEl) noEl.value = JSON.stringify(f.nodos || [], null, 2);
    if (arEl) arEl.value = JSON.stringify(f.aristas || [], null, 2);
  }

  function labelTipoDisp(tipo) {
    if (tipo === 'manual') return 'a mano';
    if (tipo === 'horario') return 'horario';
    if (tipo === 'cambio_datos') return 'cambio datos';
    if (tipo === 'webhook') return 'webhook';
    return tipo || '—';
  }

  function resumenDisp(d) {
    if (!d) return '—';
    if (d.tipo === 'manual') return 'botón Lanzar';
    if (d.tipo === 'horario') {
      return (d.cron || '—') + (d.coleccion ? ' · ' + d.coleccion : '');
    }
    if (d.tipo === 'cambio_datos') {
      var ops = Array.isArray(d.operaciones) ? d.operaciones.join(',') : '';
      return (d.coleccion || '—') + (ops ? ' · ' + ops : '');
    }
    if (d.tipo === 'webhook') {
      return d.token ? 'token …' + String(d.token).slice(-6) : 'sin token';
    }
    return d.id || '—';
  }

  function webhookUrlPublica(flujoId, token) {
    return apiBase() + '/v1/disparar/' + encodeURIComponent(flujoId) + '/' + encodeURIComponent(token || '');
  }

  function formatHoraCorta(ts) {
    var s = String(ts || '').trim();
    if (!s) return '—';
    var d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    try {
      return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return s;
    }
  }

  function cargarFlujoDisparadores() {
    var f = st.flujoAbierto;
    var estado = document.getElementById('flujoDisparadoresEstado');
    var wrap = document.getElementById('flujoDisparadoresTablaWrap');
    if (!f) return;
    var token = ++st.flujoDisparadoresToken;
    if (estado) {
      estado.hidden = false;
      estado.textContent = 'Cargando…';
    }
    if (wrap) wrap.hidden = true;
    fetch(apiBase() + '/v1/flujos/' + encodeURIComponent(f.id) + '/disparadores', { cache: 'no-store' })
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok || (data && data.ok === false)) {
            throw new Error((data && data.error) || 'HTTP ' + res.status);
          }
          return data;
        });
      })
      .then(function (data) {
        if (token !== st.flujoDisparadoresToken) return;
        st.flujoDisparadores = (data && data.disparadores) || [];
        pintarTablaDisparadores();
      })
      .catch(function (err) {
        if (token !== st.flujoDisparadoresToken) return;
        if (estado) {
          estado.hidden = false;
          estado.textContent = err.message || 'Error al cargar';
        }
      });
  }

  function pintarTablaDisparadores() {
    var estado = document.getElementById('flujoDisparadoresEstado');
    var wrap = document.getElementById('flujoDisparadoresTablaWrap');
    var body = document.getElementById('flujoDisparadoresBody');
    if (!body) return;
    body.replaceChildren();
    var list = st.flujoDisparadores || [];
    if (!list.length) {
      if (estado) {
        estado.hidden = false;
        estado.textContent = 'Sin disparadores. Usa «+ Añadir disparador».';
      }
      if (wrap) wrap.hidden = true;
      return;
    }
    if (estado) estado.hidden = true;
    if (wrap) wrap.hidden = false;
    list.forEach(function (d) {
      var tr = document.createElement('tr');
      tr.dataset.dispId = d.id;
      tr.style.cursor = 'pointer';
      function td(text) {
        var c = document.createElement('td');
        c.textContent = text;
        return c;
      }
      tr.append(td(labelTipoDisp(d.tipo)));
      var tdRes = document.createElement('td');
      tdRes.textContent = resumenDisp(d);
      if (d.tipo === 'webhook' && d.token && st.flujoAbierto) {
        var url = webhookUrlPublica(st.flujoAbierto.id, d.token);
        var small = document.createElement('div');
        small.className = 'ajustes-hint';
        small.style.margin = '4px 0 0';
        small.style.wordBreak = 'break-all';
        small.textContent = url;
        var copy = document.createElement('button');
        copy.type = 'button';
        copy.className = 'btn ghost';
        copy.textContent = 'Copiar URL';
        copy.style.marginTop = '4px';
        copy.addEventListener('click', function (e) {
          e.stopPropagation();
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url).then(
              function () { copy.textContent = 'Copiado'; },
              function () { window.prompt('Copia la URL', url); }
            );
          } else {
            window.prompt('Copia la URL', url);
          }
        });
        tdRes.append(document.createElement('br'), small, copy);
      }
      tr.append(tdRes);
      tr.append(td(d.activo ? 'Activo' : 'Pausado'));
      tr.append(td(formatHoraCorta(d.ultima_vez)));
      var tdAcc = document.createElement('td');
      tdAcc.style.whiteSpace = 'nowrap';
      var tog = document.createElement('button');
      tog.type = 'button';
      tog.className = 'btn ghost';
      tog.textContent = d.activo ? 'Pausar' : 'Activar';
      tog.addEventListener('click', function (e) {
        e.stopPropagation();
        toggleDisparadorActivo(d);
      });
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn ghost';
      del.textContent = 'Borrar';
      del.addEventListener('click', function (e) {
        e.stopPropagation();
        borrarDisparador(d);
      });
      tdAcc.append(tog, del);
      tr.append(tdAcc);
      tr.addEventListener('click', function () {
        abrirFormDisparador(d);
      });
      body.append(tr);
    });
  }

  function syncDispCamposPorTipo() {
    var tipo = (document.getElementById('flujoDispTipo') || {}).value || 'manual';
    var h = document.getElementById('flujoDispCamposHorario');
    var c = document.getElementById('flujoDispCamposCambio');
    var w = document.getElementById('flujoDispCamposWebhook');
    if (h) h.hidden = tipo !== 'horario';
    if (c) c.hidden = tipo !== 'cambio_datos';
    if (w) w.hidden = tipo !== 'webhook';
  }

  function leerFormDisparador() {
    var tipo = (document.getElementById('flujoDispTipo') || {}).value || 'manual';
    var id = String((document.getElementById('flujoDispId') || {}).value || '').trim();
    var negocio = String((document.getElementById('flujoDispNegocio') || {}).value || '').trim();
    var anti = (document.getElementById('flujoDispAnti') || {}).value !== 'false';
    var agrupar = Number((document.getElementById('flujoDispAgrupar') || {}).value || 0) || 0;
    var pipeRaw = (document.getElementById('flujoDispPipeline') || {}).value || '[]';
    var pipeline;
    try {
      pipeline = JSON.parse(pipeRaw);
    } catch (e) {
      throw new Error('Pipeline JSON inválido: ' + (e.message || e));
    }
    var body = {
      id: id,
      tipo: tipo,
      negocio: negocio,
      anti_bucle: anti,
      agrupar_segundos: agrupar,
      pipeline: pipeline,
      activo: true
    };
    if (tipo === 'horario') {
      body.cron = String((document.getElementById('flujoDispCron') || {}).value || '').trim();
      body.coleccion = String((document.getElementById('flujoDispColeccionH') || {}).value || '').trim();
    }
    if (tipo === 'cambio_datos') {
      body.coleccion = String((document.getElementById('flujoDispColeccionC') || {}).value || '').trim();
      var opsRaw = (document.getElementById('flujoDispOps') || {}).value || '[]';
      try {
        body.operaciones = JSON.parse(opsRaw);
      } catch (e2) {
        throw new Error('Operaciones JSON inválido');
      }
    }
    return body;
  }

  function abrirFormDisparador(d) {
    st.flujoDispFormOpen = true;
    st.flujoDispEditId = d && d.id ? d.id : null;
    var wrap = document.getElementById('flujoDisparadorFormWrap');
    var tit = document.getElementById('flujoDisparadorFormTitulo');
    if (wrap) wrap.hidden = false;
    if (tit) tit.textContent = d ? 'Editar ' + d.id : 'Nuevo disparador';
    var idEl = document.getElementById('flujoDispId');
    if (idEl) {
      idEl.value = d ? d.id : 'd-' + Math.random().toString(36).slice(2, 6);
      idEl.disabled = !!d;
    }
    var tipoEl = document.getElementById('flujoDispTipo');
    if (tipoEl) tipoEl.value = (d && d.tipo) || 'manual';
    syncDispCamposPorTipo();
    var cron = document.getElementById('flujoDispCron');
    if (cron) cron.value = (d && d.cron) || '0 * * * *';
    var colH = document.getElementById('flujoDispColeccionH');
    if (colH) colH.value = (d && d.coleccion) || 'reservas';
    var colC = document.getElementById('flujoDispColeccionC');
    if (colC) colC.value = (d && d.coleccion) || 'negocios';
    var ops = document.getElementById('flujoDispOps');
    if (ops) ops.value = JSON.stringify((d && d.operaciones) || ['crear', 'actualizar']);
    var neg = document.getElementById('flujoDispNegocio');
    if (neg) neg.value = (d && d.negocio) || '';
    var anti = document.getElementById('flujoDispAnti');
    if (anti) anti.value = d && d.anti_bucle === false ? 'false' : 'true';
    var agr = document.getElementById('flujoDispAgrupar');
    if (agr) agr.value = String((d && d.agrupar_segundos) || 0);
    var pipe = document.getElementById('flujoDispPipeline');
    if (pipe) pipe.value = JSON.stringify((d && d.pipeline) || [], null, 2);
    var urlEl = document.getElementById('flujoDispWebhookUrl');
    var btnCopy = document.getElementById('btnFlujoDispCopiarUrl');
    if (d && d.tipo === 'webhook' && d.token && st.flujoAbierto) {
      var url = webhookUrlPublica(st.flujoAbierto.id, d.token);
      if (urlEl) urlEl.textContent = url;
      if (btnCopy) btnCopy.hidden = false;
    } else {
      if (urlEl) urlEl.textContent = d ? '(guarda para ver URL)' : '(tras guardar)';
      if (btnCopy) btnCopy.hidden = true;
    }
    var msg = document.getElementById('flujoDispFormMsg');
    if (msg) msg.hidden = true;
    var out = document.getElementById('flujoDispProbarOut');
    if (out) {
      out.hidden = true;
      out.textContent = '';
    }
  }

  function cerrarFormDisparador() {
    st.flujoDispFormOpen = false;
    st.flujoDispEditId = null;
    var wrap = document.getElementById('flujoDisparadorFormWrap');
    if (wrap) wrap.hidden = true;
  }

  function setDispMsg(text, isErr) {
    var msg = document.getElementById('flujoDispFormMsg');
    if (!msg) return;
    msg.hidden = false;
    msg.classList.toggle('is-err', !!isErr);
    msg.classList.toggle('is-ok', !isErr);
    msg.textContent = text;
  }

  function guardarDisparadorForm() {
    var f = st.flujoAbierto;
    if (!f) return;
    var body;
    try {
      body = leerFormDisparador();
    } catch (e) {
      setDispMsg(e.message || String(e), true);
      return;
    }
    if (!body.id) {
      setDispMsg('Falta id', true);
      return;
    }
    setDispMsg('Guardando…', false);
    var editId = st.flujoDispEditId;
    var path = editId
      ? '/v1/disparadores/' + encodeURIComponent(editId)
      : '/v1/flujos/' + encodeURIComponent(f.id) + '/disparadores';
    var method = editId ? 'PUT' : 'POST';
    var payload = Object.assign({}, body);
    if (editId) delete payload.id;
    Promise.resolve()
      .then(function () {
        return typeof window.asegurarClaveCatalogo === 'function'
          ? window.asegurarClaveCatalogo()
          : null;
      })
      .then(function () {
        return window.apiFetchAuth(path, {
          method: method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      })
      .then(function (data) {
        var avisos = (data && data.avisos) || [];
        setDispMsg(
          'Guardado' + (avisos.length ? ' · ' + avisos.join('; ') : ''),
          false
        );
        cerrarFormDisparador();
        cargarFlujoDisparadores();
      })
      .catch(function (err) {
        var raw = err && err.data ? err.data : null;
        setDispMsg((raw && raw.error) || err.message || 'Error al guardar', true);
        if (typeof window.showApiErrorRaw === 'function' && raw) window.showApiErrorRaw(raw);
      });
  }

  function probarDisparadorForm() {
    var f = st.flujoAbierto;
    if (!f) return;
    var body;
    try {
      body = leerFormDisparador();
    } catch (e) {
      setDispMsg(e.message || String(e), true);
      return;
    }
    var out = document.getElementById('flujoDispProbarOut');
    setDispMsg('Probando…', false);
    if (out) {
      out.hidden = false;
      out.textContent = '…';
    }
    var path = st.flujoDispEditId
      ? '/v1/disparadores/' + encodeURIComponent(st.flujoDispEditId) + '/probar'
      : '/v1/flujos/' + encodeURIComponent(f.id) + '/disparadores/probar';
    var payload = {
      tipo: body.tipo,
      coleccion: body.coleccion || null,
      pipeline: body.pipeline || [],
      disparador_id: st.flujoDispEditId || null
    };
    Promise.resolve()
      .then(function () {
        return typeof window.asegurarClaveCatalogo === 'function'
          ? window.asegurarClaveCatalogo()
          : null;
      })
      .then(function () {
        return window.apiFetchAuth(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      })
      .then(function (data) {
        var n = data && data.habria_lanzado != null ? data.habria_lanzado : 0;
        var lines = ['Habría lanzado ' + n + ' corridas.'];
        if (data && data.nota) lines.push(String(data.nota));
        if (data && data.error) lines.push('Error: ' + data.error);
        if (data && data.eventos_probados != null) {
          lines.push('Eventos probados: ' + data.eventos_probados);
        }
        if (data && data.muestra && data.muestra.length) {
          lines.push('Muestra:');
          lines.push(JSON.stringify(data.muestra, null, 2));
        }
        if (out) {
          out.hidden = false;
          out.textContent = lines.join('\n');
        }
        setDispMsg('Prueba lista (no se creó nada)', false);
      })
      .catch(function (err) {
        var raw = err && err.data ? err.data : null;
        setDispMsg((raw && raw.error) || err.message || 'Error al probar', true);
        if (out) {
          out.hidden = false;
          out.textContent = JSON.stringify(raw || { error: err.message }, null, 2);
        }
      });
  }

  function toggleDisparadorActivo(d) {
    if (!d || !d.id) return;
    var path = d.activo
      ? '/v1/disparadores/' + encodeURIComponent(d.id) + '/pausar'
      : '/v1/disparadores/' + encodeURIComponent(d.id) + '/activar';
    Promise.resolve()
      .then(function () {
        return typeof window.asegurarClaveCatalogo === 'function'
          ? window.asegurarClaveCatalogo()
          : null;
      })
      .then(function () {
        return window.apiFetchAuth(path, { method: 'POST' });
      })
      .then(function () {
        cargarFlujoDisparadores();
      })
      .catch(function (err) {
        alert((err && err.message) || 'No se pudo cambiar el estado');
      });
  }

  function borrarDisparador(d) {
    if (!d || !d.id) return;
    if (!window.confirm('¿Borrar disparador «' + d.id + '»?')) return;
    Promise.resolve()
      .then(function () {
        return typeof window.asegurarClaveCatalogo === 'function'
          ? window.asegurarClaveCatalogo()
          : null;
      })
      .then(function () {
        return window.apiFetchAuth('/v1/disparadores/' + encodeURIComponent(d.id), {
          method: 'DELETE'
        });
      })
      .then(function () {
        if (st.flujoDispEditId === d.id) cerrarFormDisparador();
        cargarFlujoDisparadores();
      })
      .catch(function (err) {
        alert((err && err.message) || 'No se pudo borrar');
      });
  }

  function lanzarManualDesdePanel() {
    var f = st.flujoAbierto;
    if (!f) return;
    var manuals = (st.flujoDisparadores || []).filter(function (d) {
      return d.tipo === 'manual' && d.activo;
    });
    var dispId = manuals.length ? manuals[0].id : '';
    var negocio = window.prompt('Negocio para la corrida', 'pelo-sur');
    if (!negocio) return;
    negocio = String(negocio).trim();
    if (!negocio) return;
    var body = { flujo_id: f.id, negocio: negocio, datos_iniciales: {} };
    if (dispId) body.disparador_id = dispId;
    Promise.resolve()
      .then(function () {
        return typeof window.asegurarClaveCatalogo === 'function'
          ? window.asegurarClaveCatalogo()
          : null;
      })
      .then(function () {
        return window.apiFetchAuth('/v1/corridas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
      })
      .then(function (data) {
        var cid = data && data.corrida && data.corrida.id;
        alert(cid ? 'Corrida creada: ' + cid : 'Corrida creada');
        seleccionarFlujoTab('corridas');
      })
      .catch(function (err) {
        var raw = err && err.data ? err.data : null;
        alert((raw && raw.error) || err.message || 'No se pudo lanzar');
      });
  }

  function cargarFlujoEventos() {
    var f = st.flujoAbierto;
    var estado = document.getElementById('flujoEventosEstado');
    var wrap = document.getElementById('flujoEventosTablaWrap');
    if (!f) return;
    var token = ++st.flujoEventosToken;
    if (estado) {
      estado.hidden = false;
      estado.textContent = 'Cargando eventos…';
    }
    if (wrap) wrap.hidden = true;
    var proy = f.proyectoId || st.proyectoId || 'reservas';
    fetch(
      apiBase() + '/v1/eventos?proyecto=' + encodeURIComponent(proy) + '&limit=40',
      { cache: 'no-store' }
    )
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok || (data && data.ok === false)) {
            throw new Error((data && data.error) || 'HTTP ' + res.status);
          }
          return data;
        });
      })
      .then(function (data) {
        if (token !== st.flujoEventosToken) return;
        var all = (data && data.eventos) || [];
        var flujoId = f.id;
        st.flujoEventos = all.filter(function (ev) {
          if (ev.flujo_id && ev.flujo_id === flujoId) return true;
          var resu = ev.resultado || [];
          return resu.some(function (r) {
            return (st.flujoDisparadores || []).some(function (d) {
              return d.id === r.disparador_id;
            });
          });
        });
        // Si aún no hay lista de disparadores, mostrar todos del proyecto (mejor que vacío)
        if (!st.flujoDisparadores.length && !st.flujoEventos.length) {
          st.flujoEventos = all.slice(0, 40);
        }
        pintarTablaEventos();
      })
      .catch(function (err) {
        if (token !== st.flujoEventosToken) return;
        if (estado) {
          estado.hidden = false;
          estado.textContent = err.message || 'Error al cargar eventos';
        }
      });
  }

  function pintarTablaEventos() {
    var estado = document.getElementById('flujoEventosEstado');
    var wrap = document.getElementById('flujoEventosTablaWrap');
    var body = document.getElementById('flujoEventosBody');
    if (!body) return;
    body.replaceChildren();
    var list = st.flujoEventos || [];
    if (!list.length) {
      if (estado) {
        estado.hidden = false;
        estado.textContent = 'Sin eventos recientes.';
      }
      if (wrap) wrap.hidden = true;
      return;
    }
    if (estado) estado.hidden = true;
    if (wrap) wrap.hidden = false;
    list.forEach(function (ev) {
      var tr = document.createElement('tr');
      function td(t) {
        var c = document.createElement('td');
        c.textContent = t;
        return c;
      }
      tr.append(td(formatCuando(ev.creado)));
      tr.append(td(ev.tipo || '—'));
      var colDoc = (ev.coleccion || '—') + (ev.documento_id ? ' / ' + ev.documento_id : '');
      tr.append(td(colDoc));
      var resBits = (ev.resultado || []).map(function (r) {
        if (r.lanzo) return r.disparador_id + ' → ' + (r.corrida_id || 'ok');
        return r.disparador_id + ' · ' + (r.motivo || 'no');
      });
      tr.append(td(resBits.join('; ') || '—'));
      body.append(tr);
    });
  }

  function abrirFlujo(id, version, opts) {
    var o = opts || {};
    var tabInicial = o.tab || 'resumen';
    st.flujoHistorial = false;
    st.flujoEdit = false;
    st.flujoDispFormOpen = false;
    st.flujoCorrSub = 'corridas';
    var dlg = document.getElementById('dlgFlujo');
    var qs = version != null ? '?version=' + encodeURIComponent(version) : '';
    fetch(apiBase() + '/v1/flujos/' + encodeURIComponent(id) + qs, { cache: 'no-store' })
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok || (data && data.ok === false)) {
            var err = new Error((data && data.error) || 'HTTP ' + res.status);
            err.data = data;
            throw err;
          }
          return data;
        });
      })
      .then(function (data) {
        st.flujoAbierto = data.flujo;
        st.flujoVersion = data.flujo && data.flujo.version;
        if (data.flujo && data.flujo.proyectoId) st.proyectoId = data.flujo.proyectoId;
        seleccionarFlujoTab(typeof tabInicial !== 'undefined' ? tabInicial : 'resumen');
        if (dlg) {
          if (typeof window.openFichaPane === 'function') window.openFichaPane(dlg);
          else if (typeof dlg.showModal === 'function' && !dlg.open) dlg.showModal();
        }
        pintarFlujoFicha();
        if (typeof window.iconizarPestanasFicha === 'function') {
          window.iconizarPestanasFicha(document.getElementById('flujoReader'));
        }
      })
      .catch(function (err) {
        console.error(err);
        alert(err.message || 'No se pudo abrir el flujo');
      });
  }

  function cerrarFlujo() {
    var dlg = document.getElementById('dlgFlujo');
    if (dlg && dlg.open) dlg.close();
    st.flujoAbierto = null;
    st.flujoHistorial = false;
    st.flujoEdit = false;
  }

  function guardarFlujoVersion() {
    var f = st.flujoAbierto;
    if (!f) return;
    var msg = document.getElementById('flujoEditMsg');
    var nombre = (document.getElementById('flujoEditNombre') || {}).value || '';
    var desc = (document.getElementById('flujoEditDesc') || {}).value || '';
    var nodosRaw = (document.getElementById('flujoEditNodos') || {}).value || '';
    var aristasRaw = (document.getElementById('flujoEditAristas') || {}).value || '';
    var nodos;
    var aristas;
    try {
      nodos = JSON.parse(nodosRaw);
      aristas = JSON.parse(aristasRaw);
    } catch (e) {
      if (msg) {
        msg.hidden = false;
        msg.classList.add('is-err');
        msg.textContent = 'JSON inválido: ' + (e.message || e);
      }
      return;
    }
    if (msg) {
      msg.hidden = false;
      msg.classList.remove('is-err', 'is-ok');
      msg.textContent = 'Guardando…';
    }
    Promise.resolve()
      .then(function () {
        return typeof window.asegurarClaveCatalogo === 'function'
          ? window.asegurarClaveCatalogo()
          : null;
      })
      .then(function () {
        return window.apiFetchAuth('/v1/flujos/' + encodeURIComponent(f.id), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nombre: nombre.trim(),
            descripcion: desc,
            nodos: nodos,
            aristas: aristas
          })
        });
      })
      .then(function (data) {
        if (!data || data.ok === false) throw new Error((data && data.error) || 'Error');
        st.flujoAbierto = data.flujo;
        st.flujoVersion = data.flujo && data.flujo.version;
        st.flujoEdit = false;
        pintarFlujoFicha();
        refrescarListasTrasCambio();
        if (msg) {
          msg.classList.add('is-ok');
          msg.textContent = 'Versión ' + (data.flujo && data.flujo.version) + ' guardada.';
        }
      })
      .catch(function (err) {
        if (msg && typeof window.showApiErrorRaw === 'function') {
          window.showApiErrorRaw(msg, err, { kind: 'is-err', statusLabel: true });
        } else if (msg) {
          msg.classList.add('is-err');
          msg.textContent = err.message || 'Error';
        }
      });
  }

  function proyectosDisponibles() {
    if (typeof window.listaProyectosCatalogo === 'function') {
      return window.listaProyectosCatalogo() || [];
    }
    if (window.state && window.state.proyectos && Array.isArray(window.state.proyectos.lista)) {
      return window.state.proyectos.lista;
    }
    return [];
  }

  function abrirNuevoFlujo(opts) {
    var o = opts || {};
    var fromCatalog = !!o.fromCatalog;
    var dlg = document.getElementById('dlgNuevoFlujo');
    var err = document.getElementById('nuevoFlujoError');
    var wrap = document.getElementById('nuevoFlujoProyectoWrap');
    var sel = document.getElementById('nuevoFlujoProyecto');
    var hint = document.getElementById('nuevoFlujoHint');
    if (err) {
      err.hidden = true;
      err.textContent = '';
    }
    var needProy = fromCatalog || !st.proyectoId;
    if (wrap) wrap.hidden = !needProy;
    if (hint) {
      hint.textContent = needProy
        ? 'Elige la Base de datos (proyecto) y define nodos Inicio/Fin + aristas.'
        : 'Se crea en la Base de datos abierta. Mínimo: nodos con Inicio y Fin + aristas.';
    }
    if (needProy && sel) {
      sel.replaceChildren();
      var opt0 = document.createElement('option');
      opt0.value = '';
      opt0.textContent = '— elegir —';
      sel.append(opt0);
      proyectosDisponibles().forEach(function (p) {
        if (!p || !p.id) return;
        var opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = (p.nombre || p.id) + ' (' + p.id + ')';
        if (st.proyectoId && p.id === st.proyectoId) opt.selected = true;
        sel.append(opt);
      });
      if (typeof window.cargarProyectos === 'function' && !proyectosDisponibles().length) {
        try {
          window.cargarProyectos();
        } catch (e) {}
      }
    }
    if (dlg && typeof dlg.showModal === 'function') dlg.showModal();
  }

  function onSubmitNuevoFlujo(e) {
    e.preventDefault();
    var form = e.target;
    var errEl = document.getElementById('nuevoFlujoError');
    var sel = document.getElementById('nuevoFlujoProyecto');
    var wrap = document.getElementById('nuevoFlujoProyectoWrap');
    var proyectoId = st.proyectoId;
    if (wrap && !wrap.hidden && sel) {
      proyectoId = String(sel.value || '').trim();
    }
    if (!proyectoId) {
      if (errEl) {
        errEl.hidden = false;
        errEl.textContent = 'Elige una Base de datos (proyecto).';
      }
      return;
    }
    var id = String(form.id.value || '').trim();
    var nombre = String(form.nombre.value || '').trim();
    var descripcion = String(form.descripcion.value || '');
    var nodos;
    var aristas;
    try {
      nodos = JSON.parse(form.nodos.value);
      aristas = JSON.parse(form.aristas.value);
    } catch (err) {
      if (errEl) {
        errEl.hidden = false;
        errEl.textContent = 'JSON inválido: ' + (err.message || err);
      }
      return;
    }
    Promise.resolve()
      .then(function () {
        return typeof window.asegurarClaveCatalogo === 'function'
          ? window.asegurarClaveCatalogo()
          : null;
      })
      .then(function () {
        return window.apiFetchAuth('/v1/flujos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: id,
            nombre: nombre,
            descripcion: descripcion,
            proyecto_id: proyectoId,
            nodos: nodos,
            aristas: aristas
          })
        });
      })
      .then(function (data) {
        if (!data || data.ok === false) throw Object.assign(new Error((data && data.error) || 'Error'), { data: data });
        document.getElementById('dlgNuevoFlujo').close();
        st.proyectoId = proyectoId;
        refrescarListasTrasCambio();
        if (data.flujo && data.flujo.id) abrirFlujo(data.flujo.id);
      })
      .catch(function (err) {
        if (errEl && typeof window.showApiErrorRaw === 'function') {
          errEl.hidden = false;
          window.showApiErrorRaw(errEl, err, { kind: 'is-err', statusLabel: true });
        } else if (errEl) {
          errEl.hidden = false;
          errEl.textContent = err.message || 'Error';
        }
      });
  }

  /* ——— Corridas (canónicas en ficha Flujo) ——— */

  /** Compat: ya no hay pestaña BD→Corridas; abre el flujo (o catálogo). */
  function cargarCorridas(proy, opts) {
    var o = opts || {};
    if (proy && proy.id) st.proyectoId = proy.id;
    if (o.flujo_id) {
      irACorridasDeFlujo(o.flujo_id);
      return;
    }
    irACorridasDesdeOperativa();
  }

  function seleccionarCorridaTab(id) {
    var tabs = document.querySelectorAll('#corridaReaderTabs [data-corrida-tab]');
    var panels = {
      pasos: document.getElementById('corridaPanelPasos'),
      datos: document.getElementById('corridaPanelDatos'),
      errores: document.getElementById('corridaPanelErrores'),
      interno: document.getElementById('corridaPanelInterno')
    };
    tabs.forEach(function (btn) {
      var on = btn.getAttribute('data-corrida-tab') === id;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    Object.keys(panels).forEach(function (key) {
      if (panels[key]) panels[key].hidden = key !== id;
    });
  }

  function pintarCorridaFicha() {
    var c = st.corridaAbierta;
    if (!c) return;
    var nombre = document.getElementById('corridaReaderNombre');
    var sub = document.getElementById('corridaReaderSub');
    if (nombre) nombre.textContent = c.id || 'Corrida';
    if (sub) {
      sub.innerHTML = '';
      var badge = document.createElement('span');
      badge.className = 'corrida-badge is-' + (c.estado || '');
      badge.textContent = c.estado || '—';
      sub.append(badge);
      sub.append(document.createTextNode(' · ' + (c.negocio || '—') + ' · ' + (c.flujo_id || '—')));
    }
    var lista = document.getElementById('corridaPasosLista');
    if (lista) {
      lista.replaceChildren();
      var pasos = c.pasos || [];
      if (!pasos.length) {
        var empty = document.createElement('li');
        empty.className = 'ajustes-hint';
        empty.textContent = 'Sin pasos todavía.';
        lista.append(empty);
      }
      pasos.forEach(function (p) {
        var li = document.createElement('li');
        li.className = 'corrida-paso is-' + (p.estado || '');
        var tit = document.createElement('div');
        tit.className = 'corrida-paso-titulo';
        tit.textContent = (p.nodo_id || '—') + (p.skill ? ' · ' + p.skill : '');
        var meta = document.createElement('div');
        meta.className = 'corrida-paso-meta';
        meta.append(document.createTextNode(p.estado || '—'));
        if (p.inicio) meta.append(document.createTextNode(' · ini ' + formatCuando(p.inicio)));
        if (p.fin) meta.append(document.createTextNode(' · fin ' + formatCuando(p.fin)));
        li.append(tit, meta);
        if (p.salidas) {
          var pre = document.createElement('pre');
          pre.className = 'flujo-grafo-ascii';
          try {
            pre.textContent = JSON.stringify(p.salidas, null, 2);
          } catch (e) {
            pre.textContent = String(p.salidas);
          }
          li.append(pre);
        }
        lista.append(li);
      });
    }
    var datosEl = document.getElementById('corridaDatosJson');
    if (datosEl) {
      try {
        datosEl.textContent = JSON.stringify(c.datos || {}, null, 2);
      } catch (e) {
        datosEl.textContent = String(c.datos || '');
      }
    }
    var errEl = document.getElementById('corridaErroresJson');
    if (errEl) {
      try {
        errEl.textContent = JSON.stringify(c.errores || [], null, 2);
      } catch (e) {
        errEl.textContent = String(c.errores || '');
      }
    }
    var set = function (id, v) {
      var el = document.getElementById(id);
      if (el) el.textContent = v != null && v !== '' ? String(v) : '—';
    };
    set('corridaInternoId', c.id);
    set('corridaInternoFlujo', c.flujo_id);
    set('corridaInternoFlujoVer', c.flujo_version);
    set('corridaInternoProyecto', c.proyecto_id);
    set('corridaInternoCreada', formatCuando(c.creada));
    set('corridaInternoActualizada', formatCuando(c.actualizada));
  }

  function abrirCorrida(id) {
    var dlg = document.getElementById('dlgCorrida');
    fetch(apiBase() + '/v1/corridas/' + encodeURIComponent(id), { cache: 'no-store' })
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok || (data && data.ok === false)) {
            var err = new Error((data && data.error) || 'HTTP ' + res.status);
            err.data = data;
            throw err;
          }
          return data;
        });
      })
      .then(function (data) {
        st.corridaAbierta = data.corrida;
        seleccionarCorridaTab('pasos');
        pintarCorridaFicha();
        if (typeof window.iconizarPestanasFicha === 'function') {
          window.iconizarPestanasFicha(document.getElementById('corridaReader'));
        }
        if (dlg) {
          if (typeof window.openFichaPane === 'function') window.openFichaPane(dlg);
          else if (typeof dlg.showModal === 'function' && !dlg.open) dlg.showModal();
        }
      })
      .catch(function (err) {
        console.error(err);
        alert(err.message || 'No se pudo abrir la corrida');
      });
  }

  function cerrarCorrida() {
    var dlg = document.getElementById('dlgCorrida');
    if (dlg && dlg.open) dlg.close();
    st.corridaAbierta = null;
  }

  function irACorridasDeFlujo(flujoId, version) {
    if (!flujoId) {
      irACatalogoFlujos();
      return;
    }
    if (st.flujoAbierto && st.flujoAbierto.id === flujoId) {
      seleccionarFlujoTab('corridas');
      return;
    }
    abrirFlujo(flujoId, version, { tab: 'corridas' });
  }

  function irACatalogoFlujos() {
    if (typeof window.seleccionarCatalogo === 'function') {
      window.seleccionarCatalogo('flujos');
    } else {
      var tab = document.querySelector('#catalogoTabs [data-catalogo="flujos"]');
      if (tab) tab.click();
    }
  }

  /** Operativa / botones: un flujo conocido → su Corridas; si no → catálogo Flujos. */
  function irACorridasDesdeOperativa() {
    var lista = st.flujos || [];
    if (lista.length === 1 && lista[0] && lista[0].id) {
      irACorridasDeFlujo(lista[0].id);
      return;
    }
    if (st.flujoAbierto && st.flujoAbierto.id) {
      seleccionarFlujoTab('corridas');
      return;
    }
    irACatalogoFlujos();
  }

  function abrirNuevaCorrida(prefillFlujo) {
    var dlg = document.getElementById('dlgNuevaCorrida');
    var err = document.getElementById('nuevaCorridaError');
    var flu = document.getElementById('nuevaCorridaFlujo');
    if (err) {
      err.hidden = true;
      err.textContent = '';
    }
    if (flu) {
      flu.value =
        prefillFlujo ||
        (st.flujoAbierto && st.flujoAbierto.id) ||
        (st.flujos[0] && st.flujos[0].id) ||
        'reservas-descubrir-mapear';
    }
    if (dlg && typeof dlg.showModal === 'function') dlg.showModal();
  }

  function onSubmitNuevaCorrida(e) {
    e.preventDefault();
    var form = e.target;
    var errEl = document.getElementById('nuevaCorridaError');
    var flujo_id = String(form.flujo_id.value || '').trim();
    var negocio = String(form.negocio.value || '').trim();
    var datosRaw = String(form.datos_iniciales.value || '').trim();
    var datos_iniciales = undefined;
    if (datosRaw) {
      try {
        datos_iniciales = JSON.parse(datosRaw);
      } catch (err) {
        if (errEl) {
          errEl.hidden = false;
          errEl.textContent = 'datos_iniciales JSON inválido: ' + (err.message || err);
        }
        return;
      }
    }
    var body = { flujo_id: flujo_id, negocio: negocio };
    if (datos_iniciales && typeof datos_iniciales === 'object') body.datos_iniciales = datos_iniciales;
    Promise.resolve()
      .then(function () {
        return typeof window.asegurarClaveCatalogo === 'function'
          ? window.asegurarClaveCatalogo()
          : null;
      })
      .then(function () {
        return window.apiFetchAuth('/v1/corridas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
      })
      .then(function (data) {
        if (!data || data.ok === false) {
          throw Object.assign(new Error((data && data.error) || 'Error'), { data: data });
        }
        document.getElementById('dlgNuevaCorrida').close();
        if (st.flujoAbierto && st.flujoAbierto.id === flujo_id) {
          cargarFlujoCorridas({ resetPage: true, readFilters: true });
        } else if (flujo_id) {
          irACorridasDeFlujo(flujo_id);
        }
        if (data.corrida && data.corrida.id) abrirCorrida(data.corrida.id);
      })
      .catch(function (err) {
        if (errEl && typeof window.showApiErrorRaw === 'function') {
          errEl.hidden = false;
          window.showApiErrorRaw(errEl, err, { kind: 'is-err', statusLabel: true });
        } else if (errEl) {
          errEl.hidden = false;
          errEl.textContent = err.message || 'Error';
        }
      });
  }

  function wire() {
    var btnNuevo = document.getElementById('btnNuevoFlujo');
    if (btnNuevo) btnNuevo.addEventListener('click', function () { abrirNuevoFlujo({ fromCatalog: false }); });
    var btnNuevoCat = document.getElementById('btnNuevoFlujoCatalogo');
    if (btnNuevoCat) {
      btnNuevoCat.addEventListener('click', function () {
        abrirNuevoFlujo({ fromCatalog: true });
      });
    }
    var btnNuevaCorrida = document.getElementById('btnFlujoNuevaCorrida');
    if (btnNuevaCorrida) {
      btnNuevaCorrida.addEventListener('click', function () {
        abrirNuevaCorrida(st.flujoAbierto && st.flujoAbierto.id);
      });
    }
    var cancelCorrida = document.getElementById('nuevaCorridaCancelar');
    if (cancelCorrida) {
      cancelCorrida.addEventListener('click', function () {
        var d = document.getElementById('dlgNuevaCorrida');
        if (d) d.close();
      });
    }
    var formCorrida = document.getElementById('formNuevaCorrida');
    if (formCorrida) formCorrida.addEventListener('submit', onSubmitNuevaCorrida);
    var cancelNuevo = document.getElementById('nuevoFlujoCancelar');
    if (cancelNuevo) {
      cancelNuevo.addEventListener('click', function () {
        var d = document.getElementById('dlgNuevoFlujo');
        if (d) d.close();
      });
    }
    var formNuevo = document.getElementById('formNuevoFlujo');
    if (formNuevo) formNuevo.addEventListener('submit', onSubmitNuevoFlujo);

    var btnAtrasFlujo = document.getElementById('btnAtrasFlujo');
    if (btnAtrasFlujo) {
      btnAtrasFlujo.addEventListener('click', function () {
        if (typeof window.atrasDesdeFicha === 'function') window.atrasDesdeFicha(cerrarFlujo);
        else cerrarFlujo();
      });
    }
    var flujoTabs = document.getElementById('flujoReaderTabs');
    if (flujoTabs) {
      flujoTabs.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-flujo-tab]');
        if (!btn) return;
        seleccionarFlujoTab(btn.getAttribute('data-flujo-tab'));
      });
    }
    var flujoAsocTabs = document.getElementById('flujoAsociadosSubtabs');
    if (flujoAsocTabs) {
      flujoAsocTabs.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-flujo-asoc-sub]');
        if (!btn) return;
        seleccionarFlujoAsocSub(btn.getAttribute('data-flujo-asoc-sub'));
      });
    }
    var btnHist = document.getElementById('btnHistorialFlujo');
    if (btnHist) {
      btnHist.addEventListener('click', function () {
        st.flujoHistorial = !st.flujoHistorial;
        renderHistorialFlujo();
      });
    }
    var histLista = document.getElementById('historialFlujoLista');
    if (histLista) {
      histLista.addEventListener('click', function (e) {
        var b = e.target.closest('[data-numero]');
        if (!b || !st.flujoAbierto) return;
        st.flujoHistorial = false;
        abrirFlujo(st.flujoAbierto.id, Number(b.dataset.numero));
      });
    }
    document.addEventListener('click', function (e) {
      if (
        st.flujoHistorial &&
        !e.target.closest('#historialFlujo') &&
        !e.target.closest('#btnHistorialFlujo')
      ) {
        st.flujoHistorial = false;
        renderHistorialFlujo();
      }
    });
    var btnEdit = document.getElementById('btnEditarFlujo');
    if (btnEdit) {
      btnEdit.addEventListener('click', function () {
        st.flujoEdit = true;
        seleccionarFlujoTab('documento');
        var wrap = document.getElementById('flujoEditWrap');
        if (wrap) wrap.hidden = false;
        rellenarEditorFlujo();
      });
    }
    var btnCancelEdit = document.getElementById('btnCancelarFlujoEdit');
    if (btnCancelEdit) {
      btnCancelEdit.addEventListener('click', function () {
        st.flujoEdit = false;
        var wrap = document.getElementById('flujoEditWrap');
        if (wrap) wrap.hidden = true;
        var msg = document.getElementById('flujoEditMsg');
        if (msg) msg.hidden = true;
      });
    }
    var btnSave = document.getElementById('btnGuardarFlujoVersion');
    if (btnSave) btnSave.addEventListener('click', guardarFlujoVersion);
    var btnCorridas = document.getElementById('btnFlujoVerCorridas');
    if (btnCorridas) {
      btnCorridas.addEventListener('click', function () {
        if (!st.flujoAbierto) return;
        seleccionarFlujoTab('corridas');
      });
    }

    var corrSub = document.getElementById('flujoCorridasSubtabs');
    if (corrSub) {
      corrSub.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-flujo-corr-sub]');
        if (!btn) return;
        seleccionarFlujoCorrSub(btn.getAttribute('data-flujo-corr-sub'));
      });
    }
    var btnAddDisp = document.getElementById('btnFlujoAddDisparador');
    if (btnAddDisp) {
      btnAddDisp.addEventListener('click', function () {
        abrirFormDisparador(null);
      });
    }
    var btnLanzar = document.getElementById('btnFlujoLanzarManual');
    if (btnLanzar) {
      btnLanzar.addEventListener('click', function () {
        lanzarManualDesdePanel();
      });
    }
    var tipoSel = document.getElementById('flujoDispTipo');
    if (tipoSel) {
      tipoSel.addEventListener('change', syncDispCamposPorTipo);
    }
    var btnDispGuardar = document.getElementById('btnFlujoDispGuardar');
    if (btnDispGuardar) btnDispGuardar.addEventListener('click', guardarDisparadorForm);
    var btnDispCancel = document.getElementById('btnFlujoDispCancelar');
    if (btnDispCancel) btnDispCancel.addEventListener('click', cerrarFormDisparador);
    var btnDispProbar = document.getElementById('btnFlujoDispProbar');
    if (btnDispProbar) btnDispProbar.addEventListener('click', probarDisparadorForm);
    var btnCopyUrl = document.getElementById('btnFlujoDispCopiarUrl');
    if (btnCopyUrl) {
      btnCopyUrl.addEventListener('click', function () {
        var urlEl = document.getElementById('flujoDispWebhookUrl');
        var url = urlEl ? urlEl.textContent : '';
        if (!url || url === '—') return;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url);
        } else {
          window.prompt('Copia la URL', url);
        }
      });
    }

    var btnFiltrar = document.getElementById('btnFlujoCorridasFiltrar');
    if (btnFiltrar) {
      btnFiltrar.addEventListener('click', function () {
        cargarFlujoCorridas({ resetPage: true });
      });
    }
    var btnPrev = document.getElementById('btnFlujoCorridasPrev');
    if (btnPrev) {
      btnPrev.addEventListener('click', function () {
        st.flujoCorridasPage -= 1;
        pintarTablaFlujoCorridas();
      });
    }
    var btnNext = document.getElementById('btnFlujoCorridasNext');
    if (btnNext) {
      btnNext.addEventListener('click', function () {
        st.flujoCorridasPage += 1;
        pintarTablaFlujoCorridas();
      });
    }
    var body = document.getElementById('flujoCorridasBody');
    if (body) {
      body.addEventListener('click', function (e) {
        var tr = e.target.closest('tr[data-corrida-id]');
        if (!tr) return;
        abrirCorrida(tr.getAttribute('data-corrida-id'));
      });
    }
    var btnAtrasCorrida = document.getElementById('btnAtrasCorrida');
    if (btnAtrasCorrida) {
      btnAtrasCorrida.addEventListener('click', function () {
        if (typeof window.atrasDesdeFicha === 'function') window.atrasDesdeFicha(cerrarCorrida);
        else cerrarCorrida();
      });
    }
    var corridaTabs = document.getElementById('corridaReaderTabs');
    if (corridaTabs) {
      corridaTabs.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-corrida-tab]');
        if (!btn) return;
        seleccionarCorridaTab(btn.getAttribute('data-corrida-tab'));
      });
    }
    var btnIrFlujo = document.getElementById('btnCorridaIrFlujo');
    if (btnIrFlujo) {
      btnIrFlujo.addEventListener('click', function () {
        var c = st.corridaAbierta;
        if (!c || !c.flujo_id) return;
        var ver = c.flujo_version;
        cerrarCorrida();
        abrirFlujo(c.flujo_id, ver);
      });
    }

    var btnOpFlujos = document.getElementById('btnOperativaIrFlujos');
    if (btnOpFlujos) {
      btnOpFlujos.addEventListener('click', function () {
        if (typeof window.seleccionarProyReaderTab === 'function') {
          window.seleccionarProyReaderTab('flujos');
        }
      });
    }
    var btnOpCorridas = document.getElementById('btnOperativaIrCorridas');
    if (btnOpCorridas) {
      btnOpCorridas.addEventListener('click', function () {
        var proyId = st.proyectoId;
        if (!proyId && typeof window.proyectoAbierto === 'function') {
          var p = window.proyectoAbierto();
          if (p && p.id) proyId = p.id;
        }
        if (!proyId && window.state && window.state.proyectos && window.state.proyectos.abiertoId) {
          proyId = window.state.proyectos.abiertoId;
        }
        if (proyId) st.proyectoId = proyId;
        function decide() {
          irACorridasDesdeOperativa();
        }
        if (proyId) {
          var needLoad =
            !st.flujos.length ||
            st.flujos.some(function (f) {
              return f && f.proyectoId && f.proyectoId !== proyId;
            });
          if (needLoad) {
            var startToken = st.flujosToken;
            cargarFlujos({ id: proyId });
            var tries = 0;
            function waitFlujos() {
              tries += 1;
              // cargarFlujos ++token al inicio; al terminar token ya cambió y st.flujos está listo
              if (st.flujosToken !== startToken && tries > 1) {
                decide();
                return;
              }
              if (tries > 40) {
                decide();
                return;
              }
              setTimeout(waitFlujos, 80);
            }
            waitFlujos();
            return;
          }
        }
        decide();
      });
    }
  }

  window.FlujosCorridasUI = {
    cargarFlujos: cargarFlujos,
    cargarCatalogo: cargarCatalogo,
    cargarCorridas: cargarCorridas,
    cargarFlujoCorridas: cargarFlujoCorridas,
    irACorridasDeFlujo: irACorridasDeFlujo,
    irACorridasDesdeOperativa: irACorridasDesdeOperativa,
    abrirFlujo: abrirFlujo,
    abrirCorrida: abrirCorrida,
    abrirNuevoFlujo: abrirNuevoFlujo,
    refrescarListas: refrescarListasTrasCambio,
    pintarListaFlujosProyecto: pintarListaFlujosProyecto,
    pintarListaFlujosCatalogo: pintarListaFlujosCatalogo,
    wire: wire,
    state: st,
    get flujos() { return st.flujos || []; }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }
})();
