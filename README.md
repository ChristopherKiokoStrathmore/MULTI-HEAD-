# Customer-Care Message Classifier — Frontend

A single-page Next.js (App Router) demo UI for a remote multi-head classifier. It labels
customer-care messages on three axes: **Issue**, **Sentiment** and **Urgency**.

Two modes on one page:

1. **Single message** — a textbox and a *Classify* button, calling `POST /predict`.
2. **CSV upload** — parses a CSV in the browser with PapaParse, lets you pick which column
   holds the message text, calls `POST /predict_batch`, renders a results table, and offers
   the results back as a downloadable CSV.

The frontend holds no model logic and no hardcoded API URL. It talks only to the API named by
`NEXT_PUBLIC_API_URL` (read in `lib/api.ts`). The UI is a dark, operations-style demo: single-message
classification and CSV batch, with a health warm-up pill, cold-start elapsed timer, and
Issue / Sentiment / Urgency result cards. When issue confidence is below `0.6`, results are marked
**needs review / do not auto-route** while still showing the top guess for transparency.

---

## Environment variable

There is exactly one, and it is required:

| Variable | Required | Example | Notes |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | Yes | `https://your-model-api.example.com` | **Base URL only** of the deployed model API. Do **not** append `/predict`, `/health`, or `/predict_batch`. Trailing slashes are stripped automatically. |

The app derives all three endpoints from it:

- `GET {NEXT_PUBLIC_API_URL}/health` — warm-up, fired on page mount
- `POST {NEXT_PUBLIC_API_URL}/predict` — `{"text": "..."}`
- `POST {NEXT_PUBLIC_API_URL}/predict_batch` — `{"texts": [...]}`

If the variable is unset, the page still renders the full demo chrome plus a configuration
notice (not a silent failure, and not a placeholder host). Classify actions stay disabled
until the URL is set.

This project’s currently deployed model API (set this as the *base* URL in Vercel, then
redeploy):

```
https://thechriskioko--threehead-serve-server-fastapi-app.modal.run
```

> **`NEXT_PUBLIC_*` values are inlined at BUILD time, not read at runtime.**
> Changing this value in Vercel has no effect until you **redeploy**. This trips people up
> constantly — if you update the URL and the site still hits the old one, that is why.

---

## Local development

```bash
npm install
cp .env.example .env.local     # then edit .env.local and set the real URL
npm run dev                    # http://localhost:3000
```

A `sample-messages.csv` file is included at the repo root for exercising the CSV mode.

Other scripts:

```bash
npm run build         # production build
npm run start         # serve the production build locally
npm test              # eval harness unit tests (metrics/gates, no live API)
npm run eval:smoke    # score the synthetic fixture against the live API
npm run eval:smoke:ci # same as CI: JSON report + --fail-on-gate
npm run eval -- --csv /path/to/heldout.csv   # real labeled eval (see eval/README.md)
```

### Evaluation harness

`eval/` scores a labeled CSV against the **live** Modal API (`POST /predict_batch`). No local GPU.

- Schema, flags, gates, and how to swap in a real held-out file: **[eval/README.md](eval/README.md)**
- Fixture: `eval/synthetic-heldout.smoke.csv` — **synthetic smoke data, not production gold**, no customer PII
- Smoke floors: `eval/gates.smoke.json` — **harness-health** (API up, scoring finished, no total emergency collapse). Not a model-quality claim.
- Default abstain threshold is `0.6` (`ISSUE_ABSTAIN_THRESHOLD` in `lib/trust.ts`). Below that, the UI shows a needs-review state instead of treating the issue head as auto-routable.

Urgency reporting includes accuracy / macro-F1 plus **emergency recall**, **false-emergency rate**, and quadratic-weighted Cohen's kappa on `{low, medium, emergency}`.

API URL for eval (first non-empty wins): `--api-url`, `MULTIHEAD_API_URL`, `NEXT_PUBLIC_API_URL`, then the known Modal base. The Next.js app itself still reads **only** `NEXT_PUBLIC_API_URL`.

Improving urgency via retrain requires the **Modal / training codebase** (out of this repo). Re-run this harness against the new deployment.

---

## CI (GitHub Actions)

Workflow: [`.github/workflows/ci.yml`](.github/workflows/ci.yml)

On every push and pull request to `master` or `main`, two jobs run **in parallel** (neither `needs:` the other):

| Job | What | Modal |
| --- | --- | --- |
| **Frontend build** | `npm ci` → `npm test` → `npm run build` | no |
| **Live eval smoke (Modal)** | `npm run eval:smoke:ci`, upload `eval-smoke-report.json` | yes |

Eval is a first-class job with `continue-on-error: false`. A Modal outage or a failed smoke gate makes the workflow red, but the frontend job can still pass on its own. Whether that blocks merge is a **branch-protection** choice: require both checks on `master` to treat urgency collapse as blocking, or require only the build job if API downtime must not block frontend-only PRs.

Local equivalents of CI:

```bash
npm ci
npm test
npm run build
npm run eval:smoke:ci    # needs network egress to Modal; cold start 40–120s
```

Private human-gold in CI later: put the CSV in a GitHub Actions secret or private download, write it to a runner-local path, point `node eval/run.mjs --csv … --fail-on-gate --gates <your-floors.json>`. **Do not commit real customer data.** Details in [eval/README.md](eval/README.md).

---

## Deploying to Vercel

### Set the environment variable in the Vercel dashboard

1. Open [vercel.com](https://vercel.com) and select the project.
2. Go to **Settings → Environment Variables**.
3. Add:
   - **Key:** `NEXT_PUBLIC_API_URL`
   - **Value:** your API **base** URL (no `/predict` suffix), e.g.
     `https://thechriskioko--threehead-serve-server-fastapi-app.modal.run`
   - **Environments:** tick **Production**, **Preview** and **Development**.
4. **Save**, then go to **Deployments**, open the latest one, and choose
   **⋯ → Redeploy**. The variable is baked into the client bundle at build time, so an
   existing deployment will not pick it up on its own.

The same thing from the CLI, if you prefer:

```bash
vercel env add NEXT_PUBLIC_API_URL production   # paste the value when prompted
vercel env pull .env.local                      # sync it down for local dev
```

### Option A — deploy from the CLI

```bash
npm i -g vercel
vercel login
vercel          # first run links/creates the project, deploys a preview
vercel --prod   # deploy to production
```

### Option B — deploy from Git

1. Push this directory to a GitHub/GitLab/Bitbucket repository.
2. In Vercel: **Add New → Project → Import** that repository.
3. Framework preset is detected as **Next.js**; build command `npm run build` and the
   default output settings need no changes.
4. Add `NEXT_PUBLIC_API_URL` as above **before** the first build, then deploy.
5. Every later push to the default branch ships to production; other branches get preview
   URLs.

---

## The two things most likely to break this demo

### 1. CORS

The browser calls your model API **directly** from the Vercel domain. That is a
cross-origin request, so the API must return CORS headers permitting it:

```
Access-Control-Allow-Origin: https://<your-app>.vercel.app
Access-Control-Allow-Headers: Content-Type
Access-Control-Allow-Methods: GET, POST, OPTIONS
```

It must also answer the `OPTIONS` preflight that the browser sends before every JSON
`POST`. If CORS is missing, the request fails as an opaque `TypeError: Failed to fetch`
with **no status code and no body** — the browser withholds the reason from JavaScript.
The app detects this case and says so explicitly, but only the browser's Network tab shows
the underlying cause.

This demo does **not** proxy through Next.js: the browser calls Modal directly. CORS on the
API already allows `*.vercel.app`. If you cannot change CORS later, the alternative is a
same-origin route handler (`app/api/...`) with a server-only `API_URL` instead of
`NEXT_PUBLIC_API_URL`.

### 2. Cold starts

The backend scales to zero, so the first request after an idle period takes 20–40 seconds.
The app handles this in three ways:

- **Warm-up on mount.** `GET /health` fires as soon as the page loads and its response is
  discarded — the point is only to start the container booting while the user is still
  typing. A status pill shows *Warming up* → *Model is warm*.
- **Never looks frozen.** Any in-flight request shows a spinner, the message
  *"Waking up the model, this can take up to 40s on first use."*, and a live
  elapsed-seconds counter, so something on screen is always moving.
- **Generous timeouts.** 120s for `/predict`, 180s per `/predict_batch` chunk. A timeout
  produces a visible, specific error rather than a hang.

CSV rows are sent to `/predict_batch` in **sequential chunks of 20**, not one large
request. Concurrent requests to a cold container are the fastest way to trip its timeout,
and chunking means a failure partway through a large file keeps the rows that already
succeeded.

---

## Error handling

Failures are always shown, never swallowed. The banner reports the real text:

| Failure | What is displayed |
| --- | --- |
| Non-200 response | `HTTP <status> <statusText> from POST <url> — <response body>` |
| Timeout | Which URL timed out and after how many seconds |
| Network / CORS | The browser's message plus the three likely causes |
| Non-JSON body | The status plus the first 400 characters of what came back |
| Misaligned batch | How many predictions came back vs. how many rows were sent |
| `NEXT_PUBLIC_API_URL` unset | Instructions for setting it locally and on Vercel |

In CSV mode, rows already classified before a failure are kept and stay downloadable.

---

## Project structure

```
.
├── app/
│   ├── globals.css           # Tailwind v4 entry point
│   ├── layout.tsx            # root layout
│   └── page.tsx              # the single page (server component shell)
├── components/
│   ├── ClassifierApp.tsx     # mode switch + mount warm-up + health pill
│   ├── ConfigNotice.tsx      # empty state when NEXT_PUBLIC_API_URL is unset
│   ├── SingleMode.tsx        # textbox → POST /predict
│   ├── BatchMode.tsx         # CSV → column picker → POST /predict_batch → table
│   ├── PredictionCards.tsx   # the three labeled result cards (+ abstain notice)
│   ├── TrustNotice.tsx       # needs-review banner / badge
│   ├── LoadingState.tsx      # cold-start message + elapsed counter
│   ├── ErrorBanner.tsx       # verbatim error display
│   └── Spinner.tsx
├── lib/
│   ├── api.ts                # the ONLY place NEXT_PUBLIC_API_URL is read
│   ├── types.ts              # API response types
│   ├── format.ts             # confidence/score formatting
│   ├── examples.ts           # sample messages for the single-message demo
│   ├── urgency.ts            # urgency label → colour mapping
│   └── trust.ts              # ISSUE_ABSTAIN_THRESHOLD (0.6) and abstain helper
├── eval/
│   ├── README.md             # CSV schema, gates, CI, private gold pattern
│   ├── run.mjs               # live-API scoring script (no GPU)
│   ├── urgency-ops.mjs       # emergency recall / false-emergency / kappa / gates
│   ├── urgency-ops.test.mjs  # unit tests (no live API)
│   ├── gates.smoke.json      # explicit smoke floors (harness-health, not quality)
│   └── synthetic-heldout.smoke.csv  # synthetic smoke fixture, not gold
├── .github/workflows/ci.yml  # frontend build + live eval smoke
├── sample-messages.csv       # test file for CSV mode
├── .env.example
├── next.config.ts
├── postcss.config.mjs
├── tsconfig.json
└── package.json
```

## Display details

- **Urgency colours:** `low` = grey, `medium` = amber, `emergency` = red. Any other label
  is rendered neutrally with a dashed border rather than being coloured as if it were a
  known class.
- **Confidence** is shown as a small percentage under Issue and Sentiment. Values are
  accepted as either `0–1` or `0–100` and normalised to a percentage.
- **Issue abstain:** if issue confidence is below `ISSUE_ABSTAIN_THRESHOLD` (`0.6` in
  `lib/trust.ts`), the UI shows a **Needs review — do not auto-route** state. The top
  guess and confidence are still visible, but visually de-emphasised. The same rule
  applies to CSV/batch rows (`issue_needs_review` is included in the download). The live
  API does not return a runner-up issue, so the UI does not invent one.
- **`urgency_score`** is shown under the Urgency card when the API returns it, and is
  omitted when it does not.
