import { and, desc, eq, gt, ne, or } from "drizzle-orm";
import { getDb } from "../db";
import {
  customSearchProfiles,
  customerAlertEvents,
  scrapeAttempts,
  scrapeRuns,
  scraperAlertEvents,
  scraperAlertRules,
  scraperDomainPolicies,
  scraperDomainState,
  scraperKnownBadPatterns,
  scraperResultCache,
  priceSnapshots,
} from "../db/schema";
import { contentFingerprint } from "./scraper-diagnostics.ts";
import type { CachedProductMatch, KnownBadPattern, ScraperResultCache } from "./scraper-types.ts";
import type { ProductSearchResult } from "./product-search.ts";

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

export function createScraperResultCache(): ScraperResultCache {
  return {
    async get({ url, ean, contentHash }) {
      const normalizedUrl = normalizeUrl(url);
      const cacheKey = resultCacheKey(normalizedUrl, ean, contentHash);
      const [entry] = await getDb()
        .select()
        .from(scraperResultCache)
        .where(
          and(
            eq(scraperResultCache.cacheKey, cacheKey),
            eq(scraperResultCache.normalizedUrl, normalizedUrl),
            eq(scraperResultCache.ean, digits(ean)),
            eq(scraperResultCache.contentHash, contentHash),
            gt(scraperResultCache.expiresAt, new Date().toISOString()),
          ),
        )
        .limit(1);
      if (!entry) return undefined;
      const parsed = parseCachedMatch(entry.resultJson);
      if (!parsed) return undefined;
      await getDb()
        .update(scraperResultCache)
        .set({ lastUsedAt: new Date().toISOString(), hitCount: entry.hitCount + 1 })
        .where(eq(scraperResultCache.cacheKey, cacheKey));
      return parsed;
    },
    async put({ url, ean, contentHash, match }) {
      const normalizedUrl = normalizeUrl(url);
      const now = new Date();
      await getDb()
        .insert(scraperResultCache)
        .values({
          cacheKey: resultCacheKey(normalizedUrl, ean, contentHash),
          normalizedUrl,
          hostname: new URL(normalizedUrl).hostname.toLowerCase().replace(/^www\./, ""),
          ean: digits(ean),
          contentHash,
          resultJson: JSON.stringify(match),
          createdAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + CACHE_TTL_MS).toISOString(),
        })
        .onConflictDoUpdate({
          target: scraperResultCache.cacheKey,
          set: {
            resultJson: JSON.stringify(match),
            expiresAt: new Date(now.getTime() + CACHE_TTL_MS).toISOString(),
            lastUsedAt: now.toISOString(),
          },
        });
    },
    async invalidate({ url, ean, exceptContentHash }) {
      const filters = [
        eq(scraperResultCache.normalizedUrl, normalizeUrl(url)),
        eq(scraperResultCache.ean, digits(ean)),
      ];
      if (exceptContentHash) filters.push(ne(scraperResultCache.contentHash, exceptContentHash));
      await getDb()
        .delete(scraperResultCache)
        .where(and(...filters));
    },
  };
}

export async function loadScraperContext(hostname: string) {
  const normalized = hostname
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/\.$/, "");
  const now = new Date().toISOString();
  const db = getDb();
  const [[policy], patterns] = await Promise.all([
    db.select().from(scraperDomainPolicies).where(eq(scraperDomainPolicies.hostname, normalized)).limit(1),
    db
      .select()
      .from(scraperKnownBadPatterns)
      .where(
        and(
          or(eq(scraperKnownBadPatterns.hostname, normalized), eq(scraperKnownBadPatterns.hostname, "*")),
          eq(scraperKnownBadPatterns.enabled, true),
        ),
      ),
  ]);
  return {
    policy,
    knownBadPatterns: patterns
      .filter((pattern: { expiresAt: string | null }) => !pattern.expiresAt || pattern.expiresAt > now)
      .map(
        (pattern: {
          id: string;
          hostname: string;
          urlPattern: string | null;
          contentPattern: string | null;
          reason: string;
        }): KnownBadPattern => ({
          id: pattern.id,
          hostname: pattern.hostname,
          urlPattern: pattern.urlPattern ?? undefined,
          contentPattern: pattern.contentPattern ?? undefined,
          reason: pattern.reason,
        }),
      ),
  };
}

export async function startScrapeRun(input: {
  ownerEmail: string;
  productId?: string;
  scheduleId?: string;
  trigger: string;
  hostname: string;
}) {
  const id = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  await getDb()
    .insert(scrapeRuns)
    .values({ id, ...input, status: "running", startedAt, createdAt: startedAt });
  return { id, startedAt };
}

export async function discardScrapeRun(runId: string, ownerEmail: string) {
  await getDb()
    .delete(scrapeRuns)
    .where(and(eq(scrapeRuns.id, runId), eq(scrapeRuns.ownerEmail, ownerEmail)));
}

export async function markScrapeRunSuperseded(runId: string, ownerEmail: string, durationMs?: number) {
  await getDb()
    .update(scrapeRuns)
    .set({
      status: "needs_review",
      reasonCode: "stale_result",
      failureClass: "permanent",
      message: "A newer scan took ownership before this result could be saved.",
      durationMs: durationMs ?? null,
      completedAt: new Date().toISOString(),
    })
    .where(and(eq(scrapeRuns.id, runId), eq(scrapeRuns.ownerEmail, ownerEmail)));
}

export async function completeScrapeRun(input: {
  runId: string;
  ownerEmail: string;
  product: {
    id: string;
    ean: string;
    websiteUrl: string;
    productName?: string;
    ownPriceCents?: number | null;
    alertOnPriceDrop?: boolean;
    alertOnRestock?: boolean;
    alertTargetPriceCents?: number | null;
    alertDropPercentBps?: number | null;
  };
  result: ProductSearchResult;
}) {
  const { runId, ownerEmail, product, result } = input;
  const completedAt = new Date().toISOString();
  const hostname = new URL(product.websiteUrl).hostname.toLowerCase().replace(/^www\./, "");
  const [completedRun] = await getDb()
    .update(scrapeRuns)
    .set({
      profileId: result.evidence?.profileId ?? result.profileHealth?.profileId ?? null,
      status: result.status,
      reasonCode: result.reasonCode ?? null,
      failureClass: result.failureClass ?? null,
      challengeType: result.challengeType ?? null,
      message: result.message,
      durationMs: result.durationMs ?? null,
      attemptCount: result.attempts?.length ?? 0,
      matchedUrl: result.matchedUrl ?? null,
      resultTitle: result.title ?? null,
      priceCents: result.priceCents ?? null,
      currency: result.currency ?? null,
      inStock: result.inStock ?? null,
      exactEan: result.evidence?.exactEan ?? false,
      nameSimilarityBps: result.evidence ? Math.round(result.evidence.nameScore * 10_000) : null,
      confidenceScoresJson: result.confidenceScores ? JSON.stringify(result.confidenceScores) : null,
      httpStatus: result.httpStatus ?? null,
      completedAt,
    })
    .where(and(eq(scrapeRuns.id, runId), eq(scrapeRuns.ownerEmail, ownerEmail)))
    .returning({ id: scrapeRuns.id });
  if (!completedRun) return;

  const attemptRows = (result.attempts ?? []).map((attempt, ordinal) => ({
    id: crypto.randomUUID(),
    runId,
    ownerEmail,
    ordinal,
    url: redactUrlCredentials(attempt.url),
    hostname,
    profileId: attempt.profileId ?? null,
    profileLabel: attempt.profileLabel ?? null,
    outcome: attempt.outcome,
    reasonCode: attempt.reasonCode,
    failureClass: attempt.failureClass,
    challengeType: attempt.challengeType ?? null,
    httpStatus: attempt.httpStatus ?? null,
    durationMs: attempt.durationMs,
    responseBytes: attempt.responseBytes ?? null,
    contentHash: attempt.contentHash ?? null,
    message: attempt.message?.slice(0, 500) ?? null,
    createdAt: completedAt,
  }));
  if (attemptRows.length) {
    await getDb()
      .insert(scrapeAttempts)
      .values(attemptRows)
      .onConflictDoNothing({
        target: [scrapeAttempts.runId, scrapeAttempts.ordinal],
      });
  }

  if (result.status === "found" && result.priceCents != null && result.currency && result.matchedUrl) {
    const previousSnapshots = await getDb().select().from(priceSnapshots)
      .where(and(eq(priceSnapshots.ownerEmail, ownerEmail), eq(priceSnapshots.productId, product.id)))
      .orderBy(desc(priceSnapshots.capturedAt)).limit(2);
    const previous = previousSnapshots[0];
    const beforePrevious = previousSnapshots[1];
    const scores = result.confidenceScores;
    await getDb()
      .insert(priceSnapshots)
      .values({
        id: crypto.randomUUID(),
        ownerEmail,
        productId: product.id,
        scanId: runId,
        ean: product.ean,
        hostname,
        matchedUrl: result.matchedUrl,
        priceCents: result.priceCents,
        currency: result.currency,
        inStock: result.inStock ?? null,
        exactEan: result.evidence?.exactEan ?? false,
        nameSimilarityBps: result.evidence ? Math.round(result.evidence.nameScore * 10_000) : 0,
        priceConfidence: scores?.price ?? 0,
        sourceConfidence: scores?.source ?? 0,
        overallConfidence: scores?.overall ?? 0,
        priceSource: result.evidence?.priceSource ?? null,
        contentHash: result.contentHash ?? result.evidence?.contentHash ?? null,
        capturedAt: completedAt,
      })
      .onConflictDoNothing({ target: priceSnapshots.scanId });
    await createCustomerAlerts({ ownerEmail, product, result, previous, beforePrevious, detectedAt: completedAt });
  }

  await updateProfileHealth(result, completedAt);
}

async function updateProfileHealth(result: ProductSearchResult, checkedAt: string) {
  const profileId = result.profileHealth?.profileId ?? result.evidence?.profileId;
  if (!profileId?.startsWith("custom-")) return;
  const id = profileId.slice("custom-".length);
  const score = result.profileHealth?.score ?? (result.status === "found" ? 100 : 40);
  const driftStatus = result.profileHealth?.status ?? (result.status === "found" ? "healthy" : "degraded");
  await getDb()
    .update(customSearchProfiles)
    .set({
      healthScore: score,
      driftStatus,
      selectorSuggestionsJson: result.profileHealth?.selectorSuggestions
        ? JSON.stringify(result.profileHealth.selectorSuggestions)
        : null,
      lastSignatureSeenAt: result.profileHealth?.signatureMatched === false ? null : checkedAt,
      ...(result.status === "found" ? { lastSeenWorkingAt: checkedAt } : {}),
      ...(score <= 20 || driftStatus === "drifted" ? { enabled: false } : {}),
    })
    .where(eq(customSearchProfiles.id, id));
}

export async function listScraperDashboard() {
  const db = getDb();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000).toISOString();
  const [domains, runs, profiles] = await Promise.all([
    db.select().from(scraperDomainState).orderBy(desc(scraperDomainState.updatedAt)).limit(250),
    db
      .select()
      .from(scrapeRuns)
      .where(gt(scrapeRuns.startedAt, since))
      .orderBy(desc(scrapeRuns.startedAt))
      .limit(5_000),
    db.select().from(customSearchProfiles).orderBy(desc(customSearchProfiles.updatedAt)).limit(250),
  ]);
  const latencies = runs
    .map((run: { durationMs: number | null }) => run.durationMs)
    .filter((value: number | null): value is number => value != null)
    .sort((a: number, b: number) => a - b);
  const operational = runs.filter(
    (run: { status: string }) => !["blocked", "unavailable", "needs_review"].includes(run.status),
  ).length;
  const summary = {
    runs: runs.length,
    operationalSuccessRate: runs.length ? operational / runs.length : 0,
    matchRate: runs.length ? runs.filter((run: { status: string }) => run.status === "found").length / runs.length : 0,
    blockedRate: runs.length
      ? runs.filter((run: { status: string }) => run.status === "blocked").length / runs.length
      : 0,
    unavailableRate: runs.length
      ? runs.filter((run: { status: string }) => run.status === "unavailable").length / runs.length
      : 0,
    medianResponseMs: latencies.length ? latencies[Math.floor(latencies.length / 2)] : null,
  };
  const lastFailures = new Map<string, typeof runs[number]>();
  for (const run of runs) {
    if (["blocked", "unavailable", "needs_review", "error"].includes(run.status) && !lastFailures.has(run.hostname)) lastFailures.set(run.hostname, run);
  }
  return {
    generatedAt: new Date().toISOString(),
    summary,
    domains: domains.map(
      (domain: {
        hostname: string;
        totalChecks: number;
        successfulChecks: number;
        notFoundChecks: number;
        totalResponseMs: number;
        responseSamples: number;
        updatedAt: string;
        [key: string]: unknown;
      }) => ({
        ...domain,
        successRate: domain.totalChecks ? (domain.successfulChecks + domain.notFoundChecks) / domain.totalChecks : 0,
        averageResponseMs: domain.responseSamples ? Math.round(domain.totalResponseMs / domain.responseSamples) : null,
        lastFailure: lastFailures.get(domain.hostname) ? {
          status: lastFailures.get(domain.hostname)!.status,
          reasonCode: lastFailures.get(domain.hostname)!.reasonCode,
          message: lastFailures.get(domain.hostname)!.message,
          startedAt: lastFailures.get(domain.hostname)!.startedAt,
        } : null,
      }),
    ),
    profiles,
    needsReview: runs.filter((run: { status: string }) => run.status === "needs_review").slice(0, 100),
    recentRuns: runs.slice(0, 100),
  };
}

export async function listAuditRuns(limit = 100) {
  const safeLimit = Math.max(1, Math.min(500, limit));
  return getDb().select().from(scrapeRuns).orderBy(desc(scrapeRuns.startedAt)).limit(safeLimit);
}

export async function evaluateScraperAlerts(hostname: string) {
  const db = getDb();
  const [state] = await db.select().from(scraperDomainState).where(eq(scraperDomainState.hostname, hostname)).limit(1);
  if (!state) return;
  const rules = await db
    .select()
    .from(scraperAlertRules)
    .where(
      and(
        eq(scraperAlertRules.enabled, true),
        or(eq(scraperAlertRules.hostname, hostname), eq(scraperAlertRules.hostname, "*")),
      ),
    );
  for (const rule of rules) {
    const now = new Date().toISOString();
    await db
      .update(scraperAlertRules)
      .set({ lastEvaluatedAt: now, updatedAt: now })
      .where(eq(scraperAlertRules.id, rule.id));
    const operationalSuccess = state.successfulChecks + state.notFoundChecks;
    const successRateBps = state.totalChecks ? Math.round((operationalSuccess / state.totalChecks) * 10_000) : 10_000;
    if (state.totalChecks < rule.minimumChecks) continue;
    if (successRateBps >= rule.minimumSuccessRateBps && state.consecutiveFailures < rule.maximumConsecutiveFailures) {
      await db.update(scraperAlertEvents).set({ state: "resolved", resolvedAt: now }).where(and(
        eq(scraperAlertEvents.ruleId, rule.id),
        eq(scraperAlertEvents.hostname, hostname),
        ne(scraperAlertEvents.state, "resolved"),
      ));
      continue;
    }
    const bucket = Math.floor(Date.now() / (rule.cooldownMinutes * 60_000));
    const dedupeKey = `${rule.id}:${hostname}:${bucket}`;
    const message = `${hostname} scraper health fell to ${(successRateBps / 100).toFixed(1)}% with ${state.consecutiveFailures} consecutive failures.`;
    const [event] = await db
      .insert(scraperAlertEvents)
      .values({
        id: crypto.randomUUID(),
        ruleId: rule.id,
        hostname,
        state: "open",
        dedupeKey,
        observedJson: JSON.stringify({
          successRateBps,
          consecutiveFailures: state.consecutiveFailures,
          lastReasonCode: state.lastReasonCode,
        }),
        message,
        firstDetectedAt: now,
        lastDetectedAt: now,
      })
      .onConflictDoNothing({ target: scraperAlertEvents.dedupeKey })
      .returning();
    if (!event) continue;
    const endpoint = rule.channel === "email" ? process.env.ALERT_EMAIL_WEBHOOK_URL : process.env.SLACK_WEBHOOK_URL;
    if (!endpoint) {
      await db
        .update(scraperAlertEvents)
        .set({ state: "delivery_failed", deliveryError: `${rule.channel} endpoint is not configured.` })
        .where(eq(scraperAlertEvents.id, event.id));
      continue;
    }
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          rule.channel === "slack"
            ? { text: `[PriceWatch] ${message}` }
            : { subject: `PriceWatch alert: ${hostname}`, text: message },
        ),
        signal: AbortSignal.timeout(8_000),
      });
      await db
        .update(scraperAlertEvents)
        .set(
          response.ok
            ? { state: "sent", sentAt: new Date().toISOString() }
            : { state: "delivery_failed", deliveryError: `HTTP ${response.status}` },
        )
        .where(eq(scraperAlertEvents.id, event.id));
    } catch (error) {
      await db
        .update(scraperAlertEvents)
        .set({
          state: "delivery_failed",
          deliveryError: error instanceof Error ? error.message.slice(0, 300) : "Delivery failed",
        })
        .where(eq(scraperAlertEvents.id, event.id));
    }
  }
}

async function createCustomerAlerts(input: {
  ownerEmail: string;
  product: {
    id: string;
    productName?: string;
    ownPriceCents?: number | null;
    alertOnPriceDrop?: boolean;
    alertOnRestock?: boolean;
    alertTargetPriceCents?: number | null;
    alertDropPercentBps?: number | null;
  };
  result: ProductSearchResult;
  previous?: typeof priceSnapshots.$inferSelect;
  beforePrevious?: typeof priceSnapshots.$inferSelect;
  detectedAt: string;
}) {
  const { ownerEmail, product, result, previous, beforePrevious, detectedAt } = input;
  if (result.priceCents == null || !result.currency) return;
  const comparablePrevious = previous?.currency === result.currency ? previous : undefined;
  const comparableBeforePrevious = beforePrevious?.currency === result.currency ? beforePrevious : undefined;
  const alerts: Array<{ type: string; message: string }> = [];
  const label = product.productName || "A monitored product";
  if (product.alertOnPriceDrop !== false && comparablePrevious && result.priceCents < comparablePrevious.priceCents) {
    alerts.push({
      type: "price_drop",
      message: `${label} dropped from ${money(comparablePrevious.priceCents, result.currency)} to ${money(result.priceCents, result.currency)}.`,
    });
  }
  if (
    product.alertOnPriceDrop !== false &&
    product.alertTargetPriceCents != null &&
    result.priceCents <= product.alertTargetPriceCents &&
    (!comparablePrevious || comparablePrevious.priceCents > product.alertTargetPriceCents)
  ) {
    alerts.push({
      type: "below_target_price",
      message: `${label} reached your target price: ${money(result.priceCents, result.currency)} (target ${money(product.alertTargetPriceCents, result.currency)}).`,
    });
  }
  const currentDropBps = comparablePrevious && comparablePrevious.priceCents > 0
    ? Math.round(((comparablePrevious.priceCents - result.priceCents) / comparablePrevious.priceCents) * 10_000)
    : 0;
  const previousDropBps = comparableBeforePrevious && comparableBeforePrevious.priceCents > 0 && comparablePrevious
    ? Math.round(((comparableBeforePrevious.priceCents - comparablePrevious.priceCents) / comparableBeforePrevious.priceCents) * 10_000)
    : 0;
  if (
    product.alertOnPriceDrop !== false &&
    product.alertDropPercentBps != null &&
    currentDropBps >= product.alertDropPercentBps &&
    previousDropBps < product.alertDropPercentBps
  ) {
    alerts.push({
      type: "percentage_price_drop",
      message: `${label} dropped ${(currentDropBps / 100).toFixed(2)}% to ${money(result.priceCents, result.currency)}.`,
    });
  }
  if (product.alertOnPriceDrop !== false && product.ownPriceCents != null && result.priceCents < product.ownPriceCents
    && (!previous || previous.priceCents >= product.ownPriceCents)) {
    alerts.push({
      type: "below_own_price",
      message: `${label} is now ${money(result.priceCents, result.currency)}, below your price of ${money(product.ownPriceCents, result.currency)}.`,
    });
  }
  if (product.alertOnRestock !== false && previous?.inStock === false && result.inStock === true) {
    alerts.push({ type: "restock", message: `${label} is back in stock at ${money(result.priceCents, result.currency)}.` });
  }
  for (const alert of alerts) {
    const [event] = await getDb().insert(customerAlertEvents).values({
      id: crypto.randomUUID(),
      ownerEmail,
      productId: product.id,
      alertType: alert.type,
      state: "open",
      dedupeKey: `${product.id}:${alert.type}:${detectedAt}`,
      message: alert.message,
      previousValueJson: comparablePrevious ? JSON.stringify({ priceCents: comparablePrevious.priceCents, currency: comparablePrevious.currency, inStock: comparablePrevious.inStock }) : null,
      currentValueJson: JSON.stringify({ priceCents: result.priceCents, currency: result.currency, inStock: result.inStock ?? null }),
      detectedAt,
    }).onConflictDoNothing({ target: customerAlertEvents.dedupeKey }).returning();
    if (!event) continue;
    const endpoint = process.env.ALERT_EMAIL_WEBHOOK_URL;
    if (!endpoint) {
      await getDb().update(customerAlertEvents).set({ state: "delivery_failed", deliveryError: "Email endpoint is not configured." })
        .where(eq(customerAlertEvents.id, event.id));
      continue;
    }
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: ownerEmail, subject: `PriceWatch: ${alert.type.replaceAll("_", " ")}`, text: alert.message }),
        signal: AbortSignal.timeout(8_000),
      });
      await getDb().update(customerAlertEvents).set(response.ok
        ? { state: "sent", sentAt: new Date().toISOString() }
        : { state: "delivery_failed", deliveryError: `HTTP ${response.status}` })
        .where(eq(customerAlertEvents.id, event.id));
    } catch (error) {
      await getDb().update(customerAlertEvents).set({
        state: "delivery_failed",
        deliveryError: error instanceof Error ? error.message.slice(0, 300) : "Delivery failed",
      }).where(eq(customerAlertEvents.id, event.id));
    }
  }
}

function money(cents: number, currency: string) {
  try { return new Intl.NumberFormat("en", { style: "currency", currency }).format(cents / 100); }
  catch { return `${(cents / 100).toFixed(2)} ${currency}`; }
}

function parseCachedMatch(value: string): CachedProductMatch | undefined {
  try {
    const match = JSON.parse(value) as CachedProductMatch;
    if (
      !match ||
      typeof match.url !== "string" ||
      typeof match.title !== "string" ||
      typeof match.eanMatch !== "boolean" ||
      typeof match.nameScore !== "number" ||
      typeof match.score !== "number" ||
      !match.confidenceScores
    )
      return undefined;
    return match;
  } catch {
    return undefined;
  }
}

function resultCacheKey(url: string, ean: string, contentHash: string) {
  return contentFingerprint(`${url}\u0000${digits(ean)}\u0000${contentHash}`);
}

function normalizeUrl(value: string) {
  const url = new URL(value);
  url.hash = "";
  return url.toString();
}

function redactUrlCredentials(value: string) {
  const url = new URL(value);
  url.username = "";
  url.password = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/(?:token|secret|auth|signature|session|password|passcode|api[_-]?key|access[_-]?key)/i.test(key))
      url.searchParams.set(key, "[redacted]");
  }
  return url.toString();
}

function digits(value: string) {
  return value.replace(/\D/g, "");
}
