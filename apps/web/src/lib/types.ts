export type Role = "admin" | "facility_staff" | "transporter";
export type BatchStatus = "generated" | "segregated" | "collected" | "in_transit" | "delivered" | "received" | "disposed" | "rejected" | "cancelled";
export type OrgStatus = "pending" | "approved" | "rejected";
export type AssignmentStatus = "assigned" | "accepted" | "in_progress" | "completed" | "cancelled";

export interface Me {
  user: { id: string; email: string; fullName: string; phone: string | null; isPlatformAdmin: boolean; createdAt: string };
  membership: { id: string; organizationId: string; role: Role; facilityIds: string[]; orgStatus: OrgStatus } | null;
  organization: { id: string; name: string; type: string; timezone: string; status: OrgStatus; submittedAt: string; reviewedAt: string | null; reviewNote: string | null } | null;
  memberships: { id: string; organizationId: string; organizationName: string; organizationStatus: OrgStatus; role: Role; status: string }[];
  /** demoOrg: signed into the synthetic demo organization (enables clearly-labelled demo tools). */
  features: { demoMode: boolean; demoOrg: boolean };
}

export interface Facility {
  id: string;
  name: string;
  type: "generator" | "storage" | "treatment";
  canReceive: boolean;
  address: string;
  city: string | null;
  contactName: string | null;
  contactPhone: string | null;
  authorizationRef: string | null;
  latitude: number | null;
  longitude: number | null;
  active: boolean;
  /** managed = admin of the organization; own = your workplace; partner = other end of a transfer (outline only). */
  access: "managed" | "own" | "partner";
}

export interface Category {
  id: string;
  code: string;
  name: string;
  colorHex: string;
  description: string | null;
  examples: string | null;
  handlingInstructions: string | null;
  allowedDisposalMethods: string[];
  active: boolean;
}

export interface BatchListItem {
  id: string;
  trackingCode: string;
  status: BatchStatus;
  quantity: number;
  unit: string;
  containerCount: number;
  sourceArea: string | null;
  createdAt: string;
  statusChangedAt: string;
  collectionDueAt: string | null;
  currentAssignmentId: string | null;
  originFacilityId: string;
  destinationFacilityId: string | null;
  category: { id: string; code: string; name: string; colorHex: string };
  originName: string;
  destinationName: string | null;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ActionInfo {
  action: "segregate" | "cancel" | "pickup" | "handover" | "receive" | "dispose" | "reroute";
  label: string;
  enabled: boolean;
  reason: string | null;
}

export interface CustodyEvent {
  id: number;
  eventType: string;
  fromStatus: BatchStatus | null;
  toStatus: BatchStatus | null;
  actorName: string | null;
  actorRole: Role | null;
  facilityName: string | null;
  fromCustodianUser: string | null;
  toCustodianUser: string | null;
  fromCustodianFacility: string | null;
  toCustodianFacility: string | null;
  assignmentId: string | null;
  scanMethod: string | null;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export interface Assignment {
  id: string;
  reference: string;
  status: AssignmentStatus;
  transporterUserId: string;
  originFacilityId: string;
  destinationFacilityId: string;
  vehicleReg: string | null;
  scheduledPickupAt: string;
  dueBy: string;
  notes: string | null;
  trackingActive: boolean;
  trackingStartedAt: string | null;
  lastLocationAt: string | null;
  acceptedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
}

export interface LocationPoint {
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  headingDeg: number | null;
  speedMps: number | null;
  recordedAt: string;
  source: "device" | "simulated";
}

export interface BatchDetail extends Omit<BatchListItem, "category" | "originName" | "destinationName"> {
  categoryId: string;
  containerType: string | null;
  segregationVerified: boolean;
  segregationNotes: string | null;
  handlingNotes: string | null;
  generatedAt: string;
  version: number;
  currentCustodianUserId: string | null;
  currentCustodianFacilityId: string | null;
  category: Category;
  origin: Facility;
  destination: Facility | null;
  responsible: { id: string; fullName: string };
  containers: { id: string; label: string; sequence: number; identifiers: { id: string; method: "qr" | "rfid" | "nfc"; value?: string; createdAt: string }[] }[];
  events: CustodyEvent[];
  receipts: { id: string; accepted: boolean; receivedQuantity: number | null; unit: string | null; condition: string; notes: string | null; receivedAt: string; receivedBy: string }[];
  disposal: { method: string; treatedQuantity: number | null; unit: string | null; documentRef: string | null; notes: string | null; disposedAt: string; performedBy: string; facilityName: string } | null;
  incidents: Incident[];
  currentAssignment: (Assignment & { transporterName: string | null; transporterPhone: string | null }) | null;
  assignmentHistory: { id: string; reference: string; status: AssignmentStatus; transporterName: string; addedAt: string; removedAt: string | null }[];
  availableActions: ActionInfo[];
  /** Present when you could request collection for this batch (origin hospital staff / admin). */
  collectionRequest: { enabled: boolean; reason: string | null; destination: { id: string; name: string } | null } | null;
}

export interface Incident {
  id: string;
  type: string;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  status: "open" | "resolved";
  batchId: string | null;
  assignmentId: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolutionNotes: string | null;
  reportedBy?: string | null;
  trackingCode?: string | null;
}

export interface Member {
  id: string;
  userId: string;
  fullName: string;
  email?: string;
  phone?: string | null;
  role: Role;
  status: "active" | "disabled";
  vehicleReg: string | null;
  lastLoginAt?: string | null;
  facilityIds: string[];
}
