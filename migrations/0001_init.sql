-- Catálogo vivo (D1). Los índices JSON de catalogo/ siguen como semilla / espejo estático.

CREATE TABLE skills (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  descripcion TEXT NOT NULL DEFAULT '',
  hash TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE skill_versions (
  skill_id TEXT NOT NULL,
  numero INTEGER NOT NULL,
  fecha TEXT NOT NULL,
  markdown TEXT NOT NULL DEFAULT '',
  ruta TEXT NOT NULL DEFAULT '',
  nombre_archivo TEXT NOT NULL DEFAULT '',
  hash TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (skill_id, numero),
  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
);

CREATE TABLE skill_anclas (
  skill_id TEXT NOT NULL,
  ancla TEXT NOT NULL,
  PRIMARY KEY (skill_id, ancla),
  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
);

CREATE TABLE anclas (
  id TEXT PRIMARY KEY,
  ancla TEXT NOT NULL UNIQUE,
  etiqueta TEXT NOT NULL DEFAULT '',
  clave_mongo TEXT NOT NULL DEFAULT '',
  coleccion TEXT NOT NULL DEFAULT '',
  base_datos TEXT NOT NULL DEFAULT 'arquitectura_reservas',
  tipo TEXT NOT NULL DEFAULT 'string',
  obligatorio INTEGER NOT NULL DEFAULT 0,
  formato TEXT NOT NULL DEFAULT '',
  descripcion TEXT NOT NULL DEFAULT '',
  ejemplo TEXT NOT NULL DEFAULT '',
  hash TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE ancla_skills (
  ancla_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  PRIMARY KEY (ancla_id, skill_id),
  FOREIGN KEY (ancla_id) REFERENCES anclas(id) ON DELETE CASCADE,
  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
);

CREATE TABLE campos_mongo (
  id TEXT PRIMARY KEY,
  campo TEXT NOT NULL,
  base_datos TEXT NOT NULL DEFAULT 'arquitectura_reservas',
  coleccion TEXT NOT NULL DEFAULT '',
  clave TEXT NOT NULL DEFAULT '',
  bson_type TEXT NOT NULL DEFAULT 'string',
  obligatorio INTEGER NOT NULL DEFAULT 0,
  descripcion TEXT NOT NULL DEFAULT '',
  ancla TEXT NOT NULL DEFAULT '',
  hash TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE proyectos (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  descripcion TEXT NOT NULL DEFAULT '',
  hash TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE proyecto_versions (
  proyecto_id TEXT NOT NULL,
  numero INTEGER NOT NULL,
  fecha TEXT NOT NULL,
  markdown TEXT NOT NULL DEFAULT '',
  ruta TEXT NOT NULL DEFAULT '',
  nombre_archivo TEXT NOT NULL DEFAULT '',
  hash TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (proyecto_id, numero),
  FOREIGN KEY (proyecto_id) REFERENCES proyectos(id) ON DELETE CASCADE
);

CREATE TABLE proyecto_skills (
  proyecto_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  PRIMARY KEY (proyecto_id, skill_id),
  FOREIGN KEY (proyecto_id) REFERENCES proyectos(id) ON DELETE CASCADE,
  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
);

CREATE TABLE agentes (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  foto TEXT NOT NULL DEFAULT '',
  descripcion TEXT NOT NULL DEFAULT '',
  invite_usada TEXT NOT NULL DEFAULT '',
  last_seen TEXT NOT NULL DEFAULT '',
  hash TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE invites (
  clave TEXT PRIMARY KEY,
  creada TEXT NOT NULL,
  usada_por TEXT,
  revocada INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE fundamentos (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  descripcion TEXT NOT NULL DEFAULT '',
  hash TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE fundamento_versions (
  fundamento_id TEXT NOT NULL,
  numero INTEGER NOT NULL,
  fecha TEXT NOT NULL,
  markdown TEXT NOT NULL DEFAULT '',
  ruta TEXT NOT NULL DEFAULT '',
  nombre_archivo TEXT NOT NULL DEFAULT '',
  hash TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (fundamento_id, numero),
  FOREIGN KEY (fundamento_id) REFERENCES fundamentos(id) ON DELETE CASCADE
);

CREATE INDEX idx_agentes_invite ON agentes(invite_usada);
CREATE INDEX idx_campos_mongo_ancla ON campos_mongo(ancla);
CREATE INDEX idx_skill_anclas_ancla ON skill_anclas(ancla);
