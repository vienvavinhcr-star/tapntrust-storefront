export interface ActivationCheckoutTarget {
  checkoutId: string;
  businessId: string;
  locationId: string;
}

interface ActivationCheckoutRow {
  id: string;
  business_id: string;
  location_id: string;
}

export async function claimActivationCheckoutTarget(
  db: D1Database,
  setupReference: string,
  billingEmail: string,
  providerOrderReference: string,
  now: string
): Promise<ActivationCheckoutTarget | null> {
  await db.prepare(`
    UPDATE insights_activation_checkouts
    SET provider_order_reference = COALESCE(provider_order_reference, ?1),
        updated_at = ?2
    WHERE setup_reference = ?3
      AND email = ?4 COLLATE NOCASE
      AND status = 'ready'
      AND expires_at > ?2
      AND (provider_order_reference IS NULL OR provider_order_reference = ?1)
  `).bind(providerOrderReference, now, setupReference, billingEmail).run();

  const row = await db.prepare(`
    SELECT c.id, c.business_id, c.location_id
    FROM insights_activation_checkouts c
    JOIN locations l ON l.id = c.location_id AND l.business_id = c.business_id
    WHERE c.setup_reference = ?1
      AND c.email = ?2 COLLATE NOCASE
      AND c.status = 'ready'
      AND c.expires_at > ?3
      AND c.provider_order_reference = ?4
    LIMIT 1
  `).bind(setupReference, billingEmail, now, providerOrderReference).first<ActivationCheckoutRow>();

  return row ? {
    checkoutId: row.id,
    businessId: row.business_id,
    locationId: row.location_id
  } : null;
}

export async function completeActivationCheckout(
  db: D1Database,
  checkoutId: string,
  providerOrderReference: string,
  paidAt: string,
  now: string
): Promise<void> {
  await db.prepare(`
    UPDATE insights_activation_checkouts
    SET status = 'paid',
        paid_at = COALESCE(paid_at, ?1),
        updated_at = ?2
    WHERE id = ?3
      AND provider_order_reference = ?4
      AND status IN ('ready', 'paid')
  `).bind(paidAt, now, checkoutId, providerOrderReference).run();
}
