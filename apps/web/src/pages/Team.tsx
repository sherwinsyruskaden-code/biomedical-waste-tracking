import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Mail, UserPlus, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge, Button, Checkbox, Drawer, EmptyState, ErrorState, Field, FormError, Input, LoadingBlock, Modal, PageHeader, Panel, Select, fieldError } from "../components/ui";
import { api } from "../lib/api";
import { fmtDateTime, roleLabel, timeAgo } from "../lib/format";
import { useFacilities, useMembers } from "../lib/queries";
import { useActor } from "../lib/session";
import type { Member, Role } from "../lib/types";

const roleHelp: Record<Role, string> = {
  admin: "Full access: facilities, team, assignments, reports.",
  facility_staff: "Registers, labels and receives waste at the facilities you tick below.",
  transporter: "Sees only their own jobs; scans pickups and shares location.",
};

function FacilityPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const facilities = useFacilities();
  return (
    <div className="flex flex-col gap-2 rounded-[12px] border border-line p-3">
      {facilities.data?.length ? facilities.data.map((f) => (
        <Checkbox key={f.id} checked={value.includes(f.id)} onChange={(c) => onChange(c ? [...value, f.id] : value.filter((x) => x !== f.id))} label={<>{f.name} <span className="text-ink-3">· {f.type === "treatment" ? "treatment" : f.canReceive ? "can receive" : "generates"}</span></>} />
      )) : <p className="text-sm text-ink-3">Add facilities first.</p>}
    </div>
  );
}

function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<Role>("facility_staff");
  const [facilityIds, setFacilityIds] = useState<string[]>([]);
  const m = useMutation({
    mutationFn: () => api.post<{ link: string; emailSent: boolean; mailConfigured: boolean }>("/api/invitations", { email, fullName: fullName || null, role, facilityIds: role === "facility_staff" ? facilityIds : [] }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invitations"] }),
  });
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Invite someone" description="They'll set their own password when they open the link." wide>
      {m.isSuccess ? (
        <div className="flex flex-col gap-4">
          <div className="rounded-[14px] bg-emerald-50 p-4 text-emerald-900">
            <p className="font-semibold">{m.data.emailSent ? `Invitation emailed to ${email}.` : "Invitation created."}</p>
            <p className="mt-1 text-sm">{m.data.mailConfigured ? "You can also share the link below directly." : "Email isn't configured on this server, so send this link yourself (WhatsApp, email…). It works once and expires in 7 days."}</p>
          </div>
          <div className="flex gap-2">
            <Input readOnly value={m.data.link} className="font-mono text-[13px]" onFocus={(e) => e.target.select()} aria-label="Invitation link" />
            <Button variant="secondary" icon={<Copy className="size-4" />} onClick={() => navigator.clipboard.writeText(m.data.link).then(() => toast.success("Link copied"))}>Copy</Button>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { m.reset(); setEmail(""); setFullName(""); }}>Invite another</Button>
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); m.mutate(); }} className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Email" htmlFor="ie" error={fieldError(m.error, "email")} required><Input id="ie" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Field label="Name (optional)" htmlFor="in"><Input id="in" value={fullName} onChange={(e) => setFullName(e.target.value)} /></Field>
          </div>
          <Field label="Role" htmlFor="ir" hint={roleHelp[role]}>
            <Select id="ir" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="facility_staff">Facility staff</option>
              <option value="transporter">Transporter</option>
              <option value="admin">Admin</option>
            </Select>
          </Field>
          {role === "facility_staff" && <Field label="Works at"><FacilityPicker value={facilityIds} onChange={setFacilityIds} /></Field>}
          <FormError error={m.error} />
          <div className="flex justify-end"><Button type="submit" loading={m.isPending} disabled={!email || (role === "facility_staff" && facilityIds.length === 0)} icon={<Mail className="size-4" />}>Create invitation</Button></div>
        </form>
      )}
    </Modal>
  );
}

function EditMember({ member, onClose }: { member: Member; onClose: () => void }) {
  const qc = useQueryClient();
  const [role, setRole] = useState<Role>(member.role);
  const [status, setStatus] = useState(member.status);
  const [facilityIds, setFacilityIds] = useState(member.facilityIds);
  const [vehicleReg, setVehicleReg] = useState(member.vehicleReg ?? "");
  const m = useMutation({
    mutationFn: () => api.patch(`/api/members/${member.id}`, { role, status, facilityIds: role === "facility_staff" ? facilityIds : [], vehicleReg: vehicleReg || null }),
    onSuccess: () => { toast.success("Member updated"); qc.invalidateQueries({ queryKey: ["members"] }); onClose(); },
  });
  return (
    <Drawer open onOpenChange={(o) => !o && onClose()} title={member.fullName}>
      <form onSubmit={(e) => { e.preventDefault(); m.mutate(); }} className="flex flex-col gap-4">
        <p className="text-sm text-ink-2">{member.email}</p>
        <Field label="Role" htmlFor="er" hint={roleHelp[role]}>
          <Select id="er" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="admin">Admin</option><option value="facility_staff">Facility staff</option><option value="transporter">Transporter</option>
          </Select>
        </Field>
        {role === "facility_staff" && <Field label="Works at"><FacilityPicker value={facilityIds} onChange={setFacilityIds} /></Field>}
        {role === "transporter" && <Field label="Default vehicle" htmlFor="ev"><Input id="ev" value={vehicleReg} onChange={(e) => setVehicleReg(e.target.value)} placeholder="TN 09 AB 1234" /></Field>}
        <Field label="Access" htmlFor="es" hint="Disabling signs them out of this organization immediately. Their history is kept.">
          <Select id="es" value={status} onChange={(e) => setStatus(e.target.value as "active" | "disabled")}>
            <option value="active">Active</option><option value="disabled">Disabled</option>
          </Select>
        </Field>
        <FormError error={m.error} />
        <Button type="submit" loading={m.isPending}>Save member</Button>
      </form>
    </Drawer>
  );
}

export default function Team() {
  const { isAdmin, userId } = useActor();
  const qc = useQueryClient();
  const members = useMembers();
  const facilities = useFacilities();
  const invites = useQuery({ queryKey: ["invitations"], queryFn: () => api.get<{ id: string; email: string; role: Role; expiresAt: string; createdAt: string }[]>("/api/invitations"), enabled: isAdmin });
  const revoke = useMutation({ mutationFn: (id: string) => api.del(`/api/invitations/${id}`), onSuccess: () => { toast.success("Invitation revoked"); qc.invalidateQueries({ queryKey: ["invitations"] }); } });
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  if (!isAdmin) return <EmptyState title="Only admins manage the team" />;
  const facName = (id: string) => facilities.data?.find((f) => f.id === id)?.name ?? "—";
  return (
    <>
      <PageHeader title="Team" description="Everyone with access to this organization, and what they can do." actions={<Button onClick={() => setInviting(true)} icon={<UserPlus className="size-4" />}>Invite</Button>} />
      <div className="flex flex-col gap-5">
        <Panel bodyClassName="p-0">
          {members.isLoading ? <div className="p-5"><LoadingBlock /></div> : members.isError ? <div className="p-5"><ErrorState error={members.error} /></div> : members.data!.length === 0 ? <EmptyState icon={<Users />} title="No members" /> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-mist text-left text-[12.5px] text-ink-3">
                  <tr><th className="px-5 py-3 font-semibold">Name</th><th className="px-3 py-3 font-semibold">Role</th><th className="px-3 py-3 font-semibold">Facilities / vehicle</th><th className="px-3 py-3 font-semibold">Last sign-in</th><th className="px-5 py-3" /></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {members.data!.map((m) => (
                    <tr key={m.id} className={m.status === "disabled" ? "opacity-60" : ""}>
                      <td className="px-5 py-3"><p className="font-semibold">{m.fullName}{m.userId === userId && <span className="font-normal text-ink-3"> (you)</span>}</p><p className="text-ink-3">{m.email}</p></td>
                      <td className="px-3 py-3"><Badge tone={m.role === "admin" ? "ink" : m.role === "transporter" ? "signal" : "emerald"}>{roleLabel[m.role]}</Badge>{m.status === "disabled" && <Badge tone="danger" className="ml-1">Disabled</Badge>}</td>
                      <td className="px-3 py-3 text-ink-2">{m.role === "facility_staff" ? (m.facilityIds.length ? m.facilityIds.map(facName).join(", ") : <span className="text-danger">None assigned</span>) : m.role === "transporter" ? m.vehicleReg ?? "—" : "All"}</td>
                      <td className="px-3 py-3 text-ink-2">{m.lastLoginAt ? timeAgo(m.lastLoginAt) : "Never"}</td>
                      <td className="px-5 py-3 text-right"><Button size="sm" variant="secondary" onClick={() => setEditing(m)}>Edit</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        <Panel title="Pending invitations" bodyClassName="p-0">
          {!invites.data?.length ? <p className="px-5 py-4 text-sm text-ink-3">No pending invitations.</p> : (
            <ul className="divide-y divide-line">
              {invites.data.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <span><span className="font-semibold">{i.email}</span> <span className="text-ink-3">· {roleLabel[i.role]} · expires {fmtDateTime(i.expiresAt)}</span></span>
                  <Button size="sm" variant="ghost" onClick={() => revoke.mutate(i.id)}>Revoke</Button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      {inviting && <InviteDialog open onOpenChange={setInviting} />}
      {editing && <EditMember member={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
