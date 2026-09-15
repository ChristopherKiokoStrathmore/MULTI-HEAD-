import type { ReactNode } from "react";
import type { Prediction } from "@/lib/types";
import { confidencePercent, formatConfidence, formatScore } from "@/lib/format";
import { urgencyTone, URGENCY_STYLES } from "@/lib/urgency";

function ConfidenceBar({
  value,
  barClass,
  label = "Confidence",
}: {
  value: number | null | undefined;
  barClass: string;
  label?: string;
}) {
  const pct = confidencePercent(value);
  const text = formatConfidence(value);
  if (pct === null || !text) return null;

  return (
    <div className="mt-4">
      <div className="flex items-baseline justify-between gap-3 text-[11px] text-muted">
        <span>{label}</span>
        <span className="font-mono tabular-nums text-ink/80">{text}</span>
      </div>
      <div
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
      >
        <div className={`h-full rounded-full ${barClass}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Card({
  label,
  value,
  sub,
  className = "border-line bg-surface-2/80",
  children,
}: {
  label: string;
  value: string;
  sub?: string | null;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <article className={`rounded-2xl border p-4 sm:p-5 ${className}`}>
      <p className="text-[11px] font-semibold tracking-[0.16em] text-muted uppercase">{label}</p>
      <p className="mt-2 text-lg font-semibold break-words text-ink">{value || "—"}</p>
      {sub && <p className="mt-1 text-xs text-muted">{sub}</p>}
      {children}
    </article>
  );
}

export default function PredictionCards({ prediction }: { prediction: Prediction }) {
  const tone = urgencyTone(prediction.urgency);
  const styles = URGENCY_STYLES[tone];
  const score = formatScore(prediction.urgency_score);

  return (
    <div className="grid gap-3 sm:grid-cols-3 sm:gap-4" aria-live="polite">
      <Card label="Issue" value={prediction.issue}>
        <ConfidenceBar value={prediction.confidence?.issue} barClass="bg-teal-300" />
      </Card>
      <Card label="Sentiment" value={prediction.sentiment}>
        <ConfidenceBar value={prediction.confidence?.sentiment} barClass="bg-sky-300" />
      </Card>
      <Card label="Urgency" value={prediction.urgency} className={styles.card} sub={score ? `Score ${score}` : null} />
    </div>
  );
}
