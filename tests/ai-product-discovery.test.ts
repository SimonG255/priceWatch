import assert from "node:assert/strict";
import test from "node:test";
import { extractAiCandidateUrls, extractAiReviewDecision } from "../lib/ai-product-discovery.ts";

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

test("keeps only same-store replacement URLs from a structured AI review", () => {
  const payload = { output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({
    verdict: "retry",
    confirmedUrl: null,
    retryUrls: ["https://shop.example/products/exact#details", "https://evil.example/products/fake", "not a url"],
    issues: ["wrong_product", "ambiguous_price"],
  }) }] }] };
  assert.deepEqual(extractAiReviewDecision(payload, new URL("https://shop.example")), {
    verdict: "retry",
    issues: ["wrong_product", "ambiguous_price"],
    urls: ["https://shop.example/products/exact"],
  });
});

test("rejects malformed structured AI review output", () => {
  const payload = { output_text: JSON.stringify({ verdict: "confirmed", confirmedUrl: "https://shop.example/p", retryUrls: [] }) };
  assert.equal(extractAiReviewDecision(payload, new URL("https://shop.example")), undefined);
});
