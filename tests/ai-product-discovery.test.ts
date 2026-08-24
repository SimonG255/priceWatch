import assert from "node:assert/strict";
import test from "node:test";
import { extractAiCandidateUrls } from "../lib/ai-product-discovery.ts";

test("keeps only same-store URLs returned by AI web search", () => {
  const payload = { output: [{ type: "web_search_call", action: { sources: [
    { url: "https://shop.example/products/exact-item#details" },
    { url: "https://shop.example/products/exact-item#reviews" },
    { url: "https://cdn.shop.example/catalog/item" },
    { url: "https://evil.example/fake-item" },
    { url: "javascript:alert(1)" },
  ] } }] };
  assert.deepEqual(extractAiCandidateUrls(payload, new URL("https://shop.example/")), [
    "https://shop.example/products/exact-item",
    "https://cdn.shop.example/catalog/item",
  ]);
});

test("accepts citation URLs but rejects malformed AI output", () => {
  const payload = { output: [{ type: "message", content: [{ annotations: [
    { type: "url_citation", url: "https://store.example/product/123" },
    { type: "url_citation", url: "not a url" },
  ] }] }] };
  assert.deepEqual(extractAiCandidateUrls(payload, new URL("https://store.example")), ["https://store.example/product/123"]);
  assert.deepEqual(extractAiCandidateUrls(null, new URL("https://store.example")), []);
});
