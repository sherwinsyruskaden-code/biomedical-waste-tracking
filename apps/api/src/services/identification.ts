/**
 * Container identification — one abstraction for QR, RFID and NFC.
 *
 * All scan sources (phone camera QR, USB "keyboard wedge" RFID readers, Web NFC, a future
 * fixed-reader gateway) end up calling resolveIdentifier(method, rawValue). The waste
 * lifecycle only ever sees the resolved container / batch, never the hardware.
 */
import { and, eq } from "drizzle-orm";
import { db, type Tx } from "../db/client.js";
import { containerIdentifiers, containers, wasteBatches } from "../db/schema.js";
import { env } from "../env.js";
import { randomToken } from "../lib/crypto.js";
import { badRequest } from "../lib/errors.js";

export type IdentifierMethod = "qr" | "rfid" | "nfc";

/** QR labels encode a URL so a normal phone camera opens the app; the token is the only secret part. */
export const qrPayload = (token: string) => `${env.APP_URL}/s/${token}`;

/** Accepts a full scan URL, a bare token, or an RFID/NFC UID in common formats. */
export function normalizeIdentifier(method: IdentifierMethod, raw: string): string {
  const value = raw.trim();
  if (method === "qr") {
    const m = value.match(/\/s\/([A-Za-z0-9_-]{16,64})\/?$/);
    const token = m ? m[1] : value;
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) throw badRequest("That QR code is not a BWTS container label.");
    return token;
  }
  // RFID EPC / NFC UID: hex, optionally separated by ':' '-' or spaces (e.g. 04:A2:3B:...)
  const hex = value.replace(/[\s:-]/g, "").toUpperCase();
  if (!/^[0-9A-F]{8,64}$/.test(hex)) throw badRequest(`Invalid ${method.toUpperCase()} identifier. Expected 8–64 hex characters.`);
  return hex;
}

export async function createQrIdentifier(tx: Tx, orgId: string, containerId: string, userId: string) {
  const token = randomToken(18); // 144 bits — not guessable
  await tx.insert(containerIdentifiers).values({ organizationId: orgId, containerId, method: "qr", value: token, registeredById: userId });
  return token;
}

/** Looks up an identifier inside one organization. Unknown or foreign identifiers return null (no leaking). */
export async function resolveIdentifier(orgId: string, method: IdentifierMethod, raw: string) {
  const value = normalizeIdentifier(method, raw);
  const [hit] = await db
    .select({
      identifierId: containerIdentifiers.id,
      containerId: containers.id,
      containerLabel: containers.label,
      batchId: wasteBatches.id,
    })
    .from(containerIdentifiers)
    .innerJoin(containers, eq(containers.id, containerIdentifiers.containerId))
    .innerJoin(wasteBatches, eq(wasteBatches.id, containers.batchId))
    .where(
      and(
        eq(containerIdentifiers.method, method),
        eq(containerIdentifiers.value, value),
        eq(containerIdentifiers.active, true),
        eq(containerIdentifiers.organizationId, orgId),
      ),
    );
  return hit ?? null;
}
