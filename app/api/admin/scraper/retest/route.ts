import { ensureProductsSchema, getDb } from "../../../../../db";
import { monitoredProducts } from "../../../../../db/schema";
import { getAdminEmail } from "../../../../../lib/admin-auth";
import { fairDomainOrder } from "../../../../../lib/scraper-diagnostics";
import { runProductScan } from "../../../../../lib/run-product-scan";

const DEFAULT_STATUSES = new Set(["blocked", "unavailable", "needs_review", "not_found"]);

export async function POST(request: Request) {
  if (!await getAdminEmail()) return Response.json({ error: "Administrator access required." }, { status: 403 });
  try {
    await ensureProductsSchema();
    const input = await request.json().catch(() => ({})) as Record<string, unknown>;
    const requestedHosts = new Set(Array.isArray(input.hostnames) ? input.hostnames.filter((value): value is string => typeof value === "string").map(normalizeHost) : []);
    const requestedStatuses = new Set(Array.isArray(input.statuses) ? input.statuses.filter((value): value is string => typeof value === "string") : [...DEFAULT_STATUSES]);
    const requestedReasons = new Set(Array.isArray(input.reasonCodes) ? input.reasonCodes.filter((value): value is string => typeof value === "string") : []);
    const limit = Math.max(1, Math.min(25, Number(input.limit) || 12));
    const all = await getDb().select({
      id: monitoredProducts.id, ownerEmail: monitoredProducts.ownerEmail, websiteUrl: monitoredProducts.websiteUrl,
      status: monitoredProducts.status, reasonCode: monitoredProducts.reasonCode,
    }).from(monitoredProducts).limit(2_000);
    const eligible = all.filter((product) => {
      const host = normalizeHost(new URL(product.websiteUrl).hostname);
      return (!requestedHosts.size || requestedHosts.has(host))
        && (!requestedStatuses.size || requestedStatuses.has(product.status))
        && (!requestedReasons.size || requestedReasons.has(product.reasonCode || ""));
    });
    const ordered = fairDomainOrder(eligible, (product) => new URL(product.websiteUrl).hostname).slice(0, limit);
    const results = [];
    for (const product of ordered) {
      const outcome = await runProductScan({ ownerEmail: product.ownerEmail, productId: product.id, trigger: "bulk_retest" });
      results.push({ productId: product.id, status: "error" in outcome ? "error" : outcome.result.status, cooledDown: "cooledDown" in outcome && outcome.cooledDown === true });
    }
    return Response.json({ queued: ordered.length, skipped: Math.max(0, eligible.length - ordered.length), completed: results });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Retest could not be started." }, { status: 400 });
  }
}

function normalizeHost(value: string) { return value.toLowerCase().replace(/^www\./, "").replace(/\.$/, ""); }
