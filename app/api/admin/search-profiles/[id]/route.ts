import { eq } from "drizzle-orm";
import { ensureProductsSchema, getDb } from "../../../../../db";
import { customSearchProfiles } from "../../../../../db/schema";
import { getAdminEmail } from "../../../../../lib/admin-auth";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!await getAdminEmail()) return Response.json({ error: "Administrator access required." }, { status: 403 });
  await ensureProductsSchema();
  const { id } = await params;
  await getDb().delete(customSearchProfiles).where(eq(customSearchProfiles.id, id));
  return Response.json({ ok: true });
}
