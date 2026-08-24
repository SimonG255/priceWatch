import { and, desc, eq, lt } from "drizzle-orm";
import { ensureProductsSchema, getDb } from "../../../../../db";
import { monitoredProducts, priceSnapshots } from "../../../../../db/schema";
import { getCurrentUserEmail } from "../../../../../lib/current-user";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ownerEmail = await getCurrentUserEmail();
  if (!ownerEmail) return Response.json({ error: "Sign in to view price history." }, { status: 401 });
  await ensureProductsSchema();
  const { id } = await params;
  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(250, Number(url.searchParams.get("limit")) || 100));
  const cursor = url.searchParams.get("cursor");
  const db = getDb();
  const [product] = await db.select({ id: monitoredProducts.id, productName: monitoredProducts.productName, ean: monitoredProducts.ean }).from(monitoredProducts).where(and(
    eq(monitoredProducts.id, id), eq(monitoredProducts.ownerEmail, ownerEmail),
  )).limit(1);
  if (!product) return Response.json({ error: "Product not found." }, { status: 404 });
  const filters = [eq(priceSnapshots.ownerEmail, ownerEmail), eq(priceSnapshots.productId, id)];
  if (cursor && !Number.isNaN(Date.parse(cursor))) filters.push(lt(priceSnapshots.capturedAt, cursor));
  const snapshots = await db.select().from(priceSnapshots).where(and(...filters)).orderBy(desc(priceSnapshots.capturedAt)).limit(limit + 1);
  const page = snapshots.slice(0, limit);
  const prices = page.map((item) => item.priceCents);
  const latest = page[0]?.priceCents ?? null;
  const oldest = page.at(-1)?.priceCents ?? null;
  const changeCents = latest != null && oldest != null ? latest - oldest : null;
  return Response.json({
    product,
    snapshots: page.map((snapshot) => ({
      id: snapshot.id, capturedAt: snapshot.capturedAt, priceCents: snapshot.priceCents,
      currency: snapshot.currency, inStock: snapshot.inStock, matchedUrl: snapshot.matchedUrl,
      priceSource: snapshot.priceSource,
      confidenceScores: {
        ean: snapshot.exactEan ? 100 : 0,
        name: Math.round(snapshot.nameSimilarityBps / 100),
        price: snapshot.priceConfidence,
        source: snapshot.sourceConfidence,
        overall: snapshot.overallConfidence,
      },
    })),
    summary: {
      minPriceCents: prices.length ? Math.min(...prices) : null,
      maxPriceCents: prices.length ? Math.max(...prices) : null,
      latestPriceCents: latest,
      changeCents,
      changePercent: changeCents != null && oldest ? Math.round(changeCents / oldest * 10_000) / 100 : null,
      observations: page.length,
    },
    nextCursor: snapshots.length > limit ? page.at(-1)?.capturedAt ?? null : null,
  }, { headers: { "Cache-Control": "no-store" } });
}
