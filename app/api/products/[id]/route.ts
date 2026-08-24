import { and, eq } from "drizzle-orm";
import { ensureProductsSchema, getDb } from "../../../../db";
import { monitoredProducts } from "../../../../db/schema";
import { getCurrentUserEmail } from "../../../../lib/current-user";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ownerEmail = await getCurrentUserEmail();
  if (!ownerEmail) return Response.json({ error: "Sign in to remove products." }, { status: 401 });
  await ensureProductsSchema();
  const { id } = await params;
  await getDb().delete(monitoredProducts).where(and(eq(monitoredProducts.id, id), eq(monitoredProducts.ownerEmail, ownerEmail)));
  return Response.json({ ok: true });
}
