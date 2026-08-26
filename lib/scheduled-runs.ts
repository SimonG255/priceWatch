import { and, asc, count, eq, isNull, lt, lte, or, sql } from "drizzle-orm";
import { ensureProductsSchema, getDb } from "../db";
import { monitoredProducts, scraperSchedules } from "../db/schema";
import { runProductScan } from "./run-product-scan.ts";

// Work stays bounded, but several stores and schedules can make progress on
// each minute tick. One product per hostname also preserves polite pacing.
const MAX_PRODUCTS_PER_TICK = 4;
const MAX_SCHEDULES_PER_TICK = 8;
const LEASE_MS = 15 * 60_000;
const LEASE_HEARTBEAT_MS = 60_000;

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
    pendingStartedAt: existing.pendingStartedAt ?? now.toISOString(),
    revision: existing.revision + 1,
    updatedAt: now.toISOString(),
  }).where(and(
    ...lookup,
    eq(scraperSchedules.revision, existing.revision),
    or(isNull(scraperSchedules.leaseUntil), lte(scraperSchedules.leaseUntil, now.toISOString())),
  )).returning();
  if (!schedule) return { schedule: existing, outcomes: [], busy: true, complete: false };

  const selectedIds = parseIds(schedule.productIdsJson);
  if (schedule.targetMode === "selected" && !selectedIds.length) {
    return finishSchedule(schedule, leaseToken, {}, [], true);
  }

  const cycleStartedAt = schedule.pendingStartedAt ?? now.toISOString();
  const filters = scheduleFilters(schedule.ownerEmail, schedule.targetMode, selectedIds, cycleStartedAt);
  const [{ remaining }] = await db.select({ remaining: count() }).from(monitoredProducts).where(and(...filters));
  if (!remaining) return finishSchedule(schedule, leaseToken, parseCounts(schedule.pendingOutcomeJson), [], true);

  const domains = await db.selectDistinct({ hostname: monitoredProducts.hostname }).from(monitoredProducts)
    .where(and(...filters)).orderBy(asc(monitoredProducts.hostname));
  const selectedDomains = Array.from({ length: Math.min(MAX_PRODUCTS_PER_TICK, domains.length) }, (_, offset) =>
    domains[(schedule.cursorIndex + offset) % domains.length]?.hostname,
  ).filter((hostname): hostname is string => Boolean(hostname));
  const products = (await Promise.all(selectedDomains.map(async (hostname) => {
    const [product] = await db.select({ id: monitoredProducts.id, websiteUrl: monitoredProducts.websiteUrl })
      .from(monitoredProducts)
      .where(and(...filters, eq(monitoredProducts.hostname, hostname)))
      .orderBy(asc(monitoredProducts.lastCheckedAt), asc(monitoredProducts.createdAt), asc(monitoredProducts.id))
      .limit(1);
    return product;
  }))).filter((product): product is { id: string; websiteUrl: string } => Boolean(product));
  if (!products.length) return finishSchedule(schedule, leaseToken, parseCounts(schedule.pendingOutcomeJson), [], true);

  const counts = parseCounts(schedule.pendingOutcomeJson);
  const outcomes: Array<{ id: string; status: string }> = [];
  const heartbeat = startLeaseHeartbeat(schedule, leaseToken);
  try {
    for (const product of products) {
      try {
        const outcome = await runProductScan({
          ownerEmail: schedule.ownerEmail,
          productId: product.id,
          trigger: "scheduled",
          scheduleId: schedule.id,
        });
        const status = "error" in outcome ? "error" : outcome.result.status;
        counts[status] = (counts[status] ?? 0) + 1;
        outcomes.push({ id: product.id, status });
      } catch (error) {
        counts.error = (counts.error ?? 0) + 1;
        outcomes.push({ id: product.id, status: "error" });
        console.error("Scheduled product scan failed", error instanceof Error ? error.message : "Unknown schedule error");
      }
    }
  } finally {
    await heartbeat.stop();
  }

  const [{ remaining: remainingAfter }] = await db.select({ remaining: count() }).from(monitoredProducts).where(and(...filters));
  const nextCursor = schedule.cursorIndex + products.length;
  return finishSchedule(schedule, leaseToken, counts, outcomes, remainingAfter === 0, nextCursor, nextCursor + remainingAfter);
}

export async function runDueScraperSchedules() {
  await ensureProductsSchema();
  const now = new Date().toISOString();
  const due = await getDb().select({ id: scraperSchedules.id }).from(scraperSchedules).where(and(
    eq(scraperSchedules.enabled, true),
    lte(scraperSchedules.nextRunAt, now),
    or(isNull(scraperSchedules.leaseUntil), lte(scraperSchedules.leaseUntil, now)),
  )).orderBy(asc(scraperSchedules.nextRunAt)).limit(MAX_SCHEDULES_PER_TICK);
  if (!due.length) return 0;
  await Promise.allSettled(due.map((schedule) => runScraperSchedule(schedule.id)));
  return due.length;
}

function scheduleFilters(ownerEmail: string, targetMode: string, selectedIds: string[], cycleStartedAt: string) {
  const filters = [
    eq(monitoredProducts.ownerEmail, ownerEmail),
    or(isNull(monitoredProducts.lastCheckedAt), lt(monitoredProducts.lastCheckedAt, cycleStartedAt)),
  ];
  if (targetMode === "selected") filters.push(selectedProductIds(selectedIds));
  return filters;
}

function selectedProductIds(ids: string[]) {
  return sql`${monitoredProducts.id} IN (SELECT CAST(value AS TEXT) FROM json_each(${JSON.stringify(ids)}))`;
}

function startLeaseHeartbeat(schedule: typeof scraperSchedules.$inferSelect, leaseToken: string) {
  let active = true;
  let pending = Promise.resolve();
  const renew = () => {
    pending = pending.then(async () => {
      if (!active) return;
      const now = new Date();
      const [renewed] = await getDb().update(scraperSchedules).set({
        leaseUntil: new Date(now.getTime() + LEASE_MS).toISOString(),
        updatedAt: now.toISOString(),
      }).where(and(
        eq(scraperSchedules.id, schedule.id),
        eq(scraperSchedules.ownerEmail, schedule.ownerEmail),
        eq(scraperSchedules.leaseToken, leaseToken),
        eq(scraperSchedules.revision, schedule.revision),
      )).returning({ id: scraperSchedules.id });
      if (!renewed) active = false;
    }).catch((error) => { console.error("Schedule lease renewal failed", error); });
  };
  const timer = setInterval(renew, LEASE_HEARTBEAT_MS);
  return {
    async stop() {
      active = false;
      clearInterval(timer);
      await pending;
    },
  };
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
  const summary = Object.entries(counts).map(([status, value]) => `${value} ${status}`).join(", ");
  const lastOutcome = complete ? (summary || "No products selected") : `Processing ${nextCursor} of ${total}: ${summary}`;
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
    eq(scraperSchedules.revision, schedule.revision),
  )).returning();
  if (!updated) return staleScheduleResult(schedule, outcomes);
  return { schedule: updated, outcomes, busy: false, complete };
}

async function staleScheduleResult(schedule: typeof scraperSchedules.$inferSelect, outcomes: Array<{ id: string; status: string }>) {
  const [current] = await getDb().select().from(scraperSchedules).where(and(
    eq(scraperSchedules.id, schedule.id),
    eq(scraperSchedules.ownerEmail, schedule.ownerEmail),
  )).limit(1);
  return { schedule: current ?? schedule, outcomes, busy: true, complete: false, stale: true };
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
