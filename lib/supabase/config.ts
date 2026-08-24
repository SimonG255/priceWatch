export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
export const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";

export function isSupabaseConfigured() {
  return supabaseUrl.startsWith("https://") && supabasePublishableKey.startsWith("sb_publishable_");
}
