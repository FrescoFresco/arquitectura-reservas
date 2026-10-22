-- N1–N5: valores por negocio (fuera de la ficha ancla), sin PII de cliente en catálogo.

CREATE TABLE ancla_valores_negocio (
  negocio_id TEXT NOT NULL,
  ancla_id TEXT NOT NULL,
  observaciones TEXT NOT NULL DEFAULT '[]',
  valor_actual TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (negocio_id, ancla_id),
  FOREIGN KEY (ancla_id) REFERENCES anclas(id) ON DELETE CASCADE
);

CREATE INDEX idx_ancla_valores_negocio ON ancla_valores_negocio(negocio_id);
CREATE INDEX idx_ancla_valores_ancla ON ancla_valores_negocio(ancla_id);
