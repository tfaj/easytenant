# EasyTenant

Property maintenance for estates. Tenants report faults from their phone,
managers triage and assign them, technicians quote and repair, admins approve
costs, and owners are told when the job is done. Every step is on record.

```
apps/api        Node + Hono API (Cloud Run)
apps/web        React app (Cloudflare)
packages/shared Types, validation, permissions and the fault pipeline, used by both
docs/           DEPLOY.md, HOSTING.md, MIGRATION.md, ARCHITECTURE.md
scripts/        gcp-setup.sh (one-time Google Cloud setup)
```

| | |
| --- | --- |
| Data | MongoDB Atlas (same collections as v1; see docs/MIGRATION.md) |
| Sign-in | Firebase Authentication (email/password and Google) |
| Media | Cloudflare R2, private, via signed URLs |
| Email | Resend |
| Deploy | Merge to `main`: tests, then migrate, then API, then web (docs/DEPLOY.md) |

## Develop

```bash
npm install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
npm run dev:api      # :8787
npm run dev:web      # :5173
npm test             # starts its own MongoDB replica set
```

## The fault pipeline

Defined once, in `packages/shared/src/pipeline.ts`. The API enforces it and the
web app renders it:

1. Logged
2. Prioritised
3. Technician assigned
4. Inspection
5. Awaiting cost approval
6. Repair in progress
7. Resident confirmation
8. Cost recording
9. Closed

A quote can be rejected back to inspection, and an open fault can be cancelled
at any stage. Each transition says who may perform it (by permission, or by
being the assignee, reporter or resident) and what it must carry.
