"use client";

import { useEffect, useState } from "react";
import ScraperOperations from "./ScraperOperations";
import { formatAppDateTime } from "../../lib/time-zone";

type Profile = {
  id: string;
  label: string;
  hostname: string;
  htmlSignature: string;
  searchUrlTemplate: string;
  productSelector: string;
  eanSelector: string;
  priceSelector: string;
  jsonLdEanFields: string;
  jsonLdPriceFields: string;
  jsonLdCurrencyFields: string;
  blockPatterns: string;
  allowRenderedFallback: boolean;
  cookieConsentSelector: string;
  enabled: boolean;
  siteType: "auto" | "standard" | "slow" | "large" | "javascript" | "marketplace";
  timeoutMs: number | null;
  maxPageBytes: number | null;
  retryBudget: number | null;
  healthScore: number;
  driftStatus: string;
  lastSeenWorkingAt: string | null;
  createdAt: string;
};

type UsedWebsite = { hostname: string };

type AdminDataResponse = {
  profiles: Profile[];
  websites: UsedWebsite[];
  health: ScraperHealth[];
  warnings?: string[];
};

type ScraperHealth = {
  hostname: string;
  consecutiveFailures: number;
  totalChecks: number;
  blockedChecks: number;
  unavailableChecks: number;
  needsReviewChecks: number;
  lastOutcome: string | null;
  lastProfileId: string | null;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  backoffUntil: string | null;
};

type ProfileForm = Omit<Profile, "id" | "createdAt" | "healthScore" | "driftStatus" | "lastSeenWorkingAt">;

type ProfileTestResponse = {
  result: {
    status: string;
    message: string;
    reasonCode?: string;
    matchedUrl?: string;
    profileHealth?: { score: number; status: string; signatureMatched?: boolean; selectorSuggestions?: string[] };
    confidenceScores?: { ean: number; name: number; price: number; source: number; overall: number };
    evidence?: { canonicalUrl?: string };
  };
  attempts: Array<{ url: string; outcome: string; reasonCode: string; httpStatus?: number | null; durationMs: number }>;
  profileHealth: ProfileTestResponse["result"]["profileHealth"] | null;
};

type SystemHealth = {
  checkedAt: string;
  database: { status: string; connected: boolean; missingTables: string[]; missingColumns: string[]; error?: string };
  migrations: { status: string; pending: string[]; applied: string[] };
  ai: { status: string; configured: boolean };
  renderer: { status: string; configured: boolean };
  lastFailedScan: { hostname?: string; status?: string; reasonCode?: string; message?: string; startedAt?: string } | null;
};

const emptyProfile: ProfileForm = {
  label: "",
  hostname: "",
  htmlSignature: "",
  searchUrlTemplate: "",
  productSelector: "",
  eanSelector: "",
  priceSelector: "",
  jsonLdEanFields: "",
  jsonLdPriceFields: "",
  jsonLdCurrencyFields: "",
  blockPatterns: "",
  allowRenderedFallback: false,
  cookieConsentSelector: "",
  enabled: true,
  siteType: "auto",
  timeoutMs: null,
  maxPageBytes: null,
  retryBudget: null,
};

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json" } });
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error || "Request failed.");
  return body;
}

function normalizedHostname(value: string) {
  return value.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
}

function profileMatchesWebsite(profile: Profile, websiteHostname: string) {
  const configuredHostname = normalizedHostname(profile.hostname);
  const usedHostname = normalizedHostname(websiteHostname);
  return Boolean(configuredHostname) && (
    configuredHostname === usedHostname
    || configuredHostname.endsWith(`.${usedHostname}`)
    || usedHostname.endsWith(`.${configuredHostname}`)
  );
}

function outcomeLabel(value: string | null) {
  if (!value) return "No checks yet";
  if (value === "not_found") return "Not found";
  if (value === "needs_review") return "Needs review";
  if (value === "unavailable") return "Temporarily unavailable";
  return value;
}

function checkedLabel(value: string | null) {
  return value ? formatAppDateTime(value) : "Never";
}

export default function AdminClient({ email, aiConfigured }: { email: string; aiConfigured: boolean }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [websites, setWebsites] = useState<UsedWebsite[]>([]);
  const [health, setHealth] = useState<ScraperHealth[]>([]);
  const [form, setForm] = useState<ProfileForm>(emptyProfile);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [testUrl, setTestUrl] = useState("");
  const [testName, setTestName] = useState("");
  const [testEan, setTestEan] = useState("");
  const [testResult, setTestResult] = useState<ProfileTestResponse | null>(null);
  const [testing, setTesting] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [systemHealth, setSystemHealth] = useState<SystemHealth | null>(null);
  const [systemHealthLoading, setSystemHealthLoading] = useState(false);

  async function refreshSystemHealth() {
    setSystemHealthLoading(true);
    try {
      setSystemHealth(await request<SystemHealth>("/api/admin/system-health", { headers: { Accept: "application/json" } }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "System health could not be loaded.");
    } finally {
      setSystemHealthLoading(false);
    }
  }

  useEffect(() => {
    request<AdminDataResponse>("/api/admin/search-profiles")
      .then(data => {
        setProfiles(data.profiles);
        setWebsites(data.websites);
        setHealth(data.health);
        setWarnings(data.warnings ?? []);
      })
      .catch(err => setError(err.message));
    request<SystemHealth>("/api/admin/system-health", { headers: { Accept: "application/json" } })
      .then(setSystemHealth)
      .catch(err => setError(err instanceof Error ? err.message : "System health could not be loaded."));
  }, []);

  function change<K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) {
    setForm(current => ({ ...current, [key]: value }));
  }

  function resetForm() {
    setForm(emptyProfile);
    setEditingId(null);
  }

  function editProfile(profile: Profile) {
    setEditingId(profile.id);
    setForm({
      label: profile.label,
      hostname: profile.hostname,
      htmlSignature: profile.htmlSignature,
      searchUrlTemplate: profile.searchUrlTemplate,
      productSelector: profile.productSelector,
      eanSelector: profile.eanSelector,
      priceSelector: profile.priceSelector,
      jsonLdEanFields: profile.jsonLdEanFields,
      jsonLdPriceFields: profile.jsonLdPriceFields,
      jsonLdCurrencyFields: profile.jsonLdCurrencyFields,
      blockPatterns: profile.blockPatterns,
      allowRenderedFallback: profile.allowRenderedFallback,
      cookieConsentSelector: profile.cookieConsentSelector || "",
      enabled: profile.enabled,
      siteType: profile.siteType || "auto",
      timeoutMs: profile.timeoutMs,
      maxPageBytes: profile.maxPageBytes,
      retryBudget: profile.retryBudget,
    });
    setTestResult(null);
    setError("");
    document.getElementById("profile-editor")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function configureWebsite(websiteHostname: string) {
    resetForm();
    setForm({ ...emptyProfile, label: `${websiteHostname} search`, hostname: websiteHostname, searchUrlTemplate: "/search?q={query}" });
    setError("");
    document.getElementById("profile-editor")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const url = editingId ? `/api/admin/search-profiles/${editingId}` : "/api/admin/search-profiles";
      const { profile } = await request<{ profile: Profile }>(url, {
        method: editingId ? "PATCH" : "POST",
        body: JSON.stringify(form),
      });
      setProfiles(current => editingId ? current.map(item => item.id === profile.id ? profile : item) : [profile, ...current]);
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Profile could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function removeProfile(profile: Profile) {
    if (!window.confirm(`Delete ${profile.label}?`)) return;
    try {
      await request(`/api/admin/search-profiles/${profile.id}`, { method: "DELETE" });
      setProfiles(current => current.filter(item => item.id !== profile.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Profile could not be deleted.");
    }
  }

  async function testProfile() {
    if (!testUrl.trim()) {
      setError("Enter the public URL to use for the profile test.");
      return;
    }
    if (testName.trim().length < 2) {
      setError("Enter the product name used for the test.");
      return;
    }
    if (![8, 12, 13, 14].includes(testEan.length)) {
      setError("Enter an 8, 12, 13, or 14 digit EAN/GTIN.");
      return;
    }
    setTesting(true);
    setError("");
    setTestResult(null);
    try {
      setTestResult(await request<ProfileTestResponse>("/api/admin/search-profiles/test", {
        method: "POST",
        body: JSON.stringify({ url: testUrl, productName: testName, ean: testEan, profile: form }),
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Profile test failed.");
    } finally {
      setTesting(false);
    }
  }

  return <main className="admin-page">
    <header><a href="/dashboard">← Dashboard</a><div><span>PRICEWATCH ADMIN</span><h1>Website search profiles</h1><p>Signed in as {email}</p></div></header>
    <section className={`ai-status ${aiConfigured ? "ready" : "missing"}`}><strong>AI-assisted review: {aiConfigured ? "Ready" : "API key required"}</strong><span>{aiConfigured ? "AI reviews every result against the selected store and searches for a replacement when needed. PriceWatch verifies every candidate page." : "Add OPENAI_API_KEY to the Site runtime settings to enable AI review and recovery. Normal website search remains active."}</span></section>

    {warnings.map(warning => <p className="admin-warning" role="status" key={warning}>{warning}</p>)}
    <section className="admin-card system-health-card">
      <div className="admin-intro system-health-head"><div><span className="editor-mode">SYSTEM HEALTH</span><h2>Setup and diagnostics</h2><p>These checks are read-only. They show whether the database schema and optional AI/renderer services are ready for scans.</p></div><button className="health-refresh" onClick={refreshSystemHealth} disabled={systemHealthLoading}>{systemHealthLoading ? "Checking…" : "Refresh checks"}</button></div>
      {!systemHealth ? <div className="admin-empty">Loading system health…</div> : <>
        <div className="system-health-grid">
          <HealthCard label="Database" status={systemHealth.database.status} detail={systemHealth.database.connected ? "Connection accepted" : systemHealth.database.error || "Connection unavailable"}/>
          <HealthCard label="Migrations" status={systemHealth.migrations.status} detail={systemHealth.migrations.pending.length ? `${systemHealth.migrations.pending.length} pending` : "Schema is up to date"}/>
          <HealthCard label="AI review" status={systemHealth.ai.status} detail={systemHealth.ai.configured ? "OpenAI key configured" : "Optional OPENAI_API_KEY is missing"}/>
          <HealthCard label="Renderer" status={systemHealth.renderer.status} detail={systemHealth.renderer.configured ? "Endpoint and token configured" : "Optional renderer is not configured"}/>
        </div>
        {(systemHealth.database.missingTables.length > 0 || systemHealth.database.missingColumns.length > 0 || systemHealth.migrations.pending.length > 0) && <div className="system-health-details"><strong>Action needed</strong><span>{systemHealth.database.missingTables.length > 0 && `Missing tables: ${systemHealth.database.missingTables.join(", ")}. `}{systemHealth.database.missingColumns.length > 0 && `Missing columns: ${systemHealth.database.missingColumns.join(", ")}. `}{systemHealth.migrations.pending.length > 0 && `Run npm run db:migrate (${systemHealth.migrations.pending.join(", ")}).`}</span></div>}
        <div className="last-failed-scan"><strong>Last failed scan</strong>{systemHealth.lastFailedScan ? <span>{systemHealth.lastFailedScan.hostname || "Unknown site"} · {systemHealth.lastFailedScan.status || "failed"} · {systemHealth.lastFailedScan.reasonCode || "no reason code"} · {systemHealth.lastFailedScan.startedAt ? formatAppDateTime(systemHealth.lastFailedScan.startedAt) : "unknown time"}<small>{systemHealth.lastFailedScan.message || "No explanation recorded."}</small></span> : <span>No blocked, unavailable, review, or error scan has been recorded.</span>}</div>
      </>}
    </section>
    <ScraperOperations/>

    <section className="admin-card website-inventory">
      <div className="admin-intro"><h2>Websites in use across customer accounts</h2><p>These are the website hostnames currently submitted by customers. Customer names, product details, and full URLs are not shown here. Edit a matching profile, or configure a new one for a website that needs a different search route or extraction rule.</p></div>
      {!websites.length ? <div className="admin-empty">No customer websites have been added yet.</div> : <div className="admin-table-wrap"><table><thead><tr><th>Website</th><th>Profiles that cover it</th><th>Actions</th></tr></thead><tbody>{websites.map(website => {
        const matchingProfiles = profiles.filter(profile => profileMatchesWebsite(profile, website.hostname));
        return <tr key={website.hostname}><td><code>{website.hostname}</code></td><td>{matchingProfiles.length ? <div className="profile-actions">{matchingProfiles.map(profile => <button key={profile.id} className="edit-profile" onClick={() => editProfile(profile)}>Edit {profile.label}</button>)}</div> : <small>No hostname profile yet</small>}</td><td><div className="profile-actions"><button className="edit-profile" onClick={() => configureWebsite(website.hostname)}>{matchingProfiles.length ? "Add another profile" : "Configure profile"}</button></div></td></tr>;
      })}</tbody></table></div>}
    </section>

    <section className="admin-card scraper-health">
      <div className="admin-intro"><h2>Extraction health by website</h2><p>Use these public-check outcomes to spot profiles that need attention. A blocked or unavailable result is never treated as product absence, and no raw page content is retained here.</p></div>
      {!health.length ? <div className="admin-empty">No completed public checks yet.</div> : <div className="admin-table-wrap"><table><thead><tr><th>Website</th><th>Latest outcome</th><th>Checks</th><th>Failures</th><th>Last checked</th><th>Actions</th></tr></thead><tbody>{health.map(item => {
        const matchingProfiles = profiles.filter(profile => profileMatchesWebsite(profile, item.hostname));
        return <tr key={item.hostname}><td><code>{item.hostname}</code></td><td><span className={`health-status ${item.lastOutcome || "unknown"}`}>{outcomeLabel(item.lastOutcome)}</span>{item.backoffUntil && <small>Cooldown until {checkedLabel(item.backoffUntil)}</small>}</td><td>{item.totalChecks}</td><td><small>{item.consecutiveFailures} current · {item.blockedChecks} blocked · {item.unavailableChecks} unavailable · {item.needsReviewChecks} review</small></td><td>{checkedLabel(item.lastCheckedAt)}</td><td><div className="profile-actions">{matchingProfiles.length ? matchingProfiles.map(profile => <button key={profile.id} className="edit-profile" onClick={() => editProfile(profile)}>Edit {profile.label}</button>) : <button className="edit-profile" onClick={() => configureWebsite(item.hostname)}>Configure profile</button>}</div></td></tr>;
      })}</tbody></table></div>}
    </section>

    <section className={`admin-card ${editingId ? "editing" : ""}`} id="profile-editor">
      <div className="admin-intro"><span className="editor-mode">{editingId ? "EDITING WEBSITE" : "NEW WEBSITE"}</span><h2>{editingId ? "Edit website search profile" : "Add a website search profile"}</h2><p>Use a hostname for a specific store, an HTML signature for a shared platform, or both. The search URL must contain <code>{"{query}"}</code>. Extraction hints are optional and only help verify product data already present on the page.</p></div>
      <form onSubmit={saveProfile} className="admin-form">
        <label><span>Profile name</span><input required maxLength={80} value={form.label} onChange={event => change("label", event.target.value)} placeholder="Example Store search"/></label>
        <label><span>Website hostname <small>optional if HTML is provided</small></span><input value={form.hostname} onChange={event => change("hostname", event.target.value)} placeholder="store.example.com"/></label>
        <label className="full"><span>HTML signature <small>up to 500 characters from the submitted website page source</small></span><textarea maxLength={500} value={form.htmlSignature} onChange={event => change("htmlSignature", event.target.value)} placeholder={'data-platform="example-store" or a distinctive script URL'}/></label>
        <label className="full"><span>Search URL template</span><input required maxLength={500} value={form.searchUrlTemplate} onChange={event => change("searchUrlTemplate", event.target.value)} placeholder="/search?q={query}"/></label>
        <details className="profile-advanced full"><summary>Advanced extraction and safety settings</summary><p>Use only the simple selector and JSON field formats shown. Product data must still have an exact EAN and verified current price before it is saved.</p><div className="advanced-grid">
          <label><span>Product container selector <small>example: .product-card</small></span><input maxLength={180} value={form.productSelector} onChange={event => change("productSelector", event.target.value)} placeholder=".product-card"/></label>
          <label><span>EAN selector <small>example: [data-ean]</small></span><input maxLength={180} value={form.eanSelector} onChange={event => change("eanSelector", event.target.value)} placeholder="[data-ean]"/></label>
          <label><span>Price selector <small>example: [itemprop=price]</small></span><input maxLength={180} value={form.priceSelector} onChange={event => change("priceSelector", event.target.value)} placeholder="[itemprop=price]"/></label>
          <label><span>Site type</span><select value={form.siteType} onChange={event => change("siteType", event.target.value as ProfileForm["siteType"])}><option value="auto">Automatic</option><option value="standard">Standard store</option><option value="slow">Slow store</option><option value="large">Large pages</option><option value="javascript">JavaScript-heavy</option><option value="marketplace">Marketplace</option></select></label>
          <label><span>Page timeout <small>milliseconds, 3,000–30,000</small></span><input type="number" min={3000} max={30000} step={500} value={form.timeoutMs ?? ""} onChange={event => change("timeoutMs", event.target.value ? Number(event.target.value) : null)} placeholder="Automatic"/></label>
          <label><span>Page size cap <small>bytes, 256,000–8,000,000</small></span><input type="number" min={256000} max={8000000} step={64000} value={form.maxPageBytes ?? ""} onChange={event => change("maxPageBytes", event.target.value ? Number(event.target.value) : null)} placeholder="Automatic"/></label>
          <label><span>Retry budget <small>0–4 retries per candidate</small></span><input type="number" min={0} max={4} value={form.retryBudget ?? ""} onChange={event => change("retryBudget", event.target.value === "" ? null : Number(event.target.value))} placeholder="Automatic"/></label>
          <label><span>JSON-LD EAN fields <small>comma-separated, e.g. gtin13, barcode</small></span><input maxLength={500} value={form.jsonLdEanFields} onChange={event => change("jsonLdEanFields", event.target.value)} placeholder="gtin13, barcode"/></label>
          <label><span>JSON-LD price fields <small>comma-separated, e.g. offers.price</small></span><input maxLength={500} value={form.jsonLdPriceFields} onChange={event => change("jsonLdPriceFields", event.target.value)} placeholder="offers.price"/></label>
          <label><span>JSON-LD currency fields <small>comma-separated, e.g. offers.priceCurrency</small></span><input maxLength={500} value={form.jsonLdCurrencyFields} onChange={event => change("jsonLdCurrencyFields", event.target.value)} placeholder="offers.priceCurrency"/></label>
          <label className="full"><span>Block or challenge markers <small>one literal phrase per line</small></span><textarea maxLength={1000} value={form.blockPatterns} onChange={event => change("blockPatterns", event.target.value)} placeholder={"challenge page\nplease verify you are human"}/></label>
          <label className="enabled-control renderer-control"><input type="checkbox" checked={form.allowRenderedFallback} onChange={event => { const enabled = event.target.checked; change("allowRenderedFallback", enabled); if (!enabled) change("cookieConsentSelector", ""); }}/><span>Allow the approved server-side renderer when normal HTML has no product data <small>Requires a separately configured permitted renderer. It is never used to bypass CAPTCHA, login, or rate limits.</small></span></label>
          <label className="full"><span>Cookie consent button selector <small>optional; only used by the approved renderer</small></span><input maxLength={180} disabled={!form.allowRenderedFallback} value={form.cookieConsentSelector} onChange={event => change("cookieConsentSelector", event.target.value)} placeholder=".accept-all-cookies"/><small className="field-help">Use a simple selector for the site&apos;s explicit “Accept all cookies” button. The renderer must verify the button text before clicking it.</small></label>
        </div></details>
        <label className="enabled-control"><input type="checkbox" checked={form.enabled} onChange={event => change("enabled", event.target.checked)}/><span>Enabled for product searches</span></label>
        <div className="admin-form-actions"><button disabled={saving} type="submit">{saving ? "Saving…" : editingId ? "Save website changes" : "Add website profile"}</button>{editingId && <button className="cancel-edit" disabled={saving} type="button" onClick={resetForm}>Cancel</button>}</div>
      </form>
      <div className="profile-test-panel">
        <div><strong>Test before saving</strong><small>Runs the draft profile against one public URL using live robots, cooldown, timeout, and size budgets. It does not save the result.</small></div>
        <div className="profile-test-inputs"><label><span>Public test URL</span><input type="url" value={testUrl} onChange={event => { setTestUrl(event.target.value); setError(""); }} placeholder="https://store.example/product-or-search"/></label><label><span>Expected product</span><input value={testName} onChange={event => { setTestName(event.target.value); setError(""); }} placeholder="Product name"/></label><label><span>EAN / GTIN</span><input inputMode="numeric" value={testEan} onChange={event => { setTestEan(event.target.value.replace(/\D/g, "")); setError(""); }} placeholder="EAN / GTIN"/></label><button type="button" disabled={testing || !testUrl.trim() || !testName.trim() || !testEan} onClick={testProfile}>{testing ? "Testing…" : "Run profile test"}</button></div>
        {testResult && <div className={`profile-test-result ${testResult.result.status}`}><div><span className={`health-status ${testResult.result.status}`}>{testResult.result.status.replaceAll("_", " ")}</span><strong>{testResult.result.message}</strong></div><small>Reason: {testResult.result.reasonCode || "none"} · profile health: {(testResult.profileHealth ?? testResult.result.profileHealth)?.score ?? "—"}{(testResult.profileHealth ?? testResult.result.profileHealth) ? "%" : ""}{testResult.result.confidenceScores ? ` · confidence: ${testResult.result.confidenceScores.overall}%` : ""}</small>{(testResult.result.matchedUrl || testResult.result.evidence?.canonicalUrl) && <a href={testResult.result.matchedUrl || testResult.result.evidence?.canonicalUrl} target="_blank" rel="noreferrer">Open matched page</a>}<details><summary>{testResult.attempts.length} audited attempts</summary><ol>{testResult.attempts.map((attempt, index) => <li key={`${attempt.url}-${index}`}><code>{attempt.url}</code><span>{attempt.reasonCode} · {attempt.httpStatus ?? "no HTTP status"} · {attempt.durationMs} ms</span></li>)}</ol></details></div>}
      </div>
      {error && <p className="admin-error" role="alert">{error}</p>}
    </section>

    <section className="admin-card"><div className="admin-intro"><h2>Existing website profiles</h2><p>Update a website whenever its search route, HTML, structured data fields, or block markers change. Enabled profiles are applied before built-in routes and generic fallbacks.</p></div>
      {!profiles.length ? <div className="admin-empty">No custom website profiles yet.</div> : <div className="admin-table-wrap"><table><thead><tr><th>Name</th><th>Match</th><th>Search URL</th><th>Extraction</th><th>Status</th><th>Actions</th></tr></thead><tbody>{profiles.map(profile => <tr key={profile.id} className={profile.enabled ? "" : "profile-disabled"}><td><strong>{profile.label}</strong><small>{profile.healthScore}% health · {profile.driftStatus}</small></td><td>{profile.hostname && <code>{profile.hostname}</code>}{profile.htmlSignature && <small title={profile.htmlSignature}>HTML: {profile.htmlSignature}</small>}</td><td><code>{profile.searchUrlTemplate}</code></td><td><small>{[profile.productSelector && "selector", profile.jsonLdEanFields && "JSON-LD", profile.blockPatterns && "block markers", profile.allowRenderedFallback && "renderer", profile.cookieConsentSelector && "cookie consent"].filter(Boolean).join(" · ") || "Automatic"}</small></td><td><span className={`profile-status ${profile.enabled ? "enabled" : "disabled"}`}>{profile.enabled ? "Enabled" : "Auto-disabled / disabled"}</span>{!profile.enabled && profile.driftStatus === "drifted" && <small>Disabled after profile drift or repeated failures.</small>}</td><td><div className="profile-actions"><button className="edit-profile" onClick={() => editProfile(profile)}>Edit</button><button className="delete-profile" onClick={() => removeProfile(profile)}>Delete</button></div></td></tr>)}</tbody></table></div>}
    </section>
  </main>;
}

function HealthCard({ label, status, detail }: { label: string; status: string; detail: string }) {
  const good = status === "healthy" || status === "up_to_date" || status === "ready" || status === "configured";
  return <article className={`system-health-card-item ${good ? "good" : "attention"}`}><span>{label}</span><strong>{status.replaceAll("_", " ")}</strong><small>{detail}</small></article>;
}
