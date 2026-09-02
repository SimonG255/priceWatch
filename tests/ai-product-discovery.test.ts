import assert from "node:assert/strict";
import test from "node:test";
import { discoverStoreProductPages, extractAiCandidateUrls, extractAiReviewDecision, reviewAndRecoverProductPageUrls } from "../lib/ai-product-discovery.ts";

test("times out when the AI response body stalls after headers arrive", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalApiKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";

  // Shorten only the production timeout for this test while leaving the test
  // harness timer untouched for the bounded failure assertion.
  globalThis.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
    originalSetTimeout(handler, timeout === 20_000 ? 10 : timeout, ...args)) as typeof setTimeout;
  globalThis.fetch = (async (_input, init) => {
    const signal = init?.signal;
    return {
      ok: true,
      status: 200,
      json: () => new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          const error = new Error("Request aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      }),
    } as Response;
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    if (originalApiKey == null) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
  });

  const result = await Promise.race([
    reviewAndRecoverProductPageUrls({ websiteUrl: "https://shop.example/", productName: "Example", ean: "0000000000000" }),
    new Promise<{ error?: string }>((resolve) => originalSetTimeout(() => resolve({ error: "test assertion timed out" }), 100)),
  ]);

  assert.equal(result.error, "AI review timed out.");
});

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

test("discovers public stores globally and removes non-store sources", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";
  let requestBody: Record<string, unknown> | undefined;
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      status: "completed",
      output: [
        { type: "web_search_call", action: { sources: [
          { url: "https://www.trgovinejager.com/pralni-stroj-5099206123456", title: "Jager product" },
          { url: "https://www.google.com/search?q=5099206123456", title: "Search results" },
          { url: "https://shop.example/product/5099206123456", title: "Example shop" },
          { url: "https://shop.example/another-page", title: "Duplicate shop" },
        ] } },
        { type: "message", content: [{ type: "output_text", text: JSON.stringify({ stores: [
          { productUrl: "https://store.example/item/5099206123456", title: "Structured store" },
        ] }) }] },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalApiKey == null) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
  });

  const result = await discoverStoreProductPages([{ productName: "Example product", ean: "5099206123456" }], "Slovenia");

  assert.deepEqual(result.stores.map((store) => store.hostname), ["store.example", "trgovinejager.com", "shop.example"]);
  assert.equal(requestBody?.tool_choice, "required");
  assert.deepEqual(requestBody?.tools, [{ type: "web_search" }]);
  assert.match(String(requestBody?.input), /Slovenia/);
});

test("passes an ISO country code to web search", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";
  let requestBody: Record<string, unknown> | undefined;
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ stores: [] }) }] }] }), { status: 200 });
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalApiKey == null) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
  });

  await discoverStoreProductPages([{ productName: "Example product", ean: "5099206123456" }], "SI");

  assert.deepEqual(requestBody?.tools, [{ type: "web_search", user_location: { type: "approximate", country: "SI" } }]);
  assert.match(String(requestBody?.input), /Target country/);
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
