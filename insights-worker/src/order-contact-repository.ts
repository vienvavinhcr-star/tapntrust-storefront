export async function storeOrderContact(
  db: D1Database,
  orderReference: string,
  setupReferences: string[],
  providerOrderReference: string,
  contact: string,
  observedAt: string,
  now: string
): Promise<void> {
  const refs = Array.from(new Set(setupReferences.map((value) => value.trim()).filter(Boolean)));
  if (!contact || refs.length === 0) return;
  const statements: D1PreparedStatement[] = [];
  for (const setupReference of refs) {
    statements.push(db.prepare(`
      INSERT INTO shopify_order_contacts (
        external_order_reference, external_setup_reference, provider_order_reference,
        customer_email, observed_at, created_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
      ON CONFLICT(external_order_reference, external_setup_reference) DO UPDATE SET
        provider_order_reference = excluded.provider_order_reference,
        customer_email = excluded.customer_email,
        observed_at = excluded.observed_at,
        updated_at = excluded.updated_at
    `).bind(orderReference, setupReference, providerOrderReference, contact, observedAt, now));
    statements.push(db.prepare(`
      UPDATE provisioning_batches
      SET customer_email = COALESCE(customer_email, ?3)
      WHERE external_order_reference = ?1 AND external_setup_reference = ?2
    `).bind(orderReference, setupReference, contact));
  }
  await db.batch(statements);
}

export async function reconcileOrderContact(
  db: D1Database,
  orderReference: string,
  setupReference: string
): Promise<string | null> {
  const row = await db.prepare(`
    SELECT customer_email FROM shopify_order_contacts
    WHERE external_order_reference = ?1 AND external_setup_reference = ?2
    LIMIT 1
  `).bind(orderReference, setupReference).first<{ customer_email: string }>();
  if (row?.customer_email) {
    await db.prepare(`
      UPDATE provisioning_batches
      SET customer_email = COALESCE(customer_email, ?3)
      WHERE external_order_reference = ?1 AND external_setup_reference = ?2
    `).bind(orderReference, setupReference, row.customer_email).run();
  }
  const batch = await db.prepare(`
    SELECT customer_email FROM provisioning_batches
    WHERE external_order_reference = ?1 AND external_setup_reference = ?2
    LIMIT 1
  `).bind(orderReference, setupReference).first<{ customer_email: string | null }>();
  return batch?.customer_email || null;
}
