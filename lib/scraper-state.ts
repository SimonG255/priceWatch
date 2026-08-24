import { env } from "cloudflare:workers";
import { desc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { scraperDomainState, scraperSitemapHints } from "../db/schema";
import { assertPublicHostname } from "./product-input.ts";
import { exponentialBackoffMs, failureClassFor } from "./scraper-diagnostics.ts";
import type { ChallengeType, ProductEvidence, ScraperFailureClass, ScraperReasonCode, ScraperStatus, SitemapProductCache } from "./scraper-types.ts";

const DOMAIN_REQUEST_INTERVAL_MS = 1_000;
const SITEMAP_HINT_TTL_MS = 14 * 24 * 60 * 60 * 1_000;

export async function reserveScraperDomain(hostname: string, options: { intervalMs?: number } = {}) {
  if (!env.DB) throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  const normalized = normalizeHostname(hostname);
  const availability = await getScraperDomainAvailability(normalized);
  if (!availability.allowed) return availability;
  const now = new Date();
  const intervalMs = Math.max(500, Math.min(60_000, options.intervalMs ?? DOMAIN_REQUEST_INTERVAL_MS));
  const nextAllowedAt = new Date(now.getTime() + intervalMs).toISOString();
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
  const [state, cooldown] = await Promise.all([
    env.DB.prepare("SELECT next_allowed_at, backoff_until, last_reason_code, failure_class, retry_budget_remaining FROM scraper_domain_state WHERE hostname = ?").bind(normalized).first<{ next_allowed_at?: string; backoff_until?: string; last_reason_code?: ScraperReasonCode; failure_class?: ScraperFailureClass; retry_budget_remaining?: number }>(),
    env.DB.prepare("SELECT cooldown_until, reason_code, failure_class, retry_budget_remaining FROM scraper_domain_cooldowns WHERE hostname = ? AND cooldown_until > ? ORDER BY cooldown_until DESC LIMIT 1").bind(normalized, new Date().toISOString()).first<{ cooldown_until?: string; reason_code?: ScraperReasonCode; failure_class?: ScraperFailureClass; retry_budget_remaining?: number }>(),
  ]);
  const now = Date.now();
  const retryAt = [state?.backoff_until, state?.next_allowed_at, cooldown?.cooldown_until]
    .filter((value): value is string => typeof value === "string" && Date.parse(value) > now)
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0];
  return retryAt ? {
    allowed: false as const,
    retryAt,
    reasonCode: cooldown?.reason_code ?? state?.last_reason_code,
    failureClass: cooldown?.failure_class ?? state?.failure_class,
    retryBudgetRemaining: cooldown?.retry_budget_remaining ?? state?.retry_budget_remaining,
  } : { allowed: true as const };
}

export async function recordScraperDomainOutcome(input: {
  hostname: string;
  status: ScraperStatus;
  evidence?: ProductEvidence;
  reasonCode?: ScraperReasonCode;
  failureClass?: ScraperFailureClass;
  challengeType?: ChallengeType;
  durationMs?: number;
  retryAfterMs?: number;
}) {
  if (!env.DB) throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  const hostname = normalizeHostname(input.hostname);
  const now = new Date();
  const checkedAt = now.toISOString();
  const reasonCode = input.reasonCode ?? reasonCodeForStatus(input.status);
  const failureClass = input.failureClass ?? failureClassFor(reasonCode);
  const previousReason = await env.DB.prepare("SELECT consecutive_failures FROM scraper_domain_cooldowns WHERE hostname = ? AND reason_code = ?").bind(hostname, reasonCode).first<{ consecutive_failures?: number }>();
  const hostCooldown = failureClass === "temporary" && hostCooldownReason(reasonCode);
  const nextFailureCount = hostCooldown ? (previousReason?.consecutive_failures ?? 0) + 1 : 0;
  const backoffUntil = hostCooldown
    ? new Date(now.getTime() + exponentialBackoffMs({ consecutiveFailures: nextFailureCount, reasonCode, retryAfterMs: input.retryAfterMs })).toISOString()
    : null;
  const retryBudgetRemaining = Math.max(0, 3 - nextFailureCount);
  const isFailure = input.status === "blocked" || input.status === "unavailable" || input.status === "needs_review";
  await env.DB.prepare(`
    INSERT INTO scraper_domain_state (
      hostname, backoff_until, consecutive_failures, total_checks, blocked_checks, unavailable_checks, needs_review_checks,
      last_outcome, last_failure_kind, last_profile_id, last_checked_at, last_success_at, updated_at,
      backoff_exponent, retry_budget_remaining, cooldown_reason, failure_class, last_reason_code, last_challenge_type,
      successful_checks, not_found_checks, temporary_failure_checks, permanent_failure_checks, challenge_checks,
      total_response_ms, response_samples, last_response_ms
    ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      backoff_exponent = CASE WHEN excluded.failure_class = 'temporary' THEN scraper_domain_state.backoff_exponent + 1 ELSE 0 END,
      retry_budget_remaining = excluded.retry_budget_remaining,
      cooldown_reason = excluded.cooldown_reason,
      failure_class = excluded.failure_class,
      last_reason_code = excluded.last_reason_code,
      last_challenge_type = excluded.last_challenge_type,
      successful_checks = scraper_domain_state.successful_checks + excluded.successful_checks,
      not_found_checks = scraper_domain_state.not_found_checks + excluded.not_found_checks,
      temporary_failure_checks = scraper_domain_state.temporary_failure_checks + excluded.temporary_failure_checks,
      permanent_failure_checks = scraper_domain_state.permanent_failure_checks + excluded.permanent_failure_checks,
      challenge_checks = scraper_domain_state.challenge_checks + excluded.challenge_checks,
      total_response_ms = scraper_domain_state.total_response_ms + excluded.total_response_ms,
      response_samples = scraper_domain_state.response_samples + excluded.response_samples,
      last_response_ms = excluded.last_response_ms,
      updated_at = excluded.updated_at
  `).bind(
    hostname, backoffUntil, isFailure ? 1 : 0, input.status === "blocked" ? 1 : 0,
    input.status === "unavailable" ? 1 : 0, input.status === "needs_review" ? 1 : 0,
    input.status, isFailure ? reasonCode : null, input.evidence?.profileId ?? null,
    checkedAt, input.status === "found" ? checkedAt : null, checkedAt,
    nextFailureCount, retryBudgetRemaining, backoffUntil ? reasonCode : null, failureClass, reasonCode, input.challengeType ?? null,
    input.status === "found" ? 1 : 0, input.status === "not_found" ? 1 : 0,
    failureClass === "temporary" ? 1 : 0, failureClass === "permanent" ? 1 : 0,
    input.challengeType ? 1 : 0, input.durationMs ?? 0, input.durationMs == null ? 0 : 1, input.durationMs ?? null,
  ).run();
  if (backoffUntil) {
    await env.DB.prepare(`
      INSERT INTO scraper_domain_cooldowns (hostname, reason_code, failure_class, consecutive_failures, retry_budget_remaining, cooldown_until, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(hostname, reason_code) DO UPDATE SET
        failure_class = excluded.failure_class,
        consecutive_failures = scraper_domain_cooldowns.consecutive_failures + 1,
        retry_budget_remaining = excluded.retry_budget_remaining,
        cooldown_until = excluded.cooldown_until,
        last_seen_at = excluded.last_seen_at
    `).bind(hostname, reasonCode, failureClass, nextFailureCount, retryBudgetRemaining, backoffUntil, checkedAt).run();
  } else if (input.status === "found") {
    await env.DB.prepare("DELETE FROM scraper_domain_cooldowns WHERE hostname = ? AND failure_class = 'temporary'").bind(hostname).run();
  }
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
      ...(isConfidenceScores(parsed.confidenceScores) ? { confidenceScores: parsed.confidenceScores } : {}),
      ...(typeof parsed.contentHash === "string" ? { contentHash: parsed.contentHash } : {}),
      canonicalUrl: parsed.canonicalUrl,
      ...(typeof parsed.profileId === "string" ? { profileId: parsed.profileId } : {}),
      checkedAt: parsed.checkedAt,
    };
  } catch {
    return undefined;
  }
}

function isConfidenceScores(value: unknown): value is NonNullable<ProductEvidence["confidenceScores"]> {
  if (!value || typeof value !== "object") return false;
  const scores = value as Record<string, unknown>;
  return ["ean", "name", "price", "source", "overall"].every((key) => typeof scores[key] === "number" && Number.isFinite(scores[key]) && (scores[key] as number) >= 0 && (scores[key] as number) <= 100);
}

function reasonCodeForStatus(status: ScraperStatus): ScraperReasonCode {
  if (status === "found") return "found";
  if (status === "not_found") return "not_found";
  if (status === "blocked") return "blocked";
  if (status === "unavailable") return "network_error";
  return "low_confidence";
}

function hostCooldownReason(reason: ScraperReasonCode) {
  return ["blocked", "cloudflare", "captcha", "bot_wall", "js_challenge", "rate_limited", "timeout", "response_too_large", "http_server_error", "network_error"].includes(reason);
}

function sitemapCacheKey(hostname: string, ean: string) {
  return `${normalizeHostname(hostname)}\u0000${ean.replace(/\D/g, "")}`;
}

function normalizeHostname(value: string) {
  const hostname = value.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  assertPublicHostname(hostname);
  return hostname;
}
