import { useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Building2, MailOpen } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { RegistrationFacilityFields, emptyRegistration, registrationPayload } from "../../components/FacilityFields";
import { Button, Checkbox, Field, FormError, Input, Select, fieldError, PasswordInput } from "../../components/ui";
import { api } from "../../lib/api";
import { PASSWORD_HINT, passwordIssue } from "../../lib/password";
import { AuthLayout } from "./AuthLayout";

export const orgTypes = [
  ["hospital", "Hospital"],
  ["clinic", "Clinic / nursing home"],
  ["laboratory", "Laboratory / blood bank"],
  ["treatment_facility", "Treatment facility (CBWTF)"],
  ["transport_operator", "Waste transport operator"],
  ["health_network", "Health network / group"],
  ["other", "Other"],
] as const;

/** Staff, plant staff and transporters get their role from their organization's admin, by invitation. */
function JoinByInvitation() {
  return (
    <div className="flex flex-col gap-5" data-testid="join-by-invitation">
      <p className="text-ink-2">People who work for an organization that already uses BWTS are added by that organization's administrator, who chooses their role and facility.</p>
      <Link to="/invite" className="inline-flex h-12 items-center justify-center gap-2 rounded-[12px] bg-emerald-600 px-6 font-semibold text-white hover:bg-emerald-700">
        <MailOpen className="size-4" /> I have an invitation — accept it
      </Link>
      <p className="text-[13px] text-ink-3">No invitation yet? Ask your organization administrator to invite you.</p>
    </div>
  );
}

export default function Signup() {
  const [params, setParams] = useSearchParams();
  const path = params.get("as") === "member" ? "member" : "organization";
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirm] = useState("");
  const [orgName, setOrgName] = useState("");
  const [orgType, setOrgType] = useState("hospital");
  const [facility, setFacility] = useState(emptyRegistration());
  const [accept, setAccept] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const m = useMutation({
    mutationFn: () =>
      api.post("/api/auth/signup", {
        fullName,
        email,
        password,
        confirmPassword,
        organization: { name: orgName, type: orgType },
        facility: registrationPayload(facility),
        acceptTerms: accept,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["me"] });
      navigate("/dashboard?welcome=1", { replace: true });
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const issue = passwordIssue(password);
    if (issue) return setLocalError(issue);
    if (password !== confirmPassword) return setLocalError("Passwords do not match.");
    if (!accept) return setLocalError("Please accept the terms and privacy notice to continue.");
    setLocalError(null);
    m.mutate();
  };
  const fe = (k: string) => fieldError(m.error, k);

  return (
    <AuthLayout
      title="Create an account"
      subtitle={<>Already registered? <Link to="/login" className="font-semibold text-emerald-700 hover:underline">Sign in</Link></>}
      aside={
        path === "organization" ? (
          <>
            <p className="font-display text-[30px] font-bold leading-tight">You'll be the organization admin.</p>
            <p className="mt-3 max-w-[40ch] text-white/75">The platform team reviews new organizations. Once yours is approved you can add facilities and register your first batch. Inviting your team is optional and can wait.</p>
          </>
        ) : undefined
      }
    >
      <div className="mb-7 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Account type">
        {([
          ["organization", <Building2 key="o" className="size-5" />, "Register an organization", "Hospital, clinic, treatment plant or transport operator"],
          ["member", <MailOpen key="m" className="size-5" />, "Join my organization", "Hospital staff, plant staff or transporter"],
        ] as const).map(([value, icon, title, sub]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={path === value}
            onClick={() => setParams(value === "member" ? { as: "member" } : {}, { replace: true })}
            className={clsx("flex items-start gap-3 rounded-[14px] border-2 p-3.5 text-left transition-colors", path === value ? "border-emerald-600 bg-emerald-50/60" : "border-line hover:border-line-2")}
          >
            <span className="mt-0.5 text-emerald-700">{icon}</span>
            <span><span className="block font-semibold">{title}</span><span className="block text-[12.5px] text-ink-3">{sub}</span></span>
          </button>
        ))}
      </div>
      {path === "member" ? <JoinByInvitation /> : (
      <form onSubmit={submit} className="flex flex-col gap-7" noValidate>
        <fieldset className="flex flex-col gap-4">
          <legend className="mb-3 font-display text-[17px] font-bold">You (organization administrator)</legend>
          <Field label="Full name" htmlFor="name" error={fe("fullName")} required>
            <Input id="name" autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </Field>
          <Field label="Work email" htmlFor="email" error={fe("email")} required>
            <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Password" htmlFor="pw" hint={PASSWORD_HINT} error={(password ? passwordIssue(password) : null) ?? fe("password")} required>
              <PasswordInput id="pw" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <Field label="Confirm password" htmlFor="pw2" error={fe("confirmPassword") ?? (localError === "Passwords do not match." ? localError : undefined)} required>
              <PasswordInput id="pw2" label="confirm password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirm(e.target.value)} />
            </Field>
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-4">
          <legend className="mb-3 font-display text-[17px] font-bold">Organization</legend>
          <div className="grid gap-4 sm:grid-cols-[1.4fr_1fr]">
            <Field label="Organization name" htmlFor="org" error={fe("organization.name")} required>
              <Input id="org" value={orgName} onChange={(e) => setOrgName(e.target.value)} />
            </Field>
            <Field label="Type" htmlFor="otype">
              <Select id="otype" value={orgType} onChange={(e) => setOrgType(e.target.value)}>
                {orgTypes.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </Select>
            </Field>
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-4">
          <legend className="mb-3 font-display text-[17px] font-bold">Facility</legend>
          <RegistrationFacilityFields value={facility} onChange={setFacility} error={m.error} />
        </fieldset>

        <div className="flex flex-col gap-4">
          <Checkbox
            checked={accept}
            onChange={setAccept}
            label={<>I accept the <Link to="/terms" target="_blank" className="font-semibold text-emerald-700 underline">terms and privacy notice</Link>, including that transporters' location is recorded only during active jobs.</>}
          />
          {localError && localError !== "Passwords do not match." && <FormError error={new Error(localError)} />}
          <FormError error={m.error} />
          <Button type="submit" size="lg" loading={m.isPending}>Register organization</Button>
          <p className="text-[13px] text-ink-3">Your organization stays <strong>pending</strong> until a platform administrator approves it. You can sign in meanwhile to check its status.</p>
        </div>
      </form>
      )}
    </AuthLayout>
  );
}
