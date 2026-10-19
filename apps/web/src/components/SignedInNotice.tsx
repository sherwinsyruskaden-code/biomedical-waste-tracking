import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { api } from "../lib/api";

/** Shown on the sign-in / sign-up pages when this browser already has a session. */
export function SignedInNotice({ name }: { name: string }) {
  const qc = useQueryClient();
  const logout = useMutation({
    mutationFn: () => api.post("/api/auth/logout"),
    onSettled: () => {
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" }); // drop the previous user's cached data
      qc.setQueryData(["me"], null); // signed out right now; the live /me observer updates immediately
    },
  });
  return (
    <div role="status" data-testid="signed-in-notice" className="sticky top-0 z-40 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-[13.5px] text-emerald-900">
      <span>This browser is signed in as <strong>{name}</strong>. Signing in or creating an organization below replaces that session.</span>
      <span className="flex gap-3 font-semibold">
        <Link to="/dashboard" className="underline underline-offset-2">Open dashboard</Link>
        <button type="button" onClick={() => logout.mutate()} disabled={logout.isPending} className="underline underline-offset-2">Sign out</button>
      </span>
    </div>
  );
}
