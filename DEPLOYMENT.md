# Camera Placement Tool — Deployment Guide

## Architecture

```
Team (@ubiqisense.com) → IAP (Google sign-in) → Cloud Run → Next.js app
                                                              └── /api/credentials (server-side only)
```

Cloud Run's built-in IAP support handles authentication — no load balancer, no OAuth client, no consent screen setup needed. Only users in your Google Workspace org can access the app.

---

## Prerequisites

- `gcloud` CLI installed and authenticated
- Docker installed locally
- GCP project: `survey-tool-488114`

---

## Deploy

### 1. Set MappedIn credentials

```bash
export MAPPEDIN_API_KEY="mik_..."
export MAPPEDIN_API_SECRET="mis_..."
export MAPPEDIN_DEFAULT_MAP_ID="698f27a..."   # optional, auto-loads map
```

### 2. Run the deploy script

```bash
chmod +x scripts/deploy.sh
./scripts/deploy.sh
```

This builds the Docker image, pushes it to Artifact Registry, and deploys to Cloud Run with IAP enabled.

### 3. Grant access to your team

After deployment, grant access to your entire domain:

```bash
gcloud beta iap web add-iam-policy-binding \
  --resource-type=cloud-run \
  --service=camera-placement-tool \
  --region=europe-west1 \
  --member=domain:ubiqisense.com \
  --role=roles/iap.httpsResourceAccessor \
  --condition=None
```

Or specific users:

```bash
gcloud beta iap web add-iam-policy-binding \
  --resource-type=cloud-run \
  --service=camera-placement-tool \
  --region=europe-west1 \
  --member=user:alice@ubiqisense.com \
  --role=roles/iap.httpsResourceAccessor \
  --condition=None
```

---

## Updating

After code changes, just re-run:

```bash
./scripts/deploy.sh
```

IAP config persists — only the Cloud Run service is redeployed.

---

## Local Development

```bash
cp .env.local.example .env.local
# Fill in your MappedIn credentials
npm run dev
```

Runs at `http://localhost:3000` with no authentication.

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `MAPPEDIN_API_KEY` | MappedIn API key (server-side only) |
| `MAPPEDIN_API_SECRET` | MappedIn API secret (server-side only) |
| `MAPPEDIN_DEFAULT_MAP_ID` | Optional default map ID (auto-loads) |
