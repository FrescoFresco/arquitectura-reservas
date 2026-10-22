-- Skills I/O: entradas (lee) / salidas (escribe). `anclas` en API = unión.
-- Reemplaza skill_anclas (skill_id, ancla) por (skill_id, ancla, direccion).

CREATE TABLE skill_anclas_io (
  skill_id TEXT NOT NULL,
  ancla TEXT NOT NULL,
  direccion TEXT NOT NULL CHECK (direccion IN ('entrada', 'salida')),
  PRIMARY KEY (skill_id, ancla, direccion),
  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
);

-- Migación por skill (reglas de producto). Lo no clasificado → salida (legado = lo que la skill produce).

-- descubrir-negocio: lee URL semilla; escribe identidad / punto A (url también como salida confirmada)
INSERT OR IGNORE INTO skill_anclas_io (skill_id, ancla, direccion)
SELECT skill_id, ancla, 'entrada' FROM skill_anclas
WHERE skill_id = 'descubrir-negocio' AND ancla = '_negocio.url_';

INSERT OR IGNORE INTO skill_anclas_io (skill_id, ancla, direccion)
SELECT skill_id, ancla, 'salida' FROM skill_anclas
WHERE skill_id = 'descubrir-negocio';

-- mapear-recorrido: lee url / url_inicio; escribe recorrido.*
INSERT OR IGNORE INTO skill_anclas_io (skill_id, ancla, direccion)
SELECT skill_id, ancla, 'entrada' FROM skill_anclas
WHERE skill_id = 'mapear-recorrido'
  AND ancla IN ('_negocio.url_', '_proceso.url_inicio_', '_negocio.nombre_', '_negocio.zona_horaria_');

INSERT OR IGNORE INTO skill_anclas_io (skill_id, ancla, direccion)
SELECT skill_id, ancla, 'salida' FROM skill_anclas
WHERE skill_id = 'mapear-recorrido'
  AND ancla NOT IN ('_negocio.url_', '_proceso.url_inicio_', '_negocio.nombre_', '_negocio.zona_horaria_');

-- generar-script: lee recorrido / url_inicio; escribe script + función
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

-- diagnosticar-alerta: lee ejecución + url; escribe errores / llega_a_b
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

-- Resto de skills: todo como salida (compat)
INSERT OR IGNORE INTO skill_anclas_io (skill_id, ancla, direccion)
SELECT sa.skill_id, sa.ancla, 'salida'
FROM skill_anclas sa
WHERE NOT EXISTS (
  SELECT 1 FROM skill_anclas_io io
  WHERE io.skill_id = sa.skill_id AND io.ancla = sa.ancla
);

DROP TABLE skill_anclas;
ALTER TABLE skill_anclas_io RENAME TO skill_anclas;
CREATE INDEX IF NOT EXISTS idx_skill_anclas_ancla ON skill_anclas(ancla);
CREATE INDEX IF NOT EXISTS idx_skill_anclas_dir ON skill_anclas(skill_id, direccion);

-- Quitar literales N de anclas de proyección: canónico = array sin .N.
UPDATE ancla_skills SET ancla_id = 'version.recorrido.campos'
WHERE ancla_id = 'version.recorrido.campos.N';
UPDATE ancla_valores_negocio SET ancla_id = 'version.recorrido.campos'
WHERE ancla_id = 'version.recorrido.campos.N';
UPDATE anclas
SET id = 'version.recorrido.campos',
    ancla = '_version.recorrido.campos_',
    etiqueta = 'Campos del recorrido (array)',
    clave_mongo = 'recorrido.campos',
    formato = 'proyeccion-array',
    descripcion = 'Lista canónica de campos del formulario (array BSON). Elementos: nombre, selector, clase. Sin N literal en la ancla.',
    hash = 'skill-io-recorrido-campos-array',
    updated_at = datetime('now')
WHERE id = 'version.recorrido.campos.N' OR ancla = '_version.recorrido.campos.N_';

-- Plantillas hijas con N dejan de ser anclas de catálogo (viven en proyeccionElemento del campo Mongo).
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

-- skill_anclas: sustituir anclas N.* / .N_ por el array canónico
UPDATE skill_anclas
SET ancla = '_version.recorrido.campos_'
WHERE ancla IN (
  '_version.recorrido.campos.N_',
  '_version.recorrido.campos.N.nombre_',
  '_version.recorrido.campos.N.selector_',
  '_version.recorrido.campos.N.clase_'
);

-- Dedup tras el UPDATE (mismo skill+ancla+direccion)
DELETE FROM skill_anclas
WHERE rowid NOT IN (
  SELECT MIN(rowid) FROM skill_anclas GROUP BY skill_id, ancla, direccion
);

UPDATE campos_mongo
SET ancla = '_version.recorrido.campos_',
    proyeccion_elemento = '{"nombre":"nombre","selector":"selector","clase":"clase"}',
    descripcion = 'Lista canónica de campos del formulario en la versión del recorrido (array). Elementos {nombre, selector, clase}. clase ∈ normal|texto_libre|identificador|sensible|consentimiento.',
    hash = 'skill-io-versiones-recorrido-campos',
    updated_at = datetime('now')
WHERE id = 'versiones-recorrido-campos';

-- También limpiar traza/errores con N literal si existen como anclas huérfanas en skills
UPDATE skill_anclas SET ancla = '_ejecucion.traza_'
WHERE ancla = '_ejecucion.traza.N.mensaje_';
UPDATE skill_anclas SET ancla = '_corrida.errores_'
WHERE ancla = '_corrida.errores.N_';

-- Enum llamadas.resultado (idempotente)
UPDATE campos_mongo
SET enum_json = '["contesto","no_contesto","cita"]',
    descripcion = 'Resultado: contesto | no_contesto | cita.',
    updated_at = datetime('now')
WHERE id = 'llamadas-resultado' OR (coleccion = 'llamadas' AND clave = 'resultado');

-- Campos ancla para los 5 campos de software_llamadas (clientes + llamadas)
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

-- Asegurar las 4 skills en BD reservas
INSERT OR IGNORE INTO proyecto_skills (proyecto_id, skill_id) VALUES
  ('reservas', 'descubrir-negocio'),
  ('reservas', 'mapear-recorrido'),
  ('reservas', 'generar-script'),
  ('reservas', 'diagnosticar-alerta');

-- Anclas auxiliares sin N (traza/errores/motivo/parametros)
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
