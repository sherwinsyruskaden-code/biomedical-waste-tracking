import { Link } from "react-router";
import { Logo } from "../../components/AppShell";

export default function Terms() {
  return (
    <div className="min-h-dvh bg-paper">
      <div className="mx-auto max-w-[720px] px-5 py-10">
        <Link to="/"><Logo /></Link>
        <h1 className="mt-10 text-[34px] font-extrabold">Terms of use & privacy notice</h1>
        <p className="mt-2 text-ink-3">Academic project template — have it reviewed before real-world use.</p>
        <div className="mt-8 space-y-6 text-[15.5px] leading-relaxed text-ink-2 [&_h2]:mb-2 [&_h2]:text-[20px] [&_h2]:font-bold [&_h2]:text-ink">
          <section>
            <h2>What the service does</h2>
            <p>BWTS records the movement and custody of biomedical waste for your organization. It helps with traceability and record keeping. It does not certify compliance with any law or regulation, and records in it are not regulatory certificates.</p>
          </section>
          <section>
            <h2>What we store about people</h2>
            <p>Name, work email, optional phone number, role, and the actions you take (for example, who confirmed a pickup and when). Do not enter patient information — batches are described by ward or department only.</p>
          </section>
          <section>
            <h2>Location data</h2>
            <p>A transporter's device location is recorded only while that transporter has switched on location sharing for an active job. Sharing stops automatically when the job is completed or cancelled, and can be switched off at any time. Location history is visible only to admins, the transporter, and staff at the job's pickup and destination facilities, and is deleted after the retention period your admin sets (180 days by default).</p>
          </section>
          <section>
            <h2>Security</h2>
            <p>Passwords are stored as Argon2 hashes, sessions use HTTP-only cookies, and each organization's data is isolated from every other organization. Custody and audit history cannot be edited once written.</p>
          </section>
          <section>
            <h2>Your responsibilities</h2>
            <p>Admins configure waste categories, disposal methods and tracking settings to match the rules that apply to them, and make sure staff use the system accurately.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
