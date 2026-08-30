#!/usr/bin/env bash
# Keep a Cloud Run service running ONLY on weekdays 07:00-17:00 local time.
# It is disabled after 17:00 weekdays and all weekend (the Fri 17:00 shutdown
# leaves it off until Mon 07:00, so no separate weekend job is needed).
#
# Uses Cloud Scheduler + the Cloud Run Admin API (Google's documented
# "manual scaling on a schedule" pattern):
#   https://cloud.google.com/run/docs/configuring/services/manual-scaling
#
# Values default to this project's deployment (see note/deploy.md); override any
# with environment variables if your values differ.
#   PROJECT          Google Cloud project id (default 49198638722)
#   SERVICE          Cloud Run service name (default tchat)
#   REGION           Cloud Run region used for the service and scheduler (default us-east1)
#   TIMEZONE         cron timezone for the cutover times (default America/New_York)
#   INSTANCES        instances to run during business hours (default 1)
#   SERVICE_ACCOUNT  SA that may update the service (default: the project's
#                    Compute Engine default SA)
set -euo pipefail

PROJECT="${PROJECT:-49198638722}"
SERVICE="${SERVICE:-tchat}"
REGION="${REGION:-us-east1}"
TIMEZONE="${TIMEZONE:-America/New_York}"
INSTANCES="${INSTANCES:-1}"
SA="${SERVICE_ACCOUNT:-49198638722-compute@developer.gserviceaccount.com}"

API_URL="https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}"
UPDATE_MASK="launchStage,scaling.manualInstanceCount"

echo "Targeting service '${SERVICE}'"
echo "  project:  ${PROJECT}"
echo "  region:   ${REGION}"
echo "  timezone: ${TIMEZONE}  (schedule fires by THIS clock)"
echo "  business-hours instances: ${INSTANCES}"
echo "  service account: ${SA}"

# Sanity checks before we create anything.
command -v gcloud >/dev/null 2>&1 || { echo "gcloud not found on PATH"; exit 1; }
if ! gcloud scheduler locations list --filter="name:${REGION}" --format="value(name)" 2>/dev/null | grep -q "${REGION}"; then
  echo "Warning: it does not look like ${REGION} is a Cloud Scheduler location."
  echo "You may need to set REGION to a scheduler-enabled location (e.g. us-east1)."
fi

# ---------------------------------------------------------------------------
# First-time set-up: switch the service to MANUAL scaling so the jobs below can
# control the instance count. gcloud run deploy resets min/max instances, so
# re-run this step whenever you redeploy with gcloud.
# ---------------------------------------------------------------------------
echo
echo "Step 1) Switching service to manual scaling (${INSTANCES} instance)..."
gcloud run services update "$SERVICE" --region="$REGION" --scaling="$INSTANCES"

# ---------------------------------------------------------------------------
# Step 2) Scheduler jobs. The Admin API PATCH needs http-method=PATCH, which the
# scheduler CLI can't send directly, so we use the documented
# X-HTTP-Method-Override=PATCH header with PUT.
# ---------------------------------------------------------------------------
echo
echo "Step 2) Creating '${SERVICE}-scale-up' (07:00 Mon-Fri)..."
gcloud scheduler jobs create http "${SERVICE}-scale-up" \
  --location="$REGION" \
  --schedule="0 7 * * MON-FRI" \
  --time-zone="$TIMEZONE" \
  --uri="${API_URL}?update_mask=${UPDATE_MASK}" \
  --headers="Content-Type=application/json,X-HTTP-Method-Override=PATCH" \
  --http-method=PUT \
  --message-body="{\"scaling\":{\"manualInstanceCount\":${INSTANCES}}}" \
  --oauth-service-account-email="$SA"

echo "Creating '${SERVICE}-scale-down' (17:00 Mon-Fri)..."
gcloud scheduler jobs create http "${SERVICE}-scale-down" \
  --location="$REGION" \
  --schedule="0 17 * * MON-FRI" \
  --time-zone="$TIMEZONE" \
  --uri="${API_URL}?update_mask=${UPDATE_MASK}" \
  --headers="Content-Type=application/json,X-HTTP-Method-Override=PATCH" \
  --http-method=PUT \
  --message-body='{"scaling":{"manualInstanceCount":0}}' \
  --oauth-service-account-email="$SA"

echo
echo "Done. '${SERVICE}' now runs ONLY on weekdays 07:00-17:00 (${TIMEZONE} time)."
echo "It disables at 17:00 weekdays and stays off through the weekend until Mon 07:00."