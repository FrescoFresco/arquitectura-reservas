'use strict';

/**
 * Catálogo Ejecutores — ficha Resumen | Skills | Ejecuciones | Interno + CRUD vía API.
 * Skill.ejecutorId (null = implícito agente_externo).
 */
(function () {
  var ejState = {
    ready: false,
    indexError: false,
    lista: [],
    abiertoId: null,
    tab: 'resumen',
    fetchToken: 0
  };

  var TIPOS = ['modelo', 'herramienta', 'integracion', 'humano', 'agente_externo'];

  function normalizeEjecutor(item) {
    if (!item || typeof item !== 'object') return null;
    if (typeof item.id !== 'string' || !item.id.trim()) return null;
    var out = {
      id: item.id.trim(),
      nombre: typeof item.nombre === 'string' ? item.nombre.trim() : item.id.trim(),
      tipo: String(item.tipo || ''),
      config: item.config && typeof item.config === 'object' ? item.config : {},
      timeout_s: Number(item.timeout_s) || 60,
      reintentos: Number(item.reintentos) || 0,
      espera_reintento_s: Number(item.espera_reintento_s) || 0,
      activo: item.activo !== false,
      version: Number(item.version) || 1,
      skills: Array.isArray(item.skills) ? item.skills.map(String) : [],
      createdAt: String(item.createdAt || item.created_at || ''),
      updatedAt: String(item.updatedAt || item.updated_at || '')
    };
    if (Object.prototype.hasOwnProperty.call(item, 'color')) {
      var c = item.color;
      if (c == null || c === '') out.color = null;
      else if (typeof c === 'string' && /^#[0-9A-Fa-f]{6}$/.test(c.trim())) out.color = c.trim().toLowerCase();
    }
    return out;
  }

  function abierto() {
    if (!ejState.abiertoId) return null;
    return ejState.lista.find(function (x) { return x.id === ejState.abiertoId; }) || null;
  }

  function bridgeLista(lista, emptyMsg) {
    return {
      getSnapshot: function () {
        return {
          ready: ejState.ready,
          indexError: ejState.indexError,
          ejecutores: lista || ejState.lista,
          abierta: abierto()
        };
      },
      abrirEjecutor: function (id) { abrir(id); },
      añadirEjecutor: function () { abrirDialogoNuevo(); }
    };
  }

  function pintar() {
    if (window.EjecutoresUI && window.EjecutoresUI.montar) {
      window.EjecutoresUI.montar(bridgeLista());
    }
  }

  async function cargar() {
    var token = ++ejState.fetchToken;
    try {
      var data = await apiFetch('/v1/ejecutores');
      if (token !== ejState.fetchToken) return;
      var list = (data && data.ejecutores) || [];
      ejState.lista = list.map(normalizeEjecutor).filter(Boolean);
      ejState.ready = true;
      ejState.indexError = false;
    } catch (err) {
      if (token !== ejState.fetchToken) return;
      ejState.ready = true;
      ejState.indexError = true;
      ejState.lista = [];
    }
    pintar();
    if (ejState.abiertoId) renderFicha(abierto());
  }

  function seleccionarTab(id) {
    if (!id) id = 'resumen';
    ejState.tab = id;
    var tabs = document.querySelectorAll('#ejReaderTabs [data-ej-tab]');
    tabs.forEach(function (btn) {
      var on = btn.getAttribute('data-ej-tab') === id;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('#dlgEjecutor [data-ej-panel]').forEach(function (pane) {
      pane.hidden = pane.getAttribute('data-ej-panel') !== id;
    });
    var item = abierto();
    if (item && id === 'skills') pintarSkillsTab(item);
    if (item && id === 'ejecuciones') pintarEjecucionesTab(item);
  }

  async function pintarEjecucionesTab(item) {
    var mount = document.getElementById('ejEjecucionesLista');
    var vacio = document.getElementById('ejEjecucionesVacio');
    if (!mount || !item) return;
    mount.replaceChildren();
    if (vacio) {
      vacio.hidden = false;
      vacio.textContent = 'Cargando…';
    }
    try {
      var data = await apiFetch('/v1/ejecutores/' + encodeURIComponent(item.id) + '/ejecuciones?limit=30');
      var list = (data && data.ejecuciones) || [];
      mount.replaceChildren();
      if (!list.length) {
        if (vacio) {
          vacio.hidden = false;
          vacio.textContent = 'Sin ejecuciones todavía.';
        }
        return;
      }
      if (vacio) vacio.hidden = true;
      list.forEach(function (ej) {
        var row = document.createElement('div');
        row.className = 'catalogo-fila';
        var estado = String(ej.estado || '—');
        var skill = ej.skill ? String(ej.skill) : '—';
        var cuando = String(ej.creado || '');
        var ms = ej.duracion_ms != null ? String(ej.duracion_ms) + ' ms' : '';
        row.innerHTML =
          '<div><strong>' +
          skill +
          '</strong> · ' +
          estado +
          (ms ? ' · ' + ms : '') +
          '</div><div class="ajustes-hint">' +
          cuando +
          (ej.corrida_id ? ' · ' + ej.corrida_id : '') +
          '</div>';
        mount.appendChild(row);
      });
    } catch (err) {
      mount.replaceChildren();
      if (vacio) {
        vacio.hidden = false;
        vacio.textContent = 'No se pudieron cargar las ejecuciones.';
      }
    }
  }

  function renderFicha(item) {
    if (!item) return;
    var nombre = document.getElementById('ejReaderNombre');
    if (nombre) nombre.textContent = item.nombre;
    var ver = document.getElementById('ejReaderVersion');
    if (ver) ver.textContent = 'v' + (item.version || 1) + ' · ' + (item.tipo || '');
    var idEl = document.getElementById('ejReaderId');
    if (idEl) idEl.textContent = item.id;
    var tipoEl = document.getElementById('ejResumenTipo');
    if (tipoEl) tipoEl.textContent = item.tipo || '—';
    var actEl = document.getElementById('ejResumenActivo');
    if (actEl) actEl.textContent = item.activo ? 'sí' : 'no';
    var toEl = document.getElementById('ejResumenTimeout');
    if (toEl) toEl.textContent = String(item.timeout_s) + ' s';
    var reEl = document.getElementById('ejResumenReintentos');
    if (reEl) {
      reEl.textContent =
        String(item.reintentos) + ' · espera ' + String(item.espera_reintento_s) + ' s';
    }
    var cfgEl = document.getElementById('ejResumenConfig');
    if (cfgEl) {
      try {
        cfgEl.textContent = JSON.stringify(item.config || {}, null, 2);
      } catch (e) {
        cfgEl.textContent = String(item.config);
      }
    }
    var verInt = document.getElementById('ejInternoVersion');
    if (verInt) verInt.textContent = 'v' + (item.version || 1);
    var created = document.getElementById('ejInternoCreated');
    if (created) created.textContent = item.createdAt || '—';
    var updated = document.getElementById('ejInternoUpdated');
    if (updated) updated.textContent = item.updatedAt || '—';
    pintarSkillsTab(item);
    seleccionarTab(ejState.tab || 'resumen');
  }

  function pintarSkillsTab(item) {
    var mount = document.getElementById('ejSkillsLista');
    var vacio = document.getElementById('ejSkillsVacio');
    if (!mount) return;
    var ids = (item && item.skills) || [];
    var skills = [];
    if (typeof state !== 'undefined' && Array.isArray(state.instrucciones)) {
      skills = state.instrucciones.filter(function (s) { return ids.indexOf(s.id) >= 0; });
    }
    if (!skills.length && ids.length) {
      skills = ids.map(function (id) { return { id: id, nombre: id, descripcion: '', versiones: [{ numero: 1, fecha: '' }] }; });
    }
    mount.replaceChildren();
    if (!skills.length) {
      if (vacio) {
        vacio.hidden = false;
        vacio.textContent = 'Ninguna skill usa este ejecutor.';
      }
      return;
    }
    if (vacio) vacio.hidden = true;
    if (window.SkillsUI && typeof window.SkillsUI.montarLista === 'function') {
      window.SkillsUI.montarLista(mount, {
        getSnapshot: function () {
          return { ready: true, indexError: false, instrucciones: skills, abierta: null };
        },
        abrirSkill: function (id) {
          if (typeof abrirInstruccion === 'function') abrirInstruccion(id);
        },
        añadirSkill: function () {}
      }, { emptyMsg: 'Ninguna skill usa este ejecutor.' });
      return;
    }
    skills.forEach(function (s) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'catalogo-fila';
      btn.textContent = s.nombre || s.id;
      btn.addEventListener('click', function () {
        if (typeof abrirInstruccion === 'function') abrirInstruccion(s.id);
      });
      mount.appendChild(btn);
    });
  }

  function abrir(id) {
    var item = ejState.lista.find(function (x) { return x.id === id; });
    if (!item) return;
    ejState.abiertoId = id;
    ejState.tab = 'resumen';
    var dlg = document.getElementById('dlgEjecutor');
    if (dlg && typeof openFichaPane === 'function') openFichaPane(dlg);
    else if (dlg) dlg.showModal();
    renderFicha(item);
    pintar();
    if (typeof iconizarPestanasFicha === 'function') {
      iconizarPestanasFicha(document.getElementById('dlgEjecutor'));
    }
  }

  function cerrarModal() {
    var dlg = document.getElementById('dlgEjecutor');
    if (dlg) dlg.close();
    ejState.abiertoId = null;
    pintar();
  }

  async function eliminar(id) {
    await asegurarClaveCatalogo();
    var data = await apiFetchAuth('/v1/ejecutores/' + encodeURIComponent(id), { method: 'DELETE' });
    if (data && data.ok === false) throw new Error(data.error || 'No se pudo borrar');
    if (ejState.abiertoId === id) cerrarModal();
    await cargar();
  }

  function configDesdeForm(form, tipo) {
    if (tipo === 'modelo') {
      return {
        proveedor: form.proveedor.value.trim(),
        modelo: form.modelo.value.trim(),
        secret: form.secret.value.trim() || 'OPENAI_API_KEY',
        temperatura: Number(form.temperatura.value || 0),
        salida_json: !!form.salida_json.checked
      };
    }
    if (tipo === 'herramienta') {
      return { funcion: form.funcion.value.trim() };
    }
    if (tipo === 'integracion') {
      return {
        url: form.url.value.trim(),
        metodo: (form.metodo.value || 'POST').trim(),
        secret: form.secret_int.value.trim() || undefined,
        asincrono: !!form.asincrono.checked
      };
    }
    if (tipo === 'humano') {
      return {
        rol: form.rol.value.trim(),
        instrucciones: form.instrucciones.value.trim()
      };
    }
    return { agente_id: form.agente_id.value.trim() };
  }

  function syncTipoCampos(form) {
    var tipo = form.tipo.value;
    form.querySelectorAll('[data-ej-tipo]').forEach(function (el) {
      el.hidden = el.getAttribute('data-ej-tipo') !== tipo;
    });
  }

  function abrirDialogoNuevo() {
    var dlg = document.getElementById('dlgNuevoEjecutor');
    var form = document.getElementById('formNuevoEjecutor');
    if (!dlg || !form) return;
    form.reset();
    form.tipo.value = 'modelo';
    form.timeout_s.value = '60';
    form.reintentos.value = '2';
    form.espera_reintento_s.value = '10';
    form.activo.checked = true;
    if (form.salida_json) form.salida_json.checked = true;
    if (form.asincrono) form.asincrono.checked = true;
    var err = document.getElementById('nuevoEjecutorError');
    if (err) err.textContent = '';
    syncTipoCampos(form);
    dlg.showModal();
  }

  function abrirDialogoEditar(id) {
    var item = ejState.lista.find(function (x) { return x.id === id; });
    if (!item) return;
    var dlg = document.getElementById('dlgEditarEjecutor');
    var form = document.getElementById('formEditarEjecutor');
    if (!dlg || !form) return;
    form.dataset.id = item.id;
    form.nombre.value = item.nombre;
    form.tipo.value = item.tipo;
    form.timeout_s.value = String(item.timeout_s);
    form.reintentos.value = String(item.reintentos);
    form.espera_reintento_s.value = String(item.espera_reintento_s);
    form.activo.checked = !!item.activo;
    var c = item.config || {};
    if (form.proveedor) form.proveedor.value = c.proveedor || 'openai';
    if (form.modelo) form.modelo.value = c.modelo || '';
    if (form.secret) form.secret.value = c.secret || '';
    if (form.temperatura) form.temperatura.value = c.temperatura != null ? String(c.temperatura) : '0';
    if (form.salida_json) form.salida_json.checked = c.salida_json !== false;
    if (form.funcion) form.funcion.value = c.funcion || '';
    if (form.url) form.url.value = c.url || '';
    if (form.metodo) form.metodo.value = c.metodo || 'POST';
    if (form.secret_int) form.secret_int.value = c.secret || '';
    if (form.asincrono) form.asincrono.checked = c.asincrono !== false;
    if (form.rol) form.rol.value = c.rol || '';
    if (form.instrucciones) form.instrucciones.value = c.instrucciones || '';
    if (form.agente_id) form.agente_id.value = c.agente_id || '';
    var err = document.getElementById('editarEjecutorError');
    if (err) err.textContent = '';
    syncTipoCampos(form);
    dlg.showModal();
  }

  async function onSubmitNuevo(e) {
    e.preventDefault();
    var form = e.currentTarget;
    var error = document.getElementById('nuevoEjecutorError');
    if (error) error.textContent = '';
    var tipo = form.tipo.value;
    var body = {
      id: form.id.value.trim() || undefined,
      nombre: form.nombre.value.trim(),
      tipo: tipo,
      config: configDesdeForm(form, tipo),
      timeout_s: Number(form.timeout_s.value || 60),
      reintentos: Number(form.reintentos.value || 2),
      espera_reintento_s: Number(form.espera_reintento_s.value || 10),
      activo: !!form.activo.checked
    };
    var submit = form.querySelector('[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      await asegurarClaveCatalogo();
      var data = await apiFetchAuth('/v1/ejecutores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!data || data.ok === false) throw new Error((data && data.error) || 'No se pudo crear');
      document.getElementById('dlgNuevoEjecutor').close();
      await cargar();
      if (data.ejecutor && data.ejecutor.id) abrir(data.ejecutor.id);
    } catch (err) {
      if (error) {
        if (typeof showApiErrorRaw === 'function') showApiErrorRaw(error, err, { kind: 'is-err', statusLabel: true });
        else error.textContent = err && err.message ? err.message : String(err);
      }
    } finally {
      if (submit) submit.disabled = false;
    }
  }

  async function onSubmitEditar(e) {
    e.preventDefault();
    var form = e.currentTarget;
    var error = document.getElementById('editarEjecutorError');
    if (error) error.textContent = '';
    var id = form.dataset.id;
    if (!id) return;
    var tipo = form.tipo.value;
    var body = {
      nombre: form.nombre.value.trim(),
      tipo: tipo,
      config: configDesdeForm(form, tipo),
      timeout_s: Number(form.timeout_s.value || 60),
      reintentos: Number(form.reintentos.value || 2),
      espera_reintento_s: Number(form.espera_reintento_s.value || 10),
      activo: !!form.activo.checked
    };
    var submit = form.querySelector('[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      await asegurarClaveCatalogo();
      var data = await apiFetchAuth('/v1/ejecutores/' + encodeURIComponent(id), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!data || data.ok === false) throw new Error((data && data.error) || 'No se pudo guardar');
      document.getElementById('dlgEditarEjecutor').close();
      await cargar();
      if (ejState.abiertoId === id) renderFicha(abierto());
    } catch (err) {
      if (error) {
        if (typeof showApiErrorRaw === 'function') showApiErrorRaw(error, err, { kind: 'is-err', statusLabel: true });
        else error.textContent = err && err.message ? err.message : String(err);
      }
    } finally {
      if (submit) submit.disabled = false;
    }
  }

  /* ─── Selector en ficha skill ─────────────────────────────────────── */

  function pintarEjecutorPicker(containerId, selectedId) {
    var items = [
      {
        icono: 'ejecutor',
        titulo: 'Implícito (agente_externo)',
        secundario: 'Sin fila · polling /siguiente',
        value: '',
        title: 'Sin ejecutor explícito',
        ariaLabel: 'Sin ejecutor (implícito agente_externo)'
      }
    ];
    ejState.lista.slice().sort(function (a, b) {
      return String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es');
    }).forEach(function (item) {
      items.push({
        icono: 'ejecutor',
        titulo: item.nombre || item.id,
        secundario: item.tipo + ' · v' + item.version,
        value: item.id,
        title: item.nombre || item.id,
        ariaLabel: 'Seleccionar ejecutor ' + (item.nombre || item.id)
      });
    });
    if (typeof pintarCatalogoPicker === 'function') {
      pintarCatalogoPicker(containerId, items, {
        mode: 'single',
        selectedId: selectedId || '',
        emptyMsg: null,
        ariaLabel: 'Ejecutores del catálogo'
      });
    }
  }

  function pintarSkillEjecutorTab(ins) {
    var mount = document.getElementById('readerEjecutorLista');
    var vacio = document.getElementById('readerEjecutorVacio');
    var hint = document.getElementById('readerEjecutorHint');
    if (!mount) return;
    mount.replaceChildren();
    var eid = ins && ins.ejecutorId ? String(ins.ejecutorId) : '';
    if (!eid) {
      if (hint) {
        hint.textContent =
          'Sin ejecutor explícito → implícito agente_externo (el agente hace polling de /siguiente).';
      }
      if (vacio) {
        vacio.hidden = false;
        vacio.textContent = 'Implícito: agente_externo';
      }
      return;
    }
    if (hint) hint.textContent = 'Ejecutor asignado a esta skill.';
    var item = ejState.lista.find(function (x) { return x.id === eid; });
    if (!item) {
      item = { id: eid, nombre: eid, tipo: '?', version: 1, skills: [], activo: true };
    }
    if (vacio) vacio.hidden = true;
    if (window.EjecutoresUI && window.EjecutoresUI.montarLista) {
      window.EjecutoresUI.montarLista(mount, {
        getSnapshot: function () {
          return { ready: true, indexError: false, ejecutores: [item], abierta: null };
        },
        abrirEjecutor: function (id) { abrir(id); },
        añadirEjecutor: function () {}
      }, { emptyMsg: 'Sin ejecutor.' });
    } else {
      var p = document.createElement('p');
      p.textContent = (item.nombre || item.id) + ' (' + (item.tipo || '') + ')';
      mount.appendChild(p);
    }
  }

  function abrirDialogoEditarSkillEjecutor() {
    var ins = typeof instruccionAbierta === 'function' ? instruccionAbierta() : null;
    if (!ins || !ins.id) return;
    var dlg = document.getElementById('dlgEditarSkillEjecutor');
    var form = document.getElementById('formEditarSkillEjecutor');
    if (!dlg || !form) return;
    var err = document.getElementById('editarSkillEjecutorError');
    if (err) err.textContent = '';
    form.dataset.skillId = ins.id;
    pintarEjecutorPicker('editarSkillEjecutorPicker', ins.ejecutorId || '');
    dlg.showModal();
  }

  async function onSubmitEditarSkillEjecutor(e) {
    e.preventDefault();
    var form = e.currentTarget;
    var error = document.getElementById('editarSkillEjecutorError');
    if (error) error.textContent = '';
    var skillId = form.dataset.skillId;
    if (!skillId) return;
    var ejecutorId =
      typeof valorPickerUnico === 'function' ? valorPickerUnico('editarSkillEjecutorPicker') : null;
    var submit = form.querySelector('[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      await asegurarClaveCatalogo();
      var data = await apiFetchAuth('/v1/skills/' + encodeURIComponent(skillId), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ejecutorId: ejecutorId || null })
      });
      if (data && data.ok === false) throw new Error(data.error || 'No se pudo guardar');
      document.getElementById('dlgEditarSkillEjecutor').close();
      await cargar();
      if (typeof cargarSkills === 'function') cargarSkills();
      var skill = data && data.skill;
      if (skill && typeof state !== 'undefined' && Array.isArray(state.instrucciones)) {
        var idx = state.instrucciones.findIndex(function (s) { return s.id === skillId; });
        if (idx >= 0) {
          state.instrucciones[idx] = Object.assign({}, state.instrucciones[idx], {
            ejecutorId: skill.ejecutorId || null
          });
        }
      }
      var ins = typeof instruccionAbierta === 'function' ? instruccionAbierta() : null;
      if (ins && ins.id === skillId && skill) {
        ins.ejecutorId = skill.ejecutorId || null;
      }
      pintarSkillEjecutorTab(ins);
    } catch (err) {
      if (error) {
        if (typeof showApiErrorRaw === 'function') showApiErrorRaw(error, err, { kind: 'is-err', statusLabel: true });
        else error.textContent = err && err.message ? err.message : String(err);
      }
    } finally {
      if (submit) submit.disabled = false;
    }
  }

  function wire() {
    var btnAtras = document.getElementById('btnAtrasEjecutor');
    if (btnAtras) {
      btnAtras.addEventListener('click', function () {
        if (typeof atrasDesdeFicha === 'function') atrasDesdeFicha(cerrarModal);
        else cerrarModal();
      });
    }
    var btnEditar = document.getElementById('btnEditarEjecutor');
    if (btnEditar) {
      btnEditar.addEventListener('click', function () {
        if (ejState.abiertoId) abrirDialogoEditar(ejState.abiertoId);
      });
    }
    var btnEliminar = document.getElementById('btnEliminarEjecutor');
    if (btnEliminar) {
      btnEliminar.addEventListener('click', function () {
        if (!ejState.abiertoId) return;
        if (typeof abrirDialogoEliminar === 'function') {
          abrirDialogoEliminar({ tipo: 'ejecutor', id: ejState.abiertoId });
        }
      });
    }
    var tabs = document.getElementById('ejReaderTabs');
    if (tabs) {
      tabs.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-ej-tab]');
        if (!btn) return;
        seleccionarTab(btn.getAttribute('data-ej-tab'));
      });
    }
    var formNuevo = document.getElementById('formNuevoEjecutor');
    if (formNuevo) {
      formNuevo.addEventListener('submit', onSubmitNuevo);
      formNuevo.tipo.addEventListener('change', function () { syncTipoCampos(formNuevo); });
    }
    var nuevoCancelar = document.getElementById('nuevoEjecutorCancelar');
    if (nuevoCancelar) {
      nuevoCancelar.addEventListener('click', function () {
        document.getElementById('dlgNuevoEjecutor').close();
      });
    }
    var formEditar = document.getElementById('formEditarEjecutor');
    if (formEditar) {
      formEditar.addEventListener('submit', onSubmitEditar);
      formEditar.tipo.addEventListener('change', function () { syncTipoCampos(formEditar); });
    }
    var editarCancelar = document.getElementById('editarEjecutorCancelar');
    if (editarCancelar) {
      editarCancelar.addEventListener('click', function () {
        document.getElementById('dlgEditarEjecutor').close();
      });
    }
    var btnSkillEj = document.getElementById('btnEditarSkillEjecutor');
    if (btnSkillEj) btnSkillEj.addEventListener('click', abrirDialogoEditarSkillEjecutor);
    var formSkillEj = document.getElementById('formEditarSkillEjecutor');
    if (formSkillEj) formSkillEj.addEventListener('submit', onSubmitEditarSkillEjecutor);
    var skillEjCancelar = document.getElementById('editarSkillEjecutorCancelar');
    if (skillEjCancelar) {
      skillEjCancelar.addEventListener('click', function () {
        document.getElementById('dlgEditarSkillEjecutor').close();
      });
    }
    var dlg = document.getElementById('dlgEjecutor');
    if (dlg) {
      dlg.addEventListener('close', function () {
        ejState.abiertoId = null;
        if (typeof syncFichaPaneClass === 'function') syncFichaPaneClass();
        pintar();
      });
    }
  }

  window.EjecutoresCatalog = {
    state: ejState,
    TIPOS: TIPOS,
    cargar: cargar,
    wire: wire,
    pintar: pintar,
    abrir: abrir,
    eliminar: eliminar,
    pintarSkillEjecutorTab: pintarSkillEjecutorTab,
    abrirDialogoNuevo: abrirDialogoNuevo
  };
})();
