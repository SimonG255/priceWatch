import type { Metadata } from "next";
import { redirect } from "next/navigation";
import DashboardClient from "./DashboardClient";
import "./dashboard.css";
import { isAdminEmail } from "../../lib/admin-auth";
import { ensureProductsSchema } from "../../db";
import { getCurrentUser } from "../../lib/current-user";
import { getOrCreateUserPlan, normalizePlanSelection } from "../../lib/plans";

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
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await ensureProductsSchema();
  const plan = await getOrCreateUserPlan(user.email, normalizePlanSelection(params));
  return <DashboardClient displayName={user.displayName} email={user.email} plan={plan} authProvider={user.provider} isAdmin={isAdminEmail(user.email)} />;
}
