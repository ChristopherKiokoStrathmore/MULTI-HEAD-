"use client";

import { useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import type { Prediction, RowResult } from "@/lib/types";
import { BATCH_CHUNK_SIZE, errorText, predictBatchChunked } from "@/lib/api";
import { formatConfidence, formatLabel, formatScore } from "@/lib/format";
import { urgencyTone, URGENCY_STYLES } from "@/lib/urgency";
import LoadingState from "./LoadingState";
import ErrorBanner from "./ErrorBanner";
import Spinner from "./Spinner";

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
  const progressPct =
    progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;

  return (
    <div className="space-y-6">
      <div>
        <label htmlFor="csv" className="block text-[13px] font-medium text-ink">
          CSV file
        </label>
        <div
          className={`mt-3 rounded-[1.4rem] border border-dashed p-5 transition-colors sm:p-6 ${
            dragOver ? "border-accent bg-accent/8" : "border-white/12 bg-surface"
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
            className="block w-full cursor-pointer text-[13px] text-muted file:mr-3 file:rounded-full file:border-0 file:bg-ink file:px-4 file:py-2 file:text-[13px] file:font-medium file:text-canvas hover:file:bg-white disabled:cursor-not-allowed"
          />
          <p className="mt-3 text-[13px] leading-relaxed text-muted">
            Drop a file here or choose one. Parsed in the browser with PapaParse. The first row
            must contain column headers.
            {fileName ? (
              <>
                {" "}
                Loaded <span className="font-medium text-ink">{fileName}</span>.
              </>
            ) : null}
          </p>
        </div>
      </div>

      {notice && (
        <p className="rounded-[1.2rem] bg-surface px-5 py-4 text-[14px] leading-relaxed text-muted">
          {notice}
        </p>
      )}

      {headers.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div>
            <label htmlFor="column" className="block text-[13px] font-medium text-ink">
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
              className="field mt-3 py-2.5 text-[15px]"
            >
              {headers.map((header) => (
                <option key={header} value={header}>
                  {header}
                </option>
              ))}
            </select>
            <p className="mt-2 text-[12px] text-muted">
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
        <p className="text-[12px] text-muted">
          Classification is unavailable until the API URL is set. You can still parse a CSV and
          pick a column.
        </p>
      )}

      {busy && (
        <div className="space-y-3">
          <LoadingState detail={`Row ${progress.completed} of ${progress.total} classified`} />
          <div
            className="h-1 overflow-hidden rounded-full bg-white/8"
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
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[14px] text-muted">
              <span className="font-medium text-ink">{classifiedCount}</span> of {results.length}{" "}
              row(s) classified
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

          <div className="overflow-x-auto rounded-[1.4rem] bg-surface">
            <table className="min-w-full divide-y divide-white/8 text-[14px]">
              <thead>
                <tr className="text-left text-[11px] font-medium tracking-wide text-muted">
                  <th className="px-4 py-3.5">#</th>
                  <th className="min-w-[18rem] px-4 py-3.5">Message</th>
                  <th className="px-4 py-3.5">Issue</th>
                  <th className="px-4 py-3.5">Sentiment</th>
                  <th className="px-4 py-3.5">Urgency</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/6">
                {results.map((result) => {
                  const tone = urgencyTone(result.prediction?.urgency);
                  const score = formatScore(result.prediction?.urgency_score);
                  const issueConfidence = formatConfidence(
                    result.prediction?.confidence?.issue,
                  );
                  const sentimentConfidence = formatConfidence(
                    result.prediction?.confidence?.sentiment,
                  );

                  return (
                    <tr key={result.index} className="align-top hover:bg-white/[0.025]">
                      <td className="px-4 py-3.5 font-mono text-[12px] tabular-nums text-muted">
                        {result.index + 1}
                      </td>
                      <td className="max-w-md px-4 py-3.5 text-ink/90" title={result.text}>
                        <span className="line-clamp-3 block">{result.text || "—"}</span>
                      </td>

                      {result.prediction ? (
                        <>
                          <td className="px-4 py-3.5 text-ink">
                            {formatLabel(result.prediction.issue)}
                            {issueConfidence && (
                              <span className="mt-0.5 block font-mono text-[11px] text-muted">
                                {issueConfidence}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3.5 text-ink">
                            {formatLabel(result.prediction.sentiment)}
                            {sentimentConfidence && (
                              <span className="mt-0.5 block font-mono text-[11px] text-muted">
                                {sentimentConfidence}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3.5">
                            <span
                              className={`inline-block rounded-full px-2.5 py-0.5 text-[12px] font-medium ${URGENCY_STYLES[tone].badge}`}
                            >
                              {formatLabel(result.prediction.urgency)}
                            </span>
                            {score && (
                              <span className="mt-0.5 block font-mono text-[11px] text-muted">
                                {score}
                              </span>
                            )}
                          </td>
                        </>
                      ) : (
                        <td colSpan={3} className="px-4 py-3.5 text-[12px] text-muted">
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
