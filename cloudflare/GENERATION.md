# NAGA question generation and R2 uploads — V241

## Scope

- Existing Discord sessions authorize same-origin report, capture and upload APIs.
- NAGA extraction remains `public/naga-generator-v44.js` with the approved
  `meld-replay-v237` hand/mask validation. No existing question is rewritten.
- `naga-report` reads only the canonical NAGA report host. Redirects are returned
  with `manual` and rejected, not followed. Reports never go into D1; the optional
  one-hour edge cache is an optimization, not a requirement for generation.
- `naga-capture` opens Cloudflare Browser Run without the user's browser cookies.
  It requires an owned completed job, validates all scene coordinates, forces
  opponents' hands concealed, captures only the board and closes the browser.
- The client externalizes generated image bytes before `create_shared_question`.
  Question images are private R2 `question-assets`, accessible through a session
  and the original or imported question's collection permissions. Comment and
  reaction images retain their existing public-bucket policy.
- Legacy bulk import, Bot transfer and new-account signup are not enabled here.
  Client-side candidate extraction is not a background bulk-import service.

## Storage and retry safety

- D1 stores question JSON, job metadata, image hashes/sizes, and permission links.
  It rejects embedded image bytes. The existing 200-question limit still applies.
- An image's owner, destination, SHA-256 and format determine its key. Server
  validation checks permission, binary signature, byte limit and client checksum.
- Inserting a pending ledger row atomically reserves bytes. R2 uses a conditional
  put with SHA-256 verification, then metadata is verified before marking ready.
  A failed upload retains its reservation; retrying the same image reuses its key.
- New questions atomically receive media permission links via an INSERT trigger.
  Turning off generation/uploads does not stop reads of imported images.
- No image deletion API is introduced. Old images, backups and histories remain.

## Free-tier guardrails

- Managed R2 hard stop: 8,000,000,000 bytes, including pending uploads and the
  bound private archive bucket. Existing 7 GB warning remains in the budget.
- Once daily (03:00 JST), reconcile metadata only for the two bound buckets.
  The first request may reconcile stale metadata; no image-body download occurs.
  Keep conservative counters when concurrent uploads could make a snapshot stale.
- Unknown/failed/stale capacity refuses new generation/uploads, not study reads.
- Daily UTC application budgets: 150 report requests, 150 new upload attempts,
  and 480 browser seconds. Capture reserves 60 seconds up front and returns unused
  time after closing. The remaining margin protects the account's 10-minute Free
  Browser Run limit; other applications may also consume that account-wide limit.
- Additional per-user limits: 4 generation API calls/minute and the existing
  40 writes/minute. A returned limit error does not start an automatic retry loop.
- These are application safeguards, not a guarantee against all account-wide
  D1/Workers/Browser limits. No paid subscription is enabled by this deployment.

## Deployment / rollback

1. Verify the named `minkiru-main` database and the daily account-wide D1 usage.
2. Apply `migrations/0003_generation_v241.sql` once (additive, no question rewrite).
3. Deploy the Worker with the BROWSER binding and only reviewed public assets.
4. `GENERATION_ENABLED` and `UPLOADS_ENABLED` control new work independently.
   Keep `MEDIA_LINKS_ENABLED=true` after creating private imported images, even
   when temporarily disabling new generation. Study/read flags are separate.
5. Test a private question: retrieve, capture, save, reopen after full reload.
   Check R2 metadata and an anonymous request denial before reporting completion.

Local regression tests: `node --test tests/generation-v241.test.mjs`.
All unit fixtures are local; no test suite downloads production tables or images.

## Dependency note

The official `@cloudflare/puppeteer` package is pinned to 1.4.0. The npm audit
also reports vulnerabilities in browser-install/extract tooling and existing
Next/build dependencies. The browser-install/extract packages are not in the
deployed Worker bundle; no browser installer or arbitrary ZIP extraction runs
in production. Do not use the suggested downgrade to the obsolete 0.0.11 package.
Dependency updates are a separate maintenance item, not silently described as
a clean audit. This app's production entry is static assets plus its Worker,
not the repository's Next development server.
