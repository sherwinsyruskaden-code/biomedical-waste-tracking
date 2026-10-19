import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import {
  Bell,
  Building2,
  ClipboardCheck,
  ChevronDown,
  ClipboardList,
  FileBarChart,
  Inbox,
  LayoutDashboard,
  LogOut,
  Map,
  Menu,
  PackageCheck,
  QrCode,
  ScanLine,
  Settings,
  Truck,
  Users,
  X,
} from "lucide-react";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { api } from "../lib/api";
import { roleLabel } from "../lib/format";
import { useActor, useLiveEvents, useWorkplace } from "../lib/session";
import { Button, LoadingBlock } from "./ui";

export function Logo({ className, inverted }: { className?: string; inverted?: boolean }) {
  return (
    <span className={clsx("inline-flex items-center gap-2.5", className)}>
      <svg viewBox="0 0 64 64" className="size-8" aria-hidden>
        <rect width="64" height="64" rx="16" fill="#059669" />
        <path d="M18 40c6 4 22 4 28-6M22 22c6-6 18-6 22 4" stroke="#C6F432" strokeWidth="6" fill="none" strokeLinecap="round" />
        <circle cx="18" cy="40" r="5" fill="#fff" />
        <circle cx="44" cy="26" r="5" fill="#fff" />
      </svg>
      <span className={clsx("font-display text-[19px] font-extrabold tracking-tight", inverted ? "text-white" : "text-ink")}>
        bwts<span className="text-emerald-600">.</span>
      </span>
    </span>
  );
}

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  show: boolean;
  badge?: number;
}

export function AppShell() {
  const { me, role, isAdmin, isTransporter } = useActor();
  const work = useWorkplace();
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  useLiveEvents(true);
  useEffect(() => setNavOpen(false), [location.pathname]);

  const unread = useQuery({
    queryKey: ["notifications", "count"],
    queryFn: () => api.get<{ unread: number }>("/api/notifications?pageSize=1"),
    refetchInterval: 60_000,
  });

  const canReview = isAdmin && me.user.canReviewOrganizations;
  const pendingOrgs = useQuery({
    queryKey: ["platform", "pending-count"],
    queryFn: () => api.get<{ counts: { pending: number } }>("/api/platform/organizations?status=pending"),
    refetchInterval: 60_000,
    enabled: canReview,
  });
  const awaitingReceipt = useQuery({
    queryKey: ["batches", "awaiting-receipt-count"],
    queryFn: () => api.get<{ total: number }>("/api/batches?status=delivered&pageSize=1"),
    refetchInterval: 30_000,
    enabled: work.atPlant && !isAdmin,
  });
  const logout = useMutation({
    mutationFn: () => api.post("/api/auth/logout"),
    onSettled: () => {
      qc.clear();
      navigate("/login", { replace: true });
    },
  });
  const switchOrg = useMutation({
    mutationFn: (organizationId: string) => api.post("/api/auth/switch-organization", { organizationId }),
    onSuccess: () => {
      qc.clear();
      navigate("/dashboard");
    },
  });

  // Each role sees only the modules its job needs.
  const { atHospital, atPlant } = work;
  const isStaff = role === "facility_staff";
  const items: NavItem[] = [
    { to: "/dashboard", label: "Dashboard", icon: <LayoutDashboard />, show: true },
    { to: "/batches", label: "Waste batches", icon: <ClipboardList />, show: isAdmin || atHospital },
    { to: "/receiving", label: atPlant && !isAdmin ? "Arrivals & disposal" : "Receipt & disposal", icon: <PackageCheck />, show: isAdmin || atPlant, badge: awaitingReceipt.data?.total },
    { to: "/assignments", label: isTransporter ? "My collections" : isAdmin ? "Transport jobs" : atPlant && !atHospital ? "Incoming transfers" : "Collection requests", icon: <Truck />, show: true },
    { to: "/tracking", label: "Live map", icon: <Map />, show: isAdmin || isTransporter || atPlant },
    { to: "/reports", label: "Reports", icon: <FileBarChart />, show: !isTransporter },
    { to: "/team", label: "Team", icon: <Users />, show: isAdmin },
    { to: "/approvals", label: "Organization approvals", icon: <ClipboardCheck />, show: canReview, badge: pendingOrgs.data?.counts.pending },
    { to: "/facilities", label: isAdmin ? "Facilities & categories" : "My facility", icon: <Building2 />, show: isAdmin },
    { to: "/settings", label: "Settings", icon: <Settings />, show: true },
  ];
  const roleName = isStaff ? (atPlant && !atHospital ? "Treatment-plant staff" : atHospital && !atPlant ? "Hospital staff" : roleLabel[role]) : roleLabel[role];

  const nav = (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {items
        .filter((i) => i.show)
        .map((i) => (
          <NavLink
            key={i.to}
            to={i.to}
            className={({ isActive }) =>
              clsx(
                "group flex items-center gap-3 rounded-[10px] px-3 py-2 text-[14.5px] font-medium transition-colors [&_svg]:size-[18px]",
                isActive ? "bg-emerald-600 text-white" : "text-ink-2 hover:bg-emerald-50 hover:text-emerald-800",
              )
            }
          >
            {i.icon}
            <span className="flex-1">{i.label}</span>
            {!!i.badge && <span className="tabular rounded-full bg-danger px-1.5 text-[11.5px] font-bold text-white">{i.badge}</span>}
          </NavLink>
        ))}
    </nav>
  );

  const orgPanel = (
    <div className="rounded-[12px] border border-line bg-mist px-3 py-2.5">
      <p className="truncate text-[13.5px] font-semibold text-ink">{me.organization?.name}</p>
      <p className="text-[12.5px] text-ink-3">{roleName}</p>
      {isStaff && work.name && <p className="mt-0.5 truncate text-[12.5px] font-medium text-emerald-800" title={work.name} data-testid="workplace">{work.name}</p>}
    </div>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[260px_1fr]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[2000] focus:rounded-lg focus:bg-paper focus:px-3 focus:py-2">
        Skip to content
      </a>
      {/* Desktop sidebar */}
      <aside className="no-print sticky top-0 hidden h-dvh flex-col gap-5 border-r border-line bg-paper px-4 py-5 lg:flex">
        <Link to="/dashboard" className="px-1">
          <Logo />
        </Link>
        {orgPanel}
        <div className="flex-1 overflow-y-auto">{nav}</div>
      </aside>

      {/* Mobile nav drawer */}
      {navOpen && (
        <div className="fixed inset-0 z-[1500] lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setNavOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[280px] flex-col gap-5 bg-paper px-4 py-5 shadow-pop">
            <div className="flex items-center justify-between">
              <Logo />
              <button onClick={() => setNavOpen(false)} className="rounded-lg p-1.5 hover:bg-mist" aria-label="Close navigation">
                <X className="size-5" />
              </button>
            </div>
            {orgPanel}
            {nav}
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-col">
        <header className="no-print sticky top-0 z-[900] flex h-16 items-center gap-3 border-b border-line bg-paper/90 px-4 backdrop-blur md:px-8">
          <button className="rounded-lg p-2 hover:bg-mist lg:hidden" onClick={() => setNavOpen(true)} aria-label="Open navigation">
            <Menu className="size-5" />
          </button>
          <Link to="/dashboard" className="lg:hidden">
            <Logo />
          </Link>
          <div className="flex-1" />
          {(isTransporter || (work.atPlant && !isAdmin)) && (
            <Button variant="scan" onClick={() => navigate("/scan")} icon={<ScanLine className="size-[18px]" />}>
              <span className="hidden sm:inline">{isTransporter ? "Scan label" : "Scan Incoming Batch"}</span>
              <span className="sm:hidden">Scan</span>
            </Button>
          )}
          <Link to="/notifications" className="relative rounded-[10px] p-2.5 text-ink-2 hover:bg-mist" aria-label={`Notifications${unread.data?.unread ? `, ${unread.data.unread} unread` : ""}`}>
            <Bell className="size-5" />
            {!!unread.data?.unread && (
              <span className="tabular absolute right-1 top-1 grid min-w-[18px] place-items-center rounded-full bg-danger px-1 text-[10.5px] font-bold text-white">{unread.data.unread > 99 ? "99+" : unread.data.unread}</span>
            )}
          </Link>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger className="flex items-center gap-2 rounded-[10px] py-1.5 pl-1.5 pr-2 hover:bg-mist" aria-label="Account menu">
              <span className="grid size-8 place-items-center rounded-full bg-emerald-100 font-display text-sm font-bold text-emerald-800">
                {me.user.fullName
                  .split(" ")
                  .map((p) => p[0])
                  .slice(0, 2)
                  .join("")
                  .toUpperCase()}
              </span>
              <span className="hidden max-w-[140px] truncate text-sm font-semibold md:inline">{me.user.fullName}</span>
              <ChevronDown className="size-4 text-ink-3" />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content align="end" sideOffset={8} className="z-[1200] min-w-[240px] rounded-[14px] border border-line bg-paper p-1.5 shadow-pop">
                <div className="px-3 py-2">
                  <p className="text-sm font-semibold">{me.user.fullName}</p>
                  <p className="truncate text-[13px] text-ink-3">{me.user.email}</p>
                </div>
                <DropdownMenu.Separator className="my-1 h-px bg-line" />
                {me.memberships.filter((m) => m.status === "active").length > 1 && (
                  <>
                    <DropdownMenu.Label className="px-3 py-1 text-[12px] font-semibold text-ink-3">Switch organization</DropdownMenu.Label>
                    {me.memberships
                      .filter((m) => m.status === "active")
                      .map((m) => (
                        <DropdownMenu.Item
                          key={m.id}
                          disabled={m.organizationId === me.organization?.id}
                          onSelect={() => switchOrg.mutate(m.organizationId)}
                          className="cursor-pointer rounded-lg px-3 py-2 text-sm outline-none data-[disabled]:cursor-default data-[disabled]:font-semibold data-[disabled]:text-emerald-700 data-[highlighted]:bg-emerald-50"
                        >
                          {m.organizationName} <span className="text-ink-3">· {roleLabel[m.role]}</span>
                        </DropdownMenu.Item>
                      ))}
                    <DropdownMenu.Separator className="my-1 h-px bg-line" />
                  </>
                )}
                <DropdownMenu.Item onSelect={() => navigate("/settings?tab=account")} className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none data-[highlighted]:bg-emerald-50">
                  <Settings className="size-4" /> Account settings
                </DropdownMenu.Item>
                <DropdownMenu.Item onSelect={() => logout.mutate()} className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-danger outline-none data-[highlighted]:bg-danger-soft">
                  <LogOut className="size-4" /> Sign out
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </header>
        <main id="main" className="mx-auto w-full max-w-[1320px] flex-1 px-4 py-6 md:px-8 md:py-8">
          <Suspense fallback={<LoadingBlock rows={6} />}>
            <div key={location.pathname} className="animate-rise-in">
              <Outlet />
            </div>
          </Suspense>
        </main>
      </div>
    </div>
  );
}
