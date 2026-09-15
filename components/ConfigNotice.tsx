import { MISSING_ENV_MESSAGE } from "@/lib/api";

export default function ConfigNotice() {
  return (
    <section
      className="rounded-2xl border border-amber-400/35 bg-amber-400/8 p-5 sm:p-6"
      role="status"
      aria-live="polite"
    >
      <p className="text-sm font-semibold text-amber-100">Model API URL is not configured</p>
      <p className="mt-2 text-sm leading-relaxed text-amber-50/85">
        Set <code className="font-mono text-[13px]">NEXT_PUBLIC_API_URL</code> to the API{" "}
        <strong className="font-semibold">base</strong> URL (no{" "}
        <code className="font-mono text-[13px]">/predict</code> suffix). The app will call{" "}
        <code className="font-mono text-[13px]">/health</code>,{" "}
        <code className="font-mono text-[13px]">/predict</code>, and{" "}
        <code className="font-mono text-[13px]">/predict_batch</code> on that host.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-amber-400/20 bg-canvas/40 p-4">
          <p className="text-xs font-semibold tracking-wide text-amber-100 uppercase">Local</p>
          <p className="mt-2 text-sm text-amber-50/80">
            Add the variable to <code className="font-mono text-[13px]">.env.local</code> and restart{" "}
            <code className="font-mono text-[13px]">npm run dev</code>.
          </p>
        </div>
        <div className="rounded-xl border border-amber-400/20 bg-canvas/40 p-4">
          <p className="text-xs font-semibold tracking-wide text-amber-100 uppercase">Vercel</p>
          <p className="mt-2 text-sm text-amber-50/80">
            Project → Settings → Environment Variables, then{" "}
            <strong className="font-semibold">redeploy</strong>. Changing the value without a new
            build has no effect.
          </p>
        </div>
      </div>

      <p className="mt-4 text-xs leading-relaxed text-amber-100/70">{MISSING_ENV_MESSAGE}</p>
    </section>
  );
}
