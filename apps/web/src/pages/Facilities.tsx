import { useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Building2, MapPin, Plus } from "lucide-react";
import { useState } from "react";
import { Navigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { FacilityFields, emptyFacility, facilityPayload, type FacilityDraft } from "../components/FacilityFields";
import { Badge, Button, CategoryChip, Checkbox, Drawer, EmptyState, ErrorState, Field, FormError, Input, LoadingBlock, Modal, PageHeader, Textarea, fieldError } from "../components/ui";
import { api } from "../lib/api";
import { disposalMethods, facilityTypeLabel, humanize } from "../lib/format";
import { useCategories, useFacilities } from "../lib/queries";
import { useActor } from "../lib/session";
import type { Category, Facility } from "../lib/types";

function FacilityEditor({ facility, onClose }: { facility: Facility | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<FacilityDraft>(() =>
    facility
      ? { name: facility.name, type: facility.type, canReceive: facility.canReceive, address: facility.address, city: facility.city ?? "", contactName: facility.contactName ?? "", contactPhone: facility.contactPhone ?? "", authorizationRef: facility.authorizationRef ?? "", latitude: facility.latitude?.toString() ?? "", longitude: facility.longitude?.toString() ?? "" }
      : emptyFacility(),
  );
  const [active, setActive] = useState(facility?.active ?? true);
  const m = useMutation({
    mutationFn: () => (facility ? api.patch(`/api/facilities/${facility.id}`, { ...facilityPayload(draft), active }) : api.post("/api/facilities", facilityPayload(draft))),
    onSuccess: () => { toast.success(facility ? "Facility updated" : "Facility added"); qc.invalidateQueries({ queryKey: ["facilities"] }); onClose(); },
  });
  return (
    <Drawer open onOpenChange={(o) => !o && onClose()} title={facility ? `Edit ${facility.name}` : "Add facility"}>
      <form onSubmit={(e) => { e.preventDefault(); m.mutate(); }} className="flex flex-col gap-4">
        <FacilityFields value={draft} onChange={setDraft} error={m.error} />
        {facility && <Checkbox checked={active} onChange={setActive} label="Active (inactive facilities are hidden from new batches and jobs; history is kept)" />}
        <FormError error={m.error} />
        <Button type="submit" loading={m.isPending}>{facility ? "Save facility" : "Add facility"}</Button>
      </form>
    </Drawer>
  );
}

function CategoryEditor({ category, onClose }: { category: Category | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    code: category?.code ?? "",
    name: category?.name ?? "",
    colorHex: category?.colorHex ?? "#22C55E",
    description: category?.description ?? "",
    examples: category?.examples ?? "",
    handlingInstructions: category?.handlingInstructions ?? "",
    allowedDisposalMethods: category?.allowedDisposalMethods ?? [],
    active: category?.active ?? true,
  });
  const m = useMutation({
    mutationFn: () => (category ? api.patch(`/api/categories/${category.id}`, f) : api.post("/api/categories", f)),
    onSuccess: () => { toast.success(category ? "Category updated" : "Category added"); qc.invalidateQueries({ queryKey: ["categories"] }); onClose(); },
  });
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={category ? `Edit ${category.code}` : "Add waste category"} description="Match the categories and colour codes required where you operate." wide>
      <form onSubmit={(e) => { e.preventDefault(); m.mutate(); }} className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-[120px_1fr_140px]">
          <Field label="Code" htmlFor="cc" error={fieldError(m.error, "code")} required><Input id="cc" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></Field>
          <Field label="Name" htmlFor="cn" error={fieldError(m.error, "name")} required><Input id="cn" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Colour" htmlFor="ccol" error={fieldError(m.error, "colorHex")}>
            <div className="flex gap-2"><input id="ccol" type="color" value={f.colorHex} onChange={(e) => setF({ ...f, colorHex: e.target.value.toUpperCase() })} className="h-10 w-12 cursor-pointer rounded-lg border border-line-2" /><Input value={f.colorHex} onChange={(e) => setF({ ...f, colorHex: e.target.value })} aria-label="Hex colour" className="font-mono" /></div>
          </Field>
        </div>
        <Field label="Description" htmlFor="cd"><Textarea id="cd" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Examples" htmlFor="ce"><Textarea id="ce" value={f.examples} onChange={(e) => setF({ ...f, examples: e.target.value })} /></Field>
          <Field label="Handling instructions (printed on labels)" htmlFor="ch"><Textarea id="ch" value={f.handlingInstructions} onChange={(e) => setF({ ...f, handlingInstructions: e.target.value })} /></Field>
        </div>
        <Field label="Permitted treatment methods" hint="Disposal records for this category can only use these. Leave all unticked to allow any.">
          <div className="grid gap-2 rounded-[12px] border border-line p-3 sm:grid-cols-2">
            {disposalMethods.map((d) => <Checkbox key={d} checked={f.allowedDisposalMethods.includes(d)} onChange={(c) => setF({ ...f, allowedDisposalMethods: c ? [...f.allowedDisposalMethods, d] : f.allowedDisposalMethods.filter((x) => x !== d) })} label={humanize(d)} />)}
          </div>
        </Field>
        <Checkbox checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="Active — available when registering waste" />
        <FormError error={m.error} />
        <div className="flex justify-end"><Button type="submit" loading={m.isPending}>{category ? "Save category" : "Add category"}</Button></div>
      </form>
    </Modal>
  );
}

export default function Facilities() {
  const { isAdmin } = useActor();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "facilities";
  const facilities = useFacilities(true);
  const categories = useCategories();
  const [editFac, setEditFac] = useState<Facility | null | "new">(null);
  const [editCat, setEditCat] = useState<Category | null | "new">(null);
  if (!isAdmin) return <Navigate to="/dashboard" replace />;
  return (
    <>
      <PageHeader
        title="Facilities & categories"
        description="Where waste is generated and treated, and how it's classified."
        actions={tab === "facilities" ? <Button onClick={() => setEditFac("new")} icon={<Plus className="size-4" />}>Add facility</Button> : <Button onClick={() => setEditCat("new")} icon={<Plus className="size-4" />}>Add category</Button>}
      />
      <div className="mb-5 flex w-fit gap-1 rounded-[12px] bg-paper p-1 ring-1 ring-line" role="tablist">
        {[["facilities", "Facilities"], ["categories", "Waste categories"]].map(([v, l]) => (
          <button key={v} role="tab" aria-selected={tab === v} onClick={() => setParams({ tab: v })} className={clsx("rounded-[9px] px-3.5 py-1.5 text-sm font-semibold", tab === v ? "bg-emerald-600 text-white" : "text-ink-2 hover:bg-mist")}>{l}</button>
        ))}
      </div>
      {tab === "facilities" ? (
        facilities.isLoading ? <LoadingBlock /> : facilities.isError ? <ErrorState error={facilities.error} /> : facilities.data!.length === 0 ? (
          <EmptyState icon={<Building2 />} title="No facilities yet" action={<Button onClick={() => setEditFac("new")}>Add facility</Button>}>Add the hospital or clinic that generates waste and the treatment facility that receives it.</EmptyState>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {facilities.data!.map((f) => (
              <button key={f.id} onClick={() => setEditFac(f)} className={clsx("flex flex-col gap-2 rounded-[16px] border bg-paper p-5 text-left transition-colors hover:border-emerald-500", f.active ? "border-line" : "border-dashed border-line-2 opacity-70")}>
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-[17px] font-bold">{f.name}</span>
                  <Badge tone={f.type === "treatment" ? "ink" : f.type === "storage" ? "signal" : "emerald"}>{facilityTypeLabel[f.type]}</Badge>
                  {f.canReceive && f.type !== "treatment" && <Badge tone="lime">Can receive</Badge>}
                  {!f.active && <Badge>Inactive</Badge>}
                </span>
                <span className="text-sm text-ink-2">{f.address}{f.city ? `, ${f.city}` : ""}</span>
                <span className="flex items-center gap-1 text-[12.5px] text-ink-3"><MapPin className="size-3.5" />{f.latitude != null ? `${f.latitude.toFixed(4)}, ${f.longitude!.toFixed(4)}` : "No map position — add one to show it on the live map"}</span>
              </button>
            ))}
          </div>
        )
      ) : categories.isLoading ? <LoadingBlock /> : categories.isError ? <ErrorState error={categories.error} /> : (
        <>
          <p className="mb-4 max-w-[80ch] rounded-[12px] bg-warn-soft/60 px-4 py-3 text-sm text-ink-2">The starting categories follow the colour coding of India's Bio-Medical Waste Management Rules, 2016 (as amended). They are a template: check them against the rules that currently apply to you and edit as needed.</p>
          <div className="grid gap-3 md:grid-cols-2">
            {categories.data!.map((c) => (
              <button key={c.id} onClick={() => setEditCat(c)} className={clsx("flex flex-col gap-2 rounded-[16px] border border-line bg-paper p-5 text-left hover:border-emerald-500", !c.active && "opacity-60")}>
                <span className="flex items-center justify-between gap-2"><CategoryChip code={c.code} name={c.name} color={c.colorHex} />{!c.active && <Badge>Inactive</Badge>}</span>
                <span className="line-clamp-2 text-sm text-ink-2">{c.description}</span>
                <span className="flex flex-wrap gap-1">{c.allowedDisposalMethods.map((d) => <Badge key={d}>{humanize(d)}</Badge>)}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {editFac && <FacilityEditor facility={editFac === "new" ? null : editFac} onClose={() => setEditFac(null)} />}
      {editCat && <CategoryEditor category={editCat === "new" ? null : editCat} onClose={() => setEditCat(null)} />}
    </>
  );
}
