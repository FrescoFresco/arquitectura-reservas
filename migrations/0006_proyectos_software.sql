-- Proyectos = softwares (base Mongo propia). Negocios dejan de ser proyectos.
-- baseDatos elegida: software_reservas (no hay URI Atlas viva con datos en
-- arquitectura_reservas; los campos de catálogo migran al nombre nuevo).

ALTER TABLE proyectos ADD COLUMN base_datos TEXT NOT NULL DEFAULT '';
ALTER TABLE proyectos ADD COLUMN colecciones TEXT NOT NULL DEFAULT '[]';
ALTER TABLE proyectos ADD COLUMN relaciones TEXT NOT NULL DEFAULT '[]';
ALTER TABLE proyectos ADD COLUMN agentes_json TEXT NOT NULL DEFAULT '[]';
-- 1 = negocio legado (pelo-sur / la-mesa-norte): no borrar hasta confirmación humana.
ALTER TABLE proyectos ADD COLUMN legacy_negocio INTEGER NOT NULL DEFAULT 0;

ALTER TABLE campos_mongo ADD COLUMN proyecto TEXT NOT NULL DEFAULT '';
ALTER TABLE campos_mongo ADD COLUMN hijos TEXT NOT NULL DEFAULT '[]';

ALTER TABLE agentes ADD COLUMN proyectos TEXT NOT NULL DEFAULT '[]';
ALTER TABLE agentes ADD COLUMN lee TEXT NOT NULL DEFAULT '[]';
ALTER TABLE agentes ADD COLUMN escribe TEXT NOT NULL DEFAULT '[]';

CREATE INDEX IF NOT EXISTS idx_campos_mongo_proyecto ON campos_mongo(proyecto);

-- Soft-mark negocios que aún viven como filas de proyecto.
UPDATE proyectos SET legacy_negocio = 1 WHERE id IN ('pelo-sur', 'la-mesa-norte');

-- Teléfono de prueba NO debe ser el valorActual real de Pelo Sur.
UPDATE ancla_valores_negocio
SET valor_actual = '+34699111222', updated_at = datetime('now')
WHERE negocio_id = 'pelo-sur'
  AND ancla_id IN ('negocio.telefono', 'negocio-telefono')
  AND valor_actual = '+34600111222';
