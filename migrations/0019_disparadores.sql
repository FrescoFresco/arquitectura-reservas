-- Disparadores de flujos (diseño en D1). El motor de disparo (eventos/cron/webhook) es fase 2.
-- CASCADE al borrar el flujo. No toca corridas ni flujo_versions.

CREATE TABLE disparadores (
  id TEXT PRIMARY KEY,
  flujo_id TEXT NOT NULL,
  tipo TEXT NOT NULL,
  activo INTEGER NOT NULL DEFAULT 1,
  cron TEXT,
  coleccion TEXT,
  operaciones_json TEXT,
  token TEXT,
  pipeline_json TEXT,
  anti_bucle INTEGER NOT NULL DEFAULT 1,
  agrupar_segundos INTEGER NOT NULL DEFAULT 0,
  negocio TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  creado TEXT NOT NULL,
  actualizado TEXT NOT NULL,
  ultima_vez TEXT,
  FOREIGN KEY (flujo_id) REFERENCES flujos(id) ON DELETE CASCADE
);

CREATE INDEX idx_disparadores_flujo ON disparadores(flujo_id);
CREATE INDEX idx_disparadores_tipo_activo ON disparadores(tipo, activo);
CREATE INDEX idx_disparadores_coleccion ON disparadores(coleccion);
