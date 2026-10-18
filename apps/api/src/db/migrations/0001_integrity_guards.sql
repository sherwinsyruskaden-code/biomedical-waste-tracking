-- Integrity guards that the ORM schema cannot express.

-- 1. Append-only history: custody events and audit logs can never be edited or deleted
--    (deletion is still possible through ON DELETE CASCADE of the whole organization).
CREATE OR REPLACE FUNCTION bwts_prevent_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- allow FK "SET NULL" maintenance (e.g. a user being deleted) but nothing else
    IF (to_jsonb(NEW) - ARRAY['actor_user_id','from_custodian_user_id','to_custodian_user_id','container_id','facility_id','assignment_id','from_custodian_facility_id','to_custodian_facility_id'])
       = (to_jsonb(OLD) - ARRAY['actor_user_id','from_custodian_user_id','to_custodian_user_id','container_id','facility_id','assignment_id','from_custodian_facility_id','to_custodian_facility_id']) THEN
      RETURN NEW;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD; -- cascaded delete of the parent organization / batch
  END IF;
  RAISE EXCEPTION '% is append-only (% blocked)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER custody_events_append_only BEFORE UPDATE OR DELETE ON custody_events
  FOR EACH ROW EXECUTE FUNCTION bwts_prevent_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION bwts_prevent_mutation();
--> statement-breakpoint

-- 2. Value checks
ALTER TABLE waste_batches ADD CONSTRAINT waste_batches_quantity_positive CHECK (quantity > 0);
--> statement-breakpoint
ALTER TABLE waste_batches ADD CONSTRAINT waste_batches_container_count_range CHECK (container_count BETWEEN 1 AND 200);
--> statement-breakpoint
ALTER TABLE waste_batches ADD CONSTRAINT waste_batches_origin_ne_destination CHECK (destination_facility_id IS NULL OR destination_facility_id <> origin_facility_id);
--> statement-breakpoint
ALTER TABLE assignments ADD CONSTRAINT assignments_origin_ne_destination CHECK (destination_facility_id <> origin_facility_id);
--> statement-breakpoint
ALTER TABLE assignments ADD CONSTRAINT assignments_due_after_pickup CHECK (due_by > scheduled_pickup_at);
--> statement-breakpoint
ALTER TABLE location_points ADD CONSTRAINT location_points_lat_range CHECK (latitude BETWEEN -90 AND 90);
--> statement-breakpoint
ALTER TABLE location_points ADD CONSTRAINT location_points_lng_range CHECK (longitude BETWEEN -180 AND 180);
--> statement-breakpoint
ALTER TABLE location_points ADD CONSTRAINT location_points_accuracy_nonneg CHECK (accuracy_m IS NULL OR accuracy_m >= 0);
--> statement-breakpoint
ALTER TABLE facilities ADD CONSTRAINT facilities_coords_pair CHECK ((latitude IS NULL) = (longitude IS NULL));
--> statement-breakpoint
ALTER TABLE facilities ADD CONSTRAINT facilities_lat_range CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90);
--> statement-breakpoint
ALTER TABLE facilities ADD CONSTRAINT facilities_lng_range CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180);
--> statement-breakpoint
ALTER TABLE disposal_records ADD CONSTRAINT disposal_records_qty_positive CHECK (treated_quantity IS NULL OR treated_quantity > 0);
--> statement-breakpoint
ALTER TABLE receipt_records ADD CONSTRAINT receipt_records_qty_nonneg CHECK (received_quantity IS NULL OR received_quantity >= 0);
--> statement-breakpoint
ALTER TABLE waste_categories ADD CONSTRAINT waste_categories_color_hex CHECK (color_hex ~ '^#[0-9A-Fa-f]{6}$');
--> statement-breakpoint
ALTER TABLE users ADD CONSTRAINT users_email_lowercase CHECK (email = lower(email));
