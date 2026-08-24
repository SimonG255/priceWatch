import { and, eq } from "drizzle-orm";
import { ensureProductsSchema, getDb } from "../../../../../db";
import { customSearchProfiles, monitoredProducts } from "../../../../../db/schema";
import { getCurrentUserEmail } from "../../../../../lib/current-user";
import { searchPublicWebsite } from "../../../../../lib/product-search";
import { createSitemapProductCache, getScraperDomainAvailability, parseStoredProductEvidence, recordScraperDomainOutcome, reserveScraperDomain } from "../../../../../lib/scraper-state";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ownerEmail = await getCurrentUserEmail();
  if (!ownerEmail) return Response.json({ error: "Sign in to search products." }, { status: 401 });
  await ensureProductsSchema();
  const { id } = await params;
  const db = getDb();
  const [product] = await db.select().from(monitoredProducts).where(and(eq(monitoredProducts.id, id), eq(monitoredProducts.ownerEmail, ownerEmail))).limit(1);
  if (!product) return Response.json({ error: "Product not found." }, { status: 404 });
  const hostname = new URL(product.websiteUrl).hostname;
  const reservation = await getScraperDomainAvailability(hostname);
  if (!reservation.allowed) {
    const retry = reservation.retryAt ? ` Try again after ${new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(new Date(reservation.retryAt))}.` : "";
    const now = new Date().toISOString();
    const [updated] = await db.update(monitoredProducts).set({
      status: "unavailable",
      statusMessage: `This website is cooling down to respect its public rate limits.${retry}`,
      lastCheckedAt: now,
      updatedAt: now,
    }).where(and(eq(monitoredProducts.id, id), eq(monitoredProducts.ownerEmail, ownerEmail))).returning();
    return Response.json({ product: updated });
  }
  await db.update(monitoredProducts).set({ status: "searching", statusMessage: "Searching public pages…", updatedAt: new Date().toISOString() }).where(eq(monitoredProducts.id, id));
  const profiles = await db.select().from(customSearchProfiles).where(eq(customSearchProfiles.enabled, true));
  const result = await searchPublicWebsite(product.websiteUrl, product.productName, product.ean, profiles, product.matchedUrl, {
    sitemapCache: createSitemapProductCache(),
    reserveRequest: () => reserveScraperDomain(hostname),
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
  });
  const now = new Date().toISOString();
  const [updated] = await db.update(monitoredProducts).set({
    status: result.status, statusMessage: result.message, matchedUrl: result.matchedUrl ?? null, resultTitle: result.title ?? null,
    priceCents: result.priceCents ?? null, currency: result.currency ?? null, inStock: result.inStock ?? null,
    matchType: result.matchType ?? null,
    confidence: result.confidence ?? null,
    evidenceJson: result.evidence ? JSON.stringify(result.evidence) : null,
    pageEtag: result.pageEtag ?? null,
    pageLastModified: result.pageLastModified ?? null,
    lastHttpStatus: result.httpStatus ?? null,
    lastCheckedAt: now, updatedAt: now,
  }).where(and(eq(monitoredProducts.id, id), eq(monitoredProducts.ownerEmail, ownerEmail))).returning();
  await recordScraperDomainOutcome({ hostname, status: result.status, evidence: result.evidence });
  return Response.json({ product: updated });
}
