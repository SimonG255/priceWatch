import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "../app/api/contact/route.ts";

function contactRequest(body: Record<string, unknown>) {
  return new Request("https://nexus.example/api/contact", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://nexus.example", "x-forwarded-for": crypto.randomUUID() },
    body: JSON.stringify(body),
  });
}

const validContact = {
  name: "Alex Example",
  email: "alex@example.com",
  company: "Example Commerce",
  urlCount: 2500,
  message: "We need daily monitoring across several European markets.",
};

test("requires contact delivery configuration", async () => {
  const previousWebhook = process.env.CONTACT_EMAIL_WEBHOOK_URL;
  const previousFallback = process.env.ALERT_EMAIL_WEBHOOK_URL;
  const previousEmail = process.env.CONTACT_EMAIL;
  delete process.env.CONTACT_EMAIL_WEBHOOK_URL;
  delete process.env.ALERT_EMAIL_WEBHOOK_URL;
  delete process.env.CONTACT_EMAIL;
  try {
    const response = await POST(contactRequest(validContact));
    assert.equal(response.status, 503);
  } finally {
    if (previousWebhook === undefined) delete process.env.CONTACT_EMAIL_WEBHOOK_URL; else process.env.CONTACT_EMAIL_WEBHOOK_URL = previousWebhook;
    if (previousFallback === undefined) delete process.env.ALERT_EMAIL_WEBHOOK_URL; else process.env.ALERT_EMAIL_WEBHOOK_URL = previousFallback;
    if (previousEmail === undefined) delete process.env.CONTACT_EMAIL; else process.env.CONTACT_EMAIL = previousEmail;
  }
});

test("delivers a validated enterprise enquiry", async () => {
  const previousWebhook = process.env.CONTACT_EMAIL_WEBHOOK_URL;
  const previousEmail = process.env.CONTACT_EMAIL;
  const previousFetch = globalThis.fetch;
  process.env.CONTACT_EMAIL_WEBHOOK_URL = "https://hooks.example/contact";
  process.env.CONTACT_EMAIL = "sales@example.com";
  let delivered: Record<string, unknown> | undefined;
  globalThis.fetch = async (_input, init) => {
    delivered = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(null, { status: 204 });
  };
  try {
    const response = await POST(contactRequest(validContact));
    assert.equal(response.status, 200);
    assert.equal(delivered?.to, "sales@example.com");
    assert.equal(delivered?.replyTo, "alex@example.com");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWebhook === undefined) delete process.env.CONTACT_EMAIL_WEBHOOK_URL; else process.env.CONTACT_EMAIL_WEBHOOK_URL = previousWebhook;
    if (previousEmail === undefined) delete process.env.CONTACT_EMAIL; else process.env.CONTACT_EMAIL = previousEmail;
  }
});
