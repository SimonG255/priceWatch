"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "../../lib/supabase/client";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function updatePassword(event: React.FormEvent) {
    event.preventDefault(); setError("");
    if (password !== confirm) { setError("Passwords do not match."); return; }
    setLoading(true);
    try {
      const { error: updateError } = await createClient().auth.updateUser({ password });
      if (updateError) throw updateError;
      window.location.assign("/dashboard");
    } catch (authError) { setError(authError instanceof Error ? authError.message : "Could not update password."); }
    finally { setLoading(false); }
  }

  return <main className="reset-page"><div className="login-card"><Link className="reset-brand" href="/">ϟ PriceWatch</Link><h2>Choose a new password</h2><p>Use at least eight characters and avoid reusing a password from another service.</p><form className="password-auth" onSubmit={updatePassword}><label>New password<input required type="password" minLength={8} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)}/></label><label>Confirm password<input required type="password" minLength={8} autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)}/></label>{error && <p className="auth-error" role="alert">{error}</p>}<button className="primary auth-submit" disabled={loading}>{loading ? "Updating…" : "Update password"}</button></form></div></main>;
}
