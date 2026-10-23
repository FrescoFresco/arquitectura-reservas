'use strict';

/**
 * Catálogo System prompts — ficha Documento | Skills | Interno + CRUD vía API.
 * Depende de helpers globales de catalogo-ui.js (apiFetch, apiFetchAuth, …).
 */
(function () {
  var LS_KEY = 'arquitectura-reservas.catalogo.system-prompts';

  var spState = {
    ready: false,
    indexError: false,
    remotos: [],
    lista: [],
    abiertoId: null,
    abiertaNumero: null,
    historial: false,
    fetchToken: 0,
    inflightRuta: null
  };

  function versionActual(item) {
    if (!item || !item.versiones || !item.versiones.length) {
      return { numero: 1, fecha: '', markdown: '', hash: '' };
    }
    return item.versiones[item.versiones.length - 1];
  }

  function siguienteNumero(versiones) {
    var max = 0;
    (versiones || []).forEach(function (v) {
      if (v && v.numero > max) max = v.numero;
    });
    return max + 1;
  }

  function normalizarSkills(list) {
    if (!Array.isArray(list)) return [];
    var seen = {};
    var out = [];
    list.forEach(function (s) {
      var id = String(s || '').trim();
      if (!id || seen[id]) return;
      seen[id] = true;
      out.push(id);
    });
    return out;
  }

  function normalizeSystemPrompt(item) {
    if (!item || typeof item !== 'object') return null;
    if (typeof item.id !== 'string' || !item.id.trim()) return null;
    var versiones = Array.isArray(item.versiones) ? item.versiones.map(function (v) {
      if (!v || typeof v !== 'object') return null;
      return {
        numero: Number(v.numero) || 1,
        fecha: String(v.fecha || ''),
        markdown: typeof v.markdown === 'string' ? v.markdown : undefined,
        ruta: typeof v.ruta === 'string' ? v.ruta : '',
        nombreArchivo: typeof v.nombreArchivo === 'string' ? v.nombreArchivo : (typeof v.nombre_archivo === 'string' ? v.nombre_archivo : ''),
        hash: typeof v.hash === 'string' ? v.hash : '',
        origen: v.origen
      };
    }).filter(Boolean) : [];
    if (!versiones.length) {
      versiones = [{ numero: 1, fecha: '', markdown: '', hash: String(item.hash || '') }];
    }
    return {
      id: item.id.trim(),
      nombre: typeof item.nombre === 'string' ? item.nombre.trim() : item.id.trim(),
      descripcion: typeof item.descripcion === 'string' ? item.descripcion.trim() : '',
      hash: typeof item.hash === 'string' ? item.hash : '',
      skills: normalizarSkills(item.skills),
      versiones: versiones
    };
  }

  function normalizeIndice(data) {
    var list = Array.isArray(data)
      ? data
      : (data && Array.isArray(data.systemPrompts)
        ? data.systemPrompts
        : (data && Array.isArray(data.system_prompts) ? data.system_prompts : []));
    var out = [];
    var seen = {};
    list.forEach(function (item) {
      var n = normalizeSystemPrompt(item);
      if (!n || seen[n.id]) return;
      seen[n.id] = true;
      n.origen = 'indice';
      out.push(n);
    });
    return out;
  }

  function leerStore() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return { systemPrompts: [], eliminados: [] };
      var data = JSON.parse(raw);
      if (!data || !Array.isArray(data.systemPrompts)) return { systemPrompts: [], eliminados: [] };
      return {
        systemPrompts: data.systemPrompts,
        eliminados: Array.isArray(data.eliminados) ? data.eliminados : []
      };
    } catch (e) {
      return { systemPrompts: [], eliminados: [] };
    }
  }

  function guardarStore(store) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        systemPrompts: store.systemPrompts || [],
        eliminados: store.eliminados || []
      }));
    } catch (e) {}
  }

  function mergeLista(remotos, locales, eliminados) {
    var elim = {};
    (eliminados || []).forEach(function (id) { elim[id] = true; });
    var byId = {};
    (remotos || []).forEach(function (r) {
      if (!r || elim[r.id]) return;
      byId[r.id] = r;
    });
    (locales || []).forEach(function (loc) {
      var n = normalizeSystemPrompt(loc);
      if (!n || elim[n.id]) return;
      var rem = byId[n.id];
      if (!rem) {
        byId[n.id] = n;
        return;
      }
      var merged = Object.assign({}, rem, {
        nombre: n.nombre || rem.nombre,
        descripcion: n.descripcion != null ? n.descripcion : rem.descripcion,
        skills: n.skills && n.skills.length ? n.skills : rem.skills,
        versiones: (n.versiones && n.versiones.length >= (rem.versiones || []).length)
          ? n.versiones
          : rem.versiones
      });
      byId[n.id] = merged;
    });
    return Object.keys(byId).map(function (k) { return byId[k]; }).sort(function (a, b) {
      return a.nombre.localeCompare(b.nombre, 'es');
    });
  }

  function refrescar() {
    var store = leerStore();
    spState.lista = mergeLista(spState.remotos, store.systemPrompts, store.eliminados);
  }

  function pintar() {
    if (window.SystemPromptsUI && typeof window.SystemPromptsUI.refrescar === 'function') {
      window.SystemPromptsUI.refrescar(bridge());
    }
  }

  function bridge() {
    return {
      getSnapshot: function () {
        var abierta = spState.abiertoId
          ? spState.lista.find(function (f) { return f.id === spState.abiertoId; }) || null
          : null;
        var abiertaVersion = abierta
          ? (abierta.versiones.find(function (v) { return v.numero === spState.abiertaNumero; }) || versionActual(abierta))
          : null;
        return {
          ready: spState.ready,
          indexError: spState.indexError,
          systemPrompts: spState.lista,
          abierta: abierta ? { id: abierta.id, version: abiertaVersion } : null
        };
      },
      añadirSystemPrompt: function () { abrirDialogoNuevo(); },
      abrirSystemPrompt: function (id) {
        if (spState.abiertoId === id) {
          var dlg = document.getElementById('dlgSystemPrompt');
          if (dlg && dlg.open) {
            cerrarModal();
            return;
          }
        }
        abrir(id);
      }
    };
  }

  function abierto() {
    if (!spState.abiertoId) return null;
    return spState.lista.find(function (f) { return f.id === spState.abiertoId; }) || null;
  }

  function versionAbierta(item) {
    return item.versiones.find(function (v) { return v.numero === spState.abiertaNumero; }) || versionActual(item);
  }

  function cerrarModal() {
    var dlg = document.getElementById('dlgSystemPrompt');
    if (dlg && dlg.open) {
      dlg.close();
      return;
    }
    spState.abiertoId = null;
    spState.abiertaNumero = null;
    spState.historial = false;
    pintar();
  }

  function seleccionarTab(id) {
    var tabs = document.querySelectorAll('#spReaderTabs [data-sp-tab]');
    var panels = {
      documento: document.getElementById('spPanelDoc'),
      skills: document.getElementById('spPanelSkills'),
      interno: document.getElementById('spPanelInterno')
    };
    tabs.forEach(function (btn) {
      var on = btn.getAttribute('data-sp-tab') === id;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    Object.keys(panels).forEach(function (key) {
      if (panels[key]) panels[key].hidden = key !== id;
    });
    if (id === 'skills') pintarSkillsTab(abierto());
  }

  function pintarSkillsTab(item) {
    var mount = document.getElementById('spSkillsTabLista');
    if (!mount || !item || !window.SkillsUI || !window.SkillsUI.montarLista) return;
    var ids = Array.isArray(item.skills) ? item.skills : [];

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
          if (typeof abrirVistaSkill === 'function') abrirVistaSkill(id);
          else if (typeof abrirInstruccion === 'function') abrirInstruccion(id);
        },
        añadirSkill: function () {}
      };
    }

    window.SkillsUI.montarLista(mount, bridgeCon([], false, false), {
      emptyMsg: 'Cargando skills…'
    });

    var listaLocal = (typeof state !== 'undefined' && state.instrucciones || []).filter(function (ins) {
      return ids.indexOf(ins.id) >= 0;
    });
    if (typeof state !== 'undefined' && state.ready) {
      window.SkillsUI.montarLista(mount, bridgeCon(listaLocal, true, false), {
        emptyMsg: 'Ninguna skill asociada.'
      });
      return;
    }

    apiFetch('/v1/skills')
      .then(function (data) {
        var a = abierto();
        if (!a || a.id !== item.id) return;
        var tabOn = document.querySelector('#spReaderTabs [data-sp-tab="skills"].is-on');
        if (!tabOn) return;
        var todos = (typeof state !== 'undefined' && state.instrucciones && state.instrucciones.length)
          ? state.instrucciones
          : (data && Array.isArray(data.instrucciones) ? data.instrucciones : []);
        var filtrados = (todos || []).filter(function (ins) {
          return ins && ids.indexOf(ins.id) >= 0;
        });
        window.SkillsUI.montarLista(mount, bridgeCon(filtrados, true, false), {
          emptyMsg: 'Ninguna skill asociada.'
        });
      })
      .catch(function () {
        window.SkillsUI.montarLista(mount, bridgeCon(listaLocal, true, !listaLocal.length), {
          emptyMsg: listaLocal.length ? 'Ninguna skill asociada.' : 'No se pudieron cargar las skills.'
        });
      });
  }

  function textoVersion(v) {
    if (!v) return Promise.resolve('');
    if (typeof v.markdown === 'string') return Promise.resolve(v.markdown);
    if (v.ruta && typeof mdCache !== 'undefined' && mdCache.has(v.ruta)) return Promise.resolve(mdCache.get(v.ruta));
    if (!v.ruta) return Promise.resolve('');
    return fetch(typeof hrefRuta === 'function' ? hrefRuta(v.ruta) : v.ruta, { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('http');
        return res.text();
      })
      .then(function (text) {
        if (typeof mdCache !== 'undefined') mdCache.set(v.ruta, text);
        return text;
      })
      .catch(function () { return ''; });
  }

  function renderHistorial(item, actual) {
    var pop = document.getElementById('historialSystemPrompt');
    var btn = document.getElementById('btnHistorialSystemPrompt');
    var lista = document.getElementById('historialSystemPromptLista');
    if (!pop || !btn || !lista) return;
    pop.hidden = !spState.historial;
    btn.setAttribute('aria-expanded', spState.historial ? 'true' : 'false');
    lista.replaceChildren();
    (item.versiones || []).slice().reverse().forEach(function (v) {
      var li = document.createElement('li');
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'historial-item' + (actual && actual.numero === v.numero ? ' is-on' : '');
      b.dataset.numero = String(v.numero);
      b.textContent = typeof formatVersion === 'function'
        ? formatVersion(v.numero, v.fecha)
        : ('v' + v.numero);
      li.append(b);
      lista.append(li);
    });
  }

  function renderReader() {
    var dlg = document.getElementById('dlgSystemPrompt');
    var item = abierto();
    if (!item) {
      spState.abiertoId = null;
      spState.abiertaNumero = null;
      spState.historial = false;
      if (dlg && dlg.open) dlg.close();
      return;
    }
    var v = versionAbierta(item);
    spState.abiertaNumero = v.numero;
    var nombreEl = document.getElementById('spReaderNombre');
    var verEl = document.getElementById('spReaderVersion');
    if (nombreEl) nombreEl.textContent = item.nombre;
    if (verEl) verEl.textContent = typeof formatVersion === 'function'
      ? formatVersion(v.numero, v.fecha)
      : ('v' + v.numero);
    var idEl = document.getElementById('spReaderId');
    if (idEl) idEl.textContent = item.id || '—';
    var internoVer = document.getElementById('spInternoVersion');
    if (internoVer) {
      internoVer.textContent = typeof formatVersion === 'function'
        ? formatVersion(v.numero, v.fecha)
        : ('v' + v.numero);
    }
    var full = (typeof normalizarHash === 'function' ? normalizarHash(v.hash) : v.hash)
      || (typeof hashFnvHex === 'function'
        ? hashFnvHex(item.id + '|' + v.numero + '|' + (v.ruta || v.fecha || ''))
        : '');
    var hashBtn = document.getElementById('spHashBtn');
    var hashFull = document.getElementById('spHashFull');
    var hashVacio = document.getElementById('spHashVacio');
    if (hashBtn && hashFull && hashVacio) {
      if (full) {
        hashFull.textContent = full;
        hashBtn.hidden = false;
        hashBtn.dataset.hash = full;
        hashVacio.hidden = true;
      } else {
        hashBtn.hidden = true;
        hashBtn.dataset.hash = '';
        hashVacio.hidden = false;
      }
    }
    seleccionarTab('documento');
    renderHistorial(item, v);
    var md = document.getElementById('spMd');
    if (md) {
      if (typeof v.markdown === 'string') {
        md.innerHTML = typeof htmlDeMarkdown === 'function' ? htmlDeMarkdown(v.markdown) : '';
      } else {
        md.innerHTML = '<p class="estado">Cargando…</p>';
        textoVersion(v).then(function (text) {
          if (spState.abiertoId !== item.id) return;
          md.innerHTML = typeof htmlDeMarkdown === 'function' ? htmlDeMarkdown(text || '') : '';
        });
      }
    }
    if (typeof openFichaPane === 'function') openFichaPane(dlg);
    else if (dlg && !dlg.open) dlg.showModal();
    if (nombreEl) nombreEl.focus();
  }

  function abrir(id, numero) {
    refrescar();
    var item = spState.lista.find(function (f) { return f.id === id; });
    if (!item) return;
    spState.abiertoId = id;
    spState.abiertaNumero = numero == null ? versionActual(item).numero : numero;
    spState.historial = false;
    renderReader();
    pintar();
  }

  function abrirDialogoNuevo() {
    var dlg = document.getElementById('dlgNuevoSystemPrompt');
    var form = document.getElementById('formNuevoSystemPrompt');
    if (!dlg || !form) return;
    form.reset();
    var err = document.getElementById('nuevoSystemPromptError');
    if (err) err.textContent = '';
    if (typeof pintarSkillsPicker === 'function') pintarSkillsPicker('nuevoSpSkillsPicker', []);
    dlg.showModal();
    if (form.nombre) form.nombre.focus();
  }

  function abrirDialogoEditar(id) {
    var item = spState.lista.find(function (f) { return f.id === id; });
    if (!item) return;
    var dlg = document.getElementById('dlgEditarSystemPrompt');
    var form = document.getElementById('formEditarSystemPrompt');
    if (!dlg || !form) return;
    form.reset();
    form.dataset.id = id;
    delete form.dataset.snapMarkdown;
    delete form.dataset.snapSkills;
    var err = document.getElementById('editarSystemPromptError');
    if (err) err.textContent = '';
    form.nombre.value = item.nombre;
    form.descripcion.value = item.descripcion || '';
    if (typeof pintarSkillsPicker === 'function') pintarSkillsPicker('editarSpSkillsPicker', item.skills || []);
    form.markdown.value = 'Cargando…';
    seleccionarEditarTab('documento');
    dlg.showModal();
    var v = versionActual(item);
    textoVersion(v).then(function (text) {
      if (form.dataset.id !== id) return;
      var md = text || '';
      form.markdown.value = md;
      form.dataset.snapMarkdown = md;
      form.dataset.snapSkills = (item.skills || []).join('\n');
      form.nombre.focus();
    });
  }

  function seleccionarEditarTab(id) {
    var tabs = document.querySelectorAll('#editarSpTabs [data-editar-sp-tab]');
    var panels = {
      documento: document.getElementById('editarSpPanelDoc'),
      skills: document.getElementById('editarSpPanelSkills')
    };
    tabs.forEach(function (btn) {
      var on = btn.getAttribute('data-editar-sp-tab') === id;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    Object.keys(panels).forEach(function (key) {
      if (panels[key]) panels[key].hidden = key !== id;
    });
  }

  function abrirDialogoEditarSkills() {
    var item = abierto();
    if (!item) return;
    var dlg = document.getElementById('dlgEditarSystemPromptSkills');
    var form = document.getElementById('formEditarSystemPromptSkills');
    if (!dlg || !form) return;
    var err = document.getElementById('editarSystemPromptSkillsError');
    if (err) err.textContent = '';
    form.dataset.id = item.id;
    if (typeof pintarSkillsPicker === 'function') pintarSkillsPicker('editarSystemPromptSkillsPicker', item.skills || []);
    dlg.showModal();
  }

  async function onSubmitNuevo(e) {
    e.preventDefault();
    var form = e.currentTarget;
    var error = document.getElementById('nuevoSystemPromptError');
    if (error) error.textContent = '';
    var nombre = form.nombre.value.trim();
    if (!nombre) {
      if (error) error.textContent = 'Escribe un nombre.';
      return;
    }
    var markdown = String(form.markdown.value || '');
    if (!markdown.trim()) {
      if (error) error.textContent = 'El contenido no puede estar vacío.';
      return;
    }
    var skills = typeof skillsDesdePicker === 'function'
      ? normalizarSkills(skillsDesdePicker('nuevoSpSkillsPicker'))
      : [];
    var submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      await asegurarClaveCatalogo();
      var data = await apiFetchAuth('/v1/system-prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre: nombre,
          descripcion: form.descripcion.value.trim().slice(0, 280),
          markdown: markdown,
          skills: skills
        })
      });
      if (data && data.ok === false) throw new Error(data.error || 'No se pudo crear');
      document.getElementById('dlgNuevoSystemPrompt').close();
      await cargar();
      var id = data && data.systemPrompt && data.systemPrompt.id;
      if (id) abrir(id, 1);
    } catch (err) {
      if (error) {
        if (typeof showApiErrorRaw === 'function') {
          showApiErrorRaw(error, err, { kind: 'is-err', statusLabel: true });
        } else {
          error.textContent = err && err.message ? err.message : String(err);
        }
      }
    } finally {
      submit.disabled = false;
    }
  }

  async function onSubmitEditar(e) {
    e.preventDefault();
    var form = e.currentTarget;
    var error = document.getElementById('editarSystemPromptError');
    if (error) error.textContent = '';
    var id = form.dataset.id;
    var nombre = form.nombre.value.trim();
    if (!nombre) {
      if (error) error.textContent = 'Escribe un nombre.';
      return;
    }
    var markdown = form.markdown.value;
    if (!String(markdown || '').trim()) {
      if (error) error.textContent = 'El contenido no puede estar vacío.';
      return;
    }
    var skills = typeof skillsDesdePicker === 'function'
      ? normalizarSkills(skillsDesdePicker('editarSpSkillsPicker'))
      : [];
    refrescar();
    var actual = spState.lista.find(function (f) { return f.id === id; });
    if (!actual) {
      if (error) error.textContent = 'No está ese system prompt.';
      return;
    }
    var desc = form.descripcion.value.trim().slice(0, 280);
    var snapMd = form.dataset.snapMarkdown;
    var snapSkills = form.dataset.snapSkills;
    if (
      typeof snapMd === 'string' &&
      typeof snapSkills === 'string' &&
      markdown === snapMd &&
      skills.join('\n') === snapSkills &&
      nombre === actual.nombre &&
      desc === (actual.descripcion || '')
    ) {
      if (error) error.textContent = 'Sin cambios';
      return;
    }
    var submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      await asegurarClaveCatalogo();
      var data = await apiFetchAuth('/v1/system-prompts/' + encodeURIComponent(id), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre: nombre,
          descripcion: desc,
          markdown: markdown,
          skills: skills
        })
      });
      if (data && data.ok === false) throw new Error(data.error || 'No se pudo guardar');
      document.getElementById('dlgEditarSystemPrompt').close();
      await cargar();
      var creada = data && data.systemPrompt && data.systemPrompt.versiones
        ? versionActual(normalizeSystemPrompt(data.systemPrompt))
        : null;
      abrir(id, creada ? creada.numero : null);
    } catch (err) {
      if (error) {
        if (typeof showApiErrorRaw === 'function') {
          showApiErrorRaw(error, err, { kind: 'is-err', statusLabel: true });
        } else {
          error.textContent = err && err.message ? err.message : String(err);
        }
      }
    } finally {
      submit.disabled = false;
    }
  }

  async function onSubmitEditarSkills(e) {
    e.preventDefault();
    var form = e.currentTarget;
    var error = document.getElementById('editarSystemPromptSkillsError');
    if (error) error.textContent = '';
    var id = form.dataset.id;
    var skills = typeof skillsDesdePicker === 'function'
      ? normalizarSkills(skillsDesdePicker('editarSystemPromptSkillsPicker'))
      : [];
    refrescar();
    var actual = spState.lista.find(function (f) { return f.id === id; });
    if (!actual) {
      if (error) error.textContent = 'No está ese system prompt.';
      return;
    }
    var submit = form.querySelector('[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      await asegurarClaveCatalogo();
      var v = versionActual(actual);
      var md = await textoVersion(v);
      var data = await apiFetchAuth('/v1/system-prompts/' + encodeURIComponent(id), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre: actual.nombre,
          descripcion: actual.descripcion || '',
          markdown: md,
          skills: skills
        })
      });
      if (data && data.ok === false) throw new Error(data.error || 'No se pudo guardar');
      document.getElementById('dlgEditarSystemPromptSkills').close();
      await cargar();
      if (spState.abiertoId === id) {
        var abiertoItem = abierto();
        if (abiertoItem) pintarSkillsTab(abiertoItem);
      }
    } catch (err) {
      if (error) {
        if (typeof showApiErrorRaw === 'function') {
          showApiErrorRaw(error, err, { kind: 'is-err', statusLabel: true });
        } else {
          error.textContent = err && err.message ? err.message : String(err);
        }
      }
    } finally {
      if (submit) submit.disabled = false;
    }
  }

  function eliminar(id) {
    asegurarClaveCatalogo()
      .then(function () {
        return apiFetchAuth('/v1/system-prompts/' + encodeURIComponent(id), { method: 'DELETE' });
      })
      .catch(function () {})
      .then(function () {
        var store = leerStore();
        store.systemPrompts = (store.systemPrompts || []).filter(function (f) { return !(f && f.id === id); });
        if ((store.eliminados || []).indexOf(id) < 0) {
          store.eliminados = (store.eliminados || []).concat([id]);
        }
        guardarStore(store);
        if (spState.abiertoId === id) {
          spState.abiertoId = null;
          spState.abiertaNumero = null;
          spState.historial = false;
          var dlg = document.getElementById('dlgSystemPrompt');
          if (dlg && dlg.open) dlg.close();
        }
        return cargar();
      });
  }

  function cargar() {
    return apiFetch('/v1/system-prompts')
      .then(function (data) {
        spState.remotos = normalizeIndice(data);
        spState.indexError = false;
      })
      .catch(function () {
        spState.remotos = [];
        spState.indexError = true;
      })
      .then(function () {
        spState.ready = true;
        refrescar();
        pintar();
        if (spState.abiertoId) renderReader();
      });
  }

  function promptsDeSkill(skillId) {
    refrescar();
    return spState.lista.filter(function (p) {
      return Array.isArray(p.skills) && p.skills.indexOf(skillId) >= 0;
    }).slice(0, 1);
  }

  function promptIdDeSkill(ins) {
    if (!ins) return null;
    var linked = promptsDeSkill(ins.id);
    if (linked.length) return linked[0].id;
    if (ins.systemPrompts && Array.isArray(ins.systemPrompts) && ins.systemPrompts[0]) {
      return ins.systemPrompts[0].id || null;
    }
    return null;
  }

  function pintarSystemPromptPicker(containerId, selectedId) {
    refrescar();
    var prompts = spState.lista.slice().sort(function (a, b) {
      return String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es');
    });
    var items = [
      {
        icono: 'system-prompt',
        titulo: 'Ninguno',
        secundario: 'Sin system prompt',
        value: '',
        title: 'Ningún system prompt',
        ariaLabel: 'Sin system prompt'
      }
    ];
    prompts.forEach(function (item) {
      var actual = versionActual(item);
      var partes = [];
      if (typeof formatVersion === 'function') {
        partes.push(formatVersion(actual.numero, actual.fecha));
      } else {
        partes.push('v' + (actual.numero || 1));
      }
      var nSkills = Array.isArray(item.skills) ? item.skills.length : 0;
      if (nSkills) partes.push(nSkills + (nSkills === 1 ? ' skill' : ' skills'));
      if (actual.origen === 'local') partes.push('local');
      items.push({
        icono: 'system-prompt',
        titulo: item.nombre || item.id,
        secundario: partes.join(' · '),
        value: item.id,
        title: item.descripcion || item.nombre || item.id,
        ariaLabel: 'Seleccionar system prompt ' + (item.nombre || item.id)
      });
    });
    if (typeof pintarCatalogoPicker === 'function') {
      pintarCatalogoPicker(containerId, items, {
        mode: 'single',
        selectedId: selectedId || '',
        emptyMsg: prompts.length ? '' : null,
        ariaLabel: 'System prompts del catálogo'
      });
      return;
    }
    // Fallback si catalogo-ui no expuso el helper
    var box = document.getElementById(containerId);
    if (!box) return;
    box.replaceChildren();
    box.appendChild(document.createTextNode('No se pudo cargar el selector.'));
  }

  function systemPromptDesdePicker(containerId) {
    if (typeof valorPickerUnico === 'function') return valorPickerUnico(containerId);
    return null;
  }

  function abrirDialogoEditarSkillSystemPrompt() {
    var ins = typeof instruccionAbierta === 'function' ? instruccionAbierta() : null;
    if (!ins || !ins.id) return;
    var dlg = document.getElementById('dlgEditarSkillSystemPrompt');
    var form = document.getElementById('formEditarSkillSystemPrompt');
    if (!dlg || !form) return;
    var err = document.getElementById('editarSkillSystemPromptError');
    if (err) err.textContent = '';
    form.dataset.skillId = ins.id;
    pintarSystemPromptPicker('editarSkillSystemPromptPicker', promptIdDeSkill(ins));
    dlg.showModal();
  }

  async function onSubmitEditarSkillSystemPrompt(e) {
    e.preventDefault();
    var form = e.currentTarget;
    var error = document.getElementById('editarSkillSystemPromptError');
    if (error) error.textContent = '';
    var skillId = form.dataset.skillId;
    if (!skillId) return;
    var promptId = systemPromptDesdePicker('editarSkillSystemPromptPicker');
    var submit = form.querySelector('[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      await asegurarClaveCatalogo();
      var data = await apiFetchAuth('/v1/skills/' + encodeURIComponent(skillId), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ systemPromptId: promptId })
      });
      if (data && data.ok === false) throw new Error(data.error || 'No se pudo guardar');
      var skill = data && data.skill;
      document.getElementById('dlgEditarSkillSystemPrompt').close();
      await cargar();
      if (typeof cargarSkills === 'function') cargarSkills();
      if (skill && typeof state !== 'undefined' && Array.isArray(state.instrucciones)) {
        var idx = state.instrucciones.findIndex(function (s) { return s.id === skillId; });
        if (idx >= 0) {
          state.instrucciones[idx] = Object.assign({}, state.instrucciones[idx], {
            systemPrompts: skill.systemPrompts || []
          });
        }
      }
      var ins = typeof instruccionAbierta === 'function' ? instruccionAbierta() : null;
      if (ins && ins.id === skillId && skill) {
        ins.systemPrompts = skill.systemPrompts || [];
      }
      pintarSkillSystemPromptsTab(ins);
    } catch (err) {
      if (error) {
        if (typeof showApiErrorRaw === 'function') {
          showApiErrorRaw(error, err, { kind: 'is-err', statusLabel: true });
        } else {
          error.textContent = err && err.message ? err.message : String(err);
        }
      }
    } finally {
      if (submit) submit.disabled = false;
    }
  }

  function pintarSkillSystemPromptsTab(ins) {
    var mount = document.getElementById('readerSystemPromptsLista');
    var vacio = document.getElementById('readerSystemPromptsVacio');
    if (!mount) return;
    if (!ins || !ins.id) {
      mount.replaceChildren();
      if (vacio) {
        vacio.hidden = false;
        vacio.textContent = 'Ningún system prompt asociado.';
      }
      return;
    }
    var linked = promptsDeSkill(ins.id);
    if (ins.systemPrompts && Array.isArray(ins.systemPrompts) && ins.systemPrompts.length && !linked.length) {
      var first = ins.systemPrompts[0];
      var ids = first && first.id ? [first.id] : [];
      linked = spState.lista.filter(function (p) { return ids.indexOf(p.id) >= 0; });
      if (!linked.length && first) {
        linked = [
          normalizeSystemPrompt({
            id: first.id,
            nombre: first.nombre || first.id,
            descripcion: first.descripcion || '',
            hash: first.hash || '',
            skills: [ins.id],
            versiones: [{ numero: 1, fecha: '', markdown: '', hash: first.hash || '' }]
          })
        ].filter(Boolean);
      }
    }
    // Máx. 1 en UI
    linked = linked.slice(0, 1);
    if (!window.SystemPromptsUI || !window.SystemPromptsUI.montarLista) {
      mount.replaceChildren();
      if (vacio) {
        vacio.hidden = !linked.length;
        vacio.textContent = linked.length ? '' : 'Ningún system prompt asociado.';
      }
      return;
    }
    if (vacio) vacio.hidden = true;
    window.SystemPromptsUI.montarLista(mount, {
      getSnapshot: function () {
        return {
          ready: true,
          indexError: false,
          systemPrompts: linked,
          abierta: null
        };
      },
      abrirSystemPrompt: function (id) { abrir(id); },
      añadirSystemPrompt: function () {}
    }, { emptyMsg: 'Ningún system prompt asociado.' });
  }

  function wire() {
    var btnCerrar = document.getElementById('btnCerrarSystemPrompt');
    if (btnCerrar) btnCerrar.addEventListener('click', cerrarModal);
    var btnAtras = document.getElementById('btnAtrasSystemPrompt');
    if (btnAtras) {
      btnAtras.addEventListener('click', function () {
        if (typeof atrasDesdeFicha === 'function') atrasDesdeFicha(cerrarModal);
        else cerrarModal();
      });
    }
    var btnEditar = document.getElementById('btnEditarSystemPrompt');
    if (btnEditar) {
      btnEditar.addEventListener('click', function () {
        if (!spState.abiertoId) return;
        abrirDialogoEditar(spState.abiertoId);
      });
    }
    var btnEliminar = document.getElementById('btnEliminarSystemPrompt');
    if (btnEliminar) {
      btnEliminar.addEventListener('click', function () {
        if (!spState.abiertoId) return;
        if (typeof abrirDialogoEliminar === 'function') {
          abrirDialogoEliminar({ tipo: 'system-prompt', id: spState.abiertoId });
        }
      });
    }
    var btnHist = document.getElementById('btnHistorialSystemPrompt');
    if (btnHist) {
      btnHist.addEventListener('click', function () {
        spState.historial = !spState.historial;
        var item = abierto();
        if (item) renderHistorial(item, versionAbierta(item));
      });
    }
    var histLista = document.getElementById('historialSystemPromptLista');
    if (histLista) {
      histLista.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-numero]');
        if (!btn || !spState.abiertoId) return;
        abrir(spState.abiertoId, Number(btn.dataset.numero));
      });
    }
    var tabs = document.getElementById('spReaderTabs');
    if (tabs) {
      tabs.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-sp-tab]');
        if (!btn) return;
        seleccionarTab(btn.getAttribute('data-sp-tab'));
      });
    }
    var btnEditarSkills = document.getElementById('btnEditarSystemPromptSkills');
    if (btnEditarSkills) btnEditarSkills.addEventListener('click', abrirDialogoEditarSkills);

    var formNuevo = document.getElementById('formNuevoSystemPrompt');
    if (formNuevo) formNuevo.addEventListener('submit', onSubmitNuevo);
    var nuevoCancelar = document.getElementById('nuevoSystemPromptCancelar');
    if (nuevoCancelar) {
      nuevoCancelar.addEventListener('click', function () {
        document.getElementById('dlgNuevoSystemPrompt').close();
      });
    }

    var formEditar = document.getElementById('formEditarSystemPrompt');
    if (formEditar) formEditar.addEventListener('submit', onSubmitEditar);
    var editarCancelar = document.getElementById('editarSystemPromptCancelar');
    if (editarCancelar) {
      editarCancelar.addEventListener('click', function () {
        document.getElementById('dlgEditarSystemPrompt').close();
      });
    }
    var editarTabs = document.getElementById('editarSpTabs');
    if (editarTabs) {
      editarTabs.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-editar-sp-tab]');
        if (!btn) return;
        seleccionarEditarTab(btn.getAttribute('data-editar-sp-tab'));
      });
    }

    var formSkills = document.getElementById('formEditarSystemPromptSkills');
    if (formSkills) formSkills.addEventListener('submit', onSubmitEditarSkills);
    var skillsCancelar = document.getElementById('editarSystemPromptSkillsCancelar');
    if (skillsCancelar) {
      skillsCancelar.addEventListener('click', function () {
        document.getElementById('dlgEditarSystemPromptSkills').close();
      });
    }

    var btnSkillSp = document.getElementById('btnEditarSkillSystemPrompt');
    if (btnSkillSp) btnSkillSp.addEventListener('click', abrirDialogoEditarSkillSystemPrompt);
    var formSkillSp = document.getElementById('formEditarSkillSystemPrompt');
    if (formSkillSp) formSkillSp.addEventListener('submit', onSubmitEditarSkillSystemPrompt);
    var skillSpCancelar = document.getElementById('editarSkillSystemPromptCancelar');
    if (skillSpCancelar) {
      skillSpCancelar.addEventListener('click', function () {
        document.getElementById('dlgEditarSkillSystemPrompt').close();
      });
    }

    var hashBtn = document.getElementById('spHashBtn');
    if (hashBtn) {
      hashBtn.addEventListener('click', function () {
        var h = hashBtn.dataset.hash || '';
        if (!h || !navigator.clipboard) return;
        navigator.clipboard.writeText(h).catch(function () {});
      });
    }

    var dlg = document.getElementById('dlgSystemPrompt');
    if (dlg) {
      dlg.addEventListener('close', function () {
        spState.abiertoId = null;
        spState.abiertaNumero = null;
        spState.historial = false;
        if (typeof syncFichaPaneClass === 'function') syncFichaPaneClass();
        pintar();
      });
    }

    if (typeof iconizarPestanasFicha === 'function') {
      iconizarPestanasFicha(document.getElementById('dlgSystemPrompt'));
      iconizarPestanasFicha(document.getElementById('dlgEditarSystemPrompt'));
    }
  }

  window.SystemPromptsCatalog = {
    state: spState,
    cargar: cargar,
    wire: wire,
    pintar: pintar,
    abrir: abrir,
    eliminar: eliminar,
    promptsDeSkill: promptsDeSkill,
    pintarSkillSystemPromptsTab: pintarSkillSystemPromptsTab,
    bridge: bridge
  };
})();
