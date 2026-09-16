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

CI-equivalent (JSON artifact + non-zero exit if gates fail):

```bash
npm run eval:smoke:ci
# same as:
node eval/run.mjs --csv eval/synthetic-heldout.smoke.csv \
  --json eval-smoke-report.json --fail-on-gate --gates eval/gates.smoke.json
```

`--fail-on-gate` can also be enabled with `EVAL_FAIL_ON_GATE=1`.

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

Extra columns are ignored. Lines starting with `#` are comments (the eval
script and the in-browser CSV upload both skip them).

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
--gates path/to/gates.json   explicit pass/fail thresholds
--fail-on-gate               exit 1 if those thresholds fail
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
- Urgency **emergency recall** (gold emergency → predicted emergency)
- Urgency **false-emergency rate** (predicted emergency among non-emergency gold)
- Urgency **quadratic-weighted Cohen's kappa** on the ordinal set
  `{low, medium, emergency}` (no extra dependencies; labels outside that set
  are skipped)
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

## Gates (fail the process)

`eval/gates.smoke.json` is the default floor file when scoring
`eval/synthetic-heldout.smoke.csv`. Those numbers are **harness-health
thresholds**, not model-quality claims. They exist so CI goes red on a dead
API, an incomplete score, or a total urgency collapse:

| Check | Smoke default | Meaning |
| --- | --- | --- |
| `requireHealthOk` | true | `GET /health` reports `status: ok` |
| `requireModelLoaded` | true | health includes `model_loaded: true` |
| `requireCompleteScoring` | true | every gold row got a prediction |
| `minScoredRows` | 1 | at least one labeled row was scored |
| `urgency.minEmergencyRecall` | 0.01 | fail if gold emergencies exist and recall is 0 |
| `urgency.maxFalseEmergencyRate` | 0.99 | fail if non-emergency gold exists and 100% are predicted emergency |

If the CSV has no gold emergencies, emergency-recall is skipped (and the same
for false-emergency rate when every gold row is emergency). Edit the JSON to
raise floors once you have a private human-gold file.

Exit behavior:

- Health / HTTP / parse errors already exit 1.
- Metric floors only exit 1 when `--fail-on-gate` is set or `EVAL_FAIL_ON_GATE=1`.
- The JSON report is written **before** the gate failure, so CI can still
  upload `eval-smoke-report.json`.

Unit tests for the metric + gate math (no network):

```bash
npm test
```

## CI

GitHub Actions workflow: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)

On push and pull request to `master` or `main`, two **independent** jobs run:

| Job | Command | Needs Modal? |
| --- | --- | --- |
| `Frontend build` | `npm ci`, `npm test`, `npm run build` | no |
| `Live eval smoke (Modal)` | `npm run eval:smoke:ci` | yes (public `/health` + `/predict_batch`) |

Eval uses `continue-on-error: false`, so a Modal outage or a failed smoke gate
turns the **workflow** red. The build job still runs and can stay green on its
own. **Branch protection** is where you choose the merge policy:

- Require **both** jobs on `master` if urgency regressions should block merge
  (recommended once the workflow is trusted).
- Require only **Frontend build** if a Modal cold-start/outage must not block
  frontend-only PRs. Leave eval-smoke visible but optional.

The eval job has a 20-minute timeout (cold start ~40–120s). It uploads
`eval-smoke-report.json` as an artifact even when gates fail.

### Pointing a private human-gold CSV at CI later

Do **not** commit real customer messages. Keep gold outside git.

Suggested GitHub Actions pattern:

1. Store the labeled CSV in a repository secret (`EVAL_HELD_OUT_CSV`) **or**
   download it in the job from private storage (S3, GCS, an internal URL).
   A secret is only practical for a small file.
2. Write it to a runner-local path that is never checked in, e.g. `/tmp/heldout.csv`.
3. Use a **separate** gates file with the floors you actually believe
   (copy `eval/gates.smoke.json` and tighten). You can keep that JSON in the
   repo (thresholds only) or also load it from a secret (`EVAL_HELD_OUT_GATES`).
4. Score and upload:

```bash
printf '%s\n' "$EVAL_HELD_OUT_CSV" > /tmp/heldout.csv
node eval/run.mjs \
  --csv /tmp/heldout.csv \
  --json eval-heldout-report.json \
  --fail-on-gate \
  --gates eval/gates.heldout.json
rm -f /tmp/heldout.csv
```

5. Optional env: `EVAL_GATES_FILE`, `MULTIHEAD_API_URL`.

The smoke fixture includes a couple of **synthetic** explicit-de-escalation
rows (e.g. “si urgent”) so false-emergency rate is exercised. Smoke floors
still only fail on catastrophic collapse. Catching the known over-call as a
hard quality gate belongs on private gold with tighter `maxFalseEmergencyRate`.

## Training / retrain is out of this repo

This repository is UI + live-API eval only. Improving urgency (retrain,
loss weights, new labels) happens in the **Modal / training codebase**, then
this harness is pointed at the new deployment. Do not expect a frontend PR
to change model behavior.
