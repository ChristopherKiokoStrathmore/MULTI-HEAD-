import { MISSING_ENV_MESSAGE } from "@/lib/api";

export default function ConfigNotice() {
  return (
    <section className="sheet" role="status" aria-live="polite">
      <p className="text-[15px] font-medium tracking-tight text-ink">Model API URL is not configured</p>
      <p className="mt-2 text-[14px] leading-relaxed text-muted">
        Set <code className="font-mono text-[13px] text-ink/80">NEXT_PUBLIC_API_URL</code> to the API{" "}
        <strong className="font-medium text-ink">base</strong> URL (no{" "}
        <code className="font-mono text-[13px] text-ink/80">/predict</code> suffix). The app will call{" "}
        <code className="font-mono text-[13px] text-ink/80">/health</code>,{" "}
        <code className="font-mono text-[13px] text-ink/80">/predict</code>, and{" "}
        <code className="font-mono text-[13px] text-ink/80">/predict_batch</code> on that host.
      </p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-[12px] font-medium text-ink">Local</p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
            Add the variable to <code className="font-mono text-[12px] text-ink/70">.env.local</code>{" "}
            and restart <code className="font-mono text-[12px] text-ink/70">npm run dev</code>.
          </p>
        </div>
        <div>
          <p className="text-[12px] font-medium text-ink">Vercel</p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
            Project → Settings → Environment Variables, then{" "}
            <strong className="font-medium text-ink">redeploy</strong>. Changing the value without a
            new build has no effect.
          </p>
        </div>
      </div>

      <p className="mt-5 text-[12px] leading-relaxed text-muted">{MISSING_ENV_MESSAGE}</p>
    </section>
  );
}
