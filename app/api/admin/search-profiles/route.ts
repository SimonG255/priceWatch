import { desc } from "drizzle-orm";
import { ensureProductsSchema, getDb } from "../../../../db";
import { customSearchProfiles, monitoredProducts, monitoredWebsites } from "../../../../db/schema";
import { getAdminEmail } from "../../../../lib/admin-auth";
import { listAdminWebsiteInventory } from "../../../../lib/admin-website-inventory";
import { isDatabaseTimeout, withDatabaseDeadline } from "../../../../lib/database-deadline";
import { listScraperDomainHealth } from "../../../../lib/scraper-state";
import { searchProfileIdentity, validateSearchProfileInput } from "../../../../lib/search-profile-input";

export async function GET() {
  if (!(await getAdminEmail())) return Response.json({ error: "Administrator access required." }, { status: 403 });
  try {
    await withDatabaseDeadline(ensureProductsSchema(), "Database connection");
  } catch (error) {
    console.error("Admin database connection timed out.", error);
    return Response.json(
      { error: "The production database did not respond. Verify Vercel DATABASE_URL and the Supabase transaction pooler." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  const db = getDb();
  const [profilesResult, savedWebsitesResult, productWebsitesResult, healthResult] = await Promise.allSettled([
    withDatabaseDeadline(db.select().from(customSearchProfiles).orderBy(desc(customSearchProfiles.createdAt)), "Profile query"),
    withDatabaseDeadline(db.select({ url: monitoredWebsites.url }).from(monitoredWebsites), "Website query"),
    withDatabaseDeadline(db.select({ url: monitoredProducts.websiteUrl }).from(monitoredProducts), "Product website query"),
    withDatabaseDeadline(listScraperDomainHealth(), "Scraper health query"),
  ]);
  if (savedWebsitesResult.status === "rejected" || productWebsitesResult.status === "rejected") {
    console.error("Admin website inventory could not be loaded.", {
      savedWebsites: savedWebsitesResult.status === "rejected" ? savedWebsitesResult.reason : undefined,
      productWebsites: productWebsitesResult.status === "rejected" ? productWebsitesResult.reason : undefined,
    });
  }
  if (profilesResult.status === "rejected") {
    console.error("Admin website profiles could not be loaded.", profilesResult.reason);
    const timedOut = isDatabaseTimeout(profilesResult.reason);
    return Response.json(
      { error: timedOut
        ? "The production database timed out while loading website profiles. Verify Vercel DATABASE_URL and the Supabase transaction pooler."
        : "Website profiles could not be loaded. Apply the latest database migrations, then reload the admin tab." },
      { status: timedOut ? 503 : 500, headers: { "Cache-Control": "no-store" } },
    );
  }
  const profiles = profilesResult.value;
  const savedWebsites = savedWebsitesResult.status === "fulfilled" ? savedWebsitesResult.value : [];
  const productWebsites = productWebsitesResult.status === "fulfilled" ? productWebsitesResult.value : [];
  const health = healthResult.status === "fulfilled" ? healthResult.value : [];
  const websites = listAdminWebsiteInventory([...savedWebsites, ...productWebsites]);
  const warnings = [
    ...(savedWebsitesResult.status === "rejected" || productWebsitesResult.status === "rejected"
      ? ["Customer website inventory is temporarily unavailable. Custom website profiles are still available below."]
      : []),
    ...(healthResult.status === "rejected" ? ["Scraper health is temporarily unavailable."] : []),
  ];
  if (healthResult.status === "rejected") {
    console.error("Admin scraper health could not be loaded.", healthResult.reason);
  }
  return Response.json({ profiles, websites, health, warnings }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const adminEmail = await getAdminEmail();
  if (!adminEmail) return Response.json({ error: "Administrator access required." }, { status: 403 });
  try {
    await withDatabaseDeadline(ensureProductsSchema(), "Database connection");
    const input = validateSearchProfileInput((await request.json()) as Record<string, unknown>);
    const db = getDb();
    const profiles: Array<{ hostname?: string; htmlSignature?: string; [key: string]: unknown }> = await withDatabaseDeadline(
      db.select().from(customSearchProfiles),
      "Profile duplicate check",
    );
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
    const [profile] = await withDatabaseDeadline(
      db.insert(customSearchProfiles)
        .values({ id: crypto.randomUUID(), ...input, createdBy: adminEmail })
        .returning(),
      "Profile insert",
    );
    return Response.json({ profile }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Profile could not be saved." },
      { status: isDatabaseTimeout(error) ? 503 : 400 },
    );
  }
}
