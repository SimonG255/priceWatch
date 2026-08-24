import { eq } from "drizzle-orm";
import { ensureProductsSchema, getDb } from "../../../../../../db";
import { scraperKnownBadPatterns } from "../../../../../../db/schema";
import { getAdminEmail } from "../../../../../../lib/admin-auth";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!await getAdminEmail()) return Response.json({ error: "Administrator access required." }, { status: 403 });
  await ensureProductsSchema();
  const { id } = await params;
  const [deleted] = await getDb().delete(scraperKnownBadPatterns).where(eq(scraperKnownBadPatterns.id, id)).returning({ id: scraperKnownBadPatterns.id });
  if (!deleted) return Response.json({ error: "Pattern not found." }, { status: 404 });
  return Response.json({ ok: true });
}
