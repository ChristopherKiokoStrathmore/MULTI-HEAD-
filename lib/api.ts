import type { Prediction } from "./types";
import { truncate } from "./format";

/*
 * The API base URL is read ONLY from NEXT_PUBLIC_API_URL. It is never hardcoded.
 *
 * `process.env.NEXT_PUBLIC_API_URL` must appear as a full literal expression
 * here: Next.js statically replaces that exact text at build time, so it cannot
 * be destructured or built up dynamically.
 */
export const API_BASE: string = (process.env.NEXT_PUBLIC_API_URL ?? "")
  .trim()
  .replace(/\/+$/, "");

export const API_BASE_CONFIGURED: boolean = API_BASE.length > 0;

export const MISSING_ENV_MESSAGE =
  "NEXT_PUBLIC_API_URL is not set, so there is no API to call. " +
  "Locally: add it to .env.local and restart `npm run dev`. " +
  "On Vercel: add it under Project → Settings → Environment Variables, then redeploy " +
  "(NEXT_PUBLIC_* values are baked in at build time, so a redeploy is required).";

/** Cold start is 20-40s, so the single-request budget is deliberately generous. */
export const SINGLE_TIMEOUT_MS = 120_000;
export const BATCH_TIMEOUT_MS = 180_000;
const HEALTH_TIMEOUT_MS = 60_000;

/** Rows per /predict_batch call. Keeps each request well inside its timeout. */
export const BATCH_CHUNK_SIZE = 20;

export class ApiError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function endpoint(path: string): string {
  if (!API_BASE_CONFIGURED) throw new ApiError(MISSING_ENV_MESSAGE);
  return `${API_BASE}${path}`;
}

/**
 * Turn whatever fetch threw into an ApiError carrying text a human can act on.
 * A cross-origin failure reaches JS as an opaque TypeError with no status and
 * no body, so it is named explicitly here instead of being reported as a
 * generic network blip.
 */
function toApiError(err: unknown, url: string, timeoutMs: number, timedOut: boolean): ApiError {
  if (err instanceof ApiError) return err;

  if (timedOut) {
    return new ApiError(
      `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for ${url}. ` +
        "The container may still be waking up — wait a few seconds and try again.",
    );
  }

  if (err instanceof DOMException && err.name === "AbortError") {
    return new ApiError("Request cancelled.");
  }

  if (err instanceof TypeError) {
    return new ApiError(
      `Could not reach ${url}. The browser reported "${err.message}" with no HTTP status, ` +
        "which almost always means one of: (1) the API is not sending CORS headers that allow " +
        "this site's origin, (2) the URL in NEXT_PUBLIC_API_URL is wrong or unreachable, or " +
        "(3) the page is HTTPS and the API is HTTP (mixed content). Open the browser Network " +
        "tab for the underlying reason — the browser deliberately hides it from JavaScript.",
    );
  }

  return new ApiError(err instanceof Error ? err.message : String(err));
}

interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

async function requestJson<T>(
  path: string,
  init: RequestInit,
  { signal, timeoutMs = SINGLE_TIMEOUT_MS }: RequestOptions = {},
): Promise<T> {
  const url = endpoint(path);
  const controller = new AbortController();
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const forwardAbort = () => controller.abort();
  signal?.addEventListener("abort", forwardAbort);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const bodyText = await response.text();

    if (!response.ok) {
      const detail = bodyText.trim()
        ? truncate(bodyText.trim(), 800)
        : "(the response body was empty)";
      throw new ApiError(
        `HTTP ${response.status} ${response.statusText} from ${init.method ?? "GET"} ${url} — ${detail}`,
        response.status,
      );
    }

    try {
      return JSON.parse(bodyText) as T;
    } catch {
      throw new ApiError(
        `${url} returned HTTP ${response.status} but the body was not valid JSON — ` +
          truncate(bodyText.trim() || "(empty)", 400),
        response.status,
      );
    }
  } catch (err) {
    throw toApiError(err, url, timeoutMs, timedOut);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forwardAbort);
  }
}

function postJson<T>(path: string, body: unknown, options?: RequestOptions): Promise<T> {
  return requestJson<T>(
    path,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    options,
  );
}

/**
 * Fire-and-forget warm-up. The response is intentionally ignored; the only
 * point is to make the scaled-to-zero container start booting on page mount.
 * Resolves true if the container answered, false otherwise. Never throws.
 */
export async function warmUp(signal?: AbortSignal): Promise<boolean> {
  if (!API_BASE_CONFIGURED) return false;
  try {
    await requestJson<unknown>("/health", { method: "GET" }, {
      signal,
      timeoutMs: HEALTH_TIMEOUT_MS,
    });
    return true;
  } catch {
    return false;
  }
}

export function predictOne(text: string, signal?: AbortSignal): Promise<Prediction> {
  return postJson<Prediction>("/predict", { text }, { signal, timeoutMs: SINGLE_TIMEOUT_MS });
}

export async function predictBatch(texts: string[], signal?: AbortSignal): Promise<Prediction[]> {
  const data = await postJson<unknown>("/predict_batch", { texts }, {
    signal,
    timeoutMs: BATCH_TIMEOUT_MS,
  });

  if (!Array.isArray(data)) {
    throw new ApiError(
      `/predict_batch was expected to return an array aligned to the input, but returned ${typeof data}.`,
    );
  }
  if (data.length !== texts.length) {
    throw new ApiError(
      `/predict_batch returned ${data.length} prediction(s) for ${texts.length} input text(s). ` +
        "Results cannot be aligned to rows, so nothing was recorded for this chunk.",
    );
  }
  return data as Prediction[];
}

export interface ChunkProgress {
  completed: number;
  total: number;
}

/**
 * Send texts to /predict_batch in fixed-size sequential chunks.
 *
 * Sequential rather than parallel on purpose: the backend scales to zero, and
 * firing concurrent requests at a cold container is the fastest way to trip its
 * timeout. Chunking also means a failure late in a large CSV does not discard
 * the rows that already succeeded.
 */
export async function predictBatchChunked(
  texts: string[],
  onProgress: (progress: ChunkProgress) => void,
  onChunk: (startIndex: number, predictions: Prediction[]) => void,
  signal?: AbortSignal,
): Promise<void> {
  const total = texts.length;
  onProgress({ completed: 0, total });

  for (let start = 0; start < total; start += BATCH_CHUNK_SIZE) {
    if (signal?.aborted) throw new ApiError("Request cancelled.");
    const chunk = texts.slice(start, start + BATCH_CHUNK_SIZE);
    const predictions = await predictBatch(chunk, signal);
    onChunk(start, predictions);
    onProgress({ completed: Math.min(start + chunk.length, total), total });
  }
}

export function errorText(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
