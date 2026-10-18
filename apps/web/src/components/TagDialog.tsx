import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "../lib/api";
import { Scanner, type ScanResult } from "./Scanner";
import { Button, FormError, Modal, Select } from "./ui";

/** Attach an RFID/NFC tag to a container. Uses the same scan sources as everything else. */
export function TagDialog({ open, onOpenChange, containerId, label }: { open: boolean; onOpenChange: (o: boolean) => void; containerId: string; label: string }) {
  const qc = useQueryClient();
  const [method, setMethod] = useState<"rfid" | "nfc">("rfid");
  const [value, setValue] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: (reassign: boolean) => api.post(`/api/containers/${containerId}/identifiers`, { method, value, reassign }),
    onSuccess: () => {
      toast.success(`${method.toUpperCase()} tag attached to ${label}`);
      qc.invalidateQueries({ queryKey: ["batch"] });
      onOpenChange(false);
    },
  });
  const reassignable = m.error instanceof ApiError && m.error.status === 409 && (m.error.details as { reassignable?: boolean } | undefined)?.reassignable;
  const onScan = (r: ScanResult) => {
    if (r.method === "qr") return;
    setMethod(r.method === "nfc" ? "nfc" : "rfid");
    setValue(r.value);
  };
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Attach a tag" description={`Container ${label}`} wide>
      <div className="flex flex-col gap-4">
        <Select value={method} onChange={(e) => setMethod(e.target.value as "rfid" | "nfc")} aria-label="Tag type">
          <option value="rfid">RFID tag</option>
          <option value="nfc">NFC tag</option>
        </Select>
        {value ? (
          <p className="rounded-[12px] bg-emerald-50 px-4 py-3 font-mono text-sm font-semibold text-emerald-900">{value}</p>
        ) : (
          <Scanner onResult={onScan} defaultMode="rfid" />
        )}
        <FormError error={m.error} />
        <div className="flex justify-end gap-2">
          {value && <Button variant="ghost" onClick={() => { setValue(null); m.reset(); }}>Scan a different tag</Button>}
          {reassignable ? (
            <Button variant="danger" onClick={() => m.mutate(true)} loading={m.isPending}>Move tag to this container</Button>
          ) : (
            <Button onClick={() => m.mutate(false)} loading={m.isPending} disabled={!value}>Attach tag</Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
