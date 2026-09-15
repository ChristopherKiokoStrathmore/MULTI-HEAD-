import { confidencePercent } from "./format";

/**
 * Issue-head softmax below this is treated as untrusted for auto-routing.
 *
 * On a 10-class head, a top probability around 0.5 is often little better than
 * a coin flip among plausible tickets — do not auto-route those. The eval
 * harness (`eval/run.mjs`) defaults to the same value.
 */
export const ISSUE_ABSTAIN_THRESHOLD = 0.6;

/** Normalise API confidence to 0–1 (accepts 0–1 or 0–100). */
export function issueConfidence01(value: number | null | undefined): number | null {
  const pct = confidencePercent(value);
  if (pct === null) return null;
  return pct / 100;
}

/**
 * True when the issue head should not be used for auto-routing.
 * Missing confidence is treated as untrusted.
 * Comparison is strict (`<`): a score of exactly 0.6 is accepted.
 */
export function shouldAbstainOnIssue(value: number | null | undefined): boolean {
  const conf = issueConfidence01(value);
  if (conf === null) return true;
  return conf < ISSUE_ABSTAIN_THRESHOLD;
}
