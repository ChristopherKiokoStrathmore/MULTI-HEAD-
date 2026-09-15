"use client";

import { useRef, useState } from "react";
import type { Prediction } from "@/lib/types";
import { errorText, predictOne } from "@/lib/api";
import PredictionCards from "./PredictionCards";
import LoadingState from "./LoadingState";
import ErrorBanner from "./ErrorBanner";
import Spinner from "./Spinner";

export default function SingleMode({ disabled }: { disabled: boolean }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function classify() {
    const message = text.trim();
    if (!message || busy) return;

    const controller = new AbortController();
    abortRef.current = controller;

    setBusy(true);
    setError(null);
    setPrediction(null);

    try {
      setPrediction(await predictOne(message, controller.signal));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  function cancel() {
    abortRef.current?.abort();
  }

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="message" className="block text-sm font-medium text-slate-800">
          Customer message
        </label>
        <textarea
          id="message"
          rows={5}
          value={text}
          onChange={(event) => setText(event.target.value)}
          disabled={disabled}
          placeholder="Paste a customer-care message here…"
          className="mt-1 w-full resize-y rounded-lg border border-slate-300 bg-white p-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:ring-2 focus:ring-slate-200 focus:outline-none disabled:bg-slate-100"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={classify}
          disabled={disabled || busy || text.trim().length === 0}
          className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {busy && <Spinner className="h-4 w-4 text-white" />}
          {busy ? "Classifying…" : "Classify"}
        </button>

        {busy && (
          <button
            type="button"
            onClick={cancel}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
          >
            Cancel
          </button>
        )}
      </div>

      {busy && <LoadingState detail="Classifying 1 message" />}
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      {prediction && !busy && <PredictionCards prediction={prediction} />}
    </div>
  );
}
