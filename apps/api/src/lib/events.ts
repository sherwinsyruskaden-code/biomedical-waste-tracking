import { EventEmitter } from "node:events";

/**
 * In-process event bus feeding the server-sent-events stream.
 * Single API process is assumed (documented). For several instances, swap this for
 * PostgreSQL LISTEN/NOTIFY without touching publishers or subscribers.
 */
export type BusEvent =
  | { type: "location"; organizationId: string; payload: unknown }
  | { type: "batch"; organizationId: string; payload: { batchId: string; status: string } }
  | { type: "assignment"; organizationId: string; payload: { assignmentId: string; status: string } }
  | { type: "notification"; organizationId: string; userId: string; payload: unknown }
  | { type: "alert"; organizationId: string; payload: unknown };

const bus = new EventEmitter();
bus.setMaxListeners(1000);

export const publish = (event: BusEvent) => bus.emit("event", event);
export const subscribe = (fn: (e: BusEvent) => void) => {
  bus.on("event", fn);
  return () => bus.off("event", fn);
};
