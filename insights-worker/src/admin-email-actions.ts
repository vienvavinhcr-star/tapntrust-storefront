import { getShopifyAdminAccessToken } from "./shopify-admin-token";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const QUICK_GUIDE_TEMPLATE = "tapntrust-order-quick-setup";
const INSIGHTS_TEMPLATE = "tapntrust-insights-getting-started";
const QUICK_GUIDE_SENT_TAG = "quick-guide-sent";
const INSIGHTS_EMAIL_SENT_TAG = "insight-email-sent";
const DEFAULT_QUICK_SETUP_GUIDE_URL = "https://cdn.shopify.com/s/files/1/0748/1635/6483/files/TapnTrust_NFC_Review_Card_Quick_Start_Guide.pdf?v=1789513072";
const DEFAULT_USEFUL_GUIDE_URL = "https://cdn.shopify.com/s/files/1/0748/1635/6483/files/tapntrust-google-review-growth-kit.pdf?v=1789513046";
const MAX_ORDER_REFERENCE_LENGTH = 160;
const MAX_REQUEST_BODY_BYTES = 2048;

export interface AdminEmailActionsEnv {
  DB: D1Database;
  RESEND_API_KEY?: string;
  SHOPIFY_CLIENT_ID: string;
  SHOPIFY_CLIENT_SECRET: string;
  SHOPIFY_SHOP_DOMAIN: string;
  SHOPIFY_ADMIN_API_VERSION: string;
  SHOPIFY_INSIGHTS_VARIANT_ID: string;
  QUICK_SETUP_GUIDE_URL?: string;
  USEFUL_GUIDE_URL?: string;
}

type EmailKind = "quick-guide" | "insights";
type ShopifyOrderSummary = {
  id: string;
  name: string;
  email: string | null;
  tags: string[];
  lineItems: { nodes: Array<{ variant: { id: string } | null }> };
};

export interface AdminEmailActionStatus {
  orderReference: string;
  email: string | null;
  cardCount: number;
  hasCards: boolean;
  hasInsightsPurchase: boolean;
  quickGuideSent: boolean;
  insightsSent: boolean;
}

interface PartnerBatchRow {
  batch_id: string;
  customer_email: string;
  physical_card_count: number;
  sent_at: string | null;
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function cleanOrderReference(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const reference = String(value).trim();
  if (!reference || reference.length > MAX_ORDER_REFERENCE_LENGTH) return null;
  if (/[\u0000-\u001f\u007f]/.test(reference)) return null;
  return reference;
}

function isPartnerBatchReference(reference: string): boolean {
  return /^MANUAL-CTV-[A-Za-z0-9_-]+$/.test(reference);
}

function cleanShopDomain(value: string): string | null {
  const cleaned = String(value || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(cleaned) ? cleaned : null;
}

function normaliseEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function identifierMatches(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left || !right) return false;
  if (left === right) return true;
  const leftTail = left.split("/").at(-1);
  const rightTail = right.split("/").at(-1);
  return Boolean(leftTail && rightTail && leftTail === rightTail);
}

function orderNameSearchQuery(name: string): string {
  const escaped = name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `name:"${escaped}"`;
}

async function shopifyGraphql<T>(
  env: AdminEmailActionsEnv,
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const shopDomain = cleanShopDomain(env.SHOPIFY_SHOP_DOMAIN);
  if (!shopDomain || !env.SHOPIFY_CLIENT_ID || !env.SHOPIFY_CLIENT_SECRET || !/^\d{4}-(01|04|07|10)$/.test(env.SHOPIFY_ADMIN_API_VERSION)) {
    throw new Error("shopify_configuration_error");
  }
  const token = await getShopifyAdminAccessToken({
    shopDomain,
    clientId: env.SHOPIFY_CLIENT_ID,
    clientSecret: env.SHOPIFY_CLIENT_SECRET
  });
  const response = await fetch(`https://${shopDomain}/admin/api/${env.SHOPIFY_ADMIN_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables })
  });
  if (!response.ok) throw new Error(`shopify_${response.status}`);
  const payload = await response.json() as { data?: T; errors?: Array<{ message?: string }> };
  if (payload.errors?.length || !payload.data) throw new Error("shopify_graphql_error");
  return payload.data;
}

const ORDER_FIELDS = `
  id
  name
  email
  tags
  lineItems(first: 100) { nodes { variant { id } } }
`;

async function resolveShopifyOrder(env: AdminEmailActionsEnv, orderReference: string): Promise<ShopifyOrderSummary | null> {
  if (/^gid:\/\/shopify\/Order\/[A-Za-z0-9_-]+$/.test(orderReference)) {
    const data = await shopifyGraphql<{ node: (ShopifyOrderSummary & { __typename: string }) | null }>(env, `
      query TapnTrustAdminEmailOrderById($id: ID!) {
        node(id: $id) { __typename ... on Order { ${ORDER_FIELDS} } }
      }
    `, { id: orderReference });
    return data.node?.__typename === "Order" ? data.node : null;
  }
  const data = await shopifyGraphql<{ orders: { nodes: ShopifyOrderSummary[] } }>(env, `
    query TapnTrustAdminEmailOrderByName($query: String!) {
      orders(first: 5, query: $query) { nodes { ${ORDER_FIELDS} } }
    }
  `, { query: orderNameSearchQuery(orderReference) });
  return data.orders.nodes.find(candidate => candidate.name === orderReference) || null;
}

async function provisioningSummary(
  db: D1Database,
  orderReference: string,
  resolvedOrderName?: string
): Promise<{ cardCount: number; customerEmail: string | null }> {
  const references = Array.from(new Set([orderReference, resolvedOrderName].filter((value): value is string => Boolean(value))));
  let cardCount = 0;
  let customerEmail: string | null = null;
  for (const reference of references) {
    const row = await db.prepare(`
      SELECT COALESCE(SUM(physical_card_count), 0) AS card_count,
        (SELECT customer_email FROM provisioning_batches
         WHERE external_order_reference = ?1 AND customer_email IS NOT NULL
         ORDER BY created_at DESC LIMIT 1) AS customer_email
      FROM provisioning_batches WHERE external_order_reference = ?1
    `).bind(reference).first<{ card_count: number | string | null; customer_email: string | null }>();
    cardCount += Number(row?.card_count || 0);
    customerEmail ||= normaliseEmail(row?.customer_email);
  }
  return { cardCount, customerEmail };
}

function lowerTags(order: ShopifyOrderSummary): Set<string> {
  return new Set(order.tags.map(tag => tag.trim().toLowerCase()).filter(Boolean));
}

function hasInsightsVariant(order: ShopifyOrderSummary, configuredVariantId: string): boolean {
  return order.lineItems.nodes.some(line => identifierMatches(line.variant?.id, configuredVariantId));
}

// CTV batches are physical/manual setups: they are NOT Shopify orders. Their
// customer email is recorded at provisioning and their send receipt lives in D1.
async function partnerBatch(db: D1Database, reference: string): Promise<PartnerBatchRow | null> {
  return db.prepare(`
    SELECT pb.id AS batch_id, pp.customer_email, pb.physical_card_count, q.sent_at
    FROM provisioning_batches pb
    JOIN partner_provisionings pp ON pp.batch_id = pb.id
    LEFT JOIN partner_quick_guide_sends q ON q.batch_id = pb.id
    WHERE pb.external_order_reference = ?1
      AND pb.external_setup_reference = ?1
      AND pb.external_order_reference LIKE 'MANUAL-CTV-%'
    LIMIT 1
  `).bind(reference).first<PartnerBatchRow>();
}

function partnerBatchStatus(reference: string, batch: PartnerBatchRow): AdminEmailActionStatus {
  const cardCount = Number(batch.physical_card_count || 0);
  return {
    orderReference: reference,
    email: normaliseEmail(batch.customer_email),
    cardCount,
    hasCards: cardCount > 0,
    hasInsightsPurchase: false,
    quickGuideSent: Boolean(batch.sent_at),
    insightsSent: false
  };
}

async function buildStatus(
  env: AdminEmailActionsEnv,
  orderReference: string,
  order?: ShopifyOrderSummary | null
): Promise<AdminEmailActionStatus | null> {
  if (isPartnerBatchReference(orderReference)) {
    const batch = await partnerBatch(env.DB, orderReference);
    return batch ? partnerBatchStatus(orderReference, batch) : null;
  }
  const resolvedOrder = order === undefined ? await resolveShopifyOrder(env, orderReference) : order;
  if (!resolvedOrder) return null;
  const provisioning = await provisioningSummary(env.DB, orderReference, resolvedOrder.name);
  const tags = lowerTags(resolvedOrder);
  return {
    orderReference: resolvedOrder.name,
    email: normaliseEmail(resolvedOrder.email) || provisioning.customerEmail,
    cardCount: provisioning.cardCount,
    hasCards: provisioning.cardCount > 0,
    hasInsightsPurchase: hasInsightsVariant(resolvedOrder, env.SHOPIFY_INSIGHTS_VARIANT_ID),
    quickGuideSent: tags.has(QUICK_GUIDE_SENT_TAG),
    insightsSent: tags.has(INSIGHTS_EMAIL_SENT_TAG)
  };
}

async function addOrderTag(env: AdminEmailActionsEnv, orderId: string, tag: string): Promise<void> {
  const data = await shopifyGraphql<{
    tagsAdd: { userErrors: Array<{ field?: string[]; message: string }> };
  }>(env, `
    mutation TapnTrustAdminEmailTag($id: ID!, $tags: [String!]!) {
      tagsAdd(id: $id, tags: $tags) { userErrors { field message } }
    }
  `, { id: orderId, tags: [tag] });
  if (data.tagsAdd.userErrors.length) throw new Error("shopify_tag_graphql_error");
}

async function sendResendTemplate(
  env: AdminEmailActionsEnv,
  input: {
    to: string;
    template: string;
    idempotencyKey: string;
    attachments?: Array<{ filename: string; path: string }>;
  }
): Promise<void> {
  if (!env.RESEND_API_KEY) throw new Error("resend_configuration_error");
  const body: Record<string, unknown> = {
    from: "Tapntrust <contact@tapntrust.com>",
    to: [input.to],
    reply_to: "contact@tapntrust.com",
    template: { id: input.template }
  };
  if (input.attachments?.length) body.attachments = input.attachments;
  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": input.idempotencyKey
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error(JSON.stringify({ event: "admin_email_resend_failed", status: response.status, detail: detail.slice(0, 500) }));
    throw new Error(`resend_${response.status}`);
  }
}

function quickGuideAttachments(env: AdminEmailActionsEnv): Array<{ filename: string; path: string }> {
  return [
    { filename: "Tapntrust-Quick-Setup-Guide.pdf", path: env.QUICK_SETUP_GUIDE_URL || DEFAULT_QUICK_SETUP_GUIDE_URL },
    { filename: "Tapntrust-Useful-Guide.pdf", path: env.USEFUL_GUIDE_URL || DEFAULT_USEFUL_GUIDE_URL }
  ];
}

async function sendManualEmail(
  env: AdminEmailActionsEnv,
  orderReference: string,
  kind: EmailKind
): Promise<{ result: "sent" | "duplicate"; status: AdminEmailActionStatus }> {
  if (isPartnerBatchReference(orderReference)) {
    const batch = await partnerBatch(env.DB, orderReference);
    if (!batch) throw new Error("partner_batch_not_found");
    const status = partnerBatchStatus(orderReference, batch);
    if (!status.hasCards) throw new Error("no_provisioned_cards");
    if (!status.email) throw new Error("customer_email_missing");
    // A manual CTV setup never confers an Insights purchase or email entitlement.
    if (kind !== "quick-guide") throw new Error("insights_not_purchased");
    if (status.quickGuideSent) return { result: "duplicate", status };
    await sendResendTemplate(env, {
      to: status.email,
      template: QUICK_GUIDE_TEMPLATE,
      idempotencyKey: `admin-quick-guide/ctv/${batch.batch_id}`,
      attachments: quickGuideAttachments(env)
    });
    try {
      await env.DB.prepare(`INSERT OR IGNORE INTO partner_quick_guide_sends(batch_id,recipient_email,sent_at)
        VALUES(?1,?2,?3)`).bind(batch.batch_id, status.email, new Date().toISOString()).run();
    } catch {
      // The email may have been delivered. Preserve a precise warning instead
      // of claiming no email was sent and inviting an unsafe repeated send.
      throw new Error("partner_send_record_failed");
    }
    return { result: "sent", status: { ...status, quickGuideSent: true } };
  }

  const order = await resolveShopifyOrder(env, orderReference);
  if (!order) throw new Error("order_not_found");
  const status = await buildStatus(env, orderReference, order);
  if (!status) throw new Error("order_not_found");
  if (!status.hasCards) throw new Error("no_provisioned_cards");
  if (!status.email) throw new Error("customer_email_missing");
  if (kind === "quick-guide") {
    if (status.quickGuideSent) return { result: "duplicate", status };
    await sendResendTemplate(env, {
      to: status.email,
      template: QUICK_GUIDE_TEMPLATE,
      idempotencyKey: `admin-quick-guide/${order.id}`,
      attachments: quickGuideAttachments(env)
    });
    await addOrderTag(env, order.id, QUICK_GUIDE_SENT_TAG);
    return { result: "sent", status: { ...status, quickGuideSent: true } };
  }
  if (!status.hasInsightsPurchase) throw new Error("insights_not_purchased");
  if (status.insightsSent) return { result: "duplicate", status };
  await sendResendTemplate(env, {
    to: status.email,
    template: INSIGHTS_TEMPLATE,
    idempotencyKey: `admin-insights/${order.id}`
  });
  await addOrderTag(env, order.id, INSIGHTS_EMAIL_SENT_TAG);
  return { result: "sent", status: { ...status, insightsSent: true } };
}

function publicError(error: unknown): { status: number; message: string } {
  const code = error instanceof Error ? error.message : "unknown_error";
  if (code === "order_not_found") return { status: 404, message: "Shopify order not found." };
  if (code === "partner_batch_not_found") return { status: 404, message: "Partner card setup not found." };
  if (code === "no_provisioned_cards") return { status: 409, message: "This order has no provisioned Tapntrust cards." };
  if (code === "customer_email_missing") return { status: 409, message: "No customer email is available for this order." };
  if (code === "insights_not_purchased") return { status: 409, message: "Tapntrust Insights was not purchased on this Shopify order." };
  if (code === "partner_send_record_failed") return { status: 502, message: "The guide may have been sent, but its status could not be saved. Check Resend before retrying." };
  if (code === "resend_configuration_error" || code === "shopify_configuration_error") return { status: 503, message: "Email sending is not configured yet." };
  if (code.startsWith("resend_")) return { status: 502, message: "Resend could not send this email. No sent label was added." };
  if (code.startsWith("shopify_tag_")) return { status: 502, message: "The email was sent, but Shopify could not add the sent label. Check Resend before retrying." };
  if (code.startsWith("shopify_")) return { status: 502, message: "Shopify order data could not be loaded." };
  return { status: 500, message: "The email action could not be completed." };
}

export async function handleAdminEmailActionsRequest(
  request: Request,
  pathname: string,
  env: AdminEmailActionsEnv
): Promise<Response | null> {
  if (pathname === "/api/admin/email-actions/status") {
    if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
    const reference = cleanOrderReference(new URL(request.url).searchParams.get("orderReference"));
    if (!reference) return json({ error: "A valid order reference is required." }, 400);
    try {
      const status = await buildStatus(env, reference);
      return status ? json({ status }) : json({ error: isPartnerBatchReference(reference) ? "Partner card setup not found." : "Shopify order not found." }, 404);
    } catch (error) {
      const detail = publicError(error);
      return json({ error: detail.message }, detail.status);
    }
  }

  if (pathname !== "/api/admin/email-actions/send") return null;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > MAX_REQUEST_BODY_BYTES) return json({ error: "Request body too large." }, 413);
  let payload: unknown;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BODY_BYTES) return json({ error: "Request body too large." }, 413);
    payload = JSON.parse(raw);
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return json({ error: "Invalid request." }, 400);
  const record = payload as Record<string, unknown>;
  const orderReference = cleanOrderReference(record.orderReference);
  const kind = record.kind === "quick-guide" || record.kind === "insights" ? record.kind : null;
  if (!orderReference || !kind) return json({ error: "A valid order reference and email type are required." }, 400);
  try {
    const result = await sendManualEmail(env, orderReference, kind);
    console.log(JSON.stringify({ event: "admin_customer_email_action", orderReference, kind, result: result.result }));
    return json(result);
  } catch (error) {
    console.error(JSON.stringify({ event: "admin_customer_email_action_failed", orderReference, kind, reason: error instanceof Error ? error.message : "unknown_error" }));
    const detail = publicError(error);
    return json({ error: detail.message }, detail.status);
  }
}
