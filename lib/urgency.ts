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
  bar: string;
}

/**
 * Full literal class strings so the Tailwind scanner can see every candidate.
 * low = slate, medium = amber, emergency = red — tuned for the dark canvas.
 */
export const URGENCY_STYLES: Record<UrgencyTone, ToneStyle> = {
  low: {
    card: "border-slate-500/40 bg-slate-500/10",
    badge: "bg-slate-400/15 text-slate-200 ring-1 ring-slate-400/30",
    cell: "text-slate-300",
    bar: "bg-slate-400",
  },
  medium: {
    card: "border-amber-400/45 bg-amber-400/10",
    badge: "bg-amber-400/15 text-amber-100 ring-1 ring-amber-400/35",
    cell: "text-amber-200 font-medium",
    bar: "bg-amber-400",
  },
  emergency: {
    card: "border-red-400/50 bg-red-500/10",
    badge: "bg-red-400/15 text-red-100 ring-1 ring-red-400/40",
    cell: "text-red-200 font-semibold",
    bar: "bg-red-400",
  },
  unknown: {
    card: "border-dashed border-white/20 bg-white/5",
    badge: "bg-transparent text-slate-300 ring-1 ring-white/20",
    cell: "text-slate-400",
    bar: "bg-slate-500",
  },
};
