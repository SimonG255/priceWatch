import { eq } from "drizzle-orm";
import { ensureProductsSchema, getDb } from "../../../../db";
import { monitoredProducts, monitoredWebsites } from "../../../../db/schema";
import { prepareBulkProductSearches } from "../../../../lib/bulk-product-input";
import { getCurrentUserEmail } from "../../../../lib/current-user";

export async function POST(request: Request) {
  const ownerEmail = await getCurrentUserEmail();
  if (!ownerEmail) return Response.json({ error: "Sign in to add products." }, { status: 401 });
  try {
    await ensureProductsSchema();
    const body = (await request.json()) as { products?: unknown; websiteIds?: unknown };
    const db = getDb();
    const availableWebsites = await db.select().from(monitoredWebsites).where(eq(monitoredWebsites.ownerEmail, ownerEmail));
    const requestedIds = normalizeRequestedWebsiteIds(body.websiteIds);
    const websiteById = new Map(availableWebsites.map((website) => [website.id, website]));
    const websites = requestedIds == null ? availableWebsites : requestedIds.map((id) => websiteById.get(id));
    if (websites.some((website) => !website)) {
      throw new Error("One or more selected websites are unavailable. Refresh the page and choose again.");
    }
    const prepared = prepareBulkProductSearches(body.products, websites.filter((website) => website != null));
    const products = [];
    for (const input of prepared.inputs) {
      const [product] = await db.insert(monitoredProducts).values({
        id: crypto.randomUUID(), ownerEmail, websiteUrl: input.websiteUrl, productName: input.productName, ean: input.ean,
        sku: input.sku ?? "", notes: input.notes ?? "", status: "queued", statusMessage: "Ready for bulk search",
      }).onConflictDoUpdate({
        target: [monitoredProducts.ownerEmail, monitoredProducts.websiteUrl, monitoredProducts.ean],
        set: { productName: input.productName, sku: input.sku ?? "", notes: input.notes ?? "", status: "queued", statusMessage: "Ready for bulk search", updatedAt: new Date().toISOString() },
      }).returning();
      products.push(product);
    }
    return Response.json({ products, productCount: prepared.productCount, websiteCount: prepared.websiteCount, searchCount: prepared.inputs.length }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Products could not be added." }, { status: 400 });
  }
}

function normalizeRequestedWebsiteIds(value: unknown): string[] | null {
  if (value == null) return null;
  if (!Array.isArray(value) || value.length === 0) throw new Error("Select at least one website.");
  if (value.some((id) => typeof id !== "string" || !id.trim())) throw new Error("The website selection is invalid.");
  return [...new Set(value.map((id) => (id as string).trim()))];
}
