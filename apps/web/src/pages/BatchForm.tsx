import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowLeft, Info } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { Button, EmptyState, Field, FormError, Input, LoadingBlock, PageHeader, Panel, Select, Textarea, fieldError } from "../components/ui";
import { api } from "../lib/api";
import { useCategories, useFacilities } from "../lib/queries";
import { useActor } from "../lib/session";
import type { BatchDetail } from "../lib/types";

export default function BatchForm() {
  const { id } = useParams();
  const editing = !!id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { isAdmin, facilityIds, isTransporter } = useActor();
  const facilities = useFacilities();
  const categories = useCategories();
  const existing = useQuery({ queryKey: ["batch", id], queryFn: () => api.get<BatchDetail>(`/api/batches/${id}`), enabled: editing });

  const [form, setForm] = useState({ originFacilityId: "", categoryId: "", quantity: "", unit: "kg", containerCount: "1", containerType: "", sourceArea: "", destinationFacilityId: "", segregationNotes: "", handlingNotes: "" });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const myFacilities = (facilities.data ?? []).filter((f) => (isAdmin || facilityIds.includes(f.id)) && f.type !== "treatment");
  const receivers = (facilities.data ?? []).filter((f) => f.canReceive);
  const activeCats = (categories.data ?? []).filter((c) => c.active);

  useEffect(() => {
    if (editing && existing.data) {
      const b = existing.data;
      setForm({ originFacilityId: b.originFacilityId, categoryId: b.categoryId, quantity: String(b.quantity), unit: b.unit, containerCount: String(b.containerCount), containerType: b.containerType ?? "", sourceArea: b.sourceArea ?? "", destinationFacilityId: b.destinationFacilityId ?? "", segregationNotes: b.segregationNotes ?? "", handlingNotes: b.handlingNotes ?? "" });
    }
  }, [editing, existing.data]);
  useEffect(() => {
    if (!editing && !form.originFacilityId && myFacilities.length === 1) set("originFacilityId", myFacilities[0].id);
  }, [myFacilities.length]); // eslint-disable-line

  const save = useMutation({
    mutationFn: () => {
      const body = {
        categoryId: form.categoryId,
        quantity: Number(form.quantity),
        unit: form.unit,
        containerType: form.containerType || null,
        sourceArea: form.sourceArea || null,
        destinationFacilityId: form.destinationFacilityId || null,
        segregationNotes: form.segregationNotes || null,
        handlingNotes: form.handlingNotes || null,
      };
      return editing
        ? api.patch<{ id: string; trackingCode: string }>(`/api/batches/${id}`, body)
        : api.post<{ id: string; trackingCode: string }>("/api/batches", { ...body, originFacilityId: form.originFacilityId, containerCount: Number(form.containerCount) });
    },
    onSuccess: (b) => {
      qc.invalidateQueries({ queryKey: ["batches"] });
      qc.invalidateQueries({ queryKey: ["batch", b.id] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      if (editing) {
        toast.success("Batch updated");
        navigate(`/batches/${b.id}`);
      } else {
        toast.success(`Batch ${b.trackingCode} registered`, { description: "Print the labels and attach one to each container." });
        navigate(`/batches/${b.id}/labels?new=1`);
      }
    },
  });

  if (isTransporter) return <EmptyState title="Transporters don't register waste">Batches are registered by facility staff at the generating facility.</EmptyState>;
  if (facilities.isLoading || categories.isLoading || (editing && existing.isLoading)) return <LoadingBlock rows={6} />;
  if (!editing && myFacilities.length === 0)
    return (
      <Panel>
        <EmptyState title="You're not assigned to a generating facility" action={isAdmin ? <Link to="/facilities" className="font-semibold text-emerald-700">Add a facility</Link> : undefined}>
          {isAdmin ? "Add a facility that generates waste first." : "Ask your admin to assign you to the facility where you work."}
        </EmptyState>
      </Panel>
    );

  const selectedCat = activeCats.find((c) => c.id === form.categoryId);
  const fe = (k: string) => fieldError(save.error, k);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <>
      <PageHeader
        back={<Link to={editing ? `/batches/${id}` : "/batches"} className="mb-2 inline-flex items-center gap-1 text-sm font-semibold text-ink-2 hover:text-emerald-700"><ArrowLeft className="size-4" /> {editing ? existing.data?.trackingCode : "Waste batches"}</Link>}
        title={editing ? "Edit batch" : "Register waste"}
        description={editing ? "Batches can be edited until segregation is verified. Every change is kept in the timeline." : "One batch = waste of a single category from one place, collected together. You'll print a QR label for each container next."}
      />
      <form onSubmit={submit} className="grid gap-5 lg:grid-cols-[1fr_340px]" noValidate>
        <div className="flex flex-col gap-5">
          <Panel title="What kind of waste?">
            <fieldset>
              <legend className="sr-only">Waste category</legend>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {activeCats.map((c) => (
                  <label key={c.id} className={clsx("relative flex cursor-pointer gap-3 rounded-[14px] border-2 p-3.5 transition-colors", form.categoryId === c.id ? "border-emerald-600 bg-emerald-50/60" : "border-line hover:border-line-2")}>
                    <input type="radio" name="category" value={c.id} checked={form.categoryId === c.id} onChange={() => set("categoryId", c.id)} className="sr-only" />
                    <span className="relative mt-0.5 h-9 w-7 shrink-0 rounded-[5px] ring-1 ring-black/15" style={{ background: c.colorHex }} aria-hidden>
                      <span className="absolute inset-x-0 top-0 h-2 rounded-t-[5px] bg-black/20" />
                    </span>
                    <span className="min-w-0">
                      <span className="block font-semibold">{c.name}</span>
                      <span className="line-clamp-2 block text-[13px] text-ink-2">{c.examples ?? c.description}</span>
                    </span>
                  </label>
                ))}
              </div>
              {fe("categoryId") && <p className="mt-2 text-[13px] text-danger">{fe("categoryId")}</p>}
            </fieldset>
            {selectedCat?.handlingInstructions && (
              <p className="mt-4 flex gap-2 rounded-[12px] bg-mist p-3 text-[13.5px] text-ink-2">
                <Info className="mt-0.5 size-4 shrink-0 text-emerald-700" /> {selectedCat.handlingInstructions}
              </p>
            )}
          </Panel>

          <Panel title="Where and how much">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Generated at" htmlFor="origin" error={fe("originFacilityId")} required>
                <Select id="origin" value={form.originFacilityId} onChange={(e) => set("originFacilityId", e.target.value)} disabled={editing}>
                  <option value="">Choose facility…</option>
                  {(editing ? facilities.data ?? [] : myFacilities).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </Select>
              </Field>
              <Field label="Ward / department" htmlFor="area" hint="No patient details." error={fe("sourceArea")}>
                <Input id="area" value={form.sourceArea} onChange={(e) => set("sourceArea", e.target.value)} placeholder="e.g. Ward 3, OT-2, Pathology" />
              </Field>
              <div className="grid grid-cols-[1fr_120px] gap-2">
                <Field label="Quantity" htmlFor="qty" error={fe("quantity")} required>
                  <Input id="qty" inputMode="decimal" type="number" min="0" step="0.01" value={form.quantity} onChange={(e) => set("quantity", e.target.value)} />
                </Field>
                <Field label="Unit" htmlFor="unit">
                  <Select id="unit" value={form.unit} onChange={(e) => set("unit", e.target.value)}>
                    <option value="kg">kg</option>
                    <option value="litre">litres</option>
                    <option value="bag">bags</option>
                    <option value="container">containers</option>
                  </Select>
                </Field>
              </div>
              <Field label="Number of containers" htmlFor="count" hint={editing ? "Fixed once labels exist." : "One QR label is created per container (max 50)."} error={fe("containerCount")}>
                <Input id="count" type="number" min={1} max={50} value={form.containerCount} onChange={(e) => set("containerCount", e.target.value)} disabled={editing} />
              </Field>
              <Field label="Container type" htmlFor="ctype">
                <Input id="ctype" value={form.containerType} onChange={(e) => set("containerType", e.target.value)} placeholder="e.g. 20 L yellow bag, sharps box" />
              </Field>
              <Field label="Intended destination" htmlFor="dest" hint="Optional — set when a transport job is created." error={fe("destinationFacilityId")}>
                <Select id="dest" value={form.destinationFacilityId} onChange={(e) => set("destinationFacilityId", e.target.value)}>
                  <option value="">Decide later</option>
                  {receivers.filter((r) => r.id !== form.originFacilityId).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </Select>
              </Field>
            </div>
          </Panel>

          <Panel title="Notes">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Segregation notes" htmlFor="seg">
                <Textarea id="seg" value={form.segregationNotes} onChange={(e) => set("segregationNotes", e.target.value)} placeholder="Anything the checker should know" />
              </Field>
              <Field label="Handling instructions" htmlFor="hand">
                <Textarea id="hand" value={form.handlingNotes} onChange={(e) => set("handlingNotes", e.target.value)} placeholder="e.g. Heavy — two-person lift" />
              </Field>
            </div>
          </Panel>
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="flex flex-col gap-4 rounded-[18px] border border-line bg-paper p-5">
            <h2 className="text-[17px] font-bold">{editing ? "Save changes" : "Ready to register?"}</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
              <dt className="text-ink-3">Category</dt><dd className="font-semibold">{selectedCat?.code ?? "—"}</dd>
              <dt className="text-ink-3">Quantity</dt><dd className="font-semibold">{form.quantity ? `${form.quantity} ${form.unit}` : "—"}</dd>
              <dt className="text-ink-3">Labels</dt><dd className="font-semibold">{form.containerCount || "—"}</dd>
            </dl>
            <FormError error={save.error} />
            <Button type="submit" size="lg" loading={save.isPending} disabled={!form.categoryId || !form.quantity || !form.originFacilityId}>
              {editing ? "Save changes" : "Register & create labels"}
            </Button>
            <p className="text-[12.5px] text-ink-3">Registering starts the custody record with you as the responsible person.</p>
          </div>
        </aside>
      </form>
    </>
  );
}
