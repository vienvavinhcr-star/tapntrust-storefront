export type PlacementType = "counter" | "table" | "reception" | "register" | "other";

export interface CardDestination {
  id: string;
  publicToken: string;
  label: string;
  placementType: PlacementType;
  active: boolean;
  locationActive: boolean;
  googleReviewUrl: string;
}

export interface CardSummary {
  id: string;
  publicToken: string;
  label: string;
  placementType: PlacementType;
  active: boolean;
  businessName: string;
  businessAddress: string;
  monthTaps: number;
  lifetimeTaps: number;
}

export interface RecentTap {
  cardId: string;
  publicToken: string;
  label: string;
  tappedAt: string;
}

export interface InsightsSummary {
  monthTapCount: number;
  cards: CardSummary[];
  recentTaps: RecentTap[];
}

export interface CardUpdate {
  label: string;
  placementType: PlacementType;
}

export interface InsightsRepository {
  findCardByToken(publicToken: string): Promise<CardDestination | null>;
  recordTap(cardId: string, tappedAt: string): Promise<void>;
  getSummary(monthStart: string): Promise<InsightsSummary>;
  updateCard(publicToken: string, update: CardUpdate): Promise<CardDestination | null>;
}

interface CardDestinationRow {
  id: string;
  public_token: string;
  label: string;
  placement_type: PlacementType;
  card_active: number;
  location_active: number;
  google_review_url: string;
}

interface CardSummaryRow {
  id: string;
  public_token: string;
  label: string;
  placement_type: PlacementType;
  active: number;
  business_name: string;
  business_address: string;
  month_taps: number;
  lifetime_taps: number;
}

interface RecentTapRow {
  card_id: string;
  public_token: string;
  label: string;
  tapped_at: string;
}

interface CountRow {
  count: number;
}

function mapDestination(row: CardDestinationRow): CardDestination {
  return {
    id: row.id,
    publicToken: row.public_token,
    label: row.label,
    placementType: row.placement_type,
    active: row.card_active === 1,
    locationActive: row.location_active === 1,
    googleReviewUrl: row.google_review_url
  };
}

export function createD1Repository(db: D1Database): InsightsRepository {
  const findCardByToken = async (publicToken: string): Promise<CardDestination | null> => {
    const row = await db.prepare(`
      SELECT
        c.id,
        c.public_token,
        c.label,
        c.placement_type,
        c.active AS card_active,
        l.active AS location_active,
        l.google_review_url
      FROM cards c
      JOIN locations l ON l.id = c.location_id
      WHERE c.public_token = ?1 COLLATE NOCASE
      LIMIT 1
    `).bind(publicToken).first<CardDestinationRow>();

    return row ? mapDestination(row) : null;
  };

  return {
    findCardByToken,

    async recordTap(cardId, tappedAt) {
      await db.prepare(`
        INSERT INTO tap_events (id, card_id, tapped_at)
        VALUES (?1, ?2, ?3)
      `).bind(crypto.randomUUID(), cardId, tappedAt).run();
    },

    async getSummary(monthStart) {
      const [countRow, cardsResult, recentResult] = await Promise.all([
        db.prepare(`
          SELECT COUNT(*) AS count
          FROM tap_events
          WHERE tapped_at >= ?1
        `).bind(monthStart).first<CountRow>(),
        db.prepare(`
          SELECT
            c.id,
            c.public_token,
            c.label,
            c.placement_type,
            c.active,
            l.business_name,
            l.business_address,
            SUM(CASE WHEN t.tapped_at >= ?1 THEN 1 ELSE 0 END) AS month_taps,
            COUNT(t.id) AS lifetime_taps
          FROM cards c
          JOIN locations l ON l.id = c.location_id
          LEFT JOIN tap_events t ON t.card_id = c.id
          GROUP BY c.id
          ORDER BY c.created_at ASC
        `).bind(monthStart).all<CardSummaryRow>(),
        db.prepare(`
          SELECT
            t.card_id,
            c.public_token,
            c.label,
            t.tapped_at
          FROM tap_events t
          JOIN cards c ON c.id = t.card_id
          ORDER BY t.tapped_at DESC
          LIMIT 30
        `).all<RecentTapRow>()
      ]);

      return {
        monthTapCount: Number(countRow?.count || 0),
        cards: cardsResult.results.map((row) => ({
          id: row.id,
          publicToken: row.public_token,
          label: row.label,
          placementType: row.placement_type,
          active: row.active === 1,
          businessName: row.business_name,
          businessAddress: row.business_address,
          monthTaps: Number(row.month_taps || 0),
          lifetimeTaps: Number(row.lifetime_taps || 0)
        })),
        recentTaps: recentResult.results.map((row) => ({
          cardId: row.card_id,
          publicToken: row.public_token,
          label: row.label,
          tappedAt: row.tapped_at
        }))
      };
    },

    async updateCard(publicToken, update) {
      await db.prepare(`
        UPDATE cards
        SET label = ?1,
            placement_type = ?2,
            updated_at = ?3
        WHERE public_token = ?4 COLLATE NOCASE
      `).bind(update.label, update.placementType, new Date().toISOString(), publicToken).run();

      return findCardByToken(publicToken);
    }
  };
}
