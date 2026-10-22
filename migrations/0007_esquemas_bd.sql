-- Esquemas de BD: quitar negocios legado como proyectos, pasos array, schema llamadas.

ALTER TABLE campos_mongo ADD COLUMN enum_json TEXT NOT NULL DEFAULT '[]';

-- 1) Borrar esquemas legado (ya viven en cajón negocios del schema reservas).
DELETE FROM proyecto_skills WHERE proyecto_id IN ('pelo-sur', 'la-mesa-norte');
DELETE FROM proyecto_versions WHERE proyecto_id IN ('pelo-sur', 'la-mesa-norte');
DELETE FROM proyectos WHERE id IN ('pelo-sur', 'la-mesa-norte');

-- 2) recorrido.pasos: de clave con N literal → array con hijos.
DELETE FROM campos_mongo WHERE id = 'versiones-recorrido-pasos-N-accion'
  OR campo = 'versiones.recorrido.pasos.N.accion'
  OR clave = 'recorrido.pasos.N.accion';

INSERT OR REPLACE INTO campos_mongo (
  id, campo, base_datos, coleccion, clave, bson_type, obligatorio, descripcion, ancla, hash,
  proyeccion_mongo, proyeccion_elemento, indices, proyecto, hijos, created_at, updated_at
) VALUES (
  'versiones-recorrido-pasos',
  'versiones.recorrido.pasos',
  'software_reservas',
  'versiones',
  'recorrido.pasos',
  'array',
  0,
  'Pasos del recorrido como array de objetos {accion, selector, valor}. Sin índice literal N en la clave.',
  '_version.recorrido.pasos_',
  'esquemas-bd-recorrido-pasos-array-v1',
  '',
  '{}',
  '[]',
  'reservas',
  '[{"id":"accion","clave":"accion","bsonType":"string","descripcion":"Qué se hace en este paso."},{"id":"selector","clave":"selector","bsonType":"string","descripcion":"Selector Playwright."},{"id":"valor","clave":"valor","bsonType":"string","descripcion":"Valor escrito o elegido."}]',
  datetime('now'),
  datetime('now')
);

-- Ancla pasos (sustituye version.recorrido.pasos.N.accion).
DELETE FROM ancla_skills WHERE ancla_id = 'version.recorrido.pasos.N.accion';
DELETE FROM skill_anclas WHERE ancla = '_version.recorrido.pasos.N.accion_'
  OR ancla = '_version.recorrido.pasos.N.selector_'
  OR ancla = '_version.recorrido.pasos.N.url_';
DELETE FROM anclas WHERE id = 'version.recorrido.pasos.N.accion';

INSERT OR REPLACE INTO anclas (
  id, ancla, etiqueta, clave_mongo, coleccion, base_datos, tipo, obligatorio, formato,
  descripcion, ejemplo, hash, aliases, observaciones, valor_actual, sensible, created_at, updated_at
) VALUES (
  'version.recorrido.pasos',
  '_version.recorrido.pasos_',
  'Pasos del recorrido',
  'recorrido.pasos',
  'versiones',
  'software_reservas',
  'array',
  0,
  'array-objetos',
  'Array de pasos {accion, selector, valor}. Sin N literal en la clave.',
  '[{accion, selector, valor}]',
  'esquemas-bd-ancla-recorrido-pasos-v1',
  '[]',
  '[]',
  '',
  0,
  datetime('now'),
  datetime('now')
);

INSERT OR IGNORE INTO ancla_skills (ancla_id, skill_id) VALUES
  ('version.recorrido.pasos', 'mapear-recorrido'),
  ('version.recorrido.pasos', 'generar-script');

INSERT OR IGNORE INTO skill_anclas (skill_id, ancla) VALUES
  ('mapear-recorrido', '_version.recorrido.pasos_'),
  ('generar-script', '_version.recorrido.pasos_');

-- 3) Schema llamadas
INSERT OR REPLACE INTO proyectos (
  id, nombre, descripcion, hash, created_at, updated_at,
  base_datos, colecciones, relaciones, agentes_json, legacy_negocio
) VALUES (
  'llamadas',
  'Software de llamadas',
  'Software de llamadas: clientes y registro de llamadas. Relación llamadas.cliente_id → clientes._id (N:1).',
  'llamadas-software-v1',
  datetime('now'),
  datetime('now'),
  'software_llamadas',
  '[{"id":"clientes","descripcion":"Fichas de cliente (nombre y teléfono)"},{"id":"llamadas","descripcion":"Registro de llamadas salientes/entrantes"}]',
  '[{"desde":"llamadas.cliente_id","hacia":"clientes._id","tipo":"N:1"}]',
  '[]',
  0
);

INSERT OR IGNORE INTO proyecto_versions (
  proyecto_id, numero, fecha, markdown, ruta, nombre_archivo, hash
) VALUES (
  'llamadas', 1, '2026-10-22',
  '# Software de llamadas

## Versión

1

## Qué es

Esquema de base de datos para el software de **llamadas**: base Mongo `software_llamadas` con cajones `clientes` y `llamadas`.
',
  'catalogo/proyectos/llamadas/v1.md', 'v1.md', 'llamadas-software-md-v1'
);

INSERT OR REPLACE INTO campos_mongo (
  id, campo, base_datos, coleccion, clave, bson_type, obligatorio, descripcion, ancla, hash,
  proyeccion_mongo, proyeccion_elemento, indices, proyecto, hijos, created_at, updated_at
) VALUES
('clientes-nombre', 'clientes.nombre', 'software_llamadas', 'clientes', 'nombre', 'string', 1, 'Nombre del cliente.', '', 'llamadas-clientes-nombre-v1', '', '{}', '[]', 'llamadas', '[]', datetime('now'), datetime('now')),
('clientes-telefono', 'clientes.telefono', 'software_llamadas', 'clientes', 'telefono', 'string', 1, 'Teléfono E.164 del cliente.', '', 'llamadas-clientes-telefono-v1', '', '{}', '[]', 'llamadas', '[]', datetime('now'), datetime('now')),
('llamadas-fecha', 'llamadas.fecha', 'software_llamadas', 'llamadas', 'fecha', 'date', 1, 'Momento de la llamada (BSON date / ISO-8601).', '', 'llamadas-fecha-v1', '', '{}', '[]', 'llamadas', '[]', datetime('now'), datetime('now')),
('llamadas-resultado', 'llamadas.resultado', 'software_llamadas', 'llamadas', 'resultado', 'string', 1, 'Resultado: contesto | no_contesto | cita.', '', 'llamadas-resultado-v1', '', '{}', '[]', 'llamadas', '[]', datetime('now'), datetime('now')),
('llamadas-cliente_id', 'llamadas.cliente_id', 'software_llamadas', 'llamadas', 'cliente_id', 'string', 1, 'Referencia al cliente (clientes._id).', '', 'llamadas-cliente_id-v1', '', '{}', '[{"nombre":"idx_llamadas_cliente_id","keys":{"cliente_id":1}}]', 'llamadas', '[]', datetime('now'), datetime('now'));

-- Teléfono de prueba no es el valor real de Pelo Sur.
UPDATE ancla_valores_negocio
SET valor_actual = '+34699111222', updated_at = datetime('now')
WHERE negocio_id = 'pelo-sur'
  AND ancla_id IN ('negocio.telefono', 'negocio-telefono')
  AND valor_actual = '+34600111222';

UPDATE campos_mongo SET enum_json = '["contesto","no_contesto","cita"]', updated_at = datetime('now')
WHERE id = 'llamadas-resultado';
