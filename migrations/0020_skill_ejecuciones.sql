-- Registro de ejecuciones de skills del hub (p. ej. generar-definicion / Redactor).
-- No sustituye la colección Mongo `ejecuciones` de reservas.
CREATE TABLE IF NOT EXISTS skill_ejecuciones (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL,
  origen TEXT NOT NULL DEFAULT 'api',
  modo TEXT NOT NULL DEFAULT 'mock',
  ok INTEGER NOT NULL DEFAULT 1,
  entrada_json TEXT NOT NULL DEFAULT '{}',
  salida_json TEXT NOT NULL DEFAULT '{}',
  creado TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_skill_ejecuciones_skill ON skill_ejecuciones (skill_id, creado);
CREATE INDEX IF NOT EXISTS idx_skill_ejecuciones_creado ON skill_ejecuciones (creado);
