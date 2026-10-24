# Hosting and costs

Short version: at your current size this runs on free tiers. The one thing
worth paying for before real tenants arrive is database backups.

| Piece | Where | Free allowance | Expected cost now |
| --- | --- | --- | --- |
| Web app | Cloudflare Workers static assets | Static requests are free and unlimited | £0 |
| API | Cloud Run, `europe-west1`, scale to zero | 2M requests, 180k vCPU-seconds and 360k GiB-seconds a month | £0 |
| Keep-warm + daily job | Cloud Scheduler | A few jobs per billing account are free | £0 |
| Secrets | Secret Manager | 6 active secret versions and 10k accesses a month | ~£0 (5 secrets) |
| Images | Artifact Registry | 0.5 GB storage | £0 (cleanup policy keeps the last 10) |
| Database | MongoDB Atlas M0, GCP Belgium | 512 MB storage | £0 |
| Photos and video | Cloudflare R2 | 10 GB storage, no egress fees | £0 |
| Login | Firebase Authentication | 50k monthly active users | £0 |
| Email | Resend | 3,000 a month, 100 a day | £0 |

Check the providers' pricing pages before relying on these numbers; free tiers
change.

## Why these choices

**Cloud Run over a free VM.** Google's always-free e2-micro only exists in US
regions, so every request from Lagos would cross the Atlantic, and you'd be
patching the OS, renewing certificates and restarting it yourself. Cloud Run in
Belgium sits next to your Atlas cluster, costs nothing when idle, and keeps
every past revision for one-click rollback. Its one weakness is cold starts
(1–3 s after a quiet spell). The keep-warm ping and startup CPU boost cover most
of that. If you ever need zero cold starts, `--min-instances 1` removes them for
a few pounds a month.

If you'd rather use your idle Oracle Always Free VM (London), the same Docker
image runs there unchanged. You'd add a reverse proxy for HTTPS and a deploy
step over SSH.

**Cloud Run in the same region as Atlas.** Every API request makes one or more
database round trips. Keeping them in the same Google region keeps each trip to
about a millisecond instead of tens.

**Cloudflare for the web app.** Global CDN, free, and it already holds your
domain and DNS.

## Limits to watch

1. **Atlas M0 has no backups.** A bad delete is permanent. Before real tenants:
   move to Flex or M10, or at least run `mongodump` on a schedule.
2. **Resend caps at 100 emails a day.** A busy day of fault updates can hit it.
   The API logs failures and carries on, so people still see in-app
   notifications, but email stops until midnight UTC. Upgrade or switch provider
   before launch.
3. **M0 is 512 MB.** Notifications expire after a year and photos live in R2, so
   this should last a long time. Atlas emails you as it fills.
4. **Atlas pauses an M0 after 30 days with no activity.** The keep-warm ping
   prevents that.
