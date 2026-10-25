# Deploying EasyTenant

Every merge to `main` runs `.github/workflows/deploy.yml`, which does four
things in order and stops at the first failure:

1. **Checks**: type-check, tests (against a real MongoDB), web build, image build.
2. **Database**: `npm run db:migrate -- --apply` against Atlas. Safe to re-run.
3. **API**: builds the container, deploys it to Cloud Run (`europe-west1`, next
   to the Atlas cluster), then checks `/api/health?deep=1`.
4. **Web**: builds the React app pointed at that API and deploys it to
   Cloudflare (Workers static assets), keeping your existing domain.

The order matters: the web app calls the new API, so it must never go live
first.

You do the setup below once. After that, merging is the whole deploy.

---

## 1. Google Cloud (about 10 minutes)

Open [Cloud Shell](https://shell.cloud.google.com) in project
`staging-easytenant-ng` and run:

```bash
git clone https://github.com/tfaj/easytenant.git && cd easytenant
bash scripts/gcp-setup.sh
```

It asks for four values, with input hidden:

| Prompt | Where to find it |
| --- | --- |
| MongoDB Atlas connection string | Atlas → your cluster → Connect → Drivers. Same value as v1's `MONGODB_URI`. |
| R2 access key id / secret | Same as v1's `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` (Cloudflare → R2 → Manage API tokens). |
| Resend API key | Same as v1's `RESEND_API_KEY`. |

It generates the scheduled-job secret itself. At the end it prints five
values for step 3.

Secrets live in Google Secret Manager only. GitHub never sees them: the
workflow signs in to Google with a short-lived token (Workload Identity
Federation), and Cloud Run reads the secrets at start-up.

## 2. Cloudflare

1. **Create an API token**: Cloudflare dashboard → My Profile → API Tokens →
   Create Token → template "Edit Cloudflare Workers". Limit it to your account.
2. **Note your Account ID** (Workers & Pages overview, right-hand side).
3. **Disconnect the old Git build** on the existing `easytenant-web` project
   (Settings → Build → disconnect), otherwise Cloudflare keeps building the old
   repo. The custom domain stays attached to the Worker; the new deploy
   replaces what it serves.

## 3. GitHub repository settings

`github.com/tfaj/easytenant` → Settings → Secrets and variables → Actions.

**Secrets** (two):

| Name | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Token from step 2 |
| `CLOUDFLARE_ACCOUNT_ID` | Account ID from step 2 |

**Variables**:

| Name | Value |
| --- | --- |
| `GCP_PROJECT_ID`, `GCP_REGION`, `GCP_WIF_PROVIDER`, `GCP_DEPLOYER_SA`, `GCP_RUNTIME_SA` | Printed by `gcp-setup.sh` |
| `PUBLIC_WEB_URL` | Your web address, e.g. `https://staging.easytenant.ng` |
| `WEB_ORIGINS` | Same as `PUBLIC_WEB_URL` (comma-separate if there are several) |
| `FIREBASE_PROJECT_ID` | Firebase console → Project settings |
| `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_APP_ID` | Same as v1's `VITE_FIREBASE_*` values (public, not secrets) |
| `EMAIL_FROM` | `EasyTenant <notifications@easytenant.ng>` |
| `R2_ACCOUNT_ID` | Cloudflare account id used for R2 |
| `R2_BUCKET` | `easytenant-media` (or your staging bucket) |
| `DB_NAME` | `easytenant` (optional, that's the default) |
| `CLOUDFLARE_WORKER_NAME` | Only if your Worker isn't called `easytenant-web` |
| `API_PUBLIC_URL` | Optional. Only if you map a custom domain to the API; otherwise the Cloud Run URL is used automatically |

## 4. Firebase

Authentication → Templates → (pencil) → **Customize action URL**:
`https://<your web domain>/auth/action`. This is the same path v1 used, so it
may already be set. Check that your web domain is listed under
Authentication → Settings → **Authorized domains**.

## 5. R2 CORS

Browsers upload photos straight to R2, so the bucket must allow your web
origin. Cloudflare → R2 → bucket → Settings → CORS policy:

```json
[{ "AllowedOrigins": ["https://staging.easytenant.ng"], "AllowedMethods": ["PUT", "GET"], "AllowedHeaders": ["content-type"], "MaxAgeSeconds": 3600 }]
```

v1 needed the same rule, so it's probably there already.

## 6. First deploy

1. GitHub → Actions → **Database migration** → Run workflow, leaving "Apply"
   unticked. It prints what would change and changes nothing. If it reports a
   blocker (for example two active tenancies on one unit), fix that data first.
2. Merge the pull request. Watch Actions → Deploy.
3. Sign in on the web app. If no one is a platform admin yet:
   `MONGODB_URI=... npm run bootstrap-admin -w @easytenant/api -- you@example.com`
   (v1 admins keep their role; the migration doesn't touch it).
4. Delete the old v1 Cloud Run service once you're happy (it was in a different
   region): `gcloud run services list` to find it, then
   `gcloud run services delete <name> --region <its region>`.

## Scheduled jobs

The deploy creates two Cloud Scheduler jobs (Lagos time):

| Job | Schedule | What it does |
| --- | --- | --- |
| `easytenant-keep-warm` | every 10 min, 06:00 to 23:59 | `GET /api/health?deep=1`: keeps a Cloud Run instance and its Atlas connection warm, and keeps the M0 cluster active so Atlas never pauses it |
| `easytenant-daily` | 07:00 | `POST /internal/jobs/daily`: reminders for work scheduled in the next 48 hours, and a one-time notice when a fault passes its overdue limit |

## Rolling back

Cloud Run keeps every revision. Console → Cloud Run → `easytenant-api` →
Revisions → pick the previous one → Manage traffic → 100%. Or revert the
commit on `main` and let the pipeline redeploy. Migrations only add or convert;
they never delete data.

## Local development

```bash
npm install
cp apps/api/.env.example apps/api/.env       # fill in Mongo + Firebase project id
cp apps/web/.env.example apps/web/.env.local # fill in Firebase web config
npm run db:migrate -- --apply                # against your dev database
npm run dev:api                              # http://localhost:8787
npm run dev:web                              # http://localhost:5173
```

Tests start their own MongoDB replica set: `npm test`.
