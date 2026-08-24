export type ScraperStatus = "found" | "not_found" | "blocked" | "unavailable" | "needs_review";

export type PriceSource = "structured" | "profile-selector" | "product-meta" | "product-element" | "ean-context" | "name-context";

export type ScraperConfidence = "high" | "medium" | "low";

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
};

export type ProductEvidence = {
  exactEan: boolean;
  structuredExactEan: boolean;
  structuredProduct: boolean;
  nameScore: number;
  priceSource?: PriceSource;
  canonicalUrl: string;
  profileId?: string;
  checkedAt: string;
};

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
}) => Promise<RenderedPage | undefined>;
