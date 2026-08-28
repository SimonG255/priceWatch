import { and, asc, desc, eq } from "drizzle-orm";
import { ensureProductsSchema, getDb } from "../../../../../db";
import { monitoredProducts, scrapeAttempts, scrapeRuns } from "../../../../../db/schema";
import { getCurrentUserEmail } from "../../../../../lib/current-user";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ownerEmail = await getCurrentUserEmail();
  if (!ownerEmail) return Response.json({ error: "Sign in to view scan details." }, { status: 401 });
  await ensureProductsSchema();
  const { id } = await params;
  const limit = Math.max(1, Math.min(20, Number(new URL(request.url).searchParams.get("limit")) || 5));
  const db = getDb();
  const [product] = await db.select({ id: monitoredProducts.id }).from(monitoredProducts).where(and(eq(monitoredProducts.id, id), eq(monitoredProducts.ownerEmail, ownerEmail))).limit(1);
  if (!product) return Response.json({ error: "Product not found." }, { status: 404 });
  const runs = await db.select().from(scrapeRuns).where(and(eq(scrapeRuns.productId, id), eq(scrapeRuns.ownerEmail, ownerEmail))).orderBy(desc(scrapeRuns.startedAt)).limit(limit);
  const attempts = runs.length
    ? await db.select().from(scrapeAttempts).where(and(eq(scrapeAttempts.ownerEmail, ownerEmail), eq(scrapeAttempts.runId, runs[0].id))).orderBy(asc(scrapeAttempts.ordinal))
    : [];
  return Response.json({ runs, latest: runs[0] ?? null, attempts }, { headers: { "Cache-Control": "no-store" } });
}
