import { ProxyAgent, type Dispatcher } from "undici";

const DEFAULT_USER_AGENT = "Nexus/1.0 (+public product monitor)";
const DEFAULT_ACCEPT_LANGUAGE = "en-US,en;q=0.8";
const MAX_POOL_ENTRIES = 64;
const MAX_USER_AGENT_LENGTH = 512;
const MAX_COOKIES_PER_SCAN = 32;
const MAX_COOKIE_LENGTH = 4_096;

export type ScraperNetworkConfig = {
  userAgents?: string[];
  proxyUrls?: string[];
  acceptLanguage?: string;
  /** Deterministic seed used only by tests; production starts each scan at a random pool entry. */
  sessionSeed?: number;
};

export type ScraperRequestIdentity = {
  userAgent: string;
  acceptLanguage: string;
  proxyUrl?: string;
  dispatcher?: Dispatcher;
};

export type ScraperNetwork = {
  /** A scope pins one internally consistent identity for the duration of a scan. */
  next(scope?: string): ScraperRequestIdentity;
  cookiesFor?(url: URL): string | undefined;
  rememberCookies?(url: URL, headers: Headers): void;
};

/**
 * Creates a bounded per-scan network session. Calls without a scope retain the
 * round-robin behavior used by diagnostics. Normal page requests provide a
 * hostname scope, pinning one user-agent/proxy pair and anonymous cookies for
 * the scan instead of presenting an impossible, constantly changing client.
 * The default user agent remains intentionally identifiable.
 */
export function createScraperNetwork(config: ScraperNetworkConfig = {}): ScraperNetwork {
  const userAgents = normalizeUserAgents(config.userAgents ?? readList(process.env.SCRAPER_USER_AGENTS));
  const proxyUrls = normalizeProxyUrls(config.proxyUrls ?? readList(process.env.SCRAPER_PROXY_URLS ?? process.env.SCRAPER_PROXY_URL));
  const acceptLanguage = normalizeAcceptLanguage(config.acceptLanguage ?? process.env.SCRAPER_ACCEPT_LANGUAGE);
  const proxyAgents = new Map<string, ProxyAgent>();
  const scopedIdentities = new Map<string, ScraperRequestIdentity>();
  const cookieJar = createAnonymousCookieJar();
  let cursor = 0;
  let scopedCursor = Number.isInteger(config.sessionSeed) && Number(config.sessionSeed) >= 0
    ? Number(config.sessionSeed)
    : Math.floor(Math.random() * Math.max(1, userAgents.length, proxyUrls.length));

  const identityAt = (index: number): ScraperRequestIdentity => {
    const proxyUrl = proxyUrls.length ? proxyUrls[index % proxyUrls.length] : undefined;
    return {
      userAgent: userAgents[index % userAgents.length],
      acceptLanguage,
      ...(proxyUrl ? { proxyUrl, dispatcher: getProxyAgent(proxyUrl, proxyAgents) } : {}),
    };
  };

  return {
    next(scope) {
      const normalizedScope = normalizeScope(scope);
      if (!normalizedScope) return identityAt(cursor++);
      const existing = scopedIdentities.get(normalizedScope);
      if (existing) return existing;
      const identity = identityAt(scopedCursor++);
      if (scopedIdentities.size < MAX_POOL_ENTRIES) scopedIdentities.set(normalizedScope, identity);
      return identity;
    },
    cookiesFor: cookieJar.cookiesFor,
    rememberCookies: cookieJar.remember,
  };
}

type AnonymousCookie = {
  name: string;
  value: string;
  hostname: string;
  path: string;
  secure: boolean;
  expiresAt?: number;
};

function createAnonymousCookieJar() {
  const cookies = new Map<string, AnonymousCookie>();
  const keyFor = (cookie: Pick<AnonymousCookie, "hostname" | "path" | "name">) => `${cookie.hostname}\u0000${cookie.path}\u0000${cookie.name}`;

  return {
    cookiesFor(url: URL) {
      const now = Date.now();
      const matches: AnonymousCookie[] = [];
      for (const [key, cookie] of cookies) {
        if (cookie.expiresAt != null && cookie.expiresAt <= now) {
          cookies.delete(key);
          continue;
        }
        if (cookie.hostname !== url.hostname.toLowerCase() || (cookie.secure && url.protocol !== "https:") || !cookiePathMatches(url.pathname, cookie.path)) continue;
        matches.push(cookie);
      }
      return matches
        .sort((left, right) => right.path.length - left.path.length)
        .map((cookie) => `${cookie.name}=${cookie.value}`)
        .join("; ") || undefined;
    },
    remember(url: URL, headers: Headers) {
      for (const raw of setCookieValues(headers)) {
        const cookie = parseAnonymousCookie(raw, url);
        if (!cookie) continue;
        const key = keyFor(cookie);
        if (cookie.expiresAt != null && cookie.expiresAt <= Date.now()) {
          cookies.delete(key);
          continue;
        }
        cookies.delete(key);
        cookies.set(key, cookie);
        while (cookies.size > MAX_COOKIES_PER_SCAN) cookies.delete(cookies.keys().next().value as string);
      }
    },
  };
}

function parseAnonymousCookie(raw: string, url: URL): AnonymousCookie | undefined {
  if (!raw || raw.length > MAX_COOKIE_LENGTH || /[\u0000-\u0008\u000a-\u001f\u007f]/.test(raw)) return undefined;
  const parts = raw.split(";").map((part) => part.trim());
  const separator = parts[0]?.indexOf("=") ?? -1;
  if (separator <= 0) return undefined;
  const name = parts[0].slice(0, separator).trim();
  const value = parts[0].slice(separator + 1).trim();
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || /[;,\s]/.test(value)) return undefined;

  const hostname = url.hostname.toLowerCase();
  let path = defaultCookiePath(url.pathname);
  let secure = false;
  let expiresAt: number | undefined;
  for (const attribute of parts.slice(1)) {
    const attributeSeparator = attribute.indexOf("=");
    const key = (attributeSeparator < 0 ? attribute : attribute.slice(0, attributeSeparator)).trim().toLowerCase();
    const attributeValue = attributeSeparator < 0 ? "" : attribute.slice(attributeSeparator + 1).trim();
    if (key === "domain" && attributeValue.replace(/^\./, "").toLowerCase() !== hostname) return undefined;
    if (key === "path" && attributeValue.startsWith("/")) path = attributeValue;
    if (key === "secure") secure = true;
    if (key === "max-age" && /^-?\d+$/.test(attributeValue)) expiresAt = Date.now() + Number(attributeValue) * 1_000;
    if (key === "expires" && expiresAt == null) {
      const parsed = Date.parse(attributeValue);
      if (Number.isFinite(parsed)) expiresAt = parsed;
    }
  }
  return { name, value, hostname, path, secure, expiresAt };
}

function setCookieValues(headers: Headers) {
  const extended = headers as Headers & { getSetCookie?: () => string[] };
  const values = extended.getSetCookie?.();
  if (values?.length) return values;
  const combined = headers.get("set-cookie");
  return combined ? combined.split(/,(?=\s*[!#$%&'*+.^_`|~0-9A-Za-z-]+=)/) : [];
}

function defaultCookiePath(pathname: string) {
  if (!pathname.startsWith("/") || pathname === "/") return "/";
  const lastSlash = pathname.lastIndexOf("/");
  return lastSlash <= 0 ? "/" : pathname.slice(0, lastSlash);
}

function cookiePathMatches(pathname: string, cookiePath: string) {
  return pathname === cookiePath || pathname.startsWith(cookiePath.endsWith("/") ? cookiePath : `${cookiePath}/`);
}

function normalizeScope(value: string | undefined) {
  const scope = value?.trim().toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  return scope && scope.length <= 253 && /^[a-z0-9.-]+$/.test(scope) ? scope : undefined;
}

function getProxyAgent(proxyUrl: string, agents: Map<string, ProxyAgent>) {
  const cached = agents.get(proxyUrl);
  if (cached) return cached;
  const agent = new ProxyAgent(proxyUrl);
  agents.set(proxyUrl, agent);
  return agent;
}

function normalizeUserAgents(values: string[]) {
  const unique = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  if (!unique.length) return [DEFAULT_USER_AGENT];
  if (unique.length > MAX_POOL_ENTRIES) throw new Error(`SCRAPER_USER_AGENTS may contain at most ${MAX_POOL_ENTRIES} entries.`);
  for (const userAgent of unique) {
    if (userAgent.length < 8 || userAgent.length > MAX_USER_AGENT_LENGTH || /[\u0000-\u001f\u007f]/.test(userAgent)) {
      throw new Error("SCRAPER_USER_AGENTS contains an invalid user-agent value.");
    }
  }
  return unique;
}

function normalizeAcceptLanguage(value: string | undefined) {
  const normalized = value?.trim() || DEFAULT_ACCEPT_LANGUAGE;
  if (normalized.length > 256 || /[\u0000-\u001f\u007f]/.test(normalized) || !/^[A-Za-z0-9,;=*.\-\s]+$/.test(normalized)) {
    throw new Error("SCRAPER_ACCEPT_LANGUAGE contains an invalid header value.");
  }
  return normalized;
}

function normalizeProxyUrls(values: string[]) {
  const unique = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  if (unique.length > MAX_POOL_ENTRIES) throw new Error(`SCRAPER_PROXY_URLS may contain at most ${MAX_POOL_ENTRIES} entries.`);
  return unique.map((value) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error("SCRAPER_PROXY_URLS contains an invalid URL.");
    }
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.hash) {
      throw new Error("SCRAPER_PROXY_URLS accepts only HTTP(S) proxy URLs without fragments.");
    }
    if (/[\u0000-\u001f\u007f]/.test(value)) throw new Error("SCRAPER_PROXY_URLS contains an invalid proxy URL.");
    return url.toString();
  });
}

function readList(value: string | undefined) {
  return (value ?? "").split(/[\r\n,]/).map((item) => item.trim()).filter(Boolean);
}
