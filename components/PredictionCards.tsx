import type { Prediction } from "@/lib/types";
import { formatConfidence, formatScore } from "@/lib/format";
import { urgencyTone, URGENCY_STYLES } from "@/lib/urgency";

function Card({
  label,
  value,
  sub,
  className = "border-slate-200 bg-white",
}: {
  label: string;
  value: string;
  sub?: string | null;
  className?: string;
}) {
  return (
    <div className={`rounded-lg border p-4 ${className}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold break-words text-slate-900">{value || "—"}</p>
      {sub && <p className="mt-1 text-xs text-slate-600">{sub}</p>}
    </div>
  );
}

export default function PredictionCards({ prediction }: { prediction: Prediction }) {
  const tone = urgencyTone(prediction.urgency);
  const styles = URGENCY_STYLES[tone];

  const issueConfidence = formatConfidence(prediction.confidence?.issue);
  const sentimentConfidence = formatConfidence(prediction.confidence?.sentiment);
  const score = formatScore(prediction.urgency_score);

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Card
        label="Issue"
        value={prediction.issue}
        sub={issueConfidence ? `Confidence ${issueConfidence}` : null}
      />
      <Card
        label="Sentiment"
        value={prediction.sentiment}
        sub={sentimentConfidence ? `Confidence ${sentimentConfidence}` : null}
      />
      <Card
        label="Urgency"
        value={prediction.urgency}
        sub={score ? `Urgency score ${score}` : null}
        className={styles.card}
      />
    </div>
  );
}
