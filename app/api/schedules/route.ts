import { and, desc, eq, inArray } from "drizzle-orm";
import { ensureProductsSchema, getDb } from "../../../db";
import { monitoredProducts, scraperSchedules } from "../../../db/schema";
import { getCurrentUserEmail } from "../../../lib/current-user";
import { getOrCreateUserPlan, minimumCadenceMinutes } from "../../../lib/plans";
import { APP_TIME_ZONE } from "../../../lib/time-zone";

export async function GET() {
  const ownerEmail = await getCurrentUserEmail();
  if (!ownerEmail) return Response.json({ error: "Sign in to view schedules." }, { status: 401 });
  await ensureProductsSchema();
  const schedules = await getDb().select().from(scraperSchedules).where(eq(scraperSchedules.ownerEmail, ownerEmail)).orderBy(desc(scraperSchedules.createdAt));
  return Response.json({ schedules: schedules.map(publicSchedule) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const ownerEmail = await getCurrentUserEmail();
  if (!ownerEmail) return Response.json({ error: "Sign in to create schedules." }, { status: 401 });
  try {
    await ensureProductsSchema();
    const input = await request.json() as Record<string, unknown>;
    const cadenceMinutes = Math.round(Number(input.cadenceMinutes));
    if (!Number.isFinite(cadenceMinutes) || cadenceMinutes < 15 || cadenceMinutes > 43_200) throw new Error("Choose a cadence between 15 minutes and 30 days.");
    const plan = await getOrCreateUserPlan(ownerEmail);
    const minimumCadence = minimumCadenceMinutes(plan);
    if (cadenceMinutes < minimumCadence) throw new Error(`Your ${plan.key} plan supports up to ${plan.checksPerDay} checks per day. Choose ${minimumCadence} minutes or longer.`);
    const targetMode = input.targetMode === "selected" ? "selected" : "all";
    const productIds = Array.isArray(input.productIds) ? [...new Set(input.productIds.filter((value): value is string => typeof value === "string"))].slice(0, 500) : [];
    if (targetMode === "selected") {
      if (!productIds.length) throw new Error("Select at least one product for this schedule.");
      const owned = await getDb().select({ id: monitoredProducts.id }).from(monitoredProducts).where(and(
        eq(monitoredProducts.ownerEmail, ownerEmail),
        selectedProductIds(productIds),
      ));
      if (owned.length !== productIds.length) throw new Error("One or more selected products are unavailable.");
    }
    const timeZone = validateTimeZone(typeof input.timeZone === "string" ? input.timeZone : APP_TIME_ZONE);
    if (targetMode === "all") {
      const [duplicate] = await getDb().select({ id: scraperSchedules.id }).from(scraperSchedules).where(and(
        eq(scraperSchedules.ownerEmail, ownerEmail),
        eq(scraperSchedules.targetMode, "all"),
      )).limit(1);
      if (duplicate) return Response.json({ error: "An all-products schedule already exists. Edit or resume it instead." }, { status: 409 });
    }
    const now = new Date();
    const [schedule] = await getDb().insert(scraperSchedules).values({
      id: crypto.randomUUID(), ownerEmail,
      name: cleanName(input.name) || "Scheduled price checks",
      targetMode, productIdsJson: JSON.stringify(productIds), cadenceMinutes, timeZone,
      enabled: input.enabled !== false,
      nextRunAt: new Date(now.getTime() + cadenceMinutes * 60_000).toISOString(),
      createdAt: now.toISOString(), updatedAt: now.toISOString(),
    }).returning();
    return Response.json({ schedule: publicSchedule(schedule) }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Schedule could not be created." }, { status: 400 });
  }
}

function publicSchedule(schedule: typeof scraperSchedules.$inferSelect) {
  let productIds: string[] = [];
  try { productIds = JSON.parse(schedule.productIdsJson) as string[]; } catch { /* empty */ }
  const publicFields: Partial<typeof schedule> = { ...schedule };
  delete publicFields.productIdsJson;
  delete publicFields.leaseToken;
  delete publicFields.pendingOutcomeJson;
  return { ...publicFields, productIds };
}

function cleanName(value: unknown) { return typeof value === "string" ? value.trim().slice(0, 100) : ""; }

function selectedProductIds(ids: string[]) {
  return inArray(monitoredProducts.id, ids);
}

function validateTimeZone(value: string) {
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return value; } catch { return APP_TIME_ZONE; }
}
