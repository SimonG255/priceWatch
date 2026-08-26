import { and, desc, eq, gt } from "drizzle-orm";
import { getDb } from "../db";
import { scraperDomainCooldowns, scraperDomainState, scraperSitemapHints } from "../db/schema";
import { sitemapCacheKey } from "./cache-keys.ts";
import { assertPublicHostname } from "./product-input.ts";
import { exponentialBackoffMs, failureClassFor } from "./scraper-diagnostics.ts";
import type {
  ChallengeType,
  ProductEvidence,
  ScraperFailureClass,
  ScraperReasonCode,
  ScraperStatus,
  SitemapProductCache,
} from "./scraper-types.ts";

const DOMAIN_REQUEST_INTERVAL_MS = 1_000;
const SITEMAP_HINT_TTL_MS = 14 * 24 * 60 * 60 * 1_000;

export async function reserveScraperDomain(hostname: string, options: { intervalMs?: number } = {}) {
  const normalized = normalizeHostname(hostname);
  const intervalMs = Math.max(500, Math.min(60_000, options.intervalMs ?? DOMAIN_REQUEST_INTERVAL_MS));
  const db = getDb();
  const now = new Date();
  const nowIso = now.toISOString();
  const cooldown = await db
    .select()
    .from(scraperDomainCooldowns)
    .where(and(eq(scraperDomainCooldowns.hostname, normalized), gt(scraperDomainCooldowns.cooldownUntil, nowIso)))
    .limit(1);
  if (cooldown[0]) {
    return {
      allowed: false as const,
      retryAt: cooldown[0].cooldownUntil,
      reasonCode: cooldown[0].reasonCode as ScraperReasonCode,
      failureClass: cooldown[0].failureClass as ScraperFailureClass,
      retryBudgetRemaining: cooldown[0].retryBudgetRemaining,
    };
  }
  const nextAllowedAt = new Date(now.getTime() + intervalMs).toISOString();
  const [current] = await db
    .select()
    .from(scraperDomainState)
    .where(eq(scraperDomainState.hostname, normalized))
    .limit(1);
  if (!current || !current.nextAllowedAt || new Date(current.nextAllowedAt).getTime() <= now.getTime()) {
    await db
      .insert(scraperDomainState)
      .values({ hostname: normalized, nextAllowedAt, updatedAt: nowIso })
      .onConflictDoUpdate({
        target: scraperDomainState.hostname,
        set: { nextAllowedAt, updatedAt: nowIso },
      });
    return { allowed: true as const };
  }
  return {
    allowed: false as const,
    retryAt: current?.nextAllowedAt ?? undefined,
    reasonCode: (current?.lastReasonCode as ScraperReasonCode | null | undefined) ?? undefined,
    failureClass: (current?.failureClass as ScraperFailureClass | null | undefined) ?? undefined,
    retryBudgetRemaining: current.retryBudgetRemaining ?? undefined,
  };
}

/**
 * Checks a durable cooldown without reserving a request slot. The scan route
 * uses this for a fast response, while each outbound page request reserves its
 * own slot through reserveScraperDomain.
 */
export async function getScraperDomainAvailability(hostname: string) {
  const normalized = normalizeHostname(hostname);
  const db = getDb();
  const checkedAt = new Date().toISOString();
  const [state] = await db
    .select()
    .from(scraperDomainState)
    .where(eq(scraperDomainState.hostname, normalized))
    .limit(1);
  const [cooldown] = await db
    .select()
    .from(scraperDomainCooldowns)
    .where(and(eq(scraperDomainCooldowns.hostname, normalized), gt(scraperDomainCooldowns.cooldownUntil, checkedAt)))
    .orderBy(desc(scraperDomainCooldowns.cooldownUntil))
    .limit(1);
  const now = Date.now();
  const retryAt = [state?.backoffUntil, state?.nextAllowedAt, cooldown?.cooldownUntil]
    .filter((value): value is string => typeof value === "string" && Date.parse(value) > now)
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0];
  return retryAt
    ? {
        allowed: false as const,
        retryAt,
        reasonCode: (cooldown?.reasonCode ?? state?.lastReasonCode) as ScraperReasonCode | undefined,
        failureClass: (cooldown?.failureClass ?? state?.failureClass) as ScraperFailureClass | undefined,
        retryBudgetRemaining: cooldown?.retryBudgetRemaining ?? state?.retryBudgetRemaining,
      }
    : { allowed: true as const };
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
  const hostname = normalizeHostname(input.hostname);
  const db = getDb();
  const now = new Date();
  const checkedAt = now.toISOString();
  const reasonCode = input.reasonCode ?? reasonCodeForStatus(input.status);
  const failureClass = input.failureClass ?? failureClassFor(reasonCode);
  const previousReason = await db
    .select()
    .from(scraperDomainCooldowns)
    .where(and(eq(scraperDomainCooldowns.hostname, hostname), eq(scraperDomainCooldowns.reasonCode, reasonCode)))
    .limit(1);
  const hostCooldown = failureClass === "temporary" && hostCooldownReason(reasonCode);
  const nextFailureCount = hostCooldown ? (previousReason[0]?.consecutiveFailures ?? 0) + 1 : 0;
  const backoffUntil = hostCooldown
    ? new Date(
        now.getTime() +
          exponentialBackoffMs({ consecutiveFailures: nextFailureCount, reasonCode, retryAfterMs: input.retryAfterMs }),
      ).toISOString()
    : null;
  const retryBudgetRemaining = Math.max(0, 3 - nextFailureCount);
  const isFailure = input.status === "blocked" || input.status === "unavailable" || input.status === "needs_review";
  const [state] = await db.select().from(scraperDomainState).where(eq(scraperDomainState.hostname, hostname)).limit(1);
  await db
    .insert(scraperDomainState)
    .values({
      hostname,
      nextAllowedAt: null,
      backoffUntil,
      consecutiveFailures: isFailure ? (state?.consecutiveFailures ?? 0) + 1 : 0,
      totalChecks: (state?.totalChecks ?? 0) + 1,
      blockedChecks: (state?.blockedChecks ?? 0) + (input.status === "blocked" ? 1 : 0),
      unavailableChecks: (state?.unavailableChecks ?? 0) + (input.status === "unavailable" ? 1 : 0),
      needsReviewChecks: (state?.needsReviewChecks ?? 0) + (input.status === "needs_review" ? 1 : 0),
      lastOutcome: input.status,
      lastFailureKind: isFailure ? reasonCode : null,
      lastProfileId: input.evidence?.profileId ?? state?.lastProfileId ?? null,
      lastCheckedAt: checkedAt,
      lastSuccessAt: input.status === "found" ? checkedAt : (state?.lastSuccessAt ?? null),
      backoffExponent: failureClass === "temporary" ? (state?.backoffExponent ?? 0) + 1 : 0,
      retryBudgetRemaining: retryBudgetRemaining,
      cooldownReason: backoffUntil ? reasonCode : null,
      failureClass: failureClass,
      lastReasonCode: reasonCode,
      lastChallengeType: input.challengeType ?? state?.lastChallengeType ?? null,
      successfulChecks: (state?.successfulChecks ?? 0) + (input.status === "found" ? 1 : 0),
      notFoundChecks: (state?.notFoundChecks ?? 0) + (input.status === "not_found" ? 1 : 0),
      temporaryFailureChecks: (state?.temporaryFailureChecks ?? 0) + (failureClass === "temporary" ? 1 : 0),
      permanentFailureChecks: (state?.permanentFailureChecks ?? 0) + (failureClass === "permanent" ? 1 : 0),
      challengeChecks: (state?.challengeChecks ?? 0) + (input.challengeType ? 1 : 0),
      totalResponseMs: (state?.totalResponseMs ?? 0) + (input.durationMs ?? 0),
      responseSamples: (state?.responseSamples ?? 0) + (input.durationMs == null ? 0 : 1),
      lastResponseMs: input.durationMs ?? state?.lastResponseMs ?? null,
      updatedAt: checkedAt,
    })
    .onConflictDoUpdate({
      target: scraperDomainState.hostname,
      set: {
        backoffUntil,
        consecutiveFailures: isFailure ? (state?.consecutiveFailures ?? 0) + 1 : 0,
        totalChecks: (state?.totalChecks ?? 0) + 1,
        blockedChecks: (state?.blockedChecks ?? 0) + (input.status === "blocked" ? 1 : 0),
        unavailableChecks: (state?.unavailableChecks ?? 0) + (input.status === "unavailable" ? 1 : 0),
        needsReviewChecks: (state?.needsReviewChecks ?? 0) + (input.status === "needs_review" ? 1 : 0),
        lastOutcome: input.status,
        lastFailureKind: isFailure ? reasonCode : null,
        lastProfileId: input.evidence?.profileId ?? state?.lastProfileId ?? null,
        lastCheckedAt: checkedAt,
        lastSuccessAt: input.status === "found" ? checkedAt : (state?.lastSuccessAt ?? null),
        backoffExponent: failureClass === "temporary" ? (state?.backoffExponent ?? 0) + 1 : 0,
        retryBudgetRemaining: retryBudgetRemaining,
        cooldownReason: backoffUntil ? reasonCode : null,
        failureClass: failureClass,
        lastReasonCode: reasonCode,
        lastChallengeType: input.challengeType ?? state?.lastChallengeType ?? null,
        successfulChecks: (state?.successfulChecks ?? 0) + (input.status === "found" ? 1 : 0),
        notFoundChecks: (state?.notFoundChecks ?? 0) + (input.status === "not_found" ? 1 : 0),
        temporaryFailureChecks: (state?.temporaryFailureChecks ?? 0) + (failureClass === "temporary" ? 1 : 0),
        permanentFailureChecks: (state?.permanentFailureChecks ?? 0) + (failureClass === "permanent" ? 1 : 0),
        challengeChecks: (state?.challengeChecks ?? 0) + (input.challengeType ? 1 : 0),
        totalResponseMs: (state?.totalResponseMs ?? 0) + (input.durationMs ?? 0),
        responseSamples: (state?.responseSamples ?? 0) + (input.durationMs == null ? 0 : 1),
        lastResponseMs: input.durationMs ?? state?.lastResponseMs ?? null,
        updatedAt: checkedAt,
      },
    });
  if (backoffUntil) {
    await db
      .insert(scraperDomainCooldowns)
      .values({
        hostname,
        reasonCode,
        failureClass,
        consecutiveFailures: nextFailureCount,
        retryBudgetRemaining,
        cooldownUntil: backoffUntil,
        lastSeenAt: checkedAt,
      })
      .onConflictDoUpdate({
        target: [scraperDomainCooldowns.hostname, scraperDomainCooldowns.reasonCode],
        set: {
          failureClass,
          consecutiveFailures: nextFailureCount,
          retryBudgetRemaining,
          cooldownUntil: backoffUntil,
          lastSeenAt: checkedAt,
        },
      });
  } else if (input.status === "found") {
    await db
      .delete(scraperDomainCooldowns)
      .where(and(eq(scraperDomainCooldowns.hostname, hostname), eq(scraperDomainCooldowns.failureClass, "temporary")));
  }
}

export function createSitemapProductCache(): SitemapProductCache {
  return {
    async get({ hostname, ean }) {
      const cacheKey = sitemapCacheKey(hostname, ean);
      const [entry] = await getDb()
        .select()
        .from(scraperSitemapHints)
        .where(eq(scraperSitemapHints.cacheKey, cacheKey))
        .limit(1);
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
      await getDb()
        .insert(scraperSitemapHints)
        .values({
          cacheKey,
          hostname: normalizeHostname(hostname),
          ean: ean.replace(/\D/g, ""),
          candidateUrl: entry.candidateUrl,
          sitemapUrl: entry.sitemapUrl ?? null,
          sitemapLastmod: entry.sitemapLastmod ?? null,
          discoveredAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + SITEMAP_HINT_TTL_MS).toISOString(),
          updatedAt: now.toISOString(),
        })
        .onConflictDoUpdate({
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
      await getDb()
        .delete(scraperSitemapHints)
        .where(eq(scraperSitemapHints.cacheKey, sitemapCacheKey(hostname, ean)));
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
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.exactEan !== "boolean" ||
      typeof parsed.structuredExactEan !== "boolean" ||
      typeof parsed.structuredProduct !== "boolean" ||
      typeof parsed.nameScore !== "number" ||
      typeof parsed.canonicalUrl !== "string" ||
      typeof parsed.checkedAt !== "string"
    )
      return undefined;
    return {
      exactEan: parsed.exactEan,
      structuredExactEan: parsed.structuredExactEan,
      structuredProduct: parsed.structuredProduct,
      nameScore: parsed.nameScore,
      ...(typeof parsed.priceSource === "string"
        ? { priceSource: parsed.priceSource as ProductEvidence["priceSource"] }
        : {}),
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
  return ["ean", "name", "price", "source", "overall"].every(
    (key) =>
      typeof scores[key] === "number" &&
      Number.isFinite(scores[key]) &&
      (scores[key] as number) >= 0 &&
      (scores[key] as number) <= 100,
  );
}

function reasonCodeForStatus(status: ScraperStatus): ScraperReasonCode {
  if (status === "found") return "found";
  if (status === "not_found") return "not_found";
  if (status === "blocked") return "blocked";
  if (status === "unavailable") return "network_error";
  return "low_confidence";
}

function hostCooldownReason(reason: ScraperReasonCode) {
  return [
    "blocked",
    "captcha",
    "bot_wall",
    "js_challenge",
    "rate_limited",
    "timeout",
    "response_too_large",
    "http_server_error",
    "network_error",
  ].includes(reason);
}

function normalizeHostname(value: string) {
  const hostname = value
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/\.$/, "");
  assertPublicHostname(hostname);
  return hostname;
}
