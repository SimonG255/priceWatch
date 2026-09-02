import { and, asc, eq, inArray } from "drizzle-orm";
import { ensureProductsSchema, getDb } from "../../../db";
import { monitoredProducts, monitoredWebsites } from "../../../db/schema";
import { getCurrentUserEmail } from "../../../lib/current-user";
import { validateWebsiteUrl } from "../../../lib/product-input";

export async function GET() {
  const ownerEmail = await getCurrentUserEmail();
  if (!ownerEmail) return Response.json({ error: "Sign in to view your websites." }, { status: 401 });
  await ensureProductsSchema();
  const db = getDb();
  const websites = await db.select().from(monitoredWebsites).where(eq(monitoredWebsites.ownerEmail, ownerEmail)).orderBy(asc(monitoredWebsites.createdAt));
  return Response.json({ websites });
}

export async function POST(request: Request) {
  const ownerEmail = await getCurrentUserEmail();
  if (!ownerEmail) return Response.json({ error: "Sign in to add websites." }, { status: 401 });
  try {
    await ensureProductsSchema();
    const { url: rawUrl } = await request.json() as { url?: string };
    const url = validateWebsiteUrl(rawUrl ?? "");
    const [website] = await getDb().insert(monitoredWebsites).values({ id: crypto.randomUUID(), ownerEmail, url }).onConflictDoUpdate({
      target: [monitoredWebsites.ownerEmail, monitoredWebsites.url], set: { url },
    }).returning();
    return Response.json({ website }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Website could not be added." }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const ownerEmail = await getCurrentUserEmail();
  if (!ownerEmail) return Response.json({ error: "Sign in to remove websites." }, { status: 401 });

  try {
    await ensureProductsSchema();
    const body = await request.json() as { websiteIds?: unknown };
    const websiteIds = normalizeWebsiteIds(body.websiteIds);
    const db = getDb();
    const selectedWebsites = await db.select({ id: monitoredWebsites.id, url: monitoredWebsites.url })
      .from(monitoredWebsites)
      .where(and(eq(monitoredWebsites.ownerEmail, ownerEmail), inArray(monitoredWebsites.id, websiteIds)));
    const selectedUrls = selectedWebsites.map((website) => website.url);
    const usedUrls = selectedUrls.length
      ? new Set((await db.select({ websiteUrl: monitoredProducts.websiteUrl })
        .from(monitoredProducts)
        .where(and(eq(monitoredProducts.ownerEmail, ownerEmail), inArray(monitoredProducts.websiteUrl, selectedUrls))))
        .map((product) => product.websiteUrl))
      : new Set<string>();
    const deletedIds = selectedWebsites.filter((website) => !usedUrls.has(website.url)).map((website) => website.id);
    const blockedIds = selectedWebsites.filter((website) => usedUrls.has(website.url)).map((website) => website.id);

    if (deletedIds.length) {
      await db.delete(monitoredWebsites).where(and(
        eq(monitoredWebsites.ownerEmail, ownerEmail), inArray(monitoredWebsites.id, deletedIds),
      ));
    }

    return Response.json({ ok: true, deletedIds, blockedIds });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Websites could not be removed." }, { status: 400 });
  }
}

function normalizeWebsiteIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error("Select at least one website to remove.");
  if (value.length > 500) throw new Error("Remove up to 500 websites at a time.");
  if (value.some((id) => typeof id !== "string" || !id.trim())) throw new Error("The website selection is invalid.");
  return [...new Set(value.map((id) => (id as string).trim()))];
}
