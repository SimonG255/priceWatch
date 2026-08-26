import { ensureProductsSchema, getDb } from "../../../../../db";
import { monitoredProducts } from "../../../../../db/schema";
import { getAdminEmail } from "../../../../../lib/admin-auth";
import { fairDomainOrder } from "../../../../../lib/scraper-diagnostics";
import { runProductScan } from "../../../../../lib/run-product-scan";

const DEFAULT_STATUSES = new Set(["blocked", "unavailable", "needs_review", "not_found"]);

/**
 * Processes exactly one product per HTTP invocation. The admin client follows
 * the returned continuation, so request budgets reset between scans.
 */
export async function POST(request: Request) {
  if (!(await getAdminEmail())) return Response.json({ error: "Administrator access required." }, { status: 403 });
  try {
    await ensureProductsSchema();
    const input = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const requestedHosts = new Set(
      Array.isArray(input.hostnames)
        ? input.hostnames.filter((value): value is string => typeof value === "string").map(normalizeHost)
        : [],
    );
    const requestedStatuses = new Set(
      Array.isArray(input.statuses)
        ? input.statuses.filter((value): value is string => typeof value === "string")
        : [...DEFAULT_STATUSES],
    );
    const requestedReasons = new Set(
      Array.isArray(input.reasonCodes)
        ? input.reasonCodes.filter((value): value is string => typeof value === "string")
        : [],
    );
    const lastHostname = typeof input.lastHostname === "string" ? normalizeHost(input.lastHostname) : "";
    const processedIds = new Set(
      Array.isArray(input.processedIds)
        ? input.processedIds.filter((value): value is string => typeof value === "string").slice(0, 5_000)
        : [],
    );
    const all: Array<{
      id: string;
      ownerEmail: string;
      websiteUrl: string;
      status: string;
      reasonCode: string | null;
    }> = await getDb()
      .select({
        id: monitoredProducts.id,
        ownerEmail: monitoredProducts.ownerEmail,
        websiteUrl: monitoredProducts.websiteUrl,
        status: monitoredProducts.status,
        reasonCode: monitoredProducts.reasonCode,
      })
      .from(monitoredProducts);
    const eligible = all.filter(
      (product: { id: string; websiteUrl: string; status: string; reasonCode: string | null }) => {
        const host = normalizeHost(new URL(product.websiteUrl).hostname);
        return (
          !processedIds.has(product.id) &&
          (!requestedHosts.size || requestedHosts.has(host)) &&
          (!requestedStatuses.size || requestedStatuses.has(product.status)) &&
          (!requestedReasons.size || requestedReasons.has(product.reasonCode || ""))
        );
      },
    );
    const ordered = fairDomainOrder(eligible, (item: { websiteUrl: string }) => new URL(item.websiteUrl).hostname);
    const hostOrder = [
      ...new Set(ordered.map((item: { websiteUrl: string }) => normalizeHost(new URL(item.websiteUrl).hostname))),
    ];
    const previousHostIndex = hostOrder.indexOf(lastHostname);
    const nextHostname = hostOrder.length ? hostOrder[(previousHostIndex + 1) % hostOrder.length] : "";
    const product = ordered.find((item) => normalizeHost(new URL(item.websiteUrl).hostname) === nextHostname);
    if (!product) {
      return Response.json({
        queued: 0,
        remaining: eligible.length,
        completed: [],
        continuation: [...processedIds],
        lastHostname,
        complete: true,
      });
    }

    const outcome = await runProductScan({
      ownerEmail: product.ownerEmail,
      productId: product.id,
      trigger: "bulk_retest",
    });
    const completed = [
      {
        productId: product.id,
        status: "error" in outcome ? "error" : outcome.result.status,
        cooledDown: "cooledDown" in outcome && outcome.cooledDown === true,
      },
    ];
    const continuation = [...processedIds, product.id];
    const remaining = Math.max(0, eligible.length - 1);
    const complete = remaining === 0;
    return Response.json(
      { queued: 1, remaining, completed, continuation, lastHostname: nextHostname, complete },
      { status: complete ? 200 : 202 },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Retest could not be started." },
      { status: 400 },
    );
  }
}

function normalizeHost(value: string) {
  return value
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/\.$/, "");
}
