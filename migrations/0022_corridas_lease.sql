-- Lease de paso para el motor (cola `pasos`): evita doble ejecución.
-- lease_hasta ISO; NULL o pasado = libre.

ALTER TABLE corridas_index ADD COLUMN lease_hasta TEXT;
ALTER TABLE corridas_index ADD COLUMN lease_nodo_id TEXT;

CREATE INDEX idx_corridas_lease ON corridas_index(lease_hasta);
