import { desc } from "drizzle-orm";
import { ensureProductsSchema, getDb } from "../../../../db";
import { customSearchProfiles, monitoredProducts, monitoredWebsites } from "../../../../db/schema";
import { getAdminEmail } from "../../../../lib/admin-auth";
import { listAdminWebsiteInventory } from "../../../../lib/admin-website-inventory";
import { listScraperDomainHealth } from "../../../../lib/scraper-state";
import { searchProfileIdentity, validateSearchProfileInput } from "../../../../lib/search-profile-input";

export async function GET() {
  if (!(await getAdminEmail())) return Response.json({ error: "Administrator access required." }, { status: 403 });
  await ensureProductsSchema();
  const db = getDb();
  const [profiles, savedWebsites, productWebsites, health] = await Promise.all([
    db.select().from(customSearchProfiles).orderBy(desc(customSearchProfiles.createdAt)) as Array<
      Record<string, unknown>
    >,
    db.select({ url: monitoredWebsites.url }).from(monitoredWebsites) as Array<{ url: string }>,
    db.select({ url: monitoredProducts.websiteUrl }).from(monitoredProducts) as Array<{ url: string }>,
    listScraperDomainHealth(),
  ]);
  const websites = listAdminWebsiteInventory([...savedWebsites, ...productWebsites]);
  return Response.json({ profiles, websites, health }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const adminEmail = await getAdminEmail();
  if (!adminEmail) return Response.json({ error: "Administrator access required." }, { status: 403 });
  try {
    await ensureProductsSchema();
    const input = validateSearchProfileInput((await request.json()) as Record<string, unknown>);
    const db = getDb();
    const profiles: Array<{ hostname?: string; htmlSignature?: string; [key: string]: unknown }> = await db
      .select()
      .from(customSearchProfiles);
    if (
      profiles.some(
        (profile: { hostname?: string; htmlSignature?: string; [key: string]: unknown }) =>
          searchProfileIdentity(
            profile as Pick<
              import("../../../../lib/search-profile-input").SearchProfileInput,
              "hostname" | "htmlSignature"
            >,
          ) === searchProfileIdentity(input),
      )
    ) {
      return Response.json(
        { error: "A profile for this website and HTML signature already exists. Edit the existing profile instead." },
        { status: 409 },
      );
    }
    const [profile] = await db
      .insert(customSearchProfiles)
      .values({ id: crypto.randomUUID(), ...input, createdBy: adminEmail })
      .returning();
    return Response.json({ profile }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Profile could not be saved." },
      { status: 400 },
    );
  }
}
