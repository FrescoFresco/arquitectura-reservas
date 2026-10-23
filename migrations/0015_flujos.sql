-- Flujos de ejecución (nodos + aristas versionados) ligados a un proyecto/BD.
-- Las corridas viven en Mongo colección `corridas` de la BD del proyecto.

CREATE TABLE flujos (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  descripcion TEXT NOT NULL DEFAULT '',
  proyecto_id TEXT NOT NULL,
  hash TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (proyecto_id) REFERENCES proyectos(id) ON DELETE CASCADE
);

CREATE TABLE flujo_versions (
  flujo_id TEXT NOT NULL,
  numero INTEGER NOT NULL,
  fecha TEXT NOT NULL,
  nodos_json TEXT NOT NULL DEFAULT '[]',
  aristas_json TEXT NOT NULL DEFAULT '[]',
  hash TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (flujo_id, numero),
  FOREIGN KEY (flujo_id) REFERENCES flujos(id) ON DELETE CASCADE
);

CREATE INDEX idx_flujos_proyecto ON flujos(proyecto_id);

-- Índice liviano para localizar corridas (documento completo en Mongo `corridas`).
CREATE TABLE corridas_index (
  id TEXT PRIMARY KEY,
  proyecto_id TEXT NOT NULL,
  flujo_id TEXT NOT NULL,
  negocio TEXT NOT NULL,
  estado TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_corridas_flujo ON corridas_index(flujo_id);
CREATE INDEX idx_corridas_negocio ON corridas_index(negocio);
CREATE INDEX idx_corridas_estado ON corridas_index(estado);

-- Semilla: descubrir → mapear (proyecto reservas)
INSERT OR IGNORE INTO flujos (id, nombre, descripcion, proyecto_id, hash, created_at, updated_at)
VALUES (
  'reservas-descubrir-mapear',
  'Descubrir → Mapear',
  'Flujo mínimo de reservas: inicio → descubrir-negocio → mapear-recorrido → fin. Para el bucle n8n (corridas).',
  'reservas',
  'flujo-reservas-descubrir-mapear-v1',
  '2026-10-23T00:00:00.000Z',
  '2026-10-23T00:00:00.000Z'
);

INSERT OR IGNORE INTO flujo_versions (flujo_id, numero, fecha, nodos_json, aristas_json, hash)
VALUES (
  'reservas-descubrir-mapear',
  1,
  '2026-10-23',
  '[
    {"id":"inicio","tipo":"inicio"},
    {"id":"descubrir","tipo":"skill","skill":"descubrir-negocio"},
    {"id":"mapear","tipo":"skill","skill":"mapear-recorrido"},
    {"id":"fin","tipo":"fin"}
  ]',
  '[
    {"desde":"inicio","hacia":"descubrir"},
    {"desde":"descubrir","hacia":"mapear"},
    {"desde":"mapear","hacia":"fin"}
  ]',
  'flujo-reservas-descubrir-mapear-v1'
);
