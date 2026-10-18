import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { FacilityFields, emptyFacility, facilityPayload } from "../../components/FacilityFields";
import { Button, Checkbox, Field, FormError, Input, Select, fieldError } from "../../components/ui";
import { api } from "../../lib/api";
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

export default function Signup() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirm] = useState("");
  const [orgName, setOrgName] = useState("");
  const [orgType, setOrgType] = useState("hospital");
  const [withFacility, setWithFacility] = useState(true);
  const [facility, setFacility] = useState(emptyFacility());
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
        facility: withFacility ? facilityPayload(facility) : null,
        acceptTerms: accept,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["me"] });
      navigate("/dashboard?welcome=1", { replace: true });
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) return setLocalError("Passwords do not match.");
    if (!accept) return setLocalError("Please accept the terms and privacy notice to continue.");
    setLocalError(null);
    m.mutate();
  };
  const fe = (k: string) => fieldError(m.error, k);

  return (
    <AuthLayout
      title="Create your organization"
      subtitle={<>Already registered? <Link to="/login" className="font-semibold text-emerald-700 hover:underline">Sign in</Link></>}
      aside={
        <>
          <p className="font-display text-[30px] font-bold leading-tight">You'll be the admin.</p>
          <p className="mt-3 max-w-[40ch] text-white/75">After this you can add more facilities, invite facility staff and transporters, and register the first batch.</p>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-7" noValidate>
        <fieldset className="flex flex-col gap-4">
          <legend className="mb-3 font-display text-[17px] font-bold">You</legend>
          <Field label="Full name" htmlFor="name" error={fe("fullName")} required>
            <Input id="name" autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </Field>
          <Field label="Work email" htmlFor="email" error={fe("email")} required>
            <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Password" htmlFor="pw" error={fe("password")} hint="10+ characters, letters and numbers" required>
              <Input id="pw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <Field label="Confirm password" htmlFor="pw2" error={fe("confirmPassword") ?? (localError === "Passwords do not match." ? localError : undefined)} required>
              <Input id="pw2" type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirm(e.target.value)} />
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
          <legend className="mb-3 font-display text-[17px] font-bold">First facility</legend>
          <Checkbox checked={withFacility} onChange={setWithFacility} label="Add my first facility now (recommended)" />
          {withFacility && <FacilityFields value={facility} onChange={setFacility} error={m.error} prefix="facility." compact />}
        </fieldset>

        <div className="flex flex-col gap-4">
          <Checkbox
            checked={accept}
            onChange={setAccept}
            label={<>I accept the <Link to="/terms" target="_blank" className="font-semibold text-emerald-700 underline">terms and privacy notice</Link>, including that transporters' location is recorded only during active jobs.</>}
          />
          {localError && localError !== "Passwords do not match." && <FormError error={new Error(localError)} />}
          <FormError error={m.error} />
          <Button type="submit" size="lg" loading={m.isPending}>Create organization</Button>
        </div>
      </form>
    </AuthLayout>
  );
}
