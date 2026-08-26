import type { Metadata } from "next";
import Link from "next/link";
import AuthForm from "./AuthForm";
import { isSupabaseConfigured } from "../../lib/supabase/config";
import { normalizePlanSelection } from "../../lib/plans";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your PriceWatch competitor monitoring workspace.",
  robots: { index: false, follow: false },
  openGraph: { images: [] },
  twitter: { images: [] },
};

function Bolt() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m13 2-8 12h7l-1 8 8-12h-7l1-8Z"/></svg>;
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ plan?: string; urls?: string; checks?: string }> }) {
  const params = await searchParams;
  const selectedPlan = normalizePlanSelection(params);
  const returnTo = selectedPlan
    ? `/dashboard?plan=${selectedPlan.key}&urls=${selectedPlan.urlLimit}&checks=${selectedPlan.checksPerDay}`
    : "/dashboard";
  const signInHref = `/signin-with-chatgpt?return_to=${encodeURIComponent(returnTo)}`;
  return (
    <main className="login-page">
      <section className="login-brand">
        <Link className="login-logo" href="/" aria-label="PriceWatch home"><span className="logo"><Bolt/></span><span>PriceWatch</span></Link>
        <div className="login-brand-copy">
          <div className="eyebrow">COMPETITIVE INTELLIGENCE, SIMPLIFIED</div>
          <h1>Know when the market moves.</h1>
          <p>Monitor competitor prices, catch stock changes, and protect your margins from one calm, focused dashboard.</p>
          <div className="login-proof"><div><b>42</b><span>URLs monitored</span></div><div><b>4×</b><span>Daily checks</span></div><div><b>€186</b><span>Potential savings</span></div></div>
        </div>
        <p className="login-foot">© 2026 PriceWatch · Public pages only · Responsible monitoring</p>
      </section>
      <section className="login-panel">
        <div className="login-card">
          <h2>Welcome back</h2>
          <p>Sign in securely to access your products, price history, and alert rules.</p>
          <AuthForm configured={isSupabaseConfigured()} returnTo={returnTo} chatGPTSignInHref={signInHref} customPlan={selectedPlan?.key === "custom" ? { urls: selectedPlan.urlLimit, checks: selectedPlan.checksPerDay } : null}/>
          <div className="modal-note"><Bolt/>Passwords are handled by Supabase Auth and are never stored by PriceWatch.</div>
          <p className="login-help">By continuing, you agree to our <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>.</p>
        </div>
      </section>
    </main>
  );
}
