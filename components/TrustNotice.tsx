import { formatConfidence } from "@/lib/format";
import { ISSUE_ABSTAIN_THRESHOLD, issueConfidence01 } from "@/lib/trust";

export function TrustNotice({ confidence }: { confidence: number | null | undefined }) {
  const conf = issueConfidence01(confidence);
  const shown = formatConfidence(confidence);
  const thresholdPct = Math.round(ISSUE_ABSTAIN_THRESHOLD * 100);

  return (
    <div
      className="rounded-2xl border border-amber-400/35 bg-amber-400/8 p-4 sm:p-5"
      role="status"
    >
      <p className="text-sm font-semibold text-amber-50">Needs review — do not auto-route</p>
      <p className="mt-1 text-sm leading-relaxed text-amber-50/80">
        {conf === null
          ? `Issue confidence was not returned, so this ticket is below the ${thresholdPct}% trust threshold.`
          : `Issue confidence ${shown} is below the ${thresholdPct}% trust threshold.`}{" "}
        The model’s top guess is shown for transparency only — do not treat it as a routing decision.
      </p>
    </div>
  );
}

export function NeedsReviewBadge() {
  return (
    <span className="mt-1 inline-flex rounded-full bg-amber-400/15 px-2 py-0.5 text-[11px] font-medium text-amber-100 ring-1 ring-amber-400/35">
      Needs review
    </span>
  );
}
