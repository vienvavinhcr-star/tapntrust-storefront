import type { PlacementType } from "./repository";

export interface CustomerUser {
  id: string;
  email: string;
}

export interface CustomerSession extends CustomerUser {
  sessionId: string;
}

export interface CustomerCardSummary {
  id: string;
  publicToken: string;
  label: string;
  placementType: PlacementType;
  active: boolean;
  locationId: string;
  businessName: string;
  businessAddress: string;
  monthTaps: number;
  lifetimeTaps: number;
}

export interface CustomerRecentTap {
  cardId: string;
  publicToken: string;
  label: string;
  tappedAt: string;
}

export interface CustomerBusinessSummary {
  id: string;
  name: string;
  monthTapCount: number;
  cards: CustomerCardSummary[];
  recentTaps: CustomerRecentTap[];
}

export interface CustomerInsightsSummary {
  email: string;
  monthTapCount: number;
  businesses: CustomerBusinessSummary[];
}

export interface NewMagicLink {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
}

export interface NewCustomerSession {
  id: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
}

export interface MagicLinkRequestLimit {
  identifierHash: string;
  now: string;
  cooldownCutoff: string;
  windowResetCutoff: string;
  maxRequests: number;
}

export interface CustomerRepository {
  findActiveUserByEmail(email: string): Promise<CustomerUser | null>;
  reserveMagicLinkRequest(limit: MagicLinkRequestLimit): Promise<boolean>;
  createMagicLink(link: NewMagicLink): Promise<void>;
  deleteMagicLink(tokenHash: string): Promise<void>;
  consumeMagicLink(tokenHash: string, now: string, session: NewCustomerSession): Promise<boolean>;
  findActiveSession(tokenHash: string, now: string): Promise<CustomerSession | null>;
  revokeSession(tokenHash: string, revokedAt: string): Promise<void>;
  deleteExpiredAuthRecords(now: string, requestLimitCutoff: string): Promise<void>;
  getCustomerSummary(user: CustomerUser, monthStart: string): Promise<CustomerInsightsSummary>;
}

interface CustomerSessionRow {
  session_id: string;
  id: string;
  email: string;
}

interface BusinessRow {
  business_id: string;
  business_name: string;
}

interface CustomerCardRow {
  business_id: string;
  id: string;
  public_token: string;
  label: string;
  placement_type: PlacementType;
  active: number;
  location_id: string;
  business_name: string;
  business_address: string;
  month_taps: number;
  lifetime_taps: number;
}

interface CustomerRecentTapRow {
  business_id: string;
  card_id: string;
  public_token: string;
  label: string;
  tapped_at: string;
}

function mapCard(row: CustomerCardRow): CustomerCardSummary {
  return {
    id: row.id,
    publicToken: row.public_token,
    label: row.label,
    placementType: row.placement_type,
    active: row.active === 1,
    locationId: row.location_id,
    businessName: row.business_name,
    businessAddress: row.business_address,
    monthTaps: Number(row.month_taps || 0),
    lifetimeTaps: Number(row.lifetime_taps || 0)
  };
}

export function createCustomerRepository(db: D1Database): CustomerRepository {
  return {
    async findActiveUserByEmail(email) {
      return db.prepare(`
        SELECT id, email
        FROM customer_users u
        WHERE email = ?1 COLLATE NOCASE
          AND active = 1
          AND EXISTS (
            SELECT 1 FROM customer_business_access a WHERE a.user_id = u.id
          )
        LIMIT 1
      `).bind(email).first<CustomerUser>();
    },

    async reserveMagicLinkRequest(limit) {
      const [, reservation] = await db.batch([
        db.prepare(`
          INSERT OR IGNORE INTO auth_request_limits (
            identifier_hash, window_started_at, request_count, last_allowed_at
          ) VALUES (?1, ?2, 0, '1970-01-01T00:00:00.000Z')
        `).bind(limit.identifierHash, limit.now),
        db.prepare(`
          UPDATE auth_request_limits
          SET
            window_started_at = CASE
              WHEN window_started_at <= ?2 THEN ?3
              ELSE window_started_at
            END,
            request_count = CASE
              WHEN window_started_at <= ?2 THEN 1
              ELSE request_count + 1
            END,
            last_allowed_at = ?3
          WHERE identifier_hash = ?1
            AND (
              window_started_at <= ?2
              OR (request_count < ?4 AND last_allowed_at <= ?5)
            )
        `).bind(
          limit.identifierHash,
          limit.windowResetCutoff,
          limit.now,
          limit.maxRequests,
          limit.cooldownCutoff
        )
      ]);
      return Number(reservation?.meta.changes || 0) === 1;
    },

    async createMagicLink(link) {
      await db.batch([
        db.prepare(`
          UPDATE auth_magic_links
          SET used_at = ?1
          WHERE user_id = ?2 AND used_at IS NULL
        `).bind(link.createdAt, link.userId),
        db.prepare(`
          INSERT INTO auth_magic_links (id, user_id, token_hash, expires_at, created_at)
          VALUES (?1, ?2, ?3, ?4, ?5)
        `).bind(link.id, link.userId, link.tokenHash, link.expiresAt, link.createdAt)
      ]);
    },

    async deleteMagicLink(tokenHash) {
      await db.prepare("DELETE FROM auth_magic_links WHERE token_hash = ?1").bind(tokenHash).run();
    },

    async consumeMagicLink(tokenHash, now, session) {
      const [sessionResult] = await db.batch([
        db.prepare(`
          INSERT INTO customer_sessions (id, user_id, token_hash, expires_at, created_at)
          SELECT ?1, ml.user_id, ?2, ?3, ?4
          FROM auth_magic_links ml
          JOIN customer_users u ON u.id = ml.user_id
          WHERE ml.token_hash = ?5
            AND ml.used_at IS NULL
            AND ml.expires_at > ?6
            AND u.active = 1
        `).bind(session.id, session.tokenHash, session.expiresAt, session.createdAt, tokenHash, now),
        db.prepare(`
          UPDATE auth_magic_links
          SET used_at = ?1
          WHERE token_hash = ?2 AND used_at IS NULL AND expires_at > ?1
        `).bind(now, tokenHash)
      ]);

      return Number(sessionResult?.meta.changes || 0) === 1;
    },

    async findActiveSession(tokenHash, now) {
      const row = await db.prepare(`
        SELECT s.id AS session_id, u.id, u.email
        FROM customer_sessions s
        JOIN customer_users u ON u.id = s.user_id
        WHERE s.token_hash = ?1
          AND s.revoked_at IS NULL
          AND s.expires_at > ?2
          AND u.active = 1
          AND EXISTS (
            SELECT 1 FROM customer_business_access a WHERE a.user_id = u.id
          )
        LIMIT 1
      `).bind(tokenHash, now).first<CustomerSessionRow>();

      return row ? { sessionId: row.session_id, id: row.id, email: row.email } : null;
    },

    async revokeSession(tokenHash, revokedAt) {
      await db.prepare(`
        UPDATE customer_sessions
        SET revoked_at = ?1
        WHERE token_hash = ?2 AND revoked_at IS NULL
      `).bind(revokedAt, tokenHash).run();
    },

    async deleteExpiredAuthRecords(now, requestLimitCutoff) {
      await db.batch([
        db.prepare("DELETE FROM auth_magic_links WHERE expires_at <= ?1").bind(now),
        db.prepare("DELETE FROM customer_sessions WHERE expires_at <= ?1 OR revoked_at IS NOT NULL").bind(now),
        db.prepare("DELETE FROM auth_request_limits WHERE window_started_at <= ?1").bind(requestLimitCutoff)
      ]);
    },

    async getCustomerSummary(user, monthStart) {
      const [businessResult, cardResult, recentResult] = await Promise.all([
        db.prepare(`
          SELECT b.id AS business_id, b.name AS business_name
          FROM customer_business_access a
          JOIN businesses b ON b.id = a.business_id
          WHERE a.user_id = ?1
          ORDER BY b.created_at ASC, b.id ASC
        `).bind(user.id).all<BusinessRow>(),
        db.prepare(`
          SELECT
            b.id AS business_id,
            c.id,
            c.public_token,
            c.label,
            c.placement_type,
            c.active,
            l.id AS location_id,
            l.business_name,
            l.business_address,
            SUM(CASE WHEN t.tapped_at >= ?2 THEN 1 ELSE 0 END) AS month_taps,
            COUNT(t.id) AS lifetime_taps
          FROM customer_business_access a
          JOIN businesses b ON b.id = a.business_id
          JOIN locations l ON l.business_id = b.id
          JOIN cards c ON c.location_id = l.id
          LEFT JOIN tap_events t ON t.card_id = c.id
          WHERE a.user_id = ?1
          GROUP BY b.id, c.id
          ORDER BY b.created_at ASC, c.created_at ASC
        `).bind(user.id, monthStart).all<CustomerCardRow>(),
        db.prepare(`
          SELECT
            b.id AS business_id,
            t.card_id,
            c.public_token,
            c.label,
            t.tapped_at
          FROM customer_business_access a
          JOIN businesses b ON b.id = a.business_id
          JOIN locations l ON l.business_id = b.id
          JOIN cards c ON c.location_id = l.id
          JOIN tap_events t ON t.card_id = c.id
          WHERE a.user_id = ?1
          ORDER BY t.tapped_at DESC
          LIMIT 30
        `).bind(user.id).all<CustomerRecentTapRow>()
      ]);

      const cardsByBusiness = new Map<string, CustomerCardSummary[]>();
      for (const row of cardResult.results) {
        const cards = cardsByBusiness.get(row.business_id) || [];
        cards.push(mapCard(row));
        cardsByBusiness.set(row.business_id, cards);
      }

      const tapsByBusiness = new Map<string, CustomerRecentTap[]>();
      for (const row of recentResult.results) {
        const taps = tapsByBusiness.get(row.business_id) || [];
        taps.push({
          cardId: row.card_id,
          publicToken: row.public_token,
          label: row.label,
          tappedAt: row.tapped_at
        });
        tapsByBusiness.set(row.business_id, taps);
      }

      const businesses = businessResult.results.map((business) => {
        const cards = cardsByBusiness.get(business.business_id) || [];
        return {
          id: business.business_id,
          name: business.business_name,
          monthTapCount: cards.reduce((total, card) => total + card.monthTaps, 0),
          cards,
          recentTaps: tapsByBusiness.get(business.business_id) || []
        };
      });

      return {
        email: user.email,
        monthTapCount: businesses.reduce((total, business) => total + business.monthTapCount, 0),
        businesses
      };
    }
  };
}
