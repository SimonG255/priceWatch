import { sql } from "drizzle-orm";
import { getDb } from "../db";

const REQUIRED_TABLES = [
  "monitored_products", "monitored_websites", "user_plans", "customer_alert_events",
  "custom_search_profiles", "scraper_sitemap_hints", "scraper_domain_state", "scraper_domain_cooldowns",
  "price_snapshots", "scrape_runs", "scrape_attempts", "scraper_result_cache", "scraper_known_bad_patterns",
  "scraper_domain_policies", "scraper_schedules", "scraper_alert_rules", "scraper_alert_events",
];

const REQUIRED_COLUMNS: Record<string, string[]> = {
  monitored_products: ["alert_target_price_cents", "alert_drop_percent_bps", "monitoring_enabled", "last_scan_id"],
  user_plans: ["subscription_status", "trial_ends_at", "subscription_expires_at"],
  custom_search_profiles: ["cookie_consent_selector"],
  scrape_runs: ["status", "reason_code", "started_at", "completed_at"],
  price_snapshots: ["product_id", "price_cents", "currency", "in_stock", "captured_at"],
};

const MIGRATIONS = ["0007_cookie_consent_selector.sql", "0008_monitoring_alerts.sql", "0009_super_admin_subscriptions.sql"];

export type SystemHealth = Awaited<ReturnType<typeof getSystemHealth>>;

export async function getSystemHealth() {
  const checkedAt = new Date().toISOString();
  const ai = { status: process.env.OPENAI_API_KEY ? "ready" : "not_configured", configured: Boolean(process.env.OPENAI_API_KEY) } as const;
  const rendererConfigured = Boolean(process.env.SCRAPER_RENDERER_URL && process.env.SCRAPER_RENDERER_TOKEN);
  const renderer = { status: rendererConfigured ? "configured" : "not_configured", configured: rendererConfigured } as const;

  try {
    const db = getDb();
    const tableRows = await db.execute(sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
    `) as unknown as Array<{ table_name: string }>;
    const tables = new Set(tableRows.map((row) => row.table_name));
    const missingTables = REQUIRED_TABLES.filter((table) => !tables.has(table));

    const columnRows = await db.execute(sql`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
    `) as unknown as Array<{ table_name: string; column_name: string }>;
    const columns = new Map<string, Set<string>>();
    for (const row of columnRows) {
      const values = columns.get(row.table_name) ?? new Set<string>();
      values.add(row.column_name);
      columns.set(row.table_name, values);
    }
    const missingColumns = Object.entries(REQUIRED_COLUMNS).flatMap(([table, required]) =>
      required.filter((column) => !columns.get(table)?.has(column)).map((column) => `${table}.${column}`),
    );

    let appliedMigrations: string[] = [];
    if (tables.has("pricewatch_schema_migrations")) {
      const migrationRows = await db.execute(sql`
        SELECT id FROM public.pricewatch_schema_migrations ORDER BY id
      `) as unknown as Array<{ id: string }>;
      appliedMigrations = migrationRows.map((row) => row.id);
    }
    const pendingMigrations = MIGRATIONS.filter((migration) => !appliedMigrations.includes(migration));

    let lastFailedScan: Record<string, unknown> | null = null;
    if (tables.has("scrape_runs")) {
      const [failed] = await db.execute(sql`
        SELECT
          id,
          product_id AS "productId",
          hostname,
          status,
          reason_code AS "reasonCode",
          failure_class AS "failureClass",
          challenge_type AS "challengeType",
          message,
          duration_ms AS "durationMs",
          started_at AS "startedAt",
          completed_at AS "completedAt"
        FROM public.scrape_runs
        WHERE status IN ('blocked', 'unavailable', 'needs_review', 'error')
        ORDER BY started_at DESC
        LIMIT 1
      `) as unknown as Array<Record<string, unknown>>;
      lastFailedScan = failed ?? null;
    }

    const databaseStatus = missingTables.length || missingColumns.length ? "degraded" : "healthy";
    return {
      checkedAt,
      database: { status: databaseStatus, connected: true, missingTables, missingColumns },
      migrations: {
        status: pendingMigrations.length || missingColumns.length ? "pending" : "up_to_date",
        pending: pendingMigrations,
        applied: appliedMigrations,
      },
      ai,
      renderer,
      lastFailedScan,
    };
  } catch (error) {
    return {
      checkedAt,
      database: {
        status: "unavailable",
        connected: false,
        missingTables: REQUIRED_TABLES,
        missingColumns: Object.entries(REQUIRED_COLUMNS).flatMap(([table, columns]) => columns.map((column) => `${table}.${column}`)),
        error: error instanceof Error ? error.message : "Database health check failed.",
      },
      migrations: { status: "unknown", pending: MIGRATIONS, applied: [] },
      ai,
      renderer,
      lastFailedScan: null,
    };
  }
}
