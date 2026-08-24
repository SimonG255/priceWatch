import { assertPublicHostname } from "./product-input.ts";

export type AdminWebsiteInventoryItem = {
  hostname: string;
};

/**
 * Converts user-supplied website URLs into an admin-safe inventory. Paths,
 * query strings, credentials, and ownership information never leave the API.
 */
export function listAdminWebsiteInventory(rows: readonly { url: string }[]): AdminWebsiteInventoryItem[] {
  const hostnames = new Set<string>();

  for (const { url: value } of rows) {
    const hostname = hostnameFromWebsiteUrl(value);
    if (hostname) hostnames.add(hostname);
  }

  return [...hostnames]
    .sort((left, right) => left.localeCompare(right))
    .map((hostname) => ({ hostname }));
}

function hostnameFromWebsiteUrl(value: string) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined;
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    assertPublicHostname(hostname);
    return hostname || undefined;
  } catch {
    return undefined;
  }
}
