/**
 * QR scanner. Scanning is QR-only in the user interface:
 *  - the browser camera (needs HTTPS or localhost), or
 *  - a photo / screenshot of the label, when no camera is available.
 * In the demo organization only, a clearly labelled shortcut can stand in for the camera.
 *
 * RFID / NFC identifiers still exist in the backend (see docs/HARDWARE.md); they are simply not offered here.
 */
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { ImageUp, QrCode } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { api } from "../lib/api";
import { useMe } from "../lib/session";
import { Button, Select } from "./ui";

export interface ScanResult {
  method: "qr";
  value: string;
  /** "camera" = live camera; "manual_entry" = image upload; "simulated" = picked from a batch in the sample organization (no physical scan). */
  source: "camera" | "manual_entry" | "simulated";
}

function CameraScanner({ onResult, onUnavailable, paused }: { onResult: (r: ScanResult) => void; onUnavailable: (reason: string) => void; paused?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);
  const last = useRef<{ v: string; t: number }>({ v: "", t: 0 });
  const report = useRef(onUnavailable);
  report.current = onUnavailable;
  const emit = useRef(onResult);
  emit.current = onResult;
  useEffect(() => {
    if (paused) return;
    let scanner: { start: () => Promise<void>; stop: () => void; destroy: () => void } | null = null;
    let cancelled = false;
    const fail = (msg: string) => {
      if (cancelled) return;
      setError(msg);
      setStarting(false);
      report.current(msg);
    };
    (async () => {
      if (!window.isSecureContext) return fail("The camera only works on https:// or localhost. Open the app over HTTPS, or use one of the options below.");
      const { default: QrScanner } = await import("qr-scanner");
      if (cancelled || !videoRef.current) return;
      if (!(await QrScanner.hasCamera())) return fail("No camera was found on this device. Use one of the options below.");
      scanner = new QrScanner(
        videoRef.current,
        (res: { data: string }) => {
          const now = Date.now();
          if (res.data === last.current.v && now - last.current.t < 3000) return; // debounce repeat reads
          last.current = { v: res.data, t: now };
          navigator.vibrate?.(60);
          emit.current({ method: "qr", value: res.data, source: "camera" });
        },
        { preferredCamera: "environment", highlightScanRegion: true, highlightCodeOutline: true, maxScansPerSecond: 6, returnDetailedScanResult: true },
      );
      try {
        await scanner.start();
        if (!cancelled) setStarting(false);
      } catch (e) {
        fail(String(e).includes("NotAllowed") ? "Camera permission was denied. Allow camera access in the browser's site settings and reload, or use one of the options below." : "The camera couldn't be started (it may be in use by another app). Use one of the options below.");
      }
    })();
    return () => {
      cancelled = true;
      scanner?.stop();
      scanner?.destroy();
    };
  }, [paused]);
  return (
    <div className="relative overflow-hidden rounded-[16px] bg-ink">
      <video ref={videoRef} data-testid="scanner-video" className={clsx("aspect-[4/3] w-full object-cover", error && "hidden")} muted playsInline />
      {starting && !error && <p className="absolute inset-0 grid place-items-center text-sm text-white/80">Starting camera…</p>}
      {error && <p className="p-6 text-center text-sm text-white/90" role="alert">{error}</p>}
    </div>
  );
}

/** Reads a QR code from a photo or screenshot — a real QR decode, just without the live camera. */
function ImageUpload({ onResult }: { onResult: (r: ScanResult) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setMsg(null);
    try {
      const { default: QrScanner } = await import("qr-scanner");
      const res = await QrScanner.scanImage(file, { returnDetailedScanResult: true });
      onResult({ method: "qr", value: res.data, source: "manual_entry" });
    } catch {
      setMsg("No QR code was found in that image. Try a sharper, closer photo or a larger screenshot.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <div>
      <input ref={input} type="file" accept="image/*" className="sr-only" data-testid="scanner-image-input" aria-label="Choose an image containing a QR code" onChange={(e) => onFile(e.target.files?.[0])} />
      <Button type="button" variant="secondary" loading={busy} icon={<ImageUp className="size-4" />} onClick={() => input.current?.click()}>
        Scan a photo or screenshot
      </Button>
      {msg && <p className="mt-2 text-sm text-danger" role="alert">{msg}</p>}
    </div>
  );
}

interface BatchQrOption {
  batchId: string;
  trackingCode: string;
  status: string;
  labels: { label: string; payload: string }[];
}

/**
 * Sample organization only: choose a batch (newest first, so the one just registered is on top) and use ITS OWN
 * QR code without a camera. The result is marked as a simulated scan; it is never recorded as a physical one.
 */
function BatchQrPicker({ onResult }: { onResult: (r: ScanResult) => void }) {
  const q = useQuery({ queryKey: ["demo-labels"], queryFn: () => api.get<{ batches: BatchQrOption[] }>("/api/demo/labels"), retry: false });
  const [pick, setPick] = useState("");
  const items = (q.data?.batches ?? []).filter((b) => b.labels.length > 0);
  if (!items.length) return null;
  const chosen = items.find((b) => b.batchId === (pick || items[0].batchId))!;
  return (
    <div className="rounded-[14px] border border-dashed border-amber-400 bg-amber-50 p-3.5 text-sm" data-testid="batch-qr-picker">
      <p className="font-semibold text-amber-900">Use a batch's QR (simulated scan)</p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        <Select value={chosen.batchId} onChange={(e) => setPick(e.target.value)} aria-label="Batch" className="min-w-[14rem] flex-1">
          {items.map((b) => (
            <option key={b.batchId} value={b.batchId}>{b.trackingCode} · {b.status.replaceAll("_", " ")}</option>
          ))}
        </Select>
        <Button type="button" variant="secondary" onClick={() => onResult({ method: "qr", value: chosen.labels[0].payload, source: "simulated" })}>Use this batch's QR</Button>
      </div>
    </div>
  );
}

export function Scanner({ onResult, paused }: { onResult: (r: ScanResult) => void; paused?: boolean }) {
  const [, setUnavailable] = useState<string | null>(null);
  const { data: me } = useMe();
  const inSampleOrg = !!me?.features.demoOrg;
  return (
    <div className="flex flex-col gap-3">
      <CameraScanner onResult={onResult} onUnavailable={setUnavailable} paused={paused} />
      <p className="flex items-center gap-2 text-[13px] text-ink-3"><QrCode className="size-4 shrink-0" /> Hold a container's QR label inside the frame. It scans automatically.</p>
      <ImageUpload onResult={onResult} />
      {inSampleOrg && <BatchQrPicker onResult={onResult} />}
      <p className="text-[13px] text-ink-2">Using your batch QR? Open the QR code from the batch you created, then scan it here.</p>
    </div>
  );
}
