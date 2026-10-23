/**
 * Ajustes → Agentes (catálogo de quién entra en el hub).
 * La URI Mongo ya no vive aquí: solo en Cluster → Conexión.
 */
(function () {
  'use strict';

  function seleccionarSeccion(id) {
    const tabs = document.querySelectorAll('#ajustesTabs [data-ajuste]');
    const panels = document.querySelectorAll('#ajustes [data-ajuste-panel]');
    let found = false;
    tabs.forEach(function (tab) {
      const on = tab.getAttribute('data-ajuste') === id;
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
      if (on) found = true;
    });
    if (!found) id = 'agentes';
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
    if (id === 'agentes' && typeof window.mostrarAgentesAjustes === 'function') {
      window.mostrarAgentesAjustes();
    }
  }

  function aplicarHash() {
    const h = (location.hash || '').replace(/^#/, '');
    if (h !== 'ajustes' && h.indexOf('ajustes/') !== 0) return;
    if (typeof window.abrirDestino === 'function') window.abrirDestino('ajustes');
    const parts = h.split('/');
    const sec = parts[1] === 'conexiones' ? 'agentes' : parts[1] || 'agentes';
    seleccionarSeccion(sec);
  }

  function init() {
    const tabs = document.getElementById('ajustesTabs');
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
      abrirAgentes: function () {
        if (typeof window.abrirDestino === 'function') window.abrirDestino('ajustes');
        seleccionarSeccion('agentes');
        location.hash = '#ajustes/agentes';
      },
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
