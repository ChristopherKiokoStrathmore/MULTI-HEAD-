import ClassifierApp from "@/components/ClassifierApp";

export default function Page() {
  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <div className="brand-rule" aria-hidden="true" />
      <div className="bg-hero pointer-events-none absolute inset-x-0 top-0 h-[32rem]" aria-hidden="true" />

      <header className="relative">
        <div className="mx-auto flex max-w-4xl items-center px-6 py-6 sm:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <span className="h-7 w-1 shrink-0 rounded-full bg-accent" aria-hidden="true" />
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold tracking-tight text-ink">Multi-Head</p>
              <p className="truncate text-[12px] text-muted">Customer-care classifier</p>
            </div>
          </div>
        </div>
      </header>

      <main id="main" className="relative mx-auto max-w-4xl px-6 pt-4 pb-20 sm:px-8 sm:pt-8">
        <section className="mb-12 max-w-2xl sm:mb-16">
          <h1 className="text-[2.4rem] leading-[1.05] font-semibold tracking-[-0.038em] text-ink sm:text-[3.25rem]">
            Customer-care
            <span className="block">message classifier</span>
          </h1>
          <p className="mt-5 text-[17px] leading-relaxed text-muted">
            Paste a support message, or a CSV of them. The model returns issue, sentiment, and
            urgency — nothing else on the page competes with that.
          </p>
        </section>

        <ClassifierApp />
      </main>

      <footer className="relative mx-auto max-w-4xl px-6 pb-14 text-[12px] leading-relaxed text-muted sm:px-8">
        <p>
          Predictions come from the model API in{" "}
          <code className="font-mono text-[11px] text-ink/70">NEXT_PUBLIC_API_URL</code>. Use the
          API base URL — do not append <code className="font-mono text-[11px]">/predict</code>.
          Production must set the variable in Vercel and redeploy;{" "}
          <code className="font-mono text-[11px]">NEXT_PUBLIC_*</code> values are baked in at build
          time.
        </p>
      </footer>
    </div>
  );
}
