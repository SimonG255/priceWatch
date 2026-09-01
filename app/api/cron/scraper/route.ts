import { runDueScraperSchedules } from "../../../../lib/scheduled-runs";
import { authorizeCronRequest } from "../../../../lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Durable scheduler entry point. Vercel supplies CRON_SECRET as a Bearer token;
 * other hosting schedulers can call the same GET route with that header.
 */
export async function GET(request: Request) {
  const startedAt = new Date().toISOString();
  const authorization = authorizeCronRequest(request);
  if (!authorization.authorized) {
    return Response.json(
      { ok: false, error: authorization.error },
      { status: authorization.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const claimedSchedules = await runDueScraperSchedules();
    return Response.json(
      { ok: true, claimedSchedules, startedAt, completedAt: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Scheduled scraper tick failed", error instanceof Error ? error.message : "Unknown cron error");
    return Response.json(
      { ok: false, error: "The scheduled scraper tick failed.", startedAt },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
