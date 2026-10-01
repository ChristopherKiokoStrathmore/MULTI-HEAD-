# Synthetic smoke evaluation

**Label: synthetic smoke data.** This report scores `eval/synthetic-heldout.smoke.csv` against the live API. The fixture header says it is not production gold, not a real held-out set, and not customer PII. The numbers below are a harness check. They are not a model-quality claim, and they are not the held-out metrics from Kioko 2026.

Do not quote this file as model quality.

## Run

- `generatedAt`: `2026-10-01T07:38:16.517Z`
- Command:

```bash
node eval/run.mjs --csv eval/synthetic-heldout.smoke.csv --json /tmp/eval-out/eval-smoke-report.json
```

That is `npm run eval:smoke` plus a JSON path. `--fail-on-gate` was off for this run. The smoke gates were still evaluated and passed. Message text is omitted (`includeText: false`).

- CSV: `/workspace/eval/synthetic-heldout.smoke.csv`
- Rows scored: 22
- Rows skipped: 0
- API: `https://thechriskioko--threehead-serve-server-fastapi-app.modal.run`
- Issue abstain threshold: 0.6 (same default as `ISSUE_ABSTAIN_THRESHOLD` in `lib/trust.ts`)
- Gates file: `eval/gates.smoke.json` (copied into the JSON as an absolute path at run time)

## Health

```json
{
  "status": "ok",
  "model_loaded": true,
  "device": "cuda",
  "checkpoint": "/data/ckpt/joint_big_model.pt",
  "issue_classes": 10,
  "sent_classes": 2,
  "urgency_labels": [
    "low",
    "medium",
    "emergency"
  ]
}
```

## Summary

| Head | Accuracy | Correct | Macro-F1 |
| --- | ---: | ---: | ---: |
| Issue | 0.773 | 17/22 | 0.729 |
| Sentiment | 0.773 | 17/22 | 0.697 |
| Urgency | 0.727 | 16/22 | 0.703 |

Urgency operations, using the harness's 3-decimal print:

- Emergency recall: 1.000 (8/8 gold emergencies predicted emergency)
- False-emergency rate: 0.214 (3/14 non-emergency gold predicted emergency)
- Quadratic-weighted kappa: 0.682 (quadratic-weighted Cohen's kappa on ordinal {low, medium, emergency})

Issue abstain at 0.60: rate 13.6%, accuracy on accepted 0.895.

Macro-F1 is the unweighted mean of per-class F1 over gold labels with support. Rounding matches `fmt` in `eval/run.mjs` (three decimal places).

## Issue head

| class | support | precision | recall | F1 |
| --- | ---: | ---: | ---: | ---: |
| airtel_money_reversal | 2 | 1.000 | 1.000 | 1.000 |
| airtel_money_transfer | 2 | 0.667 | 1.000 | 0.800 |
| app_rewards | 2 | 1.000 | 1.000 | 1.000 |
| complaint_general | 2 | 1.000 | 1.000 | 1.000 |
| data_bundle_problems | 3 | 1.000 | 0.333 | 0.500 |
| network_issues | 2 | 1.000 | 0.500 | 0.667 |
| non_actionable | 2 | 0.000 | 0.000 | 0.000 |
| product_enquiry | 2 | 0.500 | 1.000 | 0.667 |
| router_wifi_5g | 3 | 0.750 | 1.000 | 0.857 |
| sim_line_services | 2 | 0.667 | 1.000 | 0.800 |

Off-diagonal confusion (gold to predicted):

- 2 rows: gold `data_bundle_problems`, predicted `product_enquiry`
- 1 row: gold `network_issues`, predicted `router_wifi_5g`
- 1 row: gold `non_actionable`, predicted `airtel_money_transfer`
- 1 row: gold `non_actionable`, predicted `sim_line_services`

## Sentiment head

| class | support | precision | recall | F1 |
| --- | ---: | ---: | ---: | ---: |
| negative | 17 | 0.875 | 0.824 | 0.848 |
| not_negative | 5 | 0.500 | 0.600 | 0.545 |

Off-diagonal confusion (gold to predicted):

- 3 rows: gold `negative`, predicted `not_negative`
- 2 rows: gold `not_negative`, predicted `negative`

## Urgency head

| class | support | precision | recall | F1 |
| --- | ---: | ---: | ---: | ---: |
| emergency | 8 | 0.727 | 1.000 | 0.842 |
| low | 7 | 1.000 | 0.429 | 0.600 |
| medium | 7 | 0.625 | 0.714 | 0.667 |

Off-diagonal confusion (gold to predicted):

- 3 rows: gold `low`, predicted `medium`
- 2 rows: gold `medium`, predicted `emergency`
- 1 row: gold `low`, predicted `emergency`

False emergencies (gold not emergency, predicted emergency):

- `s02`: gold `medium`, predicted `emergency`
- `s12`: gold `medium`, predicted `emergency`
- `s22`: gold `low`, predicted `emergency`

Emergency misses (gold emergency, predicted something else): 0.

## Confidence

Issue confidence vs correctness:

- Mean confidence when the issue label is correct: 0.962 (n=17)
- Mean confidence when the issue label is incorrect: 0.675 (n=5)

Issue confidence histogram (bins are 0.1 wide, as printed by the harness):

| bin | count |
| --- | ---: |
| 0.0-0.1 | 0 |
| 0.1-0.2 | 0 |
| 0.2-0.3 | 0 |
| 0.3-0.4 | 0 |
| 0.4-0.5 | 1 |
| 0.5-0.6 | 2 |
| 0.6-0.7 | 1 |
| 0.7-0.8 | 0 |
| 0.8-0.9 | 2 |
| 0.9-1.0 | 16 |

Sentiment confidence histogram:

| bin | count |
| --- | ---: |
| 0.0-0.1 | 0 |
| 0.1-0.2 | 0 |
| 0.2-0.3 | 0 |
| 0.3-0.4 | 0 |
| 0.4-0.5 | 0 |
| 0.5-0.6 | 0 |
| 0.6-0.7 | 2 |
| 0.7-0.8 | 0 |
| 0.8-0.9 | 3 |
| 0.9-1.0 | 17 |

## Issue abstain sweep

| threshold | abstain | rate | accepted | accuracy on accepted | accuracy on abstained |
| --- | ---: | ---: | ---: | ---: | ---: |
| 0.40 | 0 | 0.0% | 22 | 0.773 | n/a |
| 0.50 | 1 | 4.5% | 21 | 0.810 | 0.000 |
| 0.60 | 3 | 13.6% | 19 | 0.895 | 0.000 |
| 0.70 | 4 | 18.2% | 18 | 0.889 | 0.250 |
| 0.80 | 4 | 18.2% | 18 | 0.889 | 0.250 |

Counts at the UI threshold (0.6):

- Low confidence and correct: 0
- Low confidence and incorrect: 3
- High confidence and correct: 17
- High confidence and incorrect: 2

Low confidence and incorrect:

- `s10` confidence 0.590, gold `Data_Bundle_Problems`, predicted `Product_Enquiry`
- `s13` confidence 0.432, gold `Non_Actionable`, predicted `Airtel_Money_Transfer`
- `s21` confidence 0.537, gold `Data_Bundle_Problems`, predicted `Product_Enquiry`

Low confidence and correct:

- (none)

High confidence and incorrect:

- `s11` confidence 0.996, gold `Network_Issues`, predicted `Router_WiFi_5G`
- `s14` confidence 0.817, gold `Non_Actionable`, predicted `SIM_Line_Services`

## Gates

Overall: PASS. These floors are harness-health thresholds from `eval/gates.smoke.json`. The file's own note says they are not model-quality claims.

- PASS `health.ok`: health.status=ok
- PASS `health.model_loaded`: model_loaded=true
- PASS `scoring.complete`: predicted 22/22 rows
- PASS `scoring.minRows`: scored 22 (min 1)
- PASS `urgency.emergencyRecall`: 1 (min 0.01; 8/8 gold emergencies predicted emergency)
- PASS `urgency.falseEmergencyRate`: 0.2143 (max 0.99; 3/14 non-emergency gold predicted emergency)

Smoke gate detail for false-emergency rate, as returned by the harness: `0.2143 (max 0.99; 3/14 non-emergency gold predicted emergency)`.
