import { eq } from "drizzle-orm";
import { ensureProductsSchema, getDb } from "../../../../db";
import { monitoredProducts, monitoredWebsites } from "../../../../db/schema";
import { prepareBulkProductSearches } from "../../../../lib/bulk-product-input";
import { getCurrentUserEmail } from "../../../../lib/current-user";
import { assertProductCapacity, ensureDefaultSchedule } from "../../../../lib/plans";

export async function POST(request: Request) {
  const ownerEmail = await getCurrentUserEmail();
  if (!ownerEmail) return Response.json({ error: "Sign in to add products." }, { status: 401 });
  try {
    await ensureProductsSchema();
    const body = (await request.json()) as { products?: unknown; websiteIds?: unknown };
    const db = getDb();
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

function normalizeRequestedWebsiteIds(value: unknown): string[] | null {
  if (value == null) return null;
  if (!Array.isArray(value) || value.length === 0) throw new Error("Select at least one website.");
  if (value.some((id) => typeof id !== "string" || !id.trim())) throw new Error("The website selection is invalid.");
  return [...new Set(value.map((id) => (id as string).trim()))];
}
