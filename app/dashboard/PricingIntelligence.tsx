"use client";

import { useEffect, useMemo, useState } from "react";
import { APP_TIME_ZONE, formatAppDateTime } from "../../lib/time-zone";

export type IntelligenceProduct = {
  id: string;
  websiteUrl: string;
  productName: string;
  ean: string;
  status: string;
  reasonCode?: string | null;
  matchedUrl: string | null;
  priceCents: number | null;
  currency: string | null;
  inStock: boolean | null;
  confidenceScoresJson?: string | null;
  evidenceJson: string | null;
  lastCheckedAt: string | null;
};

type Snapshot = {
  id: string; capturedAt: string; priceCents: number; currency: string; inStock: boolean | null;
  matchedUrl: string; confidenceScores: { ean: number; name: number; price: number; source: number; overall: number };
};
type Schedule = {
  id: string; name: string; targetMode: "all" | "selected"; cadenceMinutes: number; enabled: boolean; nextRunAt: string;
  lastRunAt: string | null; lastOutcome: string | null;
};
type CustomerAlert = {
  id: string; alertType: string; state: string; message: string; detectedAt: string;
};

const REASON_LABELS: Record<string, string> = {
  captcha: "CAPTCHA", bot_wall: "Bot wall", login_wall: "Login required",
  js_challenge: "JavaScript challenge", wrong_product: "Wrong product", low_confidence: "Low confidence",
  price_missing: "Price missing", response_too_large: "Page too large", robots_disallowed: "Blocked by policy",
  known_bad_pattern: "Known bad page", profile_drift: "Profile drift", rate_limited: "Rate limited", timeout: "Timed out",
  stale_result: "Superseded scan",
};

export default function PricingIntelligence({ products, onProductsChanged }: { products: IntelligenceProduct[]; onProductsChanged: () => Promise<void> | void }) {
  const [view, setView] = useState<"compare" | "history" | "automation">("compare");
  const [historyProductId, setHistoryProductId] = useState("");
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [cadenceMinutes, setCadenceMinutes] = useState(360);
  const [notice, setNotice] = useState("");
  const [alerts, setAlerts] = useState<CustomerAlert[]>([]);

  const priced = useMemo(() => products.filter((product) => product.status === "found" && product.priceCents != null), [products]);
  const comparisonGroups = useMemo(() => {
    const groups = new Map<string, IntelligenceProduct[]>();
    for (const product of priced) groups.set(product.ean, [...(groups.get(product.ean) ?? []), product]);
    return [...groups.entries()].map(([ean, offers]) => ({ ean, offers })).filter((group) => group.offers.length > 1);
  }, [priced]);
  const historiedProducts = useMemo(() => products.filter((product) => product.lastCheckedAt), [products]);
  const selectedHistoryProductId = historyProductId || historiedProducts[0]?.id || "";
  const snapshotGroups = useMemo(() => {
    const groups = new Map<string, Snapshot[]>();
    for (const snapshot of snapshots) groups.set(snapshot.currency || "Unknown currency", [...(groups.get(snapshot.currency || "Unknown currency") ?? []), snapshot]);
    return [...groups.entries()];
  }, [snapshots]);

  useEffect(() => {
    fetch("/api/schedules", { headers: { Accept: "application/json" } })
      .then(async (response) => response.ok ? response.json() : Promise.reject(new Error("Scheduling is unavailable.")))
      .then((data: { schedules: Schedule[] }) => setSchedules(data.schedules))
      .catch(() => setSchedules([]));
  }, []);

  useEffect(() => {
    fetch("/api/alerts", { headers: { Accept: "application/json" } })
      .then(async (response) => response.ok ? response.json() : Promise.reject(new Error("Alerts are unavailable.")))
      .then((data: { alerts: CustomerAlert[] }) => setAlerts(data.alerts))
      .catch(() => setAlerts([]));
  }, [products]);

  useEffect(() => {
    if (view !== "history" || !selectedHistoryProductId) return;
    const controller = new AbortController();
    fetch(`/api/products/${selectedHistoryProductId}/history?limit=80`, { headers: { Accept: "application/json" }, signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as { snapshots?: Snapshot[]; error?: string };
        if (!response.ok) throw new Error(body.error || "History could not be loaded.");
        return body.snapshots ?? [];
      })
      .then(setSnapshots)
      .catch((error) => { if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : "History could not be loaded."); })
      .finally(() => { if (!controller.signal.aborted) setHistoryLoading(false); });
    return () => controller.abort();
  }, [selectedHistoryProductId, view]);

  async function createSchedule() {
    setScheduleLoading(true); setNotice("");
    try {
      const response = await fetch("/api/schedules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "All product monitoring", targetMode: "all", cadenceMinutes, timeZone: APP_TIME_ZONE, enabled: true }) });
      const body = await response.json() as { schedule?: Schedule; complete?: boolean; error?: string };
      if (!response.ok || !body.schedule) throw new Error(body.error || "Schedule could not be saved.");
      setSchedules((current) => [body.schedule!, ...current]); setNotice("Scheduled monitoring is active.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Schedule could not be saved."); }
    finally { setScheduleLoading(false); }
  }

  async function runSchedule(schedule: Schedule) {
    setScheduleLoading(true); setNotice("Running the scheduled checks fairly across domains…");
    try {
      const response = await fetch(`/api/schedules/${schedule.id}/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const body = await response.json() as { schedule?: Schedule; complete?: boolean; busy?: boolean; stale?: boolean; error?: string };
      if (!response.ok || !body.schedule) throw new Error(body.error || "Schedule could not run.");
      setSchedules((current) => current.map((item) => item.id === schedule.id ? body.schedule! : item));
      await onProductsChanged();
      setNotice(body.busy
        ? "This schedule is already running; no duplicate scan was started."
        : body.stale
          ? "Schedule ownership changed safely. The active scheduler will continue the remaining checks."
          : body.complete
            ? "Scheduled checks completed."
            : "The first fair batch completed; remaining products will continue automatically on upcoming scheduler ticks.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Schedule could not run."); }
    finally { setScheduleLoading(false); }
  }

  async function toggleSchedule(schedule: Schedule) {
    const response = await fetch(`/api/schedules/${schedule.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !schedule.enabled }) });
    const body = await response.json() as { schedule?: Schedule; error?: string };
    if (response.ok && body.schedule) setSchedules((current) => current.map((item) => item.id === schedule.id ? body.schedule! : item));
    else setNotice(body.error || "Schedule could not be updated.");
  }

  return <section className="intelligence-card" aria-labelledby="intelligence-title">
    <div className="intelligence-head">
      <div><span className="eyebrow">PRICING INTELLIGENCE</span><h2 id="intelligence-title">Compare, understand, and automate</h2><p>Verified offers stay separated by currency and stock status. History is saved after every confirmed price.</p></div>
      <div className="intelligence-actions"><a href="/api/exports?resource=products&format=csv">Products CSV</a><a href="/api/exports?resource=products&format=json">Products JSON</a><a href="/api/exports?resource=matches&format=csv">Matches CSV</a><a href="/api/exports?resource=price_history&format=csv">History CSV</a><a href="/api/exports?resource=price_history&format=json">History JSON</a></div>
    </div>
    <div className="intelligence-tabs" role="group" aria-label="Pricing intelligence views">
      {(["compare", "history", "automation"] as const).map((tab) => <button key={tab} aria-pressed={view === tab} className={view === tab ? "active" : ""} onClick={() => { if (tab === "history" && view !== "history" && selectedHistoryProductId) setHistoryLoading(true); setView(tab); }}>{tab === "compare" ? "Compare stores" : tab === "history" ? "Price history" : "Scheduled runs"}</button>)}
    </div>
    {alerts.length > 0 && <div className="customer-alert-list" aria-label="Recent price and stock alerts">
      <strong>Recent alerts</strong>
      {alerts.slice(0, 5).map((alert) => <article key={alert.id}><span className={`result-badge ${alert.state}`}>{alert.alertType.replaceAll("_", " ")}</span><p>{alert.message}</p><time>{formatAppDateTime(alert.detectedAt)}</time></article>)}
    </div>}

    {view === "compare" && <div className="compare-grid">
      {!comparisonGroups.length ? <div className="intelligence-empty"><strong>No multi-store comparison yet</strong><span>Add the same EAN on at least two websites to compare verified offers.</span></div> : comparisonGroups.map((group) => <article className="comparison-group" key={group.ean}>
        <div><strong>{group.offers[0].productName}</strong><code>EAN {group.ean}</code></div>
        {[...new Set(group.offers.map((offer) => offer.currency || "Unknown currency"))].map((currency) => {
          const offers = group.offers.filter((offer) => (offer.currency || "Unknown currency") === currency).sort((a, b) => stockRank(b.inStock) - stockRank(a.inStock) || (a.priceCents || Infinity) - (b.priceCents || Infinity));
          const cheapest = offers.find((offer) => offer.inStock === true);
          return <div className="currency-offers" key={currency}>{offers.map((offer) => <a key={offer.id} href={offer.matchedUrl || offer.websiteUrl} target="_blank" rel="noreferrer" className={offer.id === cheapest?.id ? "cheapest" : ""}>
            <span><b>{new URL(offer.websiteUrl).hostname.replace(/^www\./, "")}</b><small>{offer.inStock === false ? "Out of stock" : offer.inStock == null ? "Stock unknown" : offer.id === cheapest?.id ? "Cheapest available" : "In stock"}</small>{confidenceLabel(offer.confidenceScoresJson) && <small>{confidenceLabel(offer.confidenceScoresJson)}</small>}</span>
            <strong>{formatMoney(offer.priceCents, currency)}</strong>
          </a>)}</div>;
        })}
      </article>)}
    </div>}

    {view === "history" && <div className="history-panel">
      <label><span>Tracked product</span><select value={selectedHistoryProductId} onChange={(event) => { setHistoryLoading(true); setSnapshots([]); setHistoryProductId(event.target.value); }}>{historiedProducts.map((product) => <option key={product.id} value={product.id}>{product.productName} · {new URL(product.websiteUrl).hostname}</option>)}</select></label>
      {!selectedHistoryProductId ? <div className="intelligence-empty"><strong>No tracked history yet</strong><span>Run a product check to create its first observation.</span></div> : historyLoading ? <div className="intelligence-empty">Loading price history…</div> : !snapshots.length ? <div className="intelligence-empty"><strong>No snapshots yet</strong><span>A snapshot is saved after the next verified price check.</span></div> : <>
        {snapshotGroups.map(([currency, currencySnapshots]) => <section className="history-currency" key={currency}><h3>{currency}</h3><div className="history-bars" role="img" aria-label={`${currency} price history with ${currencySnapshots.length} observations`}>{[...currencySnapshots].reverse().map((snapshot) => {
          const prices = currencySnapshots.map((item) => item.priceCents); const min = Math.min(...prices); const max = Math.max(...prices); const height = max === min ? 55 : 18 + (snapshot.priceCents - min) / (max - min) * 70;
          return <i key={snapshot.id} style={{ height: `${height}%` }} title={`${formatMoney(snapshot.priceCents, snapshot.currency)} · ${formatAppDateTime(snapshot.capturedAt)}`}/>;
        })}</div><div className="snapshot-list">{currencySnapshots.slice(0, 12).map((snapshot) => <div key={snapshot.id}><time>{formatAppDateTime(snapshot.capturedAt)}</time><strong>{formatMoney(snapshot.priceCents, snapshot.currency)}</strong><span>{snapshot.inStock === false ? "Out of stock" : snapshot.inStock == null ? "Stock unknown" : "In stock"} · EAN {snapshot.confidenceScores.ean}% · name {snapshot.confidenceScores.name}% · price {snapshot.confidenceScores.price}% · source {snapshot.confidenceScores.source}%</span></div>)}</div></section>)}
      </>}
    </div>}

    {view === "automation" && <div className="automation-panel">
      <div className="schedule-create"><div><strong>Fair scheduled monitoring</strong><span>Runs are interleaved across domains and processed in leased batches, so one slow store cannot starve the rest.</span></div><label><span>Frequency</span><select value={cadenceMinutes} onChange={(event) => setCadenceMinutes(Number(event.target.value))}><option value={60}>Every hour</option><option value={360}>Every 6 hours</option><option value={720}>Twice daily</option><option value={1440}>Daily</option><option value={10080}>Weekly</option></select></label><button onClick={createSchedule} disabled={scheduleLoading || !products.length || schedules.some((schedule) => schedule.targetMode === "all")}>{schedules.some((schedule) => schedule.targetMode === "all") ? "Schedule exists" : "Create schedule"}</button></div>
      <div className="schedule-list">{schedules.map((schedule) => <article key={schedule.id}><div><strong>{schedule.name}</strong><span>{schedule.lastOutcome || "Not run yet"}</span><small>Next {formatAppDateTime(schedule.nextRunAt)}</small></div><button className={schedule.enabled ? "enabled" : ""} aria-label={`${schedule.enabled ? "Pause" : "Enable"} ${schedule.name}`} aria-pressed={schedule.enabled} onClick={() => toggleSchedule(schedule)}>{schedule.enabled ? "Enabled" : "Paused"}</button><button aria-label={`Run ${schedule.name} now`} onClick={() => runSchedule(schedule)} disabled={scheduleLoading}>Run now</button></article>)}</div>
    </div>}
    {notice && <p className="intelligence-notice" aria-live="polite">{notice}</p>}
    {products.some((product) => product.reasonCode && product.reasonCode !== "found") && <div className="reason-summary">Latest review reasons: {[...new Set(products.map((product) => product.reasonCode).filter((reason): reason is string => Boolean(reason) && reason !== "found"))].slice(0, 6).map((reason) => <span key={reason}>{reasonLabel(reason)}</span>)}</div>}
  </section>;
}

function formatMoney(priceCents: number | null, currency: string) {
  if (priceCents == null) return "—";
  if (!/^[A-Z]{3}$/.test(currency)) return `${(priceCents / 100).toLocaleString()} ${currency}`;
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(priceCents / 100);
}

function stockRank(value: boolean | null) { return value === true ? 2 : value == null ? 1 : 0; }

function confidenceLabel(value: string | null | undefined) {
  try {
    const scores = value ? JSON.parse(value) as Record<string, unknown> : null;
    if (!scores || !["ean", "name", "price", "source"].every((key) => typeof scores[key] === "number")) return "";
    return `EAN ${scores.ean}% · name ${scores.name}% · price ${scores.price}% · source ${scores.source}%`;
  } catch { return ""; }
}

function reasonLabel(value: string) {
  return REASON_LABELS[value] || (value.includes("_") ? value.replaceAll("_", " ") : "Access challenge");
}
