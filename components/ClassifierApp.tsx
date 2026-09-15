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

const HEALTH_DOT: Record<HealthStatus, string> = {
  unknown: "bg-[#636366]",
  warming: "bg-sky-300 animate-pulse",
  ready: "bg-emerald-400",
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
    <div className="space-y-8">
      {!apiReady && <ConfigNotice />}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div
          className="inline-flex w-fit rounded-full bg-white/6 p-1"
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
                className={`rounded-full px-4 py-2 text-[13px] font-medium tracking-tight transition-colors ${
                  selected
                    ? "bg-white/12 text-ink shadow-[0_1px_0_rgb(255_255_255/0.04)]"
                    : "text-muted hover:text-ink"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {apiReady ? (
          <span
            className="inline-flex items-center gap-2 self-start text-[12px] text-muted"
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
          <span className="inline-flex items-center gap-2 self-start text-[12px] text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-[#636366]" aria-hidden="true" />
            API URL not set
          </span>
        )}
      </div>

      {health === "unreachable" && (
        <p className="max-w-2xl text-[14px] leading-relaxed text-muted">
          The warm-up call to{" "}
          <code className="font-mono text-[13px] text-ink/80">{API_BASE}/health</code> did not
          succeed. You can still classify — the first request will simply carry the full cold
          start, and any real error will be shown in full below.
        </p>
      )}

      <section id={`panel-${mode}`} role="tabpanel" aria-labelledby={`tab-${mode}`}>
        {mode === "single" ? (
          <SingleMode disabled={!apiReady} />
        ) : (
          <BatchMode disabled={!apiReady} />
        )}
      </section>
    </div>
  );
}
