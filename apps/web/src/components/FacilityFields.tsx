import { LocateFixed } from "lucide-react";
import { useState } from "react";
import { Button, Checkbox, Field, Input, Select, fieldError } from "./ui";

export interface FacilityDraft {
  name: string;
  type: "generator" | "storage" | "treatment";
  canReceive: boolean;
  address: string;
  city: string;
  contactName: string;
  contactPhone: string;
  authorizationRef: string;
  latitude: string;
  longitude: string;
}

export const emptyFacility = (type: FacilityDraft["type"] = "generator"): FacilityDraft => ({
  name: "",
  type,
  canReceive: type === "treatment",
  address: "",
  city: "",
  contactName: "",
  contactPhone: "",
  authorizationRef: "",
  latitude: "",
  longitude: "",
});

export function facilityPayload(f: FacilityDraft) {
  const lat = f.latitude.trim() === "" ? null : Number(f.latitude);
  const lng = f.longitude.trim() === "" ? null : Number(f.longitude);
  return {
    name: f.name,
    type: f.type,
    canReceive: f.type === "treatment" ? true : f.canReceive,
    address: f.address,
    city: f.city || null,
    contactName: f.contactName || null,
    contactPhone: f.contactPhone || null,
    authorizationRef: f.authorizationRef || null,
    latitude: lat,
    longitude: lng,
  };
}

/** Facility form fields. `prefix` namespaces API field errors (e.g. "facility."). */
export function FacilityFields({ value, onChange, error, prefix = "", compact }: { value: FacilityDraft; onChange: (f: FacilityDraft) => void; error?: unknown; prefix?: string; compact?: boolean }) {
  const [geoMsg, setGeoMsg] = useState<string | null>(null);
  const set = <K extends keyof FacilityDraft>(k: K, v: FacilityDraft[K]) => onChange({ ...value, [k]: v });
  const fe = (k: string) => fieldError(error, prefix + k);
  const locate = () => {
    if (!navigator.geolocation) return setGeoMsg("This browser can't share location. Enter coordinates manually.");
    setGeoMsg("Getting your position…");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        onChange({ ...value, latitude: p.coords.latitude.toFixed(6), longitude: p.coords.longitude.toFixed(6) });
        setGeoMsg(`Set from this device (±${Math.round(p.coords.accuracy)} m). Only use this while you are at the facility.`);
      },
      (err) => setGeoMsg(err.code === 1 ? "Location permission was denied. Enter coordinates manually." : "Couldn't get a position. Enter coordinates manually."),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Facility name" htmlFor={`${prefix}fname`} error={fe("name")} required>
        <Input id={`${prefix}fname`} value={value.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. City General Hospital" />
      </Field>
      <Field label="Facility type" htmlFor={`${prefix}ftype`} error={fe("type")}>
        <Select id={`${prefix}ftype`} value={value.type} onChange={(e) => { const t = e.target.value as FacilityDraft["type"]; onChange({ ...value, type: t, canReceive: t === "treatment" ? true : value.canReceive }); }}>
          <option value="generator">Hospital / clinic / lab (generates waste)</option>
          <option value="storage">Intermediate storage point</option>
          <option value="treatment">Treatment plant (receives and treats waste)</option>
        </Select>
      </Field>
      <div className="sm:col-span-2">
        <Field label="Address" htmlFor={`${prefix}faddr`} error={fe("address")} required>
          <Input id={`${prefix}faddr`} value={value.address} onChange={(e) => set("address", e.target.value)} placeholder="Street, area" />
        </Field>
      </div>
      <Field label="City" htmlFor={`${prefix}fcity`}>
        <Input id={`${prefix}fcity`} value={value.city} onChange={(e) => set("city", e.target.value)} />
      </Field>
      {!compact && (
        <Field label="Authorisation / licence reference" htmlFor={`${prefix}fauth`} hint="Optional — as issued by your regulator.">
          <Input id={`${prefix}fauth`} value={value.authorizationRef} onChange={(e) => set("authorizationRef", e.target.value)} />
        </Field>
      )}
      {!compact && (
        <>
          <Field label="Contact person" htmlFor={`${prefix}fcn`}>
            <Input id={`${prefix}fcn`} value={value.contactName} onChange={(e) => set("contactName", e.target.value)} />
          </Field>
          <Field label="Contact phone" htmlFor={`${prefix}fcp`}>
            <Input id={`${prefix}fcp`} type="tel" value={value.contactPhone} onChange={(e) => set("contactPhone", e.target.value)} />
          </Field>
        </>
      )}
      <div className="grid gap-3 rounded-[12px] border border-dashed border-line-2 p-3 sm:col-span-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Field label="Latitude" htmlFor={`${prefix}flat`} error={fe("latitude")}>
          <Input id={`${prefix}flat`} inputMode="decimal" value={value.latitude} onChange={(e) => set("latitude", e.target.value)} placeholder="12.9249" />
        </Field>
        <Field label="Longitude" htmlFor={`${prefix}flng`} error={fe("longitude")}>
          <Input id={`${prefix}flng`} inputMode="decimal" value={value.longitude} onChange={(e) => set("longitude", e.target.value)} placeholder="80.1000" />
        </Field>
        <Button type="button" variant="secondary" onClick={locate} icon={<LocateFixed className="size-4" />}>
          Use my location
        </Button>
        <p className="text-[12.5px] text-ink-3 sm:col-span-3">{geoMsg ?? "Coordinates put the facility on the live map. You can add them later."}</p>
      </div>
      {value.type !== "treatment" && (
        <div className="sm:col-span-2">
          <Checkbox checked={value.canReceive} onChange={(v) => set("canReceive", v)} label="This facility is authorised to receive and dispose of waste from others" />
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ organization registration

/** What an organization registers with: a Hospital or a Lab only. (Treatment plants are added later in Facilities.) */
export interface RegistrationDraft {
  name: string;
  kind: "hospital" | "lab";
  registrationId: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  contactPhone: string;
  latitude: string;
  longitude: string;
}

export const emptyRegistration = (): RegistrationDraft => ({ name: "", kind: "hospital", registrationId: "", address: "", city: "", state: "", postalCode: "", contactPhone: "", latitude: "", longitude: "" });

export function registrationPayload(f: RegistrationDraft) {
  return {
    name: f.name,
    kind: f.kind,
    registrationId: f.registrationId,
    address: f.address,
    city: f.city,
    state: f.state,
    postalCode: f.postalCode,
    contactPhone: f.contactPhone || null,
    latitude: f.latitude.trim() === "" ? null : Number(f.latitude),
    longitude: f.longitude.trim() === "" ? null : Number(f.longitude),
  };
}

/** The registration facility form. `prefix` namespaces API field errors (e.g. "facility."). */
export function RegistrationFacilityFields({ value, onChange, error, prefix = "facility." }: { value: RegistrationDraft; onChange: (f: RegistrationDraft) => void; error?: unknown; prefix?: string }) {
  const [geoMsg, setGeoMsg] = useState<string | null>(null);
  const set = <K extends keyof RegistrationDraft>(k: K, v: RegistrationDraft[K]) => onChange({ ...value, [k]: v });
  const fe = (k: string) => fieldError(error, prefix + k);
  const locate = () => {
    if (!navigator.geolocation) return setGeoMsg("This browser can't share location. Enter coordinates manually.");
    setGeoMsg("Getting your position…");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        onChange({ ...value, latitude: p.coords.latitude.toFixed(6), longitude: p.coords.longitude.toFixed(6) });
        setGeoMsg(`Set from this device (±${Math.round(p.coords.accuracy)} m). Only use this while you are at the facility.`);
      },
      (err) => setGeoMsg(err.code === 1 ? "Location permission was denied. Enter coordinates manually." : "Couldn't get a position. Enter coordinates manually."),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Facility type" htmlFor={`${prefix}ftype`} error={fe("kind")} required>
        <Select id={`${prefix}ftype`} value={value.kind} onChange={(e) => set("kind", e.target.value as RegistrationDraft["kind"])}>
          <option value="hospital">Hospital</option>
          <option value="lab">Lab</option>
        </Select>
      </Field>
      <Field label="Facility name" htmlFor={`${prefix}fname`} error={fe("name")} required>
        <Input id={`${prefix}fname`} value={value.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. City General Hospital" />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Facility Registration ID" htmlFor={`${prefix}freg`} error={fe("registrationId")} hint="As on your registration certificate. It is recorded as entered; the reviewer compares it with your documents." required>
          <Input id={`${prefix}freg`} value={value.registrationId} onChange={(e) => set("registrationId", e.target.value)} autoComplete="off" />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Field label="Address" htmlFor={`${prefix}faddr`} error={fe("address")} required>
          <Input id={`${prefix}faddr`} value={value.address} onChange={(e) => set("address", e.target.value)} placeholder="Street, area" autoComplete="street-address" />
        </Field>
      </div>
      <Field label="City" htmlFor={`${prefix}fcity`} error={fe("city")} required>
        <Input id={`${prefix}fcity`} value={value.city} onChange={(e) => set("city", e.target.value)} autoComplete="address-level2" />
      </Field>
      <Field label="State" htmlFor={`${prefix}fstate`} error={fe("state")} required>
        <Input id={`${prefix}fstate`} value={value.state} onChange={(e) => set("state", e.target.value)} autoComplete="address-level1" />
      </Field>
      <Field label="Postal code" htmlFor={`${prefix}fpost`} error={fe("postalCode")} required>
        <Input id={`${prefix}fpost`} value={value.postalCode} onChange={(e) => set("postalCode", e.target.value)} autoComplete="postal-code" />
      </Field>
      <Field label="Contact phone" htmlFor={`${prefix}fcp`} error={fe("contactPhone")}>
        <Input id={`${prefix}fcp`} type="tel" value={value.contactPhone} onChange={(e) => set("contactPhone", e.target.value)} autoComplete="tel" />
      </Field>
      <div className="grid gap-3 rounded-[12px] border border-dashed border-line-2 p-3 sm:col-span-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Field label="Latitude" htmlFor={`${prefix}flat`} error={fe("latitude")}>
          <Input id={`${prefix}flat`} inputMode="decimal" value={value.latitude} onChange={(e) => set("latitude", e.target.value)} placeholder="12.9249" />
        </Field>
        <Field label="Longitude" htmlFor={`${prefix}flng`} error={fe("longitude")}>
          <Input id={`${prefix}flng`} inputMode="decimal" value={value.longitude} onChange={(e) => set("longitude", e.target.value)} placeholder="80.1000" />
        </Field>
        <Button type="button" variant="secondary" onClick={locate} icon={<LocateFixed className="size-4" />}>
          Use my location
        </Button>
        <p className="text-[12.5px] text-ink-3 sm:col-span-3">{geoMsg ?? "Coordinates put the facility on the live map. You can add them later."}</p>
      </div>
    </div>
  );
}
