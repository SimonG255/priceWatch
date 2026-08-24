import assert from "node:assert/strict";
import test from "node:test";
import { buildSearchCandidates, sameStoreHostname } from "../lib/site-search-profiles.ts";

test("uses the website's published GET search form and keeps fixed fields", () => {
  const html = `
    <form class="header-search" action="/catalog" method="get">
      <input type="hidden" name="controller" value="search">
      <input type="search" name="search_query" placeholder="Search products">
    </form>`;
  const candidates = buildSearchCandidates(new URL("https://shop.example/"), ["5099206123456"], html);
  assert.equal(candidates[0].profileId, "form-1");
  assert.equal(candidates[0].url, "https://shop.example/catalog?controller=search&search_query=5099206123456");
});

test("detects common commerce platforms from public HTML", () => {
  const candidates = buildSearchCandidates(
    new URL("https://shop.example/"),
    ["MX Master 4"],
    '<script src="https://cdn.shopify.com/shop.js"></script>',
  );
  assert.equal(candidates[0].profileId, "shopify");
  assert.equal(candidates[0].url, "https://shop.example/search?type=product&q=MX%20Master%204");
});

test("uses a known domain-specific search URL", () => {
  const candidates = buildSearchCandidates(new URL("https://www.amazon.de/"), ["5099206123456"]);
  assert.equal(candidates[0].profileId, "amazon");
  assert.equal(candidates[0].url, "https://www.amazon.de/s?k=5099206123456");
});

test("prioritizes a known domain profile over a published search form", () => {
  const html = '<form action="/find"><input type="search" name="q"></form>';
  const candidates = buildSearchCandidates(new URL("https://www.amazon.de/"), ["5099206123456"], html);
  assert.equal(candidates[0].profileId, "amazon");
  assert.equal(candidates[1].profileId, "form-1");
});

test("uses an admin-defined HTML signature and search URL before a discovered form", () => {
  const html = '<meta name="platform" content="AcmeShop"><form action="/find"><input type="search" name="q"></form>';
  const candidates = buildSearchCandidates(new URL("https://store.example/"), ["12345678"], html, [{
    id: "acme", label: "Acme search", hostname: "", htmlSignature: 'content="AcmeShop"', searchUrlTemplate: "/catalog?term={query}",
  }]);
  assert.equal(candidates[0].profileId, "custom-acme");
  assert.equal(candidates[0].url, "https://store.example/catalog?term=12345678");
  assert.equal(candidates[1].profileId, "form-1");
});

test("requires every configured custom-profile match condition", () => {
  const profile = [{
    id: "specific-platform", label: "Specific platform", hostname: "store.example",
    htmlSignature: "data-specific-shop", searchUrlTemplate: "/catalog?q={query}",
  }];
  assert.equal(buildSearchCandidates(new URL("https://other.example/"), ["12345678"], "data-specific-shop", profile)[0].profileId, "generic");
  assert.equal(buildSearchCandidates(new URL("https://store.example/"), ["12345678"], "no platform marker", profile)[0].profileId, "generic");
  assert.equal(buildSearchCandidates(new URL("https://store.example/"), ["12345678"], "data-specific-shop", profile)[0].profileId, "custom-specific-platform");
});

test("provides common query-name fallbacks for an unknown website", () => {
  const candidates = buildSearchCandidates(new URL("https://store.example/"), ["12345678"]);
  assert.deepEqual(
    candidates.map((candidate) => new URL(candidate.url).searchParams.keys().next().value),
    ["q", "query", "search", "s"],
  );
});

test("ignores search forms that submit to another website", () => {
  const html = '<form action="https://evil.example/search"><input type="search" name="q"></form>';
  const candidates = buildSearchCandidates(new URL("https://shop.example/"), ["12345678"], html);
  assert.equal(candidates.some((candidate) => candidate.profileId.startsWith("form-")), false);
});

test("allows safe www, apex, and same-site subdomain redirects", () => {
  assert.equal(sameStoreHostname("shop.example", "www.shop.example"), true);
  assert.equal(sameStoreHostname("www.shop.example", "shop.example"), true);
  assert.equal(sameStoreHostname("catalog.shop.example", "shop.example"), true);
  assert.equal(sameStoreHostname("shop.evil.example", "shop.example"), false);
});
