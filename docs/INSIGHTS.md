# Tapntrust Insights — Phase 1 + Phase 2A

## Scope and product truth

Phase 1 gives each physical NFC card an immutable public Tapntrust URL:

```text
https://go.tapntrust.com/t/TNT-A7K29
```

When a customer taps, the Worker resolves the card, records a privacy-minimised tap event, and redirects to the Google review URL stored for that card's location.

A tap is not proof that a review was submitted. Phase 1 does not know the rating, comment, reviewer identity or Google review timestamp. Those require a later, authorised Google Business Profile integration and must not be inferred from tap activity.

## Architecture

```text
Physical NFC card
  -> GET go.tapntrust.com/t/{publicToken}
  -> Cloudflare Worker
       -> D1 lookup: card -> location -> stored Google review URL
       -> D1 tap event write via ctx.waitUntil()
       -> HTTP 302 to allowlisted Google destination

Owner
  -> go.tapntrust.com/admin
  -> Bearer-protected admin API
  -> card counts, recent taps, editable label and placement

Customer
  -> go.tapntrust.com/app
  -> email link GET -> non-consuming confirmation page
  -> explicit same-origin POST -> HttpOnly session cookie
  -> server-side customer -> business access lookup
  -> tenant-scoped cards, tap counts and recent activity
```

The service lives in `insights-worker/` and is deliberately isolated from the GitHub Pages storefront, Shopify cart, checkout, fulfilment metadata, Meta Pixel and Clarity code.

Cloudflare Worker + D1 was chosen for this phase because the redirect and database use a direct platform binding with no browser credential or external database network hop. If future review ingestion or multi-tenant reporting outgrows this model, the data concepts can move to PostgreSQL without changing the public card-token contract.

## Data model

- `businesses`: one Tapntrust business account entity.
- `locations`: a business location and its validated Google review destination.
- `cards`: one immutable `public_token`, one location, an editable label/placement and active state.
- `tap_events`: generated event ID, card ID and UTC timestamp only.
- `customer_users`: an explicitly provisioned customer login email and active state.
- `customer_business_access`: the authoritative many-to-many link between a customer and allowed `business_id` values.
- `auth_magic_links`: a single-use SHA-256 token hash with a 15-minute expiry.
- `customer_sessions`: a SHA-256 session-token hash with expiry and revocation state.
- `auth_request_limits`: temporary SHA-256 email identifiers and per-email request counters used only for abuse control.

Several cards can point to the same location. They still produce distinct per-card counts.

Phase 1 intentionally does not store IP addresses, fingerprints, precise location, email, user identity or full user-agent strings.

## Redirect contract

`GET /t/{publicToken}`:

1. normalises and validates the token;
2. resolves the card and location from D1;
3. requires both to be active;
4. accepts only an HTTPS Google destination (`google.com`, `google.com.au`, `g.page`, or `maps.app.goo.gl` and approved subdomains);
5. schedules a raw tap event through `ctx.waitUntil()`;
6. immediately returns a non-cacheable `302` redirect.

If the tap insert fails after a valid destination is resolved, redirect still wins. If lookup itself fails, the Worker cannot safely know the destination and returns a generic temporary-unavailable response. Unknown tokens, inactive cards, inactive locations and invalid/missing destinations return the same generic unavailable page so internal state is not exposed.

`HEAD` resolves and redirects without recording a tap, reducing false events from basic availability checks.

### Duplicate handling

Every valid `GET` is currently one raw event. Repeat taps, some link previews and automated scanners may therefore inflate the count. This is an intentional Phase 1 limitation: no fingerprinting or long-lived identifiers are introduced just to deduplicate. Later reporting can show raw taps separately from a clearly defined privacy-safe estimate.

## Owner access

`GET /admin` serves the minimal Phase 1 dashboard. The owner enters the Cloudflare `ADMIN_API_TOKEN`; it is retained only in `sessionStorage` for the current browser tab.

Protected routes:

- `GET /api/admin/summary` — this-month count, per-card counts and 30 recent tap events.
- `PATCH /api/admin/cards/{publicToken}` — updates only `label` and `placementType`.

Allowed placement values are `counter`, `table`, `reception`, `register`, and `other`. The update query cannot modify the token, location or Google destination.

The internal owner mechanism remains separate from customer authentication. Do not expose the admin token in storefront code, GitHub, screenshots, customer pages or customer configuration.

## Phase 2A customer authentication and tenant model

`GET /app` serves the customer dashboard. Customers request a passwordless sign-in link through `POST /api/auth/request-link`. This endpoint requires `application/json` and an `Origin` matching the configured `AUTH_BASE_URL`. Its accepted and rate-limited responses are deliberately identical so they do not reveal whether an email is registered. Only active, pre-provisioned customer accounts receive an email.

Magic-link and session tokens are cryptographically random. D1 stores only their SHA-256 hashes. Magic links are single-use and expire after 15 minutes. `GET /auth/verify?token=...` validates only the token format and directly renders a self-contained confirmation form; it does not read or consume the D1 record, authenticate the visitor, redirect, or set a pending-token cookie. The raw token is carried in the form's hidden field. Only an explicit `POST /auth/confirm` with the required form content type, a valid request source and a valid token can atomically consume the matching unexpired D1 record and create the 30-day session. Automated GET previews and safe-link scans therefore cannot invalidate a customer's link, and the flow does not depend on an email client preserving a cookie across redirects.

The confirmation response uses `Cache-Control: no-store`, `Referrer-Policy: origin`, a restrictive content security policy and no external resources. The `origin` policy is intentional: unlike the former `no-referrer` policy, it does not cause navigation-mode form POSTs to lose their source signal, while the `Referer` contains only `https://go.tapntrust.com/` and never the token-bearing path or query. The token intentionally remains in the address bar while the confirmation page is open because replacing the URL with client-side history code could make a reload fail in memory-constrained iOS or in-app browsers. This is a reliability tradeoff, bounded by the 15-minute expiry and single-use consume.

`POST /auth/confirm` always rejects `Sec-Fetch-Site: cross-site`. When `Origin` is present it must exactly match the configured `AUTH_BASE_URL` origin; a wrong or opaque `Origin` cannot be overridden by any other header. When a compatible iOS WebView omits `Origin`, the Worker accepts `Sec-Fetch-Site: same-origin`, or falls back to an exact-origin `Referer` for older/privacy-restricted clients. `same-site`, `none`, missing or unrecognised Fetch Metadata are not sufficient on their own. This fallback is additionally bounded by the high-entropy, 15-minute, single-use token submitted in the form body.

Temporary rejection diagnostics for this endpoint log only one reason code (`bad_origin`, `bad_content_type`, `bad_token_format`, or `token_not_consumable`), whether Origin was present, a parsed HTTP(S) origin when safe, and a normalised `Sec-Fetch-Site` category. They never log the token, request body, session cookie, email, URL path/query, provider credential or other secret. Remove or reduce this temporary diagnostic after the production iOS flow has been confirmed stable.

GET-only scanners cannot consume the link; an unusually aggressive scanner that deliberately submits same-origin HTML forms remains indistinguishable from a user confirmation without adding a stronger interactive challenge.

Request-link abuse control is server-side and applies the same way to registered and unregistered addresses. D1 retains only a SHA-256 email identifier, permits at most one accepted request per minute and three per 15-minute window, and opportunistically deletes limiter rows older than 24 hours. It does not retain IP addresses, browser fingerprints or user-agent data.

This per-email limiter is not a complete global anti-abuse system: a distributed attacker can still rotate through many destination addresses. A future production hardening layer may add a carefully configured Cloudflare rate-limit/WAF rule or Turnstile. Phase 2A deliberately does not claim global protection or introduce IP tracking to simulate it.

`GET /api/customer/summary` is the only Phase 2A customer data endpoint. It does not accept a business selector. The server resolves the session to a customer, joins through `customer_business_access`, and applies that user ID inside every business, location, card and tap query. Query-string or body `business_id` values never determine access.

The customer dashboard is read-only in Phase 2A. Internal `/admin` remains the owner/master mechanism for editing labels and placement. Phase 2A does not add Google review ingestion, billing or subscription enforcement.

Email delivery remains isolated behind the `MagicLinkMailer` interface and uses ZeptoMail's HTTPS REST API. The Worker posts to the AU data-centre endpoint at `https://api.zeptomail.com.au/v1.1/email` with an Agent-specific Send API key held only in the `ZEPTOMAIL_API_KEY` Worker secret. `AUTH_FROM_EMAIL` remains `contact@tapntrust.com`. Click and open tracking are disabled for authentication mail.

ZeptoMail response bodies and credentials are never returned to customers or copied into logs. If the provider rejects a request or is unavailable, the public response remains enumeration-safe, the newly-created magic-link row is deleted, and the Worker logs only a safe failure category plus an HTTP status when one exists.

## Local development

Install dependencies, copy the local secret template, apply migrations and start the Worker:

```bash
pnpm install
cp insights-worker/.dev.vars.example insights-worker/.dev.vars
pnpm exec wrangler d1 migrations apply DB --local -c insights-worker/wrangler.jsonc
pnpm run dev:insights
```

Generate a new public card token:

```bash
node insights-worker/scripts/generate-card-token.mjs
```

Copy `insights-worker/examples/seed.example.sql` to the ignored `insights-worker/examples/seed.sql`, replace its placeholders, and execute only that ignored copy against the intended local or remote D1 database. Never commit real or test business, location, card or customer data. Never edit an issued card's token later.

## Production status

Phase 1 production infrastructure was verified on 12 September 2026:

- Worker: `tapntrust-insights-redirect`.
- Custom domain: `go.tapntrust.com`; `/health` returns HTTP 200.
- D1: `tapntrust-insights`, bound as `DB` in the OC region with migration `0001_initial.sql` applied.
- The required `ADMIN_API_TOKEN` name is declared in `wrangler.jsonc`, while its value exists only as an encrypted Cloudflare Worker secret.
- A physical NFC card completed the tracked redirect flow successfully.

The committed `wrangler.jsonc` is the deployment source of truth for the public custom domain, D1 binding, compatibility settings and required secret name. It must never contain the secret value. Production and test records are operational data and must never be copied from D1 or a working `seed.sql` into Git.

## Phase 2A production setup — manual

This change does not apply a production migration or deploy the Worker. The ZeptoMail Agent and verified `tapntrust.com` sender domain must exist in the AU data centre before deployment. Then:

1. In the ZeptoMail AU console, copy the Agent-specific **Send API key** for the Agent that owns the verified `contact@tapntrust.com` sender. Do not use a Zoho OAuth token or expose the Send API key in client code.
2. Create the encrypted Worker secret from an interactive terminal prompt:

   ```bash
   pnpm exec wrangler secret put ZEPTOMAIL_API_KEY -c insights-worker/wrangler.jsonc
   ```

   Never put the real key in `wrangler.jsonc`, `.dev.vars.example`, source code, test fixtures, Git history, PR text or screenshots. A local real value may be placed only in the ignored `insights-worker/.dev.vars` file.
3. If Phase 2A migration `0002_customer_auth.sql` has not already been applied, apply it remotely once:

   ```bash
   pnpm exec wrangler d1 migrations apply DB --remote -c insights-worker/wrangler.jsonc
   ```

4. Run the full checks and a deployment dry run, then deploy the Worker manually:

   ```bash
   pnpm run check:all
   pnpm exec wrangler deploy --dry-run -c insights-worker/wrangler.jsonc
   pnpm exec wrangler deploy -c insights-worker/wrangler.jsonc
   ```

5. Provision each customer and each allowed business link through a protected owner/server-side process. Do not add real addresses or access mappings to example SQL or Git.
6. With a controlled customer account, request a sign-in link and verify delivery from `contact@tapntrust.com`. Confirm the link opens the non-consuming confirmation page, the explicit POST signs in exactly once, reuse fails, logout works and cross-tenant data remains inaccessible before inviting customers.

Customer provisioning must create a `customer_users` row and at least one matching `customer_business_access` row. Removing or deactivating that access affects dashboard visibility only; it must never alter card tokens or redirect availability.

For future releases, confirm pending migrations, run the checks, then deploy:

```bash
pnpm exec wrangler d1 migrations list DB --remote -c insights-worker/wrangler.jsonc
pnpm run check:all
pnpm exec wrangler deploy --dry-run -c insights-worker/wrangler.jsonc
pnpm exec wrangler deploy -c insights-worker/wrangler.jsonc
```

Provision each purchased business, location and card only through a protected owner/server-side process. Use `wrangler secret put ADMIN_API_TOKEN -c insights-worker/wrangler.jsonc` when rotating the admin token; never write the value into the repository.

## Fulfilment transition

Current orders carry the direct Google review URL described in `docs/FULFILMENT.md`; Phase 1 does not change that code or Shopify attributes.

The production Worker, D1, custom domain and physical redirect path are verified. Future tracked cards can be deliberately programmed with `https://go.tapntrust.com/t/{publicToken}` instead of the direct Google review URL. The stored location destination remains the Google URL from the existing fulfilment data.

The mapping must be created server-side during fulfilment. The browser must never receive D1 write credentials or Cloudflare admin secrets. Extra NFC cards require their own token even when they share the primary card's location.

## Non-negotiable lifecycle rule

The redirect is a permanent product function. If a future insights subscription expires or is cancelled, reporting access may stop, but every physical card must continue resolving and redirecting to its stored Google destination. Subscription state must never be used as a redirect condition.

## Verification

Run:

```bash
pnpm run check:all
```

The Worker integration tests cover valid redirects, separate tracking for shared destinations, unknown and inactive cards, destination allowlisting, database write failure with redirect continuity, admin protection, label/placement updates that preserve token and destination, scanner-safe magic-link confirmation, JSON/origin enforcement, enumeration-safe cooldown responses, magic-link sessions, unauthenticated rejection and cross-tenant isolation.
