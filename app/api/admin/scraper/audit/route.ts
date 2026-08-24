import { ensureProductsSchema } from "../../../../../db";
import { getAdminEmail } from "../../../../../lib/admin-auth";
import { listAuditRuns } from "../../../../../lib/scraper-operations";

export async function GET(request: Request) {
  if (!(await getAdminEmail())) return Response.json({ error: "Administrator access required." }, { status: 403 });
  await ensureProductsSchema();
  const limit = Number(new URL(request.url).searchParams.get("limit")) || 100;
  const runs: Array<{
    id: string;
    hostname: string;
    trigger: string;
    profileId: string | null;
    status: string;
    reasonCode: string | null;
    failureClass: string | null;
    challengeType: string | null;
    message: string | null;
    durationMs: number | null;
    attemptCount: number;
    httpStatus: number | null;
    startedAt: string;
    completedAt: string | null;
  }> = await listAuditRuns(limit);
  return Response.json(
    {
      runs: runs.map(
        (run: {
          id: string;
          hostname: string;
          trigger: string;
          profileId: string | null;
          status: string;
          reasonCode: string | null;
          failureClass: string | null;
          challengeType: string | null;
          message: string | null;
          durationMs: number | null;
          attemptCount: number;
          httpStatus: number | null;
          startedAt: string;
          completedAt: string | null;
        }) => ({
          id: run.id,
          hostname: run.hostname,
          trigger: run.trigger,
          profileId: run.profileId,
          status: run.status,
          reasonCode: run.reasonCode,
          failureClass: run.failureClass,
          challengeType: run.challengeType,
          message: run.message,
          durationMs: run.durationMs,
          attemptCount: run.attemptCount,
          httpStatus: run.httpStatus,
          startedAt: run.startedAt,
          completedAt: run.completedAt,
          // Cross-account admin views deliberately omit owner identity, product
          // identifiers, EANs, and full product URLs.
        }),
      ),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
