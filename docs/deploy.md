# Deploying the navigator

The site runs in the team's Firebase project, `nasa-challenge-a8b4a`, in two parts:

| Part | Where | What it serves |
|---|---|---|
| Frontend (`frontend/`) | Firebase Hosting | The web pages, built by Vite into `frontend/dist` |
| Backend (`lunarsky/api.py`) | Google Cloud Run, service `lunar-navigator-api`, `us-central1` | Everything under `/api/...` |

Firebase Hosting forwards every `/api/**` request to the Cloud Run service
(`firebase.json`), so the site and the API share one address and the
frontend's `fetch("/api/...")` calls work unchanged.

## One-time setup (per computer)

```bash
gcloud auth login
```

```bash
npx firebase-tools login
```

You need to be a member of the Firebase project (Owner or Editor).

## Deploy

```bash
make deploy
```

This runs two steps, backend first:

1. `make deploy-api`: builds the `Dockerfile` with Cloud Build and deploys it
   to Cloud Run. The first run asks to turn on the Cloud Run, Cloud Build and
   Artifact Registry APIs; answer yes.
2. `make deploy-web`: builds the frontend and uploads it to Firebase Hosting.

If only the frontend changed, `make deploy-web` is enough.

The site is then at <https://nasa-challenge-a8b4a.web.app>.

## Notes

- The backend image includes the four Phase 1 kernels (~19 MB) and
  `data/phase-3/sites.csv`, and sets `LUNAR_DATA_DIR=/app/data` so
  `lunarsky` finds them. `.gcloudignore` and `.dockerignore` keep everything
  else (including the GB-sized maps) out of the upload.
- The page only calls the backend for custom coordinates or dates other
  than the precomputed month; the 26 curated sites load from static files.
- Cloud Run scales to zero when idle, so the first request after a quiet
  spell takes a few seconds.
- The service runs with 2 GiB of memory (`--memory 2Gi` in the Makefile).
  The terrain maps (80 m and 240 m, read whole from the bucket on the first
  terrain request) need about 790 MB at peak; 512 MiB runs out.
- A panel-site search for a new custom spot takes about 2 minutes on Cloud
  Run (1 CPU), against ~1 minute locally. It does get through Firebase
  Hosting (tested: 124 s, HTTP 200), and the service's own
  timeout is 300 s. The 17 polar sites' panel results are precomputed.
