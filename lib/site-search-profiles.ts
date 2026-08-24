export type SearchCandidate = {
  url: string;
  profileId: string;
  profileLabel: string;
};

export type CustomSearchProfile = {
  id: string;
  label: string;
  hostname: string;
  htmlSignature: string;
  searchUrlTemplate: string;
};

type SearchProfile = {
  id: string;
  label: string;
  templates: string[];
  hostPattern?: RegExp;
  htmlPattern?: RegExp;
  suppressesGenericFallback?: boolean;
};

/**
 * Search URL profiles are kept in one list so a confirmed store-specific route
 * can be added without changing the crawler. A matching admin profile owns the
 * generic-search choice, so its configured route is not diluted by guessed URLs.
 */
export const WEBSITE_SEARCH_PROFILES: readonly SearchProfile[] = [
  {
    id: "trgovine-jager",
    label: "Trgovine Jager search",
    hostPattern: /(^|\.)trgovinejager\.com$/i,
    templates: ["/iskalnik/?isci={query}"],
    // This is Jager's published storefront-search route. Trying guessed
    // /search?... URLs after it adds noise and can trigger extra rate limits.
    suppressesGenericFallback: true,
  },
  {
    id: "amazon",
    label: "Amazon search",
    hostPattern: /(^|\.)amazon\.[a-z.]+$/i,
    templates: ["/s?k={query}"],
  },
  {
    id: "ebay",
    label: "eBay search",
    hostPattern: /(^|\.)ebay\.[a-z.]+$/i,
    templates: ["/sch/i.html?_nkw={query}"],
  },
  {
    id: "etsy",
    label: "Etsy search",
    hostPattern: /(^|\.)etsy\.com$/i,
    templates: ["/search?q={query}"],
  },
  {
    id: "shopify",
    label: "Shopify product search",
    htmlPattern: /cdn\.shopify\.com|Shopify\.(?:theme|routes)|myshopify\.com/i,
    templates: ["/search?type=product&q={query}", "/search?q={query}"],
  },
  {
    id: "magento",
    label: "Magento catalog search",
    htmlPattern: /Magento_[A-Za-z]+|mage\/cookies|\/static\/version\d+/i,
    templates: ["/catalogsearch/result/?q={query}"],
  },
  {
    id: "woocommerce",
    label: "WooCommerce product search",
    htmlPattern: /woocommerce|wp-content\/plugins\/woocommerce/i,
    templates: ["/?s={query}&post_type=product"],
  },
  {
    id: "prestashop",
    label: "PrestaShop catalog search",
    htmlPattern: /prestashop/i,
    templates: ["/search?controller=search&s={query}"],
  },
  {
    id: "bigcommerce",
    label: "BigCommerce product search",
    htmlPattern: /cdn\d*\.bigcommerce\.com|stencilUtils/i,
    templates: ["/search.php?search_query={query}"],
  },
  {
    id: "shopware",
    label: "Shopware product search",
    htmlPattern: /shopware|data-shopware/i,
    templates: ["/search?search={query}"],
  },
];

const GENERIC_SEARCH_PROFILE: SearchProfile = {
  id: "generic",
  label: "Common website search",
  templates: [
    "/search?q={query}",
    "/search?query={query}",
    "/search?search={query}",
    "/?s={query}",
  ],
};

export function buildSearchCandidates(root: URL, queries: string[], html?: string, customProfiles: CustomSearchProfile[] = []): SearchCandidate[] {
  const candidates: SearchCandidate[] = [];
  const seen = new Set<string>();
  let suppressesGenericFallback = false;
  const add = (candidate: SearchCandidate) => {
    const normalized = normalizeCandidate(candidate.url);
    if (!normalized || seen.has(normalized) || !sameStoreHostname(new URL(normalized).hostname, root.hostname)) return;
    seen.add(normalized);
    candidates.push({ ...candidate, url: normalized });
  };

  for (const profile of customProfiles) {
    const hostMatches = !profile.hostname || sameStoreHostname(root.hostname, profile.hostname);
    const htmlMatches = !profile.htmlSignature || Boolean(html?.toLowerCase().includes(profile.htmlSignature.toLowerCase()));
    if (!hostMatches || !htmlMatches) continue;
    const candidateCount = candidates.length;
    addProfileCandidates(add, root, queries, { id: `custom-${profile.id}`, label: profile.label, templates: [profile.searchUrlTemplate] });
    suppressesGenericFallback ||= candidates.length > candidateCount;
  }

  for (const profile of WEBSITE_SEARCH_PROFILES) {
    const matchesHost = profile.hostPattern?.test(root.hostname) ?? false;
    const matchesHtml = html ? profile.htmlPattern?.test(html) ?? false : false;
    if (!matchesHost && !matchesHtml) continue;
    const candidateCount = candidates.length;
    addProfileCandidates(add, root, queries, profile);
    if (profile.suppressesGenericFallback && candidates.length > candidateCount) suppressesGenericFallback = true;
  }

  if (html) {
    for (const candidate of discoverSearchForms(root, queries, html)) add(candidate);
  }

  if (!suppressesGenericFallback) addProfileCandidates(add, root, queries, GENERIC_SEARCH_PROFILE);
  return candidates;
}

export function sameStoreHostname(candidateHostname: string, originalHostname: string) {
  const candidate = candidateHostname.toLowerCase().replace(/^www\./, "");
  const original = originalHostname.toLowerCase().replace(/^www\./, "");
  return candidate === original || candidate.endsWith(`.${original}`) || original.endsWith(`.${candidate}`);
}

function addProfileCandidates(
  add: (candidate: SearchCandidate) => void,
  root: URL,
  queries: string[],
  profile: SearchProfile,
) {
  for (const query of queries) {
    for (const template of profile.templates) {
      try {
        add({
          url: new URL(template.replace("{query}", encodeURIComponent(query)), root.origin).toString(),
          profileId: profile.id,
          profileLabel: profile.label,
        });
      } catch {
        // Invalid profile entries are ignored rather than breaking every scan.
      }
    }
  }
}

function discoverSearchForms(root: URL, queries: string[], html: string) {
  const forms: { score: number; action: URL; queryName: string; fixed: [string, string][] }[] = [];
  const formPattern = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;

  for (const match of html.matchAll(formPattern)) {
    const formAttributes = parseAttributes(match[1]);
    if ((formAttributes.method || "get").toLowerCase() !== "get") continue;

    let action: URL;
    try { action = new URL(decodeEntities(formAttributes.action || root.pathname || "/"), root); } catch { continue; }
    if (!["http:", "https:"].includes(action.protocol) || !sameStoreHostname(action.hostname, root.hostname)) continue;

    const controls = [...match[2].matchAll(/<input\b([^>]*)>/gi)].map((input) => parseAttributes(input[1]));
    const queryControl = controls
      .filter((control) => control.name && !["hidden", "submit", "button", "checkbox", "radio"].includes((control.type || "text").toLowerCase()))
      .map((control) => ({ control, score: searchControlScore(control) }))
      .sort((a, b) => b.score - a.score)[0];
    if (!queryControl || queryControl.score < 8) continue;

    const fixed: [string, string][] = [];
    for (const control of controls) {
      if ((control.type || "").toLowerCase() !== "hidden" || !control.name || !control.value) continue;
      if (/csrf|token|nonce|session/i.test(control.name)) continue;
      fixed.push([decodeEntities(control.name), decodeEntities(control.value)]);
    }

    const formText = `${formAttributes.role || ""} ${formAttributes.class || ""} ${formAttributes.id || ""}`;
    const score = queryControl.score + (/search|find/i.test(formText) ? 8 : 0);
    forms.push({ score, action, queryName: decodeEntities(queryControl.control.name), fixed });
  }

  const bestForms = forms.sort((a, b) => b.score - a.score).slice(0, 2);
  return bestForms.flatMap((form, index) => queries.map((query) => {
    const url = new URL(form.action);
    for (const [name, value] of form.fixed) if (!url.searchParams.has(name)) url.searchParams.set(name, value);
    url.searchParams.set(form.queryName, query);
    return {
      url: url.toString(),
      profileId: `form-${index + 1}`,
      profileLabel: "the website's search form",
    };
  }));
}

function searchControlScore(attributes: Record<string, string>) {
  const name = (attributes.name || "").toLowerCase();
  const description = `${name} ${attributes.id || ""} ${attributes.placeholder || ""} ${attributes["aria-label"] || ""}`.toLowerCase();
  const knownNames = /^(q|s|query|search|search_query|searchquery|keyword|keywords|term|text)$/;
  return ((attributes.type || "").toLowerCase() === "search" ? 20 : 0)
    + (knownNames.test(name) ? 14 : 0)
    + (/search|find|keyword|product/.test(description) ? 8 : 0);
}

function parseAttributes(fragment: string) {
  const attributes: Record<string, string> = {};
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of fragment.matchAll(pattern)) {
    const name = match[1].toLowerCase();
    attributes[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attributes;
}

function normalizeCandidate(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

function decodeEntities(value: string) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}
