import type { ConfidenceScores, PriceSource, ScraperConfidence, StoreExtractionProfile } from "./scraper-types.ts";

export type ExtractedProductMatch = {
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

type JsonRecord = Record<string, unknown>;
type PriceCandidate = { priceCents: number; currency?: string; score: number; source: ExtractedProductMatch["priceSource"] };
type StructuredCandidate = {
  name?: string; url?: string; exactEan: boolean; nameScore: number; priceCents?: number; currency?: string;
  availability?: string; score: number;
};

export function extractProductMatch(html: string, pageUrl: string, productName: string, ean: string, profile?: StoreExtractionProfile): ExtractedProductMatch {
  const scopedHtml = profile?.productSelector ? findSimpleSelectorHtml(html, profile.productSelector) || html : html;
  const rawJsonDocument = looksLikeJsonDocument(scopedHtml);
  const visibleText = rawJsonDocument ? "" : stripHtml(scopedHtml).replace(/\s+/g, " ").trim();
  const pageTitle = extractMeta(html, "og:title") || extractTag(html, "h1") || extractTag(html, "title") || "";
  const profileEan = profile?.eanSelector ? findSimpleSelectorText(html, profile.eanSelector) : undefined;
  // Raw markup can echo the requested barcode in a query URL, hidden input, or
  // script. Only rendered text, explicit selectors, and structured product
  // identifiers count as identity evidence.
  const pageEanMatch = containsBarcode(visibleText, ean) || Boolean(profileEan && containsBarcode(profileEan, ean));
  const pageNameScore = scoreName(productName, `${pageTitle} ${visibleText.slice(0, 120_000)}`);
  const structuredCandidates = extractStructuredCandidates(html, productName, ean, pageEanMatch, profile);
  const structured = structuredCandidates.sort((a, b) => b.score - a.score)[0];
  const identityEanMatch = structured?.exactEan || pageEanMatch;
  const identityNameScore = Math.max(pageNameScore, structured?.nameScore ?? 0);

  const htmlPrices = identityEanMatch || identityNameScore >= 0.65
    ? extractHtmlPriceCandidates(scopedHtml, visibleText, productName, ean, identityEanMatch, identityNameScore)
    : [];
  const htmlPrice = htmlPrices.sort((a, b) => b.score - a.score)[0];
  const profilePrice = extractProfilePriceCandidate(html, profile, identityEanMatch, identityNameScore);

  let selectedPrice: PriceCandidate | undefined;
  if (structured?.priceCents != null && (structured.exactEan || structured.nameScore >= 0.65)) {
    selectedPrice = { priceCents: structured.priceCents, currency: structured.currency, score: structured.score + 80, source: "structured" };
  }
  if (profilePrice && (!selectedPrice || profilePrice.score > selectedPrice.score)) selectedPrice = profilePrice;
  if (htmlPrice && (!selectedPrice || (identityEanMatch && htmlPrice.score > selectedPrice.score))) selectedPrice = htmlPrice;

  const availability = structured?.availability || extractMeta(html, "product:availability") || extractMeta(html, "og:availability") || extractVisibleAvailability(scopedHtml);
  const inStock = availability
    ? /out\s*of\s*stock|sold\s*out|not\s+available|unavailable|discontinued|ni\s+na\s+zalogi|razprodano/i.test(availability) ? false
      : /in\s*stock|available|preorder|limitedavailability|na\s+zalogi|dobavljivo/i.test(availability) ? true : undefined
    : undefined;
  const title = structured?.name || pageTitle;
  const structuredUrl = safeResolveUrl(structured?.url, pageUrl);
  const canonicalUrl = extractCanonicalUrl(html, pageUrl) || (sameSiteUrl(structuredUrl, pageUrl) ? structuredUrl : pageUrl);
  const resolvedUrl = canonicalUrl;
  const confidenceScores = confidenceScoresFor({
    exactEan: identityEanMatch,
    structuredExactEan: structuredCandidates.some((candidate) => candidate.exactEan),
    nameScore: identityNameScore,
    price: selectedPrice,
    structuredProduct: structuredCandidates.length > 0,
    profilePrice: Boolean(profilePrice && profilePrice === selectedPrice),
  });
  const score = confidenceScores.overall * 3 + (structured ? 12 : 0);

  return {
    url: resolvedUrl,
    title,
    eanMatch: identityEanMatch,
    nameScore: identityNameScore,
    priceCents: selectedPrice?.priceCents,
    currency: selectedPrice?.currency,
    inStock,
    priceSource: selectedPrice?.source,
    structuredProduct: structuredCandidates.length > 0,
    structuredExactEan: structuredCandidates.some((candidate) => candidate.exactEan),
    canonicalUrl,
    confidence: confidenceFor(confidenceScores),
    confidenceScores,
    score,
  };
}

function extractStructuredCandidates(html: string, productName: string, ean: string, pageEanMatch: boolean, profile?: StoreExtractionProfile) {
  const candidates: StructuredCandidate[] = [];
  const documents = extractJsonDocuments(html);
  const graph = new Map<string, JsonRecord>();
  let collectedNodes = 0;
  const collect = (value: unknown, depth = 0) => {
    if (depth > 14 || collectedNodes >= 25_000) return;
    if (!value || typeof value !== "object") return;
    collectedNodes += 1;
    if (Array.isArray(value)) { value.forEach((entry) => collect(entry, depth + 1)); return; }
    const item = value as JsonRecord;
    if (typeof item["@id"] === "string") graph.set(item["@id"], item);
    Object.values(item).forEach((entry) => collect(entry, depth + 1));
  };
  documents.forEach((document) => collect(document));
  let visitedNodes = 0;
  const visit = (value: unknown, depth = 0) => {
    if (depth > 14 || visitedNodes >= 25_000) return;
    if (!value || typeof value !== "object") return;
    visitedNodes += 1;
    if (Array.isArray(value)) { value.forEach((entry) => visit(entry, depth + 1)); return; }
    const item = value as JsonRecord;
    const types = Array.isArray(item["@type"]) ? item["@type"] : [item["@type"]];
    if (types.some(type => /^(product|productgroup)$/i.test(String(type ?? "")))) {
      const identifiers = [item.gtin, item.gtin8, item.gtin12, item.gtin13, item.gtin14, item.ean, item.ean13, item.barcode, item.productID, item.sku, item.mpn]
        .flatMap(value => Array.isArray(value) ? value : [value])
        .concat(profile?.jsonLdEanFields?.flatMap((path) => jsonPathValues(item, path)) ?? [])
        .filter(value => value != null)
        .map(value => digitsOnly(String(value)));
      const exactEan = identifiers.includes(ean);
      const name = typeof item.name === "string" ? decodeEntities(item.name).trim() : undefined;
      const nameScore = scoreName(productName, name || JSON.stringify(item).slice(0, 10_000));
      const offers = (Array.isArray(item.offers) ? item.offers : [item.offers]).map((candidate) => {
        const record = asRecord(candidate);
        return record && typeof record["@id"] === "string" ? graph.get(record["@id"]) ?? record : candidate;
      });
      const offer = chooseOffer(offers);
      const price = configuredPrice(item, offer, profile?.jsonLdPriceFields) ?? (offer ? extractOfferPrice(offer) : undefined);
      const currency = configuredCurrency(item, offer, profile?.jsonLdCurrencyFields) ?? (offer ? firstString(offer.priceCurrency, asRecord(offer.priceSpecification)?.priceCurrency) : undefined);
      const availability = offer ? firstString(offer.availability) : undefined;
      const url = firstString(offer?.url, item.url, item["@id"]);
      const score = (exactEan ? 260 : 0) + nameScore * 90 + (price != null ? 24 : 0) + (pageEanMatch ? 8 : 0);
      candidates.push({ name, url, exactEan, nameScore, priceCents: price, currency: normalizeCurrency(currency), availability, score });
    } else {
      const candidate = genericStructuredCandidate(item, productName, ean);
      if (candidate) candidates.push(candidate);
    }
    Object.values(item).forEach((entry) => visit(entry, depth + 1));
  };
  documents.forEach((document) => visit(document));
  return candidates;
}

function extractJsonDocuments(html: string) {
  const documents: unknown[] = [];
  const parse = (raw: string) => {
    const decoded = decodeEntities(raw).trim();
    if (!looksLikeJsonDocument(decoded) || decoded.length > 2_000_000) return;
    try { documents.push(JSON.parse(decoded)); } catch { /* ignore malformed embedded state */ }
  };
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const type = attribute(match[1], "type")?.toLowerCase() ?? "";
    const id = attribute(match[1], "id")?.toLowerCase() ?? "";
    if (/^application\/(?:ld\+)?json(?:;|$)/.test(type) || id === "__next_data__" || id === "__nuxt_data__") parse(match[2]);
  }
  if (looksLikeJsonDocument(html)) parse(html);
  return documents;
}

function genericStructuredCandidate(item: JsonRecord, productName: string, ean: string): StructuredCandidate | undefined {
  const identifiers = valuesForKeys(item, ["gtin", "gtin8", "gtin12", "gtin13", "gtin14", "ean", "ean8", "ean13", "ean14", "barcode", "productid", "sku", "mpn"])
    .map((value) => digitsOnly(String(value)));
  const exactEan = identifiers.includes(ean);
  const name = firstValueForKeys(item, ["name", "productname", "displayname", "title"]);
  const normalizedName = typeof name === "string" ? decodeEntities(name).trim() : undefined;
  const nameScore = scoreName(productName, normalizedName ?? "");
  const hasProductShape = exactEan || Object.keys(item).some((key) => /^(?:product|productdata|item|variant)$/i.test(key));
  if (!hasProductShape || !normalizedName || (!exactEan && nameScore < 0.65)) return undefined;
  const price = genericPrice(item);
  const currency = firstNestedValueForKeys(item, ["pricecurrency", "currency", "currencycode"], 3);
  const availabilityValue = firstNestedValueForKeys(item, ["availability", "stockstatus", "inventorystatus"], 2);
  const inStock = firstValueForKeys(item, ["instock", "isinstock"]);
  const availability = availabilityValue == null && typeof inStock === "boolean"
    ? (inStock ? "InStock" : "OutOfStock")
    : availabilityValue == null ? undefined : String(availabilityValue);
  const urlValue = firstValueForKeys(item, ["url", "canonicalurl", "producturl", "link"]);
  const url = typeof urlValue === "string" ? urlValue : undefined;
  const score = (exactEan ? 250 : 0) + nameScore * 86 + (price != null ? 22 : 0);
  return {
    name: normalizedName,
    url,
    exactEan,
    nameScore,
    priceCents: price,
    currency: currency == null ? undefined : normalizeCurrency(String(currency)),
    availability,
    score,
  };
}

function genericPrice(item: JsonRecord) {
  const candidates: Array<{ cents: number; score: number }> = [];
  const queue: Array<{ value: JsonRecord; depth: number; parent: string }> = [{ value: item, depth: 0, parent: "" }];
  const nestedContainers = /^(?:offer|offers|price|prices|pricing|variant|variants|sale|current)$/i;
  let visited = 0;
  while (queue.length && visited < 500) {
    const current = queue.shift()!;
    visited += 1;
    for (const [key, raw] of Object.entries(current.value)) {
      const normalizedKey = key.toLowerCase().replace(/[^a-z]/g, "");
      const path = `${current.parent}.${normalizedKey}`;
      const blocked = /(?:old|original|regular|list|rrp|msrp|shipping|delivery|discount|saving)/.test(path);
      const centsField = /(?:current|sale|final|selling|unit)?pricecents$/.test(normalizedKey);
      const priceField = /^(?:price|currentprice|saleprice|finalprice|sellingprice|unitprice|amount|value)$/.test(normalizedKey)
        && (current.depth === 0 || /price|pricing|offer|sale|current/.test(current.parent));
      if (!blocked && (centsField || priceField) && (typeof raw === "string" || typeof raw === "number")) {
        const parsed = centsField ? Number(raw) : parsePriceCents(String(raw));
        if (Number.isFinite(parsed) && Number(parsed) > 0 && Number(parsed) < 100_000_000) {
          candidates.push({ cents: Math.round(Number(parsed)), score: /current|sale|final|selling/.test(path) ? 30 : 10 });
        }
      }
      if (current.depth >= 3 || !nestedContainers.test(key)) continue;
      for (const child of (Array.isArray(raw) ? raw.slice(0, 50) : [raw])) {
        const record = asRecord(child);
        if (record) queue.push({ value: record, depth: current.depth + 1, parent: path });
      }
    }
  }
  return candidates.sort((left, right) => right.score - left.score)[0]?.cents;
}

function valuesForKeys(item: JsonRecord, keys: string[]) {
  const expected = new Set(keys.map((key) => key.toLowerCase()));
  return Object.entries(item)
    .filter(([key]) => expected.has(key.toLowerCase().replace(/[^a-z0-9]/g, "")))
    .flatMap(([, value]) => Array.isArray(value) ? value : [value])
    .filter((value) => value != null && typeof value !== "object");
}

function firstValueForKeys(item: JsonRecord, keys: string[]) {
  return valuesForKeys(item, keys)[0];
}

function firstNestedValueForKeys(item: JsonRecord, keys: string[], maximumDepth: number) {
  const queue: Array<{ value: unknown; depth: number }> = [{ value: item, depth: 0 }];
  let visited = 0;
  while (queue.length && visited < 500) {
    const current = queue.shift()!;
    visited += 1;
    const record = asRecord(current.value);
    if (!record) continue;
    const direct = firstValueForKeys(record, keys);
    if (direct != null) return direct;
    if (current.depth >= maximumDepth) continue;
    for (const value of Object.values(record)) {
      for (const child of (Array.isArray(value) ? value.slice(0, 50) : [value])) if (child && typeof child === "object") queue.push({ value: child, depth: current.depth + 1 });
    }
  }
  return undefined;
}

function looksLikeJsonDocument(value: string) {
  const trimmed = value.trim();
  return (trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"));
}

function chooseOffer(value: unknown): JsonRecord | undefined {
  const offers = (Array.isArray(value) ? value : [value]).map(asRecord).filter((offer): offer is JsonRecord => Boolean(offer));
  return offers.sort((a, b) => offerScore(b) - offerScore(a))[0];
}

function configuredPrice(product: JsonRecord, offer: JsonRecord | undefined, paths: string[] | undefined) {
  for (const path of paths ?? []) {
    for (const value of [...jsonPathValues(product, path), ...(offer ? jsonPathValues(offer, path) : [])]) {
      const parsed = parsePriceCents(String(value));
      if (parsed != null) return parsed;
    }
  }
  return undefined;
}

function configuredCurrency(product: JsonRecord, offer: JsonRecord | undefined, paths: string[] | undefined) {
  for (const path of paths ?? []) {
    for (const value of [...jsonPathValues(product, path), ...(offer ? jsonPathValues(offer, path) : [])]) {
      const currency = normalizeCurrency(String(value));
      if (currency) return currency;
    }
  }
  return undefined;
}

function jsonPathValues(value: unknown, path: string) {
  const parts = path.split(".").map((part) => part.trim()).filter(Boolean);
  if (!parts.length || parts.length > 5) return [];
  let current: unknown[] = [value];
  for (const part of parts) {
    current = current.flatMap((entry) => {
      if (Array.isArray(entry)) return entry.flatMap((item) => asRecord(item)?.[part] ?? []);
      return asRecord(entry)?.[part] ?? [];
    });
  }
  return current.flatMap((entry) => Array.isArray(entry) ? entry : [entry]).filter((entry) => entry != null && typeof entry !== "object");
}

function offerScore(offer: JsonRecord) {
  return (extractOfferPrice(offer) != null ? 20 : 0) + (/instock|preorder|limitedavailability/i.test(String(offer.availability ?? "")) ? 6 : 0) + (offer.price != null ? 4 : 0);
}

function extractOfferPrice(offer: JsonRecord) {
  const specification = asRecord(offer.priceSpecification);
  const raw = offer.salePrice ?? offer.currentPrice ?? offer.price ?? specification?.price ?? offer.lowPrice;
  return raw == null ? undefined : parsePriceCents(String(raw));
}

function extractProfilePriceCandidate(html: string, profile: StoreExtractionProfile | undefined, eanMatch: boolean, nameScore: number): PriceCandidate | undefined {
  if (!profile?.priceSelector) return undefined;
  const value = findSimpleSelectorText(html, profile.priceSelector);
  if (!value) return undefined;
  const priceCents = parsePriceCents(value);
  if (priceCents == null) return undefined;
  return {
    priceCents,
    currency: normalizeCurrency(detectCurrency(value)),
    score: 210 + (eanMatch ? 80 : nameScore * 40),
    source: "profile-selector",
  };
}

function extractHtmlPriceCandidates(html: string, visibleText: string, productName: string, ean: string, eanMatch: boolean, nameScore: number) {
  const candidates: PriceCandidate[] = [];
  const documentCurrency = normalizeCurrency(extractMeta(html, "product:price:currency") || extractMeta(html, "og:price:currency") || detectCurrency(visibleText));
  const push = (raw: string, baseScore: number, source: PriceCandidate["source"], context = "") => {
    for (const amount of parsePriceValues(raw)) {
      const currency = normalizeCurrency(detectCurrency(`${raw} ${context}`) || documentCurrency);
      const identityBonus = eanMatch ? 70 : nameScore * 35;
      candidates.push({ priceCents: amount, currency, score: baseScore + identityBonus, source });
    }
  };

  for (const property of ["product:price:amount", "og:price:amount"]) {
    const value = extractMeta(html, property);
    if (value) push(value, 115, "product-meta", property);
  }

  for (const property of ["twitter:data1", "price", "sale_price", "product:sale_price:amount"]) {
    const value = extractMeta(html, property);
    if (value) push(value, /sale/i.test(property) ? 142 : 82, "product-meta", property);
  }

  for (const match of html.matchAll(/<(meta|link|input)\b([^>]*?(?:itemprop=["']price["']|data-(?:product-)?price\b|property=["'](?:product|og):price:amount["'])[^>]*)>/gi)) {
    const attributes = match[2];
    const raw = attribute(attributes, "content") || attribute(attributes, "value") || attribute(attributes, "data-product-price") || attribute(attributes, "data-price");
    if (raw) push(raw, /itemprop/i.test(attributes) ? 110 : 100, "product-meta", attributes);
  }

  const elementPattern = /<([a-z][\w:-]*)\b([^>]*(?:class|id|itemprop|data-testid)=["'][^"']*(?:price|cost)[^"']*["'][^>]*)>([\s\S]{0,900}?)<\/\1>/gi;
  for (const match of html.matchAll(elementPattern)) {
    const attributes = match[2];
    const content = stripHtml(match[3]).replace(/\s+/g, " ").trim();
    if (!content) continue;
    let score = 62;
    if (/itemprop=["']price["']/i.test(attributes)) score += 42;
    if (/(?:current|sale|special|final|now|our)[-_\s]*(?:price|cost)|(?:price|cost)[-_\s]*(?:current|sale|special|final|now|our)/i.test(attributes)) score += 38;
    if (/(?:old|was|original|regular|compare|strike|list|rrp|msrp)[-_\s]*(?:price|cost)|(?:price|cost)[-_\s]*(?:old|was|original|regular|compare|strike|list|rrp|msrp)/i.test(attributes)) score -= 85;
    if (/<(?:s|del)\b/i.test(match[3])) score -= 65;
    if (score > 20) push(content, score, "product-element", attributes);
  }

  const eanWindow = evidenceWindow(visibleText, ean, 1800);
  if (eanWindow) pushLabeledContextPrices(eanWindow, 54, "ean-context", push);
  const nameWindow = evidenceWindow(visibleText, productName, 1400);
  if (nameWindow) pushLabeledContextPrices(nameWindow, 35, "name-context", push);

  return deduplicatePrices(candidates);
}

function pushLabeledContextPrices(window: string, baseScore: number, source: PriceCandidate["source"], push: (raw: string, baseScore: number, source: PriceCandidate["source"], context?: string) => void) {
  const patterns = [
    /(?:current\s+price|sale\s+price|our\s+price|now|price)\s*[:\-]?\s*(?:€|EUR|\$|USD|£|GBP|CHF|PLN|SEK)?\s*\d{1,8}(?:(?:[ .,'’]\d{3})+)?(?:[.,]\d{1,2})?\s*(?:€|EUR|USD|GBP|CHF|PLN|SEK)?/gi,
    /(?:€|EUR|\$|USD|£|GBP|CHF|PLN|SEK)\s*\d{1,8}(?:(?:[ .,'’]\d{3})+)?(?:[.,]\d{1,2})?\s*(?:current|today|now)/gi,
  ];
  for (const pattern of patterns) {
    for (const match of window.matchAll(pattern)) {
      const nearby = window.slice(Math.max(0, (match.index ?? 0) - 45), Math.min(window.length, (match.index ?? 0) + match[0].length + 45));
      if (/shipping|delivery|postage|per\s+month|monthly|save\s+|discount|was\s+|old\s+price/i.test(nearby)) continue;
      push(match[0], baseScore + (/current|sale|our\s+price|now/i.test(match[0]) ? 18 : 0), source, nearby);
    }
  }
}

function evidenceWindow(text: string, needle: string, radius: number) {
  const normalizedNeedle = needle.toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalizedNeedle) return undefined;
  let index = text.toLowerCase().indexOf(normalizedNeedle);
  if (index < 0 && /^\d+$/.test(normalizedNeedle)) {
    const match = new RegExp(normalizedNeedle.split("").join("[\\s-]*")).exec(text);
    index = match?.index ?? -1;
  }
  return index < 0 ? undefined : text.slice(Math.max(0, index - radius), Math.min(text.length, index + normalizedNeedle.length + radius));
}

function deduplicatePrices(candidates: PriceCandidate[]) {
  const deduped = new Map<string, PriceCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.priceCents}:${candidate.currency || ""}`;
    const existing = deduped.get(key);
    if (!existing || candidate.score > existing.score) deduped.set(key, candidate);
  }
  return [...deduped.values()];
}

export function parsePriceCents(raw: string): number | undefined {
  return parsePriceValues(raw)[0];
}

function parsePriceValues(raw: string) {
  const matches = decodeEntities(raw).match(/\d{1,3}(?:(?:[ .,'’]\d{3})+)(?:[.,]\d{1,2})?|\d{1,8}(?:[.,]\d{1,2})?/g) || [];
  const values: number[] = [];
  for (const match of matches) {
    let token = match.replace(/[\s'’]/g, "");
    const dot = token.lastIndexOf("."); const comma = token.lastIndexOf(",");
    if (dot >= 0 && comma >= 0) {
      const decimal = dot > comma ? "." : ",";
      token = token.replace(decimal === "." ? /,/g : /\./g, "").replace(decimal, ".");
    } else {
      const separator = dot >= 0 ? "." : comma >= 0 ? "," : "";
      if (separator) {
        const pieces = token.split(separator);
        const last = pieces.at(-1) || "";
        if (pieces.length > 2 || last.length === 3) token = pieces.join("");
        else token = `${pieces.slice(0, -1).join("")}.${last}`;
      }
    }
    const amount = Number(token);
    if (Number.isFinite(amount) && amount > 0 && amount < 100_000_000) values.push(Math.round(amount * 100));
  }
  return [...new Set(values)];
}

function scoreName(expected: string, candidate: string) {
  const tokens = expected.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter(token => token.length > 1);
  if (!tokens.length) return 0;
  const haystack = candidate.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ");
  return tokens.filter(token => haystack.includes(token)).length / tokens.length;
}

function confidenceScoresFor(input: {
  exactEan: boolean;
  structuredExactEan: boolean;
  nameScore: number;
  price?: PriceCandidate;
  structuredProduct: boolean;
  profilePrice: boolean;
}): ConfidenceScores {
  const ean = input.structuredExactEan ? 100 : input.exactEan ? 88 : 0;
  const name = Math.round(Math.max(0, Math.min(1, input.nameScore)) * 100);
  const price = !input.price ? 0 : Math.max(35, Math.min(100, Math.round((input.price.score - 45) / 2)));
  const source = sourceConfidence(input.price?.source, input.structuredProduct, input.profilePrice);
  const overall = Math.round(ean * 0.42 + name * 0.22 + price * 0.22 + source * 0.14);
  return { ean, name, price, source, overall };
}

function sourceConfidence(source: PriceSource | undefined, structuredProduct: boolean, profilePrice: boolean) {
  if (source === "structured") return 98;
  if (profilePrice || source === "profile-selector") return 90;
  if (source === "product-meta") return 82;
  if (source === "product-element") return 72;
  if (source === "ean-context") return 62;
  if (source === "name-context") return 48;
  return structuredProduct ? 40 : 20;
}

function confidenceFor(scores: ConfidenceScores): ScraperConfidence {
  if (scores.overall >= 86 && scores.ean >= 88 && scores.price >= 70 && scores.source >= 95) return "high";
  if (scores.overall >= 68 && scores.price >= 45) return "medium";
  return "low";
}

function containsBarcode(value: string, ean: string) {
  return new RegExp(`(?:^|\\D)${ean.split("").join("[\\s-]*")}(?!\\d)`).test(value);
}

function extractMeta(html: string, property: string) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const first = html.match(new RegExp(`<meta\\b[^>]*(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']+)["']`, "i"));
  const second = html.match(new RegExp(`<meta\\b[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']${escaped}["']`, "i"));
  return decodeEntities(first?.[1] || second?.[1] || "").trim() || undefined;
}

function extractTag(html: string, tag: string) {
  return decodeEntities(stripHtml(html.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1] || "")).trim() || undefined;
}

function extractCanonicalUrl(html: string, fallback: string) {
  for (const match of html.matchAll(/<link\b([^>]*)>/gi)) {
    const attributes = parseAttributes(match[1]);
    if (!/(^|\s)canonical(\s|$)/i.test(attributes.rel || "") || !attributes.href) continue;
    const resolved = safeResolveUrl(attributes.href, fallback);
    try {
      if (sameSiteUrl(resolved, fallback)) return resolved;
    } catch {
      // Ignore malformed canonical links.
    }
  }
  return undefined;
}

function findSimpleSelectorText(html: string, selector: string) {
  const selected = findSimpleSelectorHtml(html, selector);
  return selected ? stripHtml(selected).replace(/\s+/g, " ").trim() : undefined;
}

/**
 * Supports a deliberately small, safe selector subset for profile data:
 * tag, .class, #id, [itemprop=price], and [data-*=value]. It is not a CSS
 * engine, so an admin-provided selector can never execute code or a regex.
 */
function findSimpleSelectorHtml(html: string, selector: string) {
  const parsed = parseSimpleSelector(selector);
  if (!parsed) return undefined;
  const openingTag = /<([a-z][\w:-]*)\b([^>]*)>/gi;
  for (const match of html.matchAll(openingTag)) {
    const tag = match[1].toLowerCase();
    const attributes = parseAttributes(match[2]);
    if (parsed.tag && tag !== parsed.tag) continue;
    if (parsed.id && attributes.id !== parsed.id) continue;
    if (parsed.className && !attributes.class?.split(/\s+/).includes(parsed.className)) continue;
    if (parsed.attribute && !(parsed.attribute in attributes)) continue;
    if (parsed.attribute && parsed.hasAttributeValue && attributes[parsed.attribute] !== parsed.value) continue;
    if (["meta", "link", "input"].includes(tag)) return attributes.content || attributes.value || attributes[parsed.attribute || ""] || undefined;
    const start = (match.index ?? 0) + match[0].length;
    const close = new RegExp(`</${tag}\\s*>`, "i").exec(html.slice(start));
    return close ? html.slice(match.index ?? 0, start + close.index + close[0].length) : match[0];
  }
  return undefined;
}

function parseSimpleSelector(input: string) {
  const selector = input.trim();
  const match = selector.match(/^(?:([a-z][\w-]*))?(?:#([\w-]+)|\.([\w-]+)|\[([a-z][\w-]*)(?:=(?:"([^"]*)"|'([^']*)'|([\w.-]+)))?\])?$/i);
  if (!match || (!match[1] && !match[2] && !match[3] && !match[4])) return undefined;
  const attribute = match[4]?.toLowerCase();
  const hasAttributeValue = match[5] !== undefined || match[6] !== undefined || match[7] !== undefined;
  const value = match[5] ?? match[6] ?? match[7] ?? "";
  if (attribute && !/^(?:data-[\w-]+|itemprop|data-testid|id|class)$/i.test(attribute)) return undefined;
  return { tag: match[1]?.toLowerCase(), id: match[2], className: match[3], attribute, value, hasAttributeValue };
}

function attribute(attributes: string, name: string) {
  const match = attributes.match(new RegExp(`\\b${name.replace(/-/g, "\\-")}\\s*=\\s*["']([^"']+)["']`, "i"));
  return match ? decodeEntities(match[1]).trim() : undefined;
}

function parseAttributes(fragment: string) {
  const attributes: Record<string, string> = {};
  for (const match of fragment.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    attributes[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attributes;
}

function detectCurrency(value: string) {
  if (/€|\bEUR\b/i.test(value)) return "EUR";
  if (/£|\bGBP\b/i.test(value)) return "GBP";
  if (/\bNOK\b/i.test(value)) return "NOK";
  if (/\bDKK\b/i.test(value)) return "DKK";
  if (/¥|\bJPY\b/i.test(value)) return "JPY";
  if (/₹|\bINR\b/i.test(value)) return "INR";
  if (/\bzł\b/i.test(value)) return "PLN";
  if (/€|\bEUR\b/i.test(value)) return "EUR";
  if (/£|\bGBP\b/i.test(value)) return "GBP";
  if (/\bCHF\b/i.test(value)) return "CHF";
  if (/\bPLN\b|\bzł\b/i.test(value)) return "PLN";
  if (/\bSEK\b|\bkr\b/i.test(value)) return "SEK";
  if (/\$|\bUSD\b/i.test(value)) return "USD";
  return undefined;
}

function extractVisibleAvailability(html: string) {
  const text = stripHtml(html).replace(/\s+/g, " ").slice(0, 160_000);
  return text.match(/\b(?:out of stock|sold out|not available|unavailable|ni na zalogi|razprodano|in stock|available|na zalogi|dobavljivo)\b/i)?.[0];
}

function normalizeCurrency(value?: string) {
  if (!value) return undefined;
  const detected = detectCurrency(value);
  if (detected) return detected;
  const code = value.trim().toUpperCase().match(/\b[A-Z]{3}\b/)?.[0];
  return code;
}

function safeResolveUrl(value: string | undefined, fallback: string) {
  try { return value ? new URL(value, fallback).toString() : fallback; } catch { return fallback; }
}

function sameSiteUrl(left: string, right: string) {
  const leftUrl = new URL(left);
  const rightUrl = new URL(right);
  return leftUrl.hostname.toLowerCase().replace(/^www\./, "") === rightUrl.hostname.toLowerCase().replace(/^www\./, "");
}

function firstString(...values: unknown[]) { return values.find(value => typeof value === "string" && value.trim()) as string | undefined; }
function asRecord(value: unknown): JsonRecord | undefined { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : undefined; }
function digitsOnly(value: string) { return value.replace(/\D/g, ""); }
function stripHtml(value: string) { return decodeEntities(value.replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")); }
function decodeEntities(value: string) {
  return value.replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16))).replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number(decimal)));
}
