/**
 * Urgency operations metrics for the live-API eval harness.
 * No extra dependencies. Urgency is treated as ordinal: low < medium < emergency.
 */

export const URGENCY_ORDER = ["low", "medium", "emergency"];

export function normalizeLabel(raw) {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function round4(n) {
  return Number.isFinite(n) ? Number(n.toFixed(4)) : n;
}

/**
 * Quadratic-weighted Cohen's kappa on an ordered label set.
 * Labels outside `order` are skipped (not coerced). Returns null if nothing
 * usable remains. Perfect agreement when expected agreement is 1 yields 1.
 */
export function quadraticWeightedKappa(goldLabels, predLabels, order = URGENCY_ORDER) {
  const index = new Map(order.map((label, i) => [label, i]));
  const k = order.length;
  if (k < 2) return null;

  const matrix = Array.from({ length: k }, () => Array(k).fill(0));
  let n = 0;
  const len = Math.min(goldLabels.length, predLabels.length);
  for (let i = 0; i < len; i++) {
    const gi = index.get(normalizeLabel(goldLabels[i]));
    const pi = index.get(normalizeLabel(predLabels[i]));
    if (gi === undefined || pi === undefined) continue;
    matrix[gi][pi] += 1;
    n += 1;
  }
  if (n === 0) return null;

  const rowMarg = matrix.map((row) => row.reduce((s, x) => s + x, 0));
  const colMarg = Array(k).fill(0);
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) colMarg[j] += matrix[i][j];
  }

  const denom = (k - 1) * (k - 1);
  let po = 0;
  let pe = 0;
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      const w = 1 - ((i - j) * (i - j)) / denom;
      po += w * (matrix[i][j] / n);
      pe += w * ((rowMarg[i] * colMarg[j]) / (n * n));
    }
  }

  if (Math.abs(1 - pe) < 1e-12) return po >= 1 - 1e-12 ? 1 : 0;
  return (po - pe) / (1 - pe);
}

/**
 * Emergency recall, false-emergency rate, and ordinal kappa.
 *
 * - emergencyRecall: P(pred=emergency | gold=emergency); null if no gold emergencies
 * - falseEmergencyRate: P(pred=emergency | gold≠emergency); null if no non-emergency gold
 */
export function scoreUrgencyOps(goldLabels, predLabels) {
  const n = Math.min(goldLabels.length, predLabels.length);
  let emergencySupport = 0;
  let emergencyHits = 0;
  let nonEmergencySupport = 0;
  let falseEmergencyCount = 0;

  for (let i = 0; i < n; i++) {
    const g = normalizeLabel(goldLabels[i]);
    const p = normalizeLabel(predLabels[i]);
    const predEmergency = p === "emergency";
    if (g === "emergency") {
      emergencySupport += 1;
      if (predEmergency) emergencyHits += 1;
    } else {
      nonEmergencySupport += 1;
      if (predEmergency) falseEmergencyCount += 1;
    }
  }

  const emergencyMisses = emergencySupport - emergencyHits;
  const emergencyRecall = emergencySupport === 0 ? null : emergencyHits / emergencySupport;
  const falseEmergencyRate =
    nonEmergencySupport === 0 ? null : falseEmergencyCount / nonEmergencySupport;
  const kappa = quadraticWeightedKappa(goldLabels, predLabels);

  return {
    n,
    emergencySupport,
    emergencyHits,
    emergencyMisses,
    emergencyRecall,
    nonEmergencySupport,
    falseEmergencyCount,
    falseEmergencyRate,
    quadraticWeightedKappa: kappa,
    kappaMethod: "quadratic-weighted Cohen's kappa on ordinal {low, medium, emergency}",
  };
}

/** True only when health.status is "ok" (case-insensitive). Matches the live Modal contract. */
export function healthIsOk(health) {
  if (!health || typeof health !== "object") return false;
  return String(health.status ?? "").trim().toLowerCase() === "ok";
}

function gateResult(id, ok, detail) {
  return { id, ok, detail };
}

/**
 * Compare a scored run against an explicit gates JSON object.
 * Missing optional fields are skipped. Null metrics (no support) are skipped
 * when the matching skip* flag is true (the default).
 */
export function evaluateGates(gates, ctx) {
  const results = [];
  const spec = gates && typeof gates === "object" ? gates : {};
  const health = ctx.health;
  const nGold = ctx.nGold ?? 0;
  const nPred = ctx.nPred ?? 0;
  const ops = ctx.urgencyOps || scoreUrgencyOps([], []);

  if (spec.requireHealthOk) {
    results.push(
      gateResult(
        "health.ok",
        healthIsOk(health),
        `health.status=${health?.status ?? "missing"}`,
      ),
    );
  }
  if (spec.requireModelLoaded) {
    results.push(
      gateResult(
        "health.model_loaded",
        health?.model_loaded === true,
        `model_loaded=${String(health?.model_loaded)}`,
      ),
    );
  }
  if (spec.requireCompleteScoring) {
    results.push(
      gateResult(
        "scoring.complete",
        nGold > 0 && nPred === nGold,
        `predicted ${nPred}/${nGold} rows`,
      ),
    );
  }
  if (typeof spec.minScoredRows === "number") {
    results.push(
      gateResult(
        "scoring.minRows",
        nPred >= spec.minScoredRows,
        `scored ${nPred} (min ${spec.minScoredRows})`,
      ),
    );
  }

  const u = spec.urgency && typeof spec.urgency === "object" ? spec.urgency : {};
  const skipRecallZero =
    u.skipEmergencyRecallIfSupportZero !== false && ops.emergencySupport === 0;
  const skipFerZero =
    u.skipFalseEmergencyRateIfSupportZero !== false && ops.nonEmergencySupport === 0;

  if (!skipRecallZero && typeof u.minEmergencyRecall === "number") {
    const rec = ops.emergencyRecall;
    const ok = rec !== null && rec + 1e-12 >= u.minEmergencyRecall;
    results.push(
      gateResult(
        "urgency.emergencyRecall",
        ok,
        rec === null
          ? "emergency recall n/a (no gold emergencies)"
          : `${round4(rec)} (min ${u.minEmergencyRecall}; ${ops.emergencyHits}/${ops.emergencySupport} gold emergencies predicted emergency)`,
      ),
    );
  }
  if (!skipFerZero && typeof u.maxFalseEmergencyRate === "number") {
    const fer = ops.falseEmergencyRate;
    const ok = fer !== null && fer - 1e-12 <= u.maxFalseEmergencyRate;
    results.push(
      gateResult(
        "urgency.falseEmergencyRate",
        ok,
        fer === null
          ? "false-emergency rate n/a (no non-emergency gold)"
          : `${round4(fer)} (max ${u.maxFalseEmergencyRate}; ${ops.falseEmergencyCount}/${ops.nonEmergencySupport} non-emergency gold predicted emergency)`,
      ),
    );
  }

  return {
    passed: results.every((r) => r.ok),
    results,
  };
}

export function truthyEnv(name) {
  const v = String(process.env[name] ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}
