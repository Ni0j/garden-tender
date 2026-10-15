# Project Garden

A farming-themed progress logger. Log effort on a project to grow its plant:
Seed → Sprout → Young plant → Growing plant → Mature plant → Bloom.

## Local setup

Install Bun **1.3.10** and put `bun` on your PATH. Run these commands from
`gardener` (the Git repository containing `package.json`):

```sh
bun install --frozen-lockfile
bun run build
bun run start
```

Open http://localhost:3000. The production server serves both the built frontend
and API. No separate frontend server, Hatch runtime, or manual database setup
is needed. Startup creates the database directory and applies migrations.
Rebuild after changing source files; `start` serves the existing build.

Environment variables (also shown in `.env.example`):

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP listening port; use an available port |
| `DATABASE_PATH` | `./data/garden.db` | SQLite file, relative to the working directory or absolute |
| `SUPABASE_URL` | required | Supabase project URL used for email authentication |
| `SUPABASE_PUBLISHABLE_KEY` | required | Public project key used by the client and for server token validation |
| `SUPABASE_SECRET_KEY` | required | Server-only secret key used solely to permanently delete Auth users |
| `APP_ORIGIN` | empty | Optional comma-separated origins allowed to call the API when the client is hosted elsewhere |

For example, `PORT=4173 bun run start`. Keep the same `DATABASE_PATH` when
restarting to retain data. Bun can load a local `.env`; it is excluded from
source and Docker build context. `GET /healthz` reports readiness and backup/billing/deletion maintenance status. Missing production configuration fails startup.

## Stack and source layout

- React 19, React Query, and Tailwind CSS in `client/src/`.
- `client/build.mjs` builds production JavaScript with Bun and CSS with the
  Tailwind CLI, writing `client/dist/`.
- `server/src/index.ts` runs the Bun HTTP server; its production bundle is
  `server/dist/index.js`.
- `server/src/http.ts` validates and dispatches requests to the existing Zod
  contracts and business logic in `server/src/actions.ts`.
- SQLite through Bun's SQLite driver and Drizzle ORM; schema in
  `server/src/schema.ts`, startup migration handling in `server/src/db.ts`,
  SQL migrations in `drizzle/`.

There are no Hatch SDK dependencies. The client uses `fetch` and a standard
React Query `QueryClient`.

## Accounts, authorization, and the API

See [the V1.0 setup and release runbook](docs/LAUNCH.md) for all required Stripe, SMTP, backup and production variables, test-mode acceptance, and the explicit deployment approval boundary.

Supabase Auth provides passwordless email codes. Its browser SDK persists and
refreshes the session in local storage, so reloads and later visits remain signed
in. Every data request sends the access token as `Authorization: Bearer <token>`.
The Bun server validates that token against Supabase Auth's `/auth/v1/user`
endpoint and derives `user_id` from the verified user response. `X-User-Id` is
not accepted as authentication.

Actions: `listProjects`, `createProject`, `addEffort`, `addOutcome`,
`completeProject`, `archiveProject`, `restoreProject`, `seedSampleGarden`,
`exportGarden`, and `deletePersonalData`.

Projects, efforts, and outcomes are scoped by `user_id`; mutations check project
ownership on the server. Samples are opt-in and separate for each account. Migration
`0003_user_isolation.sql` preserves older rows under `legacy-unassigned`, which
cannot be claimed by a browser UUID, keeping them hidden from new visitors.

Legacy anonymous self-service import is disabled: UUID possession cannot establish ownership. Existing rows and claim tombstones are preserved for independently verified operator recovery. No public ownership-transfer endpoint remains functional.

Account deletion is coordinated and retryable: it records a durable intent, stops Stripe billing, removes Supabase authentication, and only then purges garden data. Pending accounts cannot write. Server maintenance resumes unfinished deletion without a browser session.

Growth stages retain the original effort thresholds: 0 / 1 / 3 / 6 / 10 / 15.
Completing a project makes it Bloom; archived projects are dormant.

## Local verification

```sh
bun run typecheck
bun test
```

The backend tests cover authenticated isolation, forged-header rejection, foreign
project mutations, rejection of anonymous claiming, export, deletion, request
validation, per-user sample gardens, growth stages, persistence on database reopen,
and legacy migration. They use temporary databases rather than the local garden.

For manual verification, sign in with separate email accounts in independent
browser profiles: each should start empty, and a project added in one must remain
invisible in the other. Log an effort, restart the server with the same database
path, and reload to confirm the project and effort remain. Check the sign-in,
create/log, legacy import, export, and error flows at a 390 × 844 viewport as well
as desktop size.

## Docker and deployment configuration

The existing deployment choice is **Render with SQLite on a persistent disk**.
`render.yaml` configures a Docker web service (`starter` plan), `/healthz`, and a
1 GB disk mounted at `/var/data`. `DATABASE_PATH` points to
`/var/data/garden.db`. Keep this as a single-instance service with persistent
storage; an ephemeral filesystem alone is unsuitable for this database.
No hosted Postgres is required for this configuration.

The multi-stage Dockerfile installs locked dependencies, builds both bundles,
and copies the bundles and migrations into a Bun 1.3.10 runtime image.
With Docker installed and running, supply an isolated staging environment file containing the required settings when testing the production image. Never mount an existing user database for a test. Example commands are:

```sh
docker build -t project-garden:local .
docker run --name project-garden-local -p 3000:3000 \
  --env-file .env.staging -v project-garden-data:/var/data project-garden:local
```

In another terminal, `docker restart project-garden-local` checks restart
persistence. The named volume retains data when the container is removed;
do not delete it if you want to keep the garden. No external deployment is
performed by these local commands. Render deployment itself has not been verified.

The repository can manually deploy the client to **GitHub Pages** through
`.github/workflows/pages.yml`, but Pages cannot run the Bun/SQLite server. Set the
repository variable `PUBLIC_API_BASE_URL` to the Render service URL and set
`APP_ORIGIN` on Render to the exact Pages origin. Without those values the Pages
build cannot use authenticated data. Same-origin Render hosting needs neither.

In Supabase, enable Email auth and use an email template containing `{{ .Token }}`
so the UI's code entry matches the delivered message. Add the production and
local URLs to the allowed redirect URLs. Configure a server-only `sb_secret_...`
key for account deletion; never expose it in client build variables or source.

## Files to preserve

Keep source, `bun.lock`, configuration, and `drizzle/` migrations. Dependencies,
build outputs, `.env`, and local databases are ignored. Back up live SQLite data
using SQLite's backup API; copying only the `.db` while WAL writes are active can
miss recent data. The original owner's private `app.db` was never included.

## Active work and layouts

Projects grow at their own pace, with an optional deadline and optional recurring
activity setting. Existing one-time projects normalize to ongoing projects without
changing their lifecycle, steps, notes, efforts, or outcomes.

Ordered next steps can be added, edited, reordered and completed. Completing a
step records effort once per item. The latest effort supplies Previous step; the
first unfinished item supplies Next step, including in Float. Earlier reminder
notes remain in saved data but are no longer a separate input in the interface.

Garden retains the original project-card grid. Matrix displays SVG plants in four
priority quadrants, with pointer/touch dragging and keyboard arrows. Matrix
coordinates and quadrant classification save independently of old garden positions.
Migration `0005_project_details.sql` adds a JSON details column to the existing
project table; legacy next-step text becomes the first TODO when read.

Float contains only explicitly selected existing projects. Names remain visible
above their SVG plants. It uses Document Picture-in-Picture where available
(desktop Chrome/Edge), with an in-page preview available in other browsers.
Removing a companion never removes the project.

All deployed clients now use the authenticated Bun API. There is no separate
browser-only garden implementation.

## Garden Free and Plus

Free includes 3 active plants and every core feature, with unlimited efforts, outcomes, full growth and history. Garden Plus only removes the active-plant limit: USD $1.49/month or $14.99/year. Checkout and Portal are server-created; raw-body webhook verification, reconciliation and paid-through checks control entitlement. Live billing is disabled by default.

When Plus expires above 3 active plants, the oldest three remain active and extras are safely archived with an explicit notice. Archive a growing plant to free a slot, then restore a plant from Archived. History is never deleted on downgrade.

`bun run check` runs all typechecks, tests and builds. `bun run test:ui` runs a clearly synthetic in-memory browser harness (code 123456) without external email or charges. See [verification results](docs/VERIFICATION.md) and [remaining external setup](docs/LAUNCH.md).
