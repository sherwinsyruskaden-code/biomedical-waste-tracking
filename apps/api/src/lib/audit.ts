import { auditLogs } from "../db/schema.js";
import type { Tx } from "../db/client.js";
import { db } from "../db/client.js";

export interface AuditEntry {
  organizationId?: string | null;
  actorUserId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

export async function audit(entry: AuditEntry, tx: Tx = db) {
  await tx.insert(auditLogs).values({
    organizationId: entry.organizationId ?? null,
    actorUserId: entry.actorUserId ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    metadata: entry.metadata,
    ip: entry.ip ?? null,
  });
}
