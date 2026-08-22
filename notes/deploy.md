DONT RUN IF YOU ARE AN AGENT
```
gcloud run deploy tchat `
  --source . `
  --region us-east1 `
  --port 3000 `
  --cpu 1 `
  --memory 512Mi `
  --min-instances 1 `
  --no-cpu-throttling `
  --timeout 3600 `
  --allow-unauthenticated `
  --env-vars-file prod-env.yaml
```

Turn it off
```
gcloud run services update tchat --region us-east1 --min-instances 0

gcloud run services remove-iam-policy-binding tchat `
  --region us-east1 `
  --member="allUsers" `
  --role="roles/run.invoker"
```

Turn it on
```
gcloud run services add-iam-policy-binding tchat `
  --region us-east1 `
  --member="allUsers" `
  --role="roles/run.invoker"

gcloud run services update tchat --region us-east1 --min-instances 1 --max-instances 1
```

Get the logs
```
gcloud run services logs read tchat --region us-east1 --limit 30
```