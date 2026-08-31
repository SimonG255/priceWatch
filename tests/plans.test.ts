import assert from "node:assert/strict";
import test from "node:test";
import { normalizePlanSelection } from "../lib/plan-catalog.ts";

test("uses the published fixed plan URL limits", () => {
  assert.deepEqual(normalizePlanSelection({ plan: "starter" }), { key: "starter", urlLimit: 50, checksPerDay: 1 });
  assert.deepEqual(normalizePlanSelection({ plan: "business" }), { key: "business", urlLimit: 350, checksPerDay: 4 });
  assert.deepEqual(normalizePlanSelection({ plan: "pro" }), { key: "pro", urlLimit: 1_000, checksPerDay: 24 });
});

test("does not allow self-service custom or enterprise limits", () => {
  assert.equal(normalizePlanSelection({ plan: "custom", urls: "5000", checks: "24" }), null);
  assert.equal(normalizePlanSelection({ plan: "enterprise", urls: "5000" }), null);
});
