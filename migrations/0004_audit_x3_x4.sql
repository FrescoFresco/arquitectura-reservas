-- X3/X4: índices recomendados por campo Mongo (p. ej. reservas_prueba.cuando / estado).

ALTER TABLE campos_mongo ADD COLUMN indices TEXT NOT NULL DEFAULT '[]';
