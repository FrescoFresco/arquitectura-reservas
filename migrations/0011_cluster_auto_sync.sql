-- Opt-in: sincronizar DDL hub→Atlas al guardar esquema (por Cluster).
-- last_sync_* guarda el último empujón (manual o auto) sin secretos ni URI.

ALTER TABLE clusters ADD COLUMN auto_sync INTEGER NOT NULL DEFAULT 0;
ALTER TABLE clusters ADD COLUMN last_sync_at TEXT NOT NULL DEFAULT '';
ALTER TABLE clusters ADD COLUMN last_sync_ok INTEGER;
ALTER TABLE clusters ADD COLUMN last_sync_proyecto TEXT NOT NULL DEFAULT '';
ALTER TABLE clusters ADD COLUMN last_sync_summary TEXT NOT NULL DEFAULT '';
