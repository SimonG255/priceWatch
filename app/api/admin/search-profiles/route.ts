import { desc } from "drizzle-orm";
import { ensureProductsSchema, getDb } from "../../../../db";
import { customSearchProfiles } from "../../../../db/schema";
import { getAdminEmail } from "../../../../lib/admin-auth";
import { sameStoreHostname } from "../../../../lib/site-search-profiles";

function validateProfile(value: Record<string, unknown>) {
  const label = String(value.label ?? "").trim().slice(0, 80);
  const hostname = String(value.hostname ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
  const htmlSignature = String(value.htmlSignature ?? "").trim().slice(0, 500);
  const searchUrlTemplate = String(value.searchUrlTemplate ?? "").trim().slice(0, 500);
  if (label.length < 2) throw new Error("Enter a profile name.");
  if (!hostname && htmlSignature.length < 3) throw new Error("Enter a hostname or an HTML signature of at least 3 characters.");
  if (!searchUrlTemplate.includes("{query}")) throw new Error("The search URL must contain the {query} placeholder.");
  const sample = new URL(searchUrlTemplate.replace("{query}", "12345678"), `https://${hostname || "store.example"}`);
  if (!["http:", "https:"].includes(sample.protocol)) throw new Error("Search URLs must use HTTP or HTTPS.");
  if (hostname && !sameStoreHostname(sample.hostname, hostname)) throw new Error("The search URL must stay on the configured website.");
  return { label, hostname, htmlSignature, searchUrlTemplate };
}

export async function GET() {
  if (!await getAdminEmail()) return Response.json({ error: "Administrator access required." }, { status: 403 });
  await ensureProductsSchema();
  const profiles = await getDb().select().from(customSearchProfiles).orderBy(desc(customSearchProfiles.createdAt));
  return Response.json({ profiles });
}

export async function POST(request: Request) {
  const adminEmail = await getAdminEmail();
  if (!adminEmail) return Response.json({ error: "Administrator access required." }, { status: 403 });
  try {
    await ensureProductsSchema();
    const input = validateProfile(await request.json() as Record<string, unknown>);
    const [profile] = await getDb().insert(customSearchProfiles).values({ id: crypto.randomUUID(), ...input, createdBy: adminEmail }).returning();
    return Response.json({ profile }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Profile could not be saved." }, { status: 400 });
  }
}
