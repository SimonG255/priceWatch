import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUserEmail } from "../../lib/current-user";
import { isAdminEmail, isSuperAdminEmail } from "../../lib/admin-auth";
import AdminClient from "./AdminClient";
import "./admin.css";
import "./access.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Search profile admin", robots: { index: false, follow: false } };

export default async function AdminPage() {
  const email = await getCurrentUserEmail();
  if (!email) redirect("/login");
  if (!isAdminEmail(email)) return <main className="admin-page"><section className="admin-card access-card"><span>ADMIN ACCESS</span><h1>Administrator access is not enabled for this account</h1><p>You are signed in as <strong>{email}</strong>. Add this exact address to the Site&apos;s <code>ADMIN_EMAILS</code> runtime setting, then publish a new version.</p><a href="/dashboard">← Return to dashboard</a></section></main>;
  return <AdminClient email={email} aiConfigured={Boolean(process.env.OPENAI_API_KEY)} isSuperAdmin={isSuperAdminEmail(email)}/>;
}
