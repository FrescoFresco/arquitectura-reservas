-- Color de acento (#RRGGBB) por entidad de catálogo.
-- Solo tinte del tile del icono en UI; null = default azul (#1c63d5 / #edf3ff).
-- Colecciones: color vive en cada ítem de proyectos.colecciones JSON (sin columna).

ALTER TABLE skills ADD COLUMN color TEXT;
ALTER TABLE anclas ADD COLUMN color TEXT;
ALTER TABLE campos_mongo ADD COLUMN color TEXT;
ALTER TABLE proyectos ADD COLUMN color TEXT;
ALTER TABLE clusters ADD COLUMN color TEXT;
ALTER TABLE system_prompts ADD COLUMN color TEXT;
ALTER TABLE fundamentos ADD COLUMN color TEXT;
ALTER TABLE agentes ADD COLUMN color TEXT;
ALTER TABLE flujos ADD COLUMN color TEXT;
