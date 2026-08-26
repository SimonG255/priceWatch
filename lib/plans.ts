import { and, count, eq } from "drizzle-orm";
import { getDb } from "../db";
import { monitoredProducts, scraperSchedules, userPlans } from "../db/schema";
import { APP_TIME_ZONE } from "./time-zone";

export type UserPlan = {
  key: "starter" | "business" | "pro" | "custom";
  urlLimit: number;
  checksPerDay: number;
};

const FIXED_PLANS: Record<Exclude<UserPlan["key"], "custom">, Omit<UserPlan, "key">> = {
  starter: { urlLimit: 25, checksPerDay: 1 },
  business: { urlLimit: 150, checksPerDay: 4 },
  pro: { urlLimit: 1_000, checksPerDay: 24 },
};

export function normalizePlanSelection(value: { plan?: string; urls?: string; checks?: string }): UserPlan | null {
  if (value.plan === "custom") {
    return {
      key: "custom",
      urlLimit: clamp(Math.round(Number(value.urls) || 250), 10, 5_000),
      checksPerDay: [1, 4, 12, 24].includes(Number(value.checks)) ? Number(value.checks) : 4,
    };
  }
  if (value.plan === "starter" || value.plan === "business" || value.plan === "pro") {
    return { key: value.plan, ...FIXED_PLANS[value.plan] };
  }
  return null;
}

export async function getOrCreateUserPlan(ownerEmail: string, selected?: UserPlan | null): Promise<UserPlan> {
  const db = getDb();
  const now = new Date().toISOString();
  const requested = selected ?? { key: "business" as const, ...FIXED_PLANS.business };
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
      set: selected
        ? { planKey: requested.key, urlLimit: requested.urlLimit, checksPerDay: requested.checksPerDay, updatedAt: now }
        : { updatedAt: now },
    })
    .returning();
  return {
    key: isPlanKey(row.planKey) ? row.planKey : "business",
    urlLimit: clamp(row.urlLimit, 1, 5_000),
    checksPerDay: clamp(row.checksPerDay, 1, 24),
  };
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
