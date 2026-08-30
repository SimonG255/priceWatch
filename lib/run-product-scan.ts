import { and, eq, lte, ne, or } from "drizzle-orm";
import { ensureProductsSchema, getDb } from "../db";
import { customSearchProfiles, monitoredProducts } from "../db/schema";
import { searchPublicWebsite, type ProductSearchResult } from "./product-search.ts";
import {
  createSitemapProductCache,
  getScraperDomainAvailability,
  parseStoredProductEvidence,
  recordScraperDomainOutcome,
  reserveScraperDomain,
} from "./scraper-state.ts";
import {
  completeScrapeRun,
  createScraperResultCache,
  discardScrapeRun,
  evaluateScraperAlerts,
  loadScraperContext,
  markScrapeRunSuperseded,
  startScrapeRun,
} from "./scraper-operations.ts";
import { APP_TIME_ZONE, formatAppTime } from "./time-zone";

export async function runProductScan(input: {
  ownerEmail: string;
  productId: string;
  trigger?: "manual" | "scheduled" | "bulk_retest";
  scheduleId?: string;
  ignoreCooldown?: boolean;
}) {
  await ensureProductsSchema();
  const db = getDb();
  const [product] = await db
    .select()
    .from(monitoredProducts)
    .where(and(eq(monitoredProducts.id, input.productId), eq(monitoredProducts.ownerEmail, input.ownerEmail)))
    .limit(1);
  if (!product) return { error: "Product not found.", status: 404 as const };

  const hostname = new URL(product.websiteUrl).hostname.toLowerCase().replace(/^www\./, "");
  const run = await startScrapeRun({
    ownerEmail: input.ownerEmail,
    productId: product.id,
    scheduleId: input.scheduleId,
    trigger: input.trigger ?? "manual",
    hostname,
  });

  const [claimed] = await db
    .update(monitoredProducts)
    .set({
      status: "searching",
      statusMessage: "Searching public pages…",
      lastScanId: run.id,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(monitoredProducts.id, product.id),
        eq(monitoredProducts.ownerEmail, input.ownerEmail),
        or(
          ne(monitoredProducts.status, "searching"),
          lte(monitoredProducts.updatedAt, new Date(Date.now() - 15 * 60_000).toISOString()),
        ),
      ),
    )
    .returning({ id: monitoredProducts.id });
  if (!claimed) {
    await discardScrapeRun(run.id, input.ownerEmail);
    const [current] = await db
      .select({ id: monitoredProducts.id })
      .from(monitoredProducts)
      .where(and(eq(monitoredProducts.id, product.id), eq(monitoredProducts.ownerEmail, input.ownerEmail)))
      .limit(1);
    return current
      ? {
          error: "This product is already being checked. Wait for the active scan to finish.",
          status: 409 as const,
          busy: true,
        }
      : { error: "Product not found.", status: 404 as const };
  }

  const availability = await getScraperDomainAvailability(hostname);
  if (!input.ignoreCooldown && !availability.allowed) {
    const retry = availability.retryAt
      ? ` Try again after ${formatAppTime(availability.retryAt)} (${APP_TIME_ZONE}).`
      : "";
    const result: ProductSearchResult = {
      status: "unavailable",
      reasonCode: availability.reasonCode ?? "rate_limited",
      failureClass: availability.failureClass ?? "temporary",
      message: `This website is cooling down to respect its public request limits.${retry}`,
      attempts: [],
      durationMs: 0,
    };
    const updated = await persistProductResult(product.id, input.ownerEmail, run.id, result);
    if (!updated) return supersededScanOutcome(product.id, input.ownerEmail, run.id, result);
    await completeScrapeRun({ runId: run.id, ownerEmail: input.ownerEmail, product, result }).catch((error) =>
      console.error("Scrape audit persistence failed", error),
    );
    return { product: updated, result, runId: run.id, cooledDown: true };
  }

  const scanStartedAt = Date.now();
  let result: ProductSearchResult;
  try {
    const [profiles, context] = await Promise.all([
      db.select().from(customSearchProfiles).where(eq(customSearchProfiles.enabled, true)),
      loadScraperContext(hostname),
    ]);
    const normalizedProfiles = profiles.map((profile) => ({
      ...profile,
      siteType: normalizeSiteType(profile.siteType),
    }));
    result = await searchPublicWebsite(
      product.websiteUrl,
      product.productName,
      product.ean,
      normalizedProfiles,
      product.matchedUrl,
      {
        sitemapCache: createSitemapProductCache(),
        resultCache: createScraperResultCache(),
        knownBadPatterns: context.knownBadPatterns,
        accessPolicy: effectiveAccessPolicy(hostname, context.policy?.accessMode),
        respectRobots: true,
        reserveRequest: () =>
          reserveScraperDomain(hostname, { intervalMs: context.policy?.requestIntervalMs ?? undefined }),
        domainProfile: context.policy
          ? {
              siteType: normalizeSiteType(context.policy.siteType),
              timeoutMs: context.policy.timeoutMs ?? undefined,
              maxPageBytes: context.policy.maxPageBytes ?? undefined,
              retryBudget: context.policy.retryBudget ?? undefined,
            }
          : undefined,
        previous: {
          status: product.status,
          matchedUrl: product.matchedUrl,
          title: product.resultTitle,
          priceCents: product.priceCents,
          currency: product.currency,
          inStock: product.inStock,
          matchType: product.matchType,
          confidence: product.confidence,
          evidence: parseStoredProductEvidence(product.evidenceJson),
          pageEtag: product.pageEtag,
          pageLastModified: product.pageLastModified,
        },
      },
    );
  } catch (error) {
    result = {
      status: "unavailable",
      reasonCode: "network_error",
      failureClass: "temporary",
      message: "The scan stopped unexpectedly. Nexus recorded the failure and will retry safely on the next run.",
      attempts: [],
      durationMs: Date.now() - scanStartedAt,
    };
    console.error("Product scan failed", error instanceof Error ? error.message : "Unknown scan error");
  }

  // A telemetry failure must never overwrite a valid extraction. Persist the
  // authoritative product result first; operational side effects are isolated.
  const updated = await persistProductResult(product.id, input.ownerEmail, run.id, result);
  if (!updated) return supersededScanOutcome(product.id, input.ownerEmail, run.id, result);
  await completeScrapeRun({ runId: run.id, ownerEmail: input.ownerEmail, product, result }).catch((error) =>
    console.error("Scrape audit persistence failed", error),
  );
  await recordScraperDomainOutcome({
    hostname,
    status: result.status,
    evidence: result.evidence,
    reasonCode: result.reasonCode,
    failureClass: result.failureClass,
    challengeType: result.challengeType,
    durationMs: result.durationMs,
    retryAfterMs: result.retryAfterMs,
  }).catch((error) => console.error("Scrape domain metrics failed", error));
  await evaluateScraperAlerts(hostname).catch(() => undefined);
  return { product: updated, result, runId: run.id };
}

async function persistProductResult(productId: string, ownerEmail: string, runId: string, result: ProductSearchResult) {
  const now = new Date().toISOString();
  const verifiedObservation = result.status === "found" ? {
    matchedUrl: result.matchedUrl ?? null,
    resultTitle: result.title ?? null,
    priceCents: result.priceCents ?? null,
    currency: result.currency ?? null,
    inStock: result.inStock ?? null,
    matchType: result.matchType ?? null,
    confidence: result.confidence ?? null,
    evidenceJson: result.evidence ? JSON.stringify(result.evidence) : null,
    pageEtag: result.pageEtag ?? null,
    pageLastModified: result.pageLastModified ?? null,
    confidenceScoresJson: result.confidenceScores ? JSON.stringify(result.confidenceScores) : null,
    lastContentHash: result.contentHash ?? result.evidence?.contentHash ?? null,
  } : {};
  const [updated] = await getDb()
    .update(monitoredProducts)
    .set({
      status: result.status,
      statusMessage: result.message,
      ...verifiedObservation,
      lastHttpStatus: result.httpStatus ?? null,
      reasonCode: result.reasonCode ?? null,
      failureClass: result.failureClass ?? null,
      challengeType: result.challengeType ?? null,
      lastDurationMs: result.durationMs ?? null,
      lastScanId: runId,
      lastCheckedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(monitoredProducts.id, productId),
        eq(monitoredProducts.ownerEmail, ownerEmail),
        eq(monitoredProducts.lastScanId, runId),
      ),
    )
    .returning();
  return updated;
}

async function supersededScanOutcome(
  productId: string,
  ownerEmail: string,
  runId: string,
  original: ProductSearchResult,
) {
  await markScrapeRunSuperseded(runId, ownerEmail, original.durationMs);
  const [product] = await getDb()
    .select()
    .from(monitoredProducts)
    .where(and(eq(monitoredProducts.id, productId), eq(monitoredProducts.ownerEmail, ownerEmail)))
    .limit(1);
  const result: ProductSearchResult = {
    status: "needs_review",
    reasonCode: "stale_result",
    failureClass: "permanent",
    message: "A newer scan took ownership before this result could be saved.",
    attempts: original.attempts,
    durationMs: original.durationMs,
  };
  return { product, result, runId, stale: true };
}

function effectiveAccessPolicy(hostname: string, stored: string | undefined) {
  const blocked = splitDomains(process.env.SCRAPER_BLOCKED_DOMAINS);
  const allowed = splitDomains(process.env.SCRAPER_ALLOWED_DOMAINS);
  if (stored === "block" || blocked.some((domain) => sameDomain(hostname, domain))) return "block" as const;
  if (allowed.length && !allowed.some((domain) => sameDomain(hostname, domain))) return "block" as const;
  return "allow" as const;
}

function splitDomains(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((item) =>
      item
        .trim()
        .toLowerCase()
        .replace(/^www\./, ""),
    )
    .filter(Boolean);
}

function sameDomain(hostname: string, configured: string) {
  return hostname === configured || hostname.endsWith(`.${configured}`);
}

function normalizeSiteType(value: string | undefined) {
  return ["auto", "standard", "slow", "large", "javascript", "marketplace"].includes(value ?? "")
    ? (value as "auto" | "standard" | "slow" | "large" | "javascript" | "marketplace")
    : "auto";
}
