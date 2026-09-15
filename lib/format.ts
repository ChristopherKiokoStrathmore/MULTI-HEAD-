/**
 * The API may express confidence as 0-1 or as 0-100. Normalise to a 0-100
 * number, or return null when the field is absent so the UI can hide it.
 */
export function confidencePercent(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const pct = value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, pct));
}

export function formatConfidence(value: number | null | undefined): string | null {
  const pct = confidencePercent(value);
  if (pct === null) return null;
  return `${pct.toFixed(1)}%`;
}

export function formatScore(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value.toFixed(3);
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}… (truncated)`;
}

/** Display-only: `Airtel_Money_Reversal` → `Airtel Money Reversal`. */
export function formatLabel(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.replace(/_/g, " ").trim();
}
