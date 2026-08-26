import { assertPublicHostname } from "./product-input.ts";
import { sameStoreHostname } from "./site-search-profiles.ts";
import type { PermittedPageRenderer } from "./scraper-types.ts";

const RENDER_TIMEOUT_MS = 20_000;
const MAX_RENDER_TIMEOUT_MS = 30_000;
const MAX_RENDERED_HTML_BYTES = 5_000_000;

/**
 * Optional adapter for an organisation-approved rendering service. It is not a
 * CAPTCHA bypass: it is called only for opted-in profiles after ordinary HTML
 * lacks usable product data, and it never runs after a challenge or rate limit.
 */
export const renderWithPermittedService: PermittedPageRenderer = async ({ url, hostname, waitForSelector, timeoutMs, maxBytes }) => {
  const endpoint = process.env.SCRAPER_RENDERER_URL;
  const token = process.env.SCRAPER_RENDERER_TOKEN;
  if (!endpoint || !token) return undefined;

  let rendererUrl: URL;
  try {
    rendererUrl = new URL(endpoint);
    if (rendererUrl.protocol !== "https:" || rendererUrl.username || rendererUrl.password) return undefined;
    assertPublicHostname(rendererUrl.hostname);
    assertPublicHostname(hostname);
  } catch {
    return undefined;
  }

  const budgetMs = Math.max(5_000, Math.min(MAX_RENDER_TIMEOUT_MS, timeoutMs ?? RENDER_TIMEOUT_MS));
  const byteBudget = Math.max(256_000, Math.min(MAX_RENDERED_HTML_BYTES, maxBytes ?? 2_000_000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budgetMs);
  try {
    const response = await fetch(rendererUrl, {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ url, waitForSelector: waitForSelector || undefined }),
    });
    if (!response.ok || Number(response.headers.get("content-length") || 0) > byteBudget) return undefined;
    const raw = await readLimitedText(response, byteBudget);
    const payload = JSON.parse(raw) as { html?: unknown; url?: unknown };
    if (typeof payload.html !== "string" || new TextEncoder().encode(payload.html).byteLength > byteBudget) return undefined;
    const resolvedUrl = typeof payload.url === "string" ? new URL(payload.url, url) : new URL(url);
    if (!sameStoreHostname(resolvedUrl.hostname, hostname)) return undefined;
    return { url: resolvedUrl.toString(), html: payload.html };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
};

async function readLimitedText(response: Response, maxBytes: number) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error("Rendered response exceeded its size budget.");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}
