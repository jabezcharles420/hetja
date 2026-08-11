-- 0005_territory_primary.sql
-- One primary territory per geofence (RESEARCH-1 §R1 territory ownership):
-- a unique partial index means exactly one feeder can hold is_primary on a
-- given geofence; secondary/sponsor roles are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS feeder_territories_primary_uix
  ON feeder_territories (geofence_id) WHERE is_primary;
