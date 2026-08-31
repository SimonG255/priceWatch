import { ProxyAgent, type Dispatcher } from "undici";

const DEFAULT_USER_AGENT = "Nexus/1.0 (+public product monitor)";
const MAX_POOL_ENTRIES = 64;
const MAX_USER_AGENT_LENGTH = 512;

export type ScraperNetworkConfig = {
  userAgents?: string[];
  proxyUrls?: string[];
};

export type ScraperRequestIdentity = {
  userAgent: string;
  proxyUrl?: string;
  dispatcher?: Dispatcher;
};

export type ScraperNetwork = {
  next(): ScraperRequestIdentity;
};

/**
 * Creates a per-scan round-robin network identity. User agents are kept
 * explicit and configurable so the scraper can remain identifiable by
 * default. HTTP(S) proxies are optional and only used when configured.
 */
export function createScraperNetwork(config: ScraperNetworkConfig = {}): ScraperNetwork {
  const userAgents = normalizeUserAgents(config.userAgents ?? readList(process.env.SCRAPER_USER_AGENTS));
  const proxyUrls = normalizeProxyUrls(config.proxyUrls ?? readList(process.env.SCRAPER_PROXY_URLS ?? process.env.SCRAPER_PROXY_URL));
  const proxyAgents = new Map<string, ProxyAgent>();
  let cursor = 0;

  return {
    next() {
      const index = cursor++;
      const proxyUrl = proxyUrls.length ? proxyUrls[index % proxyUrls.length] : undefined;
      return {
        userAgent: userAgents[index % userAgents.length],
        ...(proxyUrl ? { proxyUrl, dispatcher: getProxyAgent(proxyUrl, proxyAgents) } : {}),
      };
    },
  };
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
