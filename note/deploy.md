# Deploy Tchat to Cloud Run

Everything you need to set up, deploy, elevate users, and maintain the app.
Commands are written for **PowerShell** (they're run from the project root).

---

## One-time setup

Run these once per project. Replace `<PROJECT_NUMBER>` with your GCP project
number (find it with `gcloud projects list`).

```powershell
# 1. Create the persistent storage bucket (same region as the service)
gcloud storage buckets create gs://tchat-data --location=us-east1

# 2. Let Cloud Run write to it
gcloud storage buckets add-iam-policy-binding gs://tchat-data `
  --member=serviceAccount:49198638722-compute@developer.gserviceaccount.com `
  --role=roles/storage.objectAdmin
```

> If `gcloud run services replace` later asks to enable the
> `cloudresourcemanager` API, answer **y** — it's a one-time thing.

### Create `prod-env.yaml`

Copy this template into `prod-env.yaml` in the project root and fill in a long
random secret (it's already gitignored):

```yaml
DATABASE_PATH: /data/database.db
SQLITE_JOURNAL_MODE: delete
UPLOAD_DIR: /data/uploads
ADMIN_SECRET: <your-long-random-secret>
```

Generate a secret with:
```powershell
$bytes = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes); [Convert]::ToBase64String($bytes)
```

Get logs
```
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=tchat" --limit 30
```

Reset the db (last resort, highly dangerous)
```
gcloud storage rm gs://tchat-data/database.db
```

---

## Deploy

> **The flags below MUST be quoted.** PowerShell splits unquoted arguments on
> commas, which turns `--add-volume=name=data,type=cloud-storage,...` into three
> separate arguments and gcloud errors with `Key [type] required`.

```powershell
gcloud run deploy tchat `
  --source . `
  --region us-east1 `
  --port 3000 `
  --cpu 1 `
  --memory 512Mi `
  --min-instances 1 `
  --max-instances 1 `
  --no-cpu-throttling `
  --timeout 3600 `
  --allow-unauthenticated `
  --execution-environment gen2 `
  "--add-volume=name=data,type=cloud-storage,bucket=tchat-data,readonly=false" `
  "--add-volume-mount=volume=data,mount-path=/data" `
  --env-vars-file prod-env.yaml
```

To edit env vars
```
gcloud run deploy tchat `
  --region us-east1 `
  --update-env-vars FRONTEND_ORIGINS=*
```

**If you're using Git Bash / MSYS instead of PowerShell:** the shell rewrites
`/data` into a Windows path (`C:/Program Files/Git/data`), which fails
validation. Use a double slash in that case:

```bash
gcloud run deploy tchat \
  --source . \
  --region us-east1 \
  --port 3000 \
  --cpu 1 \
  --memory 512Mi \
  --min-instances 1 \
  --max-instances 1 \
  --no-cpu-throttling \
  --timeout 3600 \
  --allow-unauthenticated \
  --execution-environment gen2 \
  "--add-volume=name=data,type=cloud-storage,bucket=tchat-data,readonly=false" \
  "--add-volume-mount=volume=data,mount-path=//data" \
  --env-vars-file prod-env.yaml
```

> **Why those flags?** `max-instances=1` + `SQLITE_JOURNAL_MODE=delete`
> prevent SQLite corruption (Cloud Storage FUSE has no real file locking).
> `readonly=false` is essential — without it the bucket mounts read-only and
> the server crashes with `SQLITE_CANTOPEN`. `--no-cpu-throttling` keeps the
> single instance responsive; `--timeout 3600` allows long-lived WebSocket
> connections.

---

## Elevate a user to admin

The Cloud Run instance has no shell access, so you can't run `sqlite3` against
it. Instead, use the `/api/promote` endpoint (gated by the `ADMIN_SECRET` env
var). Replace the URL and secret:

```powershell
# Promote someone to admin
curl.exe -X POST https://tchat-49198638722.us-east1.run.app/api/promote `
  -H "x-admin-secret: tchat-i6k9x2m4p7r1v8w3n5a0" `
  -H "Content-Type: application/json" `
  -d '{\"username\": \"happya\", \"isAdmin\": true}'

# Demote an admin back to a regular user
curl.exe -X POST https://tchat-49198638722.us-east1.run.app/api/promote `
  -H "x-admin-secret: tchat-i6k9x2m4p7r1v8w3n5a0" `
  -H "Content-Type: application/json" `
  -d '{\"username\": \"theirusername\", \"isAdmin\": false}'
```

Find the service URL:
```powershell
gcloud run services describe tchat --region us-east1 --format="value(status.url)"
```

---

## Update just the admin secret

If you need to change the secret without a full redeploy:

```powershell
gcloud run services update tchat `
  --region us-east1 `
  --update-env-vars=ADMIN_SECRET=<new-secret>
```

Then update `prod-env.yaml` too so the next `deploy` picks up the new value.

---

## Migrate an existing database

If you have a local `database.db` you want to carry over to the cloud:

```powershell
# Stop your local server first so the WAL is checkpointed, then:
gcloud storage cp database.db gs://tchat-data/database.db
gcloud storage cp uploads/* gs://tchat-data/uploads/
```

> The running container already has a fresh `database.db` on the bucket — copy
> over it only if you want to replace it with your local data.

---

## View logs

```powershell
# Last 30 log lines
gcloud run services logs read tchat --region us-east1 --limit 30

# Tail live logs
gcloud run services logs tail tchat --region us-east1
```

---

## Turn off (take the site down)

```powershell
# Scale to zero and revoke public access
gcloud run services update tchat --region us-east1 --min-instances 0

gcloud run services remove-iam-policy-binding tchat `
  --region us-east1 `
  --member="allUsers" `
  --role="roles/run.invoker"
```

---

## Turn on (bring the site back)

```powershell
# Restore public access and scale back to one instance
gcloud run services add-iam-policy-binding tchat `
  --region us-east1 `
  --member="allUsers" `
  --role="roles/run.invoker"

gcloud run services update tchat `
  --region us-east1 `
  --min-instances 1 `
  --max-instances 1
```

---

## Scheduled up/down (weekdays 07:00–17:00 Eastern)

The service only needs to run **Mon–Fri 07:00–17:00 America/New_York**. Outside
that — even all weekend — it is fully disabled, so no Compute/instance is
billed. This uses Google's **manual scaling on a schedule** pattern
(<https://cloud.google.com/run/docs/configuring/services/manual-scaling>): two
Cloud Scheduler jobs PATCH the Cloud Run Admin API to set the instance count.

> A fully-disabled service returns `Service unavailable` outside business
> hours (no cold-start soft-landing). That matches “only runs 7am–5pm weekdays”.

There is also a ready-made Bash script, `scripts/gcp-scale-schedule.sh`, that
creates the whole thing (values default to `tchat` / `us-east1` /
`America/New_York`). Run the steps below in PowerShell if you prefer to do it by
hand.

**One-time step — switch to MANUAL scaling** (scheduler can then control the
instance count):

```powershell
gcloud run services update tchat --region us-east1 --scaling 1
```

**Scale up to 1 instance at 07:00 weekdays:**

```powershell
gcloud scheduler jobs create http tchat-scale-up `
  --location us-east1 `
  --schedule "0 7 * * MON-FRI" `
  --time-zone America/New_York `
  --uri "https://run.googleapis.com/v2/projects/49198638722/locations/us-east1/services/tchat?update_mask=launchStage,scaling.manualInstanceCount" `
  --headers "Content-Type=application/json,X-HTTP-Method-Override=PATCH" `
  --http-method PUT `
  --message-body '{"scaling":{"manualInstanceCount":1}}' `
  --oauth-service-account-email 49198638722-compute@developer.gserviceaccount.com
```

**Scale down (disable) at 17:00 weekdays** — Friday’s 17:00 leave it off through
the weekend until Monday 07:00:

```powershell
gcloud scheduler jobs create http tchat-scale-down `
  --location us-east1 `
  --schedule "0 17 * * MON-FRI" `
  --time-zone America/New_York `
  --uri "https://run.googleapis.com/v2/projects/49198638722/locations/us-east1/services/tchat?update_mask=launchStage,scaling.manualInstanceCount" `
  --headers "Content-Type=application/json,X-HTTP-Method-Override=PATCH" `
  --http-method PUT `
  --message-body '{"scaling":{"manualInstanceCount":0}}' `
  --oauth-service-account-email 49198638722-compute@developer.gserviceaccount.com
```

> Deploys wipe the manual-scaling setting. `gcloud run deploy` above sets
> `--min-instances 1 --max-instances 1` (autoscaling), so **after any redeploy
> re-run the `--scaling 1` command** (or the script) to restore manual mode.
> With manual scaling active, revision-level min/max are ignored.

Verify / clean up:

```powershell
# List the jobs
gcloud scheduler jobs list --location us-east1

# Manually trigger them to check they work
gcloud scheduler jobs run tchat-scale-up --location us-east1
gcloud scheduler jobs run tchat-scale-down --location us-east1

# Remove the schedule (back to always-on)
gcloud scheduler jobs delete tchat-scale-up --location us-east1
gcloud scheduler jobs delete tchat-scale-down --location us-east1
gcloud run services update tchat --region us-east1 --scaling auto
```
