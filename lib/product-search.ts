import { assertPublicHostname } from "./product-input.ts";
import { extractProductMatch } from "./product-extraction.ts";
import { buildSearchCandidates, resolveStoreExtractionProfile, sameStoreHostname, type CustomSearchProfile } from "./site-search-profiles.ts";
import { reviewAndRecoverProductPageUrls } from "./ai-product-discovery.ts";
import { renderWithPermittedService } from "./permitted-page-renderer.ts";
import type { PermittedPageRenderer, PreviousVerifiedProduct, ProductEvidence, ScraperStatus, SitemapProductCache, StoreExtractionProfile } from "./scraper-types.ts";

export type ProductSearchResult = {
  status: ScraperStatus;
  message: string;
  matchedUrl?: string;
  title?: string;
  priceCents?: number;
  currency?: string;
  inStock?: boolean;
  matchType?: "ean" | "name";
  confidence?: "high" | "medium" | "low";
  evidence?: ProductEvidence;
  pageEtag?: string;
  pageLastModified?: string;
  httpStatus?: number;
};

export type SearchRuntimeOptions = {
  previous?: PreviousVerifiedProduct;
  sitemapCache?: SitemapProductCache;
  renderer?: PermittedPageRenderer;
  reserveRequest?: () => Promise<{ allowed: boolean; retryAt?: string }>;
};

type QueueItem = { url: string; profileId: string; profileLabel: string; conditional?: boolean };
type Page = QueueItem & FetchedPage;
type FetchedPage = { url: string; html: string; etag?: string; lastModified?: string; httpStatus: number; notModified?: boolean };
type RankedMatch = ReturnType<typeof extractProductMatch> & { profileId?: string; profileLabel: string; etag?: string; lastModified?: string; httpStatus?: number };
type SitemapLocation = { url: string; lastmod?: string };
type SitemapProductCandidate = SitemapLocation & { sitemapUrl?: string; cached?: boolean };

const DEFAULT_PAGE_TIMEOUT_MS = 8_000;
const CONFIGURED_PROFILE_TIMEOUT_MS = 15_000;
const SITEMAP_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_PAGE_BYTES = 2_000_000;
const MAX_SITEMAP_BYTES = 8_000_000;
const MAX_SITEMAP_DOCUMENTS = 3;
const JAGER_HOSTNAME = "trgovinejager.com";
const MAX_UNAVAILABLE_RETRIES = 2;

class PublicPageFetchError extends Error {
  readonly kind: "timeout" | "blocked" | "challenge" | "unavailable" | "rate_limited";
  readonly httpStatus?: number;
  readonly retryAfterMs?: number;

  constructor(kind: "timeout" | "blocked" | "challenge" | "unavailable" | "rate_limited", message: string, options: { httpStatus?: number; retryAfterMs?: number } = {}) {
    super(message);
    this.name = "PublicPageFetchError";
    this.kind = kind;
    this.httpStatus = options.httpStatus;
    this.retryAfterMs = options.retryAfterMs;
  }
}

export async function searchPublicWebsite(
  websiteUrl: string,
  productName: string,
  ean: string,
  customProfiles: CustomSearchProfile[] = [],
  preferredUrl?: string | null,
  runtime: SearchRuntimeOptions = {},
): Promise<ProductSearchResult> {
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
    if (preferredCandidate && runtime.previous && sameNormalizedUrl(runtime.previous.matchedUrl || "", preferredCandidate.url)) preferredCandidate.conditional = true;
    const queue: QueueItem[] = preferredCandidate ? [rootCandidate, preferredCandidate, ...knownCandidates, ...genericCandidates] : searchQueue;
    const seen = new Set<string>();
    const pages: Page[] = [];
    const pageFailures = new Map<string, PublicPageFetchError>();
    let blocked = false;
    let unavailable = false;
    let configuredSearchLoaded = false;
    let configuredSearchFailure: PublicPageFetchError | undefined;
    const failedConfiguredProfiles = new Set<string>();
    let extractionProfile = resolveStoreExtractionProfile(root, undefined, customProfiles);
    for (let index = 0; index < queue.length; index += 1) {
      const candidate = queue[index];
      if (seen.has(candidate.url) || pages.length >= 8) continue;
      const isConfiguredSearch = candidate.profileId.startsWith("custom-") || candidate.profileId === "trgovine-jager";
      // A challenge or timeout applies to the configured route, not just one
      // spelling of the query. Do not turn its second query into a blind retry.
      if (isConfiguredSearch && failedConfiguredProfiles.has(candidate.profileId)) continue;
      seen.add(candidate.url);
      try {
        const fetched = await fetchPublicPage(candidate.url, root.hostname, {
          timeoutMs: isConfiguredSearch ? CONFIGURED_PROFILE_TIMEOUT_MS : DEFAULT_PAGE_TIMEOUT_MS,
          blockPatterns: extractionProfile?.blockPatterns,
          conditional: candidate.conditional ? runtime.previous : undefined,
          reserveRequest: runtime.reserveRequest,
        });
        if (fetched.notModified) {
          const unchanged = candidate.conditional ? notModifiedResult(runtime.previous, candidate.url) : undefined;
          if (unchanged) return unchanged;
          continue;
        }
        if (isConfiguredSearch) configuredSearchLoaded = true;
        const page = { ...fetched, profileId: candidate.profileId, profileLabel: candidate.profileLabel };
        pages.push(page);
        if (candidate.profileId === "submitted-page") {
          extractionProfile = resolveStoreExtractionProfile(root, page.html, customProfiles);
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
        if (failure?.kind === "unavailable" || failure?.kind === "rate_limited") unavailable = true;
        if (isBlockedFailure(failure)) blocked = true;
        else if (error instanceof Error && /403|429|robots|blocked/i.test(error.message)) blocked = true;
      }
    }
    let localMatches = pages.map((page) => matchFromPage(page, productName, ean, extractionProfile));
    // A sitemap supplies only a canonical URL. It is deliberately a late,
    // bounded fallback and never counts as product or price evidence itself.
    const canUseSitemap = !pickBestMatch(localMatches.filter(hasVerifiedProductPrice))
      && !(unavailable && pages.length === 0)
      && (!isTrgovineJager(root.hostname) || Boolean(configuredSearchFailure));
    if (canUseSitemap) {
      const sitemapCandidate = await findSitemapProductUrl(root, productName, ean, runtime.sitemapCache, extractionProfile?.blockPatterns, runtime.reserveRequest);
      const sitemapProductUrl = sitemapCandidate?.url;
      const previousSitemapFailure = sitemapProductUrl ? pageFailures.get(sitemapProductUrl) : undefined;
      if (sitemapProductUrl && previousSitemapFailure) return sitemapVerificationFailureResult(sitemapProductUrl, previousSitemapFailure);
      if (sitemapProductUrl && !seen.has(sitemapProductUrl)) {
        seen.add(sitemapProductUrl);
        try {
          const fetched = await fetchPublicPage(sitemapProductUrl, root.hostname, { timeoutMs: DEFAULT_PAGE_TIMEOUT_MS, blockPatterns: extractionProfile?.blockPatterns, reserveRequest: runtime.reserveRequest });
          if (!fetched.notModified) {
            pages.push({ ...fetched, profileId: "sitemap", profileLabel: "the website's public sitemap" });
            localMatches = pages.map((page) => matchFromPage(page, productName, ean, extractionProfile));
          }
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
              status: "unavailable",
              matchedUrl: sitemapProductUrl,
              message: "The sitemap located a candidate product page, but that page could not be verified for EAN and price.",
            };
          }
          await runtime.sitemapCache?.invalidate?.({ hostname: root.hostname, ean, candidateUrl: sitemapProductUrl });
        }
      }
    }
    let locallyVerified = pickBestMatch(localMatches.filter(hasVerifiedProductPrice));
    let best = pickBestMatch(localMatches);
    if (blocked) {
      if (locallyVerified) return matchedResult(locallyVerified);
      return {
        status: "blocked",
        message: "The website presented an access challenge or rate limit before the product and price could be verified. PriceWatch does not bypass CAPTCHAs or access controls.",
        matchedUrl: best?.canonicalUrl || best?.url,
        title: best?.title,
        confidence: best?.confidence,
        evidence: best ? evidenceFromMatch(best) : undefined,
        pageEtag: best?.etag,
        pageLastModified: best?.lastModified,
        httpStatus: best?.httpStatus,
      };
    }
    if (!locallyVerified && best && !best.structuredProduct && extractionProfile?.allowRenderedFallback && !blocked && !unavailable) {
      // Rendering is an opt-in, permitted fallback for JavaScript-heavy stores.
      // It is never attempted after a block/challenge and the rendered HTML is
      // subjected to exactly the same local EAN/price verification.
      try {
        const rendered = await (runtime.renderer ?? renderWithPermittedService)({
          url: best.canonicalUrl || best.url,
          hostname: root.hostname,
          waitForSelector: extractionProfile.productSelector || extractionProfile.priceSelector,
        });
        if (rendered) {
          const result = extractProductMatch(rendered.html, rendered.url, productName, ean, extractionProfile);
          const renderedMatch: RankedMatch = { ...result, profileId: extractionProfile.id || "rendered", profileLabel: "the permitted rendered product page", httpStatus: 200 };
          if (!best || renderedMatch.score >= best.score) best = renderedMatch;
          if (hasVerifiedProductPrice(renderedMatch)) locallyVerified = renderedMatch;
        }
      } catch {
        // A permitted renderer is optional. Its failure does not trigger an
        // unbounded retry or hide the normal public-page outcome.
      }
    }
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
        const fetched = await fetchPublicPage(url, root.hostname, { timeoutMs: DEFAULT_PAGE_TIMEOUT_MS, blockPatterns: extractionProfile?.blockPatterns, reserveRequest: runtime.reserveRequest });
        if (fetched.notModified) continue;
        const result = extractProductMatch(fetched.html, fetched.url, productName, ean, extractionProfile);
        if (!aiBest || result.score > aiBest.score) aiBest = { ...result, profileLabel: "AI-assisted discovery", etag: fetched.etag, lastModified: fetched.lastModified, httpStatus: fetched.httpStatus };
      } catch (error) {
        const failure = publicPageFetchFailure(error);
        if (failure) pageFailures.set(url, failure);
        if (isBlockedFailure(failure)) blocked = true;
        else if (error instanceof Error && /403|429|robots|blocked/i.test(error.message)) blocked = true;
      }
    }
    if (aiBest && hasVerifiedProductPrice(aiBest)) return matchedResult(aiBest);
    if (configuredSearchFailure && !configuredSearchLoaded) return configuredSearchFailure.kind === "timeout"
      ? { status: "unavailable", message: "The configured website search did not respond within 15 seconds. The product was not marked absent." }
      : configuredSearchFailure.kind === "unavailable" || configuredSearchFailure.kind === "rate_limited"
        ? { status: "unavailable", message: "The configured website search is temporarily unavailable. The product was not marked absent." }
        : { status: "blocked", message: "The configured website search presented an access challenge. PriceWatch does not bypass CAPTCHAs or rate limits." };
    if (unavailable && pages.length === 0) return { status: "unavailable", message: "The website was temporarily unavailable during the public check." };
    if (blocked && pages.length === 0) return { status: "blocked", message: "The website blocked or rate-limited the public check." };
    if (best && (best.eanMatch || best.nameScore >= 0.65 || best.structuredProduct)) return needsReviewResult(best, extractionProfile);
    return { status: "not_found", message: review.attempted
      ? "The AI review could not verify a matching product with a current price on the store."
      : "No reliable EAN or product-price match was found on the checked public pages." };
  } catch (error) {
    return { status: "unavailable", message: error instanceof Error ? error.message : "The website could not be searched." };
  }
}

function pickBestMatch(matches: RankedMatch[]) {
  return matches.reduce<RankedMatch | null>((best, match) => !best || match.score > best.score ? match : best, null);
}

function matchFromPage(page: Page, productName: string, ean: string, profile: StoreExtractionProfile | undefined): RankedMatch {
  return {
    ...extractProductMatch(page.html, page.url, productName, ean, profile),
    profileId: page.profileId,
    profileLabel: page.profileLabel,
    etag: page.etag,
    lastModified: page.lastModified,
    httpStatus: page.httpStatus,
  };
}

function hasVerifiedProductPrice(match: ReturnType<typeof extractProductMatch> & { profileId?: string }) {
  // A sitemap URL is only a location hint. It must lead to a page carrying the
  // requested EAN as well as a current price; a name/model in its URL is not
  // enough to prove the product identity.
  return match.priceCents != null && (match.profileId === "sitemap"
    ? match.structuredExactEan || (match.eanMatch && match.nameScore >= 0.85)
    : match.eanMatch || match.nameScore >= 0.9);
}

function notModifiedResult(previous: PreviousVerifiedProduct | undefined, candidateUrl: string): ProductSearchResult | undefined {
  if (!previous || previous.status !== "found" || previous.priceCents == null || !previous.matchedUrl || !sameNormalizedUrl(previous.matchedUrl, candidateUrl)) return undefined;
  const evidence = previous.evidence;
  if (!evidence?.exactEan) return undefined;
  const checkedAt = new Date().toISOString();
  return {
    status: "found",
    message: "The previously verified product page has not changed since its last public check.",
    matchedUrl: previous.matchedUrl,
    title: previous.title ?? undefined,
    priceCents: previous.priceCents,
    currency: previous.currency ?? undefined,
    inStock: previous.inStock ?? undefined,
    matchType: previous.matchType === "ean" ? "ean" : "name",
    confidence: previous.confidence === "high" || previous.confidence === "medium" || previous.confidence === "low" ? previous.confidence : "medium",
    evidence: { ...evidence, checkedAt },
    pageEtag: previous.pageEtag ?? undefined,
    pageLastModified: previous.pageLastModified ?? undefined,
    httpStatus: 304,
  };
}

function needsReviewResult(best: RankedMatch, profile: StoreExtractionProfile | undefined): ProductSearchResult {
  const checkedAt = new Date().toISOString();
  const rendererHint = profile?.allowRenderedFallback && !best.structuredProduct
    ? " Normal HTML lacked usable structured product data; an approved renderer can be enabled for this profile."
    : "";
  const reason = !best.eanMatch
    ? "A likely product page was found, but its exact EAN could not be verified."
    : best.priceCents == null
      ? "A likely product page was found, but its current price could not be verified."
      : "A likely product page was found, but its product evidence is not strong enough to save a price automatically.";
  return {
    status: "needs_review",
    message: `${reason}${rendererHint}`,
    matchedUrl: best.canonicalUrl || best.url,
    title: best.title,
    confidence: best.confidence,
    evidence: {
      exactEan: best.eanMatch,
      structuredExactEan: best.structuredExactEan,
      structuredProduct: best.structuredProduct,
      nameScore: best.nameScore,
      priceSource: best.priceSource,
      canonicalUrl: best.canonicalUrl || best.url,
      profileId: best.profileId,
      checkedAt,
    },
    pageEtag: best.etag,
    pageLastModified: best.lastModified,
    httpStatus: best.httpStatus,
  };
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
    status: "unavailable",
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
async function findSitemapProductUrl(
  root: URL,
  productName: string,
  ean: string,
  cache: SitemapProductCache | undefined,
  blockPatterns: string[] | undefined,
  reserveRequest: (() => Promise<{ allowed: boolean; retryAt?: string }>) | undefined,
): Promise<SitemapProductCandidate | undefined> {
  const cached = await cache?.get({ hostname: root.hostname, ean });
  if (cached) {
    const url = safeSitemapUrl(cached.candidateUrl, root);
    if (url && !isSitemapDocument(url)) {
      // A cached sitemap hint only changes fetch order. The page is always
      // fetched again and must independently verify EAN and price.
      return { url: url.toString(), sitemapUrl: cached.sitemapUrl, lastmod: cached.sitemapLastmod, cached: true };
    }
  }
  const sitemapQueue: string[] = [];
  const queued = new Set<string>();
  const enqueue = (value: string) => {
    const url = safeSitemapUrl(value, root);
    if (!url || !isSitemapDocument(url) || queued.has(url.toString())) return;
    queued.add(url.toString());
    sitemapQueue.push(url.toString());
  };

  try {
    const robots = await fetchPublicPage(new URL("/robots.txt", root.origin).toString(), root.hostname, {
      timeoutMs: SITEMAP_TIMEOUT_MS,
      maxBytes: DEFAULT_MAX_PAGE_BYTES,
      blockPatterns,
      reserveRequest,
    });
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
      const page = await fetchPublicPage(sitemapUrl, root.hostname, {
        timeoutMs: SITEMAP_TIMEOUT_MS,
        maxBytes: MAX_SITEMAP_BYTES,
        blockPatterns,
        reserveRequest,
      });
      const locations = extractSitemapLocations(page.html, root);
      const productUrl = pickSitemapProductUrl(locations, productName, ean);
      if (productUrl) {
        const candidate = { ...productUrl, sitemapUrl };
        await cache?.put({ hostname: root.hostname, ean, entry: { candidateUrl: candidate.url, sitemapUrl, sitemapLastmod: candidate.lastmod } });
        return candidate;
      }
      for (const location of locations) enqueue(location.url);
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
  const locations: SitemapLocation[] = [];
  const seen = new Set<string>();
  const entries = [...xml.matchAll(/<(?:url|sitemap)\b[^>]*>([\s\S]*?)<\/(?:url|sitemap)>/gi)];
  for (const entry of entries) {
    const location = entry[1].match(/<loc\b[^>]*>([\s\S]*?)<\/loc>/i)?.[1];
    if (!location) continue;
    const url = safeSitemapUrl(location, root);
    if (!url || seen.has(url.toString())) continue;
    seen.add(url.toString());
    const lastmod = entry[1].match(/<lastmod\b[^>]*>([\s\S]*?)<\/lastmod>/i)?.[1]?.trim();
    locations.push({ url: url.toString(), ...(lastmod ? { lastmod } : {}) });
  }
  return locations;
}

function pickSitemapProductUrl(locations: SitemapLocation[], productName: string, ean: string) {
  const matches = locations
    .map((location) => ({ ...location, score: sitemapProductScore(location.url, productName, ean) }))
    .filter((candidate) => candidate.score > 0)
    // Sitemap lastmod is strictly a discovery-order signal. It never affects
    // identity, EAN, or price evidence from the product page.
    .sort((left, right) => right.score - left.score || sitemapLastmodPriority(right.lastmod) - sitemapLastmodPriority(left.lastmod));
  if (!matches.length) return undefined;
  if (matches[1] && matches[1].score === matches[0].score && sitemapLastmodPriority(matches[1].lastmod) === sitemapLastmodPriority(matches[0].lastmod)) return undefined;
  return { url: matches[0].url, lastmod: matches[0].lastmod };
}

function sitemapLastmodPriority(value: string | undefined) {
  const timestamp = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : 0;
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

function matchedResult(best: RankedMatch): ProductSearchResult {
  return {
    status: "found",
    message: best.priceCents != null
      ? `${best.eanMatch ? "Exact EAN" : "Product name"} matched via ${best.profileLabel}; current price read from ${priceSourceLabel(best.priceSource)}.`
      : `${best.eanMatch ? "Exact EAN" : "Product name"} matched via ${best.profileLabel}, but no reliable current price was published.`,
    matchedUrl: best.canonicalUrl || best.url,
    title: best.title,
    priceCents: best.priceCents,
    currency: best.currency,
    inStock: best.inStock,
    matchType: best.eanMatch ? "ean" : "name",
    confidence: best.confidence,
    evidence: evidenceFromMatch(best),
    pageEtag: best.etag,
    pageLastModified: best.lastModified,
    httpStatus: best.httpStatus,
  };
}

function evidenceFromMatch(best: RankedMatch): ProductEvidence {
  return {
    exactEan: best.eanMatch,
    structuredExactEan: best.structuredExactEan,
    structuredProduct: best.structuredProduct,
    nameScore: best.nameScore,
    priceSource: best.priceSource,
    canonicalUrl: best.canonicalUrl || best.url,
    profileId: best.profileId,
    checkedAt: new Date().toISOString(),
  };
}

type FetchPublicPageOptions = {
  timeoutMs: number;
  maxBytes?: number;
  blockPatterns?: string[];
  conditional?: PreviousVerifiedProduct;
  reserveRequest?: () => Promise<{ allowed: boolean; retryAt?: string }>;
};

async function fetchPublicPage(input: string, originalHostname: string, options: FetchPublicPageOptions): Promise<FetchedPage> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_PAGE_BYTES;
  let current = new URL(input);
  redirects: for (let redirect = 0; redirect < 4; redirect += 1) {
    assertPublicHostname(current.hostname);
    if (!sameStoreHostname(current.hostname, originalHostname)) throw new Error("Cross-domain redirects are not followed.");
    for (let attempt = 0; attempt <= MAX_UNAVAILABLE_RETRIES; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs);
      try {
        const reservation = await options.reserveRequest?.();
        if (reservation && !reservation.allowed) {
          throw new PublicPageFetchError("rate_limited", "The website is cooling down to respect its public request limits.", {
            retryAfterMs: reservation.retryAt ? Math.max(0, Date.parse(reservation.retryAt) - Date.now()) : undefined,
          });
        }
        const headers: Record<string, string> = {
          "User-Agent": "PriceWatch/1.0 (+public product monitor)",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9",
        };
        if (options.conditional?.pageEtag) headers["If-None-Match"] = options.conditional.pageEtag;
        if (options.conditional?.pageLastModified) headers["If-Modified-Since"] = options.conditional.pageLastModified;
        const response = await fetch(current, { redirect: "manual", signal: controller.signal, headers });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get("location");
          if (!location) throw new Error("Website redirect was incomplete.");
          current = new URL(location, current);
          continue redirects;
        }
        const responseMeta = {
          etag: response.headers.get("etag") || undefined,
          lastModified: response.headers.get("last-modified") || undefined,
          httpStatus: response.status,
        };
        if (response.status === 304) return { url: current.toString(), html: "", notModified: true, ...responseMeta };
        if (response.status === 403 || response.status === 429) throw new PublicPageFetchError("blocked", `Website blocked the request (${response.status}).`, { httpStatus: response.status });
        if (response.status >= 500 || response.status === 408) {
          throw new PublicPageFetchError("unavailable", `Website is temporarily unavailable (${response.status}).`, { httpStatus: response.status, retryAfterMs: retryAfterMs(response.headers.get("retry-after")) });
        }
        if (!response.ok) throw new Error(`Website returned ${response.status}.`);
        const contentType = response.headers.get("content-type") ?? "";
        if (!/html|xml|text/i.test(contentType)) throw new Error("The URL did not return a public webpage.");
        const declared = Number(response.headers.get("content-length") || 0);
        if (declared > maxBytes) throw new Error("The page is too large to search safely.");
        const html = await readPublicText(response, maxBytes);
        if (isAccessChallenge(html, options.blockPatterns)) throw new PublicPageFetchError("challenge", "Website presented an access challenge.", { httpStatus: response.status });
        return { url: current.toString(), html, ...responseMeta };
      } catch (error) {
        const failure = normalizeFetchError(error, controller.signal.aborted, options.timeoutMs);
        if (failure?.kind === "unavailable" && attempt < MAX_UNAVAILABLE_RETRIES) {
          await delay(Math.min(failure.retryAfterMs ?? 250 * 2 ** attempt, 2_000));
          continue;
        }
        if (failure?.kind === "rate_limited" && failure.retryAfterMs != null && failure.retryAfterMs <= 2_000 && attempt < MAX_UNAVAILABLE_RETRIES) {
          await delay(failure.retryAfterMs);
          continue;
        }
        throw failure ?? error;
      } finally {
        clearTimeout(timer);
      }
    }
  }
  throw new Error("Too many redirects.");
}

function normalizeFetchError(error: unknown, aborted: boolean, timeoutMs: number) {
  if (error instanceof PublicPageFetchError) return error;
  if (aborted || (error instanceof Error && error.name === "AbortError")) {
    return new PublicPageFetchError("timeout", `Website did not respond within ${Math.ceil(timeoutMs / 1000)} seconds.`);
  }
  if (error instanceof TypeError) return new PublicPageFetchError("unavailable", "Website connection failed.");
  return undefined;
}

function retryAfterMs(value: string | null) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, 2_000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, Math.min(date - Date.now(), 2_000)) : undefined;
}

async function delay(milliseconds: number) {
  if (milliseconds <= 0) return;
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
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

function isAccessChallenge(html: string, profilePatterns: string[] = []) {
  const page = html.slice(0, 120_000).toLowerCase();
  return profilePatterns.some((pattern) => pattern && page.includes(pattern.toLowerCase()))
    || page.includes("cf-chl-")
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
  if (source === "profile-selector") return "the website's configured price selector";
  if (source === "product-meta") return "product metadata";
  if (source === "product-element") return "the current-price field";
  if (source === "ean-context") return "the EAN-matched product section";
  return "the matched product section";
}
