# Tapntrust Insights — Phase 1 through Phase 3B

## Scope and product truth

Every physical Tapntrust NFC card, with or without Insights access, receives an immutable public Tapntrust URL:

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
  -> universal card provisioning + programming manifests
  -> optional location-level Insights activation and recovery
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
- `provisioning_batches`: idempotent Shopify order/setup association for one reviewed physical-card provisioning intent; contains no purchaser email.
- `provisioning_batch_cards`: ordered mapping between a provisioning batch and its physical card records.
- `insights_entitlements`: location-level dashboard state, independent of card redirects and tap recording.

Migration `0003_provisioning.sql` follows the existing D1 convention: lifecycle timestamps are ISO UTC `TEXT` values. Numeric columns such as physical-card quantity and ordinal remain `INTEGER` because they are counts, not timestamps.

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
- `POST /api/admin/provisioning/batches` — provisions one immutable token per physical NFC card or safely replays an identical request.
- `GET /api/admin/provisioning/batches` and `GET /api/admin/provisioning/batches/{id}` — recent work and programming manifests.
- `GET /api/admin/provisioning/options` — existing business/location choices and entitlement status for the owner UI.
- `POST /api/admin/insights/activations` — creates/reuses a customer user, grants business access and activates one existing location.
- `POST /api/admin/insights/access/revoke` — removes one explicitly targeted user's access to one business.
- `POST /api/admin/insights/entitlements/deactivate` — hides one location from customer Insights without changing its cards or taps.

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

## Phase 2B universal provisioning and entitlement

Universal provisioning and Insights activation are separate services and lifecycle concepts.

For every legitimate physical NFC card order, staff uses `/admin` to enter the Shopify order/setup reference, explicitly create or select the business/location, confirm the Google destination and confirm the physical NFC card quantity. The server generates one cryptographically random immutable token per physical card and returns the programming manifest. Extra NFC Cards receive their own tokens. Counter Stand does not create a card or token.

All cards record taps from day one. Provisioning without Insights creates only the business, location, cards and order association. It does not create a customer user, grant business access, send authentication email or copy purchaser email from Shopify into D1.

The protected manual endpoint currently accepts between 1 and 100 physical NFC cards in one batch. This upper bound is an operational guard against accidental or abusive oversized writes; larger legitimate fulfilment runs must be split into separately referenced setup operations.

If Insights is activated at purchase time or later, the owner enters a confirmed customer email and selects the existing business/location. The activation service creates or reuses `customer_users`, grants `customer_business_access` and activates the selected `insights_entitlements` row. It does not recreate or update cards, tokens, destinations or taps. The customer uses the existing production magic-link flow and can see historical taps for actively entitled locations only.

Deactivating entitlement hides that location from `/app`; revoking access removes only the selected user/business relationship. Neither operation disables the location/card, changes a public token, deletes tap history or alters `/t/{publicToken}` behaviour. Re-activation makes the retained history visible again.

### Idempotency and conflict detection

The provisioning key is the canonical combination of:

- `source` (`admin_shopify` in Phase 2B);
- external Shopify order reference;
- external business setup reference.

The stored SHA-256 request fingerprint contains only these validated canonical provisioning fields, in a fixed versioned structure:

- source, order reference and setup reference;
- business action plus new business name or selected business ID;
- location action plus new address/Google Place ID or selected location ID;
- canonical approved Google review destination;
- physical NFC card quantity.

It contains no email, purchaser PII, admin credential or other secret. An identical retry returns the original manifest. Reusing the same key with a different fingerprint returns HTTP `409`; changed quantities, destinations, business selection or location selection cannot silently replay the earlier card set. A D1 unique constraint plus an atomic batch prevents concurrent identical requests from creating duplicate cards.

Phase 2B deliberately keeps the future Shopify webhook out of scope. A signed `orders/paid` webhook can later call the same idempotent provisioning service after Shopify event, line-quantity and exception-handling rules are approved.

## Phase 3A Places-first customer dashboard

Phase 3A uses the `google_place_id` already stored on each location. It does not add Google Business Profile OAuth, refresh tokens, customer Google-account linking or background review synchronisation. No D1 migration is required.

The premium `/app` experience is location-scoped and combines two deliberately separate data sources:

- Tapntrust-owned analytics: review opportunities, trend, active-card count, daily/monthly activity, card leaderboard and placement share, engagement timing and the deterministic mascot recommendation.
- live Google Places data: current rating/count and, only on request, the reviews currently selected by Google.

A **review opportunity** means one successful `tap_events` record created when an NFC card directed a visitor to its stored Google review destination. It is not proof that the visitor submitted a review, and the UI does not present it as a conversion or a unique-customer count. Each recorded open is counted individually because Tapntrust deliberately stores no visitor identity, fingerprint or deduplication identifier.

The reporting periods are exact half-open ranges ending at request time: `[now - 7 days, now)` and `[now - 30 days, now)`. Their comparisons use the immediately preceding equal-length range. `all` includes all recorded taps and has no artificial prior-period percentage. Daily/monthly and engagement-time groupings use the browser's current UTC offset when supplied; the dashboard labels this as browser time. This is a fixed-offset presentation choice and can be one hour off across a daylight-saving transition in a historical range until location time zones are explicitly stored.

Every Insights request authenticates the existing 30-day session, derives allowed locations by joining `customer_business_access` to active `insights_entitlements`, and verifies an optional `locationId` against that server-derived list. A client cannot make an arbitrary Place ID request, and neither `google_place_id` nor `GOOGLE_PLACES_API_KEY` is returned to the browser.

Customer routes:

- `GET /api/customer/insights?period=7d|30d|all&locationId=...&timezoneOffsetMinutes=...` — aggregated Tapntrust-owned location analytics. SQL returns bounded aggregates rather than raw event history.
- `GET /api/customer/google-place/summary?locationId=...` — one lightweight live request for `rating`, `userRatingCount` and `googleMapsLinks.placeUri`. Its field mask never includes `reviews`.
- `GET /api/customer/google-place/reviews?locationId=...` — a separate request for `reviews` and the reviews link, called only after the authenticated customer explicitly opens Selected Google Reviews.

Google loading is intentionally cost-controlled. The page normally makes one summary request per location during a page session and zero review requests. Tapntrust's 60-second analytics refresh, `visibilitychange` and window focus do not refetch Google data. A manual summary refresh has a five-minute browser-session cooldown and blocks overlapping requests. Successfully loaded selected reviews remain in page memory when the section is closed and reopened. There is no background prefetch.

The browser cooldown is supplemented by a distributed D1 limiter on both authenticated provider routes. Tenant access is resolved first. The limiter then hashes a versioned namespace containing only the request kind, authenticated customer user ID and entitled location ID before persistence in the existing `auth_request_limits` table. Summary and review traffic have independent namespaces. Summary permits at most 30 provider calls per hour with at least 30 seconds between calls; reviews permit at most 12 per hour with at least two minutes between calls. A rejected request returns a calm `429` response and never reaches Google. The limiter does not persist email, Place ID, API key, visitor IP, user agent or browser fingerprint.

This per-user, per-location limiter is intentionally modest rather than a complete global abuse-control system. An attacker controlling many valid customer accounts or entitled locations could still spread requests across keys. Keep conservative Google Cloud quotas and billing alerts in place; a future WAF/global quota layer can be added if real traffic warrants it without changing the tenant model.

Google responses are live display data and are never persisted in D1. There are no rating, review, reviewer, review-time or snapshot tables. Google failure returns only a calm unavailable status and cannot block Tapntrust analytics or the mascot recommendation. Provider errors log only a safe reason category; the API key, provider response body, Place ID and review content are not logged.

The Worker calls the official Places API (New) Place Details endpoint with an explicit minimal `X-Goog-FieldMask`; wildcard masks are forbidden. Containers displaying Google-provided rating, rating-count or selected-review data include the exact text attribution `Google Maps` with `translate="no"`; it is visually separate from Tapntrust KPI labels and no custom mark is presented as a Google logo. Review display preserves every available author avatar, name and profile link, each individual Google Maps source link, publish information and `visitDate`, clearly states that Google selects and relevance-orders the sample, and links customers back to Google Maps. The approved mascot is served as the exact repository asset `insights-worker/assets/tapntrust-insights-mascot.png`.

## Phase 3B customer dashboard experience

Phase 3B is primarily a presentation and retention update. It adds one narrowly scoped card-details route but introduces no database migration, provider, authentication or entitlement-model change. The customer dashboard intentionally uses a small set of focused areas rather than an admin-style collection of raw metrics:

- a selected-period hero with Review Opportunities, comparable-period momentum, the strongest active card, active-card count and retained all-time history;
- one mascot-led recommendation that converts the visible card/day/time data into a concrete next action;
- one compact **Your Tapntrust Cards** area where a customer can give each owned physical card a useful placement name;
- one combined performance and timing area for the strongest card, busiest day, strongest time window and activity pattern;
- an active-card comparison with customer-facing placement names, share, trend and clear status badges;
- one Google Presence area containing the live rating snapshot and opt-in Selected Google Reviews.

The hero count uses responsive number typography so comma-formatted values through `100,000+` remain contained at a 390px viewport. A deterministic low-data threshold of five Review Opportunities avoids calling a card, day or time window a confident top performer too early. Zero activity receives a useful setup prompt; one through four opportunities are presented as an early signal; normal strongest-card/day/time recommendations begin at five. The underlying activity remains visible throughout.

The recent-event table is deliberately not rendered in the customer experience because individual timestamps add noise without changing the action a small-business owner should take. Empty and low-data states encourage better card visibility without inventing activity, and the approved mascot appears once as the recommendation guide rather than as repeated decoration. Google failure cannot suppress Tapntrust-owned activity; the page tells the customer that tap insights remain available.

Recommendations are deterministic and derived only from the current response: active cards, period opportunities, placement, activity share, weekday totals and the strongest available time window. They do not claim review submissions, unique visitors or outcomes that Tapntrust does not measure.

Customer card editing uses `PATCH /api/customer/cards/{cardId}` with exact same-origin enforcement, the existing 30-day session, `application/json`, a bounded body, the existing placement enum and a trimmed 40-character label without control characters. The server resolves ownership by joining the authenticated user through `customer_business_access`, an active location and an active Insights entitlement; it never accepts a client business or location ID. A successful update can change only `cards.label`, `cards.placement_type` and `cards.updated_at`. The immutable public token, card/location identity, Google destination, active state, provisioning records and tap history cannot be changed by this route. Presets map to the existing enum: Front Counter → `counter`, Table → `table`, Reception → `reception`, Payment Area → `register`, while Wall, Waiting Area, Entrance and a validated custom name use `other`. On Apply, a generic placeholder such as `Card 1` adopts the known placement preset already shown to the customer; a real custom label keeps its existing placement classification until the customer explicitly changes the dropdown. Passive 60-second analytics refreshes do not rebuild a dirty or focused editor. A successful Apply or a location change renders the canonical saved state again. Card Performance may rank cards for the selected period, but the settings area uses the immutable public token—not a changing list index—as the stable physical identifier.

### Phase 3A manual production setup

After review and merge, but before deploying:

1. Enable **Places API (New)** in the intended Google Cloud project and apply API restrictions so the key can call only the required Maps Platform API. Configure conservative quota and billing alerts appropriate to the customer count.
2. Add the server-only Worker secret interactively:

   ```bash
   pnpm exec wrangler secret put GOOGLE_PLACES_API_KEY -c insights-worker/wrangler.jsonc
   ```

   Never put the real value in source, `.dev.vars.example`, test fixtures, logs, Git history or the browser. For local work, use only the ignored `insights-worker/.dev.vars`.
3. Confirm every Insights-enabled location has the correct existing `google_place_id`. Missing or malformed IDs produce a calm Google-unavailable state and never fall back to client search.
4. Run `pnpm run check:all` and the Wrangler deploy dry-run, then deploy manually. No D1 migration is applied for Phase 3A.
5. With one controlled tenant, verify that the location cannot access another tenant, Tapntrust analytics continue when the provider is unavailable, the initial Google request omits reviews, and selected reviews load only after the explicit button click.

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

Phase 1 and Phase 2A production infrastructure were verified on 12 September 2026:

- Worker: `tapntrust-insights-redirect`.
- Custom domain: `go.tapntrust.com`; `/health` returns HTTP 200.
- D1: `tapntrust-insights`, bound as `DB` in the OC region with migrations `0001_initial.sql` and `0002_customer_auth.sql` applied.
- The required `ADMIN_API_TOKEN` name is declared in `wrangler.jsonc`, while its value exists only as an encrypted Cloudflare Worker secret.
- A physical NFC card completed the tracked redirect flow successfully.
- ZeptoMail delivery and the complete iPhone/Gmail flow were verified: request link -> email -> non-consuming GET confirmation -> explicit POST -> 30-day session -> `/app`.

The committed `wrangler.jsonc` is the deployment source of truth for the public custom domain, D1 binding, compatibility settings and required secret name. It must never contain the secret value. Production and test records are operational data and must never be copied from D1 or a working `seed.sql` into Git.

## Existing Phase 2A production configuration

The ZeptoMail Agent and verified `tapntrust.com` sender domain exist in the AU data centre. Preserve the following configuration for future releases:

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

Insights activation creates a `customer_users` row and matching `customer_business_access`; universal card provisioning does not. Removing access affects dashboard visibility only and must never alter card tokens or redirect availability.

For future releases, confirm pending migrations, run the checks, then deploy:

```bash
pnpm exec wrangler d1 migrations list DB --remote -c insights-worker/wrangler.jsonc
pnpm run check:all
pnpm exec wrangler deploy --dry-run -c insights-worker/wrangler.jsonc
pnpm exec wrangler deploy -c insights-worker/wrangler.jsonc
```

Provision each purchased business, location and card only through a protected owner/server-side process. Use `wrangler secret put ADMIN_API_TOKEN -c insights-worker/wrangler.jsonc` when rotating the admin token; never write the value into the repository.

## Phase 2B production rollout — manual after merge

The Phase 2B pull request must not migrate or deploy production automatically. Before applying `0003_provisioning.sql`, report the exact number of existing locations that its access-preservation backfill will activate:

```sql
SELECT COUNT(DISTINCT l.id) AS locations_to_receive_active_entitlement
FROM locations l
JOIN customer_business_access a ON a.business_id = l.business_id;
```

This query contains no customer records in Git; run it directly against the production D1 database during the approved rollout. Review the count before continuing.

After approval, the production sequence is:

1. Confirm the backfill count and a current D1 recovery point/export.
2. Apply pending migration `0003_provisioning.sql` manually.
3. Verify that the number of `phase2a_backfill` entitlement rows equals the approved count.
4. Deploy the Worker manually.
5. Provision one controlled non-Insights card batch and confirm there are no customer/access rows.
6. Tap its URL and confirm redirect plus tap recording.
7. Activate Insights for that existing location and confirm the historical tap appears through the unchanged magic-link flow.
8. Exercise revoke/deactivate on controlled data and confirm the physical redirect continues.

No real secret, customer record or production query result belongs in Git or the pull request.

## Fulfilment transition

Current orders carry the direct Google review URL described in `docs/FULFILMENT.md`; Phase 2B does not change that storefront code or any Shopify attributes. The URL is input for the protected provisioning workflow and becomes the location's stored redirect destination.

Every physical Tapntrust NFC card must be programmed with `https://go.tapntrust.com/t/{publicToken}`. There is no normal-card/direct-Google variant and no Insights-only card variant. Insights changes dashboard entitlement only.

The mapping must be created server-side during fulfilment. The browser must never receive D1 write credentials or Cloudflare admin secrets. Extra NFC cards require their own token even when they share the primary card's location.

## Non-negotiable lifecycle rule

The redirect is a permanent product function. If a future insights subscription expires or is cancelled, reporting access may stop, but every physical card must continue resolving and redirecting to its stored Google destination. Subscription state must never be used as a redirect condition.

## Verification

Run:

```bash
pnpm run check:all
```

The Worker integration tests cover valid redirects, separate tracking for shared destinations, unknown and inactive cards, destination allowlisting, database write failure with redirect continuity, admin protection, label/placement updates that preserve token and destination, scanner-safe magic-link confirmation, JSON/origin enforcement, enumeration-safe cooldown responses, magic-link sessions, unauthenticated rejection and cross-tenant isolation.
