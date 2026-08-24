"use client";

import { useCallback, useEffect, useState } from "react";

type Domain = {
  hostname: string; totalChecks: number; successfulChecks: number; notFoundChecks: number;
  blockedChecks: number; unavailableChecks: number; needsReviewChecks: number; consecutiveFailures: number;
  lastOutcome: string | null; lastReasonCode: string | null; failureClass: string | null;
  lastChallengeType: string | null; backoffUntil: string | null; lastCheckedAt: string | null;
  successRate: number; averageResponseMs: number | null; healthScore: number;
};
type Run = { id: string; hostname: string; trigger: string; profileId: string | null; status: string; reasonCode: string | null; failureClass: string | null; challengeType: string | null; message: string | null; durationMs: number | null; attemptCount: number; startedAt: string };
type Profile = { id: string; label: string; hostname: string; healthScore: number; driftStatus: string; lastSeenWorkingAt: string | null; updatedAt: string; selectorSuggestionsJson: string | null };
type Operations = {
  generatedAt: string;
  summary: { runs: number; operationalSuccessRate: number; matchRate: number; blockedRate: number; unavailableRate: number; medianResponseMs: number | null };
  domains: Domain[]; profiles: Profile[]; needsReview: Run[]; recentRuns: Run[];
  alerting: { slackConfigured: boolean; emailConfigured: boolean };
};

const REASONS: Record<string, string> = {
  cloudflare: "Cloudflare challenge", captcha: "CAPTCHA", bot_wall: "Bot wall", login_wall: "Login wall", js_challenge: "JavaScript challenge",
  wrong_product: "Wrong product", low_confidence: "Low confidence", price_missing: "Price missing", rate_limited: "Rate limited", timeout: "Timed out",
  response_too_large: "Page too large", robots_disallowed: "Robots/policy block", known_bad_pattern: "Known bad page", profile_drift: "Profile drift",
  stale_result: "Superseded scan",
};

export default function ScraperOperations() {
  const [data, setData] = useState<Operations | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [retestProcessedIds, setRetestProcessedIds] = useState<string[]>([]);
  const [retestLastHostname, setRetestLastHostname] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [badHost, setBadHost] = useState("");
  const [badPattern, setBadPattern] = useState("");
  const [badReason, setBadReason] = useState("");
  const [policyHost, setPolicyHost] = useState("");
  const [policyMode, setPolicyMode] = useState<"allow" | "block">("allow");
  const [alertHost, setAlertHost] = useState("");
  const [alertChannel, setAlertChannel] = useState<"slack" | "email">("slack");
  const [alertSuccessRate, setAlertSuccessRate] = useState(80);
  const [alertFailures, setAlertFailures] = useState(3);

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/scraper/dashboard", { headers: { Accept: "application/json" } });
    const body = await response.json() as Operations & { error?: string };
    if (!response.ok) throw new Error(body.error || "Operations data could not be loaded.");
    return body;
  }, []);

  useEffect(() => { load().then(setData).catch((error) => setNotice(error instanceof Error ? error.message : "Operations data could not be loaded.")); }, [load]);

  async function retestSelected() {
    setBusy(true); setNotice("Retesting selected domains with live cooldowns and fair ordering…");
    try {
      let processedIds = retestProcessedIds;
      let completed = 0;
      let remaining = 0;
      let complete = false;
      let lastHostname = retestLastHostname;
      for (let requestIndex = 0; requestIndex < 25; requestIndex += 1) {
        const response = await fetch("/api/admin/scraper/retest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hostnames: selected, processedIds, lastHostname }),
        });
        const body = await response.json() as { completed?: unknown[]; continuation?: string[]; complete?: boolean; remaining?: number; lastHostname?: string; error?: string };
        if (!response.ok) throw new Error(body.error || "Retest failed.");
        completed += body.completed?.length ?? 0;
        processedIds = body.continuation ?? processedIds;
        remaining = body.remaining ?? 0;
        complete = body.complete === true;
        lastHostname = body.lastHostname ?? lastHostname;
        setNotice(`Retested ${completed} product${completed === 1 ? "" : "s"} in bounded requests…`);
        if (complete) break;
      }
      if (complete) {
        setRetestProcessedIds([]); setRetestLastHostname(""); setSelected([]);
        setNotice(`${processedIds.length} checks completed or respected an active cooldown.`);
      } else {
        setRetestProcessedIds(processedIds);
        setRetestLastHostname(lastHostname);
        setNotice(`${completed} more checks completed; ${remaining} matching products remain. Continue when ready.`);
      }
      setData(await load());
    } catch (error) { setNotice(error instanceof Error ? error.message : "Retest failed."); }
    finally { setBusy(false); }
  }

  async function addKnownBad(event: React.FormEvent) {
    event.preventDefault(); setBusy(true);
    try {
      const response = await fetch("/api/admin/scraper/known-bad-patterns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hostname: badHost, urlPattern: badPattern, reason: badReason }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "Rule could not be saved.");
      setBadPattern(""); setBadReason(""); setNotice("Known-bad rule saved. Matching pages will be skipped before extraction.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Rule could not be saved."); }
    finally { setBusy(false); }
  }

  async function savePolicy(event: React.FormEvent) {
    event.preventDefault(); setBusy(true);
    try {
      const response = await fetch("/api/admin/scraper/domain-policies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hostname: policyHost, accessMode: policyMode }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "Policy could not be saved.");
      setNotice(`Domain policy saved. robots.txt remains respected for ${policyHost}.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Policy could not be saved."); }
    finally { setBusy(false); }
  }

  async function saveAlertRule(event: React.FormEvent) {
    event.preventDefault(); setBusy(true);
    try {
      const response = await fetch("/api/admin/scraper/alert-rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hostname: alertHost, channel: alertChannel, minimumSuccessRate: alertSuccessRate, maximumConsecutiveFailures: alertFailures, minimumChecks: 5, cooldownMinutes: 60 }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "Alert rule could not be saved.");
      setNotice(`Alert rule saved for ${alertHost || "all domains"}. Delivery uses the configured ${alertChannel} webhook.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Alert rule could not be saved."); }
    finally { setBusy(false); }
  }

  if (!data) return <section className="admin-card operations-loading">Loading scraper operations…{notice && <small>{notice}</small>}</section>;
  return <>
    <section className="operations-kpis" aria-label="Scraper operations summary">
      <article><span>Operational success</span><strong>{percent(data.summary.operationalSuccessRate)}</strong><small>{data.summary.runs} runs in the last 30 days</small></article>
      <article><span>Blocked rate</span><strong>{percent(data.summary.blockedRate)}</strong><small>Challenge and access-control outcomes</small></article>
      <article><span>Median response</span><strong>{data.summary.medianResponseMs == null ? "—" : `${data.summary.medianResponseMs.toLocaleString()} ms`}</strong><small>Completed scan duration</small></article>
      <article><span>Needs review</span><strong>{data.needsReview.length}</strong><small>Recent low-confidence or drifted runs</small></article>
    </section>

    <section className="admin-card operations-console">
      <div className="admin-intro operations-title"><div><span className="editor-mode">LIVE OPERATIONS</span><h2>Domain health and bulk retesting</h2><p>Operational success includes completed “not found” checks. A verified match is tracked separately from website availability.</p></div><button disabled={busy || !selected.length} onClick={retestSelected}>{retestProcessedIds.length ? "Continue retest" : "Retest selected"} ({selected.length})</button></div>
      <div className="admin-table-wrap"><table><thead><tr><th/><th>Domain</th><th>Health</th><th>Latest reason</th><th>Failures</th><th>Latency</th><th>Cooldown</th></tr></thead><tbody>{data.domains.map((domain) => <tr key={domain.hostname}>
        <td><input type="checkbox" aria-label={`Select ${domain.hostname}`} checked={selected.includes(domain.hostname)} onChange={() => { setRetestProcessedIds([]); setRetestLastHostname(""); setSelected((current) => current.includes(domain.hostname) ? current.filter((item) => item !== domain.hostname) : [...current, domain.hostname]); }}/></td>
        <td><code>{domain.hostname}</code><small>{domain.lastCheckedAt ? new Date(domain.lastCheckedAt).toLocaleString() : "Never checked"}</small></td>
        <td><span className={`health-score ${domain.successRate >= .8 ? "healthy" : domain.successRate >= .5 ? "degraded" : "critical"}`}>{percent(domain.successRate)}</span><small>{domain.totalChecks} checks</small></td>
        <td><span className={`health-status ${domain.lastOutcome || "unknown"}`}>{reasonLabel(domain.lastReasonCode || domain.lastOutcome)}</span><small>{domain.failureClass || "no failure"}{domain.lastChallengeType ? ` · ${domain.lastChallengeType}` : ""}</small></td>
        <td>{domain.consecutiveFailures}<small>{domain.blockedChecks} blocked · {domain.unavailableChecks} unavailable · {domain.needsReviewChecks} review</small></td>
        <td>{domain.averageResponseMs == null ? "—" : `${domain.averageResponseMs.toLocaleString()} ms`}</td>
        <td>{domain.backoffUntil && Date.parse(domain.backoffUntil) > Date.parse(data.generatedAt) ? new Date(domain.backoffUntil).toLocaleString() : "Ready"}</td>
      </tr>)}</tbody></table></div>
      {notice && <p className="operations-notice" aria-live="polite">{notice}</p>}
    </section>

    <div className="operations-columns">
      <section className="admin-card"><div className="admin-intro"><h2>Profile drift and recent changes</h2><p>Suggestions are review-only and are never saved automatically.</p></div><div className="profile-health-list">{data.profiles.slice(0, 12).map((profile) => <article key={profile.id}><div><strong>{profile.label}</strong><code>{profile.hostname || "HTML signature"}</code></div><span className={`profile-health ${profile.driftStatus}`}>{profile.healthScore}% · {profile.driftStatus}</span><small>Updated {new Date(profile.updatedAt).toLocaleString()}{profile.lastSeenWorkingAt ? ` · last verified ${new Date(profile.lastSeenWorkingAt).toLocaleDateString()}` : ""}</small>{profile.selectorSuggestionsJson && <details><summary>Selector suggestions</summary><code>{parseSuggestions(profile.selectorSuggestionsJson).join(" · ")}</code></details>}</article>)}</div></section>
      <section className="admin-card"><div className="admin-intro"><h2>Alerting and audit</h2><p>{data.alerting.slackConfigured || data.alerting.emailConfigured ? `Delivery ready: ${[data.alerting.slackConfigured && "Slack", data.alerting.emailConfigured && "email"].filter(Boolean).join(" and ")}.` : "Configure SLACK_WEBHOOK_URL or ALERT_EMAIL_WEBHOOK_URL in Site runtime settings to deliver threshold alerts."}</p></div><div className="audit-list">{data.recentRuns.slice(0, 12).map((run) => <article key={run.id}><span className={`health-status ${run.status}`}>{run.status}</span><div><strong>{run.hostname}</strong><small>{reasonLabel(run.reasonCode)} · {run.profileId || "automatic profile"} · {run.attemptCount} attempts</small></div><time>{run.durationMs == null ? "—" : `${run.durationMs} ms`} · {new Date(run.startedAt).toLocaleString()}</time></article>)}</div>{Boolean(data.needsReview.length) && <><h3 className="review-queue-title">Pages needing review</h3><div className="audit-list review-queue">{data.needsReview.slice(0, 8).map((run) => <article key={`review-${run.id}`}><span className="health-status needs_review">Review</span><div><strong>{run.hostname}</strong><small>{reasonLabel(run.reasonCode)} · {run.message || "Extraction needs an administrator decision"}</small></div><time>{new Date(run.startedAt).toLocaleString()}</time></article>)}</div></>}</section>
    </div>

    <section className="admin-card safety-rules"><div className="admin-intro"><h2>Safety rules</h2><p>Explicit domain blocks always win, robots.txt is always respected, and known-bad rules use bounded literal or * wildcard matching rather than executable regular expressions.</p></div><div className="safety-forms">
      <form onSubmit={savePolicy}><strong>Domain access</strong><label><span>Hostname</span><input required value={policyHost} onChange={(event) => setPolicyHost(event.target.value)} placeholder="store.example.com"/></label><label><span>Policy</span><select value={policyMode} onChange={(event) => setPolicyMode(event.target.value as "allow" | "block")}><option value="allow">Allow, subject to robots</option><option value="block">Block all checks</option></select></label><button disabled={busy}>Save policy</button></form>
      <form onSubmit={addKnownBad}><strong>Known-bad page pattern</strong><label><span>Hostname</span><input required value={badHost} onChange={(event) => setBadHost(event.target.value)} placeholder="store.example.com"/></label><label><span>URL literal or wildcard</span><input required value={badPattern} onChange={(event) => setBadPattern(event.target.value)} placeholder="*/bad-listing/*"/></label><label><span>Reason</span><input value={badReason} onChange={(event) => setBadReason(event.target.value)} placeholder="Consistently selects shipping price"/></label><button disabled={busy}>Add skip rule</button></form>
      <form onSubmit={saveAlertRule}><strong>Health alert threshold</strong><label><span>Hostname <small>blank means all domains</small></span><input value={alertHost} onChange={(event) => setAlertHost(event.target.value)} placeholder="store.example.com"/></label><label><span>Channel</span><select value={alertChannel} onChange={(event) => setAlertChannel(event.target.value as "slack" | "email")}><option value="slack">Slack webhook</option><option value="email">Email webhook</option></select></label><label><span>Minimum success rate (%)</span><input type="number" min={0} max={100} value={alertSuccessRate} onChange={(event) => setAlertSuccessRate(Number(event.target.value))}/></label><label><span>Consecutive failures</span><input type="number" min={1} max={100} value={alertFailures} onChange={(event) => setAlertFailures(Number(event.target.value))}/></label><button disabled={busy}>Create alert rule</button></form>
    </div></section>
  </>;
}

function percent(value: number) { return `${Math.round(value * 1000) / 10}%`; }
function reasonLabel(value: string | null) { return value ? REASONS[value] || value.replaceAll("_", " ") : "No failures"; }
function parseSuggestions(value: string) { try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; } }
