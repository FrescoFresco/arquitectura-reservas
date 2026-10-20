'use strict';

(function () {
  if (typeof React === 'undefined' || typeof ReactDOM === 'undefined') return;

  var e = React.createElement;
  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  var OJO_ABIERTO = e('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '2', strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
    e('path', { d: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z' }),
    e('circle', { cx: '12', cy: '12', r: '3' })
  );
  var OJO_CERRADO = e('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '2', strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
    e('path', { d: 'M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-10-8-10-8a18.45 18.45 0 0 1 5.06-5.94' }),
    e('path', { d: 'M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19' }),
    e('path', { d: 'M1 1l22 22' }),
    e('path', { d: 'M14.12 14.12a3 3 0 1 1-4.24-4.24' })
  );
  var ICONO_HIST = e('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '2', strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
    e('circle', { cx: '12', cy: '12', r: '8' }),
    e('path', { d: 'M12 8v4l3 2' })
  );

  function formatVersion(numero, fecha) {
    var match = /^(\d{4})-(\d{2})-(\d{2})/.exec(fecha || '');
    if (!match) return 'v' + numero;
    var mes = MESES[Number(match[2]) - 1];
    if (!mes) return 'v' + numero;
    return 'v' + numero + ' · ' + Number(match[3]) + ' ' + mes;
  }

  function versionActual(ins) {
    return ins.versiones[ins.versiones.length - 1];
  }

  function HistorialPopup(props) {
    var ins = props.ins;
    var abierta = props.abierta;
    var onElegir = props.onElegir;
    var orden = ins.versiones.slice().sort(function (a, b) { return b.numero - a.numero; });
    return e('div', { className: 'historial skill-historial', role: 'dialog', 'aria-label': 'Versiones' },
      e('p', { className: 'historial-titulo' }, 'Versiones'),
      e('ul', null,
        orden.map(function (v) {
          var marca = abierta && v.numero === abierta.numero;
          return e('li', { key: v.numero },
            e('button', {
              type: 'button',
              'aria-current': marca ? 'true' : undefined,
              onClick: function (ev) {
                ev.stopPropagation();
                onElegir(v.numero);
              }
            },
              e('span', null, formatVersion(v.numero, v.fecha)),
              marca ? e('span', { className: 'marca' }, 'Abierta') : null
            )
          );
        })
      )
    );
  }

  function SkillCard(props) {
    var ins = props.ins;
    var abierta = props.abierta;
    var historialId = props.historialId;
    var onAbrir = props.onAbrir;
    var onHistorial = props.onHistorial;
    var onElegirVersion = props.onElegirVersion;
    var onEliminar = props.onEliminar;
    var onSubir = props.onSubir;
    var actual = versionActual(ins);
    var isOpen = abierta && abierta.id === ins.id;
    var showHist = historialId === ins.id;
    var anclas = Array.isArray(ins.anclas) ? ins.anclas : [];

    return e('article', {
      className: 'skill-card' + (isOpen ? ' is-open' : ''),
      'aria-current': isOpen ? 'true' : undefined
    },
      e('div', { className: 'skill-card-top' },
        e('button', {
          type: 'button',
          className: 'skill-card-abrir',
          'data-accion': 'abrir',
          'data-id': ins.id,
          onClick: function () { onAbrir(ins.id); }
        },
          e('h4', { className: 'skill-nombre' }, ins.nombre),
          e('p', { className: 'bloque-ver' }, formatVersion(actual.numero, actual.fecha)),
          actual.origen === 'local' ? e('p', { className: 'en-navegador' }, 'En este navegador') : null,
          ins.descripcion ? e('p', { className: 'skill-desc' }, ins.descripcion) : null
        ),
        e('div', { className: 'skill-card-acciones' },
          e('span', {
            className: 'ojo',
            'aria-hidden': 'true'
          }, isOpen ? OJO_ABIERTO : OJO_CERRADO),
          e('button', {
            type: 'button',
            className: 'btn eliminar',
            'aria-label': 'Eliminar ' + ins.nombre,
            onClick: function (ev) {
              ev.stopPropagation();
              onEliminar(ins.id);
            }
          }, 'Eliminar'),
          e('div', { className: 'historial-ancla' },
            e('button', {
              type: 'button',
              className: 'icon-btn',
              'aria-label': 'Historial de versiones',
              title: 'Historial de versiones',
              'aria-expanded': showHist ? 'true' : 'false',
              onClick: function (ev) {
                ev.stopPropagation();
                onHistorial(ins.id);
              }
            }, ICONO_HIST),
            showHist ? e(HistorialPopup, {
              ins: ins,
              abierta: isOpen ? abierta.version : actual,
              onElegir: function (numero) { onElegirVersion(ins.id, numero); }
            }) : null
          )
        )
      ),
      anclas.length ? e('div', { className: 'skill-anclas' },
        e('p', { className: 'skill-anclas-titulo' }, 'Anclas'),
        e('div', { className: 'skill-anclas-list' },
          anclas.map(function (a) {
            return e('span', { className: 'ancla-pill', key: a }, a);
          })
        )
      ) : null,
      e('button', {
        type: 'button',
        className: 'btn version',
        onClick: function (ev) {
          ev.stopPropagation();
          onSubir(ins.id);
        }
      }, 'Subir versión')
    );
  }

  function SkillsApp(props) {
    var bridge = props.bridge;
    var snapshot = bridge.getSnapshot();
    var skills = snapshot.instrucciones || [];
    var ready = snapshot.ready;
    var indexError = snapshot.indexError;
    var abierta = snapshot.abierta;
    var historialId = snapshot.historialId;

    var estado = '';
    if (!ready) estado = 'Cargando el índice…';
    else if (indexError) estado = 'No se pudo leer el índice compartido.';
    else if (!skills.length) estado = 'No hay skills.';

    return e('div', { className: 'skills-app' },
      e('div', { className: 'skills-toolbar' },
        e('button', {
          type: 'button',
          className: 'btn primary',
          onClick: function () { bridge.añadirSkill(); }
        }, '+ Añadir skill')
      ),
      e('p', { className: 'limite' },
        'La subida y Eliminar se quedan en este navegador, encima del índice publicado. No se envían a GitHub. Para publicarlos, el contrato está en Documentación → API.'
      ),
      estado ? e('p', { className: 'estado', role: 'status' }, estado) : null,
      e('div', { className: 'skills-grid' },
        skills.map(function (ins) {
          return e(SkillCard, {
            key: ins.id,
            ins: ins,
            abierta: abierta,
            historialId: historialId,
            onAbrir: function (id) { bridge.abrirSkill(id); },
            onHistorial: function (id) { bridge.alternarHistorial(id); },
            onElegirVersion: function (id, n) { bridge.abrirSkill(id, n); },
            onEliminar: function (id) { bridge.eliminarSkill(id); },
            onSubir: function (id) { bridge.subirVersion(id); }
          });
        })
      )
    );
  }

  var root = null;
  var reactRoot = null;

  function montar(bridge) {
    root = document.getElementById('skills-root');
    if (!root || !bridge) return;
    if (!reactRoot) reactRoot = ReactDOM.createRoot(root);
    reactRoot.render(e(SkillsApp, { bridge: bridge }));
  }

  window.SkillsUI = {
    montar: montar,
    refrescar: function (bridge) { montar(bridge); }
  };
})();
