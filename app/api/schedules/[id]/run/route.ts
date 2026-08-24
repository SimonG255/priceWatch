import { getCurrentUserEmail } from "../../../../../lib/current-user";
import { runScraperSchedule } from "../../../../../lib/scheduled-runs";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ownerEmail = await getCurrentUserEmail();
  if (!ownerEmail) return Response.json({ error: "Sign in to run schedules." }, { status: 401 });
  const { id } = await params;
  const outcome = await runScraperSchedule(id, ownerEmail);
  if (!outcome) return Response.json({ error: "Schedule not found." }, { status: 404 });
  return Response.json(outcome, { status: outcome.complete ? 200 : 202 });
}
