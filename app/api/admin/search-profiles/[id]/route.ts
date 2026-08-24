import { eq } from "drizzle-orm";
import { ensureProductsSchema, getDb } from "../../../../../db";
import { customSearchProfiles } from "../../../../../db/schema";
import { getAdminEmail } from "../../../../../lib/admin-auth";
import { searchProfileIdentity, validateSearchProfileInput } from "../../../../../lib/search-profile-input";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getAdminEmail())) return Response.json({ error: "Administrator access required." }, { status: 403 });
  try {
    await ensureProductsSchema();
    const { id } = await params;
    const input = validateSearchProfileInput((await request.json()) as Record<string, unknown>);
    const db = getDb();
    const profiles: Array<{
      id: string;
      revision: number;
      hostname?: string;
      htmlSignature?: string;
      [key: string]: unknown;
    }> = await db.select().from(customSearchProfiles);
    const existing = profiles.find(
      (profile: { id: string; revision: number; hostname?: string; htmlSignature?: string; [key: string]: unknown }) =>
        profile.id === id,
    );
    if (!existing) return Response.json({ error: "Search profile not found." }, { status: 404 });
    if (
      profiles.some(
        (profile: { id: string; hostname?: string; htmlSignature?: string; [key: string]: unknown }) =>
          profile.id !== id &&
          searchProfileIdentity(
            profile as Pick<
              import("../../../../../lib/search-profile-input").SearchProfileInput,
              "hostname" | "htmlSignature"
            >,
          ) === searchProfileIdentity(input),
      )
    ) {
      return Response.json({ error: "A profile for this website and HTML signature already exists." }, { status: 409 });
    }
    const [profile] = await db
      .update(customSearchProfiles)
      .set({ ...input, revision: existing.revision + 1, driftStatus: "unknown", updatedAt: new Date().toISOString() })
      .where(eq(customSearchProfiles.id, id))
      .returning();
    return Response.json({ profile });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Profile could not be updated." },
      { status: 400 },
    );
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getAdminEmail())) return Response.json({ error: "Administrator access required." }, { status: 403 });
  await ensureProductsSchema();
  const { id } = await params;
  const [profile] = await getDb()
    .delete(customSearchProfiles)
    .where(eq(customSearchProfiles.id, id))
    .returning({ id: customSearchProfiles.id });
  if (!profile) return Response.json({ error: "Search profile not found." }, { status: 404 });
  return Response.json({ ok: true });
}
