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
  value: string;
  badge: string;
  cell: string;
  bar: string;
}

/**
 * Full literal class strings so the Tailwind scanner can see every candidate.
 * low = slate, medium = amber, emergency = Airtel red (#EC1B24).
 */
export const URGENCY_STYLES: Record<UrgencyTone, ToneStyle> = {
  low: {
    card: "",
    value: "text-ink",
    badge: "bg-white/8 text-ink/80",
    cell: "text-muted",
    bar: "bg-[#8e8e93]",
  },
  medium: {
    card: "",
    value: "text-amber-200",
    badge: "bg-amber-400/12 text-amber-100",
    cell: "text-amber-200 font-medium",
    bar: "bg-amber-400",
  },
  emergency: {
    card: "ring-1 ring-accent/35",
    value: "text-accent",
    badge: "bg-accent/12 text-red-100",
    cell: "text-accent font-semibold",
    bar: "bg-accent",
  },
  unknown: {
    card: "ring-1 ring-white/15",
    value: "text-ink",
    badge: "bg-transparent text-muted ring-1 ring-white/15",
    cell: "text-muted",
    bar: "bg-[#636366]",
  },
};
