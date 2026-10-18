import type { ReactNode } from "react";
import { Link } from "react-router";
import { Logo } from "../../components/AppShell";

export function AuthLayout({ title, subtitle, children, aside }: { title: string; subtitle?: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="grid min-h-dvh bg-paper lg:grid-cols-[1fr_minmax(380px,0.8fr)]">
      <div className="flex flex-col px-5 py-6 md:px-12">
        <Link to="/" className="w-fit">
          <Logo />
        </Link>
        <div className="mx-auto flex w-full max-w-[460px] flex-1 flex-col justify-center py-10">
          <h1 className="text-[32px] font-extrabold">{title}</h1>
          {subtitle && <p className="mt-2 text-ink-2">{subtitle}</p>}
          <div className="mt-8">{children}</div>
        </div>
      </div>
      <aside className="relative hidden overflow-hidden bg-emerald-700 lg:block">
        <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox="0 0 400 800" aria-hidden>
          <path d="M60 820 C 80 600, 320 620, 300 420 S 80 200, 200 -20" stroke="#C6F432" strokeWidth="3" fill="none" strokeDasharray="2 12" strokeLinecap="round" />
          <circle cx="300" cy="420" r="9" fill="#C6F432" />
          <circle cx="300" cy="420" r="22" fill="none" stroke="#C6F432" strokeOpacity=".4" strokeWidth="2" />
        </svg>
        <div className="relative flex h-full flex-col justify-end p-12 text-white">
          {aside ?? (
            <>
              <p className="font-display text-[30px] font-bold leading-tight">Scan at every handover. Know who has it, and where.</p>
              <p className="mt-3 max-w-[40ch] text-white/75">Custody records are written once and never edited, so the history you see is the history that happened.</p>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
