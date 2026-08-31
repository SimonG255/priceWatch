export type UserPlan = {
  key: "starter" | "business" | "pro" | "custom";
  urlLimit: number;
  checksPerDay: number;
};

export const FIXED_PLANS: Record<Exclude<UserPlan["key"], "custom">, Omit<UserPlan, "key">> = {
  starter: { urlLimit: 50, checksPerDay: 1 },
  business: { urlLimit: 350, checksPerDay: 4 },
  pro: { urlLimit: 1_000, checksPerDay: 24 },
};

export function normalizePlanSelection(value: { plan?: string; urls?: string; checks?: string }): UserPlan | null {
  if (value.plan === "starter" || value.plan === "business" || value.plan === "pro") {
    return { key: value.plan, ...FIXED_PLANS[value.plan] };
  }
  return null;
}
