import { and, desc, eq, gte, lte } from "drizzle-orm";
import { ensureProductsSchema, getDb } from "../../../db";
import { monitoredProducts, priceSnapshots } from "../../../db/schema";
import { getCurrentUserEmail } from "../../../lib/current-user";

const RESOURCES = new Set(["products", "price_history", "matches"]);

export async function GET(request: Request) {
  const ownerEmail = await getCurrentUserEmail();
  if (!ownerEmail) return Response.json({ error: "Sign in to export reports." }, { status: 401 });
  await ensureProductsSchema();
  const url = new URL(request.url);
  const resource = url.searchParams.get("resource") || "products";
  const format = url.searchParams.get("format") === "csv" ? "csv" : "json";
  if (!RESOURCES.has(resource)) return Response.json({ error: "Unknown export resource." }, { status: 400 });
  const rows = resource === "price_history"
    ? await historyRows(ownerEmail, url.searchParams)
    : await productRows(ownerEmail, resource === "matches");
  const exportedAt = new Date().toISOString();
  if (format === "json") return new Response(JSON.stringify({ schemaVersion: 1, resource, exportedAt, rows }), { headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Disposition": `attachment; filename="pricewatch-${resource}-${exportedAt.slice(0, 10)}.json"`,
    "Cache-Control": "no-store",
  } });
  const csv = toCsv(rows);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="pricewatch-${resource}-${exportedAt.slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

async function productRows(ownerEmail: string, matchesOnly: boolean) {
  const conditions = [eq(monitoredProducts.ownerEmail, ownerEmail)];
  if (matchesOnly) conditions.push(eq(monitoredProducts.status, "found"));
  const products = await getDb().select().from(monitoredProducts).where(and(...conditions)).orderBy(desc(monitoredProducts.createdAt)).limit(10_000);
  return products.map((product) => ({
    website_url: product.websiteUrl, product_name: product.productName, ean: product.ean, sku: product.sku,
    status: product.status, reason_code: product.reasonCode, failure_class: product.failureClass,
    matched_url: product.matchedUrl, result_title: product.resultTitle, price: product.priceCents == null ? null : product.priceCents / 100,
    currency: product.currency, in_stock: product.inStock, confidence: product.confidence,
    confidence_scores: product.confidenceScoresJson, last_checked_at: product.lastCheckedAt,
  }));
}

async function historyRows(ownerEmail: string, params: URLSearchParams) {
  const conditions = [eq(priceSnapshots.ownerEmail, ownerEmail)];
  const productId = params.get("productId");
  const from = params.get("from");
  const to = params.get("to");
  if (productId) conditions.push(eq(priceSnapshots.productId, productId));
  if (from && !Number.isNaN(Date.parse(from))) conditions.push(gte(priceSnapshots.capturedAt, new Date(from).toISOString()));
  if (to && !Number.isNaN(Date.parse(to))) conditions.push(lte(priceSnapshots.capturedAt, new Date(to).toISOString()));
  const rows = await getDb().select().from(priceSnapshots).where(and(...conditions)).orderBy(desc(priceSnapshots.capturedAt)).limit(10_000);
  return rows.map((row) => ({
    product_id: row.productId, ean: row.ean, hostname: row.hostname, matched_url: row.matchedUrl,
    price: row.priceCents / 100, currency: row.currency, in_stock: row.inStock,
    exact_ean: row.exactEan, price_confidence: row.priceConfidence, source_confidence: row.sourceConfidence,
    overall_confidence: row.overallConfidence, price_source: row.priceSource, captured_at: row.capturedAt,
  }));
}

function toCsv(rows: Record<string, unknown>[]) {
  if (!rows.length) return "\uFEFF";
  const headers = Object.keys(rows[0]);
  const lines = [headers.map(csvCell).join(",")];
  for (const row of rows) lines.push(headers.map((header) => csvCell(row[header])).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

function csvCell(value: unknown) {
  let text = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
