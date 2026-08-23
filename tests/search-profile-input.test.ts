import assert from "node:assert/strict";
import test from "node:test";
import { searchProfileIdentity, validateSearchProfileInput } from "../lib/search-profile-input.ts";

test("normalizes a store hostname and preserves editable profile fields", () => {
  const profile = validateSearchProfileInput({
    label: " Example Store ", hostname: "https://www.Store.Example/", htmlSignature: " data-shop ",
    searchUrlTemplate: "/search?q={query}", enabled: false,
  });
  assert.deepEqual(profile, {
    label: "Example Store", hostname: "store.example", htmlSignature: "data-shop",
    searchUrlTemplate: "/search?q={query}", enabled: false,
  });
});

test("allows HTML-only profiles only with a relative store-local URL", () => {
  assert.equal(validateSearchProfileInput({ label: "Shared shop", htmlSignature: "shop-platform", searchUrlTemplate: "/find/{query}" }).hostname, "");
  assert.throws(() => validateSearchProfileInput({ label: "Shared shop", htmlSignature: "shop-platform", searchUrlTemplate: "https://store.example/find?q={query}" }), /relative search URL/);
});

test("rejects unsafe or ambiguous search URL templates", () => {
  assert.throws(() => validateSearchProfileInput({ label: "Store", hostname: "store.example", searchUrlTemplate: "/search" }), /exactly one/);
  assert.throws(() => validateSearchProfileInput({ label: "Store", hostname: "store.example", searchUrlTemplate: "/{query}/search?q={query}" }), /exactly one/);
  assert.throws(() => validateSearchProfileInput({ label: "Store", hostname: "store.example", searchUrlTemplate: "https://evil.example/search?q={query}" }), /configured website/);
  assert.throws(() => validateSearchProfileInput({ label: "Store", hostname: "store.example", searchUrlTemplate: "https://{query}.store.example/search" }), /hostname/);
  assert.throws(() => validateSearchProfileInput({ label: "Store", hostname: "store.example", searchUrlTemplate: "/search#{query}" }), /fragment/);
});

test("rejects private hostnames and invalid enabled values", () => {
  assert.throws(() => validateSearchProfileInput({ label: "Local", hostname: "localhost", searchUrlTemplate: "/search?q={query}" }), /private network|Local/i);
  assert.throws(() => validateSearchProfileInput({ label: "Store", hostname: "store.example", searchUrlTemplate: "/search?q={query}", enabled: "yes" }), /true or false/);
});

test("builds a case-insensitive duplicate identity", () => {
  assert.equal(searchProfileIdentity({ hostname: "Store.Example", htmlSignature: "DATA-SHOP" }), searchProfileIdentity({ hostname: "store.example", htmlSignature: "data-shop" }));
});
