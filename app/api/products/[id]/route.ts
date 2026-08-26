import { and, eq, inArray } from "drizzle-orm";
import { ensureProductsSchema, getDb } from "../../../../db";
import {
  customerAlertEvents,
  monitoredProducts,
  priceSnapshots,
  scrapeAttempts,
  scrapeRuns,
} from "../../../../db/schema";
import { getCurrentUserEmail } from "../../../../lib/current-user";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ownerEmail = await getCurrentUserEmail();
  if (!ownerEmail) return Response.json({ error: "Sign in to remove products." }, { status: 401 });
  await ensureProductsSchema();
  const { id } = await params;
  const db = getDb();
  const [product] = await db
    .select({ id: monitoredProducts.id })
    .from(monitoredProducts)
    .where(and(eq(monitoredProducts.id, id), eq(monitoredProducts.ownerEmail, ownerEmail)))
    .limit(1);
  if (!product) return Response.json({ error: "Product not found." }, { status: 404 });
  const ownedRunIds = db
    .select({ id: scrapeRuns.id })
    .from(scrapeRuns)
    .where(and(eq(scrapeRuns.productId, id), eq(scrapeRuns.ownerEmail, ownerEmail)));
  await Promise.all([
    db
      .delete(scrapeAttempts)
      .where(and(eq(scrapeAttempts.ownerEmail, ownerEmail), inArray(scrapeAttempts.runId, ownedRunIds))),
    db
      .delete(customerAlertEvents)
      .where(and(eq(customerAlertEvents.productId, id), eq(customerAlertEvents.ownerEmail, ownerEmail))),
    db.delete(priceSnapshots).where(and(eq(priceSnapshots.productId, id), eq(priceSnapshots.ownerEmail, ownerEmail))),
    db.delete(scrapeRuns).where(and(eq(scrapeRuns.productId, id), eq(scrapeRuns.ownerEmail, ownerEmail))),
    db.delete(monitoredProducts).where(and(eq(monitoredProducts.id, id), eq(monitoredProducts.ownerEmail, ownerEmail))),
  ]);
  return Response.json({ ok: true });
}
