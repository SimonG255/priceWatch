import assert from "node:assert/strict";
import test from "node:test";
import {
  contentFingerprint,
  detectAccessChallenge,
  exponentialBackoffMs,
  fairDomainOrder,
  failureClassFor,
  matchKnownBadPattern,
  parseRobotsRules,
  robotsAllows,
  scraperBudgetFor,
  suggestSelectors,
} from "../lib/scraper-diagnostics.ts";

test("classifies challenge walls without blocking ordinary CAPTCHA widgets", () => {
  assert.equal(detectAccessChallenge('<html><script src="https://www.google.com/recaptcha/api.js"></script><h1>Product</h1><p>In stock</p></html>'), undefined);
  assert.equal(detectAccessChallenge("<title>Verify</title><div class='g-recaptcha'></div><p>Complete the captcha to continue</p>")?.challengeType, "captcha");
  assert.equal(detectAccessChallenge("", [], { status: 403, server: "cloudflare", cfRay: "abc" })?.challengeType, "cloudflare");
  const login = detectAccessChallenge("<title>Sign in</title><p>Sign in to continue</p>");
  assert.equal(login?.challengeType, "login_wall");
  assert.equal(login?.failureClass, "permanent");
  assert.equal(failureClassFor("login_wall"), "permanent");
});

test("uses adaptive bounded budgets and exponential reason backoff", () => {
  assert.equal(scraperBudgetFor("shop.example", { siteType: "large" }).maxPageBytes, 5 * 1024 * 1024);
  assert.equal(scraperBudgetFor("shop.example", { timeoutMs: 100_000 }).timeoutMs, 30_000);
  assert.equal(exponentialBackoffMs({ consecutiveFailures: 1, reasonCode: "timeout" }), 30_000);
  assert.equal(exponentialBackoffMs({ consecutiveFailures: 3, reasonCode: "timeout" }), 120_000);
  assert.equal(exponentialBackoffMs({ consecutiveFailures: 1, reasonCode: "rate_limited", retryAfterMs: 300_000 }), 300_000);
});

test("known-bad rules are isolated by hostname and support bounded wildcards", () => {
  const rules = [{ id: "one", hostname: "shop.example", urlPattern: "*/bad-listing/*", reason: "Wrong shipping price" }];
  assert.equal(matchKnownBadPattern("https://shop.example/bad-listing/12", undefined, rules)?.id, "one");
  assert.equal(matchKnownBadPattern("https://other.example/bad-listing/12", undefined, rules), undefined);
});

test("robots rules use the most specific agent and longest path", () => {
  const rules = parseRobotsRules(`
    User-agent: *
    Disallow: /public
    User-agent: Price
    Disallow: /catalog
    User-agent: PriceWatch
    Disallow: /catalog
    Allow: /catalog/products
  `);
  assert.equal(robotsAllows(new URL("https://shop.example/public"), rules), true);
  assert.equal(robotsAllows(new URL("https://shop.example/catalog"), rules), false);
  assert.equal(robotsAllows(new URL("https://shop.example/catalog/products/1"), rules), true);
});

test("fair ordering rotates domains and selector suggestions remain safe", () => {
  const ordered = fairDomainOrder([
    { id: 1, host: "a.example" }, { id: 2, host: "a.example" },
    { id: 3, host: "b.example" }, { id: 4, host: "c.example" },
  ], (item) => item.host);
  assert.deepEqual(ordered.map((item) => item.id), [1, 3, 4, 2]);
  assert.deepEqual(suggestSelectors('<span data-testid="price current">10</span><div class="product-price">20</div>'), [".product-price"]);
  assert.equal(contentFingerprint("same"), contentFingerprint("same"));
  assert.notEqual(contentFingerprint("same"), contentFingerprint("changed"));
});
