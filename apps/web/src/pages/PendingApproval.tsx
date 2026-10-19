import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Clock3, RefreshCw, XCircle } from "lucide-react";
import { useNavigate } from "react-router";
import { Button } from "../components/ui";
import { api } from "../lib/api";
import { fmtDateTime } from "../lib/format";
import { useMe } from "../lib/session";
import { AuthLayout } from "./auth/AuthLayout";

/** Shown instead of the app while the active organization awaits (or failed) platform review. */
export default function PendingApproval() {
  const { data: me, refetch, isFetching } = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const logout = useMutation({ mutationFn: () => api.post("/api/auth/logout"), onSettled: () => { qc.clear(); navigate("/login", { replace: true }); } });
  const switchOrg = useMutation({
    mutationFn: (organizationId: string) => api.post("/api/auth/switch-organization", { organizationId }),
    onSuccess: async () => { await qc.invalidateQueries(); navigate("/dashboard"); },
  });
  const org = me?.organization;
  const rejected = org?.status === "rejected";
  const others = (me?.memberships ?? []).filter((m) => m.status === "active" && m.organizationStatus === "approved" && m.organizationId !== org?.id);
  return (
    <AuthLayout
      title={rejected ? "Registration not approved" : "Waiting for approval"}
      subtitle={<>Signed in as {me?.user.email}.</>}
      aside={
        <>
          <p className="font-display text-[30px] font-bold leading-tight">Every organization is checked before it can track waste.</p>
          <p className="mt-3 max-w-[40ch] text-white/75">A platform administrator reviews new registrations, so only genuine hospitals, treatment plants and transport operators get operational access.</p>
        </>
      }
    >
      <div className="flex flex-col gap-5" data-testid="pending-approval">
        <div className={rejected ? "rounded-[16px] bg-danger-soft p-5" : "rounded-[16px] bg-warn-soft/60 p-5"}>
          <p className="flex items-center gap-2 font-semibold">
            {rejected ? <XCircle className="size-5 text-danger" /> : <Clock3 className="size-5 text-warn" />}
            {org?.name}
          </p>
          <p className="mt-2 text-sm text-ink-2">
            {rejected
              ? "The platform team did not approve this registration. Your account and the organization's records are kept, but operational features are unavailable."
              : "Your registration was received and is in the review queue. You can sign in, but registering waste, facilities and your team unlocks once the organization is approved."}
          </p>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-ink-3">Submitted</dt><dd>{fmtDateTime(org?.submittedAt)}</dd>
            {org?.reviewedAt && <><dt className="text-ink-3">Reviewed</dt><dd>{fmtDateTime(org.reviewedAt)}</dd></>}
            {org?.reviewNote && <><dt className="text-ink-3">Reason</dt><dd>{org.reviewNote}</dd></>}
          </dl>
        </div>
        {!rejected && <Button variant="secondary" onClick={() => refetch()} loading={isFetching} icon={<RefreshCw className="size-4" />}>Check status again</Button>}
        {others.map((m) => (
          <Button key={m.id} variant="secondary" onClick={() => switchOrg.mutate(m.organizationId)} loading={switchOrg.isPending}>Open {m.organizationName}</Button>
        ))}
        <Button variant="ghost" onClick={() => logout.mutate()}>Sign out</Button>
      </div>
    </AuthLayout>
  );
}
