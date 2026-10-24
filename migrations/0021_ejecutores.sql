-- Catálogo de ejecutores (quién ejecuta una skill) + vínculo opcional en skills.
-- Sin ejecutor en la skill → implícito `agente_externo` (polling /siguiente).

CREATE TABLE ejecutores (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  timeout_s INTEGER NOT NULL DEFAULT 60,
  reintentos INTEGER NOT NULL DEFAULT 2,
  espera_reintento_s INTEGER NOT NULL DEFAULT 10,
  activo INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  color TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_ejecutores_tipo ON ejecutores(tipo);
CREATE INDEX idx_ejecutores_activo ON ejecutores(activo);

ALTER TABLE skills ADD COLUMN ejecutor_id TEXT REFERENCES ejecutores(id) ON DELETE SET NULL;
CREATE INDEX idx_skills_ejecutor ON skills(ejecutor_id);
