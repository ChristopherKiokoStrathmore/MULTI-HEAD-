"use client";

import { useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import type { Prediction, RowResult } from "@/lib/types";
import { BATCH_CHUNK_SIZE, errorText, predictBatchChunked } from "@/lib/api";
import { formatConfidence, formatLabel, formatScore } from "@/lib/format";
import { ISSUE_ABSTAIN_THRESHOLD, shouldAbstainOnIssue } from "@/lib/trust";
import { urgencyTone, URGENCY_STYLES } from "@/lib/urgency";
import LoadingState from "./LoadingState";
import ErrorBanner from "./ErrorBanner";
import Spinner from "./Spinner";
import { NeedsReviewBadge } from "./TrustNotice";

type CsvRow = Record<string, string>;

/** Pre-select the most plausible message column so the demo needs fewer clicks. */
const LIKELY_COLUMN =
  /^(message|text|body|comment|content|review|description|ticket|complaint)$/i;

function pickDefaultColumn(headers: string[]): string {
  return headers.find((h) => LIKELY_COLUMN.test(h.trim())) ?? headers[0] ?? "";
}

export default function BatchMode({ disabled }: { disabled: boolean }) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [column, setColumn] = useState("");
  const [results, setResults] = useState<RowResult[]>([]);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const texts = useMemo(
    () => (column ? rows.map((row) => (row[column] ?? "").trim()) : []),
    [rows, column],
  );
  const nonEmptyCount = useMemo(() => texts.filter((t) => t.length > 0).length, [texts]);

  function resetResults() {
    setResults([]);
    setProgress({ completed: 0, total: 0 });
    setError(null);
  }

  function loadFile(file: File) {
    setFileName(file.name);
    resetResults();
    setNotice(null);

    Papa.parse<CsvRow>(file, {
      header: true,
      skipEmptyLines: true,
      comments: "#",
      complete: (parsed) => {
        const parsedHeaders = (parsed.meta.fields ?? []).filter(
          (h) => h && h.trim().length > 0,
        );

        if (parsedHeaders.length === 0) {
          setError(
            `Could not read any column headers from "${file.name}". ` +
              "The file must be a CSV whose first row contains column names.",
          );
          setHeaders([]);
          setRows([]);
          setColumn("");
          return;
        }

        setHeaders(parsedHeaders);
        setRows(parsed.data);
        setColumn(pickDefaultColumn(parsedHeaders));

        if (parsed.errors.length > 0) {
          const first = parsed.errors[0];
          setNotice(
            `Parsed with ${parsed.errors.length} warning(s). First: ${first.message}` +
              (typeof first.row === "number" ? ` (row ${first.row + 1})` : "") +
              ". Rows that did parse are still usable.",
          );
        }
      },
      error: (parseError) => {
        setError(`PapaParse could not read "${file.name}": ${parseError.message}`);
      },
    });
  }

  function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) loadFile(file);
  }

  async function classifyAll() {
    if (busy || disabled || !column || rows.length === 0) return;

    const controller = new AbortController();
    abortRef.current = controller;

    // Seed every row up front so partial progress is visible as chunks land.
    const seeded: RowResult[] = texts.map((text, index) => ({
      index,
      text,
      prediction: null,
      error: text.length === 0 ? "Empty cell - not sent to the model." : null,
    }));

    setResults(seeded);
    setError(null);
    setBusy(true);
    setProgress({ completed: 0, total: texts.length });

    try {
      await predictBatchChunked(
        texts,
        setProgress,
        (startIndex, predictions: Prediction[]) => {
          setResults((current) => {
            const next = [...current];
            predictions.forEach((prediction, offset) => {
              const target = next[startIndex + offset];
              if (target && target.text.length > 0) {
                next[startIndex + offset] = { ...target, prediction, error: null };
              }
            });
            return next;
          });
        },
        controller.signal,
      );
    } catch (err) {
      // Partial results already in state are kept on purpose.
      setError(errorText(err));
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  function downloadCsv() {
    const csv = Papa.unparse(
      results.map((result) => ({
        row: result.index + 1,
        text: result.text,
        issue: result.prediction?.issue ?? "",
        issue_confidence: formatConfidence(result.prediction?.confidence?.issue) ?? "",
        issue_needs_review: result.prediction
          ? shouldAbstainOnIssue(result.prediction.confidence?.issue)
            ? "yes"
            : "no"
          : "",
        sentiment: result.prediction?.sentiment ?? "",
        sentiment_confidence:
          formatConfidence(result.prediction?.confidence?.sentiment) ?? "",
        urgency: result.prediction?.urgency ?? "",
        urgency_score: result.prediction?.urgency_score ?? "",
        error: result.error ?? "",
      })),
    );

    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url;
    link.download =
      (fileName ? fileName.replace(/\.csv$/i, "") : "results") + "-classified.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  const classifiedCount = results.filter((r) => r.prediction).length;
  const needsReviewCount = results.filter(
    (r) => r.prediction && shouldAbstainOnIssue(r.prediction.confidence?.issue),
  ).length;
  const progressPct =
    progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;
  const thresholdPct = Math.round(ISSUE_ABSTAIN_THRESHOLD * 100);

  return (
    <div className="space-y-5">
      <div>
        <label htmlFor="csv" className="block text-sm font-medium text-ink">
          CSV file
        </label>
        <div
          className={`mt-2 rounded-2xl border border-dashed p-4 transition-colors sm:p-5 ${
            dragOver ? "border-accent bg-accent/8" : "border-line bg-canvas/40"
          }`}
          onDragOver={(event) => {
            event.preventDefault();
            if (!busy) setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(false);
            if (busy) return;
            const file = event.dataTransfer.files?.[0];
            if (file) loadFile(file);
          }}
        >
          <input
            id="csv"
            type="file"
            accept=".csv,text/csv"
            onChange={handleFile}
            disabled={busy}
            className="block w-full cursor-pointer text-sm text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-ink file:px-3 file:py-2 file:text-sm file:font-semibold file:text-canvas hover:file:bg-white disabled:cursor-not-allowed"
          />
          <p className="mt-2 text-xs leading-relaxed text-muted">
            Drop a file here or choose one. Parsed in the browser with PapaParse. The first row
            must contain column headers. Lines starting with # are ignored.
            {fileName ? (
              <>
                {" "}
                Loaded{" "}
                <span className="font-medium text-ink">{fileName}</span>.
              </>
            ) : null}
          </p>
        </div>
      </div>

      {notice && (
        <p className="rounded-2xl border border-amber-400/30 bg-amber-400/8 p-4 text-sm text-amber-50/90">
          {notice}
        </p>
      )}

      {headers.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div>
            <label htmlFor="column" className="block text-sm font-medium text-ink">
              Which column holds the message text?
            </label>
            <select
              id="column"
              value={column}
              onChange={(event) => {
                setColumn(event.target.value);
                resetResults();
              }}
              disabled={busy}
              className="field mt-2 py-2.5"
            >
              {headers.map((header) => (
                <option key={header} value={header}>
                  {header}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs text-muted">
              {fileName} · {rows.length} row(s) parsed · {nonEmptyCount} non-empty in “{column}” ·
              sent in chunks of {BATCH_CHUNK_SIZE}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void classifyAll()}
              disabled={disabled || busy || nonEmptyCount === 0}
              className="btn-primary"
            >
              {busy && <Spinner className="h-4 w-4 text-current" />}
              {busy ? "Classifying…" : `Classify ${nonEmptyCount} row(s)`}
            </button>
            {busy && (
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                className="btn-secondary"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      {disabled && (
        <p className="text-xs text-muted">
          Classification is unavailable until the API URL is set. You can still parse a CSV and
          pick a column.
        </p>
      )}

      {busy && (
        <div className="space-y-3">
          <LoadingState detail={`Row ${progress.completed} of ${progress.total} classified`} />
          <div
            className="h-1.5 overflow-hidden rounded-full bg-white/10"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progressPct}
            aria-label="Batch classification progress"
          >
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {results.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">
              <span className="font-medium text-ink">{classifiedCount}</span> of {results.length}{" "}
              row(s) classified
              {classifiedCount > 0 && (
                <>
                  {" "}
                  ·{" "}
                  <span className={needsReviewCount > 0 ? "font-medium text-amber-100" : ""}>
                    {needsReviewCount}
                  </span>{" "}
                  need review (issue confidence &lt; {thresholdPct}%)
                </>
              )}
            </p>
            <button
              type="button"
              onClick={downloadCsv}
              disabled={classifiedCount === 0}
              className="btn-secondary"
            >
              Download results as CSV
            </button>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-line">
            <table className="min-w-full divide-y divide-line text-sm">
              <thead className="sticky top-0 bg-surface-2">
                <tr className="text-left text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">
                  <th className="px-3 py-3">#</th>
                  <th className="min-w-[18rem] px-3 py-3">Message</th>
                  <th className="px-3 py-3">Issue</th>
                  <th className="px-3 py-3">Sentiment</th>
                  <th className="px-3 py-3">Urgency</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/80">
                {results.map((result) => {
                  const tone = urgencyTone(result.prediction?.urgency);
                  const score = formatScore(result.prediction?.urgency_score);
                  const issueConfidence = formatConfidence(
                    result.prediction?.confidence?.issue,
                  );
                  const sentimentConfidence = formatConfidence(
                    result.prediction?.confidence?.sentiment,
                  );
                  const issueAbstain =
                    !!result.prediction &&
                    shouldAbstainOnIssue(result.prediction.confidence?.issue);

                  return (
                    <tr
                      key={result.index}
                      className={`align-top hover:bg-white/[0.02] ${issueAbstain ? "bg-amber-400/[0.04]" : ""}`}
                    >
                      <td className="px-3 py-3 font-mono text-xs tabular-nums text-muted">
                        {result.index + 1}
                      </td>
                      <td className="max-w-md px-3 py-3 text-ink/90" title={result.text}>
                        <span className="line-clamp-3 block">{result.text || "—"}</span>
                      </td>

                      {result.prediction ? (
                        <>
                          <td className={`px-3 py-3 ${issueAbstain ? "text-ink/70" : "text-ink"}`}>
                            <span className={issueAbstain ? "font-normal" : ""}>
                              {formatLabel(result.prediction.issue)}
                            </span>
                            {issueConfidence && (
                              <span className="mt-0.5 block font-mono text-xs text-muted">
                                {issueConfidence}
                                {issueAbstain ? " · top guess" : ""}
                              </span>
                            )}
                            {issueAbstain && <NeedsReviewBadge />}
                          </td>
                          <td className="px-3 py-3 text-ink">
                            {formatLabel(result.prediction.sentiment)}
                            {sentimentConfidence && (
                              <span className="mt-0.5 block font-mono text-xs text-muted">
                                {sentimentConfidence}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-3">
                            <span
                              className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${URGENCY_STYLES[tone].badge}`}
                            >
                              {formatLabel(result.prediction.urgency)}
                            </span>
                            {score && (
                              <span className="mt-0.5 block font-mono text-xs text-muted">
                                {score}
                              </span>
                            )}
                          </td>
                        </>
                      ) : (
                        <td colSpan={3} className="px-3 py-3 text-xs text-muted">
                          {result.error ?? (busy ? "Queued…" : "Not classified")}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
