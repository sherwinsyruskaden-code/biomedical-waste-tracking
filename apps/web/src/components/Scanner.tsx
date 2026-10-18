/**
 * Scan sources. Every source produces the same result shape, which the backend resolves
 * through one endpoint — the lifecycle never knows which hardware was used.
 *
 *  - Camera QR      : works on phones/laptops with a camera (needs HTTPS or localhost).
 *  - RFID reader    : USB/Bluetooth "keyboard wedge" readers type the tag ID followed by Enter.
 *                     Any such reader works; tested here only by typing, not with hardware.
 *  - NFC (Web NFC)  : Android Chrome only. Untested on hardware in this project.
 *  - Type it        : manual entry of the label URL / token or a tag ID.
 */
import clsx from "clsx";
import { Camera, Keyboard, Nfc, Radio } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, Input, Select } from "./ui";

export interface ScanResult {
  method: "qr" | "rfid" | "nfc";
  value: string;
  source: "camera" | "keyboard_wedge" | "web_nfc" | "manual_entry";
}

type Mode = "camera" | "rfid" | "nfc" | "manual";

const hasWebNfc = typeof window !== "undefined" && "NDEFReader" in window;

function CameraScanner({ onResult, paused }: { onResult: (r: ScanResult) => void; paused?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);
  const last = useRef<{ v: string; t: number }>({ v: "", t: 0 });
  useEffect(() => {
    if (paused) return;
    let scanner: { start: () => Promise<void>; stop: () => void; destroy: () => void } | null = null;
    let cancelled = false;
    (async () => {
      if (!window.isSecureContext) {
        setError("The camera only works on https:// or localhost. Use “Type it” instead, or open the app over HTTPS.");
        setStarting(false);
        return;
      }
      const { default: QrScanner } = await import("qr-scanner");
      if (cancelled || !videoRef.current) return;
      if (!(await QrScanner.hasCamera())) {
        setError("No camera found on this device. Use “Type it” instead.");
        setStarting(false);
        return;
      }
      scanner = new QrScanner(
        videoRef.current,
        (res: { data: string }) => {
          const now = Date.now();
          if (res.data === last.current.v && now - last.current.t < 3000) return; // debounce repeat reads
          last.current = { v: res.data, t: now };
          navigator.vibrate?.(60);
          onResult({ method: "qr", value: res.data, source: "camera" });
        },
        { preferredCamera: "environment", highlightScanRegion: true, highlightCodeOutline: true, maxScansPerSecond: 6, returnDetailedScanResult: true },
      );
      try {
        await scanner.start();
      } catch (e) {
        setError(String(e).includes("NotAllowed") ? "Camera permission was denied. Allow camera access in the browser's site settings, or use “Type it”." : "Couldn't start the camera. Use “Type it” instead.");
      }
      setStarting(false);
    })();
    return () => {
      cancelled = true;
      scanner?.stop();
      scanner?.destroy();
    };
  }, [onResult, paused]);
  return (
    <div className="relative overflow-hidden rounded-[16px] bg-ink">
      <video ref={videoRef} className={clsx("aspect-[4/3] w-full object-cover", error && "hidden")} muted playsInline />
      {starting && !error && <p className="absolute inset-0 grid place-items-center text-sm text-white/80">Starting camera…</p>}
      {error && <p className="p-6 text-center text-sm text-white/90" role="alert">{error}</p>}
    </div>
  );
}

function RfidWedge({ onResult }: { onResult: (r: ScanResult) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [v, setV] = useState("");
  useEffect(() => ref.current?.focus(), []);
  // Not a <form>: scanners are rendered inside other forms (action dialogs), and nested forms
  // would submit the outer one.
  const submit = () => {
    if (v.trim()) onResult({ method: "rfid", value: v.trim(), source: "keyboard_wedge" });
    setV("");
  };
  return (
    <div className="flex flex-col gap-3 rounded-[16px] border border-dashed border-signal/50 bg-signal-soft/50 p-5">
      <p className="text-sm text-ink-2">
        Keep this box focused and present the tag to a <strong>USB or Bluetooth RFID reader in keyboard mode</strong>. The reader types the tag ID and presses Enter. You can also type an EPC/UID by hand.
      </p>
      <Input ref={ref} value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }} placeholder="Waiting for reader… (e.g. E280 1160 6000 0205)" className="font-mono" aria-label="RFID tag ID" />
      <Button type="button" variant="secondary" onClick={submit}>Look up tag</Button>
    </div>
  );
}

function WebNfc({ onResult }: { onResult: (r: ScanResult) => void }) {
  const [state, setState] = useState<"idle" | "listening" | "error">("idle");
  const [msg, setMsg] = useState<string>("");
  const start = async () => {
    try {
      // @ts-expect-error Web NFC is not in the TS DOM lib yet
      const reader = new window.NDEFReader();
      await reader.scan();
      setState("listening");
      setMsg("Hold the tag against the back of your phone.");
      reader.onreading = (ev: { serialNumber: string }) => onResult({ method: "nfc", value: ev.serialNumber, source: "web_nfc" });
      reader.onreadingerror = () => setMsg("Couldn't read that tag. Try again.");
    } catch (e) {
      setState("error");
      setMsg(String(e).includes("NotAllowed") ? "NFC permission was denied." : "NFC couldn't start on this device.");
    }
  };
  if (!hasWebNfc)
    return (
      <p className="rounded-[16px] bg-mist p-5 text-sm text-ink-2">
        Web NFC is only available in Chrome on Android. On other devices, use an NFC reader in keyboard mode with the RFID option, or type the tag UID.
      </p>
    );
  return (
    <div className="flex flex-col gap-3 rounded-[16px] bg-mist p-5">
      <p className="text-sm text-ink-2">Reads the tag's serial number (UID). This path has not been tested with hardware in this project.</p>
      {state !== "listening" && <Button onClick={start} variant="secondary" icon={<Nfc className="size-4" />}>Start NFC scan</Button>}
      {msg && <p className="text-sm font-semibold" role="status">{msg}</p>}
    </div>
  );
}

function Manual({ onResult }: { onResult: (r: ScanResult) => void }) {
  const [method, setMethod] = useState<ScanResult["method"]>("qr");
  const [v, setV] = useState("");
  const submit = () => {
    if (v.trim()) onResult({ method, value: v.trim(), source: "manual_entry" });
  };
  return (
    <div className="flex flex-col gap-3 rounded-[16px] bg-mist p-5">
      <div className="grid gap-2 sm:grid-cols-[140px_1fr]">
        <Select value={method} onChange={(e) => setMethod(e.target.value as ScanResult["method"])} aria-label="Identifier type">
          <option value="qr">QR label</option>
          <option value="rfid">RFID tag</option>
          <option value="nfc">NFC tag</option>
        </Select>
        <Input value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }} placeholder={method === "qr" ? "Paste the label link or code" : "Tag ID (hex)"} aria-label="Identifier" className="font-mono" />
      </div>
      <Button type="button" variant="secondary" onClick={submit}>Look up</Button>
    </div>
  );
}

export function Scanner({ onResult, paused, defaultMode = "camera" }: { onResult: (r: ScanResult) => void; paused?: boolean; defaultMode?: Mode }) {
  const [mode, setMode] = useState<Mode>(defaultMode);
  const tabs: { id: Mode; label: string; icon: React.ReactNode }[] = [
    { id: "camera", label: "Camera", icon: <Camera className="size-4" /> },
    { id: "rfid", label: "RFID reader", icon: <Radio className="size-4" /> },
    { id: "nfc", label: "NFC", icon: <Nfc className="size-4" /> },
    { id: "manual", label: "Type it", icon: <Keyboard className="size-4" /> },
  ];
  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" aria-label="Scan method" className="grid grid-cols-4 gap-1 rounded-[12px] bg-mist p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={mode === t.id}
            onClick={() => setMode(t.id)}
            className={clsx("flex items-center justify-center gap-1.5 rounded-[9px] px-2 py-2 text-[13px] font-semibold transition-colors", mode === t.id ? "bg-paper text-ink shadow-sm" : "text-ink-3 hover:text-ink")}
          >
            {t.icon}
            <span className="hidden sm:inline">{t.label}</span>
          </button>
        ))}
      </div>
      {mode === "camera" && <CameraScanner onResult={onResult} paused={paused} />}
      {mode === "rfid" && <RfidWedge onResult={onResult} />}
      {mode === "nfc" && <WebNfc onResult={onResult} />}
      {mode === "manual" && <Manual onResult={onResult} />}
    </div>
  );
}
