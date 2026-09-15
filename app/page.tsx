import ClassifierApp from "@/components/ClassifierApp";

const AXES = [
  { name: "Issue", detail: "What the customer is asking about" },
  { name: "Sentiment", detail: "Tone of the message" },
  { name: "Urgency", detail: "How quickly it should be handled" },
] as const;

export default function Page() {
  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <div className="bg-grid pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="bg-hero-glow pointer-events-none absolute inset-x-0 top-0 h-[36rem]" aria-hidden="true" />

      <header className="relative border-b border-line/80">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-accent/30 bg-accent/10 font-display text-sm font-semibold text-accent"
              aria-hidden="true"
            >
              MH
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tracking-tight text-ink">Multi-Head</p>
              <p className="truncate text-xs text-muted">Customer-care classifier</p>
            </div>
          </div>
          <p className="hidden text-xs text-muted sm:block">
            Telecom support demo · Issue · Sentiment · Urgency
          </p>
        </div>
      </header>

      <main id="main" className="relative mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <section className="mb-10 max-w-3xl">
          <p className="text-xs font-semibold tracking-[0.18em] text-accent uppercase">
            Multi-head classification
          </p>
          <h1 className="font-display mt-3 text-3xl leading-tight font-semibold tracking-tight text-ink sm:text-4xl">
            Customer-care message classifier
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted sm:text-base">
            Labels a support message on three heads from a remote model. Classify one ticket, or
            upload a CSV and run a whole column.
          </p>

          <ul className="mt-6 grid gap-3 sm:grid-cols-3">
            {AXES.map((axis) => (
              <li
                key={axis.name}
                className="rounded-xl border border-line bg-surface/60 px-4 py-3"
              >
                <p className="text-sm font-semibold text-ink">{axis.name}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted">{axis.detail}</p>
              </li>
            ))}
          </ul>
        </section>

        <ClassifierApp />
      </main>

      <footer className="relative mx-auto max-w-6xl border-t border-line px-4 py-8 text-xs text-muted sm:px-6">
        <p>
          Predictions come from the model API configured in{" "}
          <code className="rounded-md border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-ink/80">
            NEXT_PUBLIC_API_URL
          </code>
          . The value is the API <em>base</em> URL — do not append{" "}
          <code className="font-mono text-[11px]">/predict</code>. Production must set the
          variable in Vercel and redeploy; <code className="font-mono text-[11px]">NEXT_PUBLIC_*</code>{" "}
          values are baked in at build time.
        </p>
      </footer>
    </div>
  );
}
