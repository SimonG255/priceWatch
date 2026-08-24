import { desc } from "drizzle-orm";
import { ensureProductsSchema, getDb } from "../../../../../db";
import { scraperAlertRules } from "../../../../../db/schema";
import { getAdminEmail } from "../../../../../lib/admin-auth";
import { assertPublicHostname } from "../../../../../lib/product-input";

export async function GET() {
  if (!await getAdminEmail()) return Response.json({ error: "Administrator access required." }, { status: 403 });
  await ensureProductsSchema();
  const rules = await getDb().select().from(scraperAlertRules).orderBy(desc(scraperAlertRules.updatedAt)).limit(200);
  return Response.json({ rules, channels: { slack: Boolean(process.env.SLACK_WEBHOOK_URL), email: Boolean(process.env.ALERT_EMAIL_WEBHOOK_URL) } });
}

export async function POST(request: Request) {
  const adminEmail = await getAdminEmail();
  if (!adminEmail) return Response.json({ error: "Administrator access required." }, { status: 403 });
  try {
    await ensureProductsSchema();
    const body = await request.json() as Record<string, unknown>;
    const hostname = body.hostname == null || body.hostname === "" ? "*" : String(body.hostname).trim().toLowerCase().replace(/^www\./, "");
    if (hostname !== "*") assertPublicHostname(hostname);
    const channel = body.channel === "email" ? "email" : "slack";
    const minimumChecks = clampInt(body.minimumChecks, 1, 10_000, 5);
    const minimumSuccessRateBps = Math.round(clampNumber(body.minimumSuccessRate, 0, 100, 80) * 100);
    const maximumConsecutiveFailures = clampInt(body.maximumConsecutiveFailures, 1, 100, 3);
    const cooldownMinutes = clampInt(body.cooldownMinutes, 5, 10_080, 60);
    const now = new Date().toISOString();
    const [rule] = await getDb().insert(scraperAlertRules).values({
      id: crypto.randomUUID(), hostname, channel, minimumChecks, minimumSuccessRateBps,
      maximumConsecutiveFailures, cooldownMinutes, destinationRef: "default", enabled: body.enabled !== false,
      createdBy: adminEmail, createdAt: now, updatedAt: now,
    }).returning();
    return Response.json({ rule }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Alert rule could not be created." }, { status: 400 });
  }
}

function clampInt(value: unknown, min: number, max: number, fallback: number) { return Math.round(clampNumber(value, min, max, fallback)); }
function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}
