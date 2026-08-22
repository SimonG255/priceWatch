"use client";

import { useState } from "react";
import { createClient } from "../../lib/supabase/client";

type Mode = "login" | "signup" | "reset";

export default function AuthForm({ configured, returnTo, chatGPTSignInHref, customPlan }: { configured: boolean; returnTo: string; chatGPTSignInHref: string; customPlan: { urls: number; checks: number } | null }) {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError(""); setMessage("");
    if (!configured) { setError("Connect the Supabase project values to enable email and password accounts."); return; }
    setLoading(true);
    try {
      const supabase = createClient();
      if (mode === "reset") {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/auth/callback?next=/reset-password` });
        if (resetError) throw resetError;
        setMessage("If an account exists, a password-reset link is on its way.");
      } else if (mode === "signup") {
        const { data, error: signupError } = await supabase.auth.signUp({ email, password, options: { data: { username }, emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(returnTo)}` } });
        if (signupError) throw signupError;
        if (data.session) window.location.assign(returnTo);
        else setMessage("Check your email to verify your account, then sign in.");
      } else {
        const { error: loginError } = await supabase.auth.signInWithPassword({ email, password });
        if (loginError) throw loginError;
        window.location.assign(returnTo);
      }
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "Authentication failed. Please try again.");
    } finally { setLoading(false); }
  }

  return <>
    <div className="auth-tabs" role="tablist"><button className={mode === "login" ? "active" : ""} onClick={() => {setMode("login");setError("");setMessage("")}} type="button">Sign in</button><button className={mode === "signup" ? "active" : ""} onClick={() => {setMode("signup");setError("");setMessage("")}} type="button">Create account</button></div>
    {customPlan && <div className="selected-plan-note"><span>Selected custom plan</span><b>{customPlan.urls.toLocaleString()} URLs · {customPlan.checks === 1 ? "daily" : `${customPlan.checks} checks/day`}</b></div>}
    <form className="password-auth" onSubmit={submit}>
      {mode === "signup" && <label>Username<input required minLength={2} maxLength={40} autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Your display name"/></label>}
      <label>Email address<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com"/></label>
      {mode !== "reset" && <label>Password<input required type="password" minLength={8} autoComplete={mode === "signup" ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters"/></label>}
      {mode === "login" && <button className="forgot-link" type="button" onClick={() => {setMode("reset");setError("");setMessage("")}}>Forgot password?</button>}
      {error && <p className="auth-error" role="alert">{error}</p>}{message && <p className="auth-success" role="status">{message}</p>}
      <button className="primary auth-submit" disabled={loading} type="submit">{loading ? "Please wait…" : mode === "login" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset link"}</button>
      {mode === "reset" && <button className="back-login" type="button" onClick={() => setMode("login")}>← Back to sign in</button>}
    </form>
    {!configured && <div className="auth-setup-note"><b>Email/password setup is ready.</b><span>Connect the Supabase project URL and publishable key to activate it.</span></div>}
    <div className="login-divider">or</div><a className="chatgpt-login" href={chatGPTSignInHref}>Continue with ChatGPT</a>
  </>;
}
