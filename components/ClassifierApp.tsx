"use client";

import { useEffect, useState } from "react";
import { API_BASE, API_BASE_CONFIGURED, MISSING_ENV_MESSAGE, warmUp } from "@/lib/api";
import type { HealthStatus } from "@/lib/types";
import SingleMode from "./SingleMode";
import BatchMode from "./BatchMode";
import ErrorBanner from "./ErrorBanner";
import Spinner from "./Spinner";

type Mode = "single" | "csv";

const HEALTH_LABEL: Record<HealthStatus, string> = {
  unknown: "Checking model...",
  warming: "Warming up the model...",
  ready: "Model is warm",
  unreachable: "Warm-up did not answer",
};

const HEALTH_STYLE: Record<HealthStatus, string> = {
  unknown: "bg-slate-100 text-slate-600 ring-1 ring-slate-300",
  warming: "bg-blue-100 text-blue-800 ring-1 ring-blue-300",
  ready: "bg-green-100 text-green-800 ring-1 ring-green-300",
  unreachable: "bg-amber-100 text-amber-900 ring-1 ring-amber-300",
};

export default function ClassifierApp() {
  const [mode, setMode] = useState<Mode>("single");
  const [health, setHealth] = useState<HealthStatus>("unknown");

  /*
   * Warm-up on mount. The backend scales to zero, so this GET /health exists
   * purely to make the container start booting while the user is still typing.
   * The response body is deliberately ignored, and a failure here is never
   * fatal - the user can still submit, it will just be slow.
   */
  useEffect(() => {
    if (!API_BASE_CONFIGURED) return;

    const controller = new AbortController();
    setHealth("warming");

    warmUp(controller.signal).then((ok) => {
      if (!controller.signal.aborted) {
        setHealth(ok ? "ready" : "unreachable");
      }
    });

    return () => controller.abort();
  }, []);

  if (!API_BASE_CONFIGURED) {
    return <ErrorBanner message={MISSING_ENV_MESSAGE} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          className="inline-flex rounded-lg border border-slate-300 bg-white p-1"
          role="tablist"
          aria-label="Input mode"
        >
          {(
            [
              ["single", "Single message"],
              ["csv", "CSV upload"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              onClick={() => setMode(value)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                mode === value
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <span
          className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${HEALTH_STYLE[health]}`}
          title={API_BASE}
        >
          {(health === "warming" || health === "unknown") && <Spinner className="h-3 w-3" />}
          {HEALTH_LABEL[health]}
        </span>
      </div>

      {health === "unreachable" && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          The warm-up call to <code className="font-mono">{API_BASE}/health</code> did not
          succeed. You can still classify - the first request will simply carry the full cold
          start, and any real error will be shown in full below.
        </p>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        {mode === "single" ? (
          <SingleMode disabled={false} />
        ) : (
          <BatchMode disabled={false} />
        )}
      </section>
    </div>
  );
}
