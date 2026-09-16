import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateGates,
  healthIsOk,
  quadraticWeightedKappa,
  scoreUrgencyOps,
} from "./urgency-ops.mjs";

describe("scoreUrgencyOps", () => {
  it("computes emergency recall on gold emergencies only", () => {
    const gold = ["emergency", "emergency", "low", "medium"];
    const pred = ["emergency", "medium", "low", "emergency"];
    const ops = scoreUrgencyOps(gold, pred);
    assert.equal(ops.emergencySupport, 2);
    assert.equal(ops.emergencyHits, 1);
    assert.equal(ops.emergencyMisses, 1);
    assert.equal(ops.emergencyRecall, 0.5);
    assert.equal(ops.nonEmergencySupport, 2);
    assert.equal(ops.falseEmergencyCount, 1);
    assert.equal(ops.falseEmergencyRate, 0.5);
  });

  it("returns null recall / FER when that side has no support", () => {
    const allEmergency = scoreUrgencyOps(["emergency"], ["emergency"]);
    assert.equal(allEmergency.emergencyRecall, 1);
    assert.equal(allEmergency.falseEmergencyRate, null);

    const noneEmergency = scoreUrgencyOps(["low"], ["low"]);
    assert.equal(noneEmergency.emergencyRecall, null);
    assert.equal(noneEmergency.falseEmergencyRate, 0);
  });

  it("treats a 100% false-emergency collapse as rate 1", () => {
    const ops = scoreUrgencyOps(["low", "medium"], ["emergency", "emergency"]);
    assert.equal(ops.falseEmergencyRate, 1);
    assert.equal(ops.emergencyRecall, null);
  });

  it("treats a 0% emergency recall collapse as rate 0", () => {
    const ops = scoreUrgencyOps(["emergency", "emergency"], ["low", "medium"]);
    assert.equal(ops.emergencyRecall, 0);
    assert.equal(ops.emergencyHits, 0);
  });

  it("normalizes label spelling", () => {
    const ops = scoreUrgencyOps(["Emergency", "LOW"], [" emergency ", "Low"]);
    assert.equal(ops.emergencyRecall, 1);
    assert.equal(ops.falseEmergencyRate, 0);
  });
});

describe("quadraticWeightedKappa", () => {
  it("is 1 on perfect ordinal agreement", () => {
    const labels = ["low", "medium", "emergency", "low"];
    assert.equal(quadraticWeightedKappa(labels, labels), 1);
  });

  it("is lower when adjacent errors beat opposite-end errors", () => {
    const gold = ["low", "low", "emergency", "emergency"];
    const adjacent = ["medium", "medium", "medium", "medium"];
    const opposite = ["emergency", "emergency", "low", "low"];
    const kAdj = quadraticWeightedKappa(gold, adjacent);
    const kOpp = quadraticWeightedKappa(gold, opposite);
    assert.ok(kAdj > kOpp, `expected adjacent ${kAdj} > opposite ${kOpp}`);
  });

  it("returns null when no ordinal labels remain", () => {
    assert.equal(quadraticWeightedKappa(["unknown"], ["mystery"]), null);
  });
});

describe("evaluateGates", () => {
  const smokeGates = {
    requireHealthOk: true,
    requireModelLoaded: true,
    requireCompleteScoring: true,
    minScoredRows: 1,
    urgency: {
      minEmergencyRecall: 0.01,
      maxFalseEmergencyRate: 0.99,
      skipEmergencyRecallIfSupportZero: true,
      skipFalseEmergencyRateIfSupportZero: true,
    },
  };

  const healthy = { status: "ok", model_loaded: true };

  it("passes a mixed non-collapse run", () => {
    const ops = scoreUrgencyOps(
      ["emergency", "emergency", "low", "medium"],
      ["emergency", "medium", "low", "low"],
    );
    const { passed, results } = evaluateGates(smokeGates, {
      health: healthy,
      nGold: 4,
      nPred: 4,
      urgencyOps: ops,
    });
    assert.equal(passed, true, JSON.stringify(results, null, 2));
  });

  it("fails when emergency recall is 0 on gold emergencies", () => {
    const ops = scoreUrgencyOps(["emergency", "low"], ["low", "low"]);
    const { passed, results } = evaluateGates(smokeGates, {
      health: healthy,
      nGold: 2,
      nPred: 2,
      urgencyOps: ops,
    });
    assert.equal(passed, false);
    const recall = results.find((r) => r.id === "urgency.emergencyRecall");
    assert.equal(recall.ok, false);
  });

  it("fails when every non-emergency is predicted emergency", () => {
    const ops = scoreUrgencyOps(["low", "medium"], ["emergency", "emergency"]);
    const { passed, results } = evaluateGates(smokeGates, {
      health: healthy,
      nGold: 2,
      nPred: 2,
      urgencyOps: ops,
    });
    assert.equal(passed, false);
    const fer = results.find((r) => r.id === "urgency.falseEmergencyRate");
    assert.equal(fer.ok, false);
  });

  it("skips recall / FER when that gold class is absent", () => {
    const ops = scoreUrgencyOps(["low"], ["low"]);
    const { passed, results } = evaluateGates(smokeGates, {
      health: healthy,
      nGold: 1,
      nPred: 1,
      urgencyOps: ops,
    });
    assert.equal(passed, true, JSON.stringify(results, null, 2));
    assert.equal(
      results.some((r) => r.id === "urgency.emergencyRecall"),
      false,
    );
  });

  it("fails unhealthy or incomplete scoring", () => {
    const ops = scoreUrgencyOps(["emergency"], ["emergency"]);
    const unhealthy = evaluateGates(smokeGates, {
      health: { status: "starting", model_loaded: false },
      nGold: 1,
      nPred: 1,
      urgencyOps: ops,
    });
    assert.equal(unhealthy.passed, false);
    const incomplete = evaluateGates(smokeGates, {
      health: healthy,
      nGold: 4,
      nPred: 2,
      urgencyOps: ops,
    });
    assert.equal(incomplete.passed, false);
  });
});

describe("healthIsOk", () => {
  it("accepts the live Modal health shape", () => {
    assert.equal(healthIsOk({ status: "ok", model_loaded: true }), true);
    assert.equal(healthIsOk({ status: "warming" }), false);
    assert.equal(healthIsOk(null), false);
  });
});
