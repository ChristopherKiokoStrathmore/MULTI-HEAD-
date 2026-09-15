#!/usr/bin/env node
/**
 * Live-API evaluation harness for the three-head customer-care classifier.
 *
 * Scores a labeled CSV against POST /predict_batch on the Modal (or other)
 * API. No local GPU. See eval/README.md for schema and how to swap in a
 * real held-out file.
 *
 *   npm run eval:smoke
 *   node eval/run.mjs --csv path/to/heldout.csv
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import Papa from "papaparse";

const DEFAULT_API_BASE =
  "https://thechriskioko--threehead-serve-server-fastapi-app.modal.run";
const DEFAULT_CSV = "eval/synthetic-heldout.smoke.csv";
/** Keep in lockstep with ISSUE_ABSTAIN_THRESHOLD in lib/trust.ts */
const DEFAULT_ABSTAIN_THRESHOLD = 0.6;
const DEFAULT_CHUNK_SIZE = 20;
const HEALTH_TIMEOUT_MS = 60_000;
const BATCH_TIMEOUT_MS = 180_000;
const ABSTAIN_SWEEP = [0.4, 0.5, 0.6, 0.7, 0.8];

function printHelp() {
  console.log(`Usage: node eval/run.mjs [options]

Score a labeled CSV against the live three-head API.

Options:
  --csv <path>                 Labeled CSV (default: ${DEFAULT_CSV})
  --api-url <url>              API base URL (no /predict suffix)
  --chunk-size <n>             Rows per /predict_batch call (default: ${DEFAULT_CHUNK_SIZE})
  --abstain-threshold <0-1>    Issue-confidence cutoff (default: ${DEFAULT_ABSTAIN_THRESHOLD})
  --json <path>                Write a machine-readable report JSON
  --help                       Show this help

API URL resolution (first non-empty wins):
  1. --api-url
  2. MULTIHEAD_API_URL
  3. NEXT_PUBLIC_API_URL
  4. ${DEFAULT_API_BASE}

CSV schema (header row required):
  text            required  customer message
  issue           required  gold issue label (API snake_case, case-insensitive)
  sentiment       required  gold sentiment (negative | not_negative)
  urgency         required  gold urgency (low | medium | emergency)
  id              optional  row id echoed in low-confidence flags
  Extra columns are ignored. Lines starting with # are comments.
`);
}

function parseArgs(argv) {
  const out = {
    csv: DEFAULT_CSV,
    apiUrl: "",
    chunkSize: DEFAULT_CHUNK_SIZE,
    abstainThreshold: DEFAULT_ABSTAIN_THRESHOLD,
    json: "",
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Missing value after ${a}`);
      return v;
    };
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--csv") out.csv = next();
    else if (a === "--api-url") out.apiUrl = next();
    else if (a === "--chunk-size") out.chunkSize = Number(next());
    else if (a === "--abstain-threshold") out.abstainThreshold = Number(next());
    else if (a === "--json") out.json = next();
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!Number.isFinite(out.chunkSize) || out.chunkSize < 1) {
    throw new Error("--chunk-size must be a positive integer");
  }
  if (
    !Number.isFinite(out.abstainThreshold) ||
    out.abstainThreshold < 0 ||
    out.abstainThreshold > 1
  ) {
    throw new Error("--abstain-threshold must be between 0 and 1");
  }
  return out;
}

function resolveApiBase(cliUrl) {
  const fromEnv = (process.env.MULTIHEAD_API_URL || process.env.NEXT_PUBLIC_API_URL || "").trim();
  const raw = (cliUrl || fromEnv || DEFAULT_API_BASE).trim();
  return raw.replace(/\/+$/, "");
}

function normalizeLabel(raw) {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function confidence01(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value > 1 ? value / 100 : value;
}

async function fetchJson(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} from ${url} — ${text.slice(0, 400)}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`${url} returned HTTP ${res.status} but body was not JSON: ${text.slice(0, 200)}`);
    }
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s waiting for ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function loadGold(csvPath) {
  const raw = readFileSync(csvPath, "utf8");
  const parsed = Papa.parse(raw, {
    header: true,
    skipEmptyLines: "greedy",
    comments: "#",
    transformHeader: (h) => String(h ?? "").trim().toLowerCase(),
  });
  if (parsed.errors.length > 0) {
    const first = parsed.errors[0];
    console.warn(
      `CSV parse warning: ${first.message}` +
        (typeof first.row === "number" ? ` (row ${first.row})` : "") +
        (parsed.errors.length > 1 ? ` (+${parsed.errors.length - 1} more)` : ""),
    );
  }
  const rows = [];
  const skipped = [];
  for (const [i, rec] of parsed.data.entries()) {
    const text = String(rec.text ?? "").trim();
    const issue = String(rec.issue ?? "").trim();
    const sentiment = String(rec.sentiment ?? "").trim();
    const urgency = String(rec.urgency ?? "").trim();
    const id = String(rec.id ?? "").trim() || String(i + 1);
    if (!text || !issue || !sentiment || !urgency) {
      skipped.push({ row: i + 2, id, reason: "missing text/issue/sentiment/urgency" });
      continue;
    }
    rows.push({ id, text, issue, sentiment, urgency });
  }
  return { rows, skipped, fields: parsed.meta.fields ?? [] };
}

function emptyCounts() {
  return { tp: 0, fp: 0, fn: 0, support: 0 };
}

function scoreHead(goldLabels, predLabels) {
  const n = goldLabels.length;
  let correct = 0;
  const confusion = new Map(); // gold -> pred -> count
  const classes = new Set();
  for (let i = 0; i < n; i++) {
    const g = normalizeLabel(goldLabels[i]);
    const p = normalizeLabel(predLabels[i]);
    classes.add(g);
    classes.add(p);
    if (g === p) correct += 1;
    if (!confusion.has(g)) confusion.set(g, new Map());
    const row = confusion.get(g);
    row.set(p, (row.get(p) || 0) + 1);
  }

  const perClass = {};
  for (const c of [...classes].sort()) {
    perClass[c] = emptyCounts();
  }
  for (let i = 0; i < n; i++) {
    const g = normalizeLabel(goldLabels[i]);
    const p = normalizeLabel(predLabels[i]);
    perClass[g].support += 1;
    if (g === p) {
      perClass[g].tp += 1;
    } else {
      perClass[g].fn += 1;
      perClass[p].fp += 1;
    }
  }

  const classRows = Object.entries(perClass).map(([label, c]) => {
    const precision = c.tp + c.fp === 0 ? 0 : c.tp / (c.tp + c.fp);
    const recall = c.tp + c.fn === 0 ? 0 : c.tp / (c.tp + c.fn);
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    return { label, ...c, precision, recall, f1 };
  });

  const goldClasses = classRows.filter((r) => r.support > 0);
  const macroF1 =
    goldClasses.length === 0
      ? 0
      : goldClasses.reduce((s, r) => s + r.f1, 0) / goldClasses.length;

  const offDiag = [];
  for (const [g, row] of confusion) {
    for (const [p, count] of row) {
      if (g !== p) offDiag.push({ gold: g, pred: p, count });
    }
  }
  offDiag.sort((a, b) => b.count - a.count);

  return {
    n,
    correct,
    accuracy: n === 0 ? 0 : correct / n,
    macroF1,
    perClass: classRows,
    confusionPairs: offDiag,
  };
}

function histogram(values, binWidth = 0.1) {
  const bins = [];
  for (let start = 0; start < 1 - 1e-9; start += binWidth) {
    const end = Math.min(1, start + binWidth);
    bins.push({ start, end, count: 0 });
  }
  let missing = 0;
  for (const v of values) {
    if (v === null) {
      missing += 1;
      continue;
    }
    const clamped = Math.min(0.999999, Math.max(0, v));
    const idx = Math.min(bins.length - 1, Math.floor(clamped / binWidth));
    bins[idx].count += 1;
  }
  return { bins, missing };
}

function pct(n, d) {
  if (d === 0) return "n/a";
  return `${(100 * n / d).toFixed(1)}%`;
}

function fmt(n, digits = 3) {
  return Number(n).toFixed(digits);
}

function pad(s, w) {
  const str = String(s);
  return str.length >= w ? str : str + " ".repeat(w - str.length);
}

function padL(s, w) {
  const str = String(s);
  return str.length >= w ? str : " ".repeat(w - str.length) + str;
}

function printSection(title) {
  console.log(`\n=== ${title} ===`);
}

function printHeadReport(name, report) {
  printSection(`${name} head`);
  console.log(`  n          ${report.n}`);
  console.log(`  accuracy   ${fmt(report.accuracy)}  (${report.correct}/${report.n})`);
  console.log(`  macro-F1   ${fmt(report.macroF1)}  (unweighted mean of per-class F1 over gold labels with support)`);
  console.log("");
  console.log(
    "  " +
      pad("class", 28) +
      padL("support", 8) +
      padL("P", 8) +
      padL("R", 8) +
      padL("F1", 8),
  );
  for (const row of report.perClass) {
    if (row.support === 0 && row.fp === 0) continue;
    console.log(
      "  " +
        pad(row.label, 28) +
        padL(row.support, 8) +
        padL(fmt(row.precision), 8) +
        padL(fmt(row.recall), 8) +
        padL(fmt(row.f1), 8),
    );
  }
  if (report.confusionPairs.length === 0) {
    console.log("\n  confusion  (none — every gold label matched the prediction)");
  } else {
    console.log("\n  confusion  gold → predicted  (off-diagonal, top 12)");
    for (const pair of report.confusionPairs.slice(0, 12)) {
      console.log(`    ${pair.count}×  ${pair.gold}  →  ${pair.pred}`);
    }
  }
}

function printHistogram(title, hist, total) {
  printSection(title);
  const max = Math.max(1, ...hist.bins.map((b) => b.count));
  for (const b of hist.bins) {
    const bar = "█".repeat(Math.round((b.count / max) * 20));
    console.log(
      `  ${b.start.toFixed(1)}–${b.end.toFixed(1)}  ${padL(b.count, 4)}  ${bar}`,
    );
  }
  if (hist.missing) {
    console.log(`  missing     ${padL(hist.missing, 4)}  (treated as abstain)`);
  }
  console.log(`  total scored: ${total}`);
}

export async function runEval(options) {
  const csvPath = resolve(options.csv);
  const apiBase = resolveApiBase(options.apiUrl);
  const chunkSize = options.chunkSize;
  const abstainThreshold = options.abstainThreshold;

  const loaded = loadGold(csvPath);
  if (loaded.rows.length === 0) {
    throw new Error(`No usable labeled rows in ${csvPath}. Need columns: text, issue, sentiment, urgency.`);
  }

  console.log("Multi-head live-API eval");
  console.log(`  csv                 ${csvPath}`);
  console.log(`  rows                ${loaded.rows.length}` + (loaded.skipped.length ? ` (${loaded.skipped.length} skipped)` : ""));
  console.log(`  api                 ${apiBase}`);
  console.log(`  chunk size          ${chunkSize}`);
  console.log(`  abstain threshold   ${abstainThreshold}  (issue confidence; same default as lib/trust.ts ISSUE_ABSTAIN_THRESHOLD)`);

  printSection("health");
  const health = await fetchJson(`${apiBase}/health`, { method: "GET" }, HEALTH_TIMEOUT_MS);
  console.log(`  ${JSON.stringify(health)}`);

  const predictions = [];
  for (let start = 0; start < loaded.rows.length; start += chunkSize) {
    const chunk = loaded.rows.slice(start, start + chunkSize);
    const data = await fetchJson(
      `${apiBase}/predict_batch`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texts: chunk.map((r) => r.text) }),
      },
      BATCH_TIMEOUT_MS,
    );
    if (!Array.isArray(data) || data.length !== chunk.length) {
      throw new Error(
        `/predict_batch returned ${Array.isArray(data) ? data.length : typeof data} item(s) for ${chunk.length} text(s)`,
      );
    }
    predictions.push(...data);
    console.log(`  classified ${Math.min(start + chunk.length, loaded.rows.length)}/${loaded.rows.length}`);
  }

  const issueGold = loaded.rows.map((r) => r.issue);
  const sentGold = loaded.rows.map((r) => r.sentiment);
  const urgGold = loaded.rows.map((r) => r.urgency);
  const issuePred = predictions.map((p) => p.issue);
  const sentPred = predictions.map((p) => p.sentiment);
  const urgPred = predictions.map((p) => p.urgency);
  const issueConf = predictions.map((p) => confidence01(p?.confidence?.issue));
  const sentConf = predictions.map((p) => confidence01(p?.confidence?.sentiment));

  const issueReport = scoreHead(issueGold, issuePred);
  const sentReport = scoreHead(sentGold, sentPred);
  const urgReport = scoreHead(urgGold, urgPred);

  printHeadReport("issue", issueReport);
  printHeadReport("sentiment", sentReport);
  printHeadReport("urgency", urgReport);

  printHistogram("issue confidence histogram", histogram(issueConf), issueConf.length);
  printHistogram("sentiment confidence histogram", histogram(sentConf), sentConf.length);

  printSection(`issue abstain vs accuracy (threshold sweep)`);
  console.log(
    "  " +
      pad("thr", 6) +
      padL("abstain", 10) +
      padL("rate", 8) +
      padL("accept", 8) +
      padL("acc@accept", 12) +
      padL("acc@abstain", 13),
  );
  const sweep = [];
  for (const thr of ABSTAIN_SWEEP) {
    let abstain = 0;
    let acceptCorrect = 0;
    let acceptN = 0;
    let abstainCorrect = 0;
    for (let i = 0; i < loaded.rows.length; i++) {
      const conf = issueConf[i];
      const ok = normalizeLabel(issueGold[i]) === normalizeLabel(issuePred[i]);
      const doAbstain = conf === null || conf < thr;
      if (doAbstain) {
        abstain += 1;
        if (ok) abstainCorrect += 1;
      } else {
        acceptN += 1;
        if (ok) acceptCorrect += 1;
      }
    }
    const row = {
      threshold: thr,
      abstain,
      abstainRate: loaded.rows.length === 0 ? 0 : abstain / loaded.rows.length,
      accept: acceptN,
      accuracyAccepted: acceptN === 0 ? null : acceptCorrect / acceptN,
      accuracyAbstained: abstain === 0 ? null : abstainCorrect / abstain,
    };
    sweep.push(row);
    console.log(
      "  " +
        pad(thr.toFixed(2), 6) +
        padL(abstain, 10) +
        padL(pct(abstain, loaded.rows.length), 8) +
        padL(acceptN, 8) +
        padL(row.accuracyAccepted === null ? "n/a" : fmt(row.accuracyAccepted), 12) +
        padL(row.accuracyAbstained === null ? "n/a" : fmt(row.accuracyAbstained), 13),
    );
  }

  printSection(`low-confidence flags (issue conf < ${abstainThreshold})`);
  const lowCorrect = [];
  const lowIncorrect = [];
  const highCorrect = [];
  const highIncorrect = [];
  for (let i = 0; i < loaded.rows.length; i++) {
    const conf = issueConf[i];
    const ok = normalizeLabel(issueGold[i]) === normalizeLabel(issuePred[i]);
    const low = conf === null || conf < abstainThreshold;
    const item = {
      id: loaded.rows[i].id,
      gold: loaded.rows[i].issue,
      pred: predictions[i].issue,
      confidence: conf,
      text: loaded.rows[i].text.slice(0, 96),
    };
    if (low && ok) lowCorrect.push(item);
    else if (low && !ok) lowIncorrect.push(item);
    else if (!low && ok) highCorrect.push(item);
    else highIncorrect.push(item);
  }
  console.log(`  low + correct     ${lowCorrect.length}`);
  console.log(`  low + incorrect   ${lowIncorrect.length}   ← these are the ones abstain is meant to catch`);
  console.log(`  high + correct    ${highCorrect.length}`);
  console.log(`  high + incorrect  ${highIncorrect.length}   ← accepted but wrong (threshold may need raising)`);

  const listFlags = (title, items, limit = 8) => {
    console.log(`\n  ${title}`);
    if (items.length === 0) {
      console.log("    (none)");
      return;
    }
    for (const item of items.slice(0, limit)) {
      const c = item.confidence === null ? "n/a" : fmt(item.confidence);
      console.log(`    [${item.id}] conf=${c}  gold=${item.gold}  pred=${item.pred}`);
      console.log(`         ${item.text}`);
    }
    if (items.length > limit) console.log(`    … ${items.length - limit} more`);
  };
  listFlags("LOW confidence, INCORRECT", lowIncorrect);
  listFlags("LOW confidence, CORRECT (abstain would hide a good guess)", lowCorrect);
  listFlags("HIGH confidence, INCORRECT", highIncorrect);

  const mean = (arr) => (arr.length === 0 ? null : arr.reduce((s, x) => s + x, 0) / arr.length);
  const correctConfs = [];
  const incorrectConfs = [];
  for (let i = 0; i < loaded.rows.length; i++) {
    const conf = issueConf[i];
    if (conf === null) continue;
    if (normalizeLabel(issueGold[i]) === normalizeLabel(issuePred[i])) correctConfs.push(conf);
    else incorrectConfs.push(conf);
  }
  printSection("issue confidence vs correctness");
  console.log(`  mean conf | correct    ${correctConfs.length ? fmt(mean(correctConfs)) : "n/a"}  (n=${correctConfs.length})`);
  console.log(`  mean conf | incorrect  ${incorrectConfs.length ? fmt(mean(incorrectConfs)) : "n/a"}  (n=${incorrectConfs.length})`);

  const report = {
    generatedAt: new Date().toISOString(),
    csv: csvPath,
    apiBase,
    abstainThreshold,
    n: loaded.rows.length,
    skipped: loaded.skipped,
    health,
    heads: {
      issue: issueReport,
      sentiment: sentReport,
      urgency: urgReport,
    },
    issueConfidence: {
      histogram: histogram(issueConf),
      meanCorrect: mean(correctConfs),
      meanIncorrect: mean(incorrectConfs),
    },
    sentimentConfidence: {
      histogram: histogram(sentConf),
    },
    abstainSweep: sweep,
    flags: {
      lowCorrect,
      lowIncorrect,
      highCorrect: highCorrect.map(({ text, ...rest }) => rest),
      highIncorrect,
    },
    note: "Synthetic smoke CSVs are not production gold. Quote numbers only from an actual run against the live API.",
  };

  if (options.json) {
    const jsonPath = resolve(options.json);
    const serializable = JSON.parse(
      JSON.stringify(report, (_k, v) => (v instanceof Map ? Object.fromEntries(v) : v)),
    );
    writeFileSync(jsonPath, JSON.stringify(serializable, null, 2));
    console.log(`\nWrote JSON report to ${jsonPath}`);
  }

  printSection("summary");
  console.log(`  issue      acc=${fmt(issueReport.accuracy)}  macro-F1=${fmt(issueReport.macroF1)}`);
  console.log(`  sentiment  acc=${fmt(sentReport.accuracy)}  macro-F1=${fmt(sentReport.macroF1)}`);
  console.log(`  urgency    acc=${fmt(urgReport.accuracy)}  macro-F1=${fmt(urgReport.macroF1)}`);
  const atDefault = sweep.find((s) => s.threshold === abstainThreshold) ?? sweep.find((s) => s.threshold === 0.6);
  if (atDefault) {
    console.log(
      `  abstain@${atDefault.threshold.toFixed(2)}  rate=${pct(atDefault.abstain, loaded.rows.length)}  acc on accepted=${atDefault.accuracyAccepted === null ? "n/a" : fmt(atDefault.accuracyAccepted)}`,
    );
  }
  console.log("");
  return report;
}

const isDirect = import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirect) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      printHelp();
      process.exit(0);
    }
    await runEval(args);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
