import { assertPublicHostname } from "./product-input.ts";
import { extractProductMatch } from "./product-extraction.ts";
import { buildSearchCandidates, resolveStoreExtractionProfile, sameStoreHostname, type CustomSearchProfile } from "./site-search-profiles.ts";
import { reviewAndRecoverProductPageUrls } from "./ai-product-discovery.ts";
import { renderWithPermittedService } from "./permitted-page-renderer.ts";
import { createScraperNetwork, type ScraperNetwork } from "./scraper-network.ts";
import {
  contentFingerprint,
  detectAccessChallenge,
  failureClassFor,
  matchKnownBadPattern,
  parseRobotsRules,
  profileHealthScore,
  robotsAllows,
  scraperBudgetFor,
  suggestSelectors,
} from "./scraper-diagnostics.ts";
import type {
  ChallengeType,
  CachedProductMatch,
  ConfidenceScores,
  KnownBadPattern,
  PermittedPageRenderer,
  PreviousVerifiedProduct,
  ProductEvidence,
  ScraperAttempt,
  ScraperFailureClass,
  ScraperReasonCode,
  ScraperResultCache,
  ScraperStatus,
  SitemapProductCache,
  StoreExtractionProfile,
} from "./scraper-types.ts";

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
  reasonCode?: ScraperReasonCode;
  failureClass?: ScraperFailureClass;
  challengeType?: ChallengeType;
  confidenceScores?: ConfidenceScores;
  contentHash?: string;
  retryAfterMs?: number;
  attempts?: ScraperAttempt[];
  durationMs?: number;
  profileHealth?: {
    profileId?: string;
    score: number;
    status: "healthy" | "degraded" | "drifted" | "unknown";
    signatureMatched?: boolean;
    selectorSuggestions?: string[];
  };
};

export type SearchRuntimeOptions = {
  previous?: PreviousVerifiedProduct;
  sitemapCache?: SitemapProductCache;
  renderer?: PermittedPageRenderer;
  reserveRequest?: () => Promise<{ allowed: boolean; retryAt?: string }>;
  resultCache?: ScraperResultCache;
  knownBadPatterns?: KnownBadPattern[];
  accessPolicy?: "allow" | "block";
  respectRobots?: boolean;
  onlyProfile?: boolean;
  onAttempt?: (attempt: ScraperAttempt) => void | Promise<void>;
  domainProfile?: StoreExtractionProfile;
  network?: ScraperNetwork;
};

type QueueItem = { url: string; profileId: string; profileLabel: string; conditional?: boolean };
type Page = QueueItem & FetchedPage;
type FetchedPage = { url: string; html: string; etag?: string; lastModified?: string; httpStatus: number; notModified?: boolean; responseBytes?: number; contentHash?: string; durationMs?: number };
type RankedMatch = ReturnType<typeof extractProductMatch> & { profileId?: string; profileLabel: string; etag?: string; lastModified?: string; httpStatus?: number; contentHash?: string; selectorSuggestions?: string[] };
type SitemapLocation = { url: string; lastmod?: string };
type SitemapProductCandidate = SitemapLocation & { sitemapUrl?: string; cached?: boolean };

const CONFIGURED_PROFILE_TIMEOUT_MS = 15_000;
const SITEMAP_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_PAGE_BYTES = 2_000_000;
const MAX_SITEMAP_BYTES = 8_000_000;
const MAX_SITEMAP_DOCUMENTS = 3;
const JAGER_HOSTNAME = "trgovinejager.com";
const MAX_UNAVAILABLE_RETRIES = 2;

class PublicPageFetchError extends Error {
  readonly kind: "timeout" | "blocked" | "challenge" | "unavailable" | "rate_limited" | "response_too_large" | "http_client_error";
  readonly httpStatus?: number;
  readonly retryAfterMs?: number;
  readonly reasonCode: ScraperReasonCode;
  readonly failureClass: ScraperFailureClass;
  readonly challengeType?: ChallengeType;

  constructor(kind: PublicPageFetchError["kind"], message: string, options: { httpStatus?: number; retryAfterMs?: number; reasonCode?: ScraperReasonCode; failureClass?: ScraperFailureClass; challengeType?: ChallengeType } = {}) {
    super(message);
    this.name = "PublicPageFetchError";
    this.kind = kind;
    this.httpStatus = options.httpStatus;
    this.retryAfterMs = options.retryAfterMs;
    this.reasonCode = options.reasonCode ?? reasonCodeForFetchKind(kind);
    this.failureClass = options.failureClass ?? failureClassFor(this.reasonCode);
    this.challengeType = options.challengeType;
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
  const startedAt = Date.now();
  const attempts: ScraperAttempt[] = [];
  const network = runtime.network ?? createScraperNetwork();
  const result = await searchPublicWebsiteInternal(websiteUrl, productName, ean, customProfiles, preferredUrl, {
    ...runtime,
    network,
    onAttempt: async (attempt) => {
      attempts.push(attempt);
      await runtime.onAttempt?.(attempt);
    },
  });
  const reasonCode = result.reasonCode ?? reasonCodeForResult(result);
  return {
    ...result,
    reasonCode,
    failureClass: result.failureClass ?? failureClassFor(reasonCode),
    confidenceScores: result.confidenceScores ?? result.evidence?.confidenceScores,
    attempts,
    durationMs: Date.now() - startedAt,
  };
}

async function searchPublicWebsiteInternal(
  websiteUrl: string,
  productName: string,
  ean: string,
  customProfiles: CustomSearchProfile[] = [],
  preferredUrl?: string | null,
  runtime: SearchRuntimeOptions = {},
): Promise<ProductSearchResult> {
  try {
    const root = new URL(websiteUrl);
    if (runtime.accessPolicy === "block") {
      return {
        status: "blocked",
        reasonCode: "robots_disallowed",
        failureClass: "permanent",
        message: "This domain is blocked by Nexus's explicit access policy.",
      };
    }
    let robotsRules: ReturnType<typeof parseRobotsRules> = [];
    let robotsText: string | undefined;
    if (runtime.respectRobots === true) {
      try {
        const robotsPage = await fetchPublicPage(new URL("/robots.txt", root.origin).toString(), root.hostname, {
          timeoutMs: 6_000,
          maxBytes: 512_000,
          retryBudget: 0,
          profileId: "robots",
          profileLabel: "robots.txt policy",
          reserveRequest: runtime.reserveRequest,
          onAttempt: runtime.onAttempt,
          network: runtime.network,
        });
        robotsText = robotsPage.html;
        robotsRules = parseRobotsRules(robotsPage.html);
      } catch (error) {
        const failure = publicPageFetchFailure(error);
        if (failure && failure.kind !== "http_client_error") return terminalFetchFailureResult(failure, undefined, "The website's crawling policy could not be checked safely.");
      }
    }
    const queries = [ean, `${productName} ${ean}`];
    const initialCandidates = buildSearchCandidates(root, queries, undefined, customProfiles);
    const knownCandidates = initialCandidates.filter(candidate => candidate.profileId !== "generic");
    const genericCandidates = runtime.onlyProfile ? [] : initialCandidates.filter(candidate => candidate.profileId === "generic");
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
    let robotsDisallowed = false;
    let knownBadSkipped = false;
    let configuredSearchLoaded = false;
    let configuredSearchFailure: PublicPageFetchError | undefined;
    let terminalFailure: PublicPageFetchError | undefined;
    let hostTerminalFailure: PublicPageFetchError | undefined;
    const failedConfiguredProfiles = new Set<string>();
    let extractionProfile = mergeExtractionProfiles(resolveStoreExtractionProfile(root, undefined, customProfiles), runtime.domainProfile);
    const retryState = { remaining: scraperBudgetFor(root.hostname, extractionProfile).retryBudget };
    let profileDrift: { profileId: string; selectorSuggestions: string[] } | undefined;
    for (let index = 0; index < queue.length; index += 1) {
      const candidate = queue[index];
      if (seen.has(candidate.url) || pages.length >= 8) continue;
      const isConfiguredSearch = candidate.profileId.startsWith("custom-") || candidate.profileId === "trgovine-jager";
      // A challenge or timeout applies to the configured route, not just one
      // spelling of the query. Do not turn its second query into a blind retry.
      if (isConfiguredSearch && failedConfiguredProfiles.has(candidate.profileId)) continue;
      seen.add(candidate.url);
      const knownBad = matchKnownBadPattern(candidate.url, undefined, runtime.knownBadPatterns ?? []);
      if (knownBad) {
        knownBadSkipped = true;
        await runtime.onAttempt?.({
          url: candidate.url, profileId: candidate.profileId, profileLabel: candidate.profileLabel,
          outcome: "skipped", reasonCode: "known_bad_pattern", failureClass: "permanent", durationMs: 0,
          message: knownBad.reason || "Skipped by a known-bad page rule.",
        });
        continue;
      }
      if (!robotsAllows(new URL(candidate.url), robotsRules)) {
        robotsDisallowed = true;
        await runtime.onAttempt?.({
          url: candidate.url, profileId: candidate.profileId, profileLabel: candidate.profileLabel,
          outcome: "skipped", reasonCode: "robots_disallowed", failureClass: "permanent", durationMs: 0,
          message: "Disallowed by the website's robots.txt policy.",
        });
        continue;
      }
      try {
        const requestBudget = scraperBudgetFor(root.hostname, extractionProfile);
        const fetched = await fetchPublicPage(candidate.url, root.hostname, {
          timeoutMs: isConfiguredSearch ? Math.max(CONFIGURED_PROFILE_TIMEOUT_MS, requestBudget.timeoutMs) : requestBudget.timeoutMs,
          maxBytes: requestBudget.maxPageBytes,
          retryBudget: requestBudget.retryBudget,
          retryState,
          blockPatterns: extractionProfile?.blockPatterns,
          conditional: candidate.conditional ? runtime.previous : undefined,
          reserveRequest: runtime.reserveRequest,
          knownBadPatterns: runtime.knownBadPatterns,
          profileId: candidate.profileId,
          profileLabel: candidate.profileLabel,
          onAttempt: runtime.onAttempt,
          network: runtime.network,
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
          const hostSignatureProfiles = customProfiles.filter((profile) => profile.hostname && sameStoreHostname(root.hostname, profile.hostname) && profile.htmlSignature);
          const previousProfileId = runtime.previous?.evidence?.profileId;
          const expectedProfiles = previousProfileId?.startsWith("custom-")
            ? hostSignatureProfiles.filter((profile) => `custom-${profile.id}` === previousProfileId)
            : hostSignatureProfiles.length === 1 ? hostSignatureProfiles : [];
          const drifted = expectedProfiles.find((profile) => !page.html.toLowerCase().includes(profile.htmlSignature.toLowerCase()));
          if (drifted) profileDrift = { profileId: `custom-${drifted.id}`, selectorSuggestions: suggestSelectors(page.html) };
          extractionProfile = mergeExtractionProfiles(resolveStoreExtractionProfile(root, page.html, customProfiles), runtime.domainProfile);
          const discovered = buildSearchCandidates(root, queries, page.html, customProfiles).filter((item) => !runtime.onlyProfile || item.profileId.startsWith("custom-"));
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
        if (failure) terminalFailure = failure;
        if (failure) pageFailures.set(candidate.url, failure);
        if (failure?.reasonCode === "known_bad_pattern") knownBadSkipped = true;
        if (isConfiguredSearch && failure && failure.kind !== "http_client_error") {
          failedConfiguredProfiles.add(candidate.profileId);
          if (!configuredSearchFailure) configuredSearchFailure = failure;
        }
        if (failure?.kind === "unavailable" || failure?.kind === "rate_limited") unavailable = true;
        if (isBlockedFailure(failure)) blocked = true;
        else if (error instanceof Error && /403|429|robots|blocked/i.test(error.message)) blocked = true;
        if (failure && isHostTerminalFailure(failure)) {
          hostTerminalFailure ??= failure;
          break;
        }
      }
    }
    let localMatches = await Promise.all(pages.map((page) => matchFromPage(page, productName, ean, extractionProfile, runtime.resultCache)));
    const earlyVerified = pickBestMatch(localMatches.filter(hasVerifiedProductPrice));
    const canUseKnownSafeSitemapAfterChallenge = Boolean(hostTerminalFailure?.kind === "challenge" && isTrgovineJager(root.hostname));
    if (hostTerminalFailure && !canUseKnownSafeSitemapAfterChallenge) {
      if (earlyVerified) return matchedResult(earlyVerified);
      const bestBeforeBlock = pickBestMatch(localMatches);
      return terminalFetchFailureResult(hostTerminalFailure, bestBeforeBlock);
    }
    if (knownBadSkipped && pages.length === 0) return {
      status: "needs_review",
      reasonCode: "known_bad_pattern",
      failureClass: "permanent",
      message: "Every viable candidate matched a known-bad extraction rule, so Nexus stopped before saving unreliable data.",
    };
    // A sitemap supplies only a canonical URL. It is deliberately a late,
    // bounded fallback and never counts as product or price evidence itself.
    const canUseSitemap = !runtime.onlyProfile
      && !pickBestMatch(localMatches.filter(hasVerifiedProductPrice))
      && !(unavailable && pages.length === 0)
      && (!isTrgovineJager(root.hostname) || Boolean(configuredSearchFailure));
    if (canUseSitemap) {
      const sitemapCandidate = await findSitemapProductUrl(root, productName, ean, runtime.sitemapCache, extractionProfile?.blockPatterns, runtime.reserveRequest, runtime.onAttempt, runtime.knownBadPatterns, robotsText, retryState, runtime.network);
      const sitemapProductUrl = sitemapCandidate?.url;
      const previousSitemapFailure = sitemapProductUrl ? pageFailures.get(sitemapProductUrl) : undefined;
      if (sitemapProductUrl && previousSitemapFailure) return sitemapVerificationFailureResult(sitemapProductUrl, previousSitemapFailure);
      if (sitemapProductUrl && !seen.has(sitemapProductUrl)) {
        seen.add(sitemapProductUrl);
        try {
          const pageBudget = scraperBudgetFor(root.hostname, extractionProfile);
          const fetched = await fetchPublicPage(sitemapProductUrl, root.hostname, {
            timeoutMs: pageBudget.timeoutMs, maxBytes: pageBudget.maxPageBytes, retryBudget: pageBudget.retryBudget, retryState,
            blockPatterns: extractionProfile?.blockPatterns, reserveRequest: runtime.reserveRequest,
            knownBadPatterns: runtime.knownBadPatterns, profileId: "sitemap", profileLabel: "the website's public sitemap",
            onAttempt: runtime.onAttempt,
            network: runtime.network,
          });
          if (!fetched.notModified) {
            pages.push({ ...fetched, profileId: "sitemap", profileLabel: "the website's public sitemap" });
            localMatches = await Promise.all(pages.map((page) => matchFromPage(page, productName, ean, extractionProfile, runtime.resultCache)));
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
        message: "The website presented an access challenge or rate limit before the product and price could be verified. Nexus does not bypass CAPTCHAs or access controls.",
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
        const renderBudget = scraperBudgetFor(root.hostname, extractionProfile);
        const renderInput = {
          url: best.canonicalUrl || best.url,
          hostname: root.hostname,
          waitForSelector: extractionProfile.productSelector || extractionProfile.priceSelector,
          ...(extractionProfile.cookieConsentSelector ? { cookieConsentSelector: extractionProfile.cookieConsentSelector } : {}),
          ...(runtime.renderer ? {} : { timeoutMs: renderBudget.renderTimeoutMs, maxBytes: renderBudget.maxRenderedBytes }),
        };
        const rendered = await (runtime.renderer ?? renderWithPermittedService)(renderInput);
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
    if (runtime.onlyProfile) {
      if (locallyVerified) return matchedResult(locallyVerified);
      if (best && (best.eanMatch || best.nameScore >= 0.65 || best.structuredProduct)) return needsReviewResult(best, extractionProfile, profileDrift);
      const applied = extractionProfile?.id === "custom-dry-run";
      return {
        status: "needs_review",
        reasonCode: applied ? "low_confidence" : "profile_drift",
        failureClass: applied ? "temporary" : "permanent",
        message: applied
          ? "The draft profile ran without generic fallbacks, but it did not extract a trustworthy EAN and current price."
          : "The draft profile did not match the test URL or its HTML signature, so no fallback profile was used.",
        profileHealth: { profileId: "custom-dry-run", score: applied ? 35 : 10, status: applied ? "degraded" : "drifted", signatureMatched: applied },
      };
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
        const pageBudget = scraperBudgetFor(root.hostname, extractionProfile);
        const fetched = await fetchPublicPage(url, root.hostname, {
          timeoutMs: pageBudget.timeoutMs, maxBytes: pageBudget.maxPageBytes, retryBudget: pageBudget.retryBudget, retryState,
          blockPatterns: extractionProfile?.blockPatterns, reserveRequest: runtime.reserveRequest,
          knownBadPatterns: runtime.knownBadPatterns, profileId: "ai-recovery", profileLabel: "AI-assisted discovery",
          onAttempt: runtime.onAttempt,
          network: runtime.network,
        });
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
      ? { status: "unavailable", reasonCode: "timeout", message: "The configured website search did not respond within 15 seconds. The product was not marked absent." }
      : configuredSearchFailure.kind === "unavailable" || configuredSearchFailure.kind === "rate_limited"
        ? { status: "unavailable", reasonCode: configuredSearchFailure.reasonCode, message: "The configured website search is temporarily unavailable. The product was not marked absent." }
        : configuredSearchFailure.kind === "response_too_large"
          ? { status: "needs_review", reasonCode: "response_too_large", message: "The configured website search exceeded its safe page-size budget and needs a site-specific profile adjustment." }
          : { status: "blocked", reasonCode: configuredSearchFailure.reasonCode, challengeType: configuredSearchFailure.challengeType, message: "The configured website search presented an access challenge. Nexus does not bypass CAPTCHAs or rate limits." };
    if (unavailable && pages.length === 0) return { status: "unavailable", message: "The website was temporarily unavailable during the public check." };
    if (blocked && pages.length === 0) return { status: "blocked", message: "The website blocked or rate-limited the public check." };
    if (best && (best.eanMatch || best.nameScore >= 0.65 || best.structuredProduct)) return needsReviewResult(best, extractionProfile, profileDrift);
    if (profileDrift) return {
      status: "needs_review", reasonCode: "profile_drift", failureClass: "temporary",
      message: "The configured website signature no longer matches. Review the suggested selectors or search route before saving another automatic result.",
      profileHealth: { profileId: profileDrift.profileId, score: 25, status: "drifted", signatureMatched: false, selectorSuggestions: profileDrift.selectorSuggestions },
    };
    if (robotsDisallowed) return {
      status: "blocked", reasonCode: "robots_disallowed", failureClass: "permanent",
      message: "The website's robots.txt policy disallows the relevant public product paths.",
    };
    if (knownBadSkipped) return {
      status: "needs_review", reasonCode: "known_bad_pattern", failureClass: "permanent",
      message: "Known bad product pages were skipped before they could produce another unreliable match.",
    };
    if (terminalFailure?.kind === "response_too_large") return {
      status: "needs_review", reasonCode: "response_too_large", failureClass: "temporary",
      message: "A relevant page exceeded its safe size budget. Configure a larger per-site budget only after reviewing the domain.",
    };
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

async function matchFromPage(page: Page, productName: string, ean: string, profile: StoreExtractionProfile | undefined, cache?: ScraperResultCache): Promise<RankedMatch> {
  const cacheHash = page.contentHash ? contentFingerprint(JSON.stringify(["extractor-v2", page.contentHash, profile ?? null])) : undefined;
  let cached: CachedProductMatch | undefined;
  try { cached = cacheHash ? await cache?.get({ url: page.url, ean, contentHash: cacheHash }) : undefined; } catch { cached = undefined; }
  const extracted = cached ?? extractProductMatch(page.html, page.url, productName, ean, profile);
  if (!cached && cacheHash) {
    try {
      await cache?.invalidate?.({ url: page.url, ean, exceptContentHash: cacheHash });
      await cache?.put({ url: page.url, ean, contentHash: cacheHash, match: extracted });
    } catch {
      // Cache availability never changes the correctness of live extraction.
    }
  }
  return {
    ...extracted,
    profileId: page.profileId,
    profileLabel: page.profileLabel,
    etag: page.etag,
    lastModified: page.lastModified,
    httpStatus: page.httpStatus,
    contentHash: page.contentHash,
    selectorSuggestions: suggestSelectors(page.html),
  };
}

function hasVerifiedProductPrice(match: ReturnType<typeof extractProductMatch> & { profileId?: string }) {
  // A sitemap URL is only a location hint. It must lead to a page carrying the
  // requested EAN as well as a current price; a name/model in its URL is not
  // enough to prove the product identity.
  if (match.priceCents == null) return false;
  if (match.profileId === "sitemap") return (match.structuredExactEan || (match.eanMatch && match.nameScore >= 0.85)) && match.confidenceScores.overall >= 68;
  if (match.eanMatch) return match.confidenceScores.overall >= 68;
  return match.nameScore >= 0.93 && match.confidenceScores.overall >= 52 && match.confidenceScores.source >= 70;
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

function needsReviewResult(best: RankedMatch, profile: StoreExtractionProfile | undefined, drift?: { profileId: string; selectorSuggestions: string[] }): ProductSearchResult {
  const checkedAt = new Date().toISOString();
  const rendererHint = profile?.allowRenderedFallback && !best.structuredProduct
    ? " Normal HTML lacked usable structured product data; an approved renderer can be enabled for this profile."
    : "";
  const reason = drift
    ? "The configured website signature no longer matches the current page structure."
    : !best.eanMatch
    ? "A likely product page was found, but its exact EAN could not be verified."
    : best.priceCents == null
      ? "A likely product page was found, but its current price could not be verified."
      : "A likely product page was found, but its product evidence is not strong enough to save a price automatically.";
  const reasonCode: ScraperReasonCode = drift ? "profile_drift" : !best.eanMatch ? "wrong_product" : best.priceCents == null ? "price_missing" : "low_confidence";
  const selectorSuggestions = drift?.selectorSuggestions ?? (profile ? best.selectorSuggestions ?? [] : []);
  return {
    status: "needs_review",
    reasonCode,
    failureClass: failureClassFor(reasonCode),
    message: `${reason}${rendererHint}`,
    matchedUrl: best.canonicalUrl || best.url,
    title: best.title,
    confidence: best.confidence,
    confidenceScores: best.confidenceScores,
    contentHash: best.contentHash,
    profileHealth: {
      profileId: drift?.profileId ?? best.profileId,
      score: profileHealthScore({ exactEan: best.eanMatch, priceFound: best.priceCents != null, selectorSuggestions }),
      status: reasonCode === "profile_drift" ? "drifted" : "degraded",
      ...(drift ? { signatureMatched: false } : {}),
      selectorSuggestions,
    },
    evidence: {
      exactEan: best.eanMatch,
      structuredExactEan: best.structuredExactEan,
      structuredProduct: best.structuredProduct,
      nameScore: best.nameScore,
      priceSource: best.priceSource,
      confidenceScores: best.confidenceScores,
      contentHash: best.contentHash,
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
      reasonCode: failure.reasonCode,
      failureClass: failure.failureClass,
      challengeType: failure.challengeType,
      httpStatus: failure.httpStatus,
      retryAfterMs: failure.retryAfterMs,
      matchedUrl: url,
      message: "The sitemap located a candidate product page, but the website presented an access challenge before its EAN and price could be verified. Nexus does not bypass CAPTCHAs or rate limits.",
    };
  }
  return {
    status: "unavailable",
    reasonCode: failure.reasonCode,
    failureClass: failure.failureClass,
    httpStatus: failure.httpStatus,
    retryAfterMs: failure.retryAfterMs,
    matchedUrl: url,
    message: failure.kind === "timeout"
      ? "The sitemap located a candidate product page, but it did not respond in time for EAN and price verification."
      : "The sitemap located a candidate product page, but it is temporarily unavailable for EAN and price verification.",
  };
}

function terminalFetchFailureResult(failure: PublicPageFetchError, best?: RankedMatch | null, message?: string): ProductSearchResult {
  const isBlock = failure.kind === "blocked" || failure.kind === "challenge";
  return {
    status: isBlock ? "blocked" : "unavailable",
    reasonCode: failure.reasonCode,
    failureClass: failure.failureClass,
    challengeType: failure.challengeType,
    httpStatus: failure.httpStatus,
    retryAfterMs: failure.retryAfterMs,
    matchedUrl: best?.canonicalUrl || best?.url,
    title: best?.title,
    confidence: best?.confidence,
    confidenceScores: best?.confidenceScores,
    contentHash: best?.contentHash,
    evidence: best ? evidenceFromMatch(best) : undefined,
    message: message ?? (isBlock
      ? `${failure.message} Nexus stopped at the access challenge and does not bypass CAPTCHAs or access controls.`
      : `${failure.message} No further requests were made during this run.`),
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
  onAttempt: SearchRuntimeOptions["onAttempt"],
  knownBadPatterns: KnownBadPattern[] | undefined,
  robotsText?: string,
  retryState?: { remaining: number },
  network?: ScraperNetwork,
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

  if (robotsText != null) {
    for (const match of robotsText.matchAll(/^\s*sitemap:\s*(\S+)\s*$/gim)) enqueue(match[1]);
  } else try {
    const robots = await fetchPublicPage(new URL("/robots.txt", root.origin).toString(), root.hostname, {
      timeoutMs: SITEMAP_TIMEOUT_MS,
      maxBytes: DEFAULT_MAX_PAGE_BYTES,
      retryBudget: 0,
      blockPatterns,
      reserveRequest,
      knownBadPatterns,
      profileId: "robots",
      profileLabel: "robots.txt sitemap discovery",
      onAttempt,
      network,
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
        retryBudget: 1,
        retryState,
        blockPatterns,
        reserveRequest,
        knownBadPatterns,
        profileId: "sitemap-index",
        profileLabel: "the website's public sitemap",
        onAttempt,
        network,
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
    reasonCode: "found",
    failureClass: "none",
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
    confidenceScores: best.confidenceScores,
    contentHash: best.contentHash,
    profileHealth: {
      profileId: best.profileId,
      score: profileHealthScore({ exactEan: best.eanMatch, priceFound: best.priceCents != null }),
      status: "healthy",
    },
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
    confidenceScores: best.confidenceScores,
    contentHash: best.contentHash,
    canonicalUrl: best.canonicalUrl || best.url,
    profileId: best.profileId,
    checkedAt: new Date().toISOString(),
  };
}

type FetchPublicPageOptions = {
  timeoutMs: number;
  maxBytes?: number;
  retryBudget?: number;
  retryState?: { remaining: number };
  blockPatterns?: string[];
  conditional?: PreviousVerifiedProduct;
  reserveRequest?: () => Promise<{ allowed: boolean; retryAt?: string }>;
  knownBadPatterns?: KnownBadPattern[];
  profileId?: string;
  profileLabel?: string;
  onAttempt?: (attempt: ScraperAttempt) => void | Promise<void>;
  network?: ScraperNetwork;
};

async function fetchPublicPage(input: string, originalHostname: string, options: FetchPublicPageOptions): Promise<FetchedPage> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_PAGE_BYTES;
  const retryBudget = Math.max(0, Math.min(4, options.retryBudget ?? MAX_UNAVAILABLE_RETRIES));
  let current = new URL(input);
  redirects: for (let redirect = 0; redirect < 4; redirect += 1) {
    assertPublicHostname(current.hostname);
    if (!sameStoreHostname(current.hostname, originalHostname)) throw new Error("Cross-domain redirects are not followed.");
    for (let attempt = 0; attempt <= retryBudget; attempt += 1) {
      const startedAt = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs);
      try {
        let reservation = await options.reserveRequest?.();
        if (reservation && !reservation.allowed && reservation.retryAt) {
          const waitMs = Date.parse(reservation.retryAt) - Date.now();
          if (waitMs > 0 && waitMs <= 2_000) {
            await new Promise((resolve) => setTimeout(resolve, waitMs + 25));
            reservation = await options.reserveRequest?.();
          }
        }
        if (reservation && !reservation.allowed) {
          throw new PublicPageFetchError("rate_limited", "The website is cooling down to respect its public request limits.", {
            retryAfterMs: reservation.retryAt ? Math.max(0, Date.parse(reservation.retryAt) - Date.now()) : undefined,
          });
        }
        const identity = options.network?.next();
        const headers: Record<string, string> = {
          "User-Agent": identity?.userAgent ?? "Nexus/1.0 (+public product monitor)",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9",
        };
        if (options.conditional?.pageEtag) headers["If-None-Match"] = options.conditional.pageEtag;
        if (options.conditional?.pageLastModified) headers["If-Modified-Since"] = options.conditional.pageLastModified;
        const requestInit: RequestInit & { dispatcher?: ReturnType<ScraperNetwork["next"]>["dispatcher"] } = {
          redirect: "manual",
          signal: controller.signal,
          headers,
          ...(identity?.dispatcher ? { dispatcher: identity.dispatcher } : {}),
        };
        const response = await fetch(current, requestInit);
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get("location");
          if (!location) throw new Error("Website redirect was incomplete.");
          await emitAttempt(options, {
            url: current.toString(), outcome: "fetched", reasonCode: "found", failureClass: "none",
            httpStatus: response.status, durationMs: Date.now() - startedAt, message: "Followed a same-store redirect.",
          });
          current = new URL(location, current);
          continue redirects;
        }
        const responseMeta = {
          etag: response.headers.get("etag") || undefined,
          lastModified: response.headers.get("last-modified") || undefined,
          httpStatus: response.status,
        };
        if (response.status === 304) {
          await emitAttempt(options, { url: current.toString(), outcome: "fetched", reasonCode: "found", failureClass: "none", httpStatus: 304, durationMs: Date.now() - startedAt });
          return { url: current.toString(), html: "", notModified: true, durationMs: Date.now() - startedAt, ...responseMeta };
        }
        const contentType = response.headers.get("content-type") ?? "";
        const declared = Number(response.headers.get("content-length") || 0);
        if (declared > maxBytes) throw new PublicPageFetchError("response_too_large", "The page is too large to search safely.", { httpStatus: response.status });
        if (response.ok && !/html|xml|text/i.test(contentType)) {
          throw new PublicPageFetchError("http_client_error", "The URL did not return a public webpage.", { httpStatus: response.status });
        }
        const html = await readPublicText(response, maxBytes);
        const responseBytes = new TextEncoder().encode(html).byteLength;
        const detectedChallenge = detectAccessChallenge(html, options.blockPatterns);
        if (detectedChallenge) {
          throw new PublicPageFetchError("challenge", detectedChallenge.message, {
            httpStatus: response.status, reasonCode: detectedChallenge.reasonCode,
            failureClass: detectedChallenge.failureClass, challengeType: detectedChallenge.challengeType,
          });
        }
        if (response.status === 401) {
          throw new PublicPageFetchError("challenge", "Website requires a login before this page can be viewed.", { httpStatus: 401, reasonCode: "login_wall", failureClass: "permanent", challengeType: "login_wall" });
        }
        if (response.status === 403) throw new PublicPageFetchError("blocked", "Website blocked the public request (403).", { httpStatus: 403, reasonCode: "blocked" });
        if (response.status === 429) throw new PublicPageFetchError("rate_limited", "Website rate-limited the public request (429).", { httpStatus: 429, retryAfterMs: retryAfterMs(response.headers.get("retry-after")), reasonCode: "rate_limited" });
        if (response.status >= 500 || response.status === 408) {
          throw new PublicPageFetchError("unavailable", `Website is temporarily unavailable (${response.status}).`, { httpStatus: response.status, retryAfterMs: retryAfterMs(response.headers.get("retry-after")), reasonCode: response.status === 408 ? "timeout" : "http_server_error" });
        }
        if (!response.ok) throw new PublicPageFetchError("http_client_error", `Website returned ${response.status}.`, { httpStatus: response.status, reasonCode: "http_client_error", failureClass: "permanent" });
        const knownBad = matchKnownBadPattern(current.toString(), html, options.knownBadPatterns ?? []);
        if (knownBad) throw new PublicPageFetchError("http_client_error", knownBad.reason || "Page matched a known-bad extraction rule.", { httpStatus: response.status, reasonCode: "known_bad_pattern", failureClass: "permanent" });
        const contentHash = contentFingerprint(html);
        const durationMs = Date.now() - startedAt;
        await emitAttempt(options, {
          url: current.toString(), outcome: "fetched", reasonCode: "found", failureClass: "none",
          httpStatus: response.status, durationMs, responseBytes, contentHash,
        });
        return { url: current.toString(), html, responseBytes, contentHash, durationMs, ...responseMeta };
      } catch (error) {
        const failure = normalizeFetchError(error, controller.signal.aborted, options.timeoutMs);
        if (failure) {
          await emitAttempt(options, {
            url: current.toString(), outcome: attemptOutcome(failure), reasonCode: failure.reasonCode,
            failureClass: failure.failureClass, challengeType: failure.challengeType,
            httpStatus: failure.httpStatus, durationMs: Date.now() - startedAt, message: failure.message,
          });
        }
        if ((failure?.kind === "unavailable" || failure?.kind === "timeout") && attempt < retryBudget && consumeRetry(options.retryState)) {
          await delay(Math.min(failure.retryAfterMs ?? 250 * 2 ** attempt, 2_000));
          continue;
        }
        if (failure?.kind === "rate_limited" && failure.retryAfterMs != null && failure.retryAfterMs <= 2_000 && attempt < retryBudget && consumeRetry(options.retryState)) {
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

function consumeRetry(state: { remaining: number } | undefined) {
  if (!state) return true;
  if (state.remaining <= 0) return false;
  state.remaining -= 1;
  return true;
}

function normalizeFetchError(error: unknown, aborted: boolean, timeoutMs: number) {
  if (error instanceof PublicPageFetchError) return error;
  if (aborted || (error instanceof Error && error.name === "AbortError")) {
    return new PublicPageFetchError("timeout", `Website did not respond within ${Math.ceil(timeoutMs / 1000)} seconds.`, { reasonCode: "timeout" });
  }
  if (error instanceof TypeError) return new PublicPageFetchError("unavailable", "Website connection failed.", { reasonCode: "network_error" });
  return undefined;
}

function retryAfterMs(value: string | null) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, 6 * 60 * 60 * 1_000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, Math.min(date - Date.now(), 6 * 60 * 60 * 1_000)) : undefined;
}

function reasonCodeForFetchKind(kind: PublicPageFetchError["kind"]): ScraperReasonCode {
  if (kind === "timeout") return "timeout";
  if (kind === "blocked") return "blocked";
  if (kind === "challenge") return "bot_wall";
  if (kind === "rate_limited") return "rate_limited";
  if (kind === "response_too_large") return "response_too_large";
  if (kind === "http_client_error") return "http_client_error";
  return "http_server_error";
}

function reasonCodeForResult(result: ProductSearchResult): ScraperReasonCode {
  if (result.status === "found") return "found";
  if (result.status === "not_found") return "not_found";
  if (result.status === "blocked") return "blocked";
  if (result.status === "unavailable") return result.httpStatus && result.httpStatus >= 500 ? "http_server_error" : "network_error";
  if (!result.evidence?.exactEan) return "wrong_product";
  if (!result.priceCents) return "price_missing";
  return "low_confidence";
}

function attemptOutcome(failure: PublicPageFetchError): ScraperStatus {
  if (failure.kind === "blocked" || failure.kind === "challenge") return "blocked";
  if (failure.reasonCode === "known_bad_pattern") return "needs_review";
  if (failure.failureClass === "permanent") return "not_found";
  return "unavailable";
}

async function emitAttempt(options: FetchPublicPageOptions, attempt: Omit<ScraperAttempt, "profileId" | "profileLabel">) {
  try {
    await options.onAttempt?.({ ...attempt, profileId: options.profileId, profileLabel: options.profileLabel });
  } catch {
    // Observability must never turn an otherwise safe public-page request into
    // a scraper failure.
  }
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
        throw new PublicPageFetchError("response_too_large", "The page is too large to search safely.", { reasonCode: "response_too_large" });
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

function isHostTerminalFailure(failure: PublicPageFetchError) {
  return failure.kind === "blocked" || failure.kind === "challenge" || failure.kind === "rate_limited";
}

function extractLikelyLinks(page: Page, productName: string, ean: string, hostname: string) {
  const terms = productName.toLowerCase().split(/\s+/).filter((word) => word.length > 2);
  const links: { url: string; score: number }[] = [];
  const canonical = page.html.match(/<link\b[^>]*rel=["'][^"']*canonical[^"']*["'][^>]*href=["']([^"']+)["']|<link\b[^>]*href=["']([^"']+)["'][^>]*rel=["'][^"']*canonical[^"']*["']/i);
  if (canonical) {
    try {
      const url = new URL(canonical[1] || canonical[2], page.url);
      if (sameStoreHostname(url.hostname, hostname)) links.push({ url: url.toString(), score: 30 });
    } catch { /* ignore malformed canonical links */ }
  }
  const regex = /<(?:a|article)\b([^>]*?(?:href|data-product-url)=["']([^"']+)["'][^>]*)>([\s\S]*?)<\/(?:a|article)>/gi;
  for (const match of page.html.matchAll(regex)) {
    const label = stripHtml(match[3]).toLowerCase();
    let url: URL;
    try { url = new URL(match[2], page.url); } catch { continue; }
    if (!sameStoreHostname(url.hostname, hostname) || !['http:', 'https:'].includes(url.protocol)) continue;
    const haystack = `${url.pathname} ${label}`.toLowerCase();
    const identityScore = (haystack.includes(ean) ? 20 : 0) + terms.filter((term) => haystack.includes(term)).length;
    const routeScore = /\/(?:products?|items?|p|dp|catalog)\//i.test(url.pathname) ? 4 : /variant|offer|discount|sale/i.test(url.pathname + url.search) ? 2 : 0;
    const score = identityScore + routeScore;
    if (score > 0) links.push({ url: url.toString(), score });
  }
  return [...new Map(links.sort((a, b) => b.score - a.score).map((link) => [link.url, link])).values()].slice(0, 8).map((link) => link.url);
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

function mergeExtractionProfiles(base: StoreExtractionProfile | undefined, override: StoreExtractionProfile | undefined) {
  if (!base) return override;
  if (!override) return base;
  return {
    ...base,
    ...override,
    id: base.id,
    blockPatterns: [...new Set([...(base.blockPatterns ?? []), ...(override.blockPatterns ?? [])])],
  };
}
