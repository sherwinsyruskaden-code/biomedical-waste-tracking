import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Bell, CheckCheck } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { Button, EmptyState, ErrorState, LoadingBlock, PageHeader, Pagination } from "../components/ui";
import { api, qs } from "../lib/api";
import { timeAgo } from "../lib/format";
import type { Paged } from "../lib/types";

interface Notification {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

/** The bell's list: requests and arrivals that concern you. */
export default function Notifications() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ["notifications", "list", page], queryFn: () => api.get<Paged<Notification> & { unread: number }>(`/api/notifications${qs({ page, pageSize: 30 })}`) });
  const read = useMutation({ mutationFn: (ids?: string[]) => api.post("/api/notifications/read", { ids }), onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }) });
  return (
    <>
      <PageHeader title="Notifications" actions={<Button variant="secondary" onClick={() => read.mutate(undefined)} disabled={!q.data?.unread} icon={<CheckCheck className="size-4" />}>Mark all read</Button>} />
      <div className="overflow-hidden rounded-[16px] border border-line bg-paper">
        {q.isLoading ? <div className="p-5"><LoadingBlock /></div> : q.isError ? <div className="p-5"><ErrorState error={q.error} /></div> : q.data!.items.length === 0 ? (
          <EmptyState icon={<Bell />} title="No notifications" />
        ) : (
          <>
            <ul className="divide-y divide-line">
              {q.data!.items.map((n) => {
                const body = (
                  <>
                    <span className={clsx("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-emerald-600")} aria-label={n.readAt ? undefined : "Unread"} />
                    <span className="min-w-0 flex-1">
                      <span className={clsx("block", !n.readAt && "font-semibold")}>{n.title}</span>
                      <span className="block text-sm text-ink-2">{n.body}</span>
                    </span>
                    <span className="shrink-0 text-[12.5px] text-ink-3">{timeAgo(n.createdAt)}</span>
                  </>
                );
                return (
                  <li key={n.id}>
                    {n.link ? (
                      <Link to={n.link} onClick={() => !n.readAt && read.mutate([n.id])} className="flex gap-3 px-5 py-3.5 hover:bg-mist">{body}</Link>
                    ) : (
                      <button onClick={() => !n.readAt && read.mutate([n.id])} className="flex w-full gap-3 px-5 py-3.5 text-left hover:bg-mist">{body}</button>
                    )}
                  </li>
                );
              })}
            </ul>
            <Pagination page={page} pageSize={30} total={q.data!.total} onPage={setPage} />
          </>
        )}
      </div>
    </>
  );
}
