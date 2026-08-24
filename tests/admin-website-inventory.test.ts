import assert from "node:assert/strict";
import test from "node:test";
import { listAdminWebsiteInventory } from "../lib/admin-website-inventory.ts";

test("lists every used website as a safe, normalized hostname", () => {
  const websites = listAdminWebsiteInventory([
    { url: "https://www.Store.Example/products/widget?customer=private" },
    { url: "https://store.example/another-product" },
    { url: "https://shop.example/" },
    { url: "not a URL" },
  ]);

  assert.deepEqual(websites, [
    { hostname: "shop.example" },
    { hostname: "store.example" },
  ]);
});

test("omits unsupported, credentialed, and private website URLs", () => {
  const websites = listAdminWebsiteInventory([
    { url: "ftp://store.example/product" },
    { url: "https://person:secret@store.example/product" },
    { url: "https://localhost/product" },
    { url: "https://valid.example/product" },
  ]);

  assert.deepEqual(websites, [{ hostname: "valid.example" }]);
});
