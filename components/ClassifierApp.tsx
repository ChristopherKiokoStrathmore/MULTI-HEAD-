"use client";

import { useEffect, useRef, useState } from "react";
import { API_BASE, API_BASE_CONFIGURED, warmUp } from "@/lib/api";
import type { HealthStatus } from "@/lib/types";
import SingleMode from "./SingleMode";
import BatchMode from "./BatchMode";
import ConfigNotice from "./ConfigNotice";
import Spinner from "./Spinner";

type Mode = "single" | "csv";

const HEALTH_LABEL: Record<HealthStatus, string> = {
  unknown: "Checking model…",
  warming: "Warming up the model…",
  ready: "Model is warm",
  unreachable: "Warm-up did not answer",
};

const HEALTH_STYLE: Record<HealthStatus, string> = {
  unknown: "border-line bg-surface-2 text-muted",
  warming: "border-sky-400/30 bg-sky-400/10 text-sky-100",
  ready: "border-accent/30 bg-accent/10 text-accent",
  unreachable: "border-amber-400/30 bg-amber-400/10 text-amber-100",
};

const HEALTH_DOT: Record<HealthStatus, string> = {
  unknown: "bg-slate-400",
  warming: "bg-sky-300 animate-pulse",
  ready: "bg-accent",
  unreachable: "bg-amber-400",
};

export default function ClassifierApp() {
  const [mode, setMode] = useState<Mode>("single");
  const [health, setHealth] = useState<HealthStatus>("unknown");
  const singleTabRef = useRef<HTMLButtonElement>(null);
  const csvTabRef = useRef<HTMLButtonElement>(null);

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

  const apiReady = API_BASE_CONFIGURED;

  return (
    <div className="space-y-6">
      {!apiReady && <ConfigNotice />}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          className="inline-flex w-fit rounded-xl border border-line bg-surface p-1"
          role="tablist"
          aria-label="Input mode"
        >
          {(
            [
              ["single", "Single message"],
              ["csv", "CSV upload"],
            ] as const
          ).map(([value, label]) => {
            const selected = mode === value;
            return (
              <button
                key={value}
                type="button"
                role="tab"
                id={`tab-${value}`}
                ref={value === "single" ? singleTabRef : csvTabRef}
                aria-selected={selected}
                aria-controls={`panel-${value}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setMode(value)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                    event.preventDefault();
                    const next = value === "single" ? "csv" : "single";
                    setMode(next);
                    (next === "single" ? singleTabRef : csvTabRef).current?.focus();
                  }
                }}
                className={`rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
                  selected
                    ? "bg-ink text-canvas shadow-sm"
                    : "text-muted hover:bg-surface-2 hover:text-ink"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {apiReady ? (
          <span
            className={`inline-flex items-center gap-2 self-start rounded-full border px-3 py-1.5 text-xs font-medium ${HEALTH_STYLE[health]}`}
            title={API_BASE}
          >
            {(health === "warming" || health === "unknown") && (
              <Spinner className="h-3 w-3 text-current" />
            )}
            {health !== "warming" && health !== "unknown" && (
              <span className={`h-1.5 w-1.5 rounded-full ${HEALTH_DOT[health]}`} aria-hidden="true" />
            )}
            {HEALTH_LABEL[health]}
          </span>
        ) : (
          <span className="inline-flex items-center gap-2 self-start rounded-full border border-line bg-surface-2 px-3 py-1.5 text-xs font-medium text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-slate-500" aria-hidden="true" />
            API URL not set
          </span>
        )}
      </div>

      {health === "unreachable" && (
        <p className="rounded-2xl border border-amber-400/30 bg-amber-400/8 p-4 text-sm leading-relaxed text-amber-50/90">
          The warm-up call to{" "}
          <code className="font-mono text-[13px] text-amber-50">{API_BASE}/health</code> did not
          succeed. You can still classify — the first request will simply carry the full cold
          start, and any real error will be shown in full below.
        </p>
      )}

      <section
        id={`panel-${mode}`}
        role="tabpanel"
        aria-labelledby={`tab-${mode}`}
        className="panel rounded-2xl p-5 sm:p-7"
      >
        {mode === "single" ? (
          <SingleMode disabled={!apiReady} />
        ) : (
          <BatchMode disabled={!apiReady} />
        )}
      </section>
    </div>
  );
}
