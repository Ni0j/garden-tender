# Project Garden

A farming-themed progress logger. Log effort on a project to grow its plant:
Seed → Sprout → Young plant → Growing plant → Mature plant → Bloom.

## Local setup

Install Bun **1.3.10** and put `bun` on your PATH. Run these commands from
`project-garden-source` (the directory containing `package.json`):

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
source and Docker build context. `GET /healthz` returns `{"ok":true}`.

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

Supabase Auth provides passwordless email codes. Its browser SDK persists and
refreshes the session in local storage, so reloads and later visits remain signed
in. Every data request sends the access token as `Authorization: Bearer <token>`.
The Bun server validates that token against Supabase Auth's `/auth/v1/user`
endpoint and derives `user_id` from the verified user response. `X-User-Id` is
not accepted as authentication.

Actions: `listProjects`, `createProject`, `addEffort`, `addOutcome`,
`completeProject`, `archiveProject`, `seedSampleGarden`, `claimAnonymousGarden`,
`exportGarden`, and `deletePersonalData`.

Projects, efforts, and outcomes are scoped by `user_id`; mutations check project
ownership on the server. Samples are opt-in and separate for each account. Migration
`0003_user_isolation.sql` preserves older rows under `legacy-unassigned`, which
cannot be claimed by a browser UUID, keeping them hidden from new visitors.

Existing browser UUIDs are used only by the authenticated
`claimAnonymousGarden` migration. After sign-in, the UI offers to move that
browser's older garden into the account. The move updates projects, efforts, and
outcomes inside one SQLite transaction and records the UUID in
`anonymous_claims`, preventing another account from claiming it later. Deleting
account data leaves a claim tombstone but removes the account association.

The account menu downloads a JSON export and can permanently delete the signed-in
account. Deletion removes projects, efforts, and outcomes, tombstones any prior
anonymous claim, and then removes the Supabase Auth user through the server-only
Admin API.

Growth stages retain the original effort thresholds: 0 / 1 / 3 / 6 / 10 / 15.
Completing a project makes it Bloom; archived projects are dormant.

## Local verification

```sh
bun run typecheck
bun test
```

The backend tests cover authenticated isolation, forged-header rejection, foreign
project mutations, atomic one-time anonymous claiming, export, deletion, request
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
With Docker installed and running, local verification commands are:

```sh
docker build -t project-garden:local .
docker run --name project-garden-local -p 3000:3000 \
  -v project-garden-data:/var/data project-garden:local
```

In another terminal, `docker restart project-garden-local` checks restart
persistence. The named volume retains data when the container is removed;
do not delete it if you want to keep the garden. No external deployment is
performed by these local commands. Render deployment itself has not been verified.

The repository can deploy the client to **GitHub Pages** through
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
