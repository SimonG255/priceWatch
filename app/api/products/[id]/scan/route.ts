import { and, eq } from "drizzle-orm";
import { ensureProductsSchema, getDb } from "../../../../../db";
import { customSearchProfiles, monitoredProducts } from "../../../../../db/schema";
import { getCurrentUserEmail } from "../../../../../lib/current-user";
import { searchPublicWebsite } from "../../../../../lib/product-search";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ownerEmail = await getCurrentUserEmail();
  if (!ownerEmail) return Response.json({ error: "Sign in to search products." }, { status: 401 });
  await ensureProductsSchema();
  const { id } = await params;
  const db = getDb();
  const [product] = await db.select().from(monitoredProducts).where(and(eq(monitoredProducts.id, id), eq(monitoredProducts.ownerEmail, ownerEmail))).limit(1);
  if (!product) return Response.json({ error: "Product not found." }, { status: 404 });
  await db.update(monitoredProducts).set({ status: "searching", statusMessage: "Searching public pages…", updatedAt: new Date().toISOString() }).where(eq(monitoredProducts.id, id));
  const profiles = await db.select().from(customSearchProfiles).where(eq(customSearchProfiles.enabled, true));
  const result = await searchPublicWebsite(product.websiteUrl, product.productName, product.ean, profiles, product.matchedUrl);
  const now = new Date().toISOString();
  const [updated] = await db.update(monitoredProducts).set({
    status: result.status, statusMessage: result.message, matchedUrl: result.matchedUrl ?? null, resultTitle: result.title ?? null,
    priceCents: result.priceCents ?? null, currency: result.currency ?? null, inStock: result.inStock ?? null,
    matchType: result.matchType ?? null, lastCheckedAt: now, updatedAt: now,
  }).where(and(eq(monitoredProducts.id, id), eq(monitoredProducts.ownerEmail, ownerEmail))).returning();
  return Response.json({ product: updated });
}
