import type { ReactNode } from "react";
import type { Prediction } from "@/lib/types";
import { confidencePercent, formatConfidence, formatLabel, formatScore } from "@/lib/format";
import { shouldAbstainOnIssue } from "@/lib/trust";
import { urgencyTone, URGENCY_STYLES } from "@/lib/urgency";
import { TrustNotice } from "./TrustNotice";

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
  valueClassName = "text-lg font-semibold break-words text-ink",
  children,
}: {
  label: string;
  value: string;
  sub?: string | null;
  className?: string;
  valueClassName?: string;
  children?: ReactNode;
}) {
  return (
    <article className={`rounded-2xl border p-4 sm:p-5 ${className}`}>
      <p className="text-[11px] font-semibold tracking-[0.16em] text-muted uppercase">{label}</p>
      <p className={`mt-2 ${valueClassName}`}>{value || "—"}</p>
      {sub && <p className="mt-1 text-xs text-muted">{sub}</p>}
      {children}
    </article>
  );
}

export default function PredictionCards({ prediction }: { prediction: Prediction }) {
  const tone = urgencyTone(prediction.urgency);
  const styles = URGENCY_STYLES[tone];
  const score = formatScore(prediction.urgency_score);
  const abstain = shouldAbstainOnIssue(prediction.confidence?.issue);

  return (
    <div className="space-y-3" aria-live="polite">
      {abstain && <TrustNotice confidence={prediction.confidence?.issue} />}
      <div className="grid gap-3 sm:grid-cols-3 sm:gap-4">
        <Card
          label={abstain ? "Issue · top guess" : "Issue"}
          value={formatLabel(prediction.issue)}
          className={
            abstain
              ? "border-dashed border-amber-400/40 bg-amber-400/5"
              : "border-line bg-surface-2/80"
          }
          valueClassName={
            abstain
              ? "text-lg font-medium break-words text-ink/70"
              : "text-lg font-semibold break-words text-ink"
          }
        >
          <ConfidenceBar
            value={prediction.confidence?.issue}
            barClass={abstain ? "bg-amber-300" : "bg-teal-300"}
          />
          {abstain && (
            <p className="mt-3 text-xs leading-relaxed text-amber-100/75">
              Shown for transparency only — not trusted for auto-routing.
            </p>
          )}
        </Card>
        <Card label="Sentiment" value={formatLabel(prediction.sentiment)}>
          <ConfidenceBar value={prediction.confidence?.sentiment} barClass="bg-sky-300" />
        </Card>
        <Card
          label="Urgency"
          value={formatLabel(prediction.urgency)}
          className={styles.card}
          sub={score ? `Score ${score}` : null}
        />
      </div>
    </div>
  );
}
