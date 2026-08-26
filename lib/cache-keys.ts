import { assertPublicHostname } from "./product-input.ts";

export function sitemapCacheKey(hostname: string, ean: string) {
  const normalized = hostname
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/\.$/, "");
  assertPublicHostname(normalized);
  // PostgreSQL text values cannot contain NUL bytes. JSON keeps the hostname
  // and EAN unambiguous without relying on a control-character delimiter.
  return JSON.stringify([normalized, ean.replace(/\D/g, "")]);
}
