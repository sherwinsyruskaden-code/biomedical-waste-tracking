import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Factory, Hospital, Loader2, ShieldCheck, Truck, UserCog } from "lucide-react";
import { useNavigate } from "react-router";
import { api } from "../lib/api";
import { FormError } from "./ui";

type Key = "staff" | "staffB" | "driver" | "plant" | "admin" | "platform";
interface DemoInfo {
  enabled: boolean;
  accounts: { key: Key; label: string; facility: string; description: string }[];
}

const icons: Record<Key, React.ReactNode> = {
  staff: <Hospital className="size-5" />,
  staffB: <Hospital className="size-5" />,
  driver: <Truck className="size-5" />,
  plant: <Factory className="size-5" />,
  admin: <UserCog className="size-5" />,
  platform: <ShieldCheck className="size-5" />,
};

export const useDemoInfo = () => useQuery({ queryKey: ["demo-info"], queryFn: () => api.get<DemoInfo>("/api/auth/demo"), staleTime: 5 * 60_000, retry: false });

/** Signs straight into the synthetic demo data as the chosen role, with that role's real permissions. */
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

/** One-click demo sign-in (only shown when the server runs with DEMO_MODE=true). */
export function DemoLogin({ variant = "panel" }: { variant?: "panel" | "landing" }) {
  const info = useDemoInfo();
  const login = useDemoLogin();
  if (!info.data?.enabled) return null;
  const landing = variant === "landing";
  return (
    <section aria-labelledby="demo-title" className={clsx(landing ? "" : "mt-10 rounded-[18px] border border-line bg-mist p-5")} data-testid="demo-roles">
      <h2 id="demo-title" className={clsx("font-bold", landing ? "text-[28px] md:text-[34px] font-extrabold" : "text-[17px]")}>
        {landing ? "Try it as any role" : "Try the demo"}
      </h2>
      <p className={clsx("mt-1 text-ink-2", landing ? "max-w-[62ch] text-[15.5px]" : "text-sm")}>
        One click signs you in to a demo organization filled with <strong>synthetic data</strong>. Each role has its own facility, dashboard and permissions.
      </p>
      <div className={clsx("mt-4 grid gap-2", landing ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2")}>
        {info.data.accounts.map((a) => {
          const busy = login.isPending && login.variables === a.key;
          return (
            <button
              key={a.key}
              type="button"
              onClick={() => login.mutate(a.key)}
              disabled={login.isPending}
              data-demo={a.key}
              className={clsx(
                "lift flex items-start gap-3 rounded-[14px] border bg-paper p-3.5 text-left disabled:cursor-wait",
                busy ? "border-emerald-600" : "border-line hover:border-emerald-500",
              )}
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-emerald-50 text-emerald-700">{busy ? <Loader2 className="size-5 animate-spin" /> : icons[a.key]}</span>
              <span className="min-w-0">
                <span className="block font-semibold">{a.label}</span>
                <span className="block truncate text-[12.5px] font-medium text-emerald-800">{a.facility}</span>
                <span className="block text-[12.5px] leading-snug text-ink-3">{busy ? "Signing in… the first time sets up demo data" : a.description}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-3"><FormError error={login.error} /></div>
    </section>
  );
}
