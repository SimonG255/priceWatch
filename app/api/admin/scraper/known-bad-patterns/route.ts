import { desc } from "drizzle-orm";
import { ensureProductsSchema, getDb } from "../../../../../db";
import { scraperKnownBadPatterns } from "../../../../../db/schema";
import { getAdminEmail } from "../../../../../lib/admin-auth";
import { assertPublicHostname } from "../../../../../lib/product-input";

export async function GET() {
  if (!await getAdminEmail()) return Response.json({ error: "Administrator access required." }, { status: 403 });
  await ensureProductsSchema();
  const patterns = await getDb().select().from(scraperKnownBadPatterns).orderBy(desc(scraperKnownBadPatterns.updatedAt)).limit(500);
  return Response.json({ patterns }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const adminEmail = await getAdminEmail();
  if (!adminEmail) return Response.json({ error: "Administrator access required." }, { status: 403 });
  try {
    await ensureProductsSchema();
    const body = await request.json() as Record<string, unknown>;
    const hostname = String(body.hostname || "").trim().toLowerCase().replace(/^www\./, "");
    if (hostname !== "*") assertPublicHostname(hostname);
    const urlPattern = safePattern(body.urlPattern, "URL pattern");
    const contentPattern = safePattern(body.contentPattern, "Content pattern");
    if (!urlPattern && !contentPattern) throw new Error("Add a URL or content pattern.");
    const reason = String(body.reason || "Known mis-extraction").trim().slice(0, 240);
    const now = new Date().toISOString();
    const [pattern] = await getDb().insert(scraperKnownBadPatterns).values({
      id: crypto.randomUUID(), hostname, urlPattern: urlPattern || null, contentPattern: contentPattern || null,
      reason, failureClass: "permanent", enabled: body.enabled !== false, createdBy: adminEmail,
      createdAt: now, updatedAt: now,
    }).returning();
    return Response.json({ pattern }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Pattern could not be saved." }, { status: 400 });
  }
}

function safePattern(value: unknown, label: string) {
  if (value == null) return "";
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  const pattern = value.trim();
  if (pattern.length > 300 || /[\u0000-\u001f]/.test(pattern) || (pattern.match(/\*/g)?.length ?? 0) > 8) throw new Error(`${label} must be a short literal or bounded * wildcard pattern.`);
  return pattern;
}
