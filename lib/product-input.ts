export type ProductInput = {
  websiteUrl: string;
  productName: string;
  ean: string;
  sku?: string;
  notes?: string;
  ownPriceCents?: number | null;
  alertOnPriceDrop?: boolean;
  alertOnRestock?: boolean;
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
  const ownPriceCents = input?.ownPriceCents == null ? null : Number(input.ownPriceCents);
  if (productName.length < 2 || productName.length > 180) throw new Error("Enter a product name between 2 and 180 characters.");
  if (![8, 12, 13, 14].includes(ean.length)) throw new Error("EAN must contain 8, 12, 13, or 14 digits.");
  if (sku.length > 80) throw new Error("SKU must be 80 characters or fewer.");
  if (notes.length > 500) throw new Error("Notes must be 500 characters or fewer.");
  if (!isValidGtin(ean)) throw new Error("EAN/GTIN check digit is invalid.");
  if (ownPriceCents != null && (!Number.isSafeInteger(ownPriceCents) || ownPriceCents < 0 || ownPriceCents > 1_000_000_000))
    throw new Error("Your price must be a valid non-negative amount.");
  return {
    productName,
    ean,
    sku,
    notes,
    ownPriceCents,
    alertOnPriceDrop: input?.alertOnPriceDrop !== false,
    alertOnRestock: input?.alertOnRestock !== false,
  };
}

export function isValidGtin(value: string) {
  const digits = normalizeEan(value);
  if (![8, 12, 13, 14].includes(digits.length)) return false;
  const checkDigit = Number(digits.at(-1));
  let sum = 0;
  for (let index = digits.length - 2, position = 0; index >= 0; index -= 1, position += 1) {
    sum += Number(digits[index]) * (position % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10 === checkDigit;
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
  if (typeof hostname !== "string" || !hostname.trim()) throw new Error("Enter a valid public hostname.");
  let host: string;
  try {
    host = new URL(`http://${hostname.trim()}`).hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  } catch {
    throw new Error("Enter a valid public hostname.");
  }
  if (!host || /\s/.test(host)) throw new Error("Enter a valid public hostname.");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("Local and private network addresses are not supported.");
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    const octets = host.split(".").map(Number);
    if (octets.some((value) => value < 0 || value > 255) || !isPublicIpv4(octets)) throw new Error("Private and reserved network addresses are not supported.");
  } else if (host.includes(":")) {
    if (!isPublicIpv6(host)) throw new Error("Private and reserved network addresses are not supported.");
  }
}

function isPublicIpv4([a, b, c]: number[]) {
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)))) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function isPublicIpv6(host: string) {
  const first = Number.parseInt(host.split(":")[0] || "0", 16);
  if (host === "::" || host === "::1") return false;
  if ((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xffc0) === 0xfec0 || (first & 0xff00) === 0xff00) return false;
  const mapped = host.match(/^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (mapped) {
    const high = Number.parseInt(mapped[1], 16);
    const low = Number.parseInt(mapped[2], 16);
    return isPublicIpv4([high >> 8, high & 255, low >> 8, low & 255]);
  }
  return host !== "2001:db8::" && !host.startsWith("2001:db8:");
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
