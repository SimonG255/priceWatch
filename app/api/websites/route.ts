import { asc, eq } from "drizzle-orm";
import { ensureProductsSchema, getDb } from "../../../db";
import { monitoredWebsites } from "../../../db/schema";
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
