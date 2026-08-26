import { and, eq } from "drizzle-orm";
import { ensureProductsSchema, getDb } from "../../../../db";
import { monitoredProducts, monitoredWebsites } from "../../../../db/schema";
import { getCurrentUserEmail } from "../../../../lib/current-user";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ownerEmail = await getCurrentUserEmail();
  if (!ownerEmail) return Response.json({ error: "Sign in to remove websites." }, { status: 401 });
  await ensureProductsSchema();
  const { id } = await params;
  const db = getDb();
  const [website] = await db.select().from(monitoredWebsites).where(and(
    eq(monitoredWebsites.id, id), eq(monitoredWebsites.ownerEmail, ownerEmail),
  )).limit(1);
  if (!website) return Response.json({ error: "Website not found." }, { status: 404 });
  const [product] = await db.select({ id: monitoredProducts.id }).from(monitoredProducts).where(and(
    eq(monitoredProducts.ownerEmail, ownerEmail), eq(monitoredProducts.websiteUrl, website.url),
  )).limit(1);
  if (product) return Response.json({ error: "Remove this website's monitored products before removing the website." }, { status: 409 });
  await db.delete(monitoredWebsites).where(and(eq(monitoredWebsites.id, id), eq(monitoredWebsites.ownerEmail, ownerEmail)));
  return Response.json({ ok: true });
}
