/**
 * Ajustes → Conexiones (MongoDB Atlas URI in-app).
 * Never re-displays a saved URI — only Configurada + safe host hint.
 */
(function () {
  'use strict';

  function apiBase() {
    if (typeof window !== 'undefined' && window.ARQ_API_BASE) return String(window.ARQ_API_BASE).replace(/\/$/, '');
    if (typeof window !== 'undefined' && window.CAMPOS_API_BASE) {
      return String(window.CAMPOS_API_BASE).replace(/\/$/, '');
    }
    return 'https://campos-ancla-api.web-legal-es.workers.dev';
  }

  function claveEscritura() {
    try {
      return (
        localStorage.getItem('AGENTE_CLAVE') ||
        localStorage.getItem('ARQ_AGENTE_CLAVE') ||
        ''
      ).trim();
    } catch (e) {
      return '';
    }
  }

  function guardarClave(clave) {
    try {
      if (clave) localStorage.setItem('AGENTE_CLAVE', clave);
    } catch (e) {}
  }

  function asegurarClave() {
    const existing = claveEscritura();
    if (existing) return Promise.resolve(existing);
    return fetch(apiBase() + '/v1/invites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) throw new Error((data && data.error) || 'No se pudo crear invite');
          return data;
        });
      })
      .then(function (data) {
        const clave = data && data.invite && data.invite.clave;
        if (!clave) throw new Error('No se pudo crear invite de Ajustes.');
        guardarClave(clave);
        return clave;
      });
  }

  function authFetch(path, opts) {
    return asegurarClave().then(function (clave) {
      const init = Object.assign({}, opts || {});
      const headers = Object.assign({}, init.headers || {});
      headers.Authorization = 'Bearer ' + clave;
      init.headers = headers;
      return fetch(apiBase() + path, init).then(function (res) {
        return res.json().then(function (data) {
          return { res: res, data: data || {} };
        });
      });
    });
  }

  function el(id) {
    return document.getElementById(id);
  }

  function setBusy(busy) {
    ['ajustesMongoGuardar', 'ajustesMongoProbar', 'ajustesMongoBorrar'].forEach(function (id) {
      const n = el(id);
      if (n) n.disabled = !!busy;
    });
  }

  function setMsg(text, kind) {
    const n = el('ajustesMongoMsg');
    if (!n) return;
    n.textContent = text || '';
    n.classList.remove('is-ok', 'is-err', 'is-info');
    if (kind) n.classList.add(kind);
  }

  function pintarStatus(data) {
    const badge = el('ajustesMongoStatus');
    const hintEl = el('ajustesMongoHint');
    if (!badge) return;
    const configured = !!(data && data.configured);
    const connected = data && data.connected;
    const source = (data && data.source) || 'none';
    const hint = (data && data.hint) || '';
    const db = (data && data.db) || '';

    badge.classList.remove('is-yes', 'is-no', 'is-err');
    let label = 'Sin configurar';
    if (configured) {
      label = 'Configurada';
      if (connected === true) label += ' · conectada';
      else if (connected === false) label += ' · sin conexión al cluster';
      badge.classList.add(connected === false ? 'is-err' : 'is-yes');
    } else {
      badge.classList.add('is-no');
    }
    badge.textContent = label;

    let extra = [];
    if (configured && hint) extra.push('pista ' + hint);
    if (db) extra.push('db ' + db);
    if (source === 'env') extra.push('vía secret del Worker');
    if (source === 'stored') extra.push('guardada en el panel');
    if (hintEl) {
      hintEl.textContent = extra.length ? extra.join(' · ') : 'La URI guardada no se vuelve a mostrar.';
    }

    const uriInput = el('ajustesMongoUri');
    if (uriInput && configured) {
      uriInput.value = '';
      uriInput.placeholder = configured
        ? 'URI ya configurada — pega una nueva solo para reemplazar'
        : 'mongodb+srv://usuario:contraseña@cluster…/';
    }
    const dbInput = el('ajustesMongoDb');
    if (dbInput && db && !dbInput.value) {
      dbInput.value = db;
      dbInput.placeholder = db || 'software_reservas';
    } else if (dbInput && !dbInput.placeholder) {
      dbInput.placeholder = 'software_reservas';
    }
  }

  function refrescarStatus() {
    const badge = el('ajustesMongoStatus');
    if (badge) {
      badge.textContent = 'Consultando…';
      badge.classList.remove('is-yes', 'is-no', 'is-err');
    }
    return fetch(apiBase() + '/v1/mongo/status', { cache: 'no-store' })
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        pintarStatus(data);
        if (typeof window.refrescarMongoConnStatus === 'function') {
          window.refrescarMongoConnStatus();
        }
        return data;
      })
      .catch(function () {
        pintarStatus({ configured: false, connected: false, source: 'none' });
        setMsg('No se pudo consultar el estado de Mongo.', 'is-err');
      });
  }

  function leerForm() {
    const uri = (el('ajustesMongoUri') && el('ajustesMongoUri').value) || '';
    const db = (el('ajustesMongoDb') && el('ajustesMongoDb').value) || '';
    return { uri: uri.trim(), db: db.trim() };
  }

  function onGuardar(e) {
    if (e) e.preventDefault();
    const form = leerForm();
    if (!form.uri) {
      setMsg('Pega la URI de Atlas para guardar.', 'is-err');
      return;
    }
    setBusy(true);
    setMsg('Guardando…', 'is-info');
    authFetch('/v1/mongo/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uri: form.uri, db: form.db || undefined }),
    })
      .then(function (pack) {
        if (!pack.res.ok) {
          throw new Error((pack.data && pack.data.error) || 'No se pudo guardar');
        }
        if (el('ajustesMongoUri')) el('ajustesMongoUri').value = '';
        pintarStatus(pack.data);
        setMsg(
          pack.data.connected
            ? 'Guardada y conectada. La URI ya no se muestra.'
            : 'Guardada. El cluster no responde aún (revisa red/Atlas); la URI no se reexpone.',
          pack.data.connected ? 'is-ok' : 'is-info'
        );
        if (typeof window.refrescarMongoConnStatus === 'function') {
          window.refrescarMongoConnStatus();
        }
      })
      .catch(function (err) {
        setMsg(err && err.message ? err.message : 'Error al guardar', 'is-err');
      })
      .then(function () {
        setBusy(false);
      });
  }

  function onProbar(e) {
    if (e) e.preventDefault();
    const form = leerForm();
    if (!form.uri) {
      setMsg('Pega una URI para probar (no se guarda).', 'is-err');
      return;
    }
    setBusy(true);
    setMsg('Probando conexión…', 'is-info');
    authFetch('/v1/mongo/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uri: form.uri,
        db: form.db || undefined,
        probeOnly: true,
      }),
    })
      .then(function (pack) {
        if (!pack.res.ok) {
          throw new Error((pack.data && pack.data.error) || 'Prueba fallida');
        }
        if (pack.data.connected) {
          setMsg('Conexión OK (no se ha guardado).', 'is-ok');
        } else {
          setMsg(
            'No alcanza el cluster: ' + ((pack.data && pack.data.error) || 'sin detalle'),
            'is-err'
          );
        }
      })
      .catch(function (err) {
        setMsg(err && err.message ? err.message : 'Error al probar', 'is-err');
      })
      .then(function () {
        setBusy(false);
      });
  }

  function onBorrar(e) {
    if (e) e.preventDefault();
    if (!window.confirm('¿Borrar la URI guardada en el panel? El secret del Worker (si existe) no se toca.')) {
      return;
    }
    setBusy(true);
    setMsg('Borrando…', 'is-info');
    authFetch('/v1/mongo/config', { method: 'DELETE' })
      .then(function (pack) {
        if (!pack.res.ok) {
          throw new Error((pack.data && pack.data.error) || 'No se pudo borrar');
        }
        if (el('ajustesMongoUri')) el('ajustesMongoUri').value = '';
        pintarStatus(pack.data);
        setMsg('Configuración del panel borrada.', 'is-ok');
        if (typeof window.refrescarMongoConnStatus === 'function') {
          window.refrescarMongoConnStatus();
        }
      })
      .catch(function (err) {
        setMsg(err && err.message ? err.message : 'Error al borrar', 'is-err');
      })
      .then(function () {
        setBusy(false);
      });
  }

  function seleccionarSeccion(id) {
    const tabs = document.querySelectorAll('#ajustesTabs [data-ajuste]');
    const panels = document.querySelectorAll('#ajustes [data-ajuste-panel]');
    let found = false;
    tabs.forEach(function (tab) {
      const on = tab.getAttribute('data-ajuste') === id;
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
      if (on) found = true;
    });
    if (!found) id = 'conexiones';
    panels.forEach(function (panel) {
      panel.hidden = panel.getAttribute('data-ajuste-panel') !== id;
    });
    if (typeof history !== 'undefined' && history.replaceState) {
      const next = '#ajustes/' + id;
      if (location.hash !== next && location.hash !== '#ajustes') {
        history.replaceState(null, '', next);
      } else if (location.hash === '#ajustes') {
        history.replaceState(null, '', next);
      }
    }
    if (id === 'conexiones') refrescarStatus();
  }

  function aplicarHash() {
    const h = (location.hash || '').replace(/^#/, '');
    if (h !== 'ajustes' && h.indexOf('ajustes/') !== 0) return;
    if (typeof window.abrirDestino === 'function') window.abrirDestino('ajustes');
    const parts = h.split('/');
    seleccionarSeccion(parts[1] || 'conexiones');
  }

  function init() {
    const form = el('formAjustesMongo');
    if (form) form.addEventListener('submit', onGuardar);
    const probar = el('ajustesMongoProbar');
    if (probar) probar.addEventListener('click', onProbar);
    const borrar = el('ajustesMongoBorrar');
    if (borrar) borrar.addEventListener('click', onBorrar);
    const tabs = el('ajustesTabs');
    if (tabs) {
      tabs.addEventListener('click', function (e) {
        let n = e.target;
        while (n && n !== tabs) {
          if (n.getAttribute && n.getAttribute('data-ajuste')) {
            seleccionarSeccion(n.getAttribute('data-ajuste'));
            return;
          }
          n = n.parentNode;
        }
      });
    }
    window.addEventListener('hashchange', aplicarHash);
    aplicarHash();
    window.AjustesUI = {
      refrescar: refrescarStatus,
      abrirConexiones: function () {
        if (typeof window.abrirDestino === 'function') window.abrirDestino('ajustes');
        seleccionarSeccion('conexiones');
        location.hash = '#ajustes/conexiones';
      },
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
