import postgres from "postgres";
import { searchPublicWebsite } from "../lib/product-search.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not configured.");

const db = postgres(connectionString, {
  max: 1,
  prepare: false,
  connect_timeout: 8,
  idle_timeout: 5,
  ssl: "require",
});

let product: { website_url: string; product_name: string; ean: string } | undefined;
try {
  const rows = await db.unsafe<Array<{ website_url: string; product_name: string; ean: string }>>(`
    SELECT website_url, product_name, ean
    FROM monitored_products
    WHERE hostname = 'bigbang.si'
      AND product_name = 'GORENJE NRK6192AXL4'
    ORDER BY created_at DESC
    LIMIT 1
  `);
  product = rows[0];
} finally {
  await db.end({ timeout: 2 });
}

if (!product) throw new Error("The Big Bang test product was not found in the database.");
console.log(JSON.stringify({ test: product }, null, 2));

const result = await searchPublicWebsite(
  product.website_url,
  product.product_name,
  product.ean,
  [],
  undefined,
  { respectRobots: true },
);

console.log(JSON.stringify({
  status: result.status,
  reasonCode: result.reasonCode,
  message: result.message,
  matchedUrl: result.matchedUrl,
  title: result.title,
  priceCents: result.priceCents,
  currency: result.currency,
  httpStatus: result.httpStatus,
  attempts: result.attempts?.map((attempt) => ({
    url: attempt.url,
    outcome: attempt.outcome,
    reasonCode: attempt.reasonCode,
    httpStatus: attempt.httpStatus,
    message: attempt.message,
  })),
}, null, 2));
