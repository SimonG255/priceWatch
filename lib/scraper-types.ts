export type ScraperStatus = "found" | "not_found" | "blocked" | "unavailable" | "needs_review";

export type PriceSource = "structured" | "profile-selector" | "product-meta" | "product-element" | "ean-context" | "name-context";

export type ScraperConfidence = "high" | "medium" | "low";

export type ScraperReasonCode =
  | "found"
  | "blocked"
  | "not_found"
  | "wrong_product"
  | "low_confidence"
  | "price_missing"
  | "rate_limited"
  | "timeout"
  | "response_too_large"
  | "robots_disallowed"
  | "known_bad_pattern"
  | "profile_drift"
  | "stale_result"
  | "captcha"
  | "bot_wall"
  | "login_wall"
  | "js_challenge"
  | "http_client_error"
  | "http_server_error"
  | "network_error";

export type ScraperFailureClass = "none" | "temporary" | "permanent";

export type ChallengeType = "captcha" | "bot_wall" | "login_wall" | "js_challenge";

export type ConfidenceScores = {
  /** Exact or structured barcode identity evidence, from 0 to 100. */
  ean: number;
  /** Product-name similarity, from 0 to 100. */
  name: number;
  /** Likelihood that the selected amount is the current product price. */
  price: number;
  /** Trust in the extraction source/profile, from 0 to 100. */
  source: number;
  /** Weighted overall score used for automatic acceptance. */
  overall: number;
};

export type SiteType = "auto" | "standard" | "slow" | "large" | "javascript" | "marketplace";

export type ScraperBudget = {
  timeoutMs: number;
  maxPageBytes: number;
  retryBudget: number;
  renderTimeoutMs: number;
  maxRenderedBytes: number;
};

/**
 * Store-specific extraction hints. They can improve evidence selection but
 * never turn an unverified page into a product match on their own.
 */
export type StoreExtractionProfile = {
  id?: string;
  productSelector?: string;
  eanSelector?: string;
  priceSelector?: string;
  jsonLdEanFields?: string[];
  jsonLdPriceFields?: string[];
  jsonLdCurrencyFields?: string[];
  blockPatterns?: string[];
  allowRenderedFallback?: boolean;
  siteType?: SiteType;
  timeoutMs?: number;
  maxPageBytes?: number;
  retryBudget?: number;
};

export type ProductEvidence = {
  exactEan: boolean;
  structuredExactEan: boolean;
  structuredProduct: boolean;
  nameScore: number;
  priceSource?: PriceSource;
  confidenceScores?: ConfidenceScores;
  contentHash?: string;
  canonicalUrl: string;
  profileId?: string;
  checkedAt: string;
};

export type ScraperAttempt = {
  url: string;
  profileId?: string;
  profileLabel?: string;
  outcome: ScraperStatus | "skipped" | "fetched";
  reasonCode: ScraperReasonCode;
  failureClass: ScraperFailureClass;
  challengeType?: ChallengeType;
  httpStatus?: number;
  durationMs: number;
  responseBytes?: number;
  contentHash?: string;
  message?: string;
};

export type KnownBadPattern = {
  id: string;
  hostname: string;
  urlPattern?: string;
  contentPattern?: string;
  reason?: string;
};

export type CachedProductMatch = {
  url: string;
  title: string;
  eanMatch: boolean;
  nameScore: number;
  priceCents?: number;
  currency?: string;
  inStock?: boolean;
  priceSource?: PriceSource;
  structuredProduct: boolean;
  structuredExactEan: boolean;
  canonicalUrl: string;
  confidence: ScraperConfidence;
  confidenceScores: ConfidenceScores;
  score: number;
};

export interface ScraperResultCache {
  get(input: { url: string; ean: string; contentHash: string }): Promise<CachedProductMatch | undefined>;
  put(input: { url: string; ean: string; contentHash: string; match: CachedProductMatch }): Promise<void>;
  invalidate?(input: { url: string; ean: string; exceptContentHash?: string }): Promise<void>;
}

export type PreviousVerifiedProduct = {
  status: string;
  matchedUrl?: string | null;
  title?: string | null;
  priceCents?: number | null;
  currency?: string | null;
  inStock?: boolean | null;
  matchType?: string | null;
  confidence?: string | null;
  evidence?: ProductEvidence | null;
  pageEtag?: string | null;
  pageLastModified?: string | null;
};

export type SitemapProductCacheEntry = {
  candidateUrl: string;
  sitemapUrl?: string;
  sitemapLastmod?: string;
  cachedAt?: string;
};

/**
 * The scraper stays database-agnostic. The API layer supplies this small
 * adapter so cached sitemap candidates can be reused across checks.
 */
export interface SitemapProductCache {
  get(input: { hostname: string; ean: string }): Promise<SitemapProductCacheEntry | undefined>;
  put(input: { hostname: string; ean: string; entry: SitemapProductCacheEntry }): Promise<void>;
  invalidate?(input: { hostname: string; ean: string; candidateUrl?: string }): Promise<void>;
}

export type RenderedPage = { url: string; html: string };

export type PermittedPageRenderer = (input: {
  url: string;
  hostname: string;
  waitForSelector?: string;
  timeoutMs?: number;
  maxBytes?: number;
}) => Promise<RenderedPage | undefined>;
