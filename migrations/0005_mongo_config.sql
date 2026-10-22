-- URI Mongo cifrada en D1 (AES-GCM). La URI en claro nunca se reexpone por API.
-- Clave: secret ENCRYPTION_KEY del Worker. Fallback de runtime: env MONGODB_URI.

CREATE TABLE mongo_config (
  id TEXT PRIMARY KEY CHECK (id = 'default'),
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  uri_hint TEXT NOT NULL DEFAULT '',
  db_name TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
