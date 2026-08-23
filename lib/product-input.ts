export type ProductInput = {
  websiteUrl: string;
  productName: string;
  ean: string;
  sku?: string;
  notes?: string;
};

export type ProductDetailsInput = Omit<ProductInput, "websiteUrl">;

export function normalizeEan(value: string) {
  return value.replace(/\D/g, "");
}

export function validateProductInput(input: ProductInput): ProductInput {
  const details = validateProductDetails(input);
  const websiteUrl = validateWebsiteUrl(input.websiteUrl);
  return { websiteUrl, ...details };
}

export function validateProductDetails(input: ProductDetailsInput): ProductDetailsInput {
  const productName = requiredString(input?.productName, "Enter a product name between 2 and 180 characters.").trim();
  const ean = normalizeEan(requiredString(input?.ean, "EAN must contain 8, 12, 13, or 14 digits."));
  const sku = optionalString(input?.sku, "SKU must be text.").trim();
  const notes = optionalString(input?.notes, "Notes must be text.").trim();
  if (productName.length < 2 || productName.length > 180) throw new Error("Enter a product name between 2 and 180 characters.");
  if (![8, 12, 13, 14].includes(ean.length)) throw new Error("EAN must contain 8, 12, 13, or 14 digits.");
  if (sku.length > 80) throw new Error("SKU must be 80 characters or fewer.");
  if (notes.length > 500) throw new Error("Notes must be 500 characters or fewer.");
  return { productName, ean, sku, notes };
}

export function validateWebsiteUrl(value: string) {
  let url: URL;
  try { url = new URL(value?.trim()); } catch { throw new Error("Enter a complete website URL beginning with https:// or http://."); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error("Only public http:// and https:// websites are supported.");
  if (url.username || url.password) throw new Error("Website URLs cannot contain usernames or passwords.");
  if (url.port && !['80', '443'].includes(url.port)) throw new Error("Only standard web ports are supported.");
  assertPublicHostname(url.hostname);
  url.hash = "";
  return url.toString();
}

export function assertPublicHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("Local and private network addresses are not supported.");
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) throw new Error("Private network addresses are not supported.");
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    const [a, b] = host.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) throw new Error("Private network addresses are not supported.");
  }
}

function requiredString(value: unknown, message: string) {
  if (typeof value !== "string") throw new Error(message);
  return value;
}

function optionalString(value: unknown, message: string) {
  if (value == null) return "";
  if (typeof value !== "string") throw new Error(message);
  return value;
}
