"use client";

import { useEffect, useState } from "react";

type Profile = { id: string; label: string; hostname: string; htmlSignature: string; searchUrlTemplate: string; enabled: boolean; createdAt: string };
type UsedWebsite = { hostname: string };

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json" } });
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error || "Request failed.");
  return body;
}

function profileMatchesWebsite(profile: Profile, websiteHostname: string) {
  const configuredHostname = profile.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  const usedHostname = websiteHostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  return Boolean(configuredHostname) && (
    configuredHostname === usedHostname
    || configuredHostname.endsWith(`.${usedHostname}`)
    || usedHostname.endsWith(`.${configuredHostname}`)
  );
}

export default function AdminClient({ email, aiConfigured }: { email: string; aiConfigured: boolean }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [websites, setWebsites] = useState<UsedWebsite[]>([]);
  const [label, setLabel] = useState("");
  const [hostname, setHostname] = useState("");
  const [htmlSignature, setHtmlSignature] = useState("");
  const [searchUrlTemplate, setSearchUrlTemplate] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    request<{ profiles: Profile[]; websites: UsedWebsite[] }>("/api/admin/search-profiles")
      .then(data => { setProfiles(data.profiles); setWebsites(data.websites); })
      .catch(err => setError(err.message));
  }, []);

  function resetForm() {
    setLabel(""); setHostname(""); setHtmlSignature(""); setSearchUrlTemplate(""); setEnabled(true); setEditingId(null);
  }

  function editProfile(profile: Profile) {
    setEditingId(profile.id); setLabel(profile.label); setHostname(profile.hostname); setHtmlSignature(profile.htmlSignature);
    setSearchUrlTemplate(profile.searchUrlTemplate); setEnabled(profile.enabled); setError("");
    document.getElementById("profile-editor")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function configureWebsite(websiteHostname: string) {
    resetForm();
    setLabel(`${websiteHostname} search`); setHostname(websiteHostname); setSearchUrlTemplate("/search?q={query}"); setError("");
    document.getElementById("profile-editor")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const url = editingId ? `/api/admin/search-profiles/${editingId}` : "/api/admin/search-profiles";
      const { profile } = await request<{ profile: Profile }>(url, { method: editingId ? "PATCH" : "POST", body: JSON.stringify({ label, hostname, htmlSignature, searchUrlTemplate, enabled }) });
      setProfiles(current => editingId ? current.map(item => item.id === profile.id ? profile : item) : [profile, ...current]);
      resetForm();
    } catch (err) { setError(err instanceof Error ? err.message : "Profile could not be saved."); }
    finally { setSaving(false); }
  }

  async function removeProfile(profile: Profile) {
    if (!window.confirm(`Delete ${profile.label}?`)) return;
    try { await request(`/api/admin/search-profiles/${profile.id}`, { method: "DELETE" }); setProfiles(current => current.filter(item => item.id !== profile.id)); }
    catch (err) { setError(err instanceof Error ? err.message : "Profile could not be deleted."); }
  }

  return <main className="admin-page">
    <header><a href="/dashboard">← Dashboard</a><div><span>PRICEWATCH ADMIN</span><h1>Website search profiles</h1><p>Signed in as {email}</p></div></header>
    <section className={`ai-status ${aiConfigured ? "ready" : "missing"}`}><strong>AI-assisted review: {aiConfigured ? "Ready" : "API key required"}</strong><span>{aiConfigured ? "AI reviews every result against the selected store and searches for a replacement when needed. PriceWatch verifies every candidate page." : "Add OPENAI_API_KEY to the Site runtime settings to enable AI review and recovery. Normal website search remains active."}</span></section>
    <section className="admin-card website-inventory">
      <div className="admin-intro"><h2>Websites in use across customer accounts</h2><p>These are the website hostnames currently submitted by customers. Customer names, product details, and full URLs are not shown here. Edit a matching profile, or configure a new one for a website that needs a different search route or HTML signature.</p></div>
      {!websites.length ? <div className="admin-empty">No customer websites have been added yet.</div> : <div className="admin-table-wrap"><table><thead><tr><th>Website</th><th>Profiles that cover it</th><th>Actions</th></tr></thead><tbody>{websites.map(website => {
        const matchingProfiles = profiles.filter(profile => profileMatchesWebsite(profile, website.hostname));
        return <tr key={website.hostname}><td><code>{website.hostname}</code></td><td>{matchingProfiles.length ? <div className="profile-actions">{matchingProfiles.map(profile => <button key={profile.id} className="edit-profile" onClick={() => editProfile(profile)}>Edit {profile.label}</button>)}</div> : <small>No hostname profile yet</small>}</td><td><div className="profile-actions"><button className="edit-profile" onClick={() => configureWebsite(website.hostname)}>{matchingProfiles.length ? "Add another profile" : "Configure profile"}</button></div></td></tr>;
      })}</tbody></table></div>}
    </section>
    <section className={`admin-card ${editingId ? "editing" : ""}`} id="profile-editor">
      <div className="admin-intro"><span className="editor-mode">{editingId ? "EDITING WEBSITE" : "NEW WEBSITE"}</span><h2>{editingId ? "Edit website search profile" : "Add a website search profile"}</h2><p>Use a hostname for a specific store, an HTML signature for a shared platform, or both. When both are provided, both must match. The HTML signature must occur in the submitted website page source, and the search URL must contain <code>{"{query}"}</code>.</p></div>
      <form onSubmit={saveProfile} className="admin-form">
        <label><span>Profile name</span><input required maxLength={80} value={label} onChange={event => setLabel(event.target.value)} placeholder="Example Store search"/></label>
        <label><span>Website hostname <small>optional if HTML is provided</small></span><input value={hostname} onChange={event => setHostname(event.target.value)} placeholder="store.example.com"/></label>
        <label className="full"><span>HTML signature <small>up to 500 characters from the submitted website page source</small></span><textarea maxLength={500} value={htmlSignature} onChange={event => setHtmlSignature(event.target.value)} placeholder={'data-platform="example-store" or a distinctive script URL'}/></label>
        <label className="full"><span>Search URL template</span><input required maxLength={500} value={searchUrlTemplate} onChange={event => setSearchUrlTemplate(event.target.value)} placeholder="/search?q={query}"/></label>
        <label className="enabled-control"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)}/><span>Enabled for product searches</span></label>
        <div className="admin-form-actions"><button disabled={saving} type="submit">{saving ? "Saving…" : editingId ? "Save website changes" : "Add website profile"}</button>{editingId && <button className="cancel-edit" disabled={saving} type="button" onClick={resetForm}>Cancel</button>}</div>
      </form>{error && <p className="admin-error" role="alert">{error}</p>}
    </section>
    <section className="admin-card"><div className="admin-intro"><h2>Existing website profiles</h2><p>Edit a website whenever its HTML or search URL changes. The latest enabled profiles are applied after the submitted website page is loaded, before built-in routes, discovered HTML forms, and generic fallbacks. Dashboard results update when those products are scanned again.</p></div>
      {!profiles.length ? <div className="admin-empty">No custom website profiles yet.</div> : <div className="admin-table-wrap"><table><thead><tr><th>Name</th><th>Match</th><th>Search URL</th><th>Status</th><th>Actions</th></tr></thead><tbody>{profiles.map(profile => <tr key={profile.id} className={profile.enabled ? "" : "profile-disabled"}><td><strong>{profile.label}</strong></td><td>{profile.hostname && <code>{profile.hostname}</code>}{profile.htmlSignature && <small title={profile.htmlSignature}>HTML: {profile.htmlSignature}</small>}</td><td><code>{profile.searchUrlTemplate}</code></td><td><span className={`profile-status ${profile.enabled ? "enabled" : "disabled"}`}>{profile.enabled ? "Enabled" : "Disabled"}</span></td><td><div className="profile-actions"><button className="edit-profile" onClick={() => editProfile(profile)}>Edit</button><button className="delete-profile" onClick={() => removeProfile(profile)}>Delete</button></div></td></tr>)}</tbody></table></div>}
    </section>
  </main>;
}
