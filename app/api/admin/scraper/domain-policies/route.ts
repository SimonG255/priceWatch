import { asc } from "drizzle-orm";
import { ensureProductsSchema, getDb } from "../../../../../db";
import { scraperDomainPolicies } from "../../../../../db/schema";
import { getAdminEmail } from "../../../../../lib/admin-auth";
import { assertPublicHostname } from "../../../../../lib/product-input";

export async function GET() {
  if (!await getAdminEmail()) return Response.json({ error: "Administrator access required." }, { status: 403 });
  await ensureProductsSchema();
  const policies = await getDb().select().from(scraperDomainPolicies).orderBy(asc(scraperDomainPolicies.hostname)).limit(500);
  return Response.json({ policies }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const adminEmail = await getAdminEmail();
  if (!adminEmail) return Response.json({ error: "Administrator access required." }, { status: 403 });
  try {
    await ensureProductsSchema();
    const body = await request.json() as Record<string, unknown>;
    const hostname = String(body.hostname || "").trim().toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    assertPublicHostname(hostname);
    const accessMode = body.accessMode === "block" ? "block" : "allow";
    const siteType = ["auto", "standard", "slow", "large", "javascript", "marketplace"].includes(String(body.siteType)) ? String(body.siteType) : "auto";
    const timeoutMs = optionalInt(body.timeoutMs, 3_000, 30_000, "Timeout");
    const maxPageBytes = optionalInt(body.maxPageBytes, 256_000, 8_000_000, "Page size budget");
    const retryBudget = optionalInt(body.retryBudget, 0, 4, "Retry budget");
    const requestIntervalMs = optionalInt(body.requestIntervalMs, 500, 60_000, "Request interval");
    const now = new Date().toISOString();
    const values = {
      hostname, accessMode, robotsMode: "respect", siteType,
      timeoutMs, maxPageBytes, retryBudget, requestIntervalMs,
      blockReason: typeof body.blockReason === "string" ? body.blockReason.trim().slice(0, 300) || null : null,
      notes: typeof body.notes === "string" ? body.notes.trim().slice(0, 1_000) || null : null,
      updatedBy: adminEmail, updatedAt: now,
    };
    const [policy] = await getDb().insert(scraperDomainPolicies).values({ ...values, createdAt: now }).onConflictDoUpdate({
      target: scraperDomainPolicies.hostname,
      set: values,
    }).returning();
    return Response.json({ policy });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Domain policy could not be saved." }, { status: 400 });
  }
}

function optionalInt(value: unknown, minimum: number, maximum: number, label: string) {
  if (value == null || value === "") return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) throw new Error(`${label} must be from ${minimum} to ${maximum}.`);
  return number;
}
