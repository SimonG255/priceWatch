import { and, asc, avg, count, desc, eq, lt, max, min, or } from "drizzle-orm";
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
  const cursor = parseCursor(url.searchParams.get("cursor"));
  const db = getDb();
  const [product] = await db
    .select({ id: monitoredProducts.id, productName: monitoredProducts.productName, ean: monitoredProducts.ean })
    .from(monitoredProducts)
    .where(and(eq(monitoredProducts.id, id), eq(monitoredProducts.ownerEmail, ownerEmail)))
    .limit(1);
  if (!product) return Response.json({ error: "Product not found." }, { status: 404 });
  const baseFilters = [eq(priceSnapshots.ownerEmail, ownerEmail), eq(priceSnapshots.productId, id)];
  const filters = [...baseFilters];
  if (cursor)
    filters.push(
      or(
        lt(priceSnapshots.capturedAt, cursor.capturedAt),
        and(eq(priceSnapshots.capturedAt, cursor.capturedAt), lt(priceSnapshots.id, cursor.id)),
      )!,
    );
  const snapshots = await db
    .select()
    .from(priceSnapshots)
    .where(and(...filters))
    .orderBy(desc(priceSnapshots.capturedAt), desc(priceSnapshots.id))
    .limit(limit + 1);
  const page = snapshots.slice(0, limit);
  const aggregates: Array<{
    currency: string;
    minPriceCents: number | null;
    maxPriceCents: number | null;
    averagePriceCents: number | string | null;
    observations: number;
  }> = (await db
    .select({
    currency: priceSnapshots.currency,
    minPriceCents: min(priceSnapshots.priceCents),
    maxPriceCents: max(priceSnapshots.priceCents),
    averagePriceCents: avg(priceSnapshots.priceCents),
    observations: count(),
    })
    .from(priceSnapshots)
    .where(and(...baseFilters))
    .groupBy(priceSnapshots.currency)) as Array<{
    currency: string;
    minPriceCents: number | null;
    maxPriceCents: number | null;
    averagePriceCents: number | string | null;
    observations: number;
  }>;
  const summaryByCurrency = await Promise.all(
    aggregates.map(
      async (aggregate: {
        currency: string;
        minPriceCents: number | null;
        maxPriceCents: number | null;
        averagePriceCents: number | string | null;
        observations: number;
      }) => {
        const currency = aggregate.currency;
        const currencyFilter = and(...baseFilters, eq(priceSnapshots.currency, currency));
      const [[latest], [oldest]] = await Promise.all([
        db
            .select({ priceCents: priceSnapshots.priceCents, capturedAt: priceSnapshots.capturedAt })
            .from(priceSnapshots)
            .where(currencyFilter)
            .orderBy(desc(priceSnapshots.capturedAt), desc(priceSnapshots.id))
            .limit(1),
          db
            .select({ priceCents: priceSnapshots.priceCents })
            .from(priceSnapshots)
            .where(currencyFilter)
            .orderBy(asc(priceSnapshots.capturedAt), asc(priceSnapshots.id))
            .limit(1),
        ]);
        const latestPriceCents = latest?.priceCents ?? null;
        const oldestPriceCents = oldest?.priceCents ?? null;
        const changeCents =
          latestPriceCents != null && oldestPriceCents != null ? latestPriceCents - oldestPriceCents : null;
        return {
          ...aggregate,
          averagePriceCents: aggregate.averagePriceCents == null ? null : Math.round(Number(aggregate.averagePriceCents)),
          latestPriceCents,
          latestCapturedAt: latest?.capturedAt ?? null,
          changeCents,
          changePercent:
            changeCents != null && oldestPriceCents
              ? Math.round((changeCents / oldestPriceCents) * 10_000) / 100
              : null,
        };
      },
    ),
  );
  const summary =
    summaryByCurrency.length === 1
      ? summaryByCurrency[0]
      : {
          minPriceCents: null,
          maxPriceCents: null,
          latestPriceCents: null,
          averagePriceCents: null,
          latestCapturedAt: null,
          changeCents: null,
          changePercent: null,
          observations: summaryByCurrency.reduce((total, item) => total + item.observations, 0),
        };
  return Response.json(
    {
      product,
      snapshots: page.map(
        (snapshot: {
          id: string;
          capturedAt: string;
          priceCents: number;
          currency: string;
          inStock: boolean | null;
          matchedUrl: string;
          priceSource: string | null;
          exactEan: boolean;
          nameSimilarityBps: number;
          priceConfidence: number;
          sourceConfidence: number;
          overallConfidence: number;
        }) => ({
          id: snapshot.id,
          capturedAt: snapshot.capturedAt,
          priceCents: snapshot.priceCents,
          currency: snapshot.currency,
          inStock: snapshot.inStock,
          matchedUrl: snapshot.matchedUrl,
          priceSource: snapshot.priceSource,
          confidenceScores: {
            ean: snapshot.exactEan ? 100 : 0,
            name: Math.round(snapshot.nameSimilarityBps / 100),
            price: snapshot.priceConfidence,
            source: snapshot.sourceConfidence,
            overall: snapshot.overallConfidence,
          },
        }),
      ),
      summary,
      summaryByCurrency,
      nextCursor: snapshots.length > limit && page.length ? encodeCursor(page.at(-1)!) : null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

function encodeCursor(snapshot: { capturedAt: string; id: string }) {
  return `${encodeURIComponent(snapshot.capturedAt)}~${encodeURIComponent(snapshot.id)}`;
}

function parseCursor(value: string | null) {
  if (!value) return undefined;
  const separator = value.indexOf("~");
  if (separator < 1) return undefined;
  try {
    const capturedAt = decodeURIComponent(value.slice(0, separator));
    const id = decodeURIComponent(value.slice(separator + 1));
    return id && !Number.isNaN(Date.parse(capturedAt)) ? { capturedAt, id } : undefined;
  } catch {
    return undefined;
  }
}
