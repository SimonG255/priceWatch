import { assertPublicHostname } from "./product-input";
import { extractProductMatch } from "./product-extraction";
import { buildSearchCandidates, sameStoreHostname, type CustomSearchProfile } from "./site-search-profiles";

export type ProductSearchResult = {
  status: "found" | "not_found" | "blocked" | "error";
  message: string;
  matchedUrl?: string;
  title?: string;
  priceCents?: number;
  currency?: string;
  inStock?: boolean;
  matchType?: "ean" | "name";
};

type QueueItem = { url: string; profileLabel: string };
type Page = QueueItem & { html: string };
type FetchedPage = { url: string; html: string };

export async function searchPublicWebsite(websiteUrl: string, productName: string, ean: string, customProfiles: CustomSearchProfile[] = []): Promise<ProductSearchResult> {
  try {
    const root = new URL(websiteUrl);
    const queries = [ean, `${productName} ${ean}`];
    const initialCandidates = buildSearchCandidates(root, queries, undefined, customProfiles);
    const knownCandidates = initialCandidates.filter(candidate => candidate.profileId !== "generic");
    const genericCandidates = initialCandidates.filter(candidate => candidate.profileId === "generic");
    const rootCandidate = { url: root.toString(), profileLabel: "the submitted page" };
    const queue: QueueItem[] = knownCandidates.length
      ? [...knownCandidates, rootCandidate, ...genericCandidates]
      : [rootCandidate, ...genericCandidates];
    const seen = new Set<string>();
    const pages: Page[] = [];
    let blocked = false;
    for (let index = 0; index < queue.length; index += 1) {
      const candidate = queue[index];
      if (seen.has(candidate.url) || pages.length >= 8) continue;
      seen.add(candidate.url);
      try {
        const fetched = await fetchPublicPage(candidate.url, root.hostname);
        const page = { ...fetched, profileLabel: candidate.profileLabel };
        pages.push(page);
        if (candidate.profileLabel === "the submitted page") {
          const discovered = buildSearchCandidates(root, queries, page.html, customProfiles);
          queue.splice(index + 1, 0, ...discovered);
        }
        for (const link of extractLikelyLinks(page, productName, ean, root.hostname)) {
          if (!seen.has(link) && queue.length < 24) queue.push({ url: link, profileLabel: candidate.profileLabel });
        }
      } catch (error) {
        if (error instanceof Error && /403|429|robots|blocked/i.test(error.message)) blocked = true;
      }
    }
    let best: (ReturnType<typeof extractProductMatch> & { profileLabel: string }) | null = null;
    for (const page of pages) {
      const result = extractProductMatch(page.html, page.url, productName, ean);
      if (!best || result.score > best.score) best = { ...result, profileLabel: page.profileLabel };
    }
    if (best && (best.eanMatch || (best.nameScore >= 0.65 && best.priceCents != null))) {
      return {
        status: "found",
        message: best.priceCents != null
          ? `${best.eanMatch ? "Exact EAN" : "Product name"} matched via ${best.profileLabel}; current price read from ${priceSourceLabel(best.priceSource)}.`
          : `${best.eanMatch ? "Exact EAN" : "Product name"} matched, but no reliable current price was published.`,
        matchedUrl: best.url,
        title: best.title,
        priceCents: best.priceCents,
        currency: best.currency,
        inStock: best.inStock,
        matchType: best.eanMatch ? "ean" : "name",
      };
    }
    if (blocked && pages.length === 0) return { status: "blocked", message: "The website blocked or rate-limited the public check." };
    return { status: "not_found", message: "No reliable EAN or product-price match was found on the checked public pages." };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "The website could not be searched." };
  }
}

async function fetchPublicPage(input: string, originalHostname: string): Promise<FetchedPage> {
  let current = new URL(input);
  for (let redirect = 0; redirect < 4; redirect += 1) {
    assertPublicHostname(current.hostname);
    if (!sameStoreHostname(current.hostname, originalHostname)) throw new Error("Cross-domain redirects are not followed.");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    let response: Response;
    try {
      response = await fetch(current, { redirect: "manual", signal: controller.signal, headers: { "User-Agent": "PriceWatch/1.0 (+public product monitor)", Accept: "text/html,application/xhtml+xml,application/xml;q=0.9" } });
    } finally { clearTimeout(timer); }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Website redirect was incomplete.");
      current = new URL(location, current);
      continue;
    }
    if (response.status === 403 || response.status === 429) throw new Error(`Website blocked the request (${response.status}).`);
    if (!response.ok) throw new Error(`Website returned ${response.status}.`);
    const contentType = response.headers.get("content-type") ?? "";
    if (!/html|xml|text/i.test(contentType)) throw new Error("The URL did not return a public webpage.");
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > 2_000_000) throw new Error("The page is too large to search safely.");
    const html = (await response.text()).slice(0, 2_000_000);
    return { url: current.toString(), html };
  }
  throw new Error("Too many redirects.");
}

function extractLikelyLinks(page: Page, productName: string, ean: string, hostname: string) {
  const terms = productName.toLowerCase().split(/\s+/).filter((word) => word.length > 2);
  const links: { url: string; score: number }[] = [];
  const regex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of page.html.matchAll(regex)) {
    const label = stripHtml(match[2]).toLowerCase();
    let url: URL;
    try { url = new URL(match[1], page.url); } catch { continue; }
    if (!sameStoreHostname(url.hostname, hostname) || !['http:', 'https:'].includes(url.protocol)) continue;
    const haystack = `${url.pathname} ${label}`.toLowerCase();
    const score = (haystack.includes(ean) ? 10 : 0) + terms.filter((term) => haystack.includes(term)).length;
    if (score > 0) links.push({ url: url.toString(), score });
  }
  return links.sort((a, b) => b.score - a.score).slice(0, 5).map((link) => link.url);
}

function stripHtml(value: string) { return decodeEntities(value.replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")); }
function decodeEntities(value: string) { return value.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">"); }

function priceSourceLabel(source: ReturnType<typeof extractProductMatch>["priceSource"]) {
  if (source === "structured") return "structured product data";
  if (source === "product-meta") return "product metadata";
  if (source === "product-element") return "the current-price field";
  if (source === "ean-context") return "the EAN-matched product section";
  return "the matched product section";
}
