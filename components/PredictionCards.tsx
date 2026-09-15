import type { ReactNode } from "react";
import type { Prediction } from "@/lib/types";
import { confidencePercent, formatConfidence, formatLabel, formatScore } from "@/lib/format";
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
    <div className="mt-5">
      <div className="flex items-baseline justify-between gap-3 text-[11px] text-muted">
        <span>{label}</span>
        <span className="font-mono tabular-nums text-ink/70">{text}</span>
      </div>
      <div
        className="mt-2 h-1 overflow-hidden rounded-full bg-black/8"
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
  valueClass = "text-ink",
  sub,
  children,
}: {
  label: string;
  value: string;
  valueClass?: string;
  sub?: string | null;
  children?: ReactNode;
}) {
  return (
    <article className="px-1 py-5 sm:px-6 sm:py-6">
      <p className="text-[12px] font-medium text-muted">{label}</p>
      <p className={`mt-2 text-[1.35rem] leading-tight font-semibold tracking-tight break-words ${valueClass}`}>
        {value || "—"}
      </p>
      {sub && <p className="mt-1.5 text-[12px] text-muted">{sub}</p>}
      {children}
    </article>
  );
}

export default function PredictionCards({ prediction }: { prediction: Prediction }) {
  const tone = urgencyTone(prediction.urgency);
  const styles = URGENCY_STYLES[tone];
  const score = formatScore(prediction.urgency_score);

  return (
    <div
      className={`reveal overflow-hidden rounded-[1.25rem] bg-surface-2 ${styles.card}`}
      aria-live="polite"
    >
      <div className="grid sm:grid-cols-3 sm:divide-x sm:divide-black/8">
        <Card label="Issue" value={formatLabel(prediction.issue)}>
          <ConfidenceBar value={prediction.confidence?.issue} barClass="bg-ink" />
        </Card>
        <Card label="Sentiment" value={formatLabel(prediction.sentiment)}>
          <ConfidenceBar value={prediction.confidence?.sentiment} barClass="bg-ink/60" />
        </Card>
        <Card
          label="Urgency"
          value={formatLabel(prediction.urgency)}
          valueClass={styles.value}
          sub={score ? `Score ${score}` : null}
        >
          {tone === "emergency" && (
            <p className="mt-4 text-[12px] font-medium tracking-tight text-accent">Handle first</p>
          )}
        </Card>
      </div>
    </div>
  );
}
