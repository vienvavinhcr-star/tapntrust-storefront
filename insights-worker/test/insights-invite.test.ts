import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { listInsightsInviteCandidates } from "../src/insights-invite";
import { parseProvisioningIntent } from "../src/provisioning";
import { provisionPhysicalCards } from "../src/provisioning-repository";

const NOW = "2026-09-14T10:00:00.000Z";
const REVIEW_URL = "https://search.google.com/local/writereview?placeid=invite-groundwork";

async function clearDatabase(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM insights_invite_deliveries"),
    env.DB.prepare("DELETE FROM insights_subscription_lifecycle_events"),
    env.DB.prepare("DELETE FROM insights_cancellation_requests"),
    env.DB.prepare("DELETE FROM business_insights_intro_redemptions"),
    env.DB.prepare("DELETE FROM insights_billing_events"),
    env.DB.prepare("DELETE FROM insights_subscriptions"),
    env.DB.prepare("DELETE FROM customer_usage_events"),
    env.DB.prepare("DELETE FROM customer_dashboard_visits"),
    env.DB.prepare("DELETE FROM customer_sessions"),
    env.DB.prepare("DELETE FROM auth_magic_links"),
    env.DB.prepare("DELETE FROM auth_request_limits"),
    env.DB.prepare("DELETE FROM customer_business_access"),
    env.DB.prepare("DELETE FROM customer_users"),
    env.DB.prepare("DELETE FROM provisioning_batch_cards"),
    env.DB.prepare("DELETE FROM provisioning_batches"),
    env.DB.prepare("DELETE FROM insights_entitlements"),
    env.DB.prepare("DELETE FROM tap_events"),
    env.DB.prepare("DELETE FROM cards"),
    env.DB.prepare("DELETE FROM locations"),
    env.DB.prepare("DELETE FROM businesses")
  ]);
}

async function provision(email = " Owner@Example.Invalid ") {
  const intent = parseProvisioningIntent({
    externalOrderReference: "#INVITE-1001",
    externalSetupReference: "invite-setup-1001",
    customerEmail: email,
    businessMode: "new",
    businessName: "Invite Test Barber",
    locationMode: "new",
    businessAddress: "100 Invite Street, Melbourne VIC",
    googlePlaceId: "ChIJInviteGroundwork",
    googleReviewUrl: REVIEW_URL,
    physicalCardCount: 2
  });
  if (!intent) throw new Error("Expected provisioning intent");
  return provisionPhysicalCards(env.DB, intent, NOW);
}

beforeEach(clearDatabase);

describe("Phase 4D Insights invitation groundwork", () => {
  it("retains a purchaser email without creating Insights access", async () => {
    const result = await provision();

    expect(result.manifest.customerEmail).toBe("owner@example.invalid");
    expect(result.manifest.physicalCardCount).toBe(2);

    const [batch, users, access, entitlements] = await Promise.all([
      env.DB.prepare("SELECT customer_email FROM provisioning_batches WHERE id = ?1")
        .bind(result.manifest.id)
        .first<{ customer_email: string | null }>(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM customer_users").first<{ count: number }>(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM customer_business_access").first<{ count: number }>(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM insights_entitlements").first<{ count: number }>()
    ]);

    expect(batch?.customer_email).toBe("owner@example.invalid");
    expect(Number(users?.count || 0)).toBe(0);
    expect(Number(access?.count || 0)).toBe(0);
    expect(Number(entitlements?.count || 0)).toBe(0);
  });

  it("becomes invite-eligible after two Review Opportunities and stops when Insights is active", async () => {
    const result = await provision();
    const cardId = result.manifest.cards[0]?.id;
    if (!cardId) throw new Error("Expected provisioned card");

    let contacts = await listInsightsInviteCandidates(env.DB);
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({
      email: "owner@example.invalid",
      purchasedCardCount: 2,
      activeCardCount: 2,
      lifetimeReviewOpportunities: 0,
      eligible: false,
      eligibilityReason: "needs_more_taps",
      insightsStatus: "not_configured"
    });

    await env.DB.batch([
      env.DB.prepare("INSERT INTO tap_events (id, card_id, tapped_at) VALUES (?1, ?2, ?3)")
        .bind(crypto.randomUUID(), cardId, "2026-09-14T10:01:00.000Z"),
      env.DB.prepare("INSERT INTO tap_events (id, card_id, tapped_at) VALUES (?1, ?2, ?3)")
        .bind(crypto.randomUUID(), cardId, "2026-09-14T10:02:00.000Z")
    ]);

    contacts = await listInsightsInviteCandidates(env.DB);
    expect(contacts[0]).toMatchObject({
      lifetimeReviewOpportunities: 2,
      eligible: true,
      eligibilityReason: "eligible"
    });

    await env.DB.prepare(`
      INSERT INTO insights_entitlements (location_id, status, source, activated_at, updated_at)
      VALUES (?1, 'active', 'test', ?2, ?2)
    `).bind(result.manifest.locationId, NOW).run();

    contacts = await listInsightsInviteCandidates(env.DB);
    expect(contacts[0]).toMatchObject({
      insightsStatus: "active",
      eligible: false,
      eligibilityReason: "insights_active"
    });
  });

  it("does not offer another invitation after a sent delivery", async () => {
    const result = await provision();
    const cardId = result.manifest.cards[0]?.id;
    if (!cardId) throw new Error("Expected provisioned card");

    await env.DB.batch([
      env.DB.prepare("INSERT INTO tap_events (id, card_id, tapped_at) VALUES (?1, ?2, ?3)")
        .bind(crypto.randomUUID(), cardId, "2026-09-14T10:01:00.000Z"),
      env.DB.prepare("INSERT INTO tap_events (id, card_id, tapped_at) VALUES (?1, ?2, ?3)")
        .bind(crypto.randomUUID(), cardId, "2026-09-14T10:02:00.000Z"),
      env.DB.prepare(`
        INSERT INTO insights_invite_deliveries (
          id, email, location_id, provider, status, provider_message_id,
          last_attempt_at, sent_at, created_at, updated_at
        ) VALUES (?1, ?2, ?3, 'zoho', 'sent', ?4, ?5, ?5, ?5, ?5)
      `).bind(
        crypto.randomUUID(),
        "owner@example.invalid",
        result.manifest.locationId,
        "zoho-message-1",
        "2026-09-14T10:03:00.000Z"
      )
    ]);

    const contacts = await listInsightsInviteCandidates(env.DB);
    expect(contacts[0]).toMatchObject({
      deliveryStatus: "sent",
      inviteSentAt: "2026-09-14T10:03:00.000Z",
      eligible: false,
      eligibilityReason: "already_invited"
    });
  });

  it("rejects an invalid purchaser email instead of silently storing it", () => {
    expect(parseProvisioningIntent({
      externalOrderReference: "#INVITE-BAD",
      externalSetupReference: "invite-bad",
      customerEmail: "not-an-email",
      businessMode: "new",
      businessName: "Invite Test Barber",
      locationMode: "new",
      businessAddress: "100 Invite Street, Melbourne VIC",
      googlePlaceId: "ChIJInviteGroundwork",
      googleReviewUrl: REVIEW_URL,
      physicalCardCount: 1
    })).toBeNull();
  });
});
