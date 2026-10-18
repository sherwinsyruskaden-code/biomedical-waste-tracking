import { Link, useRouteError } from "react-router";
import { Logo } from "../components/AppShell";

export function NotFound({ inApp }: { inApp?: boolean }) {
  const body = (
    <div className="flex flex-col items-start gap-3 py-16">
      <p className="font-display text-[64px] font-extrabold leading-none text-emerald-600">404</p>
      <h1 className="text-2xl font-bold">This page doesn't exist</h1>
      <p className="max-w-[50ch] text-ink-2">The link may be mistyped, or the record may belong to a different organization.</p>
      <Link to={inApp ? "/dashboard" : "/"} className="mt-2 rounded-[10px] bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700">
        {inApp ? "Go to dashboard" : "Go to home page"}
      </Link>
    </div>
  );
  if (inApp) return body;
  return (
    <div className="mx-auto max-w-[900px] px-5 py-8">
      <Logo />
      {body}
    </div>
  );
}

export function RouteError() {
  const err = useRouteError() as Error | undefined;
  return (
    <div className="mx-auto max-w-[900px] px-5 py-8">
      <Logo />
      <div className="py-16">
        <h1 className="text-2xl font-bold">Something broke on this screen</h1>
        <p className="mt-2 max-w-[60ch] text-ink-2">Reload the page to try again. If it keeps happening, note what you were doing and tell your administrator.</p>
        {import.meta.env.DEV && err?.message && <pre className="mt-4 overflow-auto rounded-lg bg-mist p-3 text-xs">{err.message}</pre>}
        <button onClick={() => location.reload()} className="mt-5 rounded-[10px] bg-emerald-600 px-4 py-2 font-semibold text-white">Reload</button>
      </div>
    </div>
  );
}
