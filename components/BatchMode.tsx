"use client";

import { useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import type { Prediction, RowResult } from "@/lib/types";
import { BATCH_CHUNK_SIZE, errorText, predictBatchChunked } from "@/lib/api";
import { formatConfidence, formatScore } from "@/lib/format";
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

  function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

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

  async function classifyAll() {
    if (busy || !column || rows.length === 0) return;

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

  return (
    <div className="space-y-5">
      <div>
        <label htmlFor="csv" className="block text-sm font-medium text-slate-800">
          CSV file
        </label>
        <input
          id="csv"
          type="file"
          accept=".csv,text/csv"
          onChange={handleFile}
          disabled={disabled || busy}
          className="mt-1 block w-full cursor-pointer rounded-lg border border-slate-300 bg-white p-2 text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-100"
        />
        <p className="mt-1 text-xs text-slate-500">
          Parsed in the browser with PapaParse. The first row must contain column headers.
        </p>
      </div>

      {notice && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {notice}
        </p>
      )}

      {headers.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div>
            <label htmlFor="column" className="block text-sm font-medium text-slate-800">
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
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm text-slate-900 focus:border-slate-500 focus:ring-2 focus:ring-slate-200 focus:outline-none disabled:bg-slate-100"
            >
              {headers.map((header) => (
                <option key={header} value={header}>
                  {header}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-500">
              {fileName} &middot; {rows.length} row(s) parsed &middot; {nonEmptyCount}{" "}
              non-empty in &ldquo;{column}&rdquo; &middot; sent in chunks of{" "}
              {BATCH_CHUNK_SIZE}
            </p>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={classifyAll}
              disabled={disabled || busy || nonEmptyCount === 0}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {busy && <Spinner className="h-4 w-4 text-white" />}
              {busy ? "Classifying..." : `Classify ${nonEmptyCount} row(s)`}
            </button>
            {busy && (
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      {busy && (
        <LoadingState detail={`Row ${progress.completed} of ${progress.total} classified`} />
      )}

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {results.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-600">
              {classifiedCount} of {results.length} row(s) classified
            </p>
            <button
              type="button"
              onClick={downloadCsv}
              disabled={classifiedCount === 0}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"
            >
              Download results as CSV
            </button>
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-100">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                  <th className="px-3 py-2">#</th>
                  <th className="min-w-[18rem] px-3 py-2">Message</th>
                  <th className="px-3 py-2">Issue</th>
                  <th className="px-3 py-2">Sentiment</th>
                  <th className="px-3 py-2">Urgency</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
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
                    <tr key={result.index} className="align-top">
                      <td className="px-3 py-2 text-xs text-slate-400">{result.index + 1}</td>
                      <td className="max-w-md px-3 py-2 text-slate-800" title={result.text}>
                        <span className="line-clamp-3 block">{result.text || "-"}</span>
                      </td>

                      {result.prediction ? (
                        <>
                          <td className="px-3 py-2 text-slate-800">
                            {result.prediction.issue}
                            {issueConfidence && (
                              <span className="block text-xs text-slate-500">
                                {issueConfidence}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-slate-800">
                            {result.prediction.sentiment}
                            {sentimentConfidence && (
                              <span className="block text-xs text-slate-500">
                                {sentimentConfidence}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${URGENCY_STYLES[tone].badge}`}
                            >
                              {result.prediction.urgency}
                            </span>
                            {score && <span className="block text-xs text-slate-500">{score}</span>}
                          </td>
                        </>
                      ) : (
                        <td colSpan={3} className="px-3 py-2 text-xs text-slate-500">
                          {result.error ?? (busy ? "Queued..." : "Not classified")}
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
