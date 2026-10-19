import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Button, Field, FormError, Input, fieldError } from "../../components/ui";
import { api } from "../../lib/api";
import { AuthLayout } from "./AuthLayout";
import { DemoLogin } from "../../components/DemoLogin";

const safeNext = (n: string | null) => (n && n.startsWith("/") && !n.startsWith("//") ? n : "/dashboard");

export function Login() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const login = useMutation({
    mutationFn: () => api.post("/api/auth/login", { email, password }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["me"] });
      navigate(safeNext(params.get("next")), { replace: true });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate();
  };
  return (
    <AuthLayout title="Sign in" subtitle={<>No account yet? <Link to="/signup" className="font-semibold text-emerald-700 underline-offset-2 hover:underline">Create an account</Link></>}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <FormError error={login.error} />
        <Field label="Work email" htmlFor="email" error={fieldError(login.error, "email")}>
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-sm font-semibold text-emerald-700 hover:underline">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" size="lg" loading={login.isPending}>
          Sign in
        </Button>
        <p className="text-[13px] text-ink-3">Already have an invitation? <Link to="/invite" className="font-semibold text-emerald-700 hover:underline">Accept invitation</Link></p>
      </form>
      <DemoLogin />
    </AuthLayout>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const m = useMutation({ mutationFn: () => api.post<{ message: string }>("/api/auth/forgot-password", { email }) });
  return (
    <AuthLayout title="Reset your password" subtitle="We'll email you a link that works for one hour.">
      {m.isSuccess ? (
        <div className="flex items-start gap-3 rounded-[14px] bg-emerald-50 p-4 text-emerald-900">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0" />
          <div>
            <p className="font-semibold">{m.data.message}</p>
            <p className="mt-1 text-sm">No email after a few minutes? If this server has no mail provider configured, ask the administrator — the link is written to the server log.</p>
            <Link to="/login" className="mt-3 inline-block text-sm font-semibold underline">Back to sign in</Link>
          </div>
        </div>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); m.mutate(); }} className="flex flex-col gap-4">
          <FormError error={m.error} />
          <Field label="Email" htmlFor="email" error={fieldError(m.error, "email")}>
            <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </Field>
          <Button type="submit" size="lg" loading={m.isPending}>Send reset link</Button>
          <Link to="/login" className="text-sm font-semibold text-emerald-700 hover:underline">Back to sign in</Link>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [mismatch, setMismatch] = useState(false);
  const m = useMutation({ mutationFn: () => api.post("/api/auth/reset-password", { token, password }), onSuccess: () => setTimeout(() => navigate("/login"), 1500) });
  return (
    <AuthLayout title="Choose a new password" subtitle="This signs you out on every other device.">
      {!token ? (
        <FormError error={new Error("This page needs the link from your reset email.")} />
      ) : m.isSuccess ? (
        <div className="rounded-[14px] bg-emerald-50 p-4 font-semibold text-emerald-900">Password updated. Taking you to sign in…</div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (password !== confirm) return setMismatch(true);
            setMismatch(false);
            m.mutate();
          }}
          className="flex flex-col gap-4"
        >
          <FormError error={m.error} />
          <Field label="New password" htmlFor="pw" hint="At least 10 characters, with letters and numbers." error={fieldError(m.error, "password")}>
            <Input id="pw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          <Field label="Confirm password" htmlFor="pw2" error={mismatch ? "Passwords do not match" : undefined}>
            <Input id="pw2" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required invalid={mismatch} />
          </Field>
          <Button type="submit" size="lg" loading={m.isPending}>Update password</Button>
        </form>
      )}
    </AuthLayout>
  );
}
