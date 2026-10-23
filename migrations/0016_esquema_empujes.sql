-- Historial de empujes de esquema (manual Empujar + auto-sync) por Base de datos.
-- detalle_json = resultado o error crudo (sin URI ni secretos).

CREATE TABLE esquema_empujes (
  id TEXT PRIMARY KEY,
  proyecto_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  modo TEXT NOT NULL,
  ok INTEGER NOT NULL,
  resumen TEXT NOT NULL DEFAULT '',
  detalle_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (proyecto_id) REFERENCES proyectos(id) ON DELETE CASCADE
);

CREATE INDEX idx_esquema_empujes_proy_ts ON esquema_empujes(proyecto_id, ts DESC, id DESC);
CREATE INDEX idx_esquema_empujes_proy_ok ON esquema_empujes(proyecto_id, ok);
