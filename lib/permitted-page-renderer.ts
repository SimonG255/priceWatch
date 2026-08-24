import { assertPublicHostname } from "./product-input.ts";
import { sameStoreHostname } from "./site-search-profiles.ts";
import type { PermittedPageRenderer } from "./scraper-types.ts";

const RENDER_TIMEOUT_MS = 20_000;
const MAX_RENDERED_HTML_BYTES = 2_000_000;

/**
 * Optional adapter for an organisation-approved rendering service. It is not a
 * CAPTCHA bypass: it is called only for opted-in profiles after ordinary HTML
 * lacks usable product data, and it never runs after a challenge or rate limit.
 */
export const renderWithPermittedService: PermittedPageRenderer = async ({ url, hostname, waitForSelector }) => {
  const endpoint = process.env.SCRAPER_RENDERER_URL;
  const token = process.env.SCRAPER_RENDERER_TOKEN;
  if (!endpoint || !token) return undefined;

  let rendererUrl: URL;
  try {
    rendererUrl = new URL(endpoint);
    if (rendererUrl.protocol !== "https:" || rendererUrl.username || rendererUrl.password) return undefined;
    assertPublicHostname(hostname);
  } catch {
    return undefined;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RENDER_TIMEOUT_MS);
  try {
    const response = await fetch(rendererUrl, {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ url, waitForSelector: waitForSelector || undefined }),
    });
    if (!response.ok || Number(response.headers.get("content-length") || 0) > MAX_RENDERED_HTML_BYTES) return undefined;
    const payload = await response.json() as { html?: unknown; url?: unknown };
    if (typeof payload.html !== "string" || payload.html.length > MAX_RENDERED_HTML_BYTES) return undefined;
    const resolvedUrl = typeof payload.url === "string" ? new URL(payload.url, url) : new URL(url);
    if (!sameStoreHostname(resolvedUrl.hostname, hostname)) return undefined;
    return { url: resolvedUrl.toString(), html: payload.html };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
};
