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
 *   node eval/run.mjs --csv eval/synthetic-heldout.smoke.csv --fail-on-gate --json report.json
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Papa from "papaparse";
import {
  evaluateGates,
  normalizeLabel,
  scoreUrgencyOps,
  truthyEnv,
} from "./urgency-ops.mjs";

const EVAL_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_API_BASE =
  "https://thechriskioko--threehead-serve-server-fastapi-app.modal.run";
const DEFAULT_CSV = "eval/synthetic-heldout.smoke.csv";
const SMOKE_CSV_BASENAME = "synthetic-heldout.smoke.csv";
const DEFAULT_SMOKE_GATES = resolve(EVAL_DIR, "gates.smoke.json");
/** Keep in lockstep with ISSUE_ABSTAIN_THRESHOLD in lib/trust.ts */
const DEFAULT_ABSTAIN_THRESHOLD = 0.6;
const DEFAULT_CHUNK_SIZE = 20;
/** Modal cold start can take ~40–120s; health is the first request. */
const HEALTH_TIMEOUT_MS = 120_000;
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
  --gates <path>               Gate thresholds JSON (default: eval/gates.smoke.json
                               when scoring the synthetic smoke CSV)
  --fail-on-gate               Exit 1 if gates fail (or set EVAL_FAIL_ON_GATE=1)
  --include-text               Include message snippets in logs and JSON (off by
                               default; do not enable in CI with private gold)
  --help                       Show this help

API URL resolution (first non-empty wins):
  1. --api-url
  2. MULTIHEAD_API_URL
  3. NEXT_PUBLIC_API_URL
  4. ${DEFAULT_API_BASE}

Gate file resolution (first non-empty wins):
  1. --gates
  2. EVAL_GATES_FILE
  3. eval/gates.smoke.json when the CSV basename is ${SMOKE_CSV_BASENAME}

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
    gates: "",
    failOnGate: truthyEnv("EVAL_FAIL_ON_GATE"),
    includeText: truthyEnv("EVAL_INCLUDE_TEXT"),
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
    else if (a === "--gates") out.gates = next();
    else if (a === "--fail-on-gate") out.failOnGate = true;
    else if (a === "--include-text") out.includeText = true;
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

function isSmokeCsv(csvPath) {
  return basename(csvPath) === SMOKE_CSV_BASENAME;
}

function resolveGatesPath(cliGates, csvPath) {
  const fromCli = (cliGates || "").trim();
  if (fromCli) return resolve(fromCli);
  const fromEnv = (process.env.EVAL_GATES_FILE || "").trim();
  if (fromEnv) return resolve(fromEnv);
  if (isSmokeCsv(csvPath)) return DEFAULT_SMOKE_GATES;
  return "";
}

function loadGates(gatesPath) {
  if (!gatesPath) return { path: "", spec: null };
  if (!existsSync(gatesPath)) {
    throw new Error(`Gates file not found: ${gatesPath}`);
  }
  let spec;
  try {
    spec = JSON.parse(readFileSync(gatesPath, "utf8"));
  } catch (err) {
    throw new Error(`Could not parse gates JSON ${gatesPath}: ${err instanceof Error ? err.message : err}`);
  }
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    throw new Error(`Gates file must be a JSON object: ${gatesPath}`);
  }
  return { path: gatesPath, spec };
}

function printUrgencyOps(ops) {
  printSection("urgency operations (CI-facing)");
  const rec = ops.emergencyRecall === null ? "n/a" : fmt(ops.emergencyRecall);
  const fer = ops.falseEmergencyRate === null ? "n/a" : fmt(ops.falseEmergencyRate);
  const kappa = ops.quadraticWeightedKappa === null ? "n/a" : fmt(ops.quadraticWeightedKappa);
  console.log(
    `  emergency recall       ${rec}  (${ops.emergencyHits}/${ops.emergencySupport} gold emergencies predicted emergency)`,
  );
  console.log(
    `  false-emergency rate   ${fer}  (${ops.falseEmergencyCount}/${ops.nonEmergencySupport} non-emergency gold predicted emergency)`,
  );
  console.log(`  quadratic κ (ordinal)  ${kappa}  (${ops.kappaMethod})`);
  if (ops.emergencySupport === 0) {
    console.log("  note  no gold emergency rows — emergency recall is not scored");
  }
  if (ops.nonEmergencySupport === 0) {
    console.log("  note  no non-emergency gold rows — false-emergency rate is not scored");
  }
}

function printGates(gateEval, gatesPath, failOnGate) {
  printSection(`gates${gatesPath ? `  (${gatesPath})` : ""}`);
  if (!gateEval) {
    console.log("  (no gates file — pass --gates <path> or score the smoke CSV)");
    return;
  }
  for (const row of gateEval.results) {
    console.log(`  ${row.ok ? "PASS" : "FAIL"}  ${row.id}  ${row.detail}`);
  }
  if (gateEval.results.length === 0) {
    console.log("  (gates file contained no applicable checks)");
  }
  console.log(`  overall                ${gateEval.passed ? "PASS" : "FAIL"}`);
  if (!failOnGate) {
    console.log("  fail-on-gate is off    (pass --fail-on-gate or EVAL_FAIL_ON_GATE=1 to exit 1)");
  }
}

function withoutText(item) {
  const { text, ...rest } = item;
  return rest;
}

function jsonRows(items, includeText) {
  return includeText ? items : items.map(withoutText);
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
  const failOnGate = Boolean(options.failOnGate);
  const includeText = Boolean(options.includeText);
  const gatesPath = resolveGatesPath(options.gates, csvPath);
  const loadedGates = gatesPath ? loadGates(gatesPath) : { path: "", spec: null };

  const loaded = loadGold(csvPath);
  if (loaded.rows.length === 0) {
    throw new Error(`No usable labeled rows in ${csvPath}. Need columns: text, issue, sentiment, urgency.`);
  }
  if (failOnGate && !loadedGates.spec) {
    throw new Error(
      "--fail-on-gate requires a gates file. Pass --gates <path>, set EVAL_GATES_FILE, or score eval/synthetic-heldout.smoke.csv (uses eval/gates.smoke.json).",
    );
  }

  console.log("Multi-head live-API eval");
  console.log(`  csv                 ${csvPath}`);
  console.log(`  rows                ${loaded.rows.length}` + (loaded.skipped.length ? ` (${loaded.skipped.length} skipped)` : ""));
  console.log(`  api                 ${apiBase}`);
  console.log(`  chunk size          ${chunkSize}`);
  console.log(`  abstain threshold   ${abstainThreshold}  (issue confidence; same default as lib/trust.ts ISSUE_ABSTAIN_THRESHOLD)`);
  console.log(`  gates               ${loadedGates.path || "(none)"}`);
  console.log(`  fail-on-gate        ${failOnGate ? "yes" : "no"}`);
  console.log(`  include text        ${includeText ? "yes (message snippets in logs/JSON)" : "no (redacted; pass --include-text)"}`);

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
  const urgencyOps = scoreUrgencyOps(urgGold, urgPred);

  const emergencyMissRows = [];
  const falseEmergencyRows = [];
  for (let i = 0; i < loaded.rows.length; i++) {
    const gold = normalizeLabel(urgGold[i]);
    const pred = normalizeLabel(urgPred[i]);
    const item = {
      id: loaded.rows[i].id,
      gold: urgGold[i],
      pred: urgPred[i],
    };
    if (includeText) item.text = loaded.rows[i].text.slice(0, 96);
    if (gold === "emergency" && pred !== "emergency") emergencyMissRows.push(item);
    if (gold !== "emergency" && pred === "emergency") falseEmergencyRows.push(item);
  }

  printHeadReport("issue", issueReport);
  printHeadReport("sentiment", sentReport);
  printHeadReport("urgency", urgReport);
  printUrgencyOps(urgencyOps);

  printSection("urgency misses / false emergencies (first 8 each)");
  const listUrgency = (title, items) => {
    console.log(`  ${title}  n=${items.length}`);
    if (items.length === 0) {
      console.log("    (none)");
      return;
    }
    for (const item of items.slice(0, 8)) {
      console.log(`    [${item.id}] gold=${item.gold}  pred=${item.pred}`);
      if (includeText && item.text) console.log(`         ${item.text}`);
    }
    if (items.length > 8) console.log(`    … ${items.length - 8} more`);
  };
  listUrgency("emergency misses (gold emergency, not predicted emergency)", emergencyMissRows);
  listUrgency("false emergencies (gold not emergency, predicted emergency)", falseEmergencyRows);
  if (!includeText) {
    console.log("  message text redacted (pass --include-text for local debugging; leave off in CI with private gold)");
  }

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
    };
    if (includeText) item.text = loaded.rows[i].text.slice(0, 96);
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
      if (includeText && item.text) console.log(`         ${item.text}`);
    }
    if (items.length > limit) console.log(`    … ${items.length - limit} more`);
  };
  listFlags("LOW confidence, INCORRECT", lowIncorrect);
  listFlags("LOW confidence, CORRECT (abstain would hide a good guess)", lowCorrect);
  listFlags("HIGH confidence, INCORRECT", highIncorrect);
  if (!includeText) {
    console.log("  message text redacted (pass --include-text for local debugging; leave off in CI with private gold)");
  }

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

  const gateEval = loadedGates.spec
    ? evaluateGates(loadedGates.spec, {
        health,
        nGold: loaded.rows.length,
        nPred: predictions.length,
        urgencyOps,
      })
    : null;

  const report = {
    generatedAt: new Date().toISOString(),
    csv: csvPath,
    apiBase,
    abstainThreshold,
    n: loaded.rows.length,
    skipped: loaded.skipped,
    includeText,
    health,
    heads: {
      issue: issueReport,
      sentiment: sentReport,
      urgency: {
        ...urgReport,
        emergencyRecall: urgencyOps.emergencyRecall,
        falseEmergencyRate: urgencyOps.falseEmergencyRate,
        quadraticWeightedKappa: urgencyOps.quadraticWeightedKappa,
      },
    },
    urgencyOps: {
      ...urgencyOps,
      emergencyMissRows: jsonRows(emergencyMissRows, includeText),
      falseEmergencyRows: jsonRows(falseEmergencyRows, includeText),
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
      lowCorrect: jsonRows(lowCorrect, includeText),
      lowIncorrect: jsonRows(lowIncorrect, includeText),
      highCorrect: jsonRows(highCorrect, includeText),
      highIncorrect: jsonRows(highIncorrect, includeText),
    },
    gates: {
      file: loadedGates.path || null,
      failOnGate,
      spec: loadedGates.spec,
      passed: gateEval ? gateEval.passed : null,
      results: gateEval ? gateEval.results : [],
    },
    note: "Synthetic smoke CSVs are not production gold. Smoke gate floors are harness-health thresholds, not model-quality claims. Quote numbers only from an actual run against the live API. Message text is omitted from this report unless --include-text / EVAL_INCLUDE_TEXT=1.",
  };

  printGates(gateEval, loadedGates.path, failOnGate);

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
  console.log(
    `  urgency    emergency-recall=${urgencyOps.emergencyRecall === null ? "n/a" : fmt(urgencyOps.emergencyRecall)}  false-emergency=${urgencyOps.falseEmergencyRate === null ? "n/a" : fmt(urgencyOps.falseEmergencyRate)}  q-κ=${urgencyOps.quadraticWeightedKappa === null ? "n/a" : fmt(urgencyOps.quadraticWeightedKappa)}`,
  );
  const atDefault = sweep.find((s) => s.threshold === abstainThreshold) ?? sweep.find((s) => s.threshold === 0.6);
  if (atDefault) {
    console.log(
      `  abstain@${atDefault.threshold.toFixed(2)}  rate=${pct(atDefault.abstain, loaded.rows.length)}  acc on accepted=${atDefault.accuracyAccepted === null ? "n/a" : fmt(atDefault.accuracyAccepted)}`,
    );
  }
  if (gateEval) {
    console.log(`  gates      ${gateEval.passed ? "PASS" : "FAIL"}  (${gateEval.results.filter((r) => !r.ok).length} failed of ${gateEval.results.length})`);
  }
  console.log("");

  if (failOnGate && gateEval && !gateEval.passed) {
    const failed = gateEval.results.filter((r) => !r.ok).map((r) => r.id);
    throw new Error(`Eval gates failed: ${failed.join(", ")}`);
  }

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
