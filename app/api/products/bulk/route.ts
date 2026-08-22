import { ensureProductsSchema, getDb } from "../../../../db";
import { monitoredProducts, monitoredWebsites } from "../../../../db/schema";
import { getCurrentUserEmail } from "../../../../lib/current-user";
import { eq } from "drizzle-orm";
import { normalizeEan, validateProductInput } from "../../../../lib/product-input";

export async function POST(request: Request) {
  const ownerEmail = await getCurrentUserEmail();
  if (!ownerEmail) return Response.json({ error: "Sign in to import products." }, { status: 401 });
  try {
    await ensureProductsSchema();
    const body = (await request.json()) as { products?: { productName?: string; ean?: string; sku?: string; notes?: string }[] };
    if (!Array.isArray(body.products) || body.products.length === 0) throw new Error("The workbook did not contain any product rows.");
    if (body.products.length > 250) throw new Error("Import up to 250 products at a time.");
    const db = getDb();
    const websites = await db.select().from(monitoredWebsites).where(eq(monitoredWebsites.ownerEmail, ownerEmail));
    if (!websites.length) throw new Error("Add at least one website before importing products.");
    const sourceProducts = body.products.map(item => ({
      productName: item.productName?.trim() ?? "", ean: normalizeEan(item.ean ?? ""), sku: item.sku, notes: item.notes,
    }));
    const inputs = sourceProducts.flatMap(item => websites.map(website => validateProductInput({ ...item, websiteUrl: website.url })));
    if (inputs.length > 250) throw new Error(`This import creates ${inputs.length} product searches across ${websites.length} websites. Import up to 250 searches at a time.`);
    const products = [];
    for (const input of inputs) {
      const [product] = await db.insert(monitoredProducts).values({
        id: crypto.randomUUID(), ownerEmail, websiteUrl: input.websiteUrl, productName: input.productName, ean: input.ean,
        sku: input.sku ?? "", notes: input.notes ?? "", status: "queued", statusMessage: "Imported — ready to search",
      }).onConflictDoUpdate({
        target: [monitoredProducts.ownerEmail, monitoredProducts.websiteUrl, monitoredProducts.ean],
        set: { productName: input.productName, sku: input.sku ?? "", notes: input.notes ?? "", status: "queued", statusMessage: "Imported — ready to search", updatedAt: new Date().toISOString() },
      }).returning();
      products.push(product);
    }
    return Response.json({ products }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Products could not be imported." }, { status: 400 });
  }
}
