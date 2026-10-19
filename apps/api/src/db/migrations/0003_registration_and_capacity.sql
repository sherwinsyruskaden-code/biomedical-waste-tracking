-- Registration details, declined collections and one-active-order-per-transporter.
-- Safe for existing data: only adds nullable columns / enum values / an index; nothing is deleted or rewritten.

CREATE TYPE "public"."facility_kind" AS ENUM('hospital', 'lab');
--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN "kind" "facility_kind";
--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN "registration_id" text;
--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN "state" text;
--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN "postal_code" text;
--> statement-breakpoint
CREATE INDEX "facilities_registration_id_idx" ON "facilities" USING btree ("registration_id");
--> statement-breakpoint
ALTER TYPE "public"."assignment_status" ADD VALUE IF NOT EXISTS 'declined';
--> statement-breakpoint
ALTER TYPE "public"."custody_event_type" ADD VALUE IF NOT EXISTS 'declined';
--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "declined_at" timestamp with time zone;
--> statement-breakpoint
-- The database-level guard for "one active order per transporter". Older data may already contain a transporter with
-- two active orders (the previous sample data did); in that case the index is skipped with a notice and the API's own
-- locked capacity check still enforces the rule for every new assignment. Nothing is cancelled or changed automatically.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "assignments" WHERE "status" IN ('assigned', 'accepted', 'in_progress')
    GROUP BY "transporter_user_id" HAVING count(*) > 1
  ) THEN
    RAISE NOTICE 'assignments_one_active_per_transporter_uq skipped: existing data has a transporter with more than one active order';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS "assignments_one_active_per_transporter_uq" ON "assignments" ("transporter_user_id") WHERE "status" IN ('assigned', 'accepted', 'in_progress');
  END IF;
END $$;
