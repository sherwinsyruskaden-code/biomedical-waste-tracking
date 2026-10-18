CREATE TYPE "public"."alert_status" AS ENUM('open', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."alert_type" AS ENUM('overdue_collection', 'delayed_transport', 'missing_handover', 'pending_receipt', 'failed_receipt', 'stale_gps', 'incident', 'invalid_transition');--> statement-breakpoint
CREATE TYPE "public"."assignment_status" AS ENUM('assigned', 'accepted', 'in_progress', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."batch_status" AS ENUM('generated', 'segregated', 'collected', 'in_transit', 'delivered', 'received', 'disposed', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."custody_event_type" AS ENUM('created', 'updated', 'segregated', 'assigned', 'unassigned', 'pickup', 'transit_started', 'handover', 'received', 'rejected', 'rerouted', 'disposed', 'cancelled', 'incident');--> statement-breakpoint
CREATE TYPE "public"."disposal_method" AS ENUM('incineration', 'plasma_pyrolysis', 'autoclave', 'microwave', 'hydroclave', 'shredding', 'chemical_disinfection', 'deep_burial', 'encapsulation', 'sharps_pit', 'recycling_after_treatment', 'other');--> statement-breakpoint
CREATE TYPE "public"."facility_type" AS ENUM('generator', 'storage', 'treatment');--> statement-breakpoint
CREATE TYPE "public"."identifier_method" AS ENUM('qr', 'rfid', 'nfc');--> statement-breakpoint
CREATE TYPE "public"."incident_status" AS ENUM('open', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."incident_type" AS ENUM('spill', 'leak', 'damaged_container', 'wrong_segregation', 'weight_discrepancy', 'vehicle_breakdown', 'delay', 'exposure', 'other');--> statement-breakpoint
CREATE TYPE "public"."location_source" AS ENUM('device', 'simulated');--> statement-breakpoint
CREATE TYPE "public"."member_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."org_type" AS ENUM('hospital', 'clinic', 'laboratory', 'treatment_facility', 'transport_operator', 'health_network', 'other');--> statement-breakpoint
CREATE TYPE "public"."quantity_unit" AS ENUM('kg', 'litre', 'bag', 'container');--> statement-breakpoint
CREATE TYPE "public"."receipt_condition" AS ENUM('intact', 'damaged', 'leaking', 'mislabelled');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('admin', 'facility_staff', 'transporter');--> statement-breakpoint
CREATE TYPE "public"."scan_method" AS ENUM('qr', 'rfid', 'nfc', 'manual');--> statement-breakpoint
CREATE TYPE "public"."severity" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"type" "alert_type" NOT NULL,
	"severity" "severity" NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"batch_id" uuid,
	"assignment_id" uuid,
	"facility_id" uuid,
	"dedupe_key" text NOT NULL,
	"status" "alert_status" DEFAULT 'open' NOT NULL,
	"resolved_by_id" uuid,
	"resolved_at" timestamp with time zone,
	"auto_resolved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assignment_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"transporter_user_id" uuid NOT NULL,
	"origin_facility_id" uuid NOT NULL,
	"destination_facility_id" uuid NOT NULL,
	"vehicle_reg" text,
	"status" "assignment_status" DEFAULT 'assigned' NOT NULL,
	"scheduled_pickup_at" timestamp with time zone NOT NULL,
	"due_by" timestamp with time zone NOT NULL,
	"notes" text,
	"tracking_active" boolean DEFAULT false NOT NULL,
	"tracking_started_at" timestamp with time zone,
	"tracking_stopped_at" timestamp with time zone,
	"last_location_at" timestamp with time zone,
	"created_by_id" uuid,
	"accepted_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organization_id" uuid,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"metadata" jsonb,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "container_identifiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"container_id" uuid NOT NULL,
	"method" "identifier_method" NOT NULL,
	"value" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"registered_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deactivated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "containers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"label" text NOT NULL,
	"sequence" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custody_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"container_id" uuid,
	"event_type" "custody_event_type" NOT NULL,
	"from_status" "batch_status",
	"to_status" "batch_status",
	"actor_user_id" uuid,
	"actor_role" "member_role",
	"facility_id" uuid,
	"assignment_id" uuid,
	"from_custodian_user_id" uuid,
	"from_custodian_facility_id" uuid,
	"to_custodian_user_id" uuid,
	"to_custodian_facility_id" uuid,
	"scan_method" "scan_method",
	"latitude" double precision,
	"longitude" double precision,
	"notes" text,
	"details" jsonb,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disposal_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"facility_id" uuid NOT NULL,
	"method" "disposal_method" NOT NULL,
	"treated_quantity" numeric(12, 3),
	"unit" "quantity_unit",
	"performed_by_id" uuid NOT NULL,
	"document_ref" text,
	"notes" text,
	"disposed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "facility_type" NOT NULL,
	"can_receive" boolean DEFAULT false NOT NULL,
	"address" text NOT NULL,
	"city" text,
	"contact_name" text,
	"contact_phone" text,
	"authorization_ref" text,
	"latitude" double precision,
	"longitude" double precision,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"batch_id" uuid,
	"assignment_id" uuid,
	"facility_id" uuid,
	"type" "incident_type" NOT NULL,
	"severity" "severity" NOT NULL,
	"description" text NOT NULL,
	"status" "incident_status" DEFAULT 'open' NOT NULL,
	"reported_by_id" uuid,
	"resolved_by_id" uuid,
	"resolved_at" timestamp with time zone,
	"resolution_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"full_name" text,
	"role" "member_role" NOT NULL,
	"facility_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "location_points" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"transporter_user_id" uuid NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"accuracy_m" double precision,
	"heading_deg" double precision,
	"speed_mps" double precision,
	"recorded_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" "location_source" DEFAULT 'device' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "membership_facilities" (
	"membership_id" uuid NOT NULL,
	"facility_id" uuid NOT NULL,
	CONSTRAINT "membership_facilities_membership_id_facility_id_pk" PRIMARY KEY("membership_id","facility_id")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" NOT NULL,
	"status" "member_status" DEFAULT 'active' NOT NULL,
	"vehicle_reg" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"alert_id" uuid,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"link" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" "org_type" NOT NULL,
	"registration_number" text,
	"contact_email" text,
	"contact_phone" text,
	"address" text,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipt_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"facility_id" uuid NOT NULL,
	"assignment_id" uuid,
	"received_by_id" uuid NOT NULL,
	"accepted" boolean NOT NULL,
	"received_quantity" numeric(12, 3),
	"unit" "quantity_unit",
	"condition" "receipt_condition" NOT NULL,
	"notes" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"active_organization_id" uuid,
	"user_agent" text,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"password_hash" text NOT NULL,
	"phone" text,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "waste_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"tracking_code" text NOT NULL,
	"origin_facility_id" uuid NOT NULL,
	"destination_facility_id" uuid,
	"category_id" uuid NOT NULL,
	"quantity" numeric(12, 3) NOT NULL,
	"unit" "quantity_unit" NOT NULL,
	"container_count" integer DEFAULT 1 NOT NULL,
	"container_type" text,
	"source_area" text,
	"segregation_verified" boolean DEFAULT false NOT NULL,
	"segregation_notes" text,
	"handling_notes" text,
	"status" "batch_status" DEFAULT 'generated' NOT NULL,
	"responsible_user_id" uuid NOT NULL,
	"current_custodian_user_id" uuid,
	"current_custodian_facility_id" uuid,
	"current_assignment_id" uuid,
	"collection_due_at" timestamp with time zone,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "waste_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"color_hex" text NOT NULL,
	"description" text,
	"examples" text,
	"handling_instructions" text,
	"allowed_disposal_methods" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_batch_id_waste_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."waste_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_resolved_by_id_users_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_batches" ADD CONSTRAINT "assignment_batches_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_batches" ADD CONSTRAINT "assignment_batches_batch_id_waste_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."waste_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_transporter_user_id_users_id_fk" FOREIGN KEY ("transporter_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_origin_facility_id_facilities_id_fk" FOREIGN KEY ("origin_facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_destination_facility_id_facilities_id_fk" FOREIGN KEY ("destination_facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "container_identifiers" ADD CONSTRAINT "container_identifiers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "container_identifiers" ADD CONSTRAINT "container_identifiers_container_id_containers_id_fk" FOREIGN KEY ("container_id") REFERENCES "public"."containers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "container_identifiers" ADD CONSTRAINT "container_identifiers_registered_by_id_users_id_fk" FOREIGN KEY ("registered_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "containers" ADD CONSTRAINT "containers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "containers" ADD CONSTRAINT "containers_batch_id_waste_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."waste_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custody_events" ADD CONSTRAINT "custody_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custody_events" ADD CONSTRAINT "custody_events_batch_id_waste_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."waste_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custody_events" ADD CONSTRAINT "custody_events_container_id_containers_id_fk" FOREIGN KEY ("container_id") REFERENCES "public"."containers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custody_events" ADD CONSTRAINT "custody_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custody_events" ADD CONSTRAINT "custody_events_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custody_events" ADD CONSTRAINT "custody_events_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custody_events" ADD CONSTRAINT "custody_events_from_custodian_user_id_users_id_fk" FOREIGN KEY ("from_custodian_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custody_events" ADD CONSTRAINT "custody_events_from_custodian_facility_id_facilities_id_fk" FOREIGN KEY ("from_custodian_facility_id") REFERENCES "public"."facilities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custody_events" ADD CONSTRAINT "custody_events_to_custodian_user_id_users_id_fk" FOREIGN KEY ("to_custodian_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custody_events" ADD CONSTRAINT "custody_events_to_custodian_facility_id_facilities_id_fk" FOREIGN KEY ("to_custodian_facility_id") REFERENCES "public"."facilities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disposal_records" ADD CONSTRAINT "disposal_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disposal_records" ADD CONSTRAINT "disposal_records_batch_id_waste_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."waste_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disposal_records" ADD CONSTRAINT "disposal_records_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disposal_records" ADD CONSTRAINT "disposal_records_performed_by_id_users_id_fk" FOREIGN KEY ("performed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facilities" ADD CONSTRAINT "facilities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_batch_id_waste_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."waste_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_reported_by_id_users_id_fk" FOREIGN KEY ("reported_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_resolved_by_id_users_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_id_users_id_fk" FOREIGN KEY ("invited_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_points" ADD CONSTRAINT "location_points_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_points" ADD CONSTRAINT "location_points_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_points" ADD CONSTRAINT "location_points_transporter_user_id_users_id_fk" FOREIGN KEY ("transporter_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_facilities" ADD CONSTRAINT "membership_facilities_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_facilities" ADD CONSTRAINT "membership_facilities_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_alert_id_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."alerts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_records" ADD CONSTRAINT "receipt_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_records" ADD CONSTRAINT "receipt_records_batch_id_waste_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."waste_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_records" ADD CONSTRAINT "receipt_records_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_records" ADD CONSTRAINT "receipt_records_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_records" ADD CONSTRAINT "receipt_records_received_by_id_users_id_fk" FOREIGN KEY ("received_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_active_organization_id_organizations_id_fk" FOREIGN KEY ("active_organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waste_batches" ADD CONSTRAINT "waste_batches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waste_batches" ADD CONSTRAINT "waste_batches_origin_facility_id_facilities_id_fk" FOREIGN KEY ("origin_facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waste_batches" ADD CONSTRAINT "waste_batches_destination_facility_id_facilities_id_fk" FOREIGN KEY ("destination_facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waste_batches" ADD CONSTRAINT "waste_batches_category_id_waste_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."waste_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waste_batches" ADD CONSTRAINT "waste_batches_responsible_user_id_users_id_fk" FOREIGN KEY ("responsible_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waste_batches" ADD CONSTRAINT "waste_batches_current_custodian_user_id_users_id_fk" FOREIGN KEY ("current_custodian_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waste_batches" ADD CONSTRAINT "waste_batches_current_custodian_facility_id_facilities_id_fk" FOREIGN KEY ("current_custodian_facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waste_batches" ADD CONSTRAINT "waste_batches_current_assignment_id_assignments_id_fk" FOREIGN KEY ("current_assignment_id") REFERENCES "public"."assignments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waste_categories" ADD CONSTRAINT "waste_categories_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alerts_open_dedupe_uq" ON "alerts" USING btree ("organization_id","dedupe_key") WHERE "alerts"."status" = 'open';--> statement-breakpoint
CREATE INDEX "alerts_org_status_idx" ON "alerts" USING btree ("organization_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "assignment_batches_open_uq" ON "assignment_batches" USING btree ("batch_id") WHERE "assignment_batches"."removed_at" is null;--> statement-breakpoint
CREATE INDEX "assignment_batches_assignment_idx" ON "assignment_batches" USING btree ("assignment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assignments_reference_uq" ON "assignments" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "assignments_org_status_idx" ON "assignments" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "assignments_transporter_status_idx" ON "assignments" USING btree ("transporter_user_id","status");--> statement-breakpoint
CREATE INDEX "audit_logs_org_created_idx" ON "audit_logs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "container_identifiers_active_uq" ON "container_identifiers" USING btree ("method","value") WHERE "container_identifiers"."active" = true;--> statement-breakpoint
CREATE INDEX "container_identifiers_container_idx" ON "container_identifiers" USING btree ("container_id");--> statement-breakpoint
CREATE UNIQUE INDEX "containers_batch_seq_uq" ON "containers" USING btree ("batch_id","sequence");--> statement-breakpoint
CREATE INDEX "containers_org_idx" ON "containers" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "custody_events_batch_idx" ON "custody_events" USING btree ("batch_id","created_at");--> statement-breakpoint
CREATE INDEX "custody_events_org_created_idx" ON "custody_events" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "custody_events_idem_uq" ON "custody_events" USING btree ("organization_id","idempotency_key") WHERE "custody_events"."idempotency_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "disposal_records_batch_uq" ON "disposal_records" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "disposal_records_org_idx" ON "disposal_records" USING btree ("organization_id","disposed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "facilities_org_name_uq" ON "facilities" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "facilities_org_idx" ON "facilities" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "incidents_org_created_idx" ON "incidents" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "incidents_batch_idx" ON "incidents" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_uq" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invitations_org_idx" ON "invitations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "location_points_assignment_time_idx" ON "location_points" USING btree ("assignment_id","recorded_at");--> statement-breakpoint
CREATE INDEX "location_points_org_received_idx" ON "location_points" USING btree ("organization_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "location_points_dedupe_uq" ON "location_points" USING btree ("assignment_id","recorded_at");--> statement-breakpoint
CREATE INDEX "membership_facilities_facility_idx" ON "membership_facilities" USING btree ("facility_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_org_user_uq" ON "memberships" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "password_reset_token_uq" ON "password_reset_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "password_reset_user_idx" ON "password_reset_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "receipt_records_batch_idx" ON "receipt_records" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "receipt_records_org_idx" ON "receipt_records" USING btree ("organization_id","received_at");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "waste_batches_tracking_code_uq" ON "waste_batches" USING btree ("tracking_code");--> statement-breakpoint
CREATE INDEX "waste_batches_org_status_idx" ON "waste_batches" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "waste_batches_org_created_idx" ON "waste_batches" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "waste_batches_origin_idx" ON "waste_batches" USING btree ("origin_facility_id");--> statement-breakpoint
CREATE INDEX "waste_batches_destination_idx" ON "waste_batches" USING btree ("destination_facility_id");--> statement-breakpoint
CREATE INDEX "waste_batches_category_idx" ON "waste_batches" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "waste_batches_assignment_idx" ON "waste_batches" USING btree ("current_assignment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "waste_categories_org_code_uq" ON "waste_categories" USING btree ("organization_id","code");