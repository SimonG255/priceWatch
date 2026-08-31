"use client";

import { useEffect, useState } from "react";

type ManagedUser = {
  ownerEmail: string;
  planKey: string;
  urlLimit: number;
  checksPerDay: number;
  subscriptionStatus: string;
  trialEndsAt: string;
  subscriptionExpiresAt: string | null;
  productCount: number;
  websiteCount: number;
  createdAt: string;
};

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json" } });
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error || "Request failed.");
  return body;
}

function expiryFor(user: ManagedUser) {
  return user.subscriptionStatus === "trial" ? user.trialEndsAt : user.subscriptionExpiresAt;
}

function timeRemaining(user: ManagedUser) {
  const expiry = expiryFor(user);
  if (!expiry) return "No expiry set";
  const milliseconds = Date.parse(expiry) - Date.now();
  const days = Math.ceil(Math.abs(milliseconds) / 86_400_000);
  return milliseconds >= 0 ? `${days} day${days === 1 ? "" : "s"} left` : `Expired ${days} day${days === 1 ? "" : "s"} ago`;
}

function localDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export default function SuperAdminPanel() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [editing, setEditing] = useState<ManagedUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function load() {
    setLoading(true);
    request<{ users: ManagedUser[] }>("/api/admin/users")
      .then(data => setUsers(data.users))
      .catch(err => setError(err instanceof Error ? err.message : "Users could not be loaded."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    request<{ users: ManagedUser[] }>("/api/admin/users")
      .then(data => setUsers(data.users))
      .catch(err => setError(err instanceof Error ? err.message : "Users could not be loaded."))
      .finally(() => setLoading(false));
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!editing) return;
    setSaving(true); setError("");
    try {
      await request("/api/admin/users", { method: "PATCH", body: JSON.stringify(editing) });
      setEditing(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "User plan could not be updated.");
    } finally {
      setSaving(false);
    }
  }

  return <section className="admin-card super-admin-card">
    <div className="admin-intro operations-title"><div><span className="editor-mode">SUPER ADMIN</span><h2>Users and subscriptions</h2><p>Review customer usage and subscription expiry. Editing is limited to validated plan and subscription fields; database credentials and arbitrary SQL are never exposed to the browser.</p></div><button onClick={load} disabled={loading}>{loading ? "Loading…" : "Refresh users"}</button></div>
    {error && <p className="admin-error" role="alert">{error}</p>}
    {loading ? <div className="admin-empty">Loading customer plans…</div> : !users.length ? <div className="admin-empty">No customer plans found.</div> : <div className="admin-table-wrap"><table className="super-admin-table"><thead><tr><th>User</th><th>Plan</th><th>Usage</th><th>Status</th><th>Subscription expiry</th><th>Remaining</th><th>Action</th></tr></thead><tbody>{users.map(user => <tr key={user.ownerEmail}><td><strong>{user.ownerEmail}</strong><small>Joined {new Date(user.createdAt).toLocaleDateString()}</small></td><td>{user.planKey}<small>{user.urlLimit.toLocaleString()} URLs · {user.checksPerDay}/day</small></td><td>{user.productCount} searches<small>{user.websiteCount} websites</small></td><td><span className={`subscription-status ${user.subscriptionStatus}`}>{user.subscriptionStatus.replace("_", " ")}</span></td><td>{expiryFor(user) ? new Date(expiryFor(user)!).toLocaleString() : "—"}</td><td>{timeRemaining(user)}</td><td><button className="edit-profile" onClick={() => setEditing({ ...user })}>Edit data</button></td></tr>)}</tbody></table></div>}
    {editing && <form className="super-admin-editor" onSubmit={save}>
      <div><span className="editor-mode">EDITING CUSTOMER DATA</span><h3>{editing.ownerEmail}</h3></div>
      <label><span>Plan</span><select value={editing.planKey} onChange={event => setEditing({ ...editing, planKey: event.target.value })}><option value="starter">Starter</option><option value="business">Business</option><option value="pro">Pro</option><option value="custom">Custom</option></select></label>
      <label><span>Subscription status</span><select value={editing.subscriptionStatus} onChange={event => setEditing({ ...editing, subscriptionStatus: event.target.value })}><option value="trial">Trial</option><option value="active">Active</option><option value="past_due">Past due</option><option value="expired">Expired</option><option value="cancelled">Cancelled</option></select></label>
      <label><span>URL limit</span><input type="number" min="1" max="5000" required value={editing.urlLimit} onChange={event => setEditing({ ...editing, urlLimit: Number(event.target.value) })}/></label>
      <label><span>Checks per day</span><input type="number" min="1" max="24" required value={editing.checksPerDay} onChange={event => setEditing({ ...editing, checksPerDay: Number(event.target.value) })}/></label>
      <label><span>Trial ends</span><input type="datetime-local" required value={localDateTime(editing.trialEndsAt)} onChange={event => setEditing({ ...editing, trialEndsAt: new Date(event.target.value).toISOString() })}/></label>
      <label><span>Paid subscription expires</span><input type="datetime-local" value={localDateTime(editing.subscriptionExpiresAt)} onChange={event => setEditing({ ...editing, subscriptionExpiresAt: event.target.value ? new Date(event.target.value).toISOString() : null })}/></label>
      <div className="admin-form-actions"><button disabled={saving}>{saving ? "Saving…" : "Save database changes"}</button><button type="button" className="cancel-edit" onClick={() => setEditing(null)}>Cancel</button></div>
    </form>}
  </section>;
}
