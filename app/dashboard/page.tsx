import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireChatGPTUser } from "../chatgpt-auth";
import DashboardClient from "./DashboardClient";
import { isSupabaseConfigured } from "../../lib/supabase/config";
import { createClient as createSupabaseClient } from "../../lib/supabase/server";
import "./dashboard.css";
import { isAdminEmail } from "../../lib/admin-auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Monitor competitor prices, stock, and market changes.",
  robots: { index: false, follow: false },
  openGraph: { images: [] },
  twitter: { images: [] },
};

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ plan?: string; urls?: string; checks?: string }> }) {
  const params = await searchParams;
  const customPlan = params.plan === "custom" ? {
    urls: Math.min(5000, Math.max(10, Number(params.urls) || 250)),
    checks: [1, 4, 12, 24].includes(Number(params.checks)) ? Number(params.checks) : 4,
  } : null;
  if (isSupabaseConfigured()) {
    const supabase = await createSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.email) redirect("/login");
    const displayName = typeof user.user_metadata?.username === "string" && user.user_metadata.username.trim() ? user.user_metadata.username.trim() : user.email.split("@")[0];
    return <DashboardClient displayName={displayName} email={user.email} customPlan={customPlan} authProvider="supabase" isAdmin={isAdminEmail(user.email)} />;
  }
  const user = await requireChatGPTUser("/dashboard");
  return <DashboardClient displayName={user.displayName} email={user.email} customPlan={customPlan} authProvider="chatgpt" isAdmin={isAdminEmail(user.email)} />;
}
