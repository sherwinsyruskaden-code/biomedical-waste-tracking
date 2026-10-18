import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import { Button, ErrorState, Field, FormError, Input, LoadingBlock, PageHeader, Pagination, Panel, fieldError } from "../components/ui";
import { api, qs } from "../lib/api";
import { fmtDateTime, humanize } from "../lib/format";
import { useActor } from "../lib/session";

interface Org {
  id: string;
  name: string;
  type: string;
  registrationNumber: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  address: string | null;
  timezone: string;
  settings: Record<string, number>;
}

function Account() {
  const { me } = useActor();
  const qc = useQueryClient();
  const [fullName, setFullName] = useState(me.user.fullName);
  const [phone, setPhone] = useState(me.user.phone ?? "");
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const profile = useMutation({ mutationFn: () => api.patch("/api/auth/profile", { fullName, phone: phone || null }), onSuccess: () => { toast.success("Profile saved"); qc.invalidateQueries({ queryKey: ["me"] }); } });
  const pw = useMutation({ mutationFn: () => api.post("/api/auth/change-password", { currentPassword: cur, newPassword: next }), onSuccess: () => { toast.success("Password changed", { description: "Other devices have been signed out." }); setCur(""); setNext(""); } });
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Panel title="Your profile">
        <form onSubmit={(e) => { e.preventDefault(); profile.mutate(); }} className="flex flex-col gap-4">
          <Field label="Email"><Input value={me.user.email} disabled /></Field>
          <Field label="Full name" htmlFor="pn" error={fieldError(profile.error, "fullName")}><Input id="pn" value={fullName} onChange={(e) => setFullName(e.target.value)} /></Field>
          <Field label="Phone" htmlFor="pp" hint="Shown to admins, and to colleagues on jobs you're part of."><Input id="pp" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
          <FormError error={profile.error} />
          <Button type="submit" loading={profile.isPending} className="self-start">Save profile</Button>
        </form>
      </Panel>
      <Panel title="Change password">
        <form onSubmit={(e) => { e.preventDefault(); pw.mutate(); }} className="flex flex-col gap-4">
          <Field label="Current password" htmlFor="cp" error={fieldError(pw.error, "currentPassword")}><Input id="cp" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
          <Field label="New password" htmlFor="np" hint="10+ characters, letters and numbers" error={fieldError(pw.error, "newPassword")}><Input id="np" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
          <FormError error={pw.error} />
          <Button type="submit" loading={pw.isPending} disabled={!cur || !next} className="self-start">Change password</Button>
        </form>
      </Panel>
    </div>
  );
}

function Organization({ org }: { org: Org }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: org.name, registrationNumber: org.registrationNumber ?? "", contactEmail: org.contactEmail ?? "", contactPhone: org.contactPhone ?? "", address: org.address ?? "", timezone: org.timezone });
  const m = useMutation({ mutationFn: () => api.patch("/api/organization", f), onSuccess: () => { toast.success("Organization saved"); qc.invalidateQueries({ queryKey: ["me"] }); qc.invalidateQueries({ queryKey: ["organization"] }); } });
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v });
  return (
    <Panel title="Organization profile">
      <form onSubmit={(e) => { e.preventDefault(); m.mutate(); }} className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="on" error={fieldError(m.error, "name")}><Input id="on" value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <Field label="Registration / authorisation number" htmlFor="or"><Input id="or" value={f.registrationNumber} onChange={(e) => set("registrationNumber", e.target.value)} /></Field>
        <Field label="Contact email" htmlFor="oe"><Input id="oe" type="email" value={f.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} /></Field>
        <Field label="Contact phone" htmlFor="op"><Input id="op" value={f.contactPhone} onChange={(e) => set("contactPhone", e.target.value)} /></Field>
        <Field label="Address" htmlFor="oa"><Input id="oa" value={f.address} onChange={(e) => set("address", e.target.value)} /></Field>
        <Field label="Timezone (used in PDF reports)" htmlFor="ot" error={fieldError(m.error, "timezone")} hint="IANA name, e.g. Asia/Kolkata"><Input id="ot" value={f.timezone} onChange={(e) => set("timezone", e.target.value)} /></Field>
        <div className="sm:col-span-2"><FormError error={m.error} /></div>
        <Button type="submit" loading={m.isPending} className="self-start">Save organization</Button>
      </form>
    </Panel>
  );
}

const thresholdFields: { key: string; label: string; hint: string; unit: string }[] = [
  { key: "collectionOverdueHours", label: "Collection overdue after", hint: "Alert when a batch hasn't been picked up this long after registration.", unit: "hours" },
  { key: "transportDelayGraceMinutes", label: "Transport delayed after due time by", hint: "Grace period after a job's deliver-by time.", unit: "minutes" },
  { key: "custodyMaxHours", label: "Missing handover after", hint: "Alert when a transporter has held waste this long without handing it over.", unit: "hours" },
  { key: "receiptPendingMinutes", label: "Receipt pending after", hint: "Alert when delivered waste hasn't been received at the plant.", unit: "minutes" },
  { key: "staleGpsMinutes", label: "GPS stale after", hint: "During an active trip, a position older than this is flagged.", unit: "minutes" },
  { key: "weightTolerancePercent", label: "Weight tolerance", hint: "Difference between registered and received weight that opens an incident.", unit: "%" },
  { key: "locationRetentionDays", label: "Keep location history for", hint: "Older GPS points are deleted automatically.", unit: "days" },
];

function Thresholds({ org }: { org: Org }) {
  const qc = useQueryClient();
  const [v, setV] = useState<Record<string, string>>({});
  useEffect(() => setV(Object.fromEntries(thresholdFields.map((f) => [f.key, String(org.settings[f.key] ?? "")]))), [org]);
  const m = useMutation({ mutationFn: () => api.put("/api/organization/settings", Object.fromEntries(Object.entries(v).map(([k, x]) => [k, Number(x)]))), onSuccess: () => { toast.success("Thresholds saved"); qc.invalidateQueries({ queryKey: ["organization"] }); } });
  return (
    <Panel title="Alert thresholds & retention">
      <p className="mb-5 max-w-[75ch] text-sm text-ink-2">The defaults are operational suggestions, not legal limits. Set them to match the rules and authorisation that apply to your organization. The background check runs every minute.</p>
      <form onSubmit={(e) => { e.preventDefault(); m.mutate(); }} className="grid gap-4 md:grid-cols-2">
        {thresholdFields.map((f) => (
          <Field key={f.key} label={f.label} htmlFor={f.key} hint={f.hint} error={fieldError(m.error, f.key)}>
            <div className="flex items-center gap-2"><Input id={f.key} type="number" min={0} value={v[f.key] ?? ""} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} className="max-w-[140px]" /><span className="text-sm text-ink-3">{f.unit}</span></div>
          </Field>
        ))}
        <div className="md:col-span-2"><FormError error={m.error} /></div>
        <Button type="submit" loading={m.isPending} className="self-start">Save thresholds</Button>
      </form>
    </Panel>
  );
}

function AuditLog() {
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ["audit", page], queryFn: () => api.get<{ items: { id: number; action: string; entityType: string | null; entityId: string | null; createdAt: string; actorName: string | null; metadata: unknown }[]; total: number }>(`/api/audit-logs${qs({ page, pageSize: 30 })}`) });
  return (
    <Panel title="Audit log" actions={<span className="text-[12.5px] text-ink-3">Append-only</span>} bodyClassName="p-0">
      {q.isLoading ? <div className="p-5"><LoadingBlock /></div> : q.isError ? <div className="p-5"><ErrorState error={q.error} /></div> : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-mist text-left text-[12.5px] text-ink-3"><tr><th className="px-5 py-2.5 font-semibold">When</th><th className="px-3 py-2.5 font-semibold">Who</th><th className="px-3 py-2.5 font-semibold">Action</th><th className="px-5 py-2.5 font-semibold">Record</th></tr></thead>
              <tbody className="divide-y divide-line">
                {q.data!.items.map((l) => (
                  <tr key={l.id}>
                    <td className="tabular whitespace-nowrap px-5 py-2.5 text-ink-2">{fmtDateTime(l.createdAt)}</td>
                    <td className="px-3 py-2.5">{l.actorName ?? "—"}</td>
                    <td className="px-3 py-2.5 font-mono text-[12.5px]">{l.action}</td>
                    <td className="px-5 py-2.5 text-ink-3">{l.entityType ? `${humanize(l.entityType)} ${l.entityId?.slice(0, 8)}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={30} total={q.data!.total} onPage={setPage} />
        </>
      )}
    </Panel>
  );
}

export default function Settings() {
  const { isAdmin } = useActor();
  const [params, setParams] = useSearchParams();
  const org = useQuery({ queryKey: ["organization"], queryFn: () => api.get<Org>("/api/organization") });
  const tabs: [string, string][] = isAdmin ? [["account", "Account"], ["organization", "Organization"], ["thresholds", "Alerts & retention"], ["audit", "Audit log"]] : [["account", "Account"]];
  const tab = tabs.find(([v]) => v === params.get("tab"))?.[0] ?? (isAdmin ? "organization" : "account");
  return (
    <>
      <PageHeader title="Settings" />
      <div className="mb-5 flex w-fit flex-wrap gap-1 rounded-[12px] bg-paper p-1 ring-1 ring-line" role="tablist">
        {tabs.map(([v, l]) => <button key={v} role="tab" aria-selected={tab === v} onClick={() => setParams({ tab: v })} className={clsx("rounded-[9px] px-3.5 py-1.5 text-sm font-semibold", tab === v ? "bg-emerald-600 text-white" : "text-ink-2 hover:bg-mist")}>{l}</button>)}
      </div>
      {tab === "account" && <Account />}
      {tab !== "account" && (org.isLoading ? <LoadingBlock /> : org.isError ? <ErrorState error={org.error} /> : (
        <>
          {tab === "organization" && <Organization org={org.data!} />}
          {tab === "thresholds" && <Thresholds org={org.data!} />}
          {tab === "audit" && <AuditLog />}
        </>
      ))}
    </>
  );
}
