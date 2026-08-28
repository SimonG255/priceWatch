import { and, eq, inArray } from "drizzle-orm";
import { ensureProductsSchema, getDb } from "../../../../db";
import { customerAlertEvents, monitoredProducts, monitoredWebsites, priceSnapshots, scrapeAttempts, scrapeRuns } from "../../../../db/schema";
import { prepareBulkProductSearches } from "../../../../lib/bulk-product-input";
import { getCurrentUserEmail } from "../../../../lib/current-user";
import { assertProductCapacity, ensureDefaultSchedule } from "../../../../lib/plans";

export async function POST(request: Request) {
  const ownerEmail = await getCurrentUserEmail();
  if (!ownerEmail) return Response.json({ error: "Sign in to add products." }, { status: 401 });
  try {
    await ensureProductsSchema();
    const body = (await request.json()) as { products?: unknown; websiteIds?: unknown; action?: unknown; productIds?: unknown };
    const db = getDb();
    if (typeof body.action === "string" && body.action) {
      return Response.json(await applyBulkAction(body.action, body.productIds, ownerEmail), { status: 200 });
    }
    const availableWebsites: Array<{ id: string; url: string }> = await db
      .select()
      .from(monitoredWebsites)
      .where(eq(monitoredWebsites.ownerEmail, ownerEmail));
    const requestedIds = normalizeRequestedWebsiteIds(body.websiteIds);
    const websiteById = new Map(availableWebsites.map((website: { id: string; url: string }) => [website.id, website]));
    const websites: Array<{ id: string; url: string } | undefined> =
      requestedIds == null ? availableWebsites : requestedIds.map((id: string) => websiteById.get(id));
    if (websites.some((website: { id: string; url: string } | undefined) => !website)) {
      throw new Error("One or more selected websites are unavailable. Refresh the page and choose again.");
    }
    const prepared = prepareBulkProductSearches(
      body.products,
      websites.filter((website): website is { id: string; url: string } => website != null),
    );
    const existingProducts = await db.select({ websiteUrl: monitoredProducts.websiteUrl, ean: monitoredProducts.ean })
      .from(monitoredProducts).where(eq(monitoredProducts.ownerEmail, ownerEmail));
    const existingKeys = new Set(existingProducts.map((product) => `${product.websiteUrl}\u0000${product.ean}`));
    const additionalProducts = prepared.inputs.filter((input) => !existingKeys.has(`${input.websiteUrl}\u0000${input.ean}`)).length;
    const plan = await assertProductCapacity(ownerEmail, additionalProducts);
    const products = [];
    for (const input of prepared.inputs) {
      const hostname = new URL(input.websiteUrl).hostname.toLowerCase().replace(/^www\./, "");
      const [product] = await db
        .insert(monitoredProducts)
        .values({
          id: crypto.randomUUID(),
          ownerEmail,
          websiteUrl: input.websiteUrl,
          hostname,
          productName: input.productName,
          ean: input.ean,
          sku: input.sku ?? "",
          notes: input.notes ?? "",
          ownPriceCents: input.ownPriceCents,
          alertOnPriceDrop: input.alertOnPriceDrop,
          alertOnRestock: input.alertOnRestock,
          alertTargetPriceCents: input.alertTargetPriceCents ?? null,
          alertDropPercentBps: input.alertDropPercentBps ?? null,
          monitoringEnabled: input.monitoringEnabled ?? true,
          status: "queued",
          statusMessage: "Ready for bulk search",
        })
        .onConflictDoUpdate({
          target: [monitoredProducts.ownerEmail, monitoredProducts.websiteUrl, monitoredProducts.ean],
          set: {
            hostname,
            productName: input.productName,
            sku: input.sku ?? "",
            notes: input.notes ?? "",
            ownPriceCents: input.ownPriceCents,
            alertOnPriceDrop: input.alertOnPriceDrop,
            alertOnRestock: input.alertOnRestock,
            alertTargetPriceCents: input.alertTargetPriceCents ?? null,
            alertDropPercentBps: input.alertDropPercentBps ?? null,
            monitoringEnabled: input.monitoringEnabled ?? true,
            status: "queued",
            statusMessage: "Ready for bulk search",
            updatedAt: new Date().toISOString(),
          },
        })
        .returning();
      products.push(product);
    }
    await ensureDefaultSchedule(ownerEmail, plan);
    return Response.json(
      {
        products,
        productCount: prepared.productCount,
        websiteCount: prepared.websiteCount,
        searchCount: prepared.inputs.length,
      },
      { status: 201 },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Products could not be added." },
      { status: 400 },
    );
  }
}

async function applyBulkAction(action: string, value: unknown, ownerEmail: string) {
  const productIds = normalizeRequestedProductIds(value);
  const db = getDb();
  const ownedProducts = await db.select().from(monitoredProducts).where(and(eq(monitoredProducts.ownerEmail, ownerEmail), inArray(monitoredProducts.id, productIds)));
  if (ownedProducts.length !== productIds.length) throw new Error("One or more selected products are unavailable. Refresh the page and choose again.");
  const now = new Date().toISOString();
  if (action === "rescan") {
    const products = await db.update(monitoredProducts).set({ status: "queued", statusMessage: "Queued for rescan", updatedAt: now }).where(and(eq(monitoredProducts.ownerEmail, ownerEmail), inArray(monitoredProducts.id, productIds))).returning();
    return { action, products };
  }
  if (action === "pause" || action === "resume") {
    const monitoringEnabled = action === "resume";
    const products = await db.update(monitoredProducts).set({ monitoringEnabled, updatedAt: now }).where(and(eq(monitoredProducts.ownerEmail, ownerEmail), inArray(monitoredProducts.id, productIds))).returning();
    return { action, products };
  }
  if (action !== "delete") throw new Error("Unsupported bulk action.");
  await db.transaction(async (transaction) => {
    const ownedRunIds = transaction.select({ id: scrapeRuns.id }).from(scrapeRuns).where(and(eq(scrapeRuns.ownerEmail, ownerEmail), inArray(scrapeRuns.productId, productIds)));
    await transaction.delete(scrapeAttempts).where(and(eq(scrapeAttempts.ownerEmail, ownerEmail), inArray(scrapeAttempts.runId, ownedRunIds)));
    await transaction.delete(customerAlertEvents).where(and(eq(customerAlertEvents.ownerEmail, ownerEmail), inArray(customerAlertEvents.productId, productIds)));
    await transaction.delete(priceSnapshots).where(and(eq(priceSnapshots.ownerEmail, ownerEmail), inArray(priceSnapshots.productId, productIds)));
    await transaction.delete(scrapeRuns).where(and(eq(scrapeRuns.ownerEmail, ownerEmail), inArray(scrapeRuns.productId, productIds)));
    await transaction.delete(monitoredProducts).where(and(eq(monitoredProducts.ownerEmail, ownerEmail), inArray(monitoredProducts.id, productIds)));
  });
  return { action, deletedIds: productIds };
}

function normalizeRequestedWebsiteIds(value: unknown): string[] | null {
  if (value == null) return null;
  if (!Array.isArray(value) || value.length === 0) throw new Error("Select at least one website.");
  if (value.some((id) => typeof id !== "string" || !id.trim())) throw new Error("The website selection is invalid.");
  return [...new Set(value.map((id) => (id as string).trim()))];
}

function normalizeRequestedProductIds(value: unknown) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 500 || value.some((id) => typeof id !== "string" || !id.trim()))
    throw new Error("Select between 1 and 500 products.");
  return [...new Set(value.map((id) => (id as string).trim()))];
}
