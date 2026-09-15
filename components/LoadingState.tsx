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
    <div className="flex items-start gap-3 rounded-[1.2rem] bg-surface px-5 py-4" role="status" aria-live="polite">
      <Spinner className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
      <div className="min-w-0 text-[14px]">
        <p className="font-medium tracking-tight text-ink">
          Waking up the model. First use can take up to 40 seconds.
        </p>
        <p className="mt-1 text-muted">
          {detail ? `${detail} · ` : ""}
          Elapsed{" "}
          <span className="font-mono tabular-nums text-ink/80">{seconds}s</span>
        </p>
      </div>
    </div>
  );
}
