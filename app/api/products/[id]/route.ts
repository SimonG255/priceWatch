import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { ensureProductsSchema, getDb } from "../../../../db";
import { monitoredProducts } from "../../../../db/schema";
import { getCurrentUserEmail } from "../../../../lib/current-user";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ownerEmail = await getCurrentUserEmail();
  if (!ownerEmail) return Response.json({ error: "Sign in to remove products." }, { status: 401 });
  await ensureProductsSchema();
  const { id } = await params;
  const db = getDb();
  const [product] = await db.select({ id: monitoredProducts.id }).from(monitoredProducts).where(and(eq(monitoredProducts.id, id), eq(monitoredProducts.ownerEmail, ownerEmail))).limit(1);
  if (!product) return Response.json({ error: "Product not found." }, { status: 404 });
  await env.DB.batch([
    env.DB.prepare("DELETE FROM scrape_attempts WHERE owner_email = ? AND run_id IN (SELECT id FROM scrape_runs WHERE product_id = ? AND owner_email = ?)").bind(ownerEmail, id, ownerEmail),
    env.DB.prepare("DELETE FROM price_snapshots WHERE product_id = ? AND owner_email = ?").bind(id, ownerEmail),
    env.DB.prepare("DELETE FROM scrape_runs WHERE product_id = ? AND owner_email = ?").bind(id, ownerEmail),
    env.DB.prepare("DELETE FROM monitored_products WHERE id = ? AND owner_email = ?").bind(id, ownerEmail),
  ]);
  return Response.json({ ok: true });
}
