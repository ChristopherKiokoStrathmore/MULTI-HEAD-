export type UrgencyTone = "low" | "medium" | "emergency" | "unknown";

/**
 * Map a raw urgency label onto one of the three demo tones.
 * Anything unrecognised falls through to "unknown" and is rendered neutrally
 * rather than being silently coloured as if it were a known class.
 */
export function urgencyTone(raw: string | null | undefined): UrgencyTone {
  const label = (raw ?? "").trim().toLowerCase();
  if (label === "low") return "low";
  if (label === "medium") return "medium";
  if (label === "emergency") return "emergency";
  return "unknown";
}

interface ToneStyle {
  card: string;
  badge: string;
  cell: string;
}

/**
 * Full literal class strings so the Tailwind scanner can see every candidate.
 * low = grey, medium = amber, emergency = red.
 */
export const URGENCY_STYLES: Record<UrgencyTone, ToneStyle> = {
  low: {
    card: "border-slate-300 bg-slate-50",
    badge: "bg-slate-200 text-slate-800 ring-1 ring-slate-300",
    cell: "text-slate-700",
  },
  medium: {
    card: "border-amber-400 bg-amber-50",
    badge: "bg-amber-200 text-amber-900 ring-1 ring-amber-400",
    cell: "text-amber-800 font-medium",
  },
  emergency: {
    card: "border-red-500 bg-red-50",
    badge: "bg-red-200 text-red-900 ring-1 ring-red-400",
    cell: "text-red-800 font-semibold",
  },
  unknown: {
    card: "border-dashed border-slate-300 bg-white",
    badge: "bg-white text-slate-600 ring-1 ring-slate-300",
    cell: "text-slate-500",
  },
};
