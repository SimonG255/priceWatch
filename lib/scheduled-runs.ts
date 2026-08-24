import { and, asc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { ensureProductsSchema, getDb } from "../db";
import { monitoredProducts, scraperSchedules } from "../db/schema";
import { fairDomainOrder } from "./scraper-diagnostics.ts";
import { runProductScan } from "./run-product-scan.ts";

// A scan can perform several public fetches and D1 writes. Keeping each Cron
// slice deliberately small stays inside Worker and D1 invocation budgets while
// the cursor advances through larger schedules over subsequent ticks.
const MAX_PRODUCTS_PER_TICK = 2;
const LEASE_MS = 4 * 60_000;

export async function runScraperSchedule(scheduleId: string, expectedOwnerEmail?: string) {
  await ensureProductsSchema();
  const db = getDb();
  const lookup = [eq(scraperSchedules.id, scheduleId)];
  if (expectedOwnerEmail) lookup.push(eq(scraperSchedules.ownerEmail, expectedOwnerEmail));
  const [existing] = await db.select().from(scraperSchedules).where(and(...lookup)).limit(1);
  if (!existing) return undefined;

  const now = new Date();
  if (existing.leaseUntil && existing.leaseUntil > now.toISOString()) {
    return { schedule: existing, outcomes: [], busy: true, complete: false };
  }

  const leaseToken = crypto.randomUUID();
  const [schedule] = await db.update(scraperSchedules).set({
    leaseToken,
    leaseUntil: new Date(now.getTime() + LEASE_MS).toISOString(),
    pendingStartedAt: existing.cursorIndex ? existing.pendingStartedAt : now.toISOString(),
    revision: existing.revision + 1,
    updatedAt: now.toISOString(),
  }).where(and(
    ...lookup,
    eq(scraperSchedules.revision, existing.revision),
    or(isNull(scraperSchedules.leaseUntil), lte(scraperSchedules.leaseUntil, now.toISOString())),
  )).returning();
  if (!schedule) return { schedule: existing, outcomes: [], busy: true, complete: false };

  const selectedIds = parseIds(schedule.productIdsJson);
  const productFilters = [eq(monitoredProducts.ownerEmail, schedule.ownerEmail)];
  if (schedule.targetMode === "selected") {
    if (!selectedIds.length) return finishSchedule(schedule, leaseToken, {}, [], true);
    productFilters.push(inArray(monitoredProducts.id, selectedIds));
  }
  const products = await db.select({ id: monitoredProducts.id, websiteUrl: monitoredProducts.websiteUrl })
    .from(monitoredProducts)
    .where(and(...productFilters))
    .orderBy(asc(monitoredProducts.createdAt), asc(monitoredProducts.id))
    .limit(500);
  const ordered = fairDomainOrder(products, (product) => new URL(product.websiteUrl).hostname);
  const cursor = Math.min(schedule.cursorIndex, ordered.length);
  const batch = ordered.slice(cursor, cursor + MAX_PRODUCTS_PER_TICK);
  const counts = parseCounts(schedule.pendingOutcomeJson);
  const outcomes: Array<{ id: string; status: string }> = [];

  for (const product of batch) {
    const outcome = await runProductScan({
      ownerEmail: schedule.ownerEmail,
      productId: product.id,
      trigger: "scheduled",
      scheduleId: schedule.id,
    });
    const status = "error" in outcome ? "error" : outcome.result.status;
    counts[status] = (counts[status] ?? 0) + 1;
    outcomes.push({ id: product.id, status });
  }

  const nextCursor = cursor + batch.length;
  return finishSchedule(schedule, leaseToken, counts, outcomes, nextCursor >= ordered.length, nextCursor, ordered.length);
}

export async function runDueScraperSchedules() {
  await ensureProductsSchema();
  const now = new Date().toISOString();
  const [due] = await getDb().select({ id: scraperSchedules.id }).from(scraperSchedules).where(and(
    eq(scraperSchedules.enabled, true),
    lte(scraperSchedules.nextRunAt, now),
    or(isNull(scraperSchedules.leaseUntil), lte(scraperSchedules.leaseUntil, now)),
  )).orderBy(asc(scraperSchedules.nextRunAt)).limit(1);
  if (!due) return 0;
  await runScraperSchedule(due.id);
  return 1;
}

async function finishSchedule(
  schedule: typeof scraperSchedules.$inferSelect,
  leaseToken: string,
  counts: Record<string, number>,
  outcomes: Array<{ id: string; status: string }>,
  complete: boolean,
  nextCursor = 0,
  total = 0,
) {
  const now = new Date();
  const lastOutcome = complete
    ? (Object.entries(counts).map(([status, count]) => `${count} ${status}`).join(", ") || "No products selected")
    : `Processing ${nextCursor} of ${total}: ${Object.entries(counts).map(([status, count]) => `${count} ${status}`).join(", ")}`;
  const [updated] = await getDb().update(scraperSchedules).set({
    lastRunAt: complete ? now.toISOString() : schedule.lastRunAt,
    lastOutcome,
    nextRunAt: complete ? new Date(now.getTime() + schedule.cadenceMinutes * 60_000).toISOString() : now.toISOString(),
    cursorIndex: complete ? 0 : nextCursor,
    pendingOutcomeJson: complete ? "{}" : JSON.stringify(counts),
    pendingStartedAt: complete ? null : schedule.pendingStartedAt,
    leaseToken: null,
    leaseUntil: null,
    updatedAt: now.toISOString(),
  }).where(and(
    eq(scraperSchedules.id, schedule.id),
    eq(scraperSchedules.ownerEmail, schedule.ownerEmail),
    eq(scraperSchedules.leaseToken, leaseToken),
  )).returning();
  return { schedule: updated ?? schedule, outcomes, busy: false, complete };
}

function parseIds(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string").slice(0, 500) : [];
  } catch { return []; }
}

function parseCounts(value: string) {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]) && entry[1] >= 0));
  } catch { return {}; }
}
