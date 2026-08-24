import { ensureProductsSchema } from "../../../../../db";
import { getAdminEmail } from "../../../../../lib/admin-auth";
import { listScraperDashboard } from "../../../../../lib/scraper-operations";

export async function GET() {
  if (!await getAdminEmail()) return Response.json({ error: "Administrator access required." }, { status: 403 });
  await ensureProductsSchema();
  const dashboard = await listScraperDashboard();
  return Response.json({
    ...dashboard,
    alerting: {
      slackConfigured: Boolean(process.env.SLACK_WEBHOOK_URL),
      emailConfigured: Boolean(process.env.ALERT_EMAIL_WEBHOOK_URL),
    },
  }, { headers: { "Cache-Control": "no-store" } });
}
