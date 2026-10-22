-- Alinear base_datos de anclas con los proyectos Mongo reales.
-- Legado: arquitectura_reservas → software_reservas (esquema reservas).
-- No inventar nombres nuevos; software_llamadas no aplica a anclas actuales.

UPDATE anclas
SET base_datos = 'software_reservas',
    updated_at = datetime('now')
WHERE base_datos = 'arquitectura_reservas'
   OR base_datos IS NULL
   OR trim(base_datos) = '';
