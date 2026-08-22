import { getChatGPTUser } from "../app/chatgpt-auth";
import { isSupabaseConfigured } from "./supabase/config";
import { createClient as createSupabaseClient } from "./supabase/server";

export async function getCurrentUserEmail(): Promise<string | null> {
  if (isSupabaseConfigured()) {
    const supabase = await createSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    return user?.email?.trim().toLowerCase() ?? null;
  }
  const user = await getChatGPTUser();
  return user?.email?.trim().toLowerCase() ?? null;
}
