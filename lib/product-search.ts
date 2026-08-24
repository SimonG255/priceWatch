import { assertPublicHostname } from "./product-input.ts";
import { extractProductMatch } from "./product-extraction.ts";
import { buildSearchCandidates, sameStoreHostname, type CustomSearchProfile } from "./site-search-profiles.ts";
import { reviewAndRecoverProductPageUrls } from "./ai-product-discovery.ts";

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

type QueueItem = { url: string; profileId: string; profileLabel: string };
type Page = QueueItem & { html: string };
type FetchedPage = { url: string; html: string };
type RankedMatch = ReturnType<typeof extractProductMatch> & { profileId?: string; profileLabel: string };

const DEFAULT_PAGE_TIMEOUT_MS = 8_000;
const CONFIGURED_PROFILE_TIMEOUT_MS = 15_000;
const SITEMAP_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_PAGE_BYTES = 2_000_000;
const MAX_SITEMAP_BYTES = 8_000_000;
const MAX_SITEMAP_DOCUMENTS = 3;
const JAGER_HOSTNAME = "trgovinejager.com";

class PublicPageFetchError extends Error {
  readonly kind: "timeout" | "blocked" | "challenge" | "unavailable";

  constructor(kind: "timeout" | "blocked" | "challenge" | "unavailable", message: string) {
    super(message);
    this.name = "PublicPageFetchError";
    this.kind = kind;
  }
}

export async function searchPublicWebsite(websiteUrl: string, productName: string, ean: string, customProfiles: CustomSearchProfile[] = [], preferredUrl?: string | null): Promise<ProductSearchResult> {
  try {
    const root = new URL(websiteUrl);
    const queries = [ean, `${productName} ${ean}`];
    const initialCandidates = buildSearchCandidates(root, queries, undefined, customProfiles);
    const knownCandidates = initialCandidates.filter(candidate => candidate.profileId !== "generic");
    const genericCandidates = initialCandidates.filter(candidate => candidate.profileId === "generic");
    const rootCandidate = { url: root.toString(), profileId: "submitted-page", profileLabel: "the submitted page" };
    // HTML-signature profiles cannot be evaluated until the submitted page is
    // loaded. Keep that page first so an admin's latest profile update always
    // reaches the search queue before the page cap is exhausted.
    const searchQueue: QueueItem[] = [rootCandidate, ...knownCandidates, ...genericCandidates];
    const preferredCandidate = safePreferredCandidate(preferredUrl, root);
    const queue: QueueItem[] = preferredCandidate ? [rootCandidate, preferredCandidate, ...knownCandidates, ...genericCandidates] : searchQueue;
    const seen = new Set<string>();
    const pages: Page[] = [];
    const pageFailures = new Map<string, PublicPageFetchError>();
    let blocked = false;
    let unavailable = false;
    let configuredSearchLoaded = false;
    let configuredSearchFailure: PublicPageFetchError | undefined;
    const failedConfiguredProfiles = new Set<string>();
    for (let index = 0; index < queue.length; index += 1) {
      const candidate = queue[index];
      if (seen.has(candidate.url) || pages.length >= 8) continue;
      const isConfiguredSearch = candidate.profileId.startsWith("custom-") || candidate.profileId === "trgovine-jager";
      // A challenge or timeout applies to the configured route, not just one
      // spelling of the query. Do not turn its second query into a blind retry.
      if (isConfiguredSearch && failedConfiguredProfiles.has(candidate.profileId)) continue;
      seen.add(candidate.url);
      try {
        const fetched = await fetchPublicPage(candidate.url, root.hostname, isConfiguredSearch ? CONFIGURED_PROFILE_TIMEOUT_MS : DEFAULT_PAGE_TIMEOUT_MS);
        if (isConfiguredSearch) configuredSearchLoaded = true;
        const page = { ...fetched, profileId: candidate.profileId, profileLabel: candidate.profileLabel };
        pages.push(page);
        if (candidate.profileId === "submitted-page") {
          const discovered = buildSearchCandidates(root, queries, page.html, customProfiles);
          // A signature-based profile can become available only after loading the
          // submitted page. Remove the generic routes queued before that profile
          // was evaluated, so a configured site route remains authoritative.
          if (discovered.some((item) => item.profileId.startsWith("custom-"))) {
            for (let queued = queue.length - 1; queued > index; queued -= 1) {
              if (queue[queued].profileId === "generic") queue.splice(queued, 1);
            }
          }
          queue.splice(index + 1, 0, ...discovered);
        }
        for (const link of extractLikelyLinks(page, productName, ean, root.hostname)) {
          if (!seen.has(link) && queue.length < 24) queue.push({ url: link, profileId: candidate.profileId, profileLabel: candidate.profileLabel });
        }
      } catch (error) {
        const failure = publicPageFetchFailure(error);
        if (failure) pageFailures.set(candidate.url, failure);
        if (isConfiguredSearch && failure) {
          failedConfiguredProfiles.add(candidate.profileId);
          if (!configuredSearchFailure) configuredSearchFailure = failure;
        }
        if (failure?.kind === "unavailable") unavailable = true;
        if (isBlockedFailure(failure)) blocked = true;
        else if (error instanceof Error && /403|429|robots|blocked/i.test(error.message)) blocked = true;
      }
    }
    let localMatches = pages.map((page) => ({ ...extractProductMatch(page.html, page.url, productName, ean), profileId: page.profileId, profileLabel: page.profileLabel }));
    // A sitemap supplies only a canonical URL. It is deliberately a late,
    // bounded fallback and never counts as product or price evidence itself.
    const canUseSitemap = !pickBestMatch(localMatches.filter(hasVerifiedProductPrice))
      && !(unavailable && pages.length === 0)
      && (!isTrgovineJager(root.hostname) || Boolean(configuredSearchFailure));
    if (canUseSitemap) {
      const sitemapProductUrl = await findSitemapProductUrl(root, productName, ean);
      const previousSitemapFailure = sitemapProductUrl ? pageFailures.get(sitemapProductUrl) : undefined;
      if (sitemapProductUrl && previousSitemapFailure) return sitemapVerificationFailureResult(sitemapProductUrl, previousSitemapFailure);
      if (sitemapProductUrl && !seen.has(sitemapProductUrl)) {
        seen.add(sitemapProductUrl);
        try {
          const fetched = await fetchPublicPage(sitemapProductUrl, root.hostname, DEFAULT_PAGE_TIMEOUT_MS);
          pages.push({ ...fetched, profileId: "sitemap", profileLabel: "the website's public sitemap" });
          localMatches = pages.map((page) => ({ ...extractProductMatch(page.html, page.url, productName, ean), profileId: page.profileId, profileLabel: page.profileLabel }));
        } catch (error) {
          const failure = publicPageFetchFailure(error);
          // A current sitemap can locate a page that is protected or temporarily
          // unavailable. Do not make extra AI/store requests after that direct
          // verification failed; report the candidate honestly instead.
          if (failure) {
            pageFailures.set(sitemapProductUrl, failure);
            return sitemapVerificationFailureResult(sitemapProductUrl, failure);
          }
          // A 404 can be a stale sitemap entry, so allow the normal recovery
          // path to continue. Other direct-page failures are availability
          // failures, not evidence that the product is absent.
          if (!(error instanceof Error && /returned 404\b/i.test(error.message))) {
            return {
              status: "error",
              matchedUrl: sitemapProductUrl,
              message: "The sitemap located a candidate product page, but that page could not be verified for EAN and price.",
            };
          }
        }
      }
    }
    const locallyVerified = pickBestMatch(localMatches.filter(hasVerifiedProductPrice));
    const best = pickBestMatch(localMatches);
    // Review the candidate that may actually be accepted. If none has a trustworthy
    // price, review the strongest incomplete result so AI can recover a better page.
    const reviewCandidate = locallyVerified ?? best;
    const review = await reviewAndRecoverProductPageUrls({
      websiteUrl,
      productName,
      ean,
      candidate: reviewCandidate ? {
        url: reviewCandidate.url,
        title: reviewCandidate.title,
        eanMatch: reviewCandidate.eanMatch,
        priceCents: reviewCandidate.priceCents,
        currency: reviewCandidate.currency,
        priceSource: reviewCandidate.priceSource,
      } : undefined,
    });

    // AI only decides whether a locally extracted result should be trusted. If the
    // review service is unavailable, keep the established local-verification fallback.
    const locallyConfirmed = locallyVerified && review.verdict === "confirmed" && review.confirmedUrl && sameNormalizedUrl(review.confirmedUrl, locallyVerified.url);
    if (locallyVerified && (!review.attempted || review.error || locallyConfirmed)) {
      const profileLabel = review.attempted && !review.error ? `${locallyVerified.profileLabel} after AI review` : locallyVerified.profileLabel;
      return matchedResult({ ...locallyVerified, profileLabel });
    }

    let aiBest: RankedMatch | null = null;
    for (const url of review.urls.slice(0, 3)) {
      // The bounded, same-store recovery list may deliberately point to a page
      // the crawler already visited but did not select as its best result.
      seen.add(url);
      try {
        const fetched = await fetchPublicPage(url, root.hostname, DEFAULT_PAGE_TIMEOUT_MS);
        const result = extractProductMatch(fetched.html, fetched.url, productName, ean);
        if (!aiBest || result.score > aiBest.score) aiBest = { ...result, profileLabel: "AI-assisted discovery" };
      } catch (error) {
        const failure = publicPageFetchFailure(error);
        if (failure) pageFailures.set(url, failure);
        if (isBlockedFailure(failure)) blocked = true;
        else if (error instanceof Error && /403|429|robots|blocked/i.test(error.message)) blocked = true;
      }
    }
    if (aiBest && hasVerifiedProductPrice(aiBest)) return matchedResult(aiBest);
    if (configuredSearchFailure && !configuredSearchLoaded) return configuredSearchFailure.kind === "timeout"
      ? { status: "error", message: "The configured website search did not respond within 15 seconds. The product was not marked absent." }
      : configuredSearchFailure.kind === "unavailable"
        ? { status: "error", message: "The configured website search is temporarily unavailable. The product was not marked absent." }
        : { status: "blocked", message: "The configured website search presented an access challenge. PriceWatch does not bypass CAPTCHAs or rate limits." };
    if (unavailable && pages.length === 0) return { status: "error", message: "The website was temporarily unavailable during the public check." };
    if (blocked && pages.length === 0) return { status: "blocked", message: "The website blocked or rate-limited the public check." };
    return { status: "not_found", message: review.attempted
      ? "The AI review could not verify a matching product with a current price on the store."
      : "No reliable EAN or product-price match was found on the checked public pages." };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "The website could not be searched." };
  }
}

function pickBestMatch(matches: RankedMatch[]) {
  return matches.reduce<RankedMatch | null>((best, match) => !best || match.score > best.score ? match : best, null);
}

function hasVerifiedProductPrice(match: ReturnType<typeof extractProductMatch> & { profileId?: string }) {
  // A sitemap URL is only a location hint. It must lead to a page carrying the
  // requested EAN as well as a current price; a name/model in its URL is not
  // enough to prove the product identity.
  return match.priceCents != null && (match.profileId === "sitemap" ? match.eanMatch : match.eanMatch || match.nameScore >= 0.9);
}

function sameNormalizedUrl(left: string, right: string) {
  try {
    const leftUrl = new URL(left);
    const rightUrl = new URL(right);
    leftUrl.hash = "";
    rightUrl.hash = "";
    return leftUrl.toString() === rightUrl.toString();
  } catch {
    return false;
  }
}

function sitemapVerificationFailureResult(url: string, failure: PublicPageFetchError): ProductSearchResult {
  if (failure.kind === "blocked" || failure.kind === "challenge") {
    return {
      status: "blocked",
      matchedUrl: url,
      message: "The sitemap located a candidate product page, but the website presented an access challenge before its EAN and price could be verified. PriceWatch does not bypass CAPTCHAs or rate limits.",
    };
  }
  return {
    status: "error",
    matchedUrl: url,
    message: failure.kind === "timeout"
      ? "The sitemap located a candidate product page, but it did not respond in time for EAN and price verification."
      : "The sitemap located a candidate product page, but it is temporarily unavailable for EAN and price verification.",
  };
}

/**
 * A sitemap is a URL-discovery source, never price evidence. It is checked
 * only after the store search has not produced a verified product. The bounded
 * traversal avoids turning a single price check into a site crawl.
 */
async function findSitemapProductUrl(root: URL, productName: string, ean: string) {
  const sitemapQueue: string[] = [];
  const queued = new Set<string>();
  const enqueue = (value: string) => {
    const url = safeSitemapUrl(value, root);
    if (!url || !isSitemapDocument(url) || queued.has(url.toString())) return;
    queued.add(url.toString());
    sitemapQueue.push(url.toString());
  };

  try {
    const robots = await fetchPublicPage(new URL("/robots.txt", root.origin).toString(), root.hostname, SITEMAP_TIMEOUT_MS, DEFAULT_MAX_PAGE_BYTES);
    for (const match of robots.html.matchAll(/^\s*sitemap:\s*(\S+)\s*$/gim)) enqueue(match[1]);
  } catch {
    // Sitemap discovery is optional; a blocked robots file is not retried.
  }
  if (!sitemapQueue.length) {
    enqueue("/sitemap.xml");
    enqueue("/sitemap_index.xml");
  }

  const visited = new Set<string>();
  while (sitemapQueue.length && visited.size < MAX_SITEMAP_DOCUMENTS) {
    sitemapQueue.sort((left, right) => sitemapDocumentPriority(right) - sitemapDocumentPriority(left));
    const sitemapUrl = sitemapQueue.shift()!;
    if (visited.has(sitemapUrl)) continue;
    visited.add(sitemapUrl);
    try {
      const page = await fetchPublicPage(sitemapUrl, root.hostname, SITEMAP_TIMEOUT_MS, MAX_SITEMAP_BYTES);
      const locations = extractSitemapLocations(page.html, root);
      const productUrl = pickSitemapProductUrl(locations, productName, ean);
      if (productUrl) return productUrl;
      for (const location of locations) enqueue(location);
    } catch {
      // A sitemap failure is not evidence that the requested product is absent.
    }
  }
  return undefined;
}

function isTrgovineJager(hostname: string) {
  return hostname.toLowerCase().replace(/^www\./, "") === JAGER_HOSTNAME;
}

function isSitemapDocument(url: URL) {
  const path = url.pathname.toLowerCase();
  return path.includes("sitemap") || /\.xml$/.test(path);
}

function sitemapDocumentPriority(value: string) {
  const path = new URL(value).pathname.toLowerCase();
  return (path.includes("products") ? 100 : 0) + (path.includes("product") ? 20 : 0) + (path.includes("index") ? 5 : 0);
}

function extractSitemapLocations(xml: string, root: URL) {
  const locations: string[] = [];
  const seen = new Set<string>();
  for (const match of xml.matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc>/gi)) {
    const url = safeSitemapUrl(match[1], root);
    if (!url || seen.has(url.toString())) continue;
    seen.add(url.toString());
    locations.push(url.toString());
  }
  return locations;
}

function pickSitemapProductUrl(locations: string[], productName: string, ean: string) {
  const matches = locations
    .map((url) => ({ url, score: sitemapProductScore(url, productName, ean) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score);
  if (!matches.length || (matches[1] && matches[1].score === matches[0].score)) return undefined;
  return matches[0].url;
}

function sitemapProductScore(value: string, productName: string, ean: string) {
  const url = new URL(value);
  const path = normalizeSitemapText(url.pathname);
  if (!path || isSitemapDocument(url)) return 0;
  const compactEan = ean.replace(/\D/g, "");
  if (compactEan && path.replace(/\s/g, "").includes(compactEan)) return 1_000;

  const terms = normalizeSitemapText(productName).split(" ").filter((term) => term.length >= 4);
  const modelTerms = terms.filter((term) => /[a-z]/.test(term) && /\d/.test(term) && term.length >= 6);
  // Names alone are too ambiguous in a sitemap. A model-like identifier is
  // stable enough to select a single page, which is still verified locally.
  return modelTerms.length && modelTerms.every((term) => path.includes(term)) ? 900 + modelTerms.length : 0;
}

function safeSitemapUrl(value: string, root: URL) {
  try {
    const url = new URL(decodeXmlText(value).trim(), root.origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || url.search || url.hash) return undefined;
    if (!sameSitemapStoreHostname(url.hostname, root.hostname)) return undefined;
    return url;
  } catch {
    // Invalid or non-canonical entries are ignored rather than followed.
    return undefined;
  }
}

function sameSitemapStoreHostname(left: string, right: string) {
  return left.toLowerCase().replace(/^www\./, "") === right.toLowerCase().replace(/^www\./, "");
}

function normalizeSitemapText(value: string) {
  return decodeXmlText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function decodeXmlText(value: string) {
  return value
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function safePreferredCandidate(value: string | null | undefined, root: URL): QueueItem | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || !sameStoreHostname(url.hostname, root.hostname)) return null;
    return { url: url.toString(), profileId: "saved-product-page", profileLabel: "the saved product page" };
  } catch { return null; }
}

function matchedResult(best: ReturnType<typeof extractProductMatch> & { profileLabel: string }): ProductSearchResult {
  return {
    status: "found",
    message: best.priceCents != null
      ? `${best.eanMatch ? "Exact EAN" : "Product name"} matched via ${best.profileLabel}; current price read from ${priceSourceLabel(best.priceSource)}.`
      : `${best.eanMatch ? "Exact EAN" : "Product name"} matched via ${best.profileLabel}, but no reliable current price was published.`,
    matchedUrl: best.url,
    title: best.title,
    priceCents: best.priceCents,
    currency: best.currency,
    inStock: best.inStock,
    matchType: best.eanMatch ? "ean" : "name",
  };
}

async function fetchPublicPage(input: string, originalHostname: string, timeoutMs: number, maxBytes = DEFAULT_MAX_PAGE_BYTES): Promise<FetchedPage> {
  let current = new URL(input);
  for (let redirect = 0; redirect < 4; redirect += 1) {
    assertPublicHostname(current.hostname);
    if (!sameStoreHostname(current.hostname, originalHostname)) throw new Error("Cross-domain redirects are not followed.");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(current, { redirect: "manual", signal: controller.signal, headers: { "User-Agent": "PriceWatch/1.0 (+public product monitor)", Accept: "text/html,application/xhtml+xml,application/xml;q=0.9" } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) throw new Error("Website redirect was incomplete.");
        current = new URL(location, current);
        continue;
      }
      if (response.status === 403 || response.status === 429) throw new PublicPageFetchError("blocked", `Website blocked the request (${response.status}).`);
      if (response.status >= 500) throw new PublicPageFetchError("unavailable", `Website is temporarily unavailable (${response.status}).`);
      if (!response.ok) throw new Error(`Website returned ${response.status}.`);
      const contentType = response.headers.get("content-type") ?? "";
      if (!/html|xml|text/i.test(contentType)) throw new Error("The URL did not return a public webpage.");
      const declared = Number(response.headers.get("content-length") || 0);
      if (declared > maxBytes) throw new Error("The page is too large to search safely.");
      const html = await readPublicText(response, maxBytes);
      if (isAccessChallenge(html)) throw new PublicPageFetchError("challenge", "Website presented an access challenge.");
      return { url: current.toString(), html };
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
        throw new PublicPageFetchError("timeout", `Website did not respond within ${Math.ceil(timeoutMs / 1000)} seconds.`);
      }
      if (error instanceof TypeError) throw new PublicPageFetchError("unavailable", "Website connection failed.");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("Too many redirects.");
}

async function readPublicText(response: Response, maxBytes: number) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error("The page is too large to search safely.");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function publicPageFetchFailure(error: unknown) {
  return error instanceof PublicPageFetchError ? error : undefined;
}

function isBlockedFailure(failure: ReturnType<typeof publicPageFetchFailure>) {
  return failure?.kind === "blocked" || failure?.kind === "challenge";
}

function isAccessChallenge(html: string) {
  const page = html.slice(0, 120_000).toLowerCase();
  return page.includes("cf-chl-")
    || page.includes("/cdn-cgi/challenge-platform")
    || page.includes("<title>just a moment")
    || page.includes("<title>attention required")
    || page.includes("verify you are human")
    || page.includes("potrebno je varnostno preverjanje");
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
