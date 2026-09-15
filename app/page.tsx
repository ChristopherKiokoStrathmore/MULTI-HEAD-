import ClassifierApp from "@/components/ClassifierApp";

export default function Page() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Customer-Care Message Classifier
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">
          Classifies a customer-care message on three axes — <strong>Issue</strong>,{" "}
          <strong>Sentiment</strong> and <strong>Urgency</strong> — using a remote multi-head
          model. Classify one message, or upload a CSV to classify a whole column.
        </p>
      </header>

      <ClassifierApp />

      <footer className="mt-12 border-t border-slate-200 pt-4 text-xs text-slate-500">
        Predictions come from the model API configured in{" "}
        <code className="rounded bg-slate-200 px-1 py-0.5">NEXT_PUBLIC_API_URL</code>.
      </footer>
    </main>
  );
}
