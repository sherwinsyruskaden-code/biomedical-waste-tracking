-- Organization approval by a platform administrator.
--
-- Safe for existing data: organizations that already exist keep working (they are marked
-- "approved" with a note explaining why); only organizations registered from now on start "pending".
-- Nothing is deleted.

CREATE TYPE "public"."org_status" AS ENUM('pending', 'approved', 'rejected');
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_platform_admin" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "status" "org_status" DEFAULT 'approved' NOT NULL;
--> statement-breakpoint
ALTER TABLE "organizations" ALTER COLUMN "status" SET DEFAULT 'pending';
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "applicant_user_id" uuid;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "submitted_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "reviewed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "reviewed_by_id" uuid;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "review_note" text;
--> statement-breakpoint
-- Existing organizations: the applicant is their first admin; they count as reviewed when this migration ran.
UPDATE "organizations" o SET
  "submitted_at" = o."created_at",
  "reviewed_at" = now(),
  "review_note" = 'Approved automatically: this organization existed before platform approval was introduced.',
  "applicant_user_id" = (SELECT m."user_id" FROM "memberships" m WHERE m."organization_id" = o."id" AND m."role" = 'admin' ORDER BY m."created_at" LIMIT 1);
--> statement-breakpoint
ALTER TABLE "organizations" ALTER COLUMN "submitted_at" SET DEFAULT now();
--> statement-breakpoint
ALTER TABLE "organizations" ALTER COLUMN "submitted_at" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_applicant_user_id_users_id_fk" FOREIGN KEY ("applicant_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
-- A decision always has a timestamp; a pending application never does.
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_review_consistent" CHECK (("status" = 'pending') = ("reviewed_at" IS NULL));
--> statement-breakpoint
CREATE INDEX "organizations_status_idx" ON "organizations" USING btree ("status","submitted_at");
