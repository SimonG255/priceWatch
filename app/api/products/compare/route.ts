import { and, desc, eq, isNotNull } from "drizzle-orm";
import { ensureProductsSchema, getDb } from "../../../../db";
import { monitoredProducts } from "../../../../db/schema";
import { getCurrentUserEmail } from "../../../../lib/current-user";

export async function GET(request: Request) {
  const ownerEmail = await getCurrentUserEmail();
  if (!ownerEmail) return Response.json({ error: "Sign in to compare products." }, { status: 401 });
  await ensureProductsSchema();
  const requestedEan = new URL(request.url).searchParams.get("ean")?.replace(/\D/g, "");
  if (!requestedEan || ![8, 12, 13, 14].includes(requestedEan.length))
    return Response.json({ error: "Enter a valid EAN/GTIN to compare equivalent products." }, { status: 400 });
  const filters = [
    eq(monitoredProducts.ownerEmail, ownerEmail),
    eq(monitoredProducts.status, "found"),
    isNotNull(monitoredProducts.priceCents),
  ];
  filters.push(eq(monitoredProducts.ean, requestedEan));
  const products: Array<{
    id: string;
    productName: string;
    ean: string;
    websiteUrl: string;
    matchedUrl: string | null;
    priceCents: number | null;
    currency: string | null;
    inStock: boolean | null;
    lastCheckedAt: string | null;
    confidenceScoresJson: string | null;
  }> = await getDb()
    .select()
    .from(monitoredProducts)
    .where(and(...filters))
    .orderBy(desc(monitoredProducts.lastCheckedAt))
    .limit(1_000);
  const offers = products
    .map(
      (product: {
        id: string;
        productName: string;
        ean: string;
        websiteUrl: string;
        matchedUrl: string | null;
        priceCents: number | null;
        currency: string | null;
        inStock: boolean | null;
        lastCheckedAt: string | null;
        confidenceScoresJson: string | null;
      }) => ({
        productId: product.id,
        productName: product.productName,
        ean: product.ean,
        websiteUrl: product.websiteUrl,
        hostname: new URL(product.websiteUrl).hostname.toLowerCase().replace(/^www\./, ""),
        matchedUrl: product.matchedUrl,
        priceCents: product.priceCents!,
        currency: product.currency,
        inStock: product.inStock,
        lastCheckedAt: product.lastCheckedAt,
        confidenceScores: parseJson(product.confidenceScoresJson),
      }),
    )
    .sort((left, right) => stockRank(right.inStock) - stockRank(left.inStock) || left.priceCents - right.priceCents);
  const cheapestByCurrency = Object.fromEntries(
    [
      ...new Set(
        offers
          .map((offer: { currency: string | null }) => offer.currency)
          .filter((currency): currency is string => Boolean(currency)),
      ),
    ].map((currency: string) => {
      const cheapest =
        offers
          .filter(
            (offer: { currency: string | null; inStock: boolean | null; priceCents: number }) =>
              offer.currency === currency && offer.inStock === true,
          )
          .sort((a: { priceCents: number }, b: { priceCents: number }) => a.priceCents - b.priceCents)[0] ?? null;
      return [currency, cheapest];
    }),
  );
  const currencies = Object.keys(cheapestByCurrency);
  return Response.json(
    {
      ean: requestedEan,
      generatedAt: new Date().toISOString(),
      offers,
      cheapest: currencies.length === 1 ? cheapestByCurrency[currencies[0]] : null,
      cheapestByCurrency,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

function stockRank(value: boolean | null) {
  return value === true ? 2 : value == null ? 1 : 0;
}

function parseJson(value: string | null) {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}
