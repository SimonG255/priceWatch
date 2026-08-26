import { and, desc, eq } from "drizzle-orm";
import { ensureProductsSchema, getDb } from "../../../db";
import { monitoredProducts } from "../../../db/schema";
import { getCurrentUserEmail } from "../../../lib/current-user";
import { ProductInput, validateProductInput } from "../../../lib/product-input";
import { assertProductCapacity, ensureDefaultSchedule } from "../../../lib/plans";

export async function GET() {
  const ownerEmail = await getCurrentUserEmail();
  if (!ownerEmail) return Response.json({ error: "Sign in to view your products." }, { status: 401 });
  await ensureProductsSchema();
  const products = await getDb().select().from(monitoredProducts).where(eq(monitoredProducts.ownerEmail, ownerEmail)).orderBy(desc(monitoredProducts.createdAt));
  return Response.json({ products });
}

export async function POST(request: Request) {
  const ownerEmail = await getCurrentUserEmail();
  if (!ownerEmail) return Response.json({ error: "Sign in to add products." }, { status: 401 });
  try {
    await ensureProductsSchema();
    const input = validateProductInput((await request.json()) as ProductInput);
    const hostname = new URL(input.websiteUrl).hostname.toLowerCase().replace(/^www\./, "");
    const db = getDb();
    const [existing] = await db.select({ id: monitoredProducts.id }).from(monitoredProducts).where(and(
      eq(monitoredProducts.ownerEmail, ownerEmail),
      eq(monitoredProducts.websiteUrl, input.websiteUrl),
      eq(monitoredProducts.ean, input.ean),
    )).limit(1);
    const plan = await assertProductCapacity(ownerEmail, existing ? 0 : 1);
    const [product] = await db.insert(monitoredProducts).values({
      id: crypto.randomUUID(), ownerEmail, websiteUrl: input.websiteUrl, hostname, productName: input.productName, ean: input.ean,
      sku: input.sku ?? "", notes: input.notes ?? "", ownPriceCents: input.ownPriceCents,
      alertOnPriceDrop: input.alertOnPriceDrop, alertOnRestock: input.alertOnRestock,
      status: "queued", statusMessage: "Ready to search",
    }).onConflictDoUpdate({
      target: [monitoredProducts.ownerEmail, monitoredProducts.websiteUrl, monitoredProducts.ean],
      set: { hostname, productName: input.productName, sku: input.sku ?? "", notes: input.notes ?? "", ownPriceCents: input.ownPriceCents,
        alertOnPriceDrop: input.alertOnPriceDrop, alertOnRestock: input.alertOnRestock,
        status: "queued", statusMessage: "Ready to search", updatedAt: new Date().toISOString() },
    }).returning();
    await ensureDefaultSchedule(ownerEmail, plan);
    return Response.json({ product }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Product could not be added." }, { status: 400 });
  }
}
