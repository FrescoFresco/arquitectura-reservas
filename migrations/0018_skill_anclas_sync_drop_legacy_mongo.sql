-- Cleanup: drop unused global/per-proyecto mongo URI tables (0 product rows).
-- Rebuild ancla_skills from skill_anclas so both junction tables agree.
-- Restore FK skill_anclas → skills (lost in 0012 rename).

DROP TABLE IF EXISTS mongo_config;
DROP TABLE IF EXISTS mongo_config_proyecto;

-- Canonical projection: every skill_anclas token that resolves to an ancla id.
DELETE FROM ancla_skills;

INSERT OR IGNORE INTO ancla_skills (ancla_id, skill_id)
SELECT a.id, sa.skill_id
FROM skill_anclas sa
JOIN anclas a ON (
  a.ancla = sa.ancla
  OR a.id = sa.ancla
  OR a.id = trim(sa.ancla, '_')
  OR a.ancla = '_' || trim(sa.ancla, '_') || '_'
)
WHERE EXISTS (SELECT 1 FROM skills s WHERE s.id = sa.skill_id);

-- Recreate skill_anclas with FK ON DELETE CASCADE.
CREATE TABLE skill_anclas_fk (
  skill_id TEXT NOT NULL,
  ancla TEXT NOT NULL,
  direccion TEXT NOT NULL CHECK (direccion IN ('entrada', 'salida')),
  PRIMARY KEY (skill_id, ancla, direccion),
  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO skill_anclas_fk (skill_id, ancla, direccion)
SELECT sa.skill_id, sa.ancla, sa.direccion
FROM skill_anclas sa
WHERE EXISTS (SELECT 1 FROM skills s WHERE s.id = sa.skill_id);

DROP TABLE skill_anclas;
ALTER TABLE skill_anclas_fk RENAME TO skill_anclas;
CREATE INDEX IF NOT EXISTS idx_skill_anclas_ancla ON skill_anclas(ancla);
CREATE INDEX IF NOT EXISTS idx_skill_anclas_dir ON skill_anclas(skill_id, direccion);
