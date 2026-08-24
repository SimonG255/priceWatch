import { and, eq, inArray } from "drizzle-orm";
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
    const [existing] = await getDb().select().from(scraperSchedules).where(and(eq(scraperSchedules.id, id), eq(scraperSchedules.ownerEmail, ownerEmail))).limit(1);
    if (!existing) return Response.json({ error: "Schedule not found." }, { status: 404 });
    const cadenceMinutes = input.cadenceMinutes == null ? existing.cadenceMinutes : Math.round(Number(input.cadenceMinutes));
    if (!Number.isFinite(cadenceMinutes) || cadenceMinutes < 15 || cadenceMinutes > 43_200) throw new Error("Choose a cadence between 15 minutes and 30 days.");
    const enabled = typeof input.enabled === "boolean" ? input.enabled : existing.enabled;
    const productIds = Array.isArray(input.productIds) ? [...new Set(input.productIds.filter((value): value is string => typeof value === "string"))].slice(0, 500) : parseProductIds(existing.productIdsJson);
    const targetMode = input.targetMode === "selected" || input.targetMode === "all" ? input.targetMode : existing.targetMode;
    if (targetMode === "selected" && !productIds.length) throw new Error("Select at least one product.");
    if (targetMode === "selected") {
      const owned = await getDb().select({ id: monitoredProducts.id }).from(monitoredProducts).where(and(
        eq(monitoredProducts.ownerEmail, ownerEmail),
        inArray(monitoredProducts.id, productIds),
      ));
      if (owned.length !== productIds.length) throw new Error("One or more selected products are unavailable.");
    }
    const now = new Date();
    const [schedule] = await getDb().update(scraperSchedules).set({
      name: typeof input.name === "string" && input.name.trim() ? input.name.trim().slice(0, 100) : existing.name,
      targetMode, productIdsJson: JSON.stringify(productIds), cadenceMinutes, enabled,
      nextRunAt: cadenceMinutes !== existing.cadenceMinutes || (!existing.enabled && enabled)
        ? new Date(now.getTime() + cadenceMinutes * 60_000).toISOString()
        : existing.nextRunAt,
      revision: existing.revision + 1, updatedAt: now.toISOString(),
    }).where(and(eq(scraperSchedules.id, id), eq(scraperSchedules.ownerEmail, ownerEmail))).returning();
    return Response.json({ schedule: publicSchedule(schedule, productIds) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Schedule could not be updated." }, { status: 400 });
  }
}

function parseProductIds(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string").slice(0, 500) : [];
  } catch { return []; }
}

function publicSchedule(schedule: typeof scraperSchedules.$inferSelect, productIds: string[]) {
  const publicFields: Partial<typeof schedule> = { ...schedule };
  delete publicFields.productIdsJson;
  delete publicFields.leaseToken;
  delete publicFields.pendingOutcomeJson;
  return { ...publicFields, productIds };
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ownerEmail = await getCurrentUserEmail();
  if (!ownerEmail) return Response.json({ error: "Sign in to remove schedules." }, { status: 401 });
  await ensureProductsSchema();
  const { id } = await params;
  const [deleted] = await getDb().delete(scraperSchedules).where(and(eq(scraperSchedules.id, id), eq(scraperSchedules.ownerEmail, ownerEmail))).returning({ id: scraperSchedules.id });
  if (!deleted) return Response.json({ error: "Schedule not found." }, { status: 404 });
  return Response.json({ ok: true });
}
