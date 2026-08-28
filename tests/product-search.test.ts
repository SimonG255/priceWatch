import assert from "node:assert/strict";
import test from "node:test";
import { renderWithPermittedService } from "../lib/permitted-page-renderer.ts";
import { searchPublicWebsite } from "../lib/product-search.ts";

const productName = "Logitech MX Master 4";
const ean = "5099206123456";
const storeUrl = "https://shop.example/";
const openAiUrl = "https://api.openai.com/v1/responses";

function productPage(options: { name?: string; gtin?: string; price?: string; url?: string } = {}) {
  const name = options.name ?? productName;
  const gtin = options.gtin ?? ean;
  const offer = options.price == null ? undefined : { "@type": "Offer", price: options.price, priceCurrency: "EUR", availability: "https://schema.org/InStock" };
  return `<html><head><title>${name}</title><script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org", "@type": "Product", name, gtin13: gtin, url: options.url, offers: offer,
  })}</script></head><body><h1>${name}</h1><p>EAN ${gtin}</p>${options.price == null ? "" : `<span class="current-price">EUR ${options.price}</span>`}</body></html>`;
}

function htmlResponse(html: string, status = 200) {
  return new Response(html, { status, headers: { "content-type": "text/html" } });
}

function aiReviewResponse(decision: unknown, sourceUrls: string[] = []) {
  return new Response(JSON.stringify({ status: "completed", output: [
    ...(sourceUrls.length ? [{ type: "web_search_call", action: { sources: sourceUrls.map((url) => ({ url })) } }] : []),
    { type: "message", content: [{ type: "output_text", text: JSON.stringify(decision) }] },
  ] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function installFetchMock(t: test.TestContext, handler: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";
  globalThis.fetch = (async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return handler(url, init);
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalApiKey == null) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
  });
}

test("AI reviews a locally found product before it is accepted", async (t) => {
  let reviewRequest: Record<string, unknown> | undefined;
  installFetchMock(t, (url, init) => {
    if (url === openAiUrl) {
      reviewRequest = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return aiReviewResponse({ verdict: "confirmed", confirmedUrl: "https://shop.example/mx-master-4", retryUrls: [], issues: [] });
    }
    if (url === storeUrl) return htmlResponse(productPage({ price: "109.90", url: "/mx-master-4" }));
    return htmlResponse("Not found", 404);
  });

  const result = await searchPublicWebsite(storeUrl, productName, ean);

  assert.equal(result.status, "found");
  assert.equal(result.priceCents, 10990);
  assert.match(result.message, /AI review/);
  assert.equal(reviewRequest?.tool_choice, "required");
  assert.match(String(reviewRequest?.input), /5099206123456/);
  assert.match(String(reviewRequest?.input), /109\.90 EUR/);
});

test("AI-rejected local product is replaced by a locally verified recovery URL", async (t) => {
  installFetchMock(t, (url) => {
    if (url === openAiUrl) {
      return aiReviewResponse({
        verdict: "retry",
        confirmedUrl: "",
        retryUrls: ["https://shop.example/products/mx-master-4"],
        issues: ["wrong_product"],
      });
    }
    if (url === storeUrl) return htmlResponse(productPage({ gtin: "1111111111111", price: "59.90", url: "/products/other-mouse" }));
    if (url === "https://shop.example/products/mx-master-4") return htmlResponse(productPage({ price: "109.90", url: "/products/mx-master-4" }));
    return htmlResponse("Not found", 404);
  });

  const result = await searchPublicWebsite(storeUrl, productName, ean);

  assert.equal(result.status, "found");
  assert.equal(result.matchedUrl, "https://shop.example/products/mx-master-4");
  assert.equal(result.priceCents, 10990);
  assert.match(result.message, /AI-assisted discovery/);
});

test("AI recovery runs when the normal website scan finds no product", async (t) => {
  installFetchMock(t, (url) => {
    if (url === openAiUrl) {
      return aiReviewResponse({
        verdict: "retry",
        confirmedUrl: "",
        retryUrls: ["https://shop.example/products/mx-master-4"],
        issues: ["not_found"],
      });
    }
    if (url === "https://shop.example/products/mx-master-4") return htmlResponse(productPage({ price: "109.90", url: "/products/mx-master-4" }));
    return url === storeUrl ? htmlResponse("<html><title>Store</title><body>Welcome</body></html>") : htmlResponse("Not found", 404);
  });

  const result = await searchPublicWebsite(storeUrl, productName, ean);

  assert.equal(result.status, "found");
  assert.equal(result.matchedUrl, "https://shop.example/products/mx-master-4");
});

test("AI web-search sources can recover a product page when the retry list is empty", async (t) => {
  const recoveredUrl = "https://shop.example/products/mx-master-4";
  installFetchMock(t, (url) => {
    if (url === openAiUrl) return aiReviewResponse({ verdict: "retry", confirmedUrl: null, retryUrls: [], issues: ["not_found"] }, [recoveredUrl]);
    if (url === storeUrl) return htmlResponse("<html><title>Store</title><body>Welcome</body></html>");
    if (url === recoveredUrl) return htmlResponse(productPage({ price: "109.90", url: "/products/mx-master-4" }));
    return htmlResponse("Not found", 404);
  });

  const result = await searchPublicWebsite(storeUrl, productName, ean);

  assert.equal(result.status, "found");
  assert.equal(result.matchedUrl, recoveredUrl);
});

test("an EAN match without a current price is routed to review after AI review", async (t) => {
  installFetchMock(t, (url) => {
    if (url === openAiUrl) return aiReviewResponse({ verdict: "not_found", confirmedUrl: "", retryUrls: [], issues: ["missing_price"] });
    return url === storeUrl ? htmlResponse(productPage({ price: undefined, url: "/products/mx-master-4" })) : htmlResponse("Not found", 404);
  });

  const result = await searchPublicWebsite(storeUrl, productName, ean);

  assert.equal(result.status, "needs_review");
  assert.equal(result.priceCents, undefined);
});

test("an unavailable AI review preserves a strong locally verified result", async (t) => {
  installFetchMock(t, (url) => {
    if (url === openAiUrl) return new Response("Service unavailable", { status: 503 });
    return url === storeUrl ? htmlResponse(productPage({ price: "109.90", url: "/products/mx-master-4" })) : htmlResponse("Not found", 404);
  });

  const result = await searchPublicWebsite(storeUrl, productName, ean);

  assert.equal(result.status, "found");
  assert.equal(result.priceCents, 10990);
  assert.doesNotMatch(result.message, /AI review/);
});

test("an incomplete AI review preserves a strong locally verified result", async (t) => {
  installFetchMock(t, (url) => {
    if (url === openAiUrl) return new Response(JSON.stringify({ status: "incomplete", output: [] }), { status: 200, headers: { "content-type": "application/json" } });
    return url === storeUrl ? htmlResponse(productPage({ price: "109.90", url: "/products/mx-master-4" })) : htmlResponse("Not found", 404);
  });

  const result = await searchPublicWebsite(storeUrl, productName, ean);

  assert.equal(result.status, "found");
  assert.equal(result.priceCents, 10990);
  assert.doesNotMatch(result.message, /AI review/);
});

test("a blank AI confirmation routes the unapproved local candidate to review", async (t) => {
  installFetchMock(t, (url) => {
    if (url === openAiUrl) return aiReviewResponse({ verdict: "confirmed", confirmedUrl: null, retryUrls: [], issues: [] });
    return url === storeUrl ? htmlResponse(productPage({ price: "109.90", url: "/mx-master-4" })) : htmlResponse("Not found", 404);
  });

  const result = await searchPublicWebsite(storeUrl, productName, ean);

  assert.equal(result.status, "needs_review");
});

test("a mismatched AI confirmation leaves the local candidate needing review", async (t) => {
  installFetchMock(t, (url) => {
    if (url === openAiUrl) return aiReviewResponse({ verdict: "confirmed", confirmedUrl: "https://shop.example/products/different", retryUrls: [], issues: [] });
    return url === storeUrl ? htmlResponse(productPage({ price: "109.90", url: "/mx-master-4" })) : htmlResponse("Not found", 404);
  });

  const result = await searchPublicWebsite(storeUrl, productName, ean);

  assert.equal(result.status, "needs_review");
});

test("AI reviews the locally acceptable candidate rather than a higher-scoring no-price page", async (t) => {
  let reviewInput = "";
  installFetchMock(t, (url, init) => {
    if (url === openAiUrl) {
      reviewInput = String(JSON.parse(String(init?.body)).input);
      return aiReviewResponse({ verdict: "confirmed", confirmedUrl: "https://shop.example/products/name-match", retryUrls: [], issues: [] });
    }
    if (url === storeUrl) return htmlResponse(`${productPage({ price: undefined, url: "/products/ean-no-price" })}<a href="/products/name-match">${productName}</a>`);
    if (url === "https://shop.example/products/name-match") return htmlResponse(productPage({ gtin: "1111111111111", price: "59.90", url: "/products/name-match" }));
    return htmlResponse("Not found", 404);
  });

  const result = await searchPublicWebsite(storeUrl, productName, ean);

  assert.equal(result.status, "found");
  assert.equal(result.priceCents, 5990);
  assert.match(reviewInput, /products\/name-match/);
});

test("AI recovery can re-check a valid page the normal crawler already visited", async (t) => {
  installFetchMock(t, (url) => {
    if (url === openAiUrl) return aiReviewResponse({ verdict: "retry", confirmedUrl: null, retryUrls: ["https://shop.example/products/recovery"], issues: ["ambiguous_price"] });
    if (url === storeUrl) return htmlResponse(`${productPage({ price: "109.90", url: "/products/initial" })}<a href="/products/recovery">${productName}</a>`);
    if (url === "https://shop.example/products/recovery") return htmlResponse(productPage({ price: "99.90", url: "/products/recovery" }));
    return htmlResponse("Not found", 404);
  });

  const result = await searchPublicWebsite(storeUrl, productName, ean);

  assert.equal(result.status, "found");
  assert.equal(result.matchedUrl, "https://shop.example/products/recovery");
  assert.equal(result.priceCents, 9990);
});

test("an edited HTML-signature profile is applied before earlier search routes exhaust the page cap", async (t) => {
  const siteCalls: string[] = [];
  const profiles = [
    { id: "edited", label: "Edited profile", hostname: "shop.example", htmlSignature: "new-search-marker", searchUrlTemplate: "/new-search?term={query}" },
    ...["one", "two", "three", "four"].map((id) => ({ id, label: `Old ${id}`, hostname: "shop.example", htmlSignature: "", searchUrlTemplate: `/old-${id}?q={query}` })),
  ];
  const editedSearchUrl = `https://shop.example/new-search?term=${ean}`;
  installFetchMock(t, (url) => {
    if (url === openAiUrl) return aiReviewResponse({ verdict: "confirmed", confirmedUrl: editedSearchUrl, retryUrls: [], issues: [] });
    siteCalls.push(url);
    if (url === storeUrl) return htmlResponse('<html><head><meta name="platform" content="new-search-marker"></head><body>Store</body></html>');
    if (url === editedSearchUrl) return htmlResponse(productPage({ price: "109.90" }));
    if (url.startsWith("https://shop.example/old-")) return htmlResponse("<html><body>Old search route</body></html>");
    return htmlResponse("Not found", 404);
  });

  const result = await searchPublicWebsite(storeUrl, productName, ean, profiles);

  assert.equal(result.status, "found");
  assert.equal(result.matchedUrl, editedSearchUrl);
  assert.equal(siteCalls[0], storeUrl);
  assert.ok(siteCalls.includes(editedSearchUrl));
});

test("removes generic search URLs when the submitted page activates an admin profile", async (t) => {
  const siteCalls: string[] = [];
  const profiles = [{
    id: "jager-style", label: "Configured search", hostname: "shop.example", htmlSignature: "configured-search-marker", searchUrlTemplate: "/configured-search?isci={query}",
  }];
  const configuredSearchUrl = `https://shop.example/configured-search?isci=${ean}`;
  installFetchMock(t, (url) => {
    if (url === openAiUrl) return aiReviewResponse({ verdict: "confirmed", confirmedUrl: configuredSearchUrl, retryUrls: [], issues: [] });
    siteCalls.push(url);
    if (url === storeUrl) return htmlResponse('<html><head><meta name="platform" content="configured-search-marker"></head><body>Store</body></html>');
    if (url === configuredSearchUrl) return htmlResponse(productPage({ price: "109.90" }));
    return htmlResponse("Unexpected generic route", 404);
  });

  const result = await searchPublicWebsite(storeUrl, productName, ean, profiles);

  assert.equal(result.status, "found");
  assert.ok(siteCalls.includes(configuredSearchUrl));
  assert.equal(siteCalls.some((url) => /\/(?:search|\?s=)/.test(new URL(url).pathname + new URL(url).search)), false);
});

test("reports a configured-search timeout instead of marking a product not found", async (t) => {
  const profiles = [{
    id: "configured", label: "Configured search", hostname: "shop.example", htmlSignature: "", searchUrlTemplate: "/configured-search?term={query}",
  }];
  installFetchMock(t, (url) => {
    if (url === openAiUrl) return aiReviewResponse({ verdict: "not_found", confirmedUrl: null, retryUrls: [], issues: ["not_found"] });
    if (url === storeUrl) return htmlResponse("<html><title>Store</title><body>Welcome</body></html>");
    if (url.startsWith("https://shop.example/configured-search")) {
      const timeout = new Error("Request aborted");
      timeout.name = "AbortError";
      throw timeout;
    }
    return htmlResponse("Not found", 404);
  });

  const result = await searchPublicWebsite(storeUrl, productName, ean, profiles);

  assert.equal(result.status, "unavailable");
  assert.match(result.message, /configured website search did not respond within 15 seconds/i);
});

test("reports a configured website challenge as blocked", async (t) => {
  const profiles = [{
    id: "configured", label: "Configured search", hostname: "shop.example", htmlSignature: "", searchUrlTemplate: "/configured-search?term={query}",
  }];
  let aiCalled = false;
  installFetchMock(t, (url) => {
    if (url === openAiUrl) { aiCalled = true; return aiReviewResponse({ verdict: "not_found", confirmedUrl: null, retryUrls: [], issues: ["not_found"] }); }
    if (url === storeUrl) return htmlResponse("<html><title>Store</title><body>Welcome</body></html>");
    if (url.startsWith("https://shop.example/configured-search")) return htmlResponse("<html><title>Just a moment...</title><body>Checking your browser before accessing</body></html>");
    return htmlResponse("Not found", 404);
  });

  const result = await searchPublicWebsite(storeUrl, productName, ean, profiles);

  assert.equal(result.status, "blocked");
  assert.match(result.message, /challenge detected/i);
  assert.equal(aiCalled, false);
});

test("uses a sitemap URL only after its page verifies the EAN and current price", async (t) => {
  const profiles = [{
    id: "catalog", label: "Catalog search", hostname: "shop.example", htmlSignature: "", searchUrlTemplate: "/catalog?term={query}",
  }];
  const canonicalUrl = "https://shop.example/products/mx-master-4-5099206123456";
  const calls: string[] = [];
  installFetchMock(t, (url) => {
    if (url === openAiUrl) return aiReviewResponse({ verdict: "confirmed", confirmedUrl: canonicalUrl, retryUrls: [], issues: [] });
    calls.push(url);
    if (url === storeUrl) return htmlResponse("<html><title>Store</title><body>Welcome</body></html>");
    if (url.startsWith("https://shop.example/catalog")) return htmlResponse("Not found", 404);
    if (url === "https://shop.example/robots.txt") return htmlResponse("Sitemap: https://shop.example/sitemap-products.xml");
    if (url === "https://shop.example/sitemap-products.xml") return htmlResponse(`<urlset><url><loc>https://evil.example/products/${ean}</loc></url><url><loc>${canonicalUrl}</loc></url></urlset>`);
    if (url === canonicalUrl) return htmlResponse(productPage({ price: "109.90", url: canonicalUrl }));
    return htmlResponse("Not found", 404);
  });

  const result = await searchPublicWebsite(storeUrl, productName, ean, profiles);

  assert.equal(result.status, "found");
  assert.equal(result.matchedUrl, canonicalUrl);
  assert.equal(result.priceCents, 10990);
  assert.equal(calls.includes(`https://evil.example/products/${ean}`), false);
});

test("does not accept a sitemap page with the right model but the wrong EAN", async (t) => {
  const sitemapName = "Samsung WW11DG6B25LEU4";
  const sitemapEan = "8806095539737";
  const canonicalUrl = "https://shop.example/products/samsung-ww11dg6b25leu4";
  installFetchMock(t, (url) => {
    if (url === openAiUrl) return aiReviewResponse({ verdict: "not_found", confirmedUrl: null, retryUrls: [], issues: ["missing_ean"] });
    if (url === storeUrl) return htmlResponse("<html><title>Store</title><body>Welcome</body></html>");
    if (url === "https://shop.example/robots.txt") return htmlResponse("Sitemap: https://shop.example/sitemap-products.xml");
    if (url === "https://shop.example/sitemap-products.xml") return htmlResponse(`<urlset><url><loc>${canonicalUrl}</loc></url></urlset>`);
    if (url === canonicalUrl) return htmlResponse(productPage({ name: sitemapName, gtin: "1111111111111", price: "499.99", url: canonicalUrl }));
    return htmlResponse("Not found", 404);
  });

  const result = await searchPublicWebsite(storeUrl, sitemapName, sitemapEan);

  assert.notEqual(result.status, "found");
  assert.equal(result.priceCents, undefined);
});

test("Jager's public sitemap exposes the canonical page when its search is challenged", async (t) => {
  const jagerRoot = "https://www.trgovinejager.com/";
  const jagerProduct = "Samsung WW11DG6B25LEU4";
  const jagerEan = "8806095539737";
  const canonicalUrl = "https://www.trgovinejager.com/pralni-stroji/pralni-stroj-samsung-ww11dg6b25leu4/";
  const calls: string[] = [];
  installFetchMock(t, (url) => {
    if (url === openAiUrl) throw new Error("AI must not run after sitemap-page verification is blocked.");
    calls.push(url);
    if (url === jagerRoot) return htmlResponse("<html><title>Jager</title><body>Store</body></html>");
    if (url.startsWith("https://www.trgovinejager.com/iskalnik/")) return htmlResponse("<html><title>Just a moment...</title><body>Checking your browser before accessing</body></html>");
    if (url === "https://www.trgovinejager.com/robots.txt") return htmlResponse("Sitemap: https://www.trgovinejager.com/f/sitemaps/sitemap_index.xml", 200);
    if (url === "https://www.trgovinejager.com/f/sitemaps/sitemap_index.xml") return htmlResponse("<sitemapindex><sitemap><loc>https://www.trgovinejager.com/f/sitemaps/sl/sitemap-sl.xml</loc></sitemap></sitemapindex>");
    if (url === "https://www.trgovinejager.com/f/sitemaps/sl/sitemap-sl.xml") return htmlResponse("<sitemapindex><sitemap><loc>https://www.trgovinejager.com/f/sitemaps/sl/sitemap_products_sl_1.xml</loc></sitemap></sitemapindex>");
    if (url === "https://www.trgovinejager.com/f/sitemaps/sl/sitemap_products_sl_1.xml") return htmlResponse(`<urlset><url><loc>${canonicalUrl}</loc></url></urlset>`);
    if (url === canonicalUrl) return htmlResponse("<html><title>Just a moment...</title><body>Checking your browser before accessing</body></html>");
    return htmlResponse("Not found", 404);
  });

  const result = await searchPublicWebsite(jagerRoot, jagerProduct, jagerEan);

  assert.equal(result.status, "blocked");
  assert.equal(result.matchedUrl, canonicalUrl);
  assert.equal(result.title, undefined);
  assert.match(result.message, /sitemap located a candidate product page/i);
  assert.equal(calls.some((url) => url.includes("/search?")), false);
  assert.equal(calls.filter((url) => url.startsWith("https://www.trgovinejager.com/iskalnik/")).length, 1);
});

test("reports a sitemap candidate page returning 503 as unavailable", async (t) => {
  const jagerRoot = "https://www.trgovinejager.com/";
  const jagerProduct = "Samsung WW11DG6B25LEU4";
  const jagerEan = "8806095539737";
  const canonicalUrl = "https://www.trgovinejager.com/pralni-stroji/pralni-stroj-samsung-ww11dg6b25leu4/";
  installFetchMock(t, (url) => {
    if (url === openAiUrl) throw new Error("AI must not run after a sitemap-page availability failure.");
    if (url === jagerRoot) return htmlResponse("<html><title>Jager</title><body>Store</body></html>");
    if (url.startsWith("https://www.trgovinejager.com/iskalnik/")) return htmlResponse("<html><title>Just a moment...</title><body>Checking your browser before accessing</body></html>");
    if (url === "https://www.trgovinejager.com/robots.txt") return htmlResponse("Sitemap: https://www.trgovinejager.com/sitemap-products.xml");
    if (url === "https://www.trgovinejager.com/sitemap-products.xml") return htmlResponse(`<urlset><url><loc>${canonicalUrl}</loc></url></urlset>`);
    if (url === canonicalUrl) return htmlResponse("Temporarily unavailable", 503);
    return htmlResponse("Not found", 404);
  });

  const result = await searchPublicWebsite(jagerRoot, jagerProduct, jagerEan);

  assert.equal(result.status, "unavailable");
  assert.equal(result.matchedUrl, canonicalUrl);
  assert.match(result.message, /temporarily unavailable/i);
});

test("reuses a previously verified product only after a conditional 304 response", async (t) => {
  const canonicalUrl = "https://shop.example/products/mx-master-4";
  let conditionalHeaders: Headers | undefined;
  installFetchMock(t, (url, init) => {
    if (url === storeUrl) return htmlResponse("<html><title>Store</title><body>Welcome</body></html>");
    if (url === canonicalUrl) {
      conditionalHeaders = new Headers(init?.headers);
      return new Response(null, {
        status: 304,
        headers: { etag: '"mx-master-v1"', "last-modified": "Wed, 01 Jan 2025 00:00:00 GMT" },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  });

  const result = await searchPublicWebsite(storeUrl, productName, ean, [], canonicalUrl, {
    previous: {
      status: "found",
      matchedUrl: canonicalUrl,
      title: productName,
      priceCents: 10990,
      currency: "EUR",
      inStock: true,
      matchType: "ean",
      confidence: "high",
      evidence: {
        exactEan: true,
        structuredExactEan: true,
        structuredProduct: true,
        nameScore: 1,
        priceSource: "structured",
        canonicalUrl,
        checkedAt: "2025-01-01T00:00:00.000Z",
      },
      pageEtag: '"mx-master-v1"',
      pageLastModified: "Wed, 01 Jan 2025 00:00:00 GMT",
    },
  });

  assert.equal(conditionalHeaders?.get("if-none-match"), '"mx-master-v1"');
  assert.equal(conditionalHeaders?.get("if-modified-since"), "Wed, 01 Jan 2025 00:00:00 GMT");
  assert.equal(result.status, "found");
  assert.equal(result.httpStatus, 304);
  assert.equal(result.priceCents, 10990);
  assert.equal(result.evidence?.exactEan, true);
  assert.equal(result.evidence?.canonicalUrl, canonicalUrl);
});

test("uses a cached sitemap URL only as a discovery hint and still verifies its page", async (t) => {
  const canonicalUrl = "https://shop.example/products/mx-master-4";
  const cacheLookups: Array<{ hostname: string; ean: string }> = [];
  const cacheWrites: unknown[] = [];
  const siteCalls: string[] = [];
  const profiles = [{
    id: "catalog",
    label: "Catalog search",
    hostname: "shop.example",
    htmlSignature: "",
    searchUrlTemplate: "/catalog?term={query}",
  }];
  installFetchMock(t, (url) => {
    if (url === openAiUrl) return aiReviewResponse({ verdict: "confirmed", confirmedUrl: canonicalUrl, retryUrls: [], issues: [] });
    siteCalls.push(url);
    if (url === storeUrl) return htmlResponse("<html><title>Store</title><body>Welcome</body></html>");
    if (url.startsWith("https://shop.example/catalog")) return htmlResponse("Not found", 404);
    if (url === canonicalUrl) return htmlResponse(productPage({ price: "109.90", url: canonicalUrl }));
    if (url.includes("robots.txt") || url.includes("sitemap")) throw new Error("A cached sitemap hint must not fetch sitemap documents.");
    throw new Error(`Unexpected request: ${url}`);
  });

  const result = await searchPublicWebsite(storeUrl, productName, ean, profiles, undefined, {
    sitemapCache: {
      async get(query) {
        cacheLookups.push(query);
        return {
          candidateUrl: canonicalUrl,
          sitemapUrl: "https://shop.example/sitemap-products.xml",
          sitemapLastmod: "2025-01-01",
        };
      },
      async put(input) {
        cacheWrites.push(input);
      },
    },
  });

  assert.deepEqual(cacheLookups, [{ hostname: "shop.example", ean }]);
  assert.equal(cacheWrites.length, 0);
  assert.equal(siteCalls.includes(canonicalUrl), true);
  assert.equal(siteCalls.some((url) => url.includes("robots.txt") || url.includes("sitemap")), false);
  assert.equal(result.status, "found");
  assert.equal(result.priceCents, 10990);
  assert.equal(result.evidence?.exactEan, true);
  assert.equal(result.evidence?.priceSource, "structured");
  assert.equal(result.evidence?.canonicalUrl, canonicalUrl);
});

test("uses an opted-in permitted renderer when normal HTML lacks product data", async (t) => {
  const canonicalUrl = "https://shop.example/products/mx-master-4";
  const rendererCalls: Array<{ url: string; hostname: string; waitForSelector?: string; cookieConsentSelector?: string }> = [];
  const profiles = [{
    id: "javascript-store",
    label: "JavaScript store",
    hostname: "shop.example",
    htmlSignature: "",
    searchUrlTemplate: "/catalog?term={query}",
    productSelector: ".product-shell",
    allowRenderedFallback: true,
    cookieConsentSelector: ".accept-all-cookies",
  }];
  installFetchMock(t, (url) => {
    if (url === openAiUrl) return aiReviewResponse({ verdict: "confirmed", confirmedUrl: canonicalUrl, retryUrls: [], issues: [] });
    if (url === storeUrl) {
      return htmlResponse(`<html><title>${productName}</title><body><article class="product-shell"><h1>${productName}</h1><p>EAN ${ean}</p><div>Loading price…</div></article></body></html>`);
    }
    return htmlResponse("Not found", 404);
  });

  const result = await searchPublicWebsite(storeUrl, productName, ean, profiles, undefined, {
    renderer: async (input) => {
      rendererCalls.push(input);
      return { url: canonicalUrl, html: productPage({ price: "109.90", url: canonicalUrl }) };
    },
  });

  assert.deepEqual(rendererCalls, [{ url: storeUrl, hostname: "shop.example", waitForSelector: ".product-shell", cookieConsentSelector: ".accept-all-cookies" }]);
  assert.equal(result.status, "found");
  assert.equal(result.matchedUrl, canonicalUrl);
  assert.equal(result.priceCents, 10990);
  assert.equal(result.evidence?.structuredExactEan, true);
});

test("passes explicit cookie consent instructions to the permitted renderer", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalEndpoint = process.env.SCRAPER_RENDERER_URL;
  const originalToken = process.env.SCRAPER_RENDERER_TOKEN;
  let requestBody: Record<string, unknown> | undefined;
  process.env.SCRAPER_RENDERER_URL = "https://renderer.example/render";
  process.env.SCRAPER_RENDERER_TOKEN = "test-token";
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ url: "https://shop.example/product", html: "<html></html>" }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalEndpoint == null) delete process.env.SCRAPER_RENDERER_URL;
    else process.env.SCRAPER_RENDERER_URL = originalEndpoint;
    if (originalToken == null) delete process.env.SCRAPER_RENDERER_TOKEN;
    else process.env.SCRAPER_RENDERER_TOKEN = originalToken;
  });

  const rendered = await renderWithPermittedService({ url: storeUrl, hostname: "shop.example", cookieConsentSelector: ".accept-all-cookies" });

  assert.equal(rendered?.url, "https://shop.example/product");
  assert.deepEqual(requestBody, {
    url: storeUrl,
    cookieConsentSelector: ".accept-all-cookies",
    cookieConsentAction: "accept_all",
  });
});

test("never invokes a permitted renderer after a detected challenge", async (t) => {
  let rendererCalls = 0;
  const profiles = [{
    id: "protected-store",
    label: "Protected store",
    hostname: "shop.example",
    htmlSignature: "",
    searchUrlTemplate: "/catalog?term={query}",
    productSelector: ".product-shell",
    blockPatterns: "challenge-guard",
    allowRenderedFallback: true,
  }];
  installFetchMock(t, (url) => {
    if (url === openAiUrl) return aiReviewResponse({ verdict: "not_found", confirmedUrl: null, retryUrls: [], issues: ["challenge"] });
    if (url === storeUrl) {
      return htmlResponse(`<html><title>${productName}</title><body><article class="product-shell"><h1>${productName}</h1><p>EAN ${ean}</p><div>Loading price…</div></article></body></html>`);
    }
    if (url.startsWith("https://shop.example/catalog")) return htmlResponse("<html><title>Access check</title><body>challenge-guard</body></html>");
    return htmlResponse("Not found", 404);
  });

  const result = await searchPublicWebsite(storeUrl, productName, ean, profiles, undefined, {
    renderer: async () => {
      rendererCalls += 1;
      return { url: "https://shop.example/products/mx-master-4", html: productPage({ price: "109.90", url: "/products/mx-master-4" }) };
    },
  });

  assert.equal(rendererCalls, 0);
  assert.equal(result.status, "blocked");
  assert.match(result.message, /access challenge/i);
});
