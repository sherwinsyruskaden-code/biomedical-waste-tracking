import clsx from "clsx";
import { FileSpreadsheet, MapPinned, QrCode, ShieldCheck, Truck, UserCog, Warehouse } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { Link } from "react-router";
import { Logo } from "../components/AppShell";
import { useMe } from "../lib/session";

const stages = [
  { key: "generated", title: "Generated", who: "Facility staff", records: "Category, weight, ward, container count. A QR label is printed for every container." },
  { key: "segregated", title: "Segregated", who: "Facility staff", records: "Someone confirms the bag colour matches the waste and signs it off." },
  { key: "collected", title: "Collected", who: "Transporter", records: "The driver scans each container. Custody moves from the facility to the named driver." },
  { key: "in_transit", title: "In transit", who: "Transporter", records: "Phone GPS shares the vehicle's position, accuracy and time of every fix." },
  { key: "delivered", title: "Delivered", who: "Transporter", records: "Containers are scanned again at the gate and handed over to the plant." },
  { key: "received", title: "Received", who: "Plant staff", records: "Weight and condition are checked. Mismatches open an incident automatically." },
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

export default function Landing() {
  const { data: me } = useMe();
  const signedIn = !!me?.membership;
  return (
    <div className="min-h-dvh bg-paper">
      <header className="mx-auto flex max-w-[1200px] items-center justify-between px-5 py-5 md:px-8">
        <Logo />
        <nav className="flex items-center gap-2">
          {signedIn ? (
            <Link to="/dashboard" className="rounded-[10px] bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
              Open dashboard
            </Link>
          ) : (
            <>
              <Link to="/login" className="rounded-[10px] px-3 py-2 text-sm font-semibold text-ink-2 hover:bg-mist">
                Sign in
              </Link>
              <Link to="/signup" className="rounded-[10px] bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
                Create organization
              </Link>
            </>
          )}
        </nav>
      </header>

      <section className="mx-auto grid max-w-[1200px] items-center gap-10 px-5 pb-16 pt-6 md:px-8 lg:grid-cols-[1.05fr_1fr] lg:gap-14 lg:pb-24 lg:pt-12">
        <div>
          <h1 className="text-[44px] font-extrabold leading-[1.02] tracking-[-0.035em] md:text-[64px]">
            Every bag of biomedical waste, accounted for until it's destroyed.
          </h1>
          <p className="mt-6 max-w-[54ch] text-[17px] text-ink-2">
            Label containers with QR codes, record each handover with a scan, watch the collection vehicle on a live map, and keep an unbroken custody record from the ward to the treatment plant.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to={signedIn ? "/dashboard" : "/signup"} className="inline-flex h-12 items-center rounded-[12px] bg-emerald-600 px-6 font-semibold text-white shadow-[0_1px_0_#047857,0_10px_24px_-10px_rgb(5_150_105/0.8)] hover:bg-emerald-700">
              {signedIn ? "Open dashboard" : "Set up your organization"}
            </Link>
            <Link to="/login" className="inline-flex h-12 items-center rounded-[12px] border border-line-2 px-6 font-semibold text-ink hover:border-emerald-600">
              I have an invitation
            </Link>
          </div>
          <p className="mt-5 text-[13.5px] text-ink-3">Free to run on your own server. No card, no trial clock.</p>
        </div>
        <CustodyRail />
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
        <h2 className="max-w-[24ch] text-[32px] font-extrabold md:text-[40px]">Three roles. Nobody gets more access than their job needs.</h2>
        <div className="mt-10 grid gap-px overflow-hidden rounded-[20px] border border-line bg-line md:grid-cols-3">
          {[
            { icon: <UserCog />, role: "Admin", body: "Sets up facilities and waste categories, invites the team, assigns pickups and sees everything across the organization." },
            { icon: <Warehouse />, role: "Facility staff", body: "Registers and labels waste at their own facilities, confirms segregation, and receives and records disposal at the plant." },
            { icon: <Truck />, role: "Transporter", body: "Sees only their own jobs, scans containers at pickup and drop-off, and shares location while a job is active." },
          ].map((r) => (
            <div key={r.role} className="bg-paper p-7">
              <div className="flex items-center gap-3 text-emerald-700 [&_svg]:size-5">
                {r.icon}
                <h3 className="text-[19px] font-bold text-ink">{r.role}</h3>
              </div>
              <p className="mt-3 text-ink-2">{r.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-[1200px] px-5 pb-20 md:px-8">
        <div className="grid gap-8 rounded-[24px] bg-ink p-8 text-white md:grid-cols-[1fr_auto] md:items-center md:p-12">
          <div>
            <div className="flex items-center gap-2 text-lime">
              <ShieldCheck className="size-5" />
              <span className="font-semibold">Plain about its limits</span>
            </div>
            <p className="mt-3 max-w-[62ch] text-[16px] text-white/80">
              BWTS keeps accurate records; it doesn't certify compliance. Waste categories and alert thresholds are yours to configure for your jurisdiction. GPS follows the transporter's device, not the bag. RFID tags work once you connect a reader.
            </p>
          </div>
          <Link to={signedIn ? "/dashboard" : "/signup"} className="inline-flex h-12 items-center justify-center rounded-[12px] bg-lime px-6 font-semibold text-ink hover:bg-[#b8e81f]">
            {signedIn ? "Back to work" : "Create your workspace"}
          </Link>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-3 px-5 py-6 text-[13px] text-ink-3 md:px-8">
          <span>Biomedical Waste Tracking System — academic project</span>
          <Link to="/terms" className="hover:text-ink">Terms & privacy</Link>
        </div>
      </footer>
    </div>
  );
}
