import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import { RegistrationFacilityFields, emptyRegistration, registrationPayload } from "../components/FacilityFields";
import { Button, Field, FormError, Input, Select, fieldError } from "../components/ui";
import { api } from "../lib/api";
import { useMe } from "../lib/session";
import { AuthLayout } from "./auth/AuthLayout";
import { orgTypes } from "./auth/Signup";

/** Shown to signed-in users who have no active organization (e.g. access was removed). */
export default function Onboarding() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [type, setType] = useState("hospital");
  const [facility, setFacility] = useState(emptyRegistration());
  const create = useMutation({
    mutationFn: () => api.post("/api/auth/create-organization", { organization: { name, type }, facility: registrationPayload(facility) }),
    onSuccess: async () => {
      await qc.invalidateQueries();
      navigate("/dashboard?welcome=1", { replace: true });
    },
  });
  const switchOrg = useMutation({
    mutationFn: (organizationId: string) => api.post("/api/auth/switch-organization", { organizationId }),
    onSuccess: async () => {
      await qc.invalidateQueries();
      navigate("/dashboard");
    },
  });
  const logout = useMutation({ mutationFn: () => api.post("/api/auth/logout"), onSettled: () => { qc.clear(); navigate("/login"); } });
  const active = me?.memberships.filter((m) => m.status === "active") ?? [];
  return (
    <AuthLayout title="Choose a workspace" subtitle={`Signed in as ${me?.user.email}. You're not currently in an active organization.`}>
      {active.length > 0 && (
        <div className="mb-8 flex flex-col gap-2">
          {active.map((m) => (
            <Button key={m.id} variant="secondary" onClick={() => switchOrg.mutate(m.organizationId)} loading={switchOrg.isPending}>
              Open {m.organizationName}
            </Button>
          ))}
        </div>
      )}
      <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="flex flex-col gap-4">
        <h2 className="text-lg font-bold">Create a new organization</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Organization name" htmlFor="oname" error={fieldError(create.error, "organization.name")} required>
            <Input id="oname" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Type" htmlFor="otype">
            <Select id="otype" value={type} onChange={(e) => setType(e.target.value)}>
              {orgTypes.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </Field>
        </div>
        <h3 className="text-[15px] font-bold">Facility</h3>
        <RegistrationFacilityFields value={facility} onChange={setFacility} error={create.error} />
        <FormError error={create.error} />
        <Button type="submit" size="lg" loading={create.isPending}>Create organization</Button>
        <Button type="button" variant="ghost" onClick={() => logout.mutate()}>Sign out</Button>
      </form>
    </AuthLayout>
  );
}
