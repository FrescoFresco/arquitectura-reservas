-- Skills I/O: entradas (lee) / salidas (escribe). `anclas` en API = unión.
-- Reemplaza skill_anclas (skill_id, ancla) por (skill_id, ancla, direccion).
-- Sin FK en la tabla temporal (D1 no respeta PRAGMA foreign_keys=OFF de forma fiable).

CREATE TABLE skill_anclas_io (
  skill_id TEXT NOT NULL,
  ancla TEXT NOT NULL,
  direccion TEXT NOT NULL CHECK (direccion IN ('entrada', 'salida')),
  PRIMARY KEY (skill_id, ancla, direccion)
);

-- descubrir-negocio
INSERT OR IGNORE INTO skill_anclas_io (skill_id, ancla, direccion)
SELECT skill_id, ancla, 'entrada' FROM skill_anclas
WHERE skill_id = 'descubrir-negocio' AND ancla = '_negocio.url_';

INSERT OR IGNORE INTO skill_anclas_io (skill_id, ancla, direccion)
SELECT skill_id, ancla, 'salida' FROM skill_anclas
WHERE skill_id = 'descubrir-negocio';

-- mapear-recorrido
INSERT OR IGNORE INTO skill_anclas_io (skill_id, ancla, direccion)
SELECT skill_id, ancla, 'entrada' FROM skill_anclas
WHERE skill_id = 'mapear-recorrido'
  AND ancla IN ('_negocio.url_', '_proceso.url_inicio_', '_negocio.nombre_', '_negocio.zona_horaria_');

INSERT OR IGNORE INTO skill_anclas_io (skill_id, ancla, direccion)
SELECT skill_id, ancla, 'salida' FROM skill_anclas
WHERE skill_id = 'mapear-recorrido'
  AND ancla NOT IN ('_negocio.url_', '_proceso.url_inicio_', '_negocio.nombre_', '_negocio.zona_horaria_');

-- generar-script
INSERT OR IGNORE INTO skill_anclas_io (skill_id, ancla, direccion)
SELECT skill_id, ancla, 'entrada' FROM skill_anclas
WHERE skill_id = 'generar-script'
  AND (
    ancla LIKE '_version.recorrido.%'
    OR ancla = '_proceso.url_inicio_'
  );

INSERT OR IGNORE INTO skill_anclas_io (skill_id, ancla, direccion)
SELECT skill_id, ancla, 'salida' FROM skill_anclas
WHERE skill_id = 'generar-script'
  AND ancla NOT LIKE '_version.recorrido.%'
  AND ancla != '_proceso.url_inicio_';

-- diagnosticar-alerta
INSERT OR IGNORE INTO skill_anclas_io (skill_id, ancla, direccion)
SELECT skill_id, ancla, 'entrada' FROM skill_anclas
WHERE skill_id = 'diagnosticar-alerta'
  AND (
    ancla LIKE '_ejecucion.%'
    OR ancla = '_proceso.url_inicio_'
  );

INSERT OR IGNORE INTO skill_anclas_io (skill_id, ancla, direccion)
SELECT skill_id, ancla, 'salida' FROM skill_anclas
WHERE skill_id = 'diagnosticar-alerta'
  AND ancla NOT LIKE '_ejecucion.%'
  AND ancla != '_proceso.url_inicio_';

-- Resto
INSERT OR IGNORE INTO skill_anclas_io (skill_id, ancla, direccion)
SELECT sa.skill_id, sa.ancla, 'salida'
FROM skill_anclas sa
WHERE NOT EXISTS (
  SELECT 1 FROM skill_anclas_io io
  WHERE io.skill_id = sa.skill_id AND io.ancla = sa.ancla
);

-- Sustituir literales N: insertar canónicos, luego borrar variantes con N
INSERT OR IGNORE INTO skill_anclas_io (skill_id, ancla, direccion)
SELECT DISTINCT skill_id, '_version.recorrido.campos_', direccion
FROM skill_anclas_io
WHERE ancla LIKE '_version.recorrido.campos.N%';

INSERT OR IGNORE INTO skill_anclas_io (skill_id, ancla, direccion)
SELECT DISTINCT skill_id, '_ejecucion.traza_', direccion
FROM skill_anclas_io
WHERE ancla = '_ejecucion.traza.N.mensaje_';

INSERT OR IGNORE INTO skill_anclas_io (skill_id, ancla, direccion)
SELECT DISTINCT skill_id, '_corrida.errores_', direccion
FROM skill_anclas_io
WHERE ancla = '_corrida.errores.N_';

DELETE FROM skill_anclas_io
WHERE ancla LIKE '_version.recorrido.campos.N%'
   OR ancla = '_ejecucion.traza.N.mensaje_'
   OR ancla = '_corrida.errores.N_';

DROP TABLE skill_anclas;
ALTER TABLE skill_anclas_io RENAME TO skill_anclas;
CREATE INDEX IF NOT EXISTS idx_skill_anclas_ancla ON skill_anclas(ancla);
CREATE INDEX IF NOT EXISTS idx_skill_anclas_dir ON skill_anclas(skill_id, direccion);

-- Renombrar ancla array sin tocar PK de hijos primero: insertar nueva, migrar FKs, borrar vieja
INSERT OR IGNORE INTO anclas (
  id, ancla, etiqueta, clave_mongo, coleccion, base_datos, tipo, obligatorio, formato,
  descripcion, ejemplo, hash, aliases, observaciones, valor_actual, sensible, created_at, updated_at
)
SELECT
  'version.recorrido.campos',
  '_version.recorrido.campos_',
  'Campos del recorrido (array)',
  'recorrido.campos',
  coleccion,
  base_datos,
  'array',
  obligatorio,
  'proyeccion-array',
  'Lista canónica de campos del formulario (array BSON). Elementos: nombre, selector, clase. Sin N literal en la ancla.',
  ejemplo,
  'skill-io-recorrido-campos-array',
  aliases,
  observaciones,
  valor_actual,
  sensible,
  created_at,
  datetime('now')
FROM anclas
WHERE id = 'version.recorrido.campos.N' OR ancla = '_version.recorrido.campos.N_';

INSERT OR IGNORE INTO ancla_skills (ancla_id, skill_id)
SELECT 'version.recorrido.campos', skill_id FROM ancla_skills
WHERE ancla_id = 'version.recorrido.campos.N';

INSERT OR IGNORE INTO ancla_valores_negocio (negocio_id, ancla_id, observaciones, valor_actual, updated_at)
SELECT negocio_id, 'version.recorrido.campos', observaciones, valor_actual, updated_at
FROM ancla_valores_negocio
WHERE ancla_id = 'version.recorrido.campos.N';

DELETE FROM ancla_skills WHERE ancla_id = 'version.recorrido.campos.N';
DELETE FROM ancla_valores_negocio WHERE ancla_id = 'version.recorrido.campos.N';
DELETE FROM anclas WHERE id = 'version.recorrido.campos.N' OR ancla = '_version.recorrido.campos.N_';

-- Plantillas hijas con N fuera del catálogo
DELETE FROM ancla_skills WHERE ancla_id IN (
  'version.recorrido.campos.N.nombre',
  'version.recorrido.campos.N.selector',
  'version.recorrido.campos.N.clase'
);
DELETE FROM ancla_valores_negocio WHERE ancla_id IN (
  'version.recorrido.campos.N.nombre',
  'version.recorrido.campos.N.selector',
  'version.recorrido.campos.N.clase'
);
DELETE FROM anclas WHERE id IN (
  'version.recorrido.campos.N.nombre',
  'version.recorrido.campos.N.selector',
  'version.recorrido.campos.N.clase'
);

UPDATE campos_mongo
SET ancla = '_version.recorrido.campos_',
    proyeccion_elemento = '{"nombre":"nombre","selector":"selector","clase":"clase"}',
    descripcion = 'Lista canónica de campos del formulario en la versión del recorrido (array). Elementos {nombre, selector, clase}.',
    hash = 'skill-io-versiones-recorrido-campos',
    updated_at = datetime('now')
WHERE id = 'versiones-recorrido-campos';

UPDATE campos_mongo
SET enum_json = '["contesto","no_contesto","cita"]',
    descripcion = 'Resultado: contesto | no_contesto | cita.',
    updated_at = datetime('now')
WHERE id = 'llamadas-resultado' OR (coleccion = 'llamadas' AND clave = 'resultado');

INSERT OR IGNORE INTO anclas (
  id, ancla, etiqueta, clave_mongo, coleccion, base_datos, tipo, obligatorio, formato,
  descripcion, ejemplo, hash, aliases, observaciones, valor_actual, sensible, created_at, updated_at
) VALUES
(
  'cliente.nombre', '_cliente.nombre_', 'Nombre del cliente', 'nombre', 'clientes', 'software_llamadas',
  'string', 1, '', 'Nombre del cliente (software llamadas).', 'Ana Pérez', 'llamadas-ancla-cliente-nombre-v1',
  '[]', '[]', '', 0, datetime('now'), datetime('now')
),
(
  'cliente.telefono', '_cliente.telefono_', 'Teléfono del cliente', 'telefono', 'clientes', 'software_llamadas',
  'string', 1, 'e164', 'Teléfono E.164 del cliente.', '+34600000000', 'llamadas-ancla-cliente-telefono-v1',
  '[]', '[]', '', 1, datetime('now'), datetime('now')
),
(
  'llamada.cliente_id', '_llamada.cliente_id_', 'Cliente de la llamada', 'cliente_id', 'llamadas', 'software_llamadas',
  'string', 1, '', 'Referencia a clientes._id.', 'cli_…', 'llamadas-ancla-cliente-id-v1',
  '[]', '[]', '', 0, datetime('now'), datetime('now')
),
(
  'llamada.fecha', '_llamada.fecha_', 'Fecha de la llamada', 'fecha', 'llamadas', 'software_llamadas',
  'date', 1, 'iso8601', 'Momento de la llamada.', '2026-10-22T12:00:00.000Z', 'llamadas-ancla-fecha-v1',
  '[]', '[]', '', 0, datetime('now'), datetime('now')
),
(
  'llamada.resultado', '_llamada.resultado_', 'Resultado de la llamada', 'resultado', 'llamadas', 'software_llamadas',
  'string', 1, 'enum:contesto|no_contesto|cita', 'Resultado: contesto | no_contesto | cita.', 'cita',
  'llamadas-ancla-resultado-v1', '[]', '[]', '', 0, datetime('now'), datetime('now')
);

UPDATE campos_mongo SET ancla = '_cliente.nombre_', updated_at = datetime('now')
WHERE id = 'clientes-nombre';
UPDATE campos_mongo SET ancla = '_cliente.telefono_', updated_at = datetime('now')
WHERE id = 'clientes-telefono';
UPDATE campos_mongo SET ancla = '_llamada.cliente_id_', updated_at = datetime('now')
WHERE id = 'llamadas-cliente_id';
UPDATE campos_mongo SET ancla = '_llamada.fecha_', updated_at = datetime('now')
WHERE id = 'llamadas-fecha';
UPDATE campos_mongo SET ancla = '_llamada.resultado_', updated_at = datetime('now')
WHERE id = 'llamadas-resultado';

INSERT OR IGNORE INTO proyecto_skills (proyecto_id, skill_id) VALUES
  ('reservas', 'descubrir-negocio'),
  ('reservas', 'mapear-recorrido'),
  ('reservas', 'generar-script'),
  ('reservas', 'diagnosticar-alerta');

INSERT OR IGNORE INTO anclas (
  id, ancla, etiqueta, clave_mongo, coleccion, base_datos, tipo, obligatorio, formato,
  descripcion, ejemplo, hash, aliases, observaciones, valor_actual, sensible, created_at, updated_at
) VALUES
(
  'ejecucion.respuesta.motivo', '_ejecucion.respuesta.motivo_', 'Motivo de la respuesta', 'respuesta.motivo',
  'ejecuciones', 'software_reservas', 'string', 0, '', 'Motivo del fallo o resultado.', 'selector_roto',
  'skill-io-ejecucion-motivo-v1', '[]', '[]', '', 0, datetime('now'), datetime('now')
),
(
  'ejecucion.traza', '_ejecucion.traza_', 'Traza de la ejecución', 'traza',
  'ejecuciones', 'software_reservas', 'array', 0, 'proyeccion-array', 'Líneas de traza (array). Sin N literal.',
  '[{mensaje}]', 'skill-io-ejecucion-traza-v1', '[]', '[]', '', 0, datetime('now'), datetime('now')
),
(
  'corrida.errores', '_corrida.errores_', 'Errores de la corrida', 'errores',
  'ejecuciones', 'software_reservas', 'array', 0, 'proyeccion-array', 'Problemas detectados (array). Sin N literal.',
  '["selector no encontrado"]', 'skill-io-corrida-errores-v1', '[]', '[]', '', 0, datetime('now'), datetime('now')
),
(
  'version.funcion.parametros', '_version.funcion.parametros_', 'Parámetros de la función', 'funcion.parametros',
  'versiones', 'software_reservas', 'object', 0, 'json-schema', 'JSON Schema de parámetros.',
  '{"type":"object"}', 'skill-io-funcion-parametros-v1', '[]', '[]', '', 0, datetime('now'), datetime('now')
);
