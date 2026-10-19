import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { CheckCircle2, Search, XCircle } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import { Badge, Button, EmptyState, ErrorState, Field, FormError, Input, LoadingBlock, Modal, PageHeader, Textarea } from "../components/ui";
import { api } from "../lib/api";
import { fmtDateTime, humanize } from "../lib/format";
import type { OrgStatus } from "../lib/types";

interface ReviewFacility {
  id: string;
  name: string;
  kind: "hospital" | "lab" | null;
  type: string;
  registrationId: string | null;
  address: string;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  contactName: string | null;
  contactPhone: string | null;
  authorizationRef: string | null;
}

interface OrgReview {
  id: string;
  name: string;
  type: string;
  status: OrgStatus;
  contactPhone: string | null;
  submittedAt: string;
  reviewedAt: string | null;
  reviewNote: string | null;
  reviewedByName: string | null;
  reviewedByEmail: string | null;
  applicant: { fullName: string; email: string; phone: string | null } | null;
  facilities: ReviewFacility[];
}

const statusTone = { pending: "warn", approved: "emerald", rejected: "danger" } as const;
const kindLabel = { hospital: "Hospital", lab: "Lab" } as const;

/** Shows what was submitted; where nothing was submitted it says so instead of inventing a value. */
const Row = ({ label, children }: { label: string; children?: ReactNode }) => (
  <div className="grid grid-cols-[118px_1fr] gap-3 py-1.5 text-sm">
    <dt className="text-ink-3">{label}</dt>
    <dd className="min-w-0 break-words">{children ?? <span className="text-ink-3">Not provided</span>}</dd>
  </div>
);

function Section({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={clsx("rounded-[14px] bg-mist px-4 py-3", className)}>
      <h3 className="mb-1 text-[12.5px] font-bold uppercase tracking-wide text-ink-3">{title}</h3>
      <dl>{children}</dl>
    </section>
  );
}

function ReviewCard({ o, onDecide }: { o: OrgReview; onDecide: (o: OrgReview, d: "approve" | "reject") => void }) {
  return (
    <article className="rounded-[18px] border border-line bg-paper p-5" data-testid="org-review" aria-label={`Registration of ${o.name}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[20px] font-bold" data-testid="review-org-name">{o.name}</h2>
          <p className="text-sm text-ink-2">{humanize(o.type)} · submitted {fmtDateTime(o.submittedAt)}</p>
        </div>
        <Badge tone={statusTone[o.status]} dot>{humanize(o.status)}</Badge>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <Section title="Organization administrator">
          <Row label="Full name"><span data-testid="review-admin-name">{o.applicant?.fullName}</span></Row>
          <Row label="Email">{o.applicant ? <a href={`mailto:${o.applicant.email}`} className="font-medium text-emerald-800 hover:underline" data-testid="review-admin-email">{o.applicant.email}</a> : undefined}</Row>
          <Row label="Phone">{o.applicant?.phone}</Row>
        </Section>
        <Section title="Registration">
          <Row label="Organization">{o.name}</Row>
          <Row label="Type">{humanize(o.type)}</Row>
          <Row label="Submitted">{fmtDateTime(o.submittedAt)}</Row>
          <Row label="Status">{humanize(o.status)}</Row>
        </Section>
      </div>

      {o.facilities.length === 0 ? (
        <p className="mt-3 rounded-[14px] bg-mist px-4 py-3 text-sm text-ink-3">No facility was submitted with this registration.</p>
      ) : (
        o.facilities.map((f) => (
          <div key={f.id} className="mt-3 grid gap-3 lg:grid-cols-[1fr_1.4fr]" data-testid="review-facility">
            <section className="rounded-[14px] border-2 border-emerald-600/70 bg-emerald-50/50 px-4 py-3">
              <h3 className="text-[12.5px] font-bold uppercase tracking-wide text-emerald-900">Facility Registration ID</h3>
              <p className="mt-1 break-all font-mono text-[22px] font-bold leading-tight text-ink" data-testid="review-registration-id">
                {f.registrationId ?? <span className="font-sans text-base font-semibold text-ink-3">Not provided</span>}
              </p>
              <p className="mt-2 text-[12.5px] text-ink-2">Compare with the applicant's registration documents. It is recorded as entered and has not been verified by this system.</p>
            </section>
            <Section title="Facility">
              <Row label="Type">{f.kind ? kindLabel[f.kind] : undefined}</Row>
              <Row label="Facility name">{f.name}</Row>
              <Row label="Address">
                <span data-testid="review-address">
                  {f.address}
                  {(f.city || f.state || f.postalCode) && <span className="block">{[f.city, f.state, f.postalCode].filter(Boolean).join(", ")}</span>}
                </span>
              </Row>
              <Row label="Contact phone">{f.contactPhone}</Row>
            </Section>
          </div>
        ))
      )}

      {o.reviewedAt && (
        <Section title="Previous review" className="mt-3">
          <Row label="Decision">{humanize(o.status)}</Row>
          <Row label="Reviewed">{fmtDateTime(o.reviewedAt)}</Row>
          <Row label="Reviewed by">{o.reviewedByName ? `${o.reviewedByName}${o.reviewedByEmail ? ` (${o.reviewedByEmail})` : ""}` : undefined}</Row>
          <Row label="Note">{o.reviewNote ?? undefined}</Row>
        </Section>
      )}

      {o.status === "pending" && (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
          <Button onClick={() => onDecide(o, "approve")} icon={<CheckCircle2 className="size-4" />} aria-label={`Approve ${o.name}`}>Approve</Button>
          <Button variant="danger" onClick={() => onDecide(o, "reject")} icon={<XCircle className="size-4" />} aria-label={`Reject ${o.name}`}>Reject</Button>
        </div>
      )}
    </article>
  );
}

/**
 * Organization approvals: a section of the admin interface, available only to accounts holding the separate
 * organization-review permission (enforced by the API; the navigation entry is just a convenience).
 */
export default function Approvals() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const status = (params.get("status") ?? "pending") as OrgStatus | "all";
  const [text, setText] = useState(params.get("q") ?? "");
  const [q, setQ] = useState(text);
  useEffect(() => {
    const t = window.setTimeout(() => setQ(text.trim()), 250);
    return () => window.clearTimeout(t);
  }, [text]);
  const list = useQuery({
    queryKey: ["platform", "orgs", status, q],
    queryFn: () => api.get<{ items: OrgReview[]; counts: Record<OrgStatus, number> }>(`/api/platform/organizations?status=${status}${q ? `&q=${encodeURIComponent(q)}` : ""}`),
    placeholderData: (p) => p,
  });
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
  const tabs: [OrgStatus | "all", string][] = [["pending", "Pending"], ["approved", "Approved"], ["rejected", "Rejected"], ["all", "All"]];
  const regId = deciding?.org.facilities[0]?.registrationId;
  return (
    <>
      <PageHeader title="Organization approvals" description="Review new registrations. You can't review an organization you belong to, and rejecting keeps all records." />
      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex w-fit flex-wrap gap-1 rounded-[12px] bg-paper p-1 ring-1 ring-line" role="tablist">
          {tabs.map(([v, l]) => (
            <button key={v} role="tab" aria-selected={status === v} onClick={() => setParams((p) => { const n = new URLSearchParams(p); n.set("status", v); return n; })} className={clsx("rounded-[9px] px-3.5 py-1.5 text-sm font-semibold", status === v ? "bg-emerald-600 text-white" : "text-ink-2 hover:bg-mist")}>
              {l}{v !== "all" && list.data ? <span className="tabular ml-1.5 opacity-75">{list.data.counts[v]}</span> : null}
            </button>
          ))}
        </div>
        <div className="relative w-full md:max-w-[380px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <Input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search registration ID, facility, organization, name or email" aria-label="Search registrations" className="pl-9" />
        </div>
      </div>
      {list.isLoading ? <LoadingBlock rows={6} /> : list.isError ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : list.data!.items.length === 0 ? (
        <EmptyState icon={<CheckCircle2 />} title={q ? "No registration matches your search" : status === "pending" ? "No registrations waiting" : "Nothing here"}>{q ? "Try part of the registration ID, the facility name or the administrator's email." : status === "pending" ? "New organizations appear here as soon as they register." : null}</EmptyState>
      ) : (
        <div className="flex flex-col gap-4">{list.data!.items.map((o) => <ReviewCard key={o.id} o={o} onDecide={(org, decision) => { setNote(""); decide.reset(); setDeciding({ org, decision }); }} />)}</div>
      )}
      <Modal
        open={!!deciding}
        onOpenChange={(o) => !o && setDeciding(null)}
        title={deciding?.decision === "approve" ? `Approve ${deciding?.org.name}?` : `Reject ${deciding?.org.name}?`}
        description={<>{regId ? <>Facility Registration ID <span className="font-mono font-semibold">{regId}</span>. </> : null}{deciding?.decision === "approve" ? "Its members can then add facilities, invite staff and track waste." : "The organization and its records are kept; its members lose operational access. The applicant sees your reason."}</>}
      >
        <form onSubmit={(e) => { e.preventDefault(); decide.mutate(); }} className="flex flex-col gap-4">
          <Field label={deciding?.decision === "approve" ? "Note (optional)" : "Reason for the applicant"} htmlFor="note" required={deciding?.decision === "reject"}>
            <Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={deciding?.decision === "approve" ? "e.g. Registration certificate verified" : "e.g. Registration ID could not be verified"} />
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
    </>
  );
}
