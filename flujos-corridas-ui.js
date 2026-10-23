'use strict';

/**
 * Flujos + Corridas UI.
 * - Catálogos → Flujos (lista global + ficha)
 * - Base de datos → Flujos / Corridas (filtrado por proyecto)
 * Depende de helpers globales de catalogo-ui: apiFetch, apiFetchAuth,
 * asegurarClaveCatalogo, showApiErrorRaw, renderMermaidEn, svgPestanaCatalogo,
 * iconizarPestanasFicha, atrasDesdeFicha, apiBaseUrl, openFichaPane, abrirProyecto.
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
    corridas: [],
    corridasToken: 0,
    corridasPage: 0,
    corridasFiltros: { estado: '', negocio: '', flujo_id: '' },
    corridaAbierta: null,
    flujoCorridas: [],
    flujoCorridasToken: 0
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

  function seleccionarFlujoTab(id) {
    var tabs = document.querySelectorAll('#flujoReaderTabs [data-flujo-tab]');
    var panels = {
      resumen: document.getElementById('flujoPanelResumen'),
      'base-datos': document.getElementById('flujoPanelBaseDatos'),
      documento: document.getElementById('flujoPanelDocumento'),
      versiones: document.getElementById('flujoPanelVersiones'),
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
    if (id === 'base-datos') pintarFlujoBaseDatos();
    if (id === 'documento') pintarFlujoDocumento();
    if (id === 'versiones') pintarFlujoVersionesTab();
    if (id === 'corridas') cargarFlujoCorridas();
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
    var onBd = document.querySelector('#flujoReaderTabs [data-flujo-tab="base-datos"].is-on');
    if (onBd) pintarFlujoBaseDatos();
    var onDoc = document.querySelector('#flujoReaderTabs [data-flujo-tab="documento"].is-on');
    if (onDoc) pintarFlujoDocumento();
    var onVer = document.querySelector('#flujoReaderTabs [data-flujo-tab="versiones"].is-on');
    if (onVer) pintarFlujoVersionesTab();
    var onCor = document.querySelector('#flujoReaderTabs [data-flujo-tab="corridas"].is-on');
    if (onCor) cargarFlujoCorridas();
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
    var f = st.flujoAbierto;
    if (!mount || !f) return;
    var pid = f.proyectoId || f.proyecto_id;
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

  function cargarFlujoCorridas() {
    var f = st.flujoAbierto;
    var estado = document.getElementById('flujoCorridasEstado');
    var lista = document.getElementById('flujoCorridasLista');
    if (!f || !lista) return;
    var token = ++st.flujoCorridasToken;
    if (estado) {
      estado.hidden = false;
      estado.textContent = 'Cargando corridas…';
    }
    lista.replaceChildren();
    var qs = new URLSearchParams();
    qs.set('flujo_id', f.id);
    if (f.proyectoId) qs.set('proyecto', f.proyectoId);
    fetch(apiBase() + '/v1/corridas?' + qs.toString(), { cache: 'no-store' })
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
        if (token !== st.flujoCorridasToken) return;
        st.flujoCorridas = (data && data.corridas) || [];
        pintarFlujoCorridasLista();
      })
      .catch(function (err) {
        if (token !== st.flujoCorridasToken) return;
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

  function pintarFlujoCorridasLista() {
    var estado = document.getElementById('flujoCorridasEstado');
    var lista = document.getElementById('flujoCorridasLista');
    if (!lista) return;
    lista.replaceChildren();
    if (!st.flujoCorridas.length) {
      if (estado) {
        estado.hidden = false;
        estado.textContent = 'Sin corridas de este flujo.';
      }
      return;
    }
    if (estado) estado.hidden = true;
    st.flujoCorridas.forEach(function (c) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'catalogo-fila';
      btn.setAttribute('role', 'listitem');
      btn.setAttribute('aria-label', 'Abrir corrida ' + (c.id || ''));
      var icon = document.createElement('span');
      icon.className = 'catalogo-fila-icon';
      icon.setAttribute('aria-hidden', 'true');
      if (typeof window.svgPestanaCatalogo === 'function') {
        var svg = window.svgPestanaCatalogo('corrida');
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
      tit.textContent = c.negocio || c.id || '—';
      var cod = document.createElement('span');
      cod.className = 'catalogo-fila-codigo';
      cod.textContent = [c.estado, c.id, formatCuando(c.actualizada || c.creada)]
        .filter(Boolean)
        .join(' · ');
      main.append(tit, cod);
      var enlace = document.createElement('span');
      enlace.className = 'catalogo-fila-enlace';
      enlace.setAttribute('aria-hidden', 'true');
      enlace.innerHTML =
        '<svg class="catalogo-fila-enlace-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14L21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>';
      btn.append(icon, main, enlace);
      btn.addEventListener('click', function () {
        abrirCorrida(c.id);
      });
      lista.append(btn);
    });
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

  function abrirFlujo(id, version) {
    st.flujoHistorial = false;
    st.flujoEdit = false;
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
        seleccionarFlujoTab('resumen');
        pintarFlujoFicha();
        if (typeof window.iconizarPestanasFicha === 'function') {
          window.iconizarPestanasFicha(document.getElementById('flujoReader'));
        }
        if (dlg) {
          if (typeof window.openFichaPane === 'function') window.openFichaPane(dlg);
          else if (typeof dlg.showModal === 'function' && !dlg.open) dlg.showModal();
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

  /* ——— Corridas ——— */

  function cargarCorridas(proy, opts) {
    var o = opts || {};
    if (!proy || !proy.id) return;
    st.proyectoId = proy.id;
    if (o.resetPage !== false) st.corridasPage = 0;
    if (o.readFilters !== false) {
      var est = document.getElementById('proyCorridasEstado');
      var neg = document.getElementById('proyCorridasNegocio');
      var flu = document.getElementById('proyCorridasFlujo');
      st.corridasFiltros = {
        estado: est ? String(est.value || '').trim() : '',
        negocio: neg ? String(neg.value || '').trim() : '',
        flujo_id: flu ? String(flu.value || '').trim() : ''
      };
    }
    if (o.flujo_id != null) {
      st.corridasFiltros.flujo_id = String(o.flujo_id || '');
      var fluEl = document.getElementById('proyCorridasFlujo');
      if (fluEl) fluEl.value = st.corridasFiltros.flujo_id;
    }
    var token = ++st.corridasToken;
    var vacio = document.getElementById('proyCorridasEstadoMsg');
    if (vacio) {
      vacio.hidden = false;
      vacio.textContent = 'Cargando corridas…';
    }
    var qs = new URLSearchParams();
    qs.set('proyecto', proy.id);
    if (st.corridasFiltros.estado) qs.set('estado', st.corridasFiltros.estado);
    if (st.corridasFiltros.negocio) qs.set('negocio', st.corridasFiltros.negocio);
    if (st.corridasFiltros.flujo_id) qs.set('flujo_id', st.corridasFiltros.flujo_id);

    var base =
      typeof window.apiBaseUrl === 'function'
        ? window.apiBaseUrl()
        : 'https://campos-ancla-api.web-legal-es.workers.dev';
    fetch(base + '/v1/corridas?' + qs.toString(), { cache: 'no-store' })
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
        if (token !== st.corridasToken) return;
        st.corridas = (data && data.corridas) || [];
        pintarTablaCorridas();
      })
      .catch(function (err) {
        if (token !== st.corridasToken) return;
        if (vacio && typeof window.showApiErrorRaw === 'function') {
          vacio.hidden = false;
          window.showApiErrorRaw(vacio, err, { kind: 'is-err', statusLabel: true });
        } else if (vacio) {
          vacio.hidden = false;
          vacio.textContent = err.message || 'Error';
        }
      });
  }

  function pintarTablaCorridas() {
    var body = document.getElementById('proyCorridasBody');
    var wrap = document.getElementById('proyCorridasTablaWrap');
    var vacio = document.getElementById('proyCorridasEstadoMsg');
    var pager = document.getElementById('proyCorridasPager');
    var btnPrev = document.getElementById('btnProyCorridasPrev');
    var btnNext = document.getElementById('btnProyCorridasNext');
    var info = document.getElementById('proyCorridasPagerInfo');
    if (!body) return;
    body.replaceChildren();
    var all = st.corridas || [];
    if (!all.length) {
      if (wrap) wrap.hidden = true;
      if (pager) pager.hidden = true;
      if (vacio) {
        vacio.hidden = false;
        vacio.textContent = 'Sin corridas para estos filtros.';
      }
      return;
    }
    if (vacio) vacio.hidden = true;
    if (wrap) wrap.hidden = false;
    var totalPages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
    if (st.corridasPage >= totalPages) st.corridasPage = totalPages - 1;
    if (st.corridasPage < 0) st.corridasPage = 0;
    var start = st.corridasPage * PAGE_SIZE;
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
      var tdFlu = document.createElement('td');
      tdFlu.textContent = c.flujo_id || '—';
      var tdCre = document.createElement('td');
      tdCre.textContent = formatCuando(c.creada || c.actualizada);
      var tdPaso = document.createElement('td');
      tdPaso.textContent = c.paso_actual || '—';
      tr.append(tdNeg, tdEst, tdFlu, tdCre, tdPaso);
      body.append(tr);
    });
    if (pager) pager.hidden = all.length <= PAGE_SIZE;
    if (info) {
      info.textContent =
        'Pág. ' + (st.corridasPage + 1) + ' / ' + totalPages + ' · ' + all.length + ' corridas';
    }
    if (btnPrev) {
      btnPrev.hidden = st.corridasPage <= 0;
      btnPrev.disabled = st.corridasPage <= 0;
    }
    if (btnNext) {
      btnNext.hidden = st.corridasPage >= totalPages - 1;
      btnNext.disabled = st.corridasPage >= totalPages - 1;
    }
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

  function irACorridasDeFlujo(flujoId) {
    cerrarFlujo();
    if (typeof window.seleccionarProyReaderTab === 'function') {
      window.seleccionarProyReaderTab('corridas');
    }
    var proy = { id: st.proyectoId };
    if (st.flujoAbierto && st.flujoAbierto.proyectoId) proy.id = st.flujoAbierto.proyectoId;
    // st.flujoAbierto may already be null after cerrar — use arg
    cargarCorridas(proy, { flujo_id: flujoId, resetPage: true });
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
        st.corridasFiltros.flujo_id ||
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
        cargarCorridas({ id: st.proyectoId }, { resetPage: true, readFilters: true });
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
    var btnNuevaCorrida = document.getElementById('btnNuevaCorrida');
    if (btnNuevaCorrida) btnNuevaCorrida.addEventListener('click', function () { abrirNuevaCorrida(); });
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
        // Preferir pestaña Corridas de la ficha flujo; si no, ir a BD → Corridas.
        var tab = document.getElementById('flujoTabCorridas');
        if (tab) {
          seleccionarFlujoTab('corridas');
          return;
        }
        var fid = st.flujoAbierto.id;
        var pid = st.flujoAbierto.proyectoId || st.proyectoId;
        cerrarFlujo();
        if (typeof window.seleccionarProyReaderTab === 'function') {
          window.seleccionarProyReaderTab('corridas');
        }
        cargarCorridas({ id: pid }, { flujo_id: fid, resetPage: true });
      });
    }

    var btnFiltrar = document.getElementById('btnProyCorridasFiltrar');
    if (btnFiltrar) {
      btnFiltrar.addEventListener('click', function () {
        cargarCorridas({ id: st.proyectoId }, { resetPage: true });
      });
    }
    var btnPrev = document.getElementById('btnProyCorridasPrev');
    if (btnPrev) {
      btnPrev.addEventListener('click', function () {
        st.corridasPage -= 1;
        pintarTablaCorridas();
      });
    }
    var btnNext = document.getElementById('btnProyCorridasNext');
    if (btnNext) {
      btnNext.addEventListener('click', function () {
        st.corridasPage += 1;
        pintarTablaCorridas();
      });
    }
    var body = document.getElementById('proyCorridasBody');
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
        if (typeof window.seleccionarProyReaderTab === 'function') {
          window.seleccionarProyReaderTab('corridas');
        }
      });
    }
  }

  window.FlujosCorridasUI = {
    cargarFlujos: cargarFlujos,
    cargarCatalogo: cargarCatalogo,
    cargarCorridas: cargarCorridas,
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
