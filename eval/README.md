# Live-API evaluation harness

Scores a **labeled CSV** against the deployed three-head classifier
(`POST /predict_batch`). No local GPU and no training code — those live on
Chris’s machine, not in this repo.

This is how you measure whether issue-head softmax is trustworthy enough to
auto-route, **before** changing the model.

## Quick start (synthetic smoke)

From the repo root, with network access to Modal:

```bash
npm run eval:smoke
```

That runs:

```bash
node eval/run.mjs --csv eval/synthetic-heldout.smoke.csv
```

`eval/synthetic-heldout.smoke.csv` is **synthetic smoke data**, not production
gold and not a real held-out set. It has no customer PII. Use it only to prove
the harness talks to the live API and prints metrics. **Do not quote those
numbers as model quality.**

## CSV schema

Header row required. Column names are matched case-insensitively.

| Column | Required | Meaning |
| --- | --- | --- |
| `text` | yes | Customer message sent to `POST /predict_batch` |
| `issue` | yes | Gold issue label |
| `sentiment` | yes | Gold sentiment label |
| `urgency` | yes | Gold urgency label |
| `id` | no | Echoed in low-confidence flags (defaults to row number) |

Extra columns are ignored. Lines starting with `#` are comments.

Labels are compared after a light normalize: trim, lower-case, spaces/hyphens
→ underscores. They should still match the **API’s snake_case** strings.

Known issue classes (10) observed from the live API:

- `Airtel_Money_Reversal`
- `Airtel_Money_Transfer`
- `App_Rewards`
- `Complaint_General`
- `Data_Bundle_Problems`
- `Network_Issues`
- `Non_Actionable`
- `Product_Enquiry`
- `Router_WiFi_5G`
- `SIM_Line_Services`

Sentiment (2): `negative`, `not_negative`

Urgency (3): `low`, `medium`, `emergency`

## Swap in a real held-out CSV

1. Export a labeled file from the training box (the data that is **not** in
   this GitHub repo). Keep PII out of git: put the file outside the repo, or
   in a local path that `.gitignore` already covers (e.g. do not commit it).
2. Use the same column names as above. A typical command:

```bash
node eval/run.mjs --csv /path/to/real-heldout.csv --json eval-report.json
```

3. Optional flags:

```
--api-url <url>              override the API base
--chunk-size 20              rows per /predict_batch call
--abstain-threshold 0.6      issue-confidence cutoff (same default as the UI)
--json report.json           machine-readable copy of the printed metrics
```

API URL resolution (first non-empty wins): `--api-url`, then
`MULTIHEAD_API_URL`, then `NEXT_PUBLIC_API_URL`, then the known Modal base
`https://thechriskioko--threehead-serve-server-fastapi-app.modal.run`.

The frontend still reads **only** `NEXT_PUBLIC_API_URL` and never hardcodes
the host. The eval default exists so `npm run eval:smoke` works without a
`.env.local`.

## What it prints

- Per-head **accuracy** and **macro-F1** (unweighted mean of per-class F1 over
  gold labels that appear in the file)
- Per-class precision / recall / F1 / support
- Off-diagonal **confusion** pairs (gold → predicted)
- Issue and sentiment **confidence histograms** (0.1-wide bins)
- **Abstain rate** and accuracy-on-accepted at thresholds 0.40–0.80
- Low-confidence **correct vs incorrect** rows at `--abstain-threshold`
  (default `0.6`, the same named constant as `ISSUE_ABSTAIN_THRESHOLD` in
  `lib/trust.ts`)

On a 10-class issue head, a top softmax around **0.5** is often not enough to
trust. The UI abstains below `0.6`; use this harness to decide whether that
cutoff is right on real held-out data.

## Runner-up issues

The live `POST /predict` payload is `{ issue, sentiment, urgency,
urgency_score, confidence.issue, confidence.sentiment }`. It does **not**
return a second-best issue, so the harness cannot score top-2 without a
backend change.
