# Moving v1 data to v2

The v2 API reads the same MongoDB collections as v1. The migration changes data
types and adds constraints; it doesn't move data anywhere.

## Run it

Dry run, which changes nothing:

- GitHub → Actions → **Database migration** → Run workflow (leave "Apply" unticked), or
- locally: `MONGODB_URI=... npm run db:migrate`

Apply: tick "Apply", or run `npm run db:migrate -- --apply`. The deploy workflow
also applies pending migrations on every merge to `main`, so after the first
run you don't need to think about it.

Back up first if the data matters:
`mongodump --uri "$MONGODB_URI" --db easytenant --out backup-$(date +%F)`.

## What it does

| Step | Change |
| --- | --- |
| `v2-001-dates` | ISO date strings become real BSON dates in every collection (`createdAt`, `expiresAt`, `closedAt`…). Empty strings are removed. Sorting and date queries become correct and index-friendly. |
| `v2-002-fault-shape` | Faults with pre-pipeline statuses (`open`, `converted`, `verified`…) are mapped to the current stage, inferred from the fields already filled in (cost, approval, assignees). Missing `assignedTo`, `type`, `priority` and the like get defaults. |
| `v2-003-normalise` | Emails lower-cased and trimmed. Notification events renamed `issue.*` → `fault.*` (preferences kept). Role grants missing `developmentId` become platform-wide (`null`). |
| `v2-004-duplicates` | Stops with a clear message if a unit has two active tenancies or a development has two units with the same number, since the new unique indexes would reject that data. Exact duplicate role grants are removed. |
| `v2-005-report-retired` | Reports `workOrders`, `progressUpdates` and `servicePersonnel`. v2 doesn't use them; they're left untouched for you to drop later. |
| Every run | Creates the indexes in `apps/api/src/db/indexes.ts`, replacing v1 indexes whose options changed. Creates the Atlas Search index. Adds any newer default permission to system roles. |

Each step is recorded in a `_migrations` collection and runs once.

## New constraints

- One active tenancy per unit (unique partial index), so two invites accepted
  at the same moment can't both land.
- Unique unit number per development.
- Unique role grant per (user, development, role).

## Behaviour changes from v1

- **Pending v1 invites without an email address** can't be accepted. v1 created
  some before email binding existed. Re-send them from the development's
  Invites tab.
- **Technicians can only advance jobs they're assigned to.** v1 let any service
  person in a development move any job. A manager can still move it on their
  behalf.
- **The current resident can confirm a repair** even when a manager logged the
  fault. In v1 only the original reporter could.
- **Unverified email addresses** can sign in but can't see or change data until
  they verify. v1 enforced this only in the browser.
