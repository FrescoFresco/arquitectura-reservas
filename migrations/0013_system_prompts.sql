-- Catálogo System prompts (MD versionado) + N:M con skills.

CREATE TABLE system_prompts (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  descripcion TEXT NOT NULL DEFAULT '',
  hash TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE system_prompt_versions (
  system_prompt_id TEXT NOT NULL,
  numero INTEGER NOT NULL,
  fecha TEXT NOT NULL,
  markdown TEXT NOT NULL DEFAULT '',
  ruta TEXT NOT NULL DEFAULT '',
  nombre_archivo TEXT NOT NULL DEFAULT '',
  hash TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (system_prompt_id, numero),
  FOREIGN KEY (system_prompt_id) REFERENCES system_prompts(id) ON DELETE CASCADE
);

CREATE TABLE system_prompt_skills (
  system_prompt_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  PRIMARY KEY (system_prompt_id, skill_id),
  FOREIGN KEY (system_prompt_id) REFERENCES system_prompts(id) ON DELETE CASCADE,
  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
);

CREATE INDEX idx_system_prompt_skills_skill ON system_prompt_skills(skill_id);
