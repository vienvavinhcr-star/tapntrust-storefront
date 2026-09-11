-- Replace the IDs, business details, Google review destination and card token.
-- Generate a token with: node insights-worker/scripts/generate-card-token.mjs
-- Run locally with: pnpm exec wrangler d1 execute tapntrust-insights --local --file insights-worker/examples/seed.sql -c insights-worker/wrangler.jsonc

INSERT INTO businesses (id, name)
VALUES ('biz_example', 'Example Business');

INSERT INTO locations (
  id,
  business_id,
  business_name,
  business_address,
  google_place_id,
  google_review_url
)
VALUES (
  'loc_example',
  'biz_example',
  'Example Business',
  'Melbourne VIC',
  'REPLACE_WITH_GOOGLE_PLACE_ID',
  'https://search.google.com/local/writereview?placeid=REPLACE_WITH_GOOGLE_PLACE_ID'
);

INSERT INTO cards (id, public_token, location_id, label, placement_type)
VALUES ('card_example', 'TNT-REPLACE1', 'loc_example', 'Front counter', 'counter');
