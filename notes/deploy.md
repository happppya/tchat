# Deploy Tchat to Cloud Run

Everything you need to set up, deploy, elevate users, and maintain the app.

---

## One-time setup

Run these once per project. Replace `<REGION>` with your region (e.g. `us-east1`)
and `<PROJECT_NUMBER>` with your GCP project number.

```bash
# 1. Create the persistent storage bucket (same region as the service)
gcloud storage buckets create gs://tchat-data --location=us-east1

# 2. Let Cloud Run write to it (replace <PROJECT_NUMBER>)
gcloud storage buckets add-iam-policy-binding gs://tchat-data `
  --member=serviceAccount:49198638722-compute@developer.gserviceaccount.com `
  --role=roles/storage.objectAdmin
```

### Create `prod-env.yaml`

Copy this template and fill in your secret:

```yaml
# prod-env.yaml — production environment variables
# Keep this file out of git!

DATABASE_PATH: /data/database.db
SQLITE_JOURNAL_MODE: delete
UPLOAD_DIR: /data/uploads
ADMIN_SECRET: adminsixseven
```

```bash
# Add to .gitignore so you never commit your secret
echo "prod-env.yaml" >> .gitignore
```

---

## Deploy

```bash
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
  --add-volume=name=data,type=cloud-storage,bucket=tchat-data `
  --add-volume-mount=volume=data,mount-path=/data `
  --env-vars-file prod-env.yaml
```

> **Why those flags?** `max-instances=1` prevents SQLite corruption (Cloud
> Storage FUSE has no real file locking). `SQLITE_JOURNAL_MODE=delete` avoids
> the WAL files that FUSE can't handle. `--no-cpu-throttling` keeps the single
> instance responsive. `--timeout 3600` allows long-lived WebSocket connections.

---

## Elevate a user to admin

The Cloud Run instance has no shell access, so you can't run `sqlite3` directly.
Instead, use the `/api/promote` endpoint (gated by `ADMIN_SECRET`).

```bash
# Promote someone to admin
curl -X POST  https://tchat-49198638722.us-east1.run.app/api/promote `
  -H "x-admin-secret: <your-admin-secret>" `
  -H "Content-Type: application/json" `
  -d '{"username": "theirusername", "isAdmin": true}'

# Demote an admin back to a regular user
curl -X POST https://tchat-49198638722.us-east1.run.app/api/promote `
  -H "x-admin-secret: <your-admin-secret>" `
  -H "Content-Type: application/json" `
  -d '{"username": "theirusername", "isAdmin": false}'
```

Find your service URL:
```bash
gcloud run services describe tchat --region <REGION> --format="value(status.url)"
```

---

## Update just the admin secret

If you need to change the secret without a full redeploy:

```bash
gcloud run services update tchat `
  --region <REGION> `
  --update-env-vars=ADMIN_SECRET=<new-secret>
```

Then update `prod-env.yaml` too so the next `deploy` picks up the new value.

---

## Migrate an existing database

If you have a local `database.db` you want to carry over to the cloud:

```bash
# Stop your local server first so the WAL is checkpointed, then:
gcloud storage cp database.db gs://tchat-data/database.db
gcloud storage cp -r uploads gs://tchat-data/uploads
```

---

## View logs

```bash
# Last 30 log lines
gcloud run services logs read tchat --region <REGION> --limit 30

# Tail live logs
gcloud run services logs tail tchat --region <REGION>
```

---

## Turn off (take the site down)

```bash
# Scale to zero and revoke public access
gcloud run services update tchat --region <REGION> --min-instances 0

gcloud run services remove-iam-policy-binding tchat `
  --region <REGION> `
  --member="allUsers" `
  --role="roles/run.invoker"
```

---

## Turn on (bring the site back)

```bash
# Restore public access and scale back to one instance
gcloud run services add-iam-policy-binding tchat `
  --region <REGION> `
  --member="allUsers" `
  --role="roles/run.invoker"

gcloud run services update tchat `
  --region <REGION> `
  --min-instances 1 `
  --max-instances 1
```