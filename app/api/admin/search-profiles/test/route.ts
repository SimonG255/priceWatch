import { ensureProductsSchema } from "../../../../../db";
import { getAdminEmail } from "../../../../../lib/admin-auth";
import { assertPublicHostname } from "../../../../../lib/product-input";
import { searchPublicWebsite } from "../../../../../lib/product-search";
import { loadScraperContext } from "../../../../../lib/scraper-operations";
import { getScraperDomainAvailability, reserveScraperDomain } from "../../../../../lib/scraper-state";
import { validateSearchProfileInput } from "../../../../../lib/search-profile-input";

export async function POST(request: Request) {
  if (!await getAdminEmail()) return Response.json({ error: "Administrator access required." }, { status: 403 });
  try {
    await ensureProductsSchema();
    const body = await request.json() as Record<string, unknown>;
    const rawUrl = String(body.url || "").trim();
    if (!rawUrl) throw new Error("Enter the public URL to use for the profile test.");
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new Error("Enter a valid public URL starting with https:// or http://.");
    }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Enter a public HTTP or HTTPS URL.");
    assertPublicHostname(url.hostname);
    const productName = String(body.productName || "").trim();
    const ean = String(body.ean || "").replace(/\D/g, "");
    if (productName.length < 2) throw new Error("Enter the product name used for the test.");
    if (![8, 12, 13, 14].includes(ean.length)) throw new Error("Enter an 8, 12, 13, or 14 digit EAN/GTIN.");
    const profile = validateSearchProfileInput((body.profile ?? {}) as Record<string, unknown>);
    const availability = await getScraperDomainAvailability(url.hostname);
    if (!availability.allowed) return Response.json({ error: "This domain is cooling down; the profile test respects the same request budget as live scans.", retryAt: availability.retryAt }, { status: 429 });
    const context = await loadScraperContext(url.hostname);
    const result = await searchPublicWebsite(url.toString(), productName, ean, [{ id: "dry-run", ...profile }], undefined, {
      knownBadPatterns: context.knownBadPatterns,
      accessPolicy: context.policy?.accessMode === "block" ? "block" : "allow",
      respectRobots: true,
      onlyProfile: true,
      reserveRequest: () => reserveScraperDomain(url.hostname, { intervalMs: context.policy?.requestIntervalMs ?? undefined }),
      domainProfile: context.policy ? {
        siteType: normalizeSiteType(context.policy.siteType),
        timeoutMs: context.policy.timeoutMs ?? undefined,
        maxPageBytes: context.policy.maxPageBytes ?? undefined,
        retryBudget: context.policy.retryBudget ?? undefined,
      } : undefined,
    });
    return Response.json({ result, attempts: result.attempts ?? [], profileHealth: result.profileHealth ?? null }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Profile test failed." }, { status: 400 });
  }
}

function normalizeSiteType(value: string | undefined) {
  return ["auto", "standard", "slow", "large", "javascript", "marketplace"].includes(value ?? "")
    ? value as "auto" | "standard" | "slow" | "large" | "javascript" | "marketplace"
    : "auto";
}
