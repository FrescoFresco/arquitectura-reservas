-- Skill canónica transformar-datos + ejecutor herramienta (coste 0).
-- Reutiliza ancla _consulta.pipeline_ (entrada).

INSERT OR IGNORE INTO ejecutores (
  id, nombre, tipo, config_json, timeout_s, reintentos, espera_reintento_s, activo, version, color, created_at, updated_at
) VALUES (
  'herramienta-transformar-datos',
  'Transformar datos',
  'herramienta',
  '{"funcion":"transformar-datos"}',
  30,
  0,
  10,
  1,
  1,
  NULL,
  datetime('now'),
  datetime('now')
);

INSERT OR IGNORE INTO skills (id, nombre, descripcion, hash, color, ejecutor_id, created_at, updated_at)
VALUES (
  'transformar-datos',
  'Transformar datos',
  'Aplica $addFields/$project en memoria sobre datos+entradas (sin IA, coste 0).',
  '',
  NULL,
  'herramienta-transformar-datos',
  datetime('now'),
  datetime('now')
);

UPDATE skills SET ejecutor_id = 'herramienta-transformar-datos', updated_at = datetime('now')
WHERE id = 'transformar-datos';

INSERT OR IGNORE INTO skill_anclas (skill_id, ancla, direccion)
SELECT 'transformar-datos', ancla, 'entrada'
FROM anclas WHERE ancla = '_consulta.pipeline_'
LIMIT 1;

-- Si el ancla aún no existe en catálogo, insertar token directo (FK puede fallar: soft).
-- skill_anclas exige ancla en tabla anclas; crear si falta.
INSERT OR IGNORE INTO anclas (
  id, ancla, etiqueta, clave_mongo, coleccion, base_datos, tipo, obligatorio, formato, descripcion, ejemplo, hash, aliases, observaciones, valor_actual, sensible, color, created_at, updated_at
)
SELECT
  '_consulta.pipeline_',
  '_consulta.pipeline_',
  'Pipeline de consulta',
  'pipeline',
  'consultas',
  'software_reservas',
  'json',
  0,
  '',
  'Aggregation pipeline ($addFields/$project para transformar-datos; allowlist completa para consultar-datos)',
  '[{"$addFields":{"_x_":1}}]',
  '',
  '[]',
  '[]',
  '',
  0,
  NULL,
  datetime('now'),
  datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM anclas WHERE ancla = '_consulta.pipeline_');

INSERT OR IGNORE INTO skill_anclas (skill_id, ancla, direccion)
VALUES ('transformar-datos', '_consulta.pipeline_', 'entrada');
