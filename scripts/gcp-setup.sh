#!/usr/bin/env bash
# One-time Google Cloud setup for deploying EasyTenant from GitHub.
# Run in Cloud Shell (https://shell.cloud.google.com), from the repo root:
#
#   bash scripts/gcp-setup.sh
#
# Safe to re-run: anything that already exists is left alone. It creates:
#   - an Artifact Registry repo for the API image
#   - a runtime service account for Cloud Run (reads secrets, nothing else)
#   - a deployer service account that GitHub Actions signs in as, using
#     Workload Identity Federation (no key file anywhere)
#   - Secret Manager secrets for the Mongo URI, R2 keys, Resend key and the
#     scheduled-job secret (you paste the values; they never touch GitHub)
# At the end it prints the GitHub repository variables to add.
set -euo pipefail

PROJECT="${PROJECT:-staging-easytenant-ng}"
REGION="${REGION:-europe-west1}"
GITHUB_REPO="${GITHUB_REPO:-tfaj/easytenant}"
POOL="github"
PROVIDER="easytenant"
RUNTIME_SA="easytenant-api@${PROJECT}.iam.gserviceaccount.com"
DEPLOYER_SA="easytenant-deployer@${PROJECT}.iam.gserviceaccount.com"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
exists() { "$@" >/dev/null 2>&1; }

gcloud config set project "$PROJECT" >/dev/null
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"

say "Enabling APIs (takes a minute the first time)"
gcloud services enable run.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com cloudscheduler.googleapis.com \
  iamcredentials.googleapis.com sts.googleapis.com

say "Artifact Registry"
exists gcloud artifacts repositories describe easytenant --location "$REGION" ||
  gcloud artifacts repositories create easytenant --repository-format=docker --location "$REGION" \
    --description "EasyTenant API images"
# Keep the 10 newest images; older ones are deleted so storage stays free.
cat > /tmp/et-cleanup.json <<'JSON'
[{"name":"keep-recent","action":{"type":"Keep"},"mostRecentVersions":{"keepCount":10}},
 {"name":"delete-old","action":{"type":"Delete"},"condition":{"olderThan":"2592000s"}}]
JSON
gcloud artifacts repositories set-cleanup-policies easytenant --location "$REGION" --policy /tmp/et-cleanup.json --no-dry-run >/dev/null

say "Service accounts"
exists gcloud iam service-accounts describe "$RUNTIME_SA" ||
  gcloud iam service-accounts create easytenant-api --display-name "EasyTenant API (Cloud Run runtime)"
exists gcloud iam service-accounts describe "$DEPLOYER_SA" ||
  gcloud iam service-accounts create easytenant-deployer --display-name "EasyTenant deployer (GitHub Actions)"

for role in roles/run.admin roles/artifactregistry.writer roles/cloudscheduler.admin roles/secretmanager.secretAccessor; do
  gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:$DEPLOYER_SA" --role "$role" --condition=None >/dev/null
done
# The deployer may deploy Cloud Run services that run as the runtime account.
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
  --member "serviceAccount:$DEPLOYER_SA" --role roles/iam.serviceAccountUser >/dev/null

say "Workload Identity Federation for $GITHUB_REPO"
exists gcloud iam workload-identity-pools describe "$POOL" --location global ||
  gcloud iam workload-identity-pools create "$POOL" --location global --display-name "GitHub Actions"
exists gcloud iam workload-identity-pools providers describe "$PROVIDER" --location global --workload-identity-pool "$POOL" ||
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" \
    --location global --workload-identity-pool "$POOL" \
    --issuer-uri "https://token.actions.githubusercontent.com" \
    --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
    --attribute-condition "assertion.repository == '${GITHUB_REPO}'"
# Only this repository can act as the deployer.
gcloud iam service-accounts add-iam-policy-binding "$DEPLOYER_SA" \
  --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/attribute.repository/${GITHUB_REPO}" >/dev/null

say "Secrets (input is hidden; press Enter to keep an existing value)"
put_secret() { # name prompt [generate]
  local name="$1" prompt="$2" value=""
  if [[ "${3:-}" == "generate" ]] && ! exists gcloud secrets describe "$name"; then
    value="$(openssl rand -base64 36 | tr -d '\n')"
    echo "  $name: generated"
  else
    read -r -s -p "  $prompt: " value; echo
  fi
  if ! exists gcloud secrets describe "$name"; then
    [[ -z "$value" ]] && { echo "  $name is required."; exit 1; }
    printf '%s' "$value" | gcloud secrets create "$name" --replication-policy automatic --data-file=- >/dev/null
  elif [[ -n "$value" ]]; then
    printf '%s' "$value" | gcloud secrets versions add "$name" --data-file=- >/dev/null
  fi
  gcloud secrets add-iam-policy-binding "$name" --member "serviceAccount:$RUNTIME_SA" --role roles/secretmanager.secretAccessor >/dev/null
}
put_secret mongodb-uri "MongoDB Atlas connection string (mongodb+srv://...)"
put_secret r2-access-key-id "Cloudflare R2 access key id"
put_secret r2-secret-access-key "Cloudflare R2 secret access key"
put_secret resend-api-key "Resend API key (re_...)"
put_secret job-secret "" generate

PROVIDER_NAME="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/providers/${PROVIDER}"
say "Done. Add these as GitHub repository variables"
echo "  (github.com/${GITHUB_REPO} → Settings → Secrets and variables → Actions → Variables)"
cat <<EOF

  GCP_PROJECT_ID     = ${PROJECT}
  GCP_REGION         = ${REGION}
  GCP_WIF_PROVIDER   = ${PROVIDER_NAME}
  GCP_DEPLOYER_SA    = ${DEPLOYER_SA}
  GCP_RUNTIME_SA     = ${RUNTIME_SA}

EOF
