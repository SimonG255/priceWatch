"use client";

import { useEffect, useState } from "react";

type Profile = { id: string; label: string; hostname: string; htmlSignature: string; searchUrlTemplate: string; enabled: boolean; createdAt: string };

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json" } });
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error || "Request failed.");
  return body;
}

export default function AdminClient({ email, aiConfigured }: { email: string; aiConfigured: boolean }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [label, setLabel] = useState("");
  const [hostname, setHostname] = useState("");
  const [htmlSignature, setHtmlSignature] = useState("");
  const [searchUrlTemplate, setSearchUrlTemplate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { request<{ profiles: Profile[] }>("/api/admin/search-profiles").then(data => setProfiles(data.profiles)).catch(err => setError(err.message)); }, []);

  async function addProfile(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const { profile } = await request<{ profile: Profile }>("/api/admin/search-profiles", { method: "POST", body: JSON.stringify({ label, hostname, htmlSignature, searchUrlTemplate }) });
      setProfiles(current => [profile, ...current]); setLabel(""); setHostname(""); setHtmlSignature(""); setSearchUrlTemplate("");
    } catch (err) { setError(err instanceof Error ? err.message : "Profile could not be saved."); }
    finally { setSaving(false); }
  }

  async function removeProfile(profile: Profile) {
    if (!window.confirm(`Delete ${profile.label}?`)) return;
    try { await request(`/api/admin/search-profiles/${profile.id}`, { method: "DELETE" }); setProfiles(current => current.filter(item => item.id !== profile.id)); }
    catch (err) { setError(err instanceof Error ? err.message : "Profile could not be deleted."); }
  }

  return <main className="admin-page"><header><a href="/dashboard">← Dashboard</a><div><span>PRICEWATCH ADMIN</span><h1>Website search profiles</h1><p>Signed in as {email}</p></div></header>
    <section className={`ai-status ${aiConfigured ? "ready" : "missing"}`}><strong>AI-assisted discovery: {aiConfigured ? "Ready" : "API key required"}</strong><span>{aiConfigured ? "AI will search the selected store only when normal discovery fails, and PriceWatch will verify every candidate page." : "Add OPENAI_API_KEY to the Site runtime settings to enable the hybrid fallback. Normal website search remains active."}</span></section>
    <section className="admin-card"><div className="admin-intro"><h2>Add a search profile</h2><p>Use a domain for a specific store, an HTML signature for a shared platform, or both. The search URL must contain <code>{"{query}"}</code>.</p></div>
      <form onSubmit={addProfile} className="admin-form">
        <label><span>Profile name</span><input required value={label} onChange={event => setLabel(event.target.value)} placeholder="Example Store search"/></label>
        <label><span>Website hostname <small>optional if HTML is provided</small></span><input value={hostname} onChange={event => setHostname(event.target.value)} placeholder="store.example.com"/></label>
        <label className="full"><span>HTML signature <small>distinctive text from the page source</small></span><textarea value={htmlSignature} onChange={event => setHtmlSignature(event.target.value)} placeholder={'data-platform="example-store" or a distinctive script URL'}/></label>
        <label className="full"><span>Search URL template</span><input required value={searchUrlTemplate} onChange={event => setSearchUrlTemplate(event.target.value)} placeholder="/search?q={query}"/></label>
        <button disabled={saving} type="submit">{saving ? "Saving…" : "Add search profile"}</button>
      </form>{error && <p className="admin-error" role="alert">{error}</p>}
    </section>
    <section className="admin-card"><div className="admin-intro"><h2>Custom profiles</h2><p>These profiles are checked before built-in routes, discovered HTML forms, and generic fallbacks.</p></div>
      {!profiles.length ? <div className="admin-empty">No custom profiles yet.</div> : <div className="admin-table-wrap"><table><thead><tr><th>Name</th><th>Match</th><th>Search URL</th><th/></tr></thead><tbody>{profiles.map(profile => <tr key={profile.id}><td><strong>{profile.label}</strong></td><td>{profile.hostname && <code>{profile.hostname}</code>}{profile.htmlSignature && <small title={profile.htmlSignature}>HTML: {profile.htmlSignature}</small>}</td><td><code>{profile.searchUrlTemplate}</code></td><td><button onClick={() => removeProfile(profile)}>Delete</button></td></tr>)}</tbody></table></div>}
    </section>
  </main>;
}
