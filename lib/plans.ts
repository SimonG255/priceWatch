import { and, count, eq } from "drizzle-orm";
import { getDb } from "../db";
import { monitoredProducts, scraperSchedules, userPlans } from "../db/schema";
import { FIXED_PLANS, normalizePlanSelection, type UserPlan } from "./plan-catalog";
import { APP_TIME_ZONE } from "./time-zone";

export { normalizePlanSelection };
export type { UserPlan };

export async function getOrCreateUserPlan(ownerEmail: string, selected?: UserPlan | null): Promise<UserPlan> {
  const db = getDb();
  const now = new Date().toISOString();
  const [existing] = await db
    .select({
      planKey: userPlans.planKey,
      urlLimit: userPlans.urlLimit,
      checksPerDay: userPlans.checksPerDay,
    })
    .from(userPlans)
    .where(eq(userPlans.ownerEmail, ownerEmail))
    .limit(1);
  const requested = selected ?? currentPlanFor(existing);
  const [row] = await db
    .insert(userPlans)
    .values({
      ownerEmail,
      planKey: requested.key,
      urlLimit: requested.urlLimit,
      checksPerDay: requested.checksPerDay,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: userPlans.ownerEmail,
      set: {
        planKey: requested.key,
        urlLimit: requested.urlLimit,
        checksPerDay: requested.checksPerDay,
        updatedAt: now,
      },
    })
    .returning();
  return {
    key: isPlanKey(row.planKey) ? row.planKey : "business",
    urlLimit: clamp(row.urlLimit, 1, 5_000),
    checksPerDay: clamp(row.checksPerDay, 1, 24),
  };
}

function currentPlanFor(existing?: { planKey: string; urlLimit: number; checksPerDay: number }): UserPlan {
  if (existing?.planKey === "custom") {
    return {
      key: "custom",
      urlLimit: clamp(existing.urlLimit, 25, 5_000),
      checksPerDay: clamp(existing.checksPerDay, 1, 24),
    };
  }
  if (existing?.planKey === "starter" || existing?.planKey === "business" || existing?.planKey === "pro") {
    return { key: existing.planKey, ...FIXED_PLANS[existing.planKey] };
  }
  return { key: "business", ...FIXED_PLANS.business };
}

export async function assertProductCapacity(ownerEmail: string, additionalProducts: number) {
  const plan = await getOrCreateUserPlan(ownerEmail);
  const [{ used }] = await getDb()
    .select({ used: count() })
    .from(monitoredProducts)
    .where(eq(monitoredProducts.ownerEmail, ownerEmail));
  if (used + additionalProducts > plan.urlLimit) {
    throw new Error(`Your ${plan.key} plan supports ${plan.urlLimit.toLocaleString()} monitored searches. Remove a product or change your plan before adding more.`);
  }
  return plan;
}

export function minimumCadenceMinutes(plan: UserPlan) {
  return Math.ceil(1_440 / plan.checksPerDay);
}

export async function ensureDefaultSchedule(ownerEmail: string, plan: UserPlan) {
  const db = getDb();
  const [existing] = await db.select({ id: scraperSchedules.id }).from(scraperSchedules).where(and(
    eq(scraperSchedules.ownerEmail, ownerEmail),
    eq(scraperSchedules.targetMode, "all"),
  )).limit(1);
  if (existing) return;
  const now = new Date();
  const cadenceMinutes = minimumCadenceMinutes(plan);
  await db.insert(scraperSchedules).values({
    id: crypto.randomUUID(),
    ownerEmail,
    name: "All product monitoring",
    targetMode: "all",
    productIdsJson: "[]",
    cadenceMinutes,
    timeZone: APP_TIME_ZONE,
    enabled: true,
    nextRunAt: new Date(now.getTime() + cadenceMinutes * 60_000).toISOString(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });
}

function isPlanKey(value: string): value is UserPlan["key"] {
  return value === "starter" || value === "business" || value === "pro" || value === "custom";
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
