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
        <p className="mt-4 text-sm text-ink-2">Ask your administrator to send a new invitation. <Link to="/login" className="font-semibold text-emerald-700">Sign in</Link></p>
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
