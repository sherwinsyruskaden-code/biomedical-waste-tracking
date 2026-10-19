import * as Dialog from "@radix-ui/react-dialog";
import clsx from "clsx";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { forwardRef, useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { ApiError } from "../lib/api";
import { statusMeta } from "../lib/format";
import type { BatchStatus } from "../lib/types";

// ------------------------------------------------------------------ buttons
type Variant = "primary" | "scan" | "secondary" | "ghost" | "danger";
const variants: Record<Variant, string> = {
  primary: "bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800 shadow-[0_1px_0_rgb(4_120_87),0_6px_16px_-8px_rgb(5_150_105/0.7)]",
  scan: "bg-lime text-ink hover:bg-[#b8e81f] shadow-[0_1px_0_#8fb80d,0_6px_16px_-8px_rgb(143_184_13/0.8)]",
  secondary: "bg-paper text-ink border border-line-2 hover:border-emerald-600 hover:text-emerald-800",
  ghost: "text-ink-2 hover:bg-emerald-50 hover:text-emerald-800",
  danger: "bg-paper text-danger border border-danger/40 hover:bg-danger-soft",
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg"; loading?: boolean; icon?: ReactNode }>(
  function Button({ variant = "primary", size = "md", loading, icon, className, children, disabled, ...rest }, ref) {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={clsx(
          "inline-flex items-center justify-center gap-2 rounded-[10px] font-semibold transition-[color,background-color,border-color,box-shadow,transform] duration-150 motion-safe:active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-55 select-none whitespace-nowrap",
          size === "sm" && "h-8 px-3 text-[13px]",
          size === "md" && "h-10 px-4 text-sm",
          size === "lg" && "h-12 px-6 text-[15px]",
          variants[variant],
          className,
        )}
        {...rest}
      >
        {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
        {children}
      </button>
    );
  },
);

// ------------------------------------------------------------------ form fields
export function Field({ label, error, hint, children, htmlFor, required }: { label: string; error?: string; hint?: ReactNode; children: ReactNode; htmlFor?: string; required?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[13px] font-semibold text-ink-2">
        {label}
        {required && <span className="text-danger"> *</span>}
      </label>
      {children}
      {error ? (
        <p className="text-[13px] text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[12.5px] text-ink-3">{hint}</p>
      ) : null}
    </div>
  );
}

const inputBase = "w-full rounded-[10px] border bg-paper px-3 text-[14.5px] text-ink placeholder:text-ink-3/70 transition-colors focus:outline-none focus:ring-3 focus:ring-emerald-600/20 focus:border-emerald-600 disabled:bg-mist disabled:text-ink-3";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input({ invalid, className, ...rest }, ref) {
  return <input ref={ref} aria-invalid={invalid || undefined} className={clsx(inputBase, "h-10", invalid ? "border-danger" : "border-line-2", className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(function Select({ invalid, className, children, ...rest }, ref) {
  return (
    <select ref={ref} aria-invalid={invalid || undefined} className={clsx(inputBase, "h-10 pr-8 appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%233c4a43%22 stroke-width=%222.5%22><path d=%22m6 9 6 6 6-6%22/></svg>')] bg-[length:12px] bg-[right_12px_center] bg-no-repeat", invalid ? "border-danger" : "border-line-2", className)} {...rest}>
      {children}
    </select>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(function Textarea({ invalid, className, ...rest }, ref) {
  return <textarea ref={ref} aria-invalid={invalid || undefined} className={clsx(inputBase, "py-2 min-h-[84px]", invalid ? "border-danger" : "border-line-2", className)} {...rest} />;
});

export function Checkbox({ label, checked, onChange, id }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; id?: string }) {
  const gen = useId();
  const cid = id ?? gen;
  return (
    <label htmlFor={cid} className="flex items-start gap-2.5 text-sm text-ink-2 cursor-pointer">
      <input id={cid} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4 accent-emerald-600" />
      <span>{label}</span>
    </label>
  );
}

// ------------------------------------------------------------------ status & badges
const tones = {
  neutral: "bg-mist text-ink-2 ring-line-2",
  emerald: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  signal: "bg-signal-soft text-signal-deep ring-signal/25",
  lime: "bg-lime-soft text-ink ring-lime-deep/30",
  warn: "bg-warn-soft text-[#92400e] ring-warn/30",
  danger: "bg-danger-soft text-[#9f1239] ring-danger/30",
  ink: "bg-ink text-white ring-ink",
} as const;
export type Tone = keyof typeof tones;

export function Badge({ tone = "neutral", children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={clsx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12.5px] font-semibold ring-1 ring-inset whitespace-nowrap", tones[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: BatchStatus }) {
  const m = statusMeta[status];
  const prev = useRef(status);
  const changed = prev.current !== status; // pops when live data moves a batch to a new stage, not on first paint
  useEffect(() => {
    prev.current = status;
  }, [status]);
  return (
    <span className={clsx("inline-flex", changed && "animate-badge-in")}>
      <Badge tone={m.tone} dot>
        {m.label}
      </Badge>
    </span>
  );
}

/** Waste category colour chip — mirrors the physical bag/container colour. */
export function CategoryChip({ code, name, color, compact }: { code: string; name?: string; color: string; compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-ink">
      <span className="relative inline-block h-4 w-3 rounded-[3px] ring-1 ring-black/15" style={{ background: color }} aria-hidden>
        <span className="absolute inset-x-0 top-0 h-1 rounded-t-[3px] bg-black/20" />
      </span>
      {compact ? code : name ?? code}
    </span>
  );
}

// ------------------------------------------------------------------ layout pieces
export function PageHeader({ title, description, actions, back }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {back}
        <h1 className="text-[28px] font-bold md:text-[32px]">{title}</h1>
        {description && <p className="mt-1 max-w-[70ch] text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ title, actions, children, className, bodyClassName, id }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string; id?: string }) {
  return (
    <section id={id} className={clsx("rounded-[16px] border border-line bg-paper", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          {typeof title === "string" ? <h2 className="text-[17px] font-semibold">{title}</h2> : title}
          {actions}
        </header>
      )}
      <div className={clsx("p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      {icon && <div className="grid size-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">{icon}</div>}
      <h3 className="text-lg font-semibold">{title}</h3>
      {children && <div className="max-w-[48ch] text-sm text-ink-2">{children}</div>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof ApiError ? error.message : "Something went wrong while loading this.";
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-[16px] border border-danger/30 bg-danger-soft/40 px-6 py-10 text-center">
      <AlertTriangle className="size-6 text-danger" aria-hidden />
      <p className="font-semibold text-ink">{msg}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("animate-pulse rounded-lg bg-line/70", className)} aria-hidden />;
}

export function LoadingBlock({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-12" />
      ))}
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <nav className="flex items-center justify-between gap-3 border-t border-line px-5 py-3 text-sm text-ink-2" aria-label="Pagination">
      <span className="tabular">
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
      </span>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </nav>
  );
}

// ------------------------------------------------------------------ dialogs & drawers
export function Modal({ open, onOpenChange, title, description, children, wide }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[1000] bg-ink/40 backdrop-blur-[2px] data-[state=open]:animate-in" />
        <Dialog.Content
          className={clsx(
            "fixed left-1/2 top-1/2 z-[1001] max-h-[90vh] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[20px] bg-paper p-6 shadow-pop focus:outline-none",
            wide ? "max-w-2xl" : "max-w-lg",
          )}
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="font-display text-xl font-bold">{title}</Dialog.Title>
              {description ? <Dialog.Description className="mt-1 text-sm text-ink-2">{description}</Dialog.Description> : <Dialog.Description className="sr-only">{title}</Dialog.Description>}
            </div>
            <Dialog.Close className="rounded-lg p-1.5 text-ink-3 hover:bg-mist hover:text-ink" aria-label="Close">
              <X className="size-5" />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Drawer({ open, onOpenChange, title, children }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; children: ReactNode }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[1000] bg-ink/30" />
        <Dialog.Content className="fixed inset-y-0 right-0 z-[1001] flex w-full max-w-md flex-col bg-paper shadow-pop focus:outline-none">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <Dialog.Title className="font-display text-lg font-bold">{title}</Dialog.Title>
            <Dialog.Description className="sr-only">{title}</Dialog.Description>
            <Dialog.Close className="rounded-lg p-1.5 text-ink-3 hover:bg-mist hover:text-ink" aria-label="Close">
              <X className="size-5" />
            </Dialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto p-5">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Shows the API's own explanation (and field errors) for a failed mutation. */
export function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : "Something went wrong. Please try again.";
  return (
    <div role="alert" className="flex items-start gap-2 rounded-[10px] border border-danger/30 bg-danger-soft/50 px-3 py-2.5 text-sm text-[#9f1239]">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{msg}</span>
    </div>
  );
}

export const fieldError = (error: unknown, name: string) => (error instanceof ApiError ? error.fields[name] : undefined);
