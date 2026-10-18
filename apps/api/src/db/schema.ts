/**
 * Database schema (Drizzle ORM, PostgreSQL).
 *
 * Design notes
 * - Every business table carries organization_id so every query can be org-scoped.
 * - custody_events and audit_logs are append-only (enforced by DB triggers in migration 0001).
 * - All timestamps are `timestamptz` (stored in UTC, rendered in the viewer's timezone).
 */
import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();

// ---------------------------------------------------------------- enums
export const roleEnum = pgEnum("member_role", ["admin", "facility_staff", "transporter"]);
export const memberStatusEnum = pgEnum("member_status", ["active", "disabled"]);
export const orgTypeEnum = pgEnum("org_type", [
  "hospital",
  "clinic",
  "laboratory",
  "treatment_facility",
  "transport_operator",
  "health_network",
  "other",
]);
export const facilityTypeEnum = pgEnum("facility_type", [
  "generator", // hospital / clinic / lab producing waste
  "storage", // intermediate storage area
  "treatment", // common biomedical waste treatment facility (CBWTF) / disposal site
]);
export const quantityUnitEnum = pgEnum("quantity_unit", ["kg", "litre", "bag", "container"]);
export const batchStatusEnum = pgEnum("batch_status", [
  "generated",
  "segregated",
  "collected",
  "in_transit",
  "delivered",
  "received",
  "disposed",
  "rejected",
  "cancelled",
]);
export const assignmentStatusEnum = pgEnum("assignment_status", [
  "assigned",
  "accepted",
  "in_progress",
  "completed",
  "cancelled",
]);
export const custodyEventTypeEnum = pgEnum("custody_event_type", [
  "created",
  "updated",
  "segregated",
  "assigned",
  "unassigned",
  "pickup",
  "transit_started",
  "handover",
  "received",
  "rejected",
  "rerouted",
  "disposed",
  "cancelled",
  "incident",
]);
export const scanMethodEnum = pgEnum("scan_method", ["qr", "rfid", "nfc", "manual"]);
export const identifierMethodEnum = pgEnum("identifier_method", ["qr", "rfid", "nfc"]);
export const locationSourceEnum = pgEnum("location_source", ["device", "simulated"]);
export const disposalMethodEnum = pgEnum("disposal_method", [
  "incineration",
  "plasma_pyrolysis",
  "autoclave",
  "microwave",
  "hydroclave",
  "shredding",
  "chemical_disinfection",
  "deep_burial",
  "encapsulation",
  "sharps_pit",
  "recycling_after_treatment",
  "other",
]);
export const receiptConditionEnum = pgEnum("receipt_condition", ["intact", "damaged", "leaking", "mislabelled"]);
export const incidentTypeEnum = pgEnum("incident_type", [
  "spill",
  "leak",
  "damaged_container",
  "wrong_segregation",
  "weight_discrepancy",
  "vehicle_breakdown",
  "delay",
  "exposure",
  "other",
]);
export const severityEnum = pgEnum("severity", ["low", "medium", "high", "critical"]);
export const incidentStatusEnum = pgEnum("incident_status", ["open", "resolved"]);
export const alertTypeEnum = pgEnum("alert_type", [
  "overdue_collection",
  "delayed_transport",
  "missing_handover",
  "pending_receipt",
  "failed_receipt",
  "stale_gps",
  "incident",
  "invalid_transition",
]);
export const alertStatusEnum = pgEnum("alert_status", ["open", "resolved"]);

// ---------------------------------------------------------------- identity
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(), // stored lower-cased
    fullName: text("full_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    phone: text("phone"),
    lastLoginAt: ts("last_login_at"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_uq").on(t.email)],
);

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  type: orgTypeEnum("type").notNull(),
  registrationNumber: text("registration_number"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  address: text("address"),
  timezone: text("timezone").notNull().default("Asia/Kolkata"),
  /** Operational thresholds — see services/settings.ts for defaults & documentation. */
  settings: jsonb("settings").notNull().default(sql`'{}'::jsonb`),
  createdAt: createdAt(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const sessions = pgTable(
  "sessions",
  {
    /** SHA-256 of the opaque session token held in the cookie. The raw token is never stored. */
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    activeOrganizationId: uuid("active_organization_id").references(() => organizations.id, { onDelete: "set null" }),
    userAgent: text("user_agent"),
    ip: text("ip"),
    createdAt: createdAt(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    expiresAt: ts("expires_at").notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId), index("sessions_expires_idx").on(t.expiresAt)],
);

export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("password_reset_token_uq").on(t.tokenHash), index("password_reset_user_idx").on(t.userId)],
);

// ---------------------------------------------------------------- org structure
export const facilities = pgTable(
  "facilities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: facilityTypeEnum("type").notNull(),
    /** Authorised to receive and dispose of waste (e.g. a CBWTF). */
    canReceive: boolean("can_receive").notNull().default(false),
    address: text("address").notNull(),
    city: text("city"),
    contactName: text("contact_name"),
    contactPhone: text("contact_phone"),
    authorizationRef: text("authorization_ref"),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("facilities_org_name_uq").on(t.organizationId, t.name),
    index("facilities_org_idx").on(t.organizationId),
  ],
);

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull(),
    status: memberStatusEnum("status").notNull().default("active"),
    /** Optional vehicle registration for transporters. */
    vehicleReg: text("vehicle_reg"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("memberships_org_user_uq").on(t.organizationId, t.userId),
    index("memberships_user_idx").on(t.userId),
  ],
);

/** Which facilities a facility-staff member works at (scopes what they may do). */
export const membershipFacilities = pgTable(
  "membership_facilities",
  {
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    facilityId: uuid("facility_id")
      .notNull()
      .references(() => facilities.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.membershipId, t.facilityId] }), index("membership_facilities_facility_idx").on(t.facilityId)],
);

export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    fullName: text("full_name"),
    role: roleEnum("role").notNull(),
    facilityIds: jsonb("facility_ids").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    tokenHash: text("token_hash").notNull(),
    invitedById: uuid("invited_by_id").references(() => users.id, { onDelete: "set null" }),
    expiresAt: ts("expires_at").notNull(),
    acceptedAt: ts("accepted_at"),
    revokedAt: ts("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("invitations_token_uq").on(t.tokenHash), index("invitations_org_idx").on(t.organizationId)],
);

export const wasteCategories = pgTable(
  "waste_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    colorHex: text("color_hex").notNull(),
    description: text("description"),
    examples: text("examples"),
    handlingInstructions: text("handling_instructions"),
    allowedDisposalMethods: jsonb("allowed_disposal_methods").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("waste_categories_org_code_uq").on(t.organizationId, t.code)],
);

// ---------------------------------------------------------------- waste
export const wasteBatches = pgTable(
  "waste_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    trackingCode: text("tracking_code").notNull(),
    originFacilityId: uuid("origin_facility_id")
      .notNull()
      .references(() => facilities.id),
    destinationFacilityId: uuid("destination_facility_id").references(() => facilities.id),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => wasteCategories.id),
    quantity: numeric("quantity", { precision: 12, scale: 3, mode: "number" }).notNull(),
    unit: quantityUnitEnum("unit").notNull(),
    containerCount: integer("container_count").notNull().default(1),
    containerType: text("container_type"),
    sourceArea: text("source_area"), // ward / department — never patient data
    segregationVerified: boolean("segregation_verified").notNull().default(false),
    segregationNotes: text("segregation_notes"),
    handlingNotes: text("handling_notes"),
    status: batchStatusEnum("status").notNull().default("generated"),
    responsibleUserId: uuid("responsible_user_id")
      .notNull()
      .references(() => users.id),
    currentCustodianUserId: uuid("current_custodian_user_id").references(() => users.id),
    currentCustodianFacilityId: uuid("current_custodian_facility_id").references(() => facilities.id),
    currentAssignmentId: uuid("current_assignment_id").references((): any => assignments.id, { onDelete: "set null" }),
    collectionDueAt: ts("collection_due_at"),
    generatedAt: ts("generated_at").notNull().defaultNow(),
    statusChangedAt: ts("status_changed_at").notNull().defaultNow(),
    /** Optimistic concurrency guard: incremented on every lifecycle transition. */
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("waste_batches_tracking_code_uq").on(t.trackingCode),
    index("waste_batches_org_status_idx").on(t.organizationId, t.status),
    index("waste_batches_org_created_idx").on(t.organizationId, t.createdAt),
    index("waste_batches_origin_idx").on(t.originFacilityId),
    index("waste_batches_destination_idx").on(t.destinationFacilityId),
    index("waste_batches_category_idx").on(t.categoryId),
    index("waste_batches_assignment_idx").on(t.currentAssignmentId),
  ],
);

export const containers = pgTable(
  "containers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => wasteBatches.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    sequence: integer("sequence").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("containers_batch_seq_uq").on(t.batchId, t.sequence), index("containers_org_idx").on(t.organizationId)],
);

/**
 * External identifiers (QR token, RFID EPC/UID, NFC UID) attached to containers.
 * One active identifier value per method may exist system-wide (prevents collisions).
 */
export const containerIdentifiers = pgTable(
  "container_identifiers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    containerId: uuid("container_id")
      .notNull()
      .references(() => containers.id, { onDelete: "cascade" }),
    method: identifierMethodEnum("method").notNull(),
    value: text("value").notNull(), // normalised (upper-case hex for RFID/NFC)
    active: boolean("active").notNull().default(true),
    registeredById: uuid("registered_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    deactivatedAt: ts("deactivated_at"),
  },
  (t) => [
    uniqueIndex("container_identifiers_active_uq").on(t.method, t.value).where(sql`${t.active} = true`),
    index("container_identifiers_container_idx").on(t.containerId),
  ],
);

export const assignments = pgTable(
  "assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    reference: text("reference").notNull(),
    transporterUserId: uuid("transporter_user_id")
      .notNull()
      .references(() => users.id),
    originFacilityId: uuid("origin_facility_id")
      .notNull()
      .references(() => facilities.id),
    destinationFacilityId: uuid("destination_facility_id")
      .notNull()
      .references(() => facilities.id),
    vehicleReg: text("vehicle_reg"),
    status: assignmentStatusEnum("status").notNull().default("assigned"),
    scheduledPickupAt: ts("scheduled_pickup_at").notNull(),
    dueBy: ts("due_by").notNull(),
    notes: text("notes"),
    trackingActive: boolean("tracking_active").notNull().default(false),
    trackingStartedAt: ts("tracking_started_at"),
    trackingStoppedAt: ts("tracking_stopped_at"),
    lastLocationAt: ts("last_location_at"),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    acceptedAt: ts("accepted_at"),
    startedAt: ts("started_at"),
    completedAt: ts("completed_at"),
    cancelledAt: ts("cancelled_at"),
    cancelReason: text("cancel_reason"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("assignments_reference_uq").on(t.reference),
    index("assignments_org_status_idx").on(t.organizationId, t.status),
    index("assignments_transporter_status_idx").on(t.transporterUserId, t.status),
  ],
);

/** History of which batches were placed on which assignment. A batch has at most one open link. */
export const assignmentBatches = pgTable(
  "assignment_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assignmentId: uuid("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => wasteBatches.id, { onDelete: "cascade" }),
    addedAt: ts("added_at").notNull().defaultNow(),
    removedAt: ts("removed_at"),
  },
  (t) => [
    uniqueIndex("assignment_batches_open_uq").on(t.batchId).where(sql`${t.removedAt} is null`),
    index("assignment_batches_assignment_idx").on(t.assignmentId),
  ],
);

/** Append-only chronological lifecycle + custody log. */
export const custodyEvents = pgTable(
  "custody_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => wasteBatches.id, { onDelete: "cascade" }),
    containerId: uuid("container_id").references(() => containers.id, { onDelete: "set null" }),
    eventType: custodyEventTypeEnum("event_type").notNull(),
    fromStatus: batchStatusEnum("from_status"),
    toStatus: batchStatusEnum("to_status"),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actorRole: roleEnum("actor_role"),
    facilityId: uuid("facility_id").references(() => facilities.id, { onDelete: "set null" }),
    assignmentId: uuid("assignment_id").references(() => assignments.id, { onDelete: "set null" }),
    fromCustodianUserId: uuid("from_custodian_user_id").references(() => users.id, { onDelete: "set null" }),
    fromCustodianFacilityId: uuid("from_custodian_facility_id").references(() => facilities.id, { onDelete: "set null" }),
    toCustodianUserId: uuid("to_custodian_user_id").references(() => users.id, { onDelete: "set null" }),
    toCustodianFacilityId: uuid("to_custodian_facility_id").references(() => facilities.id, { onDelete: "set null" }),
    scanMethod: scanMethodEnum("scan_method"),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    notes: text("notes"),
    details: jsonb("details"),
    idempotencyKey: text("idempotency_key"),
    createdAt: createdAt(),
  },
  (t) => [
    index("custody_events_batch_idx").on(t.batchId, t.createdAt),
    index("custody_events_org_created_idx").on(t.organizationId, t.createdAt),
    uniqueIndex("custody_events_idem_uq").on(t.organizationId, t.idempotencyKey).where(sql`${t.idempotencyKey} is not null`),
  ],
);

export const locationPoints = pgTable(
  "location_points",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    assignmentId: uuid("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    transporterUserId: uuid("transporter_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
    accuracyM: doublePrecision("accuracy_m"),
    headingDeg: doublePrecision("heading_deg"),
    speedMps: doublePrecision("speed_mps"),
    recordedAt: ts("recorded_at").notNull(),
    receivedAt: ts("received_at").notNull().defaultNow(),
    source: locationSourceEnum("source").notNull().default("device"),
  },
  (t) => [
    index("location_points_assignment_time_idx").on(t.assignmentId, t.recordedAt),
    index("location_points_org_received_idx").on(t.organizationId, t.receivedAt),
    uniqueIndex("location_points_dedupe_uq").on(t.assignmentId, t.recordedAt),
  ],
);

export const receiptRecords = pgTable(
  "receipt_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => wasteBatches.id, { onDelete: "cascade" }),
    facilityId: uuid("facility_id")
      .notNull()
      .references(() => facilities.id),
    assignmentId: uuid("assignment_id").references(() => assignments.id, { onDelete: "set null" }),
    receivedById: uuid("received_by_id")
      .notNull()
      .references(() => users.id),
    accepted: boolean("accepted").notNull(),
    receivedQuantity: numeric("received_quantity", { precision: 12, scale: 3, mode: "number" }),
    unit: quantityUnitEnum("unit"),
    condition: receiptConditionEnum("condition").notNull(),
    notes: text("notes"),
    receivedAt: ts("received_at").notNull().defaultNow(),
  },
  (t) => [index("receipt_records_batch_idx").on(t.batchId), index("receipt_records_org_idx").on(t.organizationId, t.receivedAt)],
);

export const disposalRecords = pgTable(
  "disposal_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => wasteBatches.id, { onDelete: "cascade" }),
    facilityId: uuid("facility_id")
      .notNull()
      .references(() => facilities.id),
    method: disposalMethodEnum("method").notNull(),
    treatedQuantity: numeric("treated_quantity", { precision: 12, scale: 3, mode: "number" }),
    unit: quantityUnitEnum("unit"),
    performedById: uuid("performed_by_id")
      .notNull()
      .references(() => users.id),
    /** Reference to an external document (e.g. treatment log / certificate number). Not issued by this app. */
    documentRef: text("document_ref"),
    notes: text("notes"),
    disposedAt: ts("disposed_at").notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("disposal_records_batch_uq").on(t.batchId), index("disposal_records_org_idx").on(t.organizationId, t.disposedAt)],
);

export const incidents = pgTable(
  "incidents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    batchId: uuid("batch_id").references(() => wasteBatches.id, { onDelete: "set null" }),
    assignmentId: uuid("assignment_id").references(() => assignments.id, { onDelete: "set null" }),
    facilityId: uuid("facility_id").references(() => facilities.id, { onDelete: "set null" }),
    type: incidentTypeEnum("type").notNull(),
    severity: severityEnum("severity").notNull(),
    description: text("description").notNull(),
    status: incidentStatusEnum("status").notNull().default("open"),
    reportedById: uuid("reported_by_id").references(() => users.id, { onDelete: "set null" }),
    resolvedById: uuid("resolved_by_id").references(() => users.id, { onDelete: "set null" }),
    resolvedAt: ts("resolved_at"),
    resolutionNotes: text("resolution_notes"),
    createdAt: createdAt(),
  },
  (t) => [index("incidents_org_created_idx").on(t.organizationId, t.createdAt), index("incidents_batch_idx").on(t.batchId)],
);

export const alerts = pgTable(
  "alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    type: alertTypeEnum("type").notNull(),
    severity: severityEnum("severity").notNull(),
    title: text("title").notNull(),
    message: text("message").notNull(),
    batchId: uuid("batch_id").references(() => wasteBatches.id, { onDelete: "cascade" }),
    assignmentId: uuid("assignment_id").references(() => assignments.id, { onDelete: "cascade" }),
    facilityId: uuid("facility_id").references(() => facilities.id, { onDelete: "set null" }),
    /** Prevents the background job from raising the same open alert twice. */
    dedupeKey: text("dedupe_key").notNull(),
    status: alertStatusEnum("status").notNull().default("open"),
    resolvedById: uuid("resolved_by_id").references(() => users.id, { onDelete: "set null" }),
    resolvedAt: ts("resolved_at"),
    autoResolved: boolean("auto_resolved").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("alerts_open_dedupe_uq").on(t.organizationId, t.dedupeKey).where(sql`${t.status} = 'open'`),
    index("alerts_org_status_idx").on(t.organizationId, t.status, t.createdAt),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    alertId: uuid("alert_id").references(() => alerts.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    link: text("link"),
    readAt: ts("read_at"),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.organizationId, t.createdAt)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    metadata: jsonb("metadata"),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_logs_org_created_idx").on(t.organizationId, t.createdAt), index("audit_logs_entity_idx").on(t.entityType, t.entityId)],
);

export type BatchStatus = (typeof batchStatusEnum.enumValues)[number];
export type Role = (typeof roleEnum.enumValues)[number];
export type AssignmentStatus = (typeof assignmentStatusEnum.enumValues)[number];
