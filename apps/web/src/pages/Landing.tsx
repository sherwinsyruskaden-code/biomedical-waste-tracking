import clsx from "clsx";
import { BadgeCheck, Factory, FileSpreadsheet, Hospital, MapPinned, QrCode, Truck, UserCog } from "lucide-react";
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import { useState } from "react";
import { Link } from "react-router";
import { Logo } from "../components/AppShell";
import { useMe } from "../lib/session";
import { DemoLogin } from "../components/DemoLogin";

const stages = [
  { key: "generated", title: "Generated", who: "Hospital staff", records: "Category, weight, ward, container count. A QR label is printed for every container." },
  { key: "segregated", title: "Segregated", who: "Hospital staff", records: "Someone confirms the bag colour matches the waste, then requests collection to the treatment plant." },
  { key: "collected", title: "Collected", who: "Transporter", records: "The transporter accepts the request and scans at pickup. Custody moves from the hospital to the named driver." },
  { key: "in_transit", title: "In transit", who: "Transporter", records: "Phone GPS shares the vehicle's position, accuracy and time of every fix." },
  { key: "delivered", title: "Arrived", who: "Transporter", records: "The transporter records arrival at the plant. The batch now shows Arrived — awaiting receipt." },
  { key: "received", title: "Received", who: "Plant staff", records: "Plant staff scan the batch's QR, confirm receipt, and record the weight and condition of what arrived." },
  { key: "disposed", title: "Disposed", who: "Plant staff", records: "Treatment method, quantity and the plant's own log reference close the record." },
];

const bagColors = ["#EAB308", "#DC2626", "#64748B", "#2563EB"];

function CustodyRail() {
  const [active, setActive] = useState(3);
  const reduce = useReducedMotion();
  const s = stages[active];
  return (
    <div className="rounded-[24px] border border-line bg-paper p-5 shadow-lift md:p-7">
      <div className="flex items-center justify-between">
        <p className="font-display text-[15px] font-semibold text-ink">How one batch moves</p>
        <span className="text-[12.5px] text-ink-3">Tap a stage</span>
      </div>
      <ol className="relative mt-6 grid grid-cols-7 gap-1" aria-label="Lifecycle stages">
        <div className="absolute left-[7%] right-[7%] top-[15px] h-[3px] rounded-full bg-line" aria-hidden />
        <motion.div
          className="absolute left-[7%] top-[15px] h-[3px] rounded-full bg-emerald-600"
          aria-hidden
          initial={false}
          animate={{ width: `${(active / (stages.length - 1)) * 86}%` }}
          transition={{ duration: reduce ? 0 : 0.45, ease: [0.3, 0.7, 0.3, 1] }}
        />
        {stages.map((st, i) => (
          <li key={st.key} className="relative flex flex-col items-center">
            <button
              onClick={() => setActive(i)}
              aria-pressed={i === active}
              aria-label={st.title}
              className={clsx(
                "relative z-10 grid size-8 place-items-center rounded-full border-[3px] transition-colors",
                i < active && "border-emerald-600 bg-emerald-600",
                i === active && "border-emerald-600 bg-lime",
                i > active && "border-line-2 bg-paper hover:border-emerald-500",
              )}
            >
              {i === active && !reduce && <span className="absolute inset-0 rounded-full bg-lime animate-pulse-ring" aria-hidden />}
              {i < active && <svg viewBox="0 0 12 12" className="size-3 text-white" aria-hidden><path d="M2.5 6.5 5 9l4.5-6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" /></svg>}
            </button>
            <span className={clsx("mt-2 hidden text-center text-[11.5px] font-semibold leading-tight sm:block", i === active ? "text-ink" : "text-ink-3")}>{st.title}</span>
          </li>
        ))}
      </ol>
      <motion.div key={s.key} initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} className="mt-6 rounded-[16px] bg-mist p-5">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-[22px] font-bold">{s.title}</h3>
          <span className="rounded-full bg-paper px-2.5 py-0.5 text-[12.5px] font-semibold text-emerald-800 ring-1 ring-emerald-200">{s.who}</span>
        </div>
        <p className="mt-2 text-[15px] text-ink-2">{s.records}</p>
        <div className="mt-4 flex items-center gap-1.5" aria-hidden>
          {bagColors.map((c, i) => (
            <span key={c} className="h-5 w-4 rounded-[4px] ring-1 ring-black/10" style={{ background: c, opacity: i === active % 4 ? 1 : 0.35 }} />
          ))}
          <span className="ml-2 text-[12.5px] text-ink-3">Category colours follow your configured scheme</span>
        </div>
      </motion.div>
    </div>
  );
}

/** A little depth: the card tilts a few degrees toward the pointer. Off for reduced motion and touch screens. */
function Tilt({ children }: { children: React.ReactNode }) {
  const reduce = useReducedMotion();
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const sx = useSpring(px, { stiffness: 150, damping: 18 });
  const sy = useSpring(py, { stiffness: 150, damping: 18 });
  const rotateY = useTransform(sx, [-0.5, 0.5], [-4, 4]);
  const rotateX = useTransform(sy, [-0.5, 0.5], [3, -3]);
  if (reduce) return <>{children}</>;
  return (
    <div style={{ perspective: 1100 }}>
      <motion.div
        style={{ rotateX, rotateY, transformStyle: "preserve-3d" }}
        onPointerMove={(e) => {
          if (e.pointerType !== "mouse") return;
          const r = e.currentTarget.getBoundingClientRect();
          px.set((e.clientX - r.left) / r.width - 0.5);
          py.set((e.clientY - r.top) / r.height - 0.5);
        }}
        onPointerLeave={() => {
          px.set(0);
          py.set(0);
        }}
      >
        {children}
      </motion.div>
    </div>
  );
}

export default function Landing() {
  const reduceMotion = useReducedMotion();
  const { data: me } = useMe();
  const signedIn = !!me?.membership;
  return (
    <div className="min-h-dvh bg-paper">
      <header className="mx-auto flex max-w-[1200px] items-center justify-between px-5 py-5 md:px-8">
        <Logo />
        <nav className="flex items-center gap-2">
          {signedIn && (
            <Link to="/dashboard" className="rounded-[10px] border border-emerald-600 px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50">
              Open dashboard
            </Link>
          )}
          <Link to="/login" className="rounded-[10px] px-3 py-2 text-sm font-semibold text-ink-2 hover:bg-mist">
            Sign in
          </Link>
          <Link to="/signup" className="rounded-[10px] bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
            Create an account
          </Link>
        </nav>
      </header>

      <section className="mx-auto grid max-w-[1200px] items-center gap-10 px-5 pb-16 pt-6 md:px-8 lg:grid-cols-[1.05fr_1fr] lg:gap-14 lg:pb-24 lg:pt-12">
        <motion.div initial={reduceMotion ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.22, 0.8, 0.3, 1] }}>
          <h1 className="text-[44px] font-extrabold leading-[1.02] tracking-[-0.035em] md:text-[64px]">
            Every bag of biomedical waste, accounted for until it's destroyed.
          </h1>
          <p className="mt-6 max-w-[54ch] text-[17px] text-ink-2">
            Label containers with QR codes, record each handover with a scan, watch the collection vehicle on a live map, and keep an unbroken custody record from the ward to the treatment plant.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
            <Link to="/signup" className="inline-flex h-12 items-center rounded-[12px] bg-emerald-600 px-6 font-semibold text-white shadow-[0_1px_0_#047857,0_10px_24px_-10px_rgb(5_150_105/0.8)] hover:bg-emerald-700">
              Create an account
            </Link>
            <p className="text-[14.5px] text-ink-2">
              Already have an invitation?{" "}
              <Link to="/invite" className="font-semibold text-emerald-700 underline decoration-emerald-300 underline-offset-4 hover:decoration-emerald-700">Accept invitation</Link>
            </p>
          </div>
          {signedIn && (
            <p className="mt-5 text-[14.5px] text-ink-2" data-testid="signed-in-note">
              You're signed in as <strong>{me?.user.fullName}</strong>.{" "}
              <Link to="/dashboard" className="font-semibold text-emerald-700 underline decoration-emerald-300 underline-offset-4 hover:decoration-emerald-700">Open your dashboard</Link>
            </p>
          )}
        </motion.div>
        <Tilt>
          <CustodyRail />
        </Tilt>
      </section>

      <section id="demo" className="mx-auto max-w-[1200px] px-5 pb-16 md:px-8">
        <DemoLogin variant="landing" />
      </section>

      <section className="border-y border-line bg-mist">
        <div className="mx-auto grid max-w-[1200px] gap-10 px-5 py-16 md:grid-cols-3 md:px-8">
          {[
            { icon: <QrCode />, title: "Labels that can't be guessed", body: "Each container gets a QR code holding only a random reference. Scanning it shows the batch to people in your organization — nobody else." },
            { icon: <MapPinned />, title: "Where the waste is, and how fresh that is", body: "Transporters share their phone's GPS during a job. The map shows the last fix, its accuracy and when it arrived — and flags it when it goes stale." },
            { icon: <FileSpreadsheet />, title: "Records you can hand to an inspector", body: "Custody history can't be edited after the fact. Export registers, transport performance and disposal records as CSV or PDF." },
          ].map((f) => (
            <div key={f.title}>
              <div className="grid size-11 place-items-center rounded-[12px] bg-paper text-emerald-700 ring-1 ring-line [&_svg]:size-5">{f.icon}</div>
              <h2 className="mt-4 text-[21px] font-bold">{f.title}</h2>
              <p className="mt-2 text-ink-2">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-[1200px] px-5 py-16 md:px-8">
        <h2 className="max-w-[24ch] text-[32px] font-extrabold md:text-[40px]">Each role sees its own facility. Nobody gets more access than their job needs.</h2>
        <div className="mt-10 grid grid-cols-1 gap-px overflow-hidden rounded-[20px] border border-line bg-line md:grid-cols-2 lg:grid-cols-6" data-testid="role-cards">
          {[
            { icon: <Hospital />, role: "Hospital staff", body: "Register and label waste at their own hospital, confirm segregation and request collection. They never see another hospital's batches." },
            { icon: <Truck />, role: "Transporter", body: "See only the collections assigned to them — origin hospital and destination plant — scan at pickup, record arrival, and share location while driving." },
            { icon: <Factory />, role: "Treatment-plant staff", body: "See waste heading to their plant, scan the arriving batch, confirm receipt and custody, and record treatment or disposal." },
            { icon: <UserCog />, role: "Main Admin", body: "Manages the organization's facilities, team, waste categories and settings, and sees its operations end to end. Approving new organizations needs a separate review permission." },
            { icon: <BadgeCheck />, role: "Approval first", body: "New organizations stay pending until an authorised reviewer approves them, so only checked hospitals, plants and transport operators can operate." },
          ].map((r, n) => (
            <div key={r.role} className={`h-full bg-paper p-7 ${["lg:col-span-2", "lg:col-span-2", "lg:col-span-2", "lg:col-span-3", "md:col-span-2 lg:col-span-3"][n]}`}>
              <div className="flex items-center gap-3 text-emerald-700 [&_svg]:size-5">
                {r.icon}
                <h3 className="text-[19px] font-bold text-ink">{r.role}</h3>
              </div>
              <p className="mt-3 text-ink-2">{r.body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-3 px-5 py-6 text-[13px] text-ink-3 md:px-8">
          <span>Biomedical Waste Tracking System</span>
          <Link to="/terms" className="hover:text-ink">Terms & Privacy</Link>
        </div>
      </footer>
    </div>
  );
}
