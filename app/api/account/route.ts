import { eq } from "drizzle-orm";
import { ensureProductsSchema, getDb } from "../../../db";
import {
  customerAlertEvents,
  monitoredProducts,
  monitoredWebsites,
  priceSnapshots,
  scrapeAttempts,
  scrapeRuns,
  scraperSchedules,
  userPlans,
} from "../../../db/schema";
import { getCurrentUserEmail } from "../../../lib/current-user";

export async function DELETE(request: Request) {
  const ownerEmail = await getCurrentUserEmail();
  if (!ownerEmail) return Response.json({ error: "Sign in to delete workspace data." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { confirm?: unknown } | null;
  if (body?.confirm !== "DELETE")
    return Response.json({ error: "Type DELETE to confirm workspace deletion." }, { status: 400 });
  await ensureProductsSchema();
  const db = getDb();
  await Promise.all([
    db.delete(scrapeAttempts).where(eq(scrapeAttempts.ownerEmail, ownerEmail)),
    db.delete(priceSnapshots).where(eq(priceSnapshots.ownerEmail, ownerEmail)),
    db.delete(customerAlertEvents).where(eq(customerAlertEvents.ownerEmail, ownerEmail)),
    db.delete(scrapeRuns).where(eq(scrapeRuns.ownerEmail, ownerEmail)),
    db.delete(scraperSchedules).where(eq(scraperSchedules.ownerEmail, ownerEmail)),
    db.delete(monitoredProducts).where(eq(monitoredProducts.ownerEmail, ownerEmail)),
    db.delete(monitoredWebsites).where(eq(monitoredWebsites.ownerEmail, ownerEmail)),
    db.delete(userPlans).where(eq(userPlans.ownerEmail, ownerEmail)),
  ]);
  return Response.json({ ok: true });
}
