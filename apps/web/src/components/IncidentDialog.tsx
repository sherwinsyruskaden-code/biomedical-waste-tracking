import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { humanize, incidentTypes } from "../lib/format";
import { Button, Field, FormError, Modal, Select, Textarea, fieldError } from "./ui";

export function IncidentDialog({ open, onOpenChange, batchId, assignmentId, context }: { open: boolean; onOpenChange: (o: boolean) => void; batchId?: string; assignmentId?: string; context?: string }) {
  const qc = useQueryClient();
  const [type, setType] = useState<string>(incidentTypes[0]);
  const [severity, setSeverity] = useState("medium");
  const [description, setDescription] = useState("");
  const m = useMutation({
    mutationFn: () => api.post("/api/incidents", { type, severity, description, batchId: batchId ?? null, assignmentId: assignmentId ?? null }),
    onSuccess: () => {
      toast.success("Incident reported", { description: "Admins and the facility have been notified." });
      for (const k of ["batch", "incidents", "alerts", "dashboard"]) qc.invalidateQueries({ queryKey: [k] });
      onOpenChange(false);
    },
  });
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Report an incident" description={context}>
      <form onSubmit={(e) => { e.preventDefault(); m.mutate(); }} className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="What happened" htmlFor="it">
            <Select id="it" value={type} onChange={(e) => setType(e.target.value)}>
              {incidentTypes.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}
            </Select>
          </Field>
          <Field label="Severity" htmlFor="is">
            <Select id="is" value={severity} onChange={(e) => setSeverity(e.target.value)}>
              <option value="low">Low — no exposure risk</option>
              <option value="medium">Medium</option>
              <option value="high">High — exposure possible</option>
              <option value="critical">Critical — immediate risk</option>
            </Select>
          </Field>
        </div>
        <Field label="Description" htmlFor="id" error={fieldError(m.error, "description")} hint="What, where, and what was done about it." required>
          <Textarea id="id" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <FormError error={m.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Close</Button>
          <Button type="submit" loading={m.isPending} disabled={description.trim().length < 5}>Report incident</Button>
        </div>
      </form>
    </Modal>
  );
}
