# Architecture and security model

## Request path

Browser → Cloudflare (static React app) → Cloud Run API → MongoDB Atlas.
Photos go browser → R2 directly with a signed URL, never through the API.

The browser signs in with Firebase and sends the ID token as a Bearer header.
The API verifies it with `firebase-admin` (public keys only; no service-account
key is needed on Cloud Run) and gets `uid`, `email` and `email_verified`.

## Authorization: the one rule

> A permission is always checked against the development that the record being
> touched belongs to, as read from the database. Never against an id the client
> sent.

v1 read `developmentId` from the URL, query string or body and checked
permissions against that. A manager of estate A could send A's id while acting
on estate B's records. v2 routes load the record first, then call
`access.require(permission, record.developmentId)`
(`apps/api/src/access/access.ts`). Records the caller may not see return 404, so
ids can't be probed.

Other rules:

- Every data route requires a verified email (`access.verified`). Only
  `/api/me`, `/api/me/sync` and the public invite preview don't.
- Platform-wide actions (creating developments, listing all users, granting
  platform admin) require the permission on a platform-wide role. A
  development-scoped admin can't escalate to platform admin.
- Fault actions come from `availableTransitions()` in the shared pipeline. The
  API computes the caller's allowed actions and returns them with each fault, so
  the UI only shows buttons that will work.
- Uploads: presigning requires membership of the development. The content type
  must be an image or video, size is capped (15 MB images, 60 MB video) and the
  size is signed into the URL. Keys are namespaced
  `dev/<developmentId>/u/<uid>/…`, and faults only accept keys under the
  caller's own prefix.
- Invites are bound to an email address and need that address verified. Accept
  is a transaction that claims the invite and creates the role and tenancy
  together. A unique partial index guarantees one active tenancy per unit.
- Fault transitions are conditional updates on the status that was read, so two
  people acting at once can't both move a fault.
- Privileged actions are written to `auditLog`: role changes, cost
  approval/rejection, closing and cancelling, tenancy changes, settings.

`apps/api/test/access.test.ts` has a test for each v1 hole.

## Data

Same collections as v1 (`issues` holds faults, `issueUpdates` their activity).
Dates are BSON dates. Indexes are declared in `apps/api/src/db/indexes.ts` and
applied by the migration runner, not at boot, to keep cold starts short. Lists
use keyset pagination (`apps/api/src/lib/pagination.ts`).

## Notifications

`lib/notify.ts` writes an in-app notification for each recipient and emails
those who haven't turned that event off (Settings → Email me when). Email
failures are logged and never fail the request. Owners (contacts, not users) get
a direct email when a repair on their unit is closed.

## Front end

React 19, React Router 7, TanStack Query and Tailwind 4. Permissions shape the
navigation (managers, technicians and tenants each get their own home), but the
API is the authority. The design tokens live in `apps/web/src/index.css`, with
light and dark themes. The font is self-hosted.
