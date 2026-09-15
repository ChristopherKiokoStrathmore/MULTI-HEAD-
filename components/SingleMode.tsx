"use client";

import { useRef, useState } from "react";
import type { Prediction } from "@/lib/types";
import { errorText, predictOne } from "@/lib/api";
import { SAMPLE_MESSAGES } from "@/lib/examples";
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
    if (!message || busy || disabled) return;

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
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <label htmlFor="message" className="block text-[13px] font-medium text-ink">
            Customer message
          </label>
          <span className="font-mono text-[11px] tabular-nums text-muted">
            {text.trim().length} characters
          </span>
        </div>
        <textarea
          id="message"
          rows={7}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              void classify();
            }
          }}
          disabled={busy}
          placeholder="Paste a customer-care message here…"
          className="field mt-3 resize-y"
        />
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <p className="text-[12px] text-muted">Try</p>
          {SAMPLE_MESSAGES.map((sample) => (
            <button
              key={sample.label}
              type="button"
              onClick={() => setText(sample.text)}
              disabled={busy}
              className="chip"
            >
              {sample.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void classify()}
          disabled={disabled || busy || text.trim().length === 0}
          className="btn-primary"
        >
          {busy && <Spinner className="h-4 w-4 text-current" />}
          {busy ? "Classifying…" : "Classify"}
        </button>

        {busy && (
          <button type="button" onClick={cancel} className="btn-secondary">
            Cancel
          </button>
        )}

        <p className="text-[12px] text-muted">
          {disabled
            ? "Classification is unavailable until the API URL is set."
            : "⌘ or Ctrl + Enter"}
        </p>
      </div>

      {busy && <LoadingState detail="Classifying 1 message" />}
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      {prediction && !busy && <PredictionCards prediction={prediction} />}
    </div>
  );
}
