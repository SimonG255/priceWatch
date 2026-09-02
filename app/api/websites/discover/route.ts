import { eq } from "drizzle-orm";
import { ensureProductsSchema, getDb } from "../../../../db";
import { monitoredWebsites } from "../../../../db/schema";
import { getCurrentUserEmail } from "../../../../lib/current-user";
import { discoverStoreProductPages, type StoreDiscoveryInput } from "../../../../lib/ai-product-discovery";
import { validateProductDetails } from "../../../../lib/product-input";

const MAX_DISCOVERY_PRODUCTS = 20;

export async function POST(request: Request) {
  const ownerEmail = await getCurrentUserEmail();
  if (!ownerEmail) return Response.json({ error: "Sign in to discover stores." }, { status: 401 });

  try {
    await ensureProductsSchema();
    const body = await request.json() as { products?: unknown; country?: unknown };
    const inputs = normalizeDiscoveryInputs(body.products);
    const country = normalizeDiscoveryCountry(body.country);
    const discovery = await discoverStoreProductPages(inputs, country);
    if (!discovery.attempted) throw new Error("Automatic store discovery is not configured yet. Add a website manually or configure the OpenAI API key.");
    if (discovery.error && !discovery.stores.length) throw new Error(discovery.error);
    if (!discovery.stores.length) throw new Error("No matching online stores were found. Try a more specific product name or check the EAN.");

    const db = getDb();
    const websites = [];
    for (const store of discovery.stores) {
      const [website] = await db.insert(monitoredWebsites).values({
        id: crypto.randomUUID(),
        ownerEmail,
        url: store.url,
      }).onConflictDoUpdate({
        target: [monitoredWebsites.ownerEmail, monitoredWebsites.url],
        set: { url: store.url },
      }).returning();
      if (website) websites.push(website);
    }

    // Return the authoritative rows from the database so the client can use
    // the correct IDs for the following product bulk request.
    const saved = await db.select().from(monitoredWebsites).where(eq(monitoredWebsites.ownerEmail, ownerEmail));
    const savedByUrl = new Map(saved.map((website) => [website.url, website]));
    return Response.json({
      websites: websites.map((website) => savedByUrl.get(website.url) ?? website),
      stores: discovery.stores,
      discoveredCount: discovery.stores.length,
    }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Online stores could not be discovered." }, { status: 400 });
  }
}

function normalizeDiscoveryInputs(value: unknown): StoreDiscoveryInput[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error("Add at least one product before discovering stores.");
  if (value.length > MAX_DISCOVERY_PRODUCTS) throw new Error(`Discover stores for up to ${MAX_DISCOVERY_PRODUCTS} products at a time.`);

  const unique = new Map<string, StoreDiscoveryInput>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("The product discovery input is invalid.");
    const details = validateProductDetails(item as StoreDiscoveryInput);
    if (!unique.has(details.ean)) unique.set(details.ean, { productName: details.productName, ean: details.ean });
  }
  return [...unique.values()];
}

function normalizeDiscoveryCountry(value: unknown): string {
  if (typeof value !== "string") throw new Error("Enter a country before discovering stores.");
  const country = value.trim().replace(/\s+/g, " ");
  if (!country) throw new Error("Enter a country before discovering stores.");
  if (country.length > 80 || /[\u0000-\u001F\u007F]/.test(country)) throw new Error("Enter a valid country name.");
  return country;
}
