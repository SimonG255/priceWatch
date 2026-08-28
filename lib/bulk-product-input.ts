import { validateProductDetails, validateProductInput, type ProductDetailsInput, type ProductInput } from "./product-input.ts";

export type BulkWebsite = { id: string; url: string };

export type PreparedBulkSearches = {
  inputs: ProductInput[];
  productCount: number;
  websiteCount: number;
};

export function prepareBulkProductSearches(
  value: unknown,
  websites: BulkWebsite[],
  maximumSearches = 250,
): PreparedBulkSearches {
  if (!Array.isArray(value) || value.length === 0) throw new Error("Add at least one product.");
  if (value.length > 250) throw new Error("Add up to 250 product rows at a time.");

  const uniqueWebsites = [...new Map(websites.map((website) => [website.id, website])).values()];
  if (!uniqueWebsites.length) throw new Error("Select at least one website.");

  const uniqueProducts = new Map<string, { input: ProductDetailsInput; row: number }>();
  value.forEach((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`Product row ${index + 1} is invalid.`);
    let input: ProductDetailsInput;
    try {
      input = validateProductDetails(item as ProductDetailsInput);
    } catch (error) {
      throw new Error(`Product row ${index + 1}: ${error instanceof Error ? error.message : "Invalid product."}`);
    }
    const existing = uniqueProducts.get(input.ean);
    if (existing) {
      if (!sameProductDetails(existing.input, input)) {
        throw new Error(`Product rows ${existing.row} and ${index + 1} use EAN ${input.ean} with different details.`);
      }
      return;
    }
    uniqueProducts.set(input.ean, { input, row: index + 1 });
  });

  const searchCount = uniqueProducts.size * uniqueWebsites.length;
  if (searchCount > maximumSearches) {
    throw new Error(`This request creates ${searchCount} product searches. Search up to ${maximumSearches} product-website combinations at a time.`);
  }

  const inputs = [...uniqueProducts.values()].flatMap(({ input }) =>
    uniqueWebsites.map((website) => validateProductInput({ ...input, websiteUrl: website.url })),
  );
  return { inputs, productCount: uniqueProducts.size, websiteCount: uniqueWebsites.length };
}

function sameProductDetails(left: ProductDetailsInput, right: ProductDetailsInput) {
  return left.productName === right.productName
    && left.sku === right.sku
    && left.notes === right.notes
    && left.ownPriceCents === right.ownPriceCents
    && left.alertOnPriceDrop === right.alertOnPriceDrop
    && left.alertOnRestock === right.alertOnRestock
    && left.alertTargetPriceCents === right.alertTargetPriceCents
    && left.alertDropPercentBps === right.alertDropPercentBps;
}
