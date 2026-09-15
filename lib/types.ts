/** Shape of the JSON returned by POST /predict (and each element of /predict_batch). */
export interface Confidence {
  issue?: number | null;
  sentiment?: number | null;
}

export interface Prediction {
  issue: string;
  sentiment: string;
  urgency: string;
  urgency_score?: number | null;
  confidence?: Confidence | null;
}

/** One CSV row paired with its prediction (or the error that stopped it). */
export interface RowResult {
  index: number;
  text: string;
  prediction: Prediction | null;
  error: string | null;
}

export type HealthStatus = "unknown" | "warming" | "ready" | "unreachable";
