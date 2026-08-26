import { getChatGPTUser } from "../app/chatgpt-auth";
import { isSupabaseConfigured } from "./supabase/config";
import { createClient as createSupabaseClient } from "./supabase/server";

export type CurrentUser = {
  email: string;
  displayName: string;
  provider: "supabase" | "chatgpt";
};

export async function getCurrentUser(): Promise<CurrentUser | null> {
  if (isSupabaseConfigured()) {
    try {
      const supabase = await createSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email) {
        const email = user.email.trim().toLowerCase();
        const username = typeof user.user_metadata?.username === "string" ? user.user_metadata.username.trim() : "";
        return { email, displayName: username || email.split("@")[0], provider: "supabase" };
      }
    } catch {
      // A missing or expired Supabase session must not hide a valid ChatGPT identity.
    }
  }
  const user = await getChatGPTUser();
  if (!user?.email) return null;
  return {
    email: user.email.trim().toLowerCase(),
    displayName: user.displayName,
    provider: "chatgpt",
  };
}

export async function getCurrentUserEmail(): Promise<string | null> {
  return (await getCurrentUser())?.email ?? null;
}
