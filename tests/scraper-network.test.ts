import assert from "node:assert/strict";
import test from "node:test";
import { searchPublicWebsite } from "../lib/product-search.ts";
import { createScraperNetwork } from "../lib/scraper-network.ts";

test("rotates user-agents and proxies round-robin", () => {
  const network = createScraperNetwork({
    userAgents: ["Nexus-Test/1", "Nexus-Test/2"],
    proxyUrls: ["http://proxy-one.example:8080", "http://proxy-two.example:8080", "http://proxy-three.example:8080"],
  });

  const first = network.next();
  const second = network.next();
  const third = network.next();
  const fourth = network.next();

  assert.equal(first.userAgent, "Nexus-Test/1");
  assert.equal(second.userAgent, "Nexus-Test/2");
  assert.equal(third.userAgent, "Nexus-Test/1");
  assert.equal(fourth.userAgent, "Nexus-Test/2");
  assert.equal(first.proxyUrl, "http://proxy-one.example:8080/");
  assert.equal(second.proxyUrl, "http://proxy-two.example:8080/");
  assert.equal(third.proxyUrl, "http://proxy-three.example:8080/");
  assert.equal(fourth.proxyUrl, "http://proxy-one.example:8080/");
  assert.ok(first.dispatcher);
  assert.ok(second.dispatcher);
  assert.notEqual(first.dispatcher, second.dispatcher);
});

test("uses the identifiable Nexus user-agent when no pool is configured", () => {
  const network = createScraperNetwork({ userAgents: [], proxyUrls: [] });
  assert.equal(network.next().userAgent, "Nexus/1.0 (+public product monitor)");
  assert.equal(network.next().proxyUrl, undefined);
  assert.equal(network.next().dispatcher, undefined);
});

test("rejects non-HTTP proxy URLs", () => {
  assert.throws(
    () => createScraperNetwork({ proxyUrls: ["socks5://proxy.example:1080"] }),
    /accepts only HTTP\(S\) proxy URLs/i,
  );
});

test("passes the rotated identity to public page fetches", async (t) => {
  const originalFetch = globalThis.fetch;
  let requestInit: RequestInit | undefined;
  globalThis.fetch = (async (_input, init) => {
    requestInit = init;
    return new Response("<html><title>Store</title><body>Store</body></html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await searchPublicWebsite(
    "https://shop.example/",
    "Example product",
    "5099206123456",
    [],
    undefined,
    { onlyProfile: true, network: createScraperNetwork({ userAgents: ["Nexus-Test/1"], proxyUrls: ["http://proxy.example:8080"] }) },
  );

  assert.equal(result.status, "needs_review");
  assert.equal(new Headers(requestInit?.headers).get("user-agent"), "Nexus-Test/1");
  assert.ok((requestInit as RequestInit & { dispatcher?: unknown })?.dispatcher);
});
