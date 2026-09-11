# Tapntrust Insights — Phase 1

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
```

The service lives in `insights-worker/` and is deliberately isolated from the GitHub Pages storefront, Shopify cart, checkout, fulfilment metadata, Meta Pixel and Clarity code.

Cloudflare Worker + D1 was chosen for this phase because the redirect and database use a direct platform binding with no browser credential or external database network hop. If future review ingestion or multi-tenant reporting outgrows this model, the data concepts can move to PostgreSQL without changing the public card-token contract.

## Data model

- `businesses`: one Tapntrust business account entity.
- `locations`: a business location and its validated Google review destination.
- `cards`: one immutable `public_token`, one location, an editable label/placement and active state.
- `tap_events`: generated event ID, card ID and UTC timestamp only.

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

This is Phase 1A administration, not full customer authentication. Do not expose the admin token in storefront code, GitHub, screenshots or client configuration. Full multi-user authentication belongs in Phase 1B.

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

Copy `insights-worker/examples/seed.sql`, replace its placeholders, and execute the copy against the intended local or remote D1 database. Never edit an issued card's token later.

## Production setup

External setup is required before this can receive real NFC traffic:

1. Authenticate Wrangler with the Tapntrust Cloudflare account.
2. Create `tapntrust-insights` in the Oceania location and bind it as `DB` in `insights-worker/wrangler.jsonc`. Wrangler can update the config with the returned database ID:

   ```bash
   pnpm exec wrangler d1 create tapntrust-insights --location oc --binding DB --update-config -c insights-worker/wrangler.jsonc
   ```

3. Apply the migration remotely:

   ```bash
   pnpm exec wrangler d1 migrations apply DB --remote -c insights-worker/wrangler.jsonc
   ```

4. Store a long random admin secret in Cloudflare; never put it in `wrangler.jsonc`:

   ```bash
   pnpm exec wrangler secret put ADMIN_API_TOKEN -c insights-worker/wrangler.jsonc
   ```

5. Deploy the Worker and attach the custom domain `go.tapntrust.com` in Cloudflare Workers & Pages.
6. Seed each purchased business/location/card only through a protected server-side or owner process.
7. Test one real NFC card end to end before changing fulfilment operations.

## Future fulfilment switch — not active yet

Current orders carry the direct Google review URL described in `docs/FULFILMENT.md`; Phase 1 does not change that code or Shopify attributes.

After the Worker, D1, DNS and provisioning workflow are verified, fulfilment can be deliberately changed so each physical card is programmed with `https://go.tapntrust.com/t/{publicToken}` instead of the direct Google review URL. The stored location destination remains the Google URL from the existing fulfilment data.

The mapping must be created server-side during fulfilment. The browser must never receive D1 write credentials or Cloudflare admin secrets. Extra NFC cards require their own token even when they share the primary card's location.

## Non-negotiable lifecycle rule

The redirect is a permanent product function. If a future insights subscription expires or is cancelled, reporting access may stop, but every physical card must continue resolving and redirecting to its stored Google destination. Subscription state must never be used as a redirect condition.

## Verification

Run:

```bash
pnpm run check:all
```

The Worker integration tests cover valid redirects, separate tracking for shared destinations, unknown and inactive cards, destination allowlisting, database write failure with redirect continuity, admin protection, and label/placement updates that preserve token and destination.
