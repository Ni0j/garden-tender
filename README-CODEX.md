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

Optional environment variables (also shown in `.env.example`):

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP listening port; use an available port |
| `DATABASE_PATH` | `./data/garden.db` | SQLite file, relative to the working directory or absolute |

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

## Anonymous gardens and API

The client generates a random UUID once per browser origin and persists it in
localStorage under `project-garden.user-id`. Every API request sends that ID
in the `X-User-Id` header. Requests use `POST /api/<action>` with a JSON argument
object and `Content-Type: application/json`.

Actions: `listProjects`, `createProject`, `addEffort`, `addOutcome`,
`completeProject`, `archiveProject`, and `seedSampleGarden`.

Projects, efforts, and outcomes are scoped by `user_id`; mutations check project
ownership. Samples are opt-in and separate for each identity. Migration
`0003_user_isolation.sql` preserves older rows under `legacy-unassigned`, which
cannot be used as a browser UUID, keeping them hidden from new visitors.

This is anonymous demo identity, not authenticated login. Anyone with a browser's
ID can use that garden. Tabs on the same origin share identity; different browser
profiles have separate gardens. Clearing localStorage loses access to that garden.
Use HTTPS outside localhost for browser UUID generation.

Growth stages retain the original effort thresholds: 0 / 1 / 3 / 6 / 10 / 15.
Completing a project makes it Bloom; archived projects are dormant.

## Local verification

```sh
bun run typecheck
bun test
```

The backend tests cover isolation, foreign project mutations, request validation,
per-user sample gardens, growth stages, persistence on database reopen, and legacy
migration. They use temporary databases rather than the local garden.

For manual verification, use independent browser profiles: each should start
empty, and a project added in one must remain invisible in the other. Log an
effort, restart the server with the same database path, and reload to confirm the
project and effort remain. Check the create/log flow and recovery from server
errors at a 390 × 844 viewport as well as desktop size.

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

The repository also deploys a standalone build to **GitHub Pages** through
`.github/workflows/pages.yml`. Because Pages cannot run the Bun/SQLite server,
that build stores each visitor's garden in their browser's local storage. Its
data stays on that device and browser profile. The Render deployment remains
the option for server-backed persistence.

## Files to preserve

Keep source, `bun.lock`, configuration, and `drizzle/` migrations. Dependencies,
build outputs, `.env`, and local databases are ignored. Back up live SQLite data
using SQLite's backup API; copying only the `.db` while WAL writes are active can
miss recent data. The original owner's private `app.db` was never included.
