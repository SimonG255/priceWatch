import { and, eq, isNull, lte, ne, or, sql } from "drizzle-orm";
import { ensureProductsSchema, getDb } from "../../../../db";
import { monitoredProducts, scraperSchedules } from "../../../../db/schema";
import { getCurrentUserEmail } from "../../../../lib/current-user";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ownerEmail = await getCurrentUserEmail();
  if (!ownerEmail) return Response.json({ error: "Sign in to edit schedules." }, { status: 401 });
  try {
    await ensureProductsSchema();
    const { id } = await params;
    const input = await request.json() as Record<string, unknown>;
    const [existing] = await getDb().select().from(scraperSchedules).where(and(
      eq(scraperSchedules.id, id),
      eq(scraperSchedules.ownerEmail, ownerEmail),
    )).limit(1);
    if (!existing) return Response.json({ error: "Schedule not found." }, { status: 404 });
    const now = new Date();
    const nowIso = now.toISOString();
    if (existing.leaseUntil && existing.leaseUntil > nowIso) {
      return Response.json({ error: "This schedule is running. Try the edit again after the current product finishes." }, { status: 409 });
    }

    const cadenceMinutes = input.cadenceMinutes == null ? existing.cadenceMinutes : Math.round(Number(input.cadenceMinutes));
    if (!Number.isFinite(cadenceMinutes) || cadenceMinutes < 15 || cadenceMinutes > 43_200) throw new Error("Choose a cadence between 15 minutes and 30 days.");
    const enabled = typeof input.enabled === "boolean" ? input.enabled : existing.enabled;
    const targetMode = input.targetMode === "selected" || input.targetMode === "all" ? input.targetMode : existing.targetMode;
    const requestedIds = Array.isArray(input.productIds)
      ? [...new Set(input.productIds.filter((value): value is string => typeof value === "string"))].slice(0, 500)
      : parseProductIds(existing.productIdsJson);
    const productIds = targetMode === "all" ? [] : requestedIds;
    if (targetMode === "selected" && !productIds.length) throw new Error("Select at least one product.");
    if (targetMode === "selected") {
      const owned = await getDb().select({ id: monitoredProducts.id }).from(monitoredProducts).where(and(
        eq(monitoredProducts.ownerEmail, ownerEmail),
        selectedProductIds(productIds),
      ));
      if (owned.length !== productIds.length) throw new Error("One or more selected products are unavailable.");
    } else {
      const [duplicate] = await getDb().select({ id: scraperSchedules.id }).from(scraperSchedules).where(and(
        eq(scraperSchedules.ownerEmail, ownerEmail),
        eq(scraperSchedules.targetMode, "all"),
        ne(scraperSchedules.id, id),
      )).limit(1);
      if (duplicate) return Response.json({ error: "An all-products schedule already exists. Edit or resume it instead." }, { status: 409 });
    }

    const timeZone = validateTimeZone(typeof input.timeZone === "string" ? input.timeZone : existing.timeZone);
    const targetChanged = targetMode !== existing.targetMode
      || stableIds(productIds) !== stableIds(parseProductIds(existing.productIdsJson));
    const timingChanged = cadenceMinutes !== existing.cadenceMinutes || (!existing.enabled && enabled) || targetChanged;
    const [schedule] = await getDb().update(scraperSchedules).set({
      name: typeof input.name === "string" && input.name.trim() ? input.name.trim().slice(0, 100) : existing.name,
      targetMode,
      productIdsJson: JSON.stringify(productIds),
      cadenceMinutes,
      timeZone,
      enabled,
      nextRunAt: timingChanged ? new Date(now.getTime() + cadenceMinutes * 60_000).toISOString() : existing.nextRunAt,
      ...(targetChanged ? { cursorIndex: 0, pendingOutcomeJson: "{}", pendingStartedAt: null } : {}),
      revision: existing.revision + 1,
      updatedAt: nowIso,
    }).where(and(
      eq(scraperSchedules.id, id),
      eq(scraperSchedules.ownerEmail, ownerEmail),
      eq(scraperSchedules.revision, existing.revision),
      or(isNull(scraperSchedules.leaseUntil), lte(scraperSchedules.leaseUntil, nowIso)),
    )).returning();
    if (!schedule) return Response.json({ error: "The schedule changed while you were editing it. Reload and try again." }, { status: 409 });
    return Response.json({ schedule: publicSchedule(schedule, productIds) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Schedule could not be updated." }, { status: 400 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ownerEmail = await getCurrentUserEmail();
  if (!ownerEmail) return Response.json({ error: "Sign in to remove schedules." }, { status: 401 });
  await ensureProductsSchema();
  const { id } = await params;
  const now = new Date().toISOString();
  const [deleted] = await getDb().delete(scraperSchedules).where(and(
    eq(scraperSchedules.id, id),
    eq(scraperSchedules.ownerEmail, ownerEmail),
    or(isNull(scraperSchedules.leaseUntil), lte(scraperSchedules.leaseUntil, now)),
  )).returning({ id: scraperSchedules.id });
  if (deleted) return Response.json({ ok: true });
  const [existing] = await getDb().select({ leaseUntil: scraperSchedules.leaseUntil }).from(scraperSchedules).where(and(
    eq(scraperSchedules.id, id),
    eq(scraperSchedules.ownerEmail, ownerEmail),
  )).limit(1);
  if (existing) return Response.json({ error: "This schedule is running. Remove it after the current product finishes." }, { status: 409 });
  return Response.json({ error: "Schedule not found." }, { status: 404 });
}

function parseProductIds(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string").slice(0, 500) : [];
  } catch { return []; }
}

function selectedProductIds(ids: string[]) {
  return sql`${monitoredProducts.id} IN (SELECT CAST(value AS TEXT) FROM json_each(${JSON.stringify(ids)}))`;
}

function stableIds(ids: string[]) { return JSON.stringify([...ids].sort()); }

function validateTimeZone(value: string) {
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return value; } catch { return "UTC"; }
}

function publicSchedule(schedule: typeof scraperSchedules.$inferSelect, productIds: string[]) {
  const publicFields: Partial<typeof schedule> = { ...schedule };
  delete publicFields.productIdsJson;
  delete publicFields.leaseToken;
  delete publicFields.pendingOutcomeJson;
  return { ...publicFields, productIds };
}
