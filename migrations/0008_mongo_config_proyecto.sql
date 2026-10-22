-- URI Mongo cifrada por Base de datos (proyecto/esquema). Misma cifrado AES-GCM que mongo_config.
-- La URI en claro nunca se reexpone por API. Clave: secret ENCRYPTION_KEY del Worker.
-- Prioridad runtime: fila de este proyecto → mongo_config global → env MONGODB_URI.

CREATE TABLE mongo_config_proyecto (
  proyecto_id TEXT PRIMARY KEY,
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  uri_hint TEXT NOT NULL DEFAULT '',
  db_name TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  FOREIGN KEY (proyecto_id) REFERENCES proyectos(id) ON DELETE CASCADE
);

CREATE INDEX idx_mongo_config_proyecto_updated ON mongo_config_proyecto(updated_at);
