import { desc, eq } from "drizzle-orm";
import { ensureProductsSchema, getDb } from "../../../db";
import { monitoredProducts } from "../../../db/schema";
import { getCurrentUserEmail } from "../../../lib/current-user";
import { ProductInput, validateProductInput } from "../../../lib/product-input";

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
    const [product] = await getDb().insert(monitoredProducts).values({
      id: crypto.randomUUID(), ownerEmail, websiteUrl: input.websiteUrl, productName: input.productName, ean: input.ean,
      sku: input.sku ?? "", notes: input.notes ?? "", status: "queued", statusMessage: "Ready to search",
    }).onConflictDoUpdate({
      target: [monitoredProducts.ownerEmail, monitoredProducts.websiteUrl, monitoredProducts.ean],
      set: { productName: input.productName, sku: input.sku ?? "", notes: input.notes ?? "", status: "queued", statusMessage: "Ready to search", updatedAt: new Date().toISOString() },
    }).returning();
    return Response.json({ product }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Product could not be added." }, { status: 400 });
  }
}
