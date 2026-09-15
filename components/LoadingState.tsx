"use client";

import { useEffect, useState } from "react";
import Spinner from "./Spinner";

/**
 * Shown for the whole time any request is in flight.
 *
 * The elapsed-seconds counter exists so a 40s cold start never looks frozen:
 * something on screen is always changing, even while the container boots.
 */
export default function LoadingState({ detail }: { detail?: string }) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const id = setInterval(() => {
      setSeconds(Math.floor((Date.now() - started) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      className="flex items-start gap-3 rounded-2xl border border-sky-400/25 bg-sky-400/8 p-4"
      role="status"
      aria-live="polite"
    >
      <Spinner className="mt-0.5 h-5 w-5 shrink-0 text-sky-300" />
      <div className="min-w-0 text-sm">
        <p className="font-medium text-sky-100">
          Waking up the model, this can take up to 40s on first use.
        </p>
        <p className="mt-1 text-sky-100/75">
          {detail ? `${detail} · ` : ""}
          Elapsed:{" "}
          <span className="font-mono tabular-nums text-sky-50">{seconds}s</span>
        </p>
      </div>
    </div>
  );
}
