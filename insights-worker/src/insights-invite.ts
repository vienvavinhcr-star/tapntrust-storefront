export type InsightsInviteEligibilityReason =
  | "eligible"
  | "needs_more_taps"
  | "insights_active"
  | "already_invited"
  | "suppressed";

export interface InsightsInviteCandidate {
  email: string;
  businessId: string;
  businessName: string;
  locationId: string;
  locationName: string;
  businessAddress: string;
  purchasedCardCount: number;
  activeCardCount: number;
  lifetimeReviewOpportunities: number;
  firstPurchaseAt: string;
  lastPurchaseAt: string;
  insightsStatus: "active" | "inactive" | "not_configured";
  deliveryStatus: "sent" | "failed" | "suppressed" | null;
  inviteSentAt: string | null;
  eligible: boolean;
  eligibilityReason: InsightsInviteEligibilityReason;
}

interface InviteCandidateRow {
  email: string;
  business_id: string;
  business_name: string;
  location_id: string;
  location_name: string;
  business_address: string;
  purchased_card_count: number;
  active_card_count: number;
  lifetime_opportunities: number;
  first_purchase_at: string;
  last_purchase_at: string;
  insights_status: "active" | "inactive" | "not_configured";
  delivery_status: "sent" | "failed" | "suppressed" | null;
  sent_at: string | null;
}

function eligibilityFor(row: InviteCandidateRow): Pick<InsightsInviteCandidate, "eligible" | "eligibilityReason"> {
  if (row.insights_status === "active") {
    return { eligible: false, eligibilityReason: "insights_active" };
  }
  if (row.delivery_status === "sent") {
    return { eligible: false, eligibilityReason: "already_invited" };
  }
  if (row.delivery_status === "suppressed") {
    return { eligible: false, eligibilityReason: "suppressed" };
  }
  if (Number(row.lifetime_opportunities || 0) < 2) {
    return { eligible: false, eligibilityReason: "needs_more_taps" };
  }
  return { eligible: true, eligibilityReason: "eligible" };
}

export async function listInsightsInviteCandidates(db: D1Database): Promise<InsightsInviteCandidate[]> {
  const result = await db.prepare(`
    WITH contacts AS (
      SELECT
        MIN(p.customer_email) AS email,
        p.business_id,
        p.location_id,
        SUM(p.physical_card_count) AS purchased_card_count,
        MIN(p.created_at) AS first_purchase_at,
        MAX(p.created_at) AS last_purchase_at
      FROM provisioning_batches p
      WHERE p.customer_email IS NOT NULL
        AND TRIM(p.customer_email) <> ''
      GROUP BY p.customer_email COLLATE NOCASE, p.business_id, p.location_id
    )
    SELECT
      contacts.email,
      contacts.business_id,
      b.name AS business_name,
      contacts.location_id,
      l.business_name AS location_name,
      l.business_address,
      contacts.purchased_card_count,
      (
        SELECT COUNT(*)
        FROM cards c
        WHERE c.location_id = contacts.location_id
          AND c.active = 1
      ) AS active_card_count,
      (
        SELECT COUNT(*)
        FROM tap_events t
        JOIN cards c ON c.id = t.card_id
        WHERE c.location_id = contacts.location_id
      ) AS lifetime_opportunities,
      contacts.first_purchase_at,
      contacts.last_purchase_at,
      CASE
        WHEN e.location_id IS NULL THEN 'not_configured'
        ELSE e.status
      END AS insights_status,
      d.status AS delivery_status,
      d.sent_at
    FROM contacts
    JOIN businesses b ON b.id = contacts.business_id
    JOIN locations l ON l.id = contacts.location_id AND l.business_id = contacts.business_id
    LEFT JOIN insights_entitlements e ON e.location_id = contacts.location_id
    LEFT JOIN insights_invite_deliveries d
      ON d.location_id = contacts.location_id
      AND d.email = contacts.email COLLATE NOCASE
    ORDER BY contacts.last_purchase_at DESC, b.name COLLATE NOCASE ASC
  `).all<InviteCandidateRow>();

  return result.results.map((row) => ({
    email: row.email,
    businessId: row.business_id,
    businessName: row.business_name,
    locationId: row.location_id,
    locationName: row.location_name,
    businessAddress: row.business_address,
    purchasedCardCount: Number(row.purchased_card_count || 0),
    activeCardCount: Number(row.active_card_count || 0),
    lifetimeReviewOpportunities: Number(row.lifetime_opportunities || 0),
    firstPurchaseAt: row.first_purchase_at,
    lastPurchaseAt: row.last_purchase_at,
    insightsStatus: row.insights_status,
    deliveryStatus: row.delivery_status,
    inviteSentAt: row.sent_at,
    ...eligibilityFor(row)
  }));
}

export async function handleAdminInsightsInviteRequest(
  request: Request,
  pathname: string,
  db: D1Database
): Promise<Response | null> {
  if (pathname !== "/api/admin/insights-invites") return null;
  if (request.method !== "GET") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET" } });
  }

  const contacts = await listInsightsInviteCandidates(db);
  return Response.json({
    eligibleCount: contacts.filter((contact) => contact.eligible).length,
    contacts
  }, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
