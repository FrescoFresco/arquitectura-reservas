-- Cluster Mongo como entidad de primer nivel.
-- Modelo: Cluster → Bases de datos (proyectos) → Colecciones → Campos.
-- La URI Atlas vive en el cluster (mongo_config_cluster), no por Base de datos.

CREATE TABLE clusters (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  descripcion TEXT NOT NULL DEFAULT '',
  hash TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE mongo_config_cluster (
  cluster_id TEXT PRIMARY KEY,
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  uri_hint TEXT NOT NULL DEFAULT '',
  db_name TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  FOREIGN KEY (cluster_id) REFERENCES clusters(id) ON DELETE CASCADE
);

CREATE INDEX idx_mongo_config_cluster_updated ON mongo_config_cluster(updated_at);

ALTER TABLE proyectos ADD COLUMN cluster_id TEXT NOT NULL DEFAULT '';

-- Cluster por defecto + adjuntar esquemas existentes.
INSERT INTO clusters (id, nombre, descripcion, hash, created_at, updated_at)
VALUES (
  'atlas-principal',
  'Cluster Atlas',
  'Cluster por defecto (migración desde URI por Base de datos).',
  '',
  datetime('now'),
  datetime('now')
);

UPDATE proyectos SET cluster_id = 'atlas-principal' WHERE cluster_id = '' OR cluster_id IS NULL;

-- Sube la URI más reciente de mongo_config_proyecto al cluster (si había alguna).
INSERT INTO mongo_config_cluster (cluster_id, ciphertext, iv, uri_hint, db_name, updated_at)
SELECT 'atlas-principal', ciphertext, iv, uri_hint, '', updated_at
FROM mongo_config_proyecto
ORDER BY updated_at DESC
LIMIT 1;

-- Las URIs por esquema dejan de usarse en resolución de producto.
DELETE FROM mongo_config_proyecto;
