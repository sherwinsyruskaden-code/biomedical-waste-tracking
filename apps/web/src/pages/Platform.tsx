import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Building2, CheckCircle2, LogOut, ShieldCheck, XCircle } from "lucide-react";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { Logo } from "../components/AppShell";
import { Badge, Button, EmptyState, ErrorState, Field, FormError, LoadingBlock, Modal, PageHeader, Textarea } from "../components/ui";
import { api } from "../lib/api";
import { facilityTypeLabel, fmtDateTime, humanize } from "../lib/format";
import { useMe } from "../lib/session";
import type { OrgStatus } from "../lib/types";

interface OrgReview {
  id: string;
  name: string;
  type: string;
  status: OrgStatus;
  registrationNumber: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  address: string | null;
  submittedAt: string;
  reviewedAt: string | null;
  reviewNote: string | null;
  reviewedByName: string | null;
  memberCount: number;
  applicant: { fullName: string; email: string; phone: string | null } | null;
  facilities: { id: string; name: string; type: string; canReceive: boolean; address: string; city: string | null; authorizationRef: string | null }[];
}

const statusTone = { pending: "warn", approved: "emerald", rejected: "danger" } as const;

function ReviewCard({ o, onDecide }: { o: OrgReview; onDecide: (o: OrgReview, d: "approve" | "reject") => void }) {
  return (
    <article className="rounded-[18px] border border-line bg-paper p-5" data-testid="org-review">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[19px] font-bold">{o.name}</h2>
          <p className="text-sm text-ink-2">{humanize(o.type)} · submitted {fmtDateTime(o.submittedAt)}</p>
        </div>
        <Badge tone={statusTone[o.status]} dot>{humanize(o.status)}</Badge>
      </div>
      <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr_auto_1fr]">
        <dt className="text-ink-3">Applicant</dt><dd>{o.applicant ? <>{o.applicant.fullName}<span className="block text-ink-3">{o.applicant.email}{o.applicant.phone ? ` · ${o.applicant.phone}` : ""}</span></> : "—"}</dd>
        <dt className="text-ink-3">Registration no.</dt><dd className="font-mono">{o.registrationNumber ?? <span className="font-sans text-ink-3">Not provided</span>}</dd>
        <dt className="text-ink-3">Contact</dt><dd>{[o.contactEmail, o.contactPhone].filter(Boolean).join(" · ") || "—"}</dd>
        <dt className="text-ink-3">Address</dt><dd>{o.address ?? "—"}</dd>
      </dl>
      <div className="mt-4">
        <p className="text-[13px] font-semibold text-ink-2">Declared facilities</p>
        {o.facilities.length === 0 ? (
          <p className="text-sm text-ink-3">None yet.</p>
        ) : (
          <ul className="mt-1.5 grid gap-2 sm:grid-cols-2">
            {o.facilities.map((f) => (
              <li key={f.id} className="flex gap-2 rounded-[12px] bg-mist px-3 py-2 text-sm">
                <Building2 className="mt-0.5 size-4 shrink-0 text-emerald-700" />
                <span><strong>{f.name}</strong> <span className="text-ink-3">· {facilityTypeLabel[f.type] ?? f.type}</span><span className="block text-ink-2">{f.address}{f.city ? `, ${f.city}` : ""}</span>{f.authorizationRef && <span className="block font-mono text-[12.5px] text-ink-3">Auth. {f.authorizationRef}</span>}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {o.status === "pending" ? (
        <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4">
          <Button onClick={() => onDecide(o, "approve")} icon={<CheckCircle2 className="size-4" />}>Approve</Button>
          <Button variant="danger" onClick={() => onDecide(o, "reject")} icon={<XCircle className="size-4" />}>Reject</Button>
        </div>
      ) : (
        <p className="mt-4 border-t border-line pt-3 text-sm text-ink-2">
          {humanize(o.status)} {o.reviewedAt && <>on {fmtDateTime(o.reviewedAt)}</>} {o.reviewedByName && <>by {o.reviewedByName}</>}
          {o.reviewNote && <span className="block text-ink-3">“{o.reviewNote}”</span>}
        </p>
      )}
    </article>
  );
}

/** Platform administrators review organization registrations. Separate from any organization's own admin. */
export default function Platform() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = (params.get("status") ?? "pending") as OrgStatus | "all";
  const q = useQuery({ queryKey: ["platform", "orgs", status], queryFn: () => api.get<{ items: OrgReview[]; counts: Record<OrgStatus, number> }>(`/api/platform/organizations?status=${status}`) });
  const [deciding, setDeciding] = useState<{ org: OrgReview; decision: "approve" | "reject" } | null>(null);
  const [note, setNote] = useState("");
  const decide = useMutation({
    mutationFn: () =>
      deciding!.decision === "approve"
        ? api.post(`/api/platform/organizations/${deciding!.org.id}/approve`, { note: note || null })
        : api.post(`/api/platform/organizations/${deciding!.org.id}/reject`, { note }),
    onSuccess: () => {
      toast.success(deciding!.decision === "approve" ? `${deciding!.org.name} approved` : `${deciding!.org.name} rejected`, { description: "The applicant has been emailed." });
      setDeciding(null);
      setNote("");
      qc.invalidateQueries({ queryKey: ["platform"] });
    },
  });
  const logout = useMutation({ mutationFn: () => api.post("/api/auth/logout"), onSettled: () => { qc.clear(); navigate("/login", { replace: true }); } });
  const tabs: [OrgStatus | "all", string][] = [["pending", "Pending"], ["approved", "Approved"], ["rejected", "Rejected"], ["all", "All"]];
  return (
    <div className="min-h-dvh bg-mist">
      <header className="sticky top-0 z-[900] flex h-16 items-center gap-3 border-b border-line bg-paper/90 px-4 backdrop-blur md:px-8">
        <Logo />
        <Badge tone="ink"><ShieldCheck className="size-3" /> Platform administration</Badge>
        <div className="flex-1" />
        <span className="hidden text-sm font-semibold md:inline">{me?.user.fullName}</span>
        <Button variant="ghost" size="sm" onClick={() => logout.mutate()} icon={<LogOut className="size-4" />}>Sign out</Button>
      </header>
      <main className="mx-auto w-full max-w-[1100px] px-4 py-8 md:px-8 animate-rise-in">
        <PageHeader title="Organization registrations" description="Approve genuine organizations so they can start tracking waste. You cannot review an organization you belong to. Rejecting keeps all records." />
        <div className="mb-5 flex w-fit flex-wrap gap-1 rounded-[12px] bg-paper p-1 ring-1 ring-line" role="tablist">
          {tabs.map(([v, l]) => (
            <button key={v} role="tab" aria-selected={status === v} onClick={() => setParams({ status: v })} className={clsx("rounded-[9px] px-3.5 py-1.5 text-sm font-semibold", status === v ? "bg-emerald-600 text-white" : "text-ink-2 hover:bg-mist")}>
              {l}{v !== "all" && q.data ? <span className="tabular ml-1.5 opacity-75">{q.data.counts[v]}</span> : null}
            </button>
          ))}
        </div>
        {q.isLoading ? <LoadingBlock rows={6} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.data!.items.length === 0 ? (
          <EmptyState icon={<CheckCircle2 />} title={status === "pending" ? "No registrations waiting" : "Nothing here"}>{status === "pending" ? "New organizations appear here as soon as they register." : null}</EmptyState>
        ) : (
          <div className="flex flex-col gap-4">{q.data!.items.map((o) => <ReviewCard key={o.id} o={o} onDecide={(org, decision) => { setNote(""); decide.reset(); setDeciding({ org, decision }); }} />)}</div>
        )}
      </main>
      <Modal open={!!deciding} onOpenChange={(o) => !o && setDeciding(null)} title={deciding?.decision === "approve" ? `Approve ${deciding?.org.name}?` : `Reject ${deciding?.org.name}?`} description={deciding?.decision === "approve" ? "Its members can then add facilities, invite staff and track waste." : "The organization and its records are kept; its members lose operational access. The applicant sees your reason."}>
        <form onSubmit={(e) => { e.preventDefault(); decide.mutate(); }} className="flex flex-col gap-4">
          <Field label={deciding?.decision === "approve" ? "Note (optional)" : "Reason for the applicant"} htmlFor="note" required={deciding?.decision === "reject"}>
            <Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={deciding?.decision === "approve" ? "e.g. Registration certificate verified" : "e.g. Registration number could not be verified"} />
          </Field>
          <FormError error={decide.error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setDeciding(null)}>Cancel</Button>
            <Button type="submit" variant={deciding?.decision === "reject" ? "danger" : "primary"} loading={decide.isPending} disabled={deciding?.decision === "reject" && note.trim().length < 5}>
              {deciding?.decision === "approve" ? "Approve organization" : "Reject organization"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
