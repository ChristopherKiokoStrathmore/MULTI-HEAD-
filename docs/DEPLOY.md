# Deploying the demo

This frontend is a Next.js app on Vercel. It does not ship model weights. The browser calls the model API directly, so the API base must be set at build time and the API must allow the Vercel origin.

Back to the project overview: [README](../README.md).

## Environment variable

There is one required variable:

| Variable | Required | Example | Notes |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | Yes | `https://your-model-api.example.com` | Base URL only of the deployed model API. Do not append `/predict`, `/health`, or `/predict_batch`. Trailing slashes are stripped. |

The app derives all three endpoints from it:

- `GET {NEXT_PUBLIC_API_URL}/health` warms the container when the page loads
- `POST {NEXT_PUBLIC_API_URL}/predict` sends `{"text": "..."}`
- `POST {NEXT_PUBLIC_API_URL}/predict_batch` sends `{"texts": [...]}`

If the variable is unset, the page still renders the demo chrome plus a configuration notice. Classify stays disabled until the URL is set.

The model API this demo is pointed at (set this as the base URL in Vercel, then redeploy):

```
https://thechriskioko--threehead-serve-server-fastapi-app.modal.run
```

`NEXT_PUBLIC_*` values are inlined at build time, not read at runtime. Changing the value in Vercel has no effect until you redeploy. If you update the URL and the site still calls the old host, that is why.

Local development uses the same key in `.env.local`. See the README for `npm run dev`.

## Set the variable in Vercel

1. Open [vercel.com](https://vercel.com) and select the project.
2. Go to Settings, then Environment Variables.
3. Add:
   - Key: `NEXT_PUBLIC_API_URL`
   - Value: the API base URL (no `/predict` suffix), for example the Modal host above
   - Environments: Production, Preview, and Development
4. Save, then open Deployments, open the latest one, and choose Redeploy. The variable is baked into the client bundle at build time, so an existing deployment will not pick it up on its own.

The same step from the CLI:

```bash
vercel env add NEXT_PUBLIC_API_URL production   # paste the value when prompted
vercel env pull .env.local                      # sync it down for local dev
```

## Deploy from the CLI

```bash
npm i -g vercel
vercel login
vercel          # first run links or creates the project and deploys a preview
vercel --prod   # deploy to production
```

## Deploy from Git

1. Push this directory to a GitHub, GitLab, or Bitbucket repository.
2. In Vercel: Add New, then Project, then Import that repository.
3. The framework preset is Next.js. The build command `npm run build` and the default output settings need no changes.
4. Add `NEXT_PUBLIC_API_URL` as above before the first build, then deploy.
5. Later pushes to the default branch ship to production. Other branches get preview URLs.

The live production demo is [https://multi-head.vercel.app](https://multi-head.vercel.app).

## CORS

The browser calls the model API directly from the Vercel domain. That is a cross-origin request, so the API must return CORS headers that permit it:

```
Access-Control-Allow-Origin: https://<your-app>.vercel.app
Access-Control-Allow-Headers: Content-Type
Access-Control-Allow-Methods: GET, POST, OPTIONS
```

The API must also answer the `OPTIONS` preflight the browser sends before every JSON `POST`. If CORS is missing, the request fails in the page as an opaque `TypeError: Failed to fetch`, with no status code and no body. The browser withholds the reason from JavaScript. The app says so in the error banner. The browser Network tab is where the underlying cause shows up.

This demo does not proxy through Next.js. The browser calls Modal directly. CORS on the current API already allows `*.vercel.app`. If you cannot change CORS later, the alternative is a same-origin route handler (`app/api/...`) with a server-only `API_URL` instead of `NEXT_PUBLIC_API_URL`.

## Cold starts

The backend scales to zero. The first request after an idle period takes 20-40 seconds. The app handles that in three ways:

- Warm-up on mount. `GET /health` fires as soon as the page loads and its response is discarded. The point is to start the container while the user is still typing. A status pill shows Warming up, then Model is warm.
- In-flight requests show a spinner, the message that waking the model can take up to 40 seconds on first use, and a live elapsed-seconds counter.
- Timeouts are 120 seconds for `/predict` and 180 seconds per `/predict_batch` chunk. A timeout produces a visible error rather than a hang.

CSV rows go to `/predict_batch` in sequential chunks of 20, not one large request. Concurrent requests against a cold container are the fastest way to trip its timeout. Chunking also keeps rows that already succeeded when a later chunk fails.

The live eval job allows a longer cold start (about 40-120 seconds) because `GET /health` blocks until the container has finished loading the model. See [eval/README.md](../eval/README.md).
