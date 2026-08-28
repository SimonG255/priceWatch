import { getAdminEmail } from "../../../../lib/admin-auth";
import { getSystemHealth } from "../../../../lib/system-health";

export async function GET() {
  if (!await getAdminEmail()) return Response.json({ error: "Administrator access required." }, { status: 403 });
  return Response.json(await getSystemHealth(), { headers: { "Cache-Control": "no-store" } });
}
