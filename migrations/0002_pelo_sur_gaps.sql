-- Pelo Sur gaps: aliases, observaciones, sensible, proyección Mongo N→array.

ALTER TABLE anclas ADD COLUMN aliases TEXT NOT NULL DEFAULT '[]';
ALTER TABLE anclas ADD COLUMN observaciones TEXT NOT NULL DEFAULT '[]';
ALTER TABLE anclas ADD COLUMN valor_actual TEXT NOT NULL DEFAULT '';
ALTER TABLE anclas ADD COLUMN sensible INTEGER NOT NULL DEFAULT 0;

ALTER TABLE campos_mongo ADD COLUMN proyeccion_mongo TEXT NOT NULL DEFAULT '';
ALTER TABLE campos_mongo ADD COLUMN proyeccion_elemento TEXT NOT NULL DEFAULT '';
