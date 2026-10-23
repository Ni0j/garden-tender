# Garden V1.0 setup and release

Run all commands from the **gardener Git repository** (the directory containing this file's parent package.json). Do not deploy the sibling `project-garden-source`: it is an obsolete, unauthenticated copy. This release preserves React + Bun + SQLite + Render. No production deployment, credential configuration, live charge, or existing-user-data change has been performed by implementation work.

## Local checks

Use Bun 1.3.10:

```sh
bun install --frozen-lockfile
bun run check
bun run test:ui
```

`test:ui` serves the built application at http://127.0.0.1:4197 using a synthetic email provider and an in-memory database. Use any synthetic email and code `123456`. It cannot run unless `NODE_ENV=test`, is not part of the production entry point or runtime image, and is not proof of real email/payment delivery. Stop it with Ctrl-C. For an actual staging app, configure the following services and run `bun run start` with an isolated `DATABASE_PATH`.

## Product rules

Free: 3 active plants, unlimited efforts/outcomes, full visualization/history, all core views and features. Plus: unlimited active plants, USD $1.49/month or $14.99/year. There are no other paid features or tiers.

On expiration, the oldest 3 active plants (created_at, then id) remain active. Extras become archived with `archive_reason=plan-limit`, and an explicit notice appears. No history is deleted. Users can archive an active plant, then restore an archived plant; restoration checks capacity in the same transaction. Completed plants restore as completed and do not consume active capacity. Upgrading does not silently reactivate previously archived plants. Legacy accounts default to Free and follow the same rule.

Anonymous self-service claiming is disabled with HTTP 410. UUID possession is not proof of ownership. Existing anonymous rows and claim tombstones are preserved. Do not re-enable public claiming. Any operator-assisted recovery requires independent ownership verification, an approved backup/migration, and the same Free-capacity policy; do not infer eligibility merely from a UUID or absence from the new accounts table. Obsolete setNextStep/completeNextStep APIs return 404; updateProject/toggleTodo is the canonical, once-credited completion path.

## Supabase and production OTP email

Set server environment variables (never commit .env):

- `SUPABASE_URL=https://<project>.supabase.co`
- `SUPABASE_PUBLISHABLE_KEY=sb_publishable_...` (public, never a service-role/secret key)
- `SUPABASE_SECRET_KEY=sb_secret_...` (server-only account deletion key)
- `PUBLIC_APP_URL=https://<your-garden-host>` (canonical frontend URL, no trailing slash)

In Supabase Authentication:

1. Enable Email authentication with email confirmation.
2. Set Site URL to PUBLIC_APP_URL and allow the precise staging/production redirect URLs you use.
3. Set both the **Confirm sign up** and **Magic link or OTP** templates to include the OTP, for example `<h2>Your Garden code</h2><p>{{ .Token }}</p>`. Set Email OTP length to 8 digits; the app requires exactly eight digits.
4. Configure **custom SMTP** with your sender name/address, SMTP host, port, username, and password. Verify the sending domain's DNS with the email provider. These credentials belong in the Supabase dashboard, not Garden's browser bundle.
5. Verify a brand-new account and a returning account at email addresses outside the Supabase project team. Test an invalid/expired code, resend, reload, token refresh, sign-out, and sign-in from a second browser. Verify deleting a disposable account removes its Supabase user.

Supabase's default email service is not suitable for public delivery. References: https://supabase.com/docs/guides/auth/auth-smtp and https://supabase.com/docs/guides/auth/auth-email-passwordless . Dashboard configuration and real delivery must be completed by the owner with access.

## Stripe TEST MODE first

No live credentials are required for development. Keep `ALLOW_LIVE_BILLING=false`.

1. Create a Stripe sandbox/test-mode Garden Plus product.
2. Create exactly two active, licensed recurring USD prices: **149 cents every 1 month** and **1499 cents every 1 year**. No trial, promotion, quantity selector, or extra plan. Record their Price IDs.
3. Create a Customer Portal configuration allowing payment-method updates, invoices, and subscription cancellation **at period end**. Disable subscription plan/quantity switching; the launch does not introduce plan-change/proration behavior. Record its `bpc_...` configuration ID.
4. Set:

```dotenv
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PRICE_MONTHLY=price_...
STRIPE_PRICE_YEARLY=price_...
STRIPE_PORTAL_CONFIGURATION_ID=bpc_...
STRIPE_WEBHOOK_SECRET=whsec_...
ALLOW_LIVE_BILLING=false
```

5. Register an HTTPS snapshot webhook endpoint at `<backend>/api/billing/webhook`. Use the SDK's pinned API version **2026-09-30.endive**. Subscribe to:
   - checkout.session.completed
   - checkout.session.async_payment_succeeded
   - customer.subscription.created / updated / deleted
   - invoice.paid / payment_failed / payment_action_required / finalization_failed
6. For localhost, run `stripe listen --forward-to localhost:3000/api/billing/webhook` in test mode and use the listener's signing secret. Dashboard and CLI signing secrets differ.
7. In Stripe Billing email/revenue-recovery settings, enable unsuccessful-payment/action-required emails and configure failed-renewal retries to eventually cancel or mark unpaid. Garden also displays payment attention and respects the paid-through deadline; it does not offer indefinite unpaid access.
8. Restart Garden. Startup and Checkout verify both prices and Portal configuration against Stripe before use.

Use Stripe's published test cards only (for example 4242 4242 4242 4242, future expiry, any test CVC). Complete **both** monthly and annual Checkout flows using separate disposable accounts. Check the server-verified plan after return; the return URL itself cannot grant access. Test declined and authentication-required cards using Stripe's current test guide: https://docs.stripe.com/testing . Cancel in Portal and verify Plus through paid-through time, then expiry and excess-plant archiving. Exercise renewals and failed renewals with Stripe test clocks/test subscriptions. Redeliver a webhook and deliver an older event after cancellation; current provider state must win.

Customer ownership is stored locally from server-created customers. Webhook metadata never assigns ownership. Verified events trigger a fresh provider read under a per-account lock, not blind application of old event payloads. Event IDs are deduplicated. The server polls customer state every 5 minutes as a missed-webhook fallback. `active` and `past_due` grant Plus only through a verified paid period; canceled/unpaid/incomplete do not.

References: https://docs.stripe.com/webhooks , https://docs.stripe.com/billing/subscriptions/webhooks , https://docs.stripe.com/customer-management/configure-portal .

## Independent backups and restoration

Create a **private** S3-compatible bucket with encryption at rest and public access blocked. Use a dedicated prefix per staging/production environment, with credentials restricted to ListBucket on that prefix and GetObject/PutObject/DeleteObject within it. Do not reuse a public asset bucket. Configure:

```dotenv
BACKUP_S3_BUCKET=<private-bucket>
BACKUP_S3_REGION=<region>
BACKUP_S3_ACCESS_KEY_ID=<restricted-key>
BACKUP_S3_SECRET_ACCESS_KEY=<secret>
BACKUP_S3_ENDPOINT=<optional-HTTPS-endpoint-for-non-AWS-S3>
BACKUP_S3_PREFIX=garden-production
```

The running SaaS service creates a SQLite-consistent VACUUM INTO snapshot (including committed WAL data) on startup and every 6 hours. Testing mode keeps backups manual. Every backup checks SQLite integrity/foreign keys, uploads the database and SHA-256 manifest, removes temporary local files, and prunes snapshots older than 30 days. A failed automatic backup retries; SaaS `/healthz` returns 503 if no successful backup exists within 8 hours. Configure an external health monitor for `/healthz` and Render failure alerts. The SaaS RPO target is at most 6 hours under normal operation; measure recovery time during the rehearsal.

Deletion intents are uploaded separately **before external account removal** and retained for 90 days. Restore imports these newer intents, preventing a pre-deletion snapshot from reviving a deleted garden. Restores older than 30 days are refused. Do not restore an offline old copy without independently reconciling deletions and billing.

Commands from the repository root (use the compiled paths in the runtime container):

```sh
bun run backup
# Runtime image equivalent:
bun server/dist/scripts/backup.js
# Use a returned snapshot key and a NEW destination, never the live database:
bun run restore garden-production/snapshots/<snapshot>.db /tmp/garden-recovery/recovered.db
# Runtime image equivalent:
bun server/dist/scripts/restore.js garden-production/snapshots/<snapshot>.db /tmp/garden-recovery/recovered.db
```

The restore command verifies checksum/integrity, applies forward migrations, reapplies deletion locks, and clears stale entitlement deadlines. It refuses to overwrite an existing destination. Run a recovery rehearsal against isolated storage and disposable provider accounts. **Do not start a production-connected restored copy casually:** startup resumes pending deletion and reconciles Stripe. Inspect the restored data offline first; obtain explicit approval before replacing production files or running external cleanup. Stop the original service before an approved replacement. Never copy just the live .db while WAL is active, and never treat a Render disk snapshot as a tested database backup.

## Account deletion and privacy

Deletion states persist as billing → auth → purge → complete. Pending deletion blocks new writes. Garden first records the recovery intent, expires outstanding Checkout sessions and deletes the Stripe customer (which cancels subscriptions), then deletes the Supabase user, then purges garden rows and subscriptions. Provider failures preserve progress and garden data for automatic 60-second retries. A deleted Supabase account does not need to sign in to finish: the server resumes pending work on restart. Missing provider configuration fails explicitly rather than claiming success. Verify failure/retry paths using disposable accounts.

Analytics uses only six allowlisted daily aggregate counters: sign_in, plant_created, effort_created, outcome_created, upgrade_initiated, subscription_activated. No garden content, email, request payload, token, or per-user analytics event is stored. Sign-in is counted once per account per UTC day (including an authenticated return); samples are excluded from creation counts. Event aggregates and webhook receipts expire after 90 days. Minimal deletion tombstones expire after 90 days; backups after 30. Run `bun run analytics` (or `bun server/dist/scripts/analytics.js`) for a private operator readout. Do not expose this as a public endpoint.

## Render deployment — approval required

1. Obtain approval for production deployment **and forward database migration**. Take and verify an independent pre-migration backup of the existing database first.
2. Deploy the `gardener` Git repository with its Dockerfile/render.yaml. If using a parent monorepo, explicitly set root directory to `gardener`. Never select `project-garden-source`.
3. Keep one instance and the persistent disk mounted at `/var/data`; set `DATABASE_PATH=/var/data/garden.db`. Monitor capacity; snapshots are staged in temporary storage, not on the 1 GB live disk.
4. Supply every required variable in `.env.example`; production refuses missing auth, billing, disk, or backup settings. Keep Stripe in test mode until test acceptance is complete.
5. Render auto-deploy is disabled. Also set Blueprint Auto Sync to **No** in the dashboard; choose a manual release after checks pass. GitHub Pages is manual-only and is optional. If retained, its `PUBLIC_API_BASE_URL` must name the backend and `APP_ORIGIN` must exactly allow the frontend origin. Same-origin Render hosting is the default.
6. Verify `/healthz`, sign-in, separate-user isolation, create/effort/outcome flows, restart, redeploy, and unchanged saved data. Confirm an off-disk backup object and execute an isolated download/restore rehearsal.
7. For the later, separately approved live launch, create equivalent live Stripe prices/Portal/webhook, replace only the corresponding secrets/IDs, and set `ALLOW_LIVE_BILLING=true` with `NODE_ENV=production`. Never point development at live keys.

The runtime image contains compiled operational scripts and no test harness. Docker builds run typechecks, tests, and production builds. CI also runs these on pushes/PRs. Disk-backed Render deployment may have brief downtime; single-instance locking is intentional. Do not add another process/instance sharing the database without revisiting billing coordination and SQLite behavior.

## Required owner-side acceptance still to record

- [ ] Real Supabase OTP delivery, refresh, sign-out, and admin deletion.
- [ ] Successful Stripe sandbox monthly and annual payments, Portal cancellation, renewals, failure emails, and expiry.
- [ ] Actual private S3 upload/download and deletion-journal recovery rehearsal.
- [ ] Docker image build/run and Render disk restart/redeploy persistence.
- [ ] Approval for production migration/deployment; later approval for live billing.

These are not marked complete by mocked tests or by the existence of configuration files.
