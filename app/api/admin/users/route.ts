import { count, eq } from "drizzle-orm";
import { ensureProductsSchema, getDb } from "../../../../db";
import { monitoredProducts, monitoredWebsites, userPlans } from "../../../../db/schema";
import { getSuperAdminEmail } from "../../../../lib/admin-auth";

const PLAN_KEYS = new Set(["starter", "business", "pro", "custom"]);
const STATUSES = new Set(["trial", "active", "past_due", "expired", "cancelled"]);

export async function GET() {
  if (!await getSuperAdminEmail()) return Response.json({ error: "Super administrator access required." }, { status: 403 });
  await ensureProductsSchema();
  const db = getDb();
  const [plans, productCounts, websiteCounts] = await Promise.all([
    db.select().from(userPlans).orderBy(userPlans.ownerEmail),
    db.select({ ownerEmail: monitoredProducts.ownerEmail, value: count() }).from(monitoredProducts).groupBy(monitoredProducts.ownerEmail),
    db.select({ ownerEmail: monitoredWebsites.ownerEmail, value: count() }).from(monitoredWebsites).groupBy(monitoredWebsites.ownerEmail),
  ]);
  const products = new Map(productCounts.map(row => [row.ownerEmail, row.value]));
  const websites = new Map(websiteCounts.map(row => [row.ownerEmail, row.value]));
  return Response.json({
    users: plans.map(plan => ({
      ...plan,
      productCount: products.get(plan.ownerEmail) ?? 0,
      websiteCount: websites.get(plan.ownerEmail) ?? 0,
    })),
  });
}

export async function PATCH(request: Request) {
  const superAdminEmail = await getSuperAdminEmail();
  if (!superAdminEmail) return Response.json({ error: "Super administrator access required." }, { status: 403 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const ownerEmail = typeof body?.ownerEmail === "string" ? body.ownerEmail.trim().toLowerCase() : "";
  const planKey = typeof body?.planKey === "string" ? body.planKey : "";
  const subscriptionStatus = typeof body?.subscriptionStatus === "string" ? body.subscriptionStatus : "";
  const urlLimit = Number(body?.urlLimit);
  const checksPerDay = Number(body?.checksPerDay);
  if (!ownerEmail || !ownerEmail.includes("@")) return Response.json({ error: "A valid user email is required." }, { status: 400 });
  if (!PLAN_KEYS.has(planKey)) return Response.json({ error: "Select a valid plan." }, { status: 400 });
  if (!STATUSES.has(subscriptionStatus)) return Response.json({ error: "Select a valid subscription status." }, { status: 400 });
  if (!Number.isInteger(urlLimit) || urlLimit < 1 || urlLimit > 5_000) return Response.json({ error: "URL limit must be between 1 and 5,000." }, { status: 400 });
  if (!Number.isInteger(checksPerDay) || checksPerDay < 1 || checksPerDay > 24) return Response.json({ error: "Checks per day must be between 1 and 24." }, { status: 400 });
  const subscriptionExpiresAt = parseOptionalDate(body?.subscriptionExpiresAt);
  const trialEndsAt = parseOptionalDate(body?.trialEndsAt);
  if (subscriptionExpiresAt === undefined || trialEndsAt === undefined) return Response.json({ error: "Enter valid subscription dates." }, { status: 400 });
  await ensureProductsSchema();
  const [updated] = await getDb().update(userPlans).set({
    planKey,
    urlLimit,
    checksPerDay,
    subscriptionStatus,
    trialEndsAt: trialEndsAt ?? new Date().toISOString(),
    subscriptionExpiresAt,
    updatedAt: new Date().toISOString(),
  }).where(eq(userPlans.ownerEmail, ownerEmail)).returning();
  if (!updated) return Response.json({ error: "User plan was not found." }, { status: 404 });
  return Response.json({ user: updated, updatedBy: superAdminEmail });
}

function parseOptionalDate(value: unknown): string | null | undefined {
  if (value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}
