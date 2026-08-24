import { getCurrentUserEmail } from "../../../../../lib/current-user";
import { runProductScan } from "../../../../../lib/run-product-scan";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ownerEmail = await getCurrentUserEmail();
  if (!ownerEmail) return Response.json({ error: "Sign in to search products." }, { status: 401 });
  const { id } = await params;
  const outcome = await runProductScan({ ownerEmail, productId: id, trigger: "manual" });
  if ("error" in outcome) return Response.json({ error: outcome.error }, { status: outcome.status });
  return Response.json({ product: outcome.product, runId: outcome.runId });
}
