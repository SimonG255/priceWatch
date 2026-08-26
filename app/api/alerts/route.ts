import { desc, eq } from "drizzle-orm";
import { ensureProductsSchema, getDb } from "../../../db";
import { customerAlertEvents } from "../../../db/schema";
import { getCurrentUserEmail } from "../../../lib/current-user";

export async function GET() {
  const ownerEmail = await getCurrentUserEmail();
  if (!ownerEmail) return Response.json({ error: "Sign in to view alerts." }, { status: 401 });
  await ensureProductsSchema();
  const alerts = await getDb().select().from(customerAlertEvents)
    .where(eq(customerAlertEvents.ownerEmail, ownerEmail))
    .orderBy(desc(customerAlertEvents.detectedAt)).limit(100);
  return Response.json({ alerts }, { headers: { "Cache-Control": "no-store" } });
}
