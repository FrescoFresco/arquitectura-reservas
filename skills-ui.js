'use strict';

(function () {
  if (typeof React === 'undefined' || typeof ReactDOM === 'undefined') return;

  var e = React.createElement;
  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  function svgIcon(children) {
    return e('svg', {
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: '2',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': 'true'
    }, children);
  }

  var ICONO_HIST = svgIcon([
    e('circle', { key: 'a', cx: '12', cy: '12', r: '8' }),
    e('path', { key: 'b', d: 'M12 8v4l3 2' })
  ]);
  var ICONO_EDIT = svgIcon([
    e('path', { key: 'a', d: 'M12 20h9' }),
    e('path', { key: 'b', d: 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z' })
  ]);
  var ICONO_UPLOAD = svgIcon([
    e('path', { key: 'a', d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }),
    e('polyline', { key: 'b', points: '17 8 12 3 7 8' }),
    e('line', { key: 'c', x1: '12', y1: '3', x2: '12', y2: '15' })
  ]);
  var ICONO_TRASH = svgIcon([
    e('polyline', { key: 'a', points: '3 6 5 6 21 6' }),
    e('path', { key: 'b', d: 'M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6' }),
    e('path', { key: 'c', d: 'M10 11v6' }),
    e('path', { key: 'd', d: 'M14 11v6' }),
    e('path', { key: 'e', d: 'M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2' })
  ]);

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

  function HashChip(props) {
    var full = typeof props.hash === 'string' ? props.hash.trim().toLowerCase() : '';
    if (!full || full.length < 8) return null;
    var corto = full.slice(0, 10);
    return e('button', {
      type: 'button',
      className: 'hash-chip' + (props.inline ? ' hash-chip-inline' : ''),
      title: 'Hash completo: ' + full + ' (clic para copiar)',
      'aria-label': 'Copiar hash ' + full,
      onClick: function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(full).catch(function () {});
        }
      }
    }, '#' + corto);
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

  function IconBtn(props) {
    return e('button', {
      type: 'button',
      className: 'icon-btn' + (props.active ? ' is-on' : ''),
      'aria-label': props.label,
      title: props.title || props.label,
      'aria-expanded': props.expanded,
      'aria-pressed': props.pressed,
      onClick: props.onClick
    }, props.children);
  }

  function SkillCard(props) {
    var ins = props.ins;
    var abierta = props.abierta;
    var historialId = props.historialId;
    var onAbrir = props.onAbrir;
    var onHistorial = props.onHistorial;
    var onElegirVersion = props.onElegirVersion;
    var onEditar = props.onEditar;
    var onSubir = props.onSubir;
    var onEliminar = props.onEliminar;
    var onAbrirAncla = props.onAbrirAncla;
    var actual = versionActual(ins);
    var isOpen = abierta && abierta.id === ins.id;
    var showHist = historialId === ins.id;
    var anclas = Array.isArray(ins.anclas) ? ins.anclas : [];
    var hash = actual && actual.hash ? actual.hash : '';

    return e('article', {
      className: 'skill-card'
    },
      e('div', { className: 'skill-card-meta' },
        e('p', { className: 'bloque-ver skill-card-ver' }, formatVersion(actual.numero, actual.fecha)),
        e('div', { className: 'skill-card-acciones' },
          e('div', { className: 'historial-ancla' },
            e(IconBtn, {
              label: 'Historial de versiones',
              title: 'Historial',
              expanded: showHist ? 'true' : 'false',
              active: showHist,
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
          ),
          e(IconBtn, {
            label: 'Editar skill',
            title: 'Editar (guarda como versión nueva)',
            onClick: function (ev) {
              ev.stopPropagation();
              onEditar(ins.id);
            }
          }, ICONO_EDIT),
          e(IconBtn, {
            label: 'Subir versión',
            title: 'Subir versión (documento completo)',
            onClick: function (ev) {
              ev.stopPropagation();
              onSubir(ins.id);
            }
          }, ICONO_UPLOAD),
          e(IconBtn, {
            label: 'Eliminar ' + ins.nombre,
            title: 'Eliminar',
            onClick: function (ev) {
              ev.stopPropagation();
              onEliminar(ins.id);
            }
          }, ICONO_TRASH)
        )
      ),
      e('button', {
        type: 'button',
        className: 'skill-card-abrir',
        'data-accion': 'abrir',
        'data-id': ins.id,
        onClick: function () { onAbrir(ins.id); }
      },
        e('h4', { className: 'skill-nombre' }, ins.nombre)
      ),
      e(HashChip, { hash: hash, inline: true }),
      actual.origen === 'local' ? e('p', { className: 'en-navegador skill-card-local' }, 'En este navegador') : null,
      ins.descripcion ? e('p', { className: 'skill-desc' }, ins.descripcion) : null,
      anclas.length ? e('div', { className: 'skill-anclas-box' },
        e('p', { className: 'skill-anclas-titulo' }, 'Anclas'),
        e('div', { className: 'skill-anclas-list' },
          anclas.map(function (a) {
            return e('button', {
              type: 'button',
              className: 'ancla-pill ancla-pill-btn',
              key: a,
              title: 'Ver campo ancla',
              onClick: function (ev) {
                ev.stopPropagation();
                if (onAbrirAncla) onAbrirAncla(a);
              }
            }, a);
          })
        )
      ) : null
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
        'Editar modifica el contenido y guarda una versión nueva. Subir versión carga un documento completo como versión nueva. Los cambios de este navegador no se envían a GitHub; el contrato está en Documentación → API.'
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
            onEditar: function (id) { bridge.editarSkill(id); },
            onEliminar: function (id) { bridge.eliminarSkill(id); },
            onSubir: function (id) { bridge.subirVersion(id); },
            onAbrirAncla: function (ancla) { bridge.abrirAncla(ancla); }
          });
        })
      )
    );
  }

  var reactRoot = null;

  function montar(bridge) {
    var root = document.getElementById('skills-root');
    if (!root || !bridge) return;
    if (!reactRoot) reactRoot = ReactDOM.createRoot(root);
    reactRoot.render(e(SkillsApp, { bridge: bridge }));
  }

  window.SkillsUI = {
    montar: montar,
    refrescar: function (bridge) { montar(bridge); }
  };
})();
