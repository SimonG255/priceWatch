import assert from "node:assert/strict";
import test from "node:test";
import { prepareBulkProductSearches } from "../lib/bulk-product-input.ts";

const products = [
  { productName: "Product One", ean: "12345670", sku: "ONE" },
  { productName: "Product Two", ean: "123456789012", sku: "TWO" },
];

const websites = [
  { id: "one", url: "https://one.example/" },
  { id: "two", url: "https://two.example/" },
  { id: "three", url: "https://three.example/" },
];

test("builds every unique product and website combination", () => {
  const prepared = prepareBulkProductSearches(products, websites);
  assert.equal(prepared.productCount, 2);
  assert.equal(prepared.websiteCount, 3);
  assert.equal(prepared.inputs.length, 6);
  assert.deepEqual(new Set(prepared.inputs.map(input => `${input.ean}@${new URL(input.websiteUrl).hostname}`)).size, 6);
});

test("deduplicates repeated product rows and website IDs", () => {
  const prepared = prepareBulkProductSearches([products[0], { ...products[0], ean: "1234 5670" }], [websites[0], websites[0]]);
  assert.equal(prepared.productCount, 1);
  assert.equal(prepared.websiteCount, 1);
  assert.equal(prepared.inputs.length, 1);
});

test("rejects a GTIN with an invalid check digit", () => {
  assert.throws(() => prepareBulkProductSearches([{ productName: "Invalid", ean: "12345678" }], [websites[0]]), /check digit/i);
});

test("rejects duplicate EAN rows with conflicting details", () => {
  assert.throws(() => prepareBulkProductSearches([products[0], { ...products[0], productName: "Another product" }], websites), /different details/);
});

test("requires a product and a website before producing combinations", () => {
  assert.throws(() => prepareBulkProductSearches([], websites), /at least one product/i);
  assert.throws(() => prepareBulkProductSearches(products, []), /at least one website/i);
});

test("enforces the combination limit after deduplication", () => {
  const manyWebsites = Array.from({ length: 251 }, (_, index) => ({ id: String(index), url: `https://store-${index}.example/` }));
  assert.equal(prepareBulkProductSearches([products[0]], manyWebsites.slice(0, 250)).inputs.length, 250);
  assert.throws(() => prepareBulkProductSearches([products[0]], manyWebsites), /251 product searches/);
});
