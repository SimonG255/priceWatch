import { env } from "cloudflare:workers";
import { desc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { scraperDomainState, scraperSitemapHints } from "../db/schema";
import { assertPublicHostname } from "./product-input.ts";
import type { ProductEvidence, ScraperStatus, SitemapProductCache } from "./scraper-types.ts";

const DOMAIN_REQUEST_INTERVAL_MS = 1_000;
const BLOCKED_BACKOFF_MS = 120_000;
const UNAVAILABLE_BACKOFF_MS = 30_000;
const SITEMAP_HINT_TTL_MS = 14 * 24 * 60 * 60 * 1_000;

export async function reserveScraperDomain(hostname: string) {
  if (!env.DB) throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  const normalized = normalizeHostname(hostname);
  const now = new Date();
  const nextAllowedAt = new Date(now.getTime() + DOMAIN_REQUEST_INTERVAL_MS).toISOString();
  const nowIso = now.toISOString();
  const result = await env.DB.prepare(`
    INSERT INTO scraper_domain_state (hostname, next_allowed_at, consecutive_failures, total_checks, blocked_checks, unavailable_checks, needs_review_checks, updated_at)
    VALUES (?, ?, 0, 0, 0, 0, 0, ?)
    ON CONFLICT(hostname) DO UPDATE SET
      next_allowed_at = excluded.next_allowed_at,
      updated_at = excluded.updated_at
    WHERE (scraper_domain_state.next_allowed_at IS NULL OR scraper_domain_state.next_allowed_at <= ?)
      AND (scraper_domain_state.backoff_until IS NULL OR scraper_domain_state.backoff_until <= ?)
  `).bind(normalized, nextAllowedAt, nowIso, nowIso, nowIso).run();
  if (result.meta.changes) return { allowed: true as const };

  const state = await env.DB.prepare("SELECT next_allowed_at, backoff_until FROM scraper_domain_state WHERE hostname = ?").bind(normalized).first<{ next_allowed_at?: string; backoff_until?: string }>();
  return { allowed: false as const, retryAt: state?.backoff_until || state?.next_allowed_at };
}

/**
 * Checks a durable cooldown without reserving a request slot. The scan route
 * uses this for a fast response, while each outbound page request reserves its
 * own slot through reserveScraperDomain.
 */
export async function getScraperDomainAvailability(hostname: string) {
  if (!env.DB) throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  const normalized = normalizeHostname(hostname);
  const state = await env.DB.prepare("SELECT next_allowed_at, backoff_until FROM scraper_domain_state WHERE hostname = ?").bind(normalized).first<{ next_allowed_at?: string; backoff_until?: string }>();
  const now = Date.now();
  const retryAt = [state?.backoff_until, state?.next_allowed_at]
    .filter((value): value is string => Boolean(value) && Date.parse(value) > now)
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0];
  return retryAt ? { allowed: false as const, retryAt } : { allowed: true as const };
}

export async function recordScraperDomainOutcome(input: {
  hostname: string;
  status: ScraperStatus;
  evidence?: ProductEvidence;
}) {
  if (!env.DB) throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  const hostname = normalizeHostname(input.hostname);
  const now = new Date();
  const checkedAt = now.toISOString();
  const backoffUntil = input.status === "blocked"
    ? new Date(now.getTime() + BLOCKED_BACKOFF_MS).toISOString()
    : input.status === "unavailable"
      ? new Date(now.getTime() + UNAVAILABLE_BACKOFF_MS).toISOString()
      : null;
  const isFailure = input.status === "blocked" || input.status === "unavailable" || input.status === "needs_review";
  await env.DB.prepare(`
    INSERT INTO scraper_domain_state (
      hostname, backoff_until, consecutive_failures, total_checks, blocked_checks, unavailable_checks, needs_review_checks,
      last_outcome, last_failure_kind, last_profile_id, last_checked_at, last_success_at, updated_at
    ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(hostname) DO UPDATE SET
      backoff_until = excluded.backoff_until,
      consecutive_failures = CASE WHEN excluded.last_outcome IN ('blocked', 'unavailable', 'needs_review')
        THEN scraper_domain_state.consecutive_failures + 1 ELSE 0 END,
      total_checks = scraper_domain_state.total_checks + 1,
      blocked_checks = scraper_domain_state.blocked_checks + CASE WHEN excluded.last_outcome = 'blocked' THEN 1 ELSE 0 END,
      unavailable_checks = scraper_domain_state.unavailable_checks + CASE WHEN excluded.last_outcome = 'unavailable' THEN 1 ELSE 0 END,
      needs_review_checks = scraper_domain_state.needs_review_checks + CASE WHEN excluded.last_outcome = 'needs_review' THEN 1 ELSE 0 END,
      last_outcome = excluded.last_outcome,
      last_failure_kind = CASE WHEN excluded.last_outcome IN ('blocked', 'unavailable', 'needs_review') THEN excluded.last_failure_kind ELSE NULL END,
      last_profile_id = excluded.last_profile_id,
      last_checked_at = excluded.last_checked_at,
      last_success_at = CASE WHEN excluded.last_outcome = 'found' THEN excluded.last_checked_at ELSE scraper_domain_state.last_success_at END,
      updated_at = excluded.updated_at
  `).bind(
    hostname, backoffUntil, isFailure ? 1 : 0, input.status === "blocked" ? 1 : 0,
    input.status === "unavailable" ? 1 : 0, input.status === "needs_review" ? 1 : 0,
    input.status, isFailure ? input.status : null, input.evidence?.profileId ?? null,
    checkedAt, input.status === "found" ? checkedAt : null, checkedAt,
  ).run();
}

export function createSitemapProductCache(): SitemapProductCache {
  return {
    async get({ hostname, ean }) {
      const cacheKey = sitemapCacheKey(hostname, ean);
      const [entry] = await getDb().select().from(scraperSitemapHints).where(eq(scraperSitemapHints.cacheKey, cacheKey)).limit(1);
      if (!entry || Date.parse(entry.expiresAt) <= Date.now()) return undefined;
      return {
        candidateUrl: entry.candidateUrl,
        sitemapUrl: entry.sitemapUrl ?? undefined,
        sitemapLastmod: entry.sitemapLastmod ?? undefined,
        cachedAt: entry.updatedAt,
      };
    },
    async put({ hostname, ean, entry }) {
      const now = new Date();
      const cacheKey = sitemapCacheKey(hostname, ean);
      await getDb().insert(scraperSitemapHints).values({
        cacheKey,
        hostname: normalizeHostname(hostname),
        ean: ean.replace(/\D/g, ""),
        candidateUrl: entry.candidateUrl,
        sitemapUrl: entry.sitemapUrl ?? null,
        sitemapLastmod: entry.sitemapLastmod ?? null,
        discoveredAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + SITEMAP_HINT_TTL_MS).toISOString(),
        updatedAt: now.toISOString(),
      }).onConflictDoUpdate({
        target: scraperSitemapHints.cacheKey,
        set: {
          candidateUrl: entry.candidateUrl,
          sitemapUrl: entry.sitemapUrl ?? null,
          sitemapLastmod: entry.sitemapLastmod ?? null,
          expiresAt: new Date(now.getTime() + SITEMAP_HINT_TTL_MS).toISOString(),
          updatedAt: now.toISOString(),
        },
      });
    },
    async invalidate({ hostname, ean }) {
      await getDb().delete(scraperSitemapHints).where(eq(scraperSitemapHints.cacheKey, sitemapCacheKey(hostname, ean)));
    },
  };
}

export async function listScraperDomainHealth() {
  return getDb().select().from(scraperDomainState).orderBy(desc(scraperDomainState.updatedAt)).limit(200);
}

export function parseStoredProductEvidence(value: string | null | undefined): ProductEvidence | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as Partial<ProductEvidence>;
    if (!parsed || typeof parsed !== "object" || typeof parsed.exactEan !== "boolean" || typeof parsed.structuredExactEan !== "boolean" || typeof parsed.structuredProduct !== "boolean" || typeof parsed.nameScore !== "number" || typeof parsed.canonicalUrl !== "string" || typeof parsed.checkedAt !== "string") return undefined;
    return {
      exactEan: parsed.exactEan,
      structuredExactEan: parsed.structuredExactEan,
      structuredProduct: parsed.structuredProduct,
      nameScore: parsed.nameScore,
      ...(typeof parsed.priceSource === "string" ? { priceSource: parsed.priceSource as ProductEvidence["priceSource"] } : {}),
      canonicalUrl: parsed.canonicalUrl,
      ...(typeof parsed.profileId === "string" ? { profileId: parsed.profileId } : {}),
      checkedAt: parsed.checkedAt,
    };
  } catch {
    return undefined;
  }
}

function sitemapCacheKey(hostname: string, ean: string) {
  return `${normalizeHostname(hostname)}\u0000${ean.replace(/\D/g, "")}`;
}

function normalizeHostname(value: string) {
  const hostname = value.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  assertPublicHostname(hostname);
  return hostname;
}
