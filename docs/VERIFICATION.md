# V1.0 verification handoff

Recorded October 13–14, 2026. These results cover the current local implementation. They do not certify configured production services or authorize deployment.

## Completed before the interrupted run

- `bun run check` passed: client/server TypeScript checks, 27 tests with 280 assertions, and client/server builds.
- Automated coverage includes user isolation, the disabled unsafe anonymous-claim path, growth/date regressions, Free capacity and downgrade behavior, subscription reconciliation, signed webhook handling, retryable account deletion, aggregate analytics, and isolated backup recovery.
- Browser acceptance used the synthetic in-memory server, not real Supabase or Stripe. Sign-in error feedback and success, empty state, project creation, next-step completion, efforts, outcomes, history, reload persistence, archive/restore, the three-plant limit, and account switching were exercised. The second account had an empty garden.
- Matrix, Minimal, and Float's in-page preview remained available on Free. Mobile checks at 390 × 844 found no horizontal overflow. Billing displayed $1.49/month and $14.99/year; dialog focus, Escape dismissal, and background isolation were checked. The stale restore notification found during acceptance was corrected.

## Completion checks in the resumed run

- Added a regression test for the backup CLI's read-only SQLite connection. A backup captured committed WAL data while the source remained open; the source connection rejected writes and the original data remained intact. Targeted result: 1 passing test, 3 assertions.
- Server TypeScript check passed after adding that test.
- Executed the existing compiled analytics, backup, and restore scripts in a disposable runtime directory containing only the packaged server output, migrations, and package manifest. Analytics read synthetic aggregate data successfully. Backup and restore rejected missing S3 configuration; restore created no destination database. This checks packaging and configuration errors, not a remote-storage round trip.
- The full suite and completed browser flows were not repeated during the resumed run.

## Required before commercial launch

Follow [LAUNCH.md](LAUNCH.md) for exact configuration and acceptance steps. These checks remain unverified because the required external services or runtime are unavailable locally:

- Real Supabase email delivery, OTP/session behavior, redirect configuration, and administrative account deletion.
- Stripe test-mode monthly and annual checkout, configured Portal cancellation, webhook delivery/retries, renewal failures, and expiration against actual Stripe subscriptions. Provider fakes and signature tests do not replace these checks.
- Independent S3-compatible storage upload/download, deletion-intent persistence, retention, and a remote restore drill with billing/deletion reconciliation.
- Docker image execution (Docker is unavailable here), Render persistent disk behavior, deployment secrets, health checks, and manual deployment controls.
- Native desktop Document Picture-in-Picture and physical mobile keyboard behavior; local browser acceptance covered the in-page fallback and emulated mobile viewport.

No production deployment, real payment, or production-data mutation was performed. Live billing remains disabled by default. Finish the external acceptance checklist before enabling commercial billing.
