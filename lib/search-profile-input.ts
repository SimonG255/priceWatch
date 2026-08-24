import { assertPublicHostname } from "./product-input.ts";
import { sameStoreHostname } from "./site-search-profiles.ts";

export type SearchProfileInput = {
  label: string;
  hostname: string;
  htmlSignature: string;
  searchUrlTemplate: string;
  productSelector: string;
  eanSelector: string;
  priceSelector: string;
  jsonLdEanFields: string;
  jsonLdPriceFields: string;
  jsonLdCurrencyFields: string;
  blockPatterns: string;
  allowRenderedFallback: boolean;
  enabled: boolean;
};

export function validateSearchProfileInput(value: Record<string, unknown>): SearchProfileInput {
  const label = text(value.label, "Enter a profile name.").trim();
  const hostname = normalizeProfileHostname(optionalText(value.hostname, "Hostname must be text."));
  const htmlSignature = optionalText(value.htmlSignature, "HTML signature must be text.").trim();
  const searchUrlTemplate = text(value.searchUrlTemplate, "Enter a search URL template.").trim();
  const productSelector = validateSelector(optionalText(value.productSelector, "Product selector must be text."), "Product selector");
  const eanSelector = validateSelector(optionalText(value.eanSelector, "EAN selector must be text."), "EAN selector");
  const priceSelector = validateSelector(optionalText(value.priceSelector, "Price selector must be text."), "Price selector");
  const jsonLdEanFields = normalizeJsonLdFields(optionalText(value.jsonLdEanFields, "JSON-LD EAN fields must be text."), "JSON-LD EAN fields");
  const jsonLdPriceFields = normalizeJsonLdFields(optionalText(value.jsonLdPriceFields, "JSON-LD price fields must be text."), "JSON-LD price fields");
  const jsonLdCurrencyFields = normalizeJsonLdFields(optionalText(value.jsonLdCurrencyFields, "JSON-LD currency fields must be text."), "JSON-LD currency fields");
  const blockPatterns = normalizeBlockPatterns(optionalText(value.blockPatterns, "Block patterns must be text."));
  if (value.allowRenderedFallback != null && typeof value.allowRenderedFallback !== "boolean") {
    throw new Error("Renderer fallback must be true or false.");
  }
  const allowRenderedFallback = value.allowRenderedFallback === true;
  const enabled = value.enabled == null ? true : value.enabled;

  if (label.length < 2) throw new Error("Enter a profile name.");
  if (label.length > 80) throw new Error("Profile name must be 80 characters or fewer.");
  if (!hostname && htmlSignature.length < 3) throw new Error("Enter a hostname or an HTML signature of at least 3 characters.");
  if (htmlSignature.length > 500) throw new Error("HTML signature must be 500 characters or fewer.");
  if (searchUrlTemplate.length > 500) throw new Error("Search URL template must be 500 characters or fewer.");
  if (enabled !== true && enabled !== false) throw new Error("Enabled must be true or false.");

  const placeholders = searchUrlTemplate.match(/\{query\}/g)?.length ?? 0;
  if (placeholders !== 1) throw new Error("The search URL must contain exactly one {query} placeholder.");
  if (searchUrlTemplate.startsWith("//")) throw new Error("Search URLs cannot be protocol-relative.");

  const marker = "PRICEWATCHQUERY";
  const isAbsolute = /^[a-z][a-z\d+.-]*:/i.test(searchUrlTemplate);
  if (!hostname && isAbsolute) throw new Error("HTML-only profiles must use a relative search URL so searches stay on the matched website.");

  let sample: URL;
  try {
    sample = new URL(searchUrlTemplate.replace("{query}", marker), `https://${hostname || "store.example"}`);
  } catch {
    throw new Error("Enter a valid search URL template.");
  }
  if (!["http:", "https:"].includes(sample.protocol)) throw new Error("Search URLs must use HTTP or HTTPS.");
  if (sample.username || sample.password) throw new Error("Search URLs cannot contain usernames or passwords.");
  if (sample.port && !["80", "443"].includes(sample.port)) throw new Error("Search URLs can use only standard web ports.");
  if (sample.hostname.toUpperCase().includes(marker)) throw new Error("The {query} placeholder cannot appear in the website hostname.");
  if (sample.hash.toUpperCase().includes(marker)) throw new Error("The {query} placeholder cannot appear in a URL fragment.");
  if (!`${sample.pathname}${sample.search}`.toUpperCase().includes(marker)) throw new Error("Put the {query} placeholder in the URL path or query string.");
  if (hostname && !sameStoreHostname(sample.hostname, hostname)) throw new Error("The search URL must stay on the configured website.");

  return {
    label, hostname, htmlSignature, searchUrlTemplate,
    productSelector, eanSelector, priceSelector,
    jsonLdEanFields, jsonLdPriceFields, jsonLdCurrencyFields,
    blockPatterns, allowRenderedFallback, enabled,
  };
}

export function searchProfileIdentity(profile: Pick<SearchProfileInput, "hostname" | "htmlSignature">) {
  return `${profile.hostname.toLowerCase()}\u0000${profile.htmlSignature.toLowerCase()}`;
}

function normalizeProfileHostname(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try { url = new URL(candidate); } catch { throw new Error("Enter a valid website hostname."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || (url.port && !["80", "443"].includes(url.port))) {
    throw new Error("Enter a public website hostname without credentials or a custom port.");
  }
  if (url.pathname !== "/" || url.search || url.hash) throw new Error("Enter only the website hostname, without a path, query, or fragment.");
  const hostname = url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  assertPublicHostname(hostname);
  return hostname;
}

function text(value: unknown, message: string) {
  if (typeof value !== "string") throw new Error(message);
  return value;
}

function optionalText(value: unknown, message: string) {
  if (value == null) return "";
  return text(value, message);
}

function validateSelector(value: string, label: string) {
  const selector = value.trim();
  if (!selector) return "";
  if (selector.length > 180) throw new Error(`${label} must be 180 characters or fewer.`);
  // Matches the intentionally limited selector subset implemented by the
  // server-side extractor. Arbitrary CSS and regular expressions are not
  // accepted as administrator configuration.
  const valid = /^(?:[a-z][\w-]*)?(?:#[\w-]+|\.[\w-]+|\[(?:data-[\w-]+|itemprop|data-testid|id|class)(?:=(?:"[^"]*"|'[^']*'|[\w.-]+))?\])?$/i.test(selector);
  if (!valid || !/[.#\[]|^[a-z]/i.test(selector)) throw new Error(`${label} must be a simple tag, .class, #id, or supported attribute selector.`);
  return selector;
}

function normalizeJsonLdFields(value: string, label: string) {
  const fields = value.split(/[\n,]/).map((field) => field.trim()).filter(Boolean);
  if (fields.length > 8) throw new Error(`${label} can include at most 8 field paths.`);
  if (fields.some((field) => field.length > 80 || !/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*){0,4}$/.test(field))) {
    throw new Error(`${label} must contain simple JSON field paths, such as gtin13 or offers.price.`);
  }
  return [...new Set(fields)].join(",");
}

function normalizeBlockPatterns(value: string) {
  const patterns = value.split(/\n/).map((pattern) => pattern.trim()).filter(Boolean);
  if (patterns.length > 8) throw new Error("Add at most 8 block or challenge markers.");
  if (patterns.some((pattern) => pattern.length > 120 || /[\u0000-\u001f]/.test(pattern))) {
    throw new Error("Block or challenge markers must be short literal text.");
  }
  return [...new Set(patterns)].join("\n");
}
