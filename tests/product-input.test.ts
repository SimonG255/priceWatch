import assert from "node:assert/strict";
import test from "node:test";
import { assertPublicHostname, isValidGtin, validateProductMonitoringSettings, validateWebsiteUrl } from "../lib/product-input.ts";

test("accepts valid public hostnames and GTIN check digits", () => {
  assert.doesNotThrow(() => assertPublicHostname("shop.example.com"));
  assert.equal(isValidGtin("8806095539737"), true);
  assert.equal(validateWebsiteUrl("https://shop.example.com/product#details"), "https://shop.example.com/product");
});

test("rejects empty, private, reserved, and IPv4-mapped IPv6 targets", () => {
  for (const hostname of ["", "127.0.0.1", "169.254.1.2", "198.18.0.1", "fe90::1", "::ffff:7f00:1", "2001:db8::1"]) {
    assert.throws(() => assertPublicHostname(hostname), /valid public|private|reserved/i, hostname);
  }
});

test("rejects an invalid GTIN check digit", () => {
  assert.equal(isValidGtin("8806095539736"), false);
});

test("validates price alert thresholds and monitoring state", () => {
  assert.deepEqual(validateProductMonitoringSettings({
    monitoringEnabled: false,
    alertOnPriceDrop: true,
    alertOnRestock: false,
    alertTargetPriceCents: 9999,
    alertDropPercentBps: 1250,
  }), {
    monitoringEnabled: false,
    alertOnPriceDrop: true,
    alertOnRestock: false,
    alertTargetPriceCents: 9999,
    alertDropPercentBps: 1250,
  });
  assert.throws(() => validateProductMonitoringSettings({ alertDropPercentBps: 0 }), /between/);
  assert.throws(() => validateProductMonitoringSettings({ alertTargetPriceCents: -1 }), /valid non-negative/);
});
