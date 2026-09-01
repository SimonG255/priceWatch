import assert from "node:assert/strict";
import test from "node:test";
import { authorizeCronRequest } from "../lib/cron-auth.ts";

test("scheduled scraper route fails closed when CRON_SECRET is missing", async (t) => {
  const previous = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;
  t.after(() => {
    if (previous == null) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  });

  const result = authorizeCronRequest(new Request("https://nexus.example/api/cron/scraper"));
  assert.equal(result.authorized, false);
  assert.equal(result.status, 503);
});

test("scheduled scraper route rejects an invalid bearer token before touching the queue", async (t) => {
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "test-cron-secret-123456789";
  t.after(() => {
    if (previous == null) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  });

  const result = authorizeCronRequest(new Request("https://nexus.example/api/cron/scraper", {
    headers: { Authorization: "Bearer wrong-secret" },
  }));
  assert.equal(result.authorized, false);
  assert.equal(result.status, 401);
});

test("scheduled scraper authorization accepts the configured bearer token", () => {
  const secret = "test-cron-secret-123456789";
  const result = authorizeCronRequest(new Request("https://nexus.example/api/cron/scraper", {
    headers: { Authorization: `Bearer ${secret}` },
  }), secret);
  assert.equal(result.authorized, true);
});
