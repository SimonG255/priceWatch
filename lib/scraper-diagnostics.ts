import type {
  ChallengeType,
  KnownBadPattern,
  ScraperBudget,
  ScraperFailureClass,
  ScraperReasonCode,
  SiteType,
  StoreExtractionProfile,
} from "./scraper-types.ts";

const MiB = 1024 * 1024;

const SITE_BUDGETS: Record<Exclude<SiteType, "auto">, ScraperBudget> = {
  standard: { timeoutMs: 8_000, maxPageBytes: 2 * MiB, retryBudget: 2, renderTimeoutMs: 18_000, maxRenderedBytes: 2 * MiB },
  slow: { timeoutMs: 16_000, maxPageBytes: 3 * MiB, retryBudget: 2, renderTimeoutMs: 28_000, maxRenderedBytes: 3 * MiB },
  large: { timeoutMs: 12_000, maxPageBytes: 5 * MiB, retryBudget: 1, renderTimeoutMs: 24_000, maxRenderedBytes: 5 * MiB },
  javascript: { timeoutMs: 10_000, maxPageBytes: 3 * MiB, retryBudget: 1, renderTimeoutMs: 30_000, maxRenderedBytes: 5 * MiB },
  marketplace: { timeoutMs: 14_000, maxPageBytes: 4 * MiB, retryBudget: 1, renderTimeoutMs: 24_000, maxRenderedBytes: 4 * MiB },
};

const KNOWN_SLOW_HOSTS = /(^|\.)(amazon\.|ebay\.|etsy\.com$|aliexpress\.|temu\.)/i;
const KNOWN_LARGE_HOSTS = /(^|\.)(amazon\.|ebay\.|walmart\.|aliexpress\.)/i;

export function scraperBudgetFor(hostname: string, profile?: StoreExtractionProfile): ScraperBudget {
  const requestedType = profile?.siteType && profile.siteType !== "auto" ? profile.siteType : inferSiteType(hostname, profile);
  const base = SITE_BUDGETS[requestedType];
  return {
    timeoutMs: clamp(profile?.timeoutMs, 3_000, 30_000, base.timeoutMs),
    maxPageBytes: clamp(profile?.maxPageBytes, 256_000, 8 * MiB, base.maxPageBytes),
    retryBudget: Math.round(clamp(profile?.retryBudget, 0, 4, base.retryBudget)),
    renderTimeoutMs: base.renderTimeoutMs,
    maxRenderedBytes: base.maxRenderedBytes,
  };
}

function inferSiteType(hostname: string, profile?: StoreExtractionProfile): Exclude<SiteType, "auto"> {
  if (profile?.allowRenderedFallback) return "javascript";
  if (KNOWN_LARGE_HOSTS.test(hostname)) return "large";
  if (KNOWN_SLOW_HOSTS.test(hostname)) return "slow";
  return "standard";
}

export type ChallengeClassification = {
  challengeType: ChallengeType;
  reasonCode: Extract<ScraperReasonCode, ChallengeType>;
  failureClass: ScraperFailureClass;
  message: string;
};

export function detectAccessChallenge(html: string, profilePatterns: string[] = [], response?: { status?: number; server?: string; cfMitigated?: string; cfRay?: string }): ChallengeClassification | undefined {
  const page = html.slice(0, 180_000).toLowerCase();
  const visible = page.replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const custom = profilePatterns.find((pattern) => pattern && page.includes(pattern.toLowerCase()));
  if (
    (response?.status === 403 && Boolean(response.cfMitigated || response.cfRay) && /cloudflare/i.test(response.server ?? ""))
    || /challenge/i.test(response?.cfMitigated ?? "")
    || page.includes("cf-chl-")
    || page.includes("/cdn-cgi/challenge-platform")
    || page.includes("cloudflare ray id")
    || page.includes("<title>just a moment")
  ) return challenge("cloudflare", "Cloudflare challenge detected.");
  const captchaWidget = /(?:g-recaptcha|hcaptcha|turnstile-wrapper|captcha-container)/i.test(page);
  const captchaWallText = /(?:complete|solve|enter)\s+(?:the\s+)?captcha|captcha\s+(?:is\s+)?required|verify\s+(?:that\s+)?you(?:'re| are)\s+human/i.test(visible);
  if (captchaWallText || (captchaWidget && visible.length < 1_500 && /captcha|human|verification/i.test(visible))) return challenge("captcha", "CAPTCHA challenge detected.");
  if (
    page.includes("verify you are human")
    || page.includes("are you a robot")
    || page.includes("unusual traffic")
    || page.includes("automated access")
    || page.includes("attention required")
    || page.includes("potrebno je varnostno preverjanje")
  ) return challenge("bot_wall", "Bot-verification wall detected.");
  if (
    /(?:sign in|log in)\s+(?:to|before you can)\s+(?:continue|view|see)/i.test(visible)
    || visible.includes("authentication required")
    || (visible.length < 2_500 && /<title>\s*(?:sign in|log in|authentication required)/i.test(page))
  ) return challenge("login_wall", "Login wall detected.");
  if (
    page.includes("enable javascript and cookies to continue")
    || page.includes("javascript is required to continue")
    || page.includes("checking your browser before accessing")
    || page.includes("js challenge")
  ) return challenge("js_challenge", "JavaScript challenge detected.");
  return custom ? challenge("bot_wall", `Configured challenge marker detected: ${custom.slice(0, 80)}`) : undefined;
}

function challenge(type: ChallengeType, message: string): ChallengeClassification {
  return { challengeType: type, reasonCode: type, failureClass: type === "login_wall" ? "permanent" : "temporary", message };
}

export function failureClassFor(reason: ScraperReasonCode): ScraperFailureClass {
  if (reason === "found") return "none";
  if (["not_found", "wrong_product", "robots_disallowed", "known_bad_pattern", "http_client_error", "login_wall"].includes(reason)) return "permanent";
  return "temporary";
}

export function exponentialBackoffMs(input: {
  consecutiveFailures: number;
  reasonCode: ScraperReasonCode;
  retryAfterMs?: number;
  jitter?: number;
}) {
  const base = reasonBackoffBase(input.reasonCode);
  const cap = input.reasonCode === "captcha" || input.reasonCode === "login_wall" || input.reasonCode === "robots_disallowed"
    ? 24 * 60 * 60 * 1_000
    : 6 * 60 * 60 * 1_000;
  const exponent = Math.max(0, Math.min(10, input.consecutiveFailures - 1));
  const calculated = Math.min(cap, base * 2 ** exponent);
  const retryAfter = Math.max(0, input.retryAfterMs ?? 0);
  const jitter = Math.max(0, Math.min(0.25, input.jitter ?? 0));
  return Math.ceil(Math.max(calculated, retryAfter) * (1 + jitter));
}

function reasonBackoffBase(reason: ScraperReasonCode) {
  if (["cloudflare", "captcha", "bot_wall", "login_wall", "js_challenge", "blocked"].includes(reason)) return 2 * 60 * 1_000;
  if (reason === "rate_limited") return 60_000;
  if (reason === "timeout" || reason === "http_server_error" || reason === "network_error") return 30_000;
  if (reason === "profile_drift" || reason === "low_confidence" || reason === "price_missing") return 5 * 60 * 1_000;
  if (reason === "robots_disallowed" || reason === "known_bad_pattern") return 60 * 60 * 1_000;
  return 15_000;
}

export function matchKnownBadPattern(url: string, html: string | undefined, patterns: readonly KnownBadPattern[]) {
  const normalizedUrl = url.toLowerCase();
  const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  const page = html?.slice(0, 180_000).toLowerCase();
  return patterns.find((pattern) => {
    const configuredHost = pattern.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    if (configuredHost !== "*" && hostname !== configuredHost && !hostname.endsWith(`.${configuredHost}`)) return false;
    const urlMatches = !pattern.urlPattern || safeLiteralMatch(normalizedUrl, pattern.urlPattern);
    const contentMatches = !pattern.contentPattern || Boolean(page && safeLiteralMatch(page, pattern.contentPattern));
    return urlMatches && contentMatches;
  });
}

function safeLiteralMatch(value: string, pattern: string) {
  const needle = pattern.trim().toLowerCase();
  if (!needle) return true;
  if (!needle.includes("*")) return value.includes(needle);
  const parts = needle.split("*").filter(Boolean);
  let offset = 0;
  for (const part of parts) {
    const index = value.indexOf(part, offset);
    if (index < 0) return false;
    offset = index + part.length;
  }
  return true;
}

export type RobotsRule = { allow: boolean; path: string };

export function parseRobotsRules(robots: string, userAgent = "PriceWatch") {
  const groups: Array<{ agents: string[]; rules: RobotsRule[] }> = [];
  let group: { agents: string[]; rules: RobotsRule[] } | undefined;
  let hasRules = false;
  for (const sourceLine of robots.split(/\r?\n/)) {
    const line = sourceLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (field === "user-agent") {
      if (!group || hasRules) {
        group = { agents: [], rules: [] };
        groups.push(group);
        hasRules = false;
      }
      group.agents.push(value.toLowerCase());
      continue;
    }
    if ((field === "allow" || field === "disallow") && group) {
      if (value) group.rules.push({ allow: field === "allow", path: value });
      hasRules = true;
    }
  }
  const agent = userAgent.toLowerCase();
  const ranked = groups.map((item) => ({
    item,
    specificity: Math.max(...item.agents.map((candidate) => candidate === "*" ? 0 : agent.includes(candidate) ? candidate.length : -1)),
  })).filter((entry) => entry.specificity >= 0);
  const maximum = Math.max(...ranked.map((entry) => entry.specificity), -1);
  return ranked.filter((entry) => entry.specificity === maximum).flatMap((entry) => entry.item.rules);
}

export function robotsAllows(url: URL, rules: readonly RobotsRule[]) {
  const target = `${url.pathname}${url.search}`;
  const matches = rules
    .filter((rule) => robotsPathMatches(target, rule.path))
    .sort((left, right) => right.path.length - left.path.length || Number(right.allow) - Number(left.allow));
  return matches[0]?.allow ?? true;
}

function robotsPathMatches(target: string, pattern: string) {
  const anchored = pattern.endsWith("$");
  const raw = anchored ? pattern.slice(0, -1) : pattern;
  const expression = raw.split("*").map(escapeRegex).join(".*");
  try { return new RegExp(`^${expression}${anchored ? "$" : ""}`).test(target); } catch { return target.startsWith(raw); }
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function suggestSelectors(html: string) {
  const suggestions = new Set<string>();
  for (const match of html.slice(0, 250_000).matchAll(/<([a-z][\w:-]*)\b([^>]*(?:price|product|gtin|ean|sku)[^>]*)>/gi)) {
    const tag = match[1].toLowerCase();
    const attrs = match[2];
    const itemprop = attrs.match(/\bitemprop=["']([^"']+)["']/i)?.[1];
    const testId = attrs.match(/\bdata-testid=["']([^"']+)["']/i)?.[1];
    const id = attrs.match(/\bid=["']([\w-]+)["']/i)?.[1];
    const className = attrs.match(/\bclass=["']([^"']+)["']/i)?.[1]?.split(/\s+/).find((value) => /price|product|ean|gtin/i.test(value));
    if (itemprop && /^(?:price|gtin\d*|sku)$/i.test(itemprop)) suggestions.add(`${tag}[itemprop=${itemprop}]`);
    else if (testId && /^[\w.-]+$/.test(testId)) suggestions.add(`${tag}[data-testid=${testId}]`);
    else if (id) suggestions.add(`#${id}`);
    else if (className && /^[\w-]+$/.test(className)) suggestions.add(`.${className}`);
    if (suggestions.size >= 6) break;
  }
  return [...suggestions];
}

export function profileHealthScore(input: { signatureMatched?: boolean; exactEan?: boolean; priceFound?: boolean; challenge?: boolean; selectorSuggestions?: string[] }) {
  let score = 50;
  if (input.signatureMatched === true) score += 15;
  if (input.signatureMatched === false) score -= 25;
  if (input.exactEan) score += 20;
  if (input.priceFound) score += 15;
  if (input.challenge) score -= 20;
  if (!input.priceFound && input.selectorSuggestions?.length) score -= 5;
  return Math.max(0, Math.min(100, score));
}

export function fairDomainOrder<T>(items: readonly T[], hostname: (item: T) => string) {
  const queues = new Map<string, T[]>();
  for (const item of items) {
    const key = hostname(item).toLowerCase().replace(/^www\./, "");
    const queue = queues.get(key) ?? [];
    queue.push(item);
    queues.set(key, queue);
  }
  const ordered: T[] = [];
  while ([...queues.values()].some((queue) => queue.length)) {
    for (const queue of queues.values()) {
      const item = queue.shift();
      if (item) ordered.push(item);
    }
  }
  return ordered;
}

export function contentFingerprint(value: string) {
  // FNV-1a is deliberately fast and deterministic; this is cache invalidation,
  // not a cryptographic integrity boundary.
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}-${value.length}`;
}

function clamp(value: number | undefined, minimum: number, maximum: number, fallback: number) {
  return value == null || !Number.isFinite(value) ? fallback : Math.max(minimum, Math.min(maximum, value));
}
