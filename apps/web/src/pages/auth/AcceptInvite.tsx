import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Button, Checkbox, ErrorState, Field, FormError, Input, LoadingBlock, fieldError } from "../../components/ui";
import { api } from "../../lib/api";
import { roleLabel } from "../../lib/format";
import { useMe } from "../../lib/session";
import type { Role } from "../../lib/types";
import { AuthLayout } from "./AuthLayout";

export default function AcceptInvite() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const info = useQuery({ queryKey: ["invite", token], queryFn: () => api.get<{ email: string; fullName: string | null; role: Role; organizationName: string; existingAccount: boolean }>(`/api/invitations/lookup/${token}`), retry: false });
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [accept, setAccept] = useState(false);
  const m = useMutation({
    mutationFn: () => api.post("/api/invitations/accept", { token, fullName: fullName || info.data?.fullName || undefined, password: password || undefined, acceptTerms: accept }),
    onSuccess: async () => {
      await qc.invalidateQueries();
      navigate("/dashboard", { replace: true });
    },
  });

  if (info.isLoading) return <AuthLayout title="Opening invitation…"><LoadingBlock rows={3} /></AuthLayout>;
  if (info.isError)
    return (
      <AuthLayout title="Invitation unavailable">
        <ErrorState error={info.error} />
        <p className="mt-4 text-sm text-ink-2">Ask your administrator to send a new invitation, or <Link to="/invite" className="font-semibold text-emerald-700">enter a different link</Link>. Already joined? <Link to="/login" className="font-semibold text-emerald-700">Sign in</Link></p>
      </AuthLayout>
    );
  const inv = info.data!;
  const signedInAsInvitee = me?.user.email === inv.email;
  return (
    <AuthLayout title={`Join ${inv.organizationName}`} subtitle={<>You've been invited as <strong>{roleLabel[inv.role]}</strong> ({inv.email}).</>}>
      <form onSubmit={(e) => { e.preventDefault(); m.mutate(); }} className="flex flex-col gap-4">
        {inv.existingAccount && !signedInAsInvitee ? (
          <div className="rounded-[14px] bg-mist p-4 text-sm text-ink-2">
            An account for {inv.email} already exists.{" "}
            <Link to={`/login?next=/invite/${token}`} className="font-semibold text-emerald-700 underline">Sign in as that user</Link> and this page will let you accept.
          </div>
        ) : (
          <>
            {!inv.existingAccount && (
              <>
                <Field label="Full name" htmlFor="name" error={fieldError(m.error, "fullName")} required>
                  <Input id="name" autoComplete="name" defaultValue={inv.fullName ?? ""} onChange={(e) => setFullName(e.target.value)} />
                </Field>
                <Field label="Create a password" htmlFor="pw" hint="10+ characters, letters and numbers" error={fieldError(m.error, "password")} required>
                  <Input id="pw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                </Field>
              </>
            )}
            <Checkbox checked={accept} onChange={setAccept} label={<>I accept the <Link to="/terms" target="_blank" className="font-semibold text-emerald-700 underline">terms and privacy notice</Link>.</>} />
            <FormError error={m.error} />
            <Button type="submit" size="lg" loading={m.isPending} disabled={!accept}>Accept invitation</Button>
          </>
        )}
      </form>
    </AuthLayout>
  );
}

/** "Already have an invitation?" — paste the link or code from the invitation email. */
export function EnterInvite() {
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const token = value.trim().match(/(?:\/invite\/)?([A-Za-z0-9_-]{20,100})\/?$/)?.[1];
    if (!token) return setError("Paste the whole invitation link from your email, or just the code at its end.");
    navigate(`/invite/${token}`);
  };
  return (
    <AuthLayout
      title="Accept an invitation"
      subtitle={<>Your organization admin invites hospital staff, treatment-plant staff and transporters. No invitation yet? <Link to="/signup" className="font-semibold text-emerald-700 hover:underline">Create an account</Link></>}
      aside={
        <>
          <p className="font-display text-[30px] font-bold leading-tight">Your role comes from your organization.</p>
          <p className="mt-3 max-w-[40ch] text-white/75">Admins choose your role and facility when they invite you, so nobody can give themselves more access than their job needs.</p>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label="Invitation link or code" htmlFor="invite" error={error ?? undefined} hint="It looks like https://…/invite/AbC123… — opening the link from your email works too.">
          <Input id="invite" value={value} onChange={(e) => { setValue(e.target.value); setError(null); }} autoFocus />
        </Field>
        <Button type="submit" size="lg" disabled={!value.trim()}>Continue</Button>
        <p className="text-[13px] text-ink-3">Already accepted? <Link to="/login" className="font-semibold text-emerald-700 hover:underline">Sign in</Link></p>
      </form>
    </AuthLayout>
  );
}
