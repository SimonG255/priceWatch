import { asc, eq } from "drizzle-orm";
import { ensureProductsSchema, getDb } from "../../../../../../db";
import { scrapeAttempts, scrapeRuns } from "../../../../../../db/schema";
import { getAdminEmail } from "../../../../../../lib/admin-auth";

export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  if (!await getAdminEmail()) return Response.json({ error: "Administrator access required." }, { status: 403 });
  await ensureProductsSchema();
  const { runId } = await params;
  const db = getDb();
  const [run] = await db.select().from(scrapeRuns).where(eq(scrapeRuns.id, runId)).limit(1);
  if (!run) return Response.json({ error: "Audit run not found." }, { status: 404 });
  const attempts = await db.select({
    ordinal: scrapeAttempts.ordinal,
    url: scrapeAttempts.url,
    profileId: scrapeAttempts.profileId,
    profileLabel: scrapeAttempts.profileLabel,
    outcome: scrapeAttempts.outcome,
    reasonCode: scrapeAttempts.reasonCode,
    failureClass: scrapeAttempts.failureClass,
    challengeType: scrapeAttempts.challengeType,
    httpStatus: scrapeAttempts.httpStatus,
    durationMs: scrapeAttempts.durationMs,
    responseBytes: scrapeAttempts.responseBytes,
    contentHash: scrapeAttempts.contentHash,
    message: scrapeAttempts.message,
    createdAt: scrapeAttempts.createdAt,
  }).from(scrapeAttempts).where(eq(scrapeAttempts.runId, runId)).orderBy(asc(scrapeAttempts.ordinal)).limit(250);
  return Response.json({
    run: {
      id: run.id, hostname: run.hostname, trigger: run.trigger, profileId: run.profileId,
      status: run.status, reasonCode: run.reasonCode, failureClass: run.failureClass,
      challengeType: run.challengeType, message: run.message, durationMs: run.durationMs,
      attemptCount: run.attemptCount, httpStatus: run.httpStatus,
      startedAt: run.startedAt, completedAt: run.completedAt,
    },
    attempts,
  }, { headers: { "Cache-Control": "no-store" } });
}
