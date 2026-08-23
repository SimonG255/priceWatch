import { desc } from "drizzle-orm";
import { ensureProductsSchema, getDb } from "../../../../db";
import { customSearchProfiles } from "../../../../db/schema";
import { getAdminEmail } from "../../../../lib/admin-auth";
import { searchProfileIdentity, validateSearchProfileInput } from "../../../../lib/search-profile-input";

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
    const input = validateSearchProfileInput(await request.json() as Record<string, unknown>);
    const db = getDb();
    const profiles = await db.select().from(customSearchProfiles);
    if (profiles.some((profile) => searchProfileIdentity(profile) === searchProfileIdentity(input))) {
      return Response.json({ error: "A profile for this website and HTML signature already exists. Edit the existing profile instead." }, { status: 409 });
    }
    const [profile] = await db.insert(customSearchProfiles).values({ id: crypto.randomUUID(), ...input, createdBy: adminEmail }).returning();
    return Response.json({ profile }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Profile could not be saved." }, { status: 400 });
  }
}
