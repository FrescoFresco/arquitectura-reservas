-- Máximo 1 system prompt por skill: limpia duplicados y UNIQUE en skill_id.
-- Si una skill tenía varios prompts, se conserva el primero por nombre del prompt.

DELETE FROM system_prompt_skills
WHERE rowid IN (
  SELECT sps.rowid
  FROM system_prompt_skills sps
  JOIN system_prompts sp ON sp.id = sps.system_prompt_id
  WHERE EXISTS (
    SELECT 1
    FROM system_prompt_skills sps2
    JOIN system_prompts sp2 ON sp2.id = sps2.system_prompt_id
    WHERE sps2.skill_id = sps.skill_id
      AND (
        sp2.nombre < sp.nombre
        OR (sp2.nombre = sp.nombre AND sps2.system_prompt_id < sps.system_prompt_id)
      )
  )
);

DROP INDEX IF EXISTS idx_system_prompt_skills_skill;

CREATE UNIQUE INDEX idx_system_prompt_skills_skill_unique
  ON system_prompt_skills(skill_id);
