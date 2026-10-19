import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Factory, Hospital, Loader2, ShieldCheck, Truck } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../lib/api";
import { FormError } from "./ui";

type Key = "staff" | "staffB" | "driver" | "plant" | "admin";
type Group = "hospital" | "transporter" | "plant" | "admin";
interface Account {
  key: Key;
  group: Group;
  label: string;
  facility: string;
  description: string;
}
interface SampleInfo {
  enabled: boolean;
  accounts: Account[];
}

export const useDemoInfo = () => useQuery({ queryKey: ["demo-info"], queryFn: () => api.get<SampleInfo>("/api/auth/demo"), staleTime: 5 * 60_000, retry: false });

/** Signs straight in as the chosen sample account, with that role's real permissions. */
export function useDemoLogin() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: (account: Key) => api.post<{ ok: true; home: string }>("/api/auth/demo-login", { account }),
    onSuccess: async (r) => {
      qc.clear();
      await qc.invalidateQueries({ queryKey: ["me"] });
      navigate(r.home ?? "/dashboard", { replace: true });
    },
  });
}

/** The four primary choices. Hospital Staff opens a second level with one entry per hospital. */
const primary: { group: Group; title: string; icon: React.ReactNode }[] = [
  { group: "hospital", title: "Hospital Staff", icon: <Hospital className="size-5" /> },
  { group: "transporter", title: "Transporter", icon: <Truck className="size-5" /> },
  { group: "plant", title: "Treatment Plant Staff", icon: <Factory className="size-5" /> },
  { group: "admin", title: "Main Admin", icon: <ShieldCheck className="size-5" /> },
];

/** One-click sign-in by role (only shown when the server runs with DEMO_MODE=true). */
export function DemoLogin({ variant = "panel" }: { variant?: "panel" | "landing" }) {
  const info = useDemoInfo();
  const login = useDemoLogin();
  const [open, setOpen] = useState<Group | null>(null);
  if (!info.data?.enabled) return null;
  const landing = variant === "landing";
  const accounts = info.data.accounts;
  const busyKey = login.isPending ? login.variables : null;
  const card = (key: string, title: string, sub: string, icon: React.ReactNode, onClick: () => void, extra?: Record<string, unknown>) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      disabled={login.isPending}
      className={clsx("lift flex w-full items-start gap-3 rounded-[14px] border bg-paper p-3.5 text-left disabled:cursor-wait", "border-line hover:border-emerald-500")}
      {...extra}
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-emerald-50 text-emerald-700">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{title}</span>
        <span className="block text-[12.5px] leading-snug text-ink-3">{sub}</span>
      </span>
    </button>
  );
  return (
    <section aria-labelledby="quick-title" className={clsx(!landing && "mt-10 rounded-[18px] border border-line bg-mist p-5")} data-testid="demo-roles">
      <h2 id="quick-title" className={clsx("font-bold", landing ? "text-[28px] font-extrabold md:text-[34px]" : "text-[17px]")}>
        {landing ? "Sign in as a role" : "Quick sign-in"}
      </h2>
      <p className={clsx("mt-1 text-ink-2", landing ? "max-w-[62ch] text-[15.5px]" : "text-sm")}>One click opens a sample organization with synthetic data. Each role sees only its own facility.</p>
      <div className={clsx("mt-4 grid items-start gap-2", landing ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-2")}>
        {primary.map((p) => {
          const members = accounts.filter((a) => a.group === p.group);
          if (!members.length) return null;
          if (p.group === "hospital") {
            const expanded = open === "hospital";
            return (
              <div key={p.group} className="flex flex-col gap-2">
                {card("hospital", p.title, "Choose Hospital A or Hospital B", p.icon, () => setOpen(expanded ? null : "hospital"), { "aria-expanded": expanded, "aria-controls": "hospital-choices", "data-demo": "hospital" })}
                {expanded && (
                  <div id="hospital-choices" className="ml-3 flex flex-col gap-2 border-l-2 border-emerald-200 pl-3 animate-rise-in" role="group" aria-label="Hospital staff accounts">
                    {members.map((a) => card(a.key, a.label, a.facility, busyKey === a.key ? <Loader2 className="size-5 animate-spin" /> : <Hospital className="size-5" />, () => login.mutate(a.key), { "data-demo": a.key }))}
                  </div>
                )}
              </div>
            );
          }
          const a = members[0];
          return card(a.key, p.title, a.facility, busyKey === a.key ? <Loader2 className="size-5 animate-spin" /> : p.icon, () => login.mutate(a.key), { "data-demo": a.key });
        })}
      </div>
      <div className="mt-3"><FormError error={login.error} /></div>
    </section>
  );
}
