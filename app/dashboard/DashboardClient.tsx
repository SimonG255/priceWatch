"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import readXlsxFile from "read-excel-file";
import writeXlsxFile from "write-excel-file";
import { createClient as createSupabaseClient } from "../../lib/supabase/client";
import { formatAppDateTime } from "../../lib/time-zone";
import type { UserPlan } from "../../lib/plans";
import { WORLD_COUNTRIES } from "../../lib/countries";
import PricingIntelligence from "./PricingIntelligence";

type IconName = "grid" | "box" | "settings" | "plus" | "search" | "bolt" | "external" | "menu" | "close" | "upload" | "download" | "refresh" | "trash" | "file";
type Product = {
  id: string; websiteUrl: string; productName: string; ean: string; sku: string; notes: string;
  ownPriceCents: number | null; alertOnPriceDrop: boolean; alertOnRestock: boolean; alertTargetPriceCents: number | null; alertDropPercentBps: number | null; monitoringEnabled: boolean;
  status: "queued" | "searching" | "found" | "not_found" | "blocked" | "unavailable" | "needs_review" | "error";
  statusMessage: string; matchedUrl: string | null; resultTitle: string | null; priceCents: number | null;
  currency: string | null; inStock: boolean | null; matchType: string | null; confidence: string | null; evidenceJson: string | null; lastCheckedAt: string | null; createdAt: string;
  reasonCode?: string | null; failureClass?: string | null; challengeType?: string | null; confidenceScoresJson?: string | null; lastDurationMs?: number | null; lastScanId?: string | null;
};
type Website = { id: string; url: string; createdAt: string };
type ProductDraft = { id: string; productName: string; ean: string; sku: string; ownPrice: string };
type ProductGroup = { key: string; products: Product[]; primary: Product };
type PriceSnapshot = { id: string; capturedAt: string; priceCents: number; currency: string; inStock: boolean | null; matchedUrl: string; priceSource?: string | null };
type PriceSummary = { currency: string; minPriceCents: number | null; maxPriceCents: number | null; averagePriceCents: number | null; latestPriceCents: number | null; latestCapturedAt: string | null; changeCents: number | null; changePercent: number | null; observations: number };
type ScanRun = { id: string; status: string; reasonCode: string | null; message: string | null; startedAt: string; completedAt: string | null; durationMs: number | null; attemptCount: number; hostname: string };
type ScanAttempt = { id: string; url: string; outcome: string; reasonCode: string; message: string | null; durationMs: number; httpStatus: number | null };
type ProductHistoryState = { loading: boolean; snapshots: PriceSnapshot[]; summaryByCurrency: PriceSummary[]; latestRun: ScanRun | null; attempts: ScanAttempt[]; error: string };

const emptyDraft = (id = "product-1"): ProductDraft => ({ id, productName: "", ean: "", sku: "", ownPrice: "" });
const draftStoragePrefix = "nexus-product-drafts:";
const websiteSelectionStoragePrefix = "nexus-selected-websites:";

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    box: <><path d="M21 8 12 3 3 8l9 5 9-5Z"/><path d="m3 8 9 5 9-5v8l-9 5-9-5V8Z"/><path d="M12 13v8"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3A1.7 1.7 0 0 0 14 21v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
    plus: <path d="M12 5v14M5 12h14"/>, search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    bolt: <path d="m13 2-8 12h7l-1 8 8-12h-7l1-8Z"/>, external: <><path d="M14 3h7v7M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/></>,
    menu: <><path d="M4 7h16M4 12h16M4 17h16"/></>, close: <><path d="m6 6 12 12M18 6 6 18"/></>,
    upload: <><path d="M12 16V4M7 9l5-5 5 5"/><path d="M5 20h14"/></>, download: <><path d="M12 4v12M7 11l5 5 5-5"/><path d="M5 20h14"/></>,
    refresh: <><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></>, trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13"/></>,
    file: <><path d="M6 2h8l4 4v16H6z"/><path d="M14 2v5h5M9 12h6M9 16h6"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function CountrySelect({ value, onChange, helpText }: { value: string; onChange: (value: string) => void; helpText: string }) {
  return <label className="discovery-country-field"><span>Search country</span><select aria-label="Search country" value={value} onChange={event => onChange(event.target.value)}><option value="">Select a country...</option>{WORLD_COUNTRIES.map(country => <option key={country.code} value={country.code}>{country.name}</option>)}</select><small>{helpText}</small></label>;
}

async function jsonRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) } });
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error || "The request could not be completed.");
  return body;
}

export default function Dashboard({ displayName, email, plan, authProvider, isAdmin }: { displayName: string; email: string; plan: UserPlan; authProvider: "supabase" | "chatgpt"; isAdmin: boolean }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [websites, setWebsites] = useState<Website[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [menu, setMenu] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [siteFilter, setSiteFilter] = useState("");
  const [stockFilter, setStockFilter] = useState<"all" | "in" | "out" | "unknown">("all");
  const [scanStatusFilter, setScanStatusFilter] = useState("all");
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");
  const [priceDropsOnly, setPriceDropsOnly] = useState(false);
  const [needsAttention, setNeedsAttention] = useState(false);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [expandedProductKey, setExpandedProductKey] = useState<string | null>(null);
  const [historyByProduct, setHistoryByProduct] = useState<Record<string, ProductHistoryState>>({});
  const [selectedWebsiteIds, setSelectedWebsiteIds] = useState<string[]>([]);
  const [discoveryCountry, setDiscoveryCountry] = useState("");
  const [newWebsiteUrl, setNewWebsiteUrl] = useState("");
  const [productDrafts, setProductDrafts] = useState<ProductDraft[]>([emptyDraft()]);
  const [bulkProgress, setBulkProgress] = useState("");
  const [discoveringWebsites, setDiscoveringWebsites] = useState(false);
  const [discoveryProgress, setDiscoveryProgress] = useState("");
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [websiteSelectionHydrated, setWebsiteSelectionHydrated] = useState(false);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [importProgress, setImportProgress] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const planLimit = plan.urlLimit;
  const firstName = displayName.split(/\s|@/)[0] || "there";
  const initials = displayName.split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase() || "PW";
  const draftStorageKey = `${draftStoragePrefix}${email.toLowerCase()}`;
  const websiteSelectionStorageKey = `${websiteSelectionStoragePrefix}${email.toLowerCase()}`;

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(draftStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        const restored = restoreProductDrafts(parsed);
        if (restored.length) setProductDrafts(restored);
      }
    } catch {
      // A restricted or malformed local storage entry must not block the dashboard.
    } finally {
      setDraftHydrated(true);
    }
  }, [draftStorageKey]);

  useEffect(() => {
    if (!draftHydrated) return;
    try {
      window.localStorage.setItem(draftStorageKey, JSON.stringify(productDrafts));
    } catch {
      // Draft persistence is best effort when browser storage is unavailable.
    }
  }, [draftHydrated, draftStorageKey, productDrafts]);

  useEffect(() => {
    Promise.all([jsonRequest<{ products: Product[] }>("/api/products"), jsonRequest<{ websites: Website[] }>("/api/websites")])
      .then(([productData, websiteData]) => {
        setProducts(productData.products);
        setWebsites(websiteData.websites);
        const savedSelection = readStoredWebsiteSelection(websiteSelectionStorageKey);
        setSelectedWebsiteIds(savedSelection == null
          ? websiteData.websites.map(website => website.id)
          : websiteData.websites.filter(website => savedSelection.includes(website.id)).map(website => website.id));
        setWebsiteSelectionHydrated(true);
      })
      .catch(err => { setWebsiteSelectionHydrated(true); setError(err.message); }).finally(() => setLoading(false));
  }, [websiteSelectionStorageKey]);

  useEffect(() => {
    if (!websiteSelectionHydrated) return;
    try {
      window.localStorage.setItem(websiteSelectionStorageKey, JSON.stringify(selectedWebsiteIds));
    } catch {
      // Website selection is a convenience preference and can be recreated safely.
    }
  }, [selectedWebsiteIds, websiteSelectionHydrated, websiteSelectionStorageKey]);

  async function refreshProducts() {
    const data = await jsonRequest<{ products: Product[] }>("/api/products");
    setProducts(data.products);
  }

  async function toggleProductHistory(group: ProductGroup) {
    if (expandedProductKey === group.key) {
      setExpandedProductKey(null);
      return;
    }
    setExpandedProductKey(group.key);
    const productsToLoad = group.products.filter(product => !historyByProduct[product.id]);
    if (!productsToLoad.length) return;
    setHistoryByProduct(current => {
      const next = { ...current };
      for (const product of productsToLoad) next[product.id] = { loading: true, snapshots: [], summaryByCurrency: [], latestRun: null, attempts: [], error: "" };
      return next;
    });
    await Promise.all(productsToLoad.map(async product => {
      try {
        const [history, runs] = await Promise.all([
          jsonRequest<{ snapshots?: PriceSnapshot[]; summaryByCurrency?: PriceSummary[] }>(`/api/products/${product.id}/history?limit=100`, { headers: { Accept: "application/json" } }),
          jsonRequest<{ latest?: ScanRun | null; attempts?: ScanAttempt[] }>(`/api/products/${product.id}/runs?limit=5`, { headers: { Accept: "application/json" } }),
        ]);
        setHistoryByProduct(current => ({ ...current, [product.id]: { loading: false, snapshots: history.snapshots ?? [], summaryByCurrency: history.summaryByCurrency ?? [], latestRun: runs.latest ?? null, attempts: runs.attempts ?? [], error: "" } }));
      } catch (err) {
        setHistoryByProduct(current => ({ ...current, [product.id]: { loading: false, snapshots: [], summaryByCurrency: [], latestRun: null, attempts: [], error: err instanceof Error ? err.message : "Price history could not be loaded." } }));
      }
    }));
  }

  const productGroups = useMemo(() => groupProducts(products), [products]);
  const availableSites = useMemo(() => [...new Set(products.map(product => websiteHostname(product.websiteUrl)))].sort(), [products]);
  const filteredGroups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const min = priceMin === "" ? null : Number(priceMin) * 100;
    const max = priceMax === "" ? null : Number(priceMax) * 100;
    return productGroups.filter(group => {
      const matchesText = !needle || group.products.some(product => `${product.productName} ${product.ean} ${product.websiteUrl} ${product.sku}`.toLowerCase().includes(needle));
      const matchesSite = !siteFilter || group.products.some(product => websiteHostname(product.websiteUrl) === siteFilter);
      const matchesStock = stockFilter === "all" || group.products.some(product => stockFilter === "in" ? product.inStock === true : stockFilter === "out" ? product.inStock === false : product.inStock == null);
      const matchesStatus = scanStatusFilter === "all" || group.products.some(product => product.status === scanStatusFilter);
      const prices = group.products.map(product => product.priceCents).filter((price): price is number => price != null);
      const matchesPrice = (min == null || prices.some(price => price >= min)) && (max == null || prices.some(price => price <= max));
      const dropDetected = group.products.some(product => (product.priceCents != null && product.ownPriceCents != null && product.priceCents < product.ownPriceCents) || historyByProduct[product.id]?.summaryByCurrency.some(summary => (summary.changeCents ?? 0) < 0));
      const attention = group.products.some(product => ["blocked", "unavailable", "needs_review", "error"].includes(product.status) || dropDetected);
      return matchesText && matchesSite && matchesStock && matchesStatus && matchesPrice && (!priceDropsOnly || dropDetected) && (!needsAttention || attention);
    });
  }, [productGroups, query, siteFilter, stockFilter, scanStatusFilter, priceMin, priceMax, priceDropsOnly, needsAttention, historyByProduct]);
  const uniqueProductCount = productGroups.length;
  const foundCount = products.filter(product => product.status === "found").length;
  const waitingCount = products.filter(product => ["queued", "searching"].includes(product.status)).length;
  const pricedCount = products.filter(product => product.priceCents != null).length;
  const selectedWebsites = useMemo(() => websites.filter(website => selectedWebsiteIds.includes(website.id)), [websites, selectedWebsiteIds]);
  const activeDrafts = useMemo(() => productDrafts.filter(draft => draft.productName.trim() || draft.ean.trim() || draft.sku.trim()), [productDrafts]);
  const uniqueDraftCount = useMemo(() => new Set(activeDrafts.map(draft => draft.ean.replace(/\D/g, "") || draft.id)).size, [activeDrafts]);
  const combinationCount = uniqueDraftCount * selectedWebsites.length;

  function showToast(message: string) { setToast(message); window.setTimeout(() => setToast(""), 3200); }
  function mergeProduct(product: Product) { setProducts(current => current.some(item => item.id === product.id) ? current.map(item => item.id === product.id ? product : item) : [product, ...current]); }
  function mergeProducts(incoming: Product[]) {
    setProducts(current => {
      const incomingIds = new Set(incoming.map(product => product.id));
      return [...incoming, ...current.filter(product => !incomingIds.has(product.id))];
    });
  }

  function updateDraft(id: string, field: keyof Omit<ProductDraft, "id">, value: string) {
    setProductDrafts(current => current.map(draft => draft.id === id ? { ...draft, [field]: value } : draft));
  }

  function addDraft() {
    setProductDrafts(current => [...current, emptyDraft(crypto.randomUUID())]);
  }

  function removeDraft(id: string) {
    setProductDrafts(current => current.length === 1 ? current : current.filter(draft => draft.id !== id));
  }

  function toggleWebsite(id: string) {
    setSelectedWebsiteIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  }

  async function discoverWebsitesForProducts(items: Array<Pick<ProductDraft, "productName" | "ean">>) {
    const productsToDiscover = [...new Map(items.map(item => [item.ean.replace(/\D/g, ""), {
      productName: item.productName.trim(),
      ean: item.ean.trim(),
    }])).values()];
    if (!productsToDiscover.length) throw new Error("Enter at least one product name and EAN first.");
    if (!discoveryCountry) throw new Error("Select a country before discovering stores.");
    const country = discoveryCountry;
    setDiscoveringWebsites(true);
    setDiscoveryProgress("Finding online stores…");
    try {
      const result = await jsonRequest<{ websites: Website[]; discoveredCount: number }>("/api/websites/discover", {
        method: "POST",
        body: JSON.stringify({ products: productsToDiscover, country }),
      });
      setWebsites(current => {
        const incomingIds = new Set(result.websites.map(website => website.id));
        return [...current.filter(website => !incomingIds.has(website.id)), ...result.websites];
      });
      setSelectedWebsiteIds(current => [...new Set([...current, ...result.websites.map(website => website.id)])]);
      showToast(`${result.discoveredCount} online store${result.discoveredCount === 1 ? "" : "s"} found and selected`);
      return result.websites;
    } finally {
      setDiscoveryProgress("");
      setDiscoveringWebsites(false);
    }
  }

  async function discoverWebsites() {
    setError("");
    try {
      await discoverWebsitesForProducts(activeDrafts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Online stores could not be discovered.");
    }
  }

  async function scanOne(id: string, quiet = false) {
    setProducts(current => current.map(product => product.id === id ? { ...product, status: "searching", statusMessage: "Searching public pages…" } : product));
    try {
      const { product } = await jsonRequest<{ product: Product }>(`/api/products/${id}/scan`, { method: "POST", body: "{}" });
      mergeProduct(product);
      if (!quiet) showToast(product.status === "found" ? "Product found and saved" : product.statusMessage);
      return product;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Search failed.";
      setProducts(current => current.map(product => product.id === id ? { ...product, status: "unavailable", statusMessage: message } : product));
      if (!quiet) setError(message);
      return null;
    }
  }

  async function scanMany(items: Product[], setProgress: (message: string) => void) {
    const batches = fairProductBatches(items, 3);
    let completed = 0;
    for (const batch of batches) {
      completed += batch.length;
      setProgress(`Searching ${completed} of ${items.length} product-website combinations…`);
      await Promise.all(batch.map(product => scanOne(product.id, true)));
    }
  }

  function countNewPairs(items: { ean: string }[], searchWebsites = selectedWebsites) {
    const existing = new Set(products.map(product => `${product.websiteUrl}\u0000${product.ean}`));
    const eans = [...new Set(items.map(item => item.ean.replace(/\D/g, "")).filter(Boolean))];
    return searchWebsites.reduce((count, website) => count + eans.filter(ean => !existing.has(`${website.url}\u0000${ean}`)).length, 0);
  }

  async function addProducts(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      if (!activeDrafts.length) throw new Error("Add at least one product.");
      let searchWebsites = selectedWebsites;
      if (!searchWebsites.length) {
        searchWebsites = await discoverWebsitesForProducts(activeDrafts);
      }
      if (!searchWebsites.length) throw new Error("Select at least one website or let Nexus find stores automatically.");
      const searchWebsiteIds = searchWebsites.map(website => website.id);
      const searchCount = uniqueDraftCount * searchWebsites.length;
      if (searchCount > 250) throw new Error("Search up to 250 product-website combinations at a time.");
      const newPairs = countNewPairs(activeDrafts, searchWebsites);
      if (newPairs > planLimit - products.length) throw new Error(`This adds ${newPairs} monitored searches, but your plan has room for ${Math.max(0, planLimit - products.length).toLocaleString()}.`);
      setBulkProgress(`Saving ${searchCount} product-website combinations…`);
      const result = await jsonRequest<{ products: Product[]; productCount: number; websiteCount: number; searchCount: number }>("/api/products/bulk", { method: "POST", body: JSON.stringify({ products: activeDrafts.map(({ productName, ean, sku, ownPrice }) => ({ productName, ean, sku, ownPriceCents: ownPrice ? Math.round(Number(ownPrice) * 100) : null })), websiteIds: searchWebsiteIds }) });
      mergeProducts(result.products);
      await scanMany(result.products, setBulkProgress);
      setProductDrafts([emptyDraft()]);
      showToast(`${result.productCount} product${result.productCount === 1 ? "" : "s"} searched on ${result.websiteCount} website${result.websiteCount === 1 ? "" : "s"}`);
    } catch (err) { setError(err instanceof Error ? err.message : "Products could not be added."); }
    finally { setBulkProgress(""); setSaving(false); }
  }

  async function addWebsite(event: React.FormEvent) {
    event.preventDefault();
    if (!newWebsiteUrl.trim()) {
      await discoverWebsites();
      return;
    }
    setSaving(true); setError("");
    try {
      const { website } = await jsonRequest<{ website: Website }>("/api/websites", { method: "POST", body: JSON.stringify({ url: newWebsiteUrl }) });
      setWebsites(current => current.some(item => item.id === website.id) ? current : [...current, website]);
      setSelectedWebsiteIds(current => current.includes(website.id) ? current : [...current, website.id]);
      setNewWebsiteUrl(""); showToast("Website added and selected");
    } catch (err) { setError(err instanceof Error ? err.message : "Website could not be added."); }
    finally { setSaving(false); }
  }

  function toggleGroupSelection(group: ProductGroup) {
    setSelectedProductIds(current => {
      const allSelected = group.products.every(product => current.includes(product.id));
      return allSelected ? current.filter(id => !group.products.some(product => product.id === id)) : [...new Set([...current, ...group.products.map(product => product.id)])];
    });
  }

  async function runBulkAction(action: "rescan" | "delete" | "pause" | "resume") {
    if (!selectedProductIds.length) return;
    if (action === "delete" && !window.confirm(`Remove ${selectedProductIds.length} selected site searches and their history?`)) return;
    setBulkActionLoading(true); setError("");
    try {
      const result = await jsonRequest<{ products?: Product[]; deletedIds?: string[] }>("/api/products/bulk", { method: "POST", body: JSON.stringify({ action, productIds: selectedProductIds }) });
      if (action === "delete") {
        const deleted = new Set(result.deletedIds ?? selectedProductIds);
        setProducts(current => current.filter(product => !deleted.has(product.id)));
      } else if (action === "rescan") {
        const queued = result.products ?? products.filter(product => selectedProductIds.includes(product.id));
        await scanMany(queued, setBulkProgress);
        await refreshProducts();
      } else if (result.products) mergeProducts(result.products);
      setSelectedProductIds([]);
      showToast(action === "rescan" ? "Selected products rescanned" : action === "delete" ? "Selected products removed" : action === "pause" ? "Monitoring paused" : "Monitoring resumed");
    } catch (err) { setError(err instanceof Error ? err.message : "Bulk action failed."); }
    finally { setBulkProgress(""); setBulkActionLoading(false); }
  }

  async function removeWebsite(website: Website) {
    if (!window.confirm(`Remove ${new URL(website.url).hostname} from saved websites?`)) return;
    try {
      await jsonRequest(`/api/websites/${website.id}`, { method: "DELETE" });
      setWebsites((current) => current.filter((item) => item.id !== website.id));
      setSelectedWebsiteIds((current) => current.filter((id) => id !== website.id));
      showToast("Website removed");
    } catch (err) { setError(err instanceof Error ? err.message : "Website could not be removed."); }
  }

  async function deleteWorkspace() {
    const confirmation = window.prompt("This permanently deletes every Nexus product, snapshot, alert, and schedule in your workspace. Type DELETE to continue.");
    if (confirmation !== "DELETE") return;
    try {
      await jsonRequest("/api/account", { method: "DELETE", body: JSON.stringify({ confirm: confirmation }) });
      if (authProvider === "supabase") await createSupabaseClient().auth.signOut();
      window.location.assign("/login");
    } catch (err) { setError(err instanceof Error ? err.message : "Workspace data could not be deleted."); }
  }

  async function importWorkbook(file: File) {
    setError(""); setImportProgress("Reading workbook…");
    try {
      let rows: unknown[][];
      try { rows = await readXlsxFile(file, { sheet: "Products" }) as unknown[][]; }
      catch { rows = await readXlsxFile(file) as unknown[][]; }
      const headerRow = rows.findIndex(row => row.some(cell => ["product name", "name", "product", "ean", "gtin", "barcode"].includes(normalizeImportHeader(cell))));
      if (headerRow < 0) throw new Error("Could not find Product Name and EAN headers.");
      const headers = rows[headerRow].map(normalizeImportHeader);
      const column = (names: string[]) => headers.findIndex(header => names.some(name => header === name || header.startsWith(`${name} `)));
      const nameIndex = column(["product name", "name", "product", "naziv", "naziv izdelka"]); const eanIndex = column(["ean", "gtin", "barcode", "ean gtin"]);
      const skuIndex = column(["sku"]); const notesIndex = column(["notes", "opombe"]);
      const ownPriceIndex = column(["your price", "own price", "lastna cena", "vaša cena"]);
      if ([nameIndex, eanIndex].some(index => index < 0)) throw new Error("The workbook needs Product Name and EAN columns.");
      const imported = rows.slice(headerRow + 1).map((row, rowIndex) => ({
        productName: importCellText(row[nameIndex]), ean: importCellText(row[eanIndex]),
        sku: skuIndex >= 0 ? importCellText(row[skuIndex]) : "", notes: notesIndex >= 0 ? importCellText(row[notesIndex]) : "",
        ownPriceCents: parseImportedPrice(ownPriceIndex >= 0 ? row[ownPriceIndex] : null, headerRow + rowIndex + 2),
      })).filter(row => row.productName && row.ean && !/example product/i.test(row.productName));
      if (!imported.length) throw new Error("No product rows were found. Delete the example row and add your products first.");
      let searchWebsites = selectedWebsites;
      if (!searchWebsites.length) {
        setImportProgress("Finding online stores from the imported EANs…");
        searchWebsites = await discoverWebsitesForProducts(imported);
      }
      if (!searchWebsites.length) throw new Error("Select at least one website or let Nexus find stores automatically.");
      const remaining = planLimit - products.length;
      const newPairs = countNewPairs(imported, searchWebsites);
      if (newPairs > remaining) throw new Error(`This import adds ${newPairs} searches, but your plan has room for ${Math.max(0, remaining)}.`);
      setImportProgress(`Saving products across ${searchWebsites.length} websites…`);
      const result = await jsonRequest<{ products: Product[]; productCount: number; websiteCount: number; searchCount: number }>("/api/products/bulk", { method: "POST", body: JSON.stringify({ products: imported, websiteIds: searchWebsites.map(website => website.id) }) });
      mergeProducts(result.products);
      await scanMany(result.products, setImportProgress);
      setImportOpen(false); setImportProgress(""); showToast(`${result.productCount} products searched on ${result.websiteCount} websites`);
    } catch (err) { setImportProgress(""); setError(err instanceof Error ? err.message : "The workbook could not be imported."); }
    finally { if (fileRef.current) fileRef.current.value = ""; }
  }

  async function exportWorkbook(items = products) {
    if (!items.length) { showToast("Add a product before exporting"); return; }
    const header = ["Website URL", "Product Name", "EAN", "SKU", "Notes", "Your price", "Status", "Confidence", "Matched URL", "Result title", "Competitor price", "Currency", "In stock", "Last checked"];
    const data = [
      header.map(value => ({ value, type: String, fontWeight: "bold" as const, color: "#FFFFFF", backgroundColor: "#123F37" })),
      ...items.map(product => [
        product.websiteUrl, product.productName, product.ean, product.sku, product.notes, product.ownPriceCents == null ? "" : product.ownPriceCents / 100,
        product.status, product.confidence ?? "", product.matchedUrl ?? "", product.resultTitle ?? "",
        product.priceCents == null ? "" : product.priceCents / 100, product.currency ?? "", product.inStock == null ? "" : product.inStock ? "Yes" : "No", product.lastCheckedAt ?? "",
      ].map((value, index) => ({ value, type: (index === 5 || index === 10) && typeof value === "number" ? Number : String }))),
    ];
    await writeXlsxFile(data, { fileName: `nexus-products-${new Date().toISOString().slice(0, 10)}.xlsx`, sheet: "Products", columns: [34, 30, 16, 16, 28, 12, 14, 12, 36, 30, 14, 10, 10, 22].map(width => ({ width })) });
    showToast(`${items.length} site search${items.length === 1 ? "" : "es"} exported`);
  }

  async function removeProduct(product: Product) {
    if (!window.confirm(`Remove ${product.productName}?`)) return;
    try { await jsonRequest(`/api/products/${product.id}`, { method: "DELETE" }); setProducts(current => current.filter(item => item.id !== product.id)); showToast("Product removed"); }
    catch (err) { setError(err instanceof Error ? err.message : "Product could not be removed."); }
  }

  async function signOut() {
    if (authProvider === "supabase") await createSupabaseClient().auth.signOut();
    window.location.assign(authProvider === "supabase" ? "/login" : "/signout-with-chatgpt?return_to=/login");
  }

  return <main className="shell search-shell">
    <aside className={menu ? "sidebar open" : "sidebar"}>
      <div className="brand"><span className="logo"><Icon name="bolt" size={17}/></span><span>Nexus</span></div>
      <button className="mobile-close" onClick={() => setMenu(false)} aria-label="Close navigation"><Icon name="close"/></button>
      <nav><button className="nav-item active" onClick={() => {setMenu(false);document.getElementById("search-product")?.scrollIntoView({behavior:"smooth"})}}><Icon name="search"/><span>Product search</span></button><button className="nav-item" onClick={() => {setMenu(false);document.getElementById("product-list")?.scrollIntoView({behavior:"smooth"})}}><Icon name="box"/><span>Products</span><span className="nav-count">{uniqueProductCount}</span></button>{isAdmin && <button className="nav-item" onClick={() => window.location.assign("/admin")}><Icon name="settings"/><span>Admin profiles</span></button>}</nav>
      <div className="side-bottom"><div className="plan-card"><div><span>{plan.key[0].toUpperCase() + plan.key.slice(1)} plan</span><strong>{products.length} of {planLimit.toLocaleString()}</strong></div><div className="meter"><i style={{width:`${Math.min(100, products.length / planLimit * 100)}%`}}/></div><button onClick={() => window.location.assign("/#pricing")}>Manage plan</button></div><div className="profile"><span className="avatar">{initials}</span><span className="profile-copy"><strong>{displayName}</strong><small>{email}</small></span><button className="signout-mini" onClick={signOut}>Sign out</button></div><button className="delete-workspace" onClick={deleteWorkspace}>Delete workspace data</button></div>
    </aside>
    {menu && <button className="scrim" onClick={() => setMenu(false)} aria-label="Close menu"/>}

    <section className="content search-content">
      <header><button className="menu-btn" onClick={() => setMenu(true)} aria-label="Open navigation"><Icon name="menu"/></button><div><p>{plan.urlLimit.toLocaleString()} monitored searches · {plan.checksPerDay === 1 ? "daily checks" : `${plan.checksPerDay} checks/day`}</p><h1>Good morning, {firstName}.</h1></div><div className="header-actions"><button className="secondary-action" onClick={() => setImportOpen(true)}><Icon name="upload"/>Import Excel</button><button className="primary" onClick={() => exportWorkbook()}><Icon name="download"/>Export Excel</button></div></header>

      <section className="product-search-card website-card">
        <div className="search-intro"><span className="search-mark"><Icon name="external" size={22}/></span><div><span className="eyebrow">YOUR WEBSITES</span><h2>Let Nexus find stores automatically</h2><p>Enter a product below and Nexus will search the web for relevant online stores. You can still add a specific website manually when needed.</p></div></div>
         <CountrySelect value={discoveryCountry} onChange={setDiscoveryCountry} helpText="Required when Nexus discovers stores automatically."/>
         <form className="website-form" onSubmit={addWebsite}><label><span>Website URL <small>optional</small></span><input type="url" value={newWebsiteUrl} onChange={event => setNewWebsiteUrl(event.target.value)} placeholder="https://competitor-store.com"/><small>Or leave this empty and let Nexus discover stores from the products below.</small></label><div className="website-form-actions"><button className="auto-discover" disabled={saving || discoveringWebsites || !activeDrafts.length || !discoveryCountry} type="button" onClick={discoverWebsites}><Icon name="bolt"/>{discoveryProgress || "Find stores automatically"}</button><button className="secondary-action" disabled={saving || discoveringWebsites} type="submit"><Icon name="plus"/>Add website</button></div></form>
        <div className="website-selection-head"><span>{selectedWebsites.length} of {websites.length} selected</span>{websites.length > 0 && <div><button type="button" onClick={() => setSelectedWebsiteIds(websites.map(website => website.id))}>Select all</button><button type="button" onClick={() => setSelectedWebsiteIds([])}>Clear</button></div>}</div>
        <div className="website-list selectable">{websites.length ? websites.map(website => { const selected = selectedWebsiteIds.includes(website.id); return <span className="website-pill" key={website.id}><button type="button" aria-pressed={selected} className={selected ? "selected" : ""} onClick={() => toggleWebsite(website.id)}><i>{selected ? "✓" : ""}</i>{new URL(website.url).hostname}</button><button type="button" className="website-remove" onClick={() => removeWebsite(website)} aria-label={`Remove ${new URL(website.url).hostname}`}><Icon name="trash" size={12}/></button></span>; }) : <small>No websites added yet.</small>}</div>
      </section>

      <section className="product-search-card" id="search-product">
        <div className="search-intro"><span className="search-mark"><Icon name="search" size={22}/></span><div><span className="eyebrow">BULK PRODUCT SEARCH</span><h2>Search products across the web</h2><p>Add product names and EANs. Nexus searches every selected website, or finds relevant stores automatically if none are selected.</p></div></div>
        <form className="bulk-product-form" onSubmit={addProducts}>
          <div className="selected-sites-summary"><strong>{selectedWebsites.length ? `Searching on ${selectedWebsites.length} website${selectedWebsites.length === 1 ? "" : "s"}` : "Automatic store discovery"}</strong><span>{selectedWebsites.length ? selectedWebsites.map(website => new URL(website.url).hostname).join(", ") : "No websites selected — Nexus will find stores from the EAN and product name."}</span></div>
          <div className="draft-list">{productDrafts.map((draft, index) => <div className="draft-row" key={draft.id}>
            <span className="draft-number">{index + 1}</span>
            <label><span>Product name</span><input required value={draft.productName} onChange={event => updateDraft(draft.id, "productName", event.target.value)} placeholder="Logitech MX Master 4"/></label>
            <label><span>EAN / GTIN</span><input required inputMode="numeric" value={draft.ean} onChange={event => updateDraft(draft.id, "ean", event.target.value)} placeholder="8806095539737"/></label>
            <label><span>SKU <small>optional</small></span><input value={draft.sku} onChange={event => updateDraft(draft.id, "sku", event.target.value)} placeholder="MXM4-GRAPHITE"/></label>
            <label><span>Your price <small>optional</small></span><input type="number" min="0" step="0.01" value={draft.ownPrice} onChange={event => updateDraft(draft.id, "ownPrice", event.target.value)} placeholder="119.99"/></label>
            <button className="remove-draft" type="button" disabled={productDrafts.length === 1} onClick={() => removeDraft(draft.id)} aria-label={`Remove product row ${index + 1}`}><Icon name="trash" size={15}/></button>
          </div>)}</div>
           <div className="bulk-form-footer"><button className="secondary-action add-row" type="button" disabled={saving || productDrafts.length >= 250} onClick={addDraft}><Icon name="plus"/>Add another product</button><div className="combination-summary"><strong>{selectedWebsites.length ? `${uniqueDraftCount} product${uniqueDraftCount === 1 ? "" : "s"} × ${selectedWebsites.length} website${selectedWebsites.length === 1 ? "" : "s"} = ${combinationCount} searches` : `${uniqueDraftCount} product${uniqueDraftCount === 1 ? "" : "s"} · stores found automatically`}</strong><small>Drafts save on this device; submitted searches enter the durable server queue before scanning.</small></div><button className="primary search-submit" disabled={saving || discoveringWebsites || !activeDrafts.length || (!selectedWebsites.length && !discoveryCountry)} type="submit"><Icon name={selectedWebsites.length ? "search" : "bolt"}/>{bulkProgress || (selectedWebsites.length ? "Add & search combinations" : "Find stores & search")}</button></div>
        </form>
        <details className="search-routing-help">
          <summary>How Nexus chooses a website search URL</summary>
          <p>Nexus loads the submitted website first, then checks a saved product page, known search routes, the website&apos;s public search form, and common query parameters. This ensures the latest admin search-profile signature and URL template are applied. If those do not produce a verified match, a public sitemap may locate a canonical product page, whose EAN and price are still checked from the page itself. AI then reviews the best result on that store; if it is missing or wrong, AI searches the same store for replacement pages. Every AI candidate is fetched and independently verified before its price can be saved.</p>
        </details>
        <div className="responsible-note"><Icon name="bolt" size={15}/><span>Evidence-first hybrid search: AI reviews and recovers candidate URLs; EAN, price, currency, and stock are verified from the public product page.</span></div>
      </section>

      <section className="search-stats"><article><span>Products</span><b>{uniqueProductCount}</b><small>{products.length} site searches · {Math.max(0, planLimit-products.length).toLocaleString()} plan slots left</small></article><article><span>Matches found</span><b>{foundCount}</b><small>EAN or name + price</small></article><article><span>Prices captured</span><b>{pricedCount}</b><small>Latest public results</small></article><article><span>Waiting</span><b>{waitingCount}</b><small>Queued or searching</small></article></section>

      <PricingIntelligence products={products} onProductsChanged={refreshProducts}/>

      {error && <div className="dashboard-error" role="alert"><span>{error}</span><button onClick={() => setError("")} aria-label="Dismiss error"><Icon name="close" size={15}/></button></div>}

      <section className="product-list-card" id="product-list">
        <div className="product-list-head"><div><h2>Monitored products</h2><p>Each product appears once; the site tags show everywhere it is searched.</p></div><div className="list-actions"><label className="search"><Icon name="search" size={16}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search name, EAN or site"/></label><button onClick={() => setImportOpen(true)}><Icon name="upload"/>Bulk import</button></div></div>
        <div className="filter-bar" aria-label="Product filters"><label><span>Site</span><select value={siteFilter} onChange={event => setSiteFilter(event.target.value)}><option value="">All sites</option>{availableSites.map(site => <option key={site} value={site}>{site}</option>)}</select></label><label><span>Stock</span><select value={stockFilter} onChange={event => setStockFilter(event.target.value as typeof stockFilter)}><option value="all">All stock</option><option value="in">In stock</option><option value="out">Out of stock</option><option value="unknown">Unknown</option></select></label><label><span>Scan</span><select value={scanStatusFilter} onChange={event => setScanStatusFilter(event.target.value)}><option value="all">All statuses</option><option value="found">Found</option><option value="queued">Queued</option><option value="searching">Searching</option><option value="blocked">Blocked</option><option value="not_found">Not found</option><option value="needs_review">Needs review</option><option value="unavailable">Unavailable</option></select></label><label><span>Price from</span><input inputMode="decimal" type="number" min="0" step="0.01" value={priceMin} onChange={event => setPriceMin(event.target.value)} placeholder="0.00"/></label><label><span>Price to</span><input inputMode="decimal" type="number" min="0" step="0.01" value={priceMax} onChange={event => setPriceMax(event.target.value)} placeholder="Any"/></label><label className="attention-filter"><input type="checkbox" checked={priceDropsOnly} onChange={event => setPriceDropsOnly(event.target.checked)}/><span>Price drops</span></label><label className="attention-filter"><input type="checkbox" checked={needsAttention} onChange={event => setNeedsAttention(event.target.checked)}/><span>Needs attention</span></label></div>
        {selectedProductIds.length > 0 && <div className="bulk-action-bar"><strong>{selectedProductIds.length} site search{selectedProductIds.length === 1 ? "" : "es"} selected</strong><div><button onClick={() => runBulkAction("rescan")} disabled={bulkActionLoading}>Rescan</button><button onClick={() => runBulkAction("pause")} disabled={bulkActionLoading}>Pause monitoring</button><button onClick={() => runBulkAction("resume")} disabled={bulkActionLoading}>Resume monitoring</button><button onClick={() => exportWorkbook(products.filter(product => selectedProductIds.includes(product.id)))} disabled={bulkActionLoading}>Export</button><button className="danger" onClick={() => runBulkAction("delete")} disabled={bulkActionLoading}>Delete</button></div></div>}
        {loading ? <div className="empty-products"><span className="spinner"/><h3>Loading your products…</h3></div> : filteredGroups.length === 0 ? <div className="empty-products"><span><Icon name="box" size={25}/></span><h3>{products.length ? "No products match these filters" : "No products yet"}</h3><p>{products.length ? "Try another filter or clear the search." : "Add one above, or import many products from Excel."}</p>{!products.length && <button className="secondary-action" onClick={() => setImportOpen(true)}><Icon name="upload"/>Import Excel</button>}</div> : <div className="monitor-table-wrap"><table className="monitor-table"><thead><tr><th><button className="select-all-button" type="button" onClick={() => { const visibleIds = filteredGroups.flatMap(group => group.products.map(product => product.id)); const allSelected = visibleIds.every(id => selectedProductIds.includes(id)); setSelectedProductIds(current => allSelected ? current.filter(id => !visibleIds.includes(id)) : [...new Set([...current, ...visibleIds])]); }} aria-label="Select visible products">□</button> Product</th><th>Sites searched</th><th>EAN</th><th>Result</th><th>Prices</th><th>Stock</th><th>Last checked</th><th>Actions</th></tr></thead><tbody>{filteredGroups.map(group => {
          const primary = group.primary;
          const result = summarizeGroupResult(group.products);
          const pricedProducts = group.products.filter(product => product.priceCents != null);
          const knownStockProducts = group.products.filter(product => product.inStock != null);
          const latestCheckedAt = latestProductCheck(group.products);
          const stockLabel = knownStockProducts.length === 0 ? "—" : knownStockProducts.every(product => product.inStock) ? "In stock" : knownStockProducts.every(product => !product.inStock) ? "Out" : "Mixed";
          const stockClass = stockLabel === "In stock" ? "in" : stockLabel === "Out" ? "out" : "";
          const groupSelected = group.products.every(product => selectedProductIds.includes(product.id));
          return <Fragment key={group.key}><tr>
            <td><div className="product-cell"><input className="product-select" type="checkbox" checked={groupSelected} onChange={() => toggleGroupSelection(group)} aria-label={`Select ${primary.productName}`}/><button type="button" className={`product-row-trigger ${expandedProductKey === group.key ? "active" : ""}`} onClick={() => toggleProductHistory(group)} aria-expanded={expandedProductKey === group.key}><strong>{primary.productName}</strong><small>{primary.sku || "No SKU"}</small><span className="history-trigger-label">{expandedProductKey === group.key ? "Hide price history" : "View price history"}</span></button></div></td>
            <td><div className="product-site-tags">{group.products.map(product => { const hostname = websiteHostname(product.websiteUrl); const destination = product.matchedUrl || product.websiteUrl; return <a className={`product-site-tag ${product.status}`} key={product.id} href={destination} target="_blank" rel="noreferrer" title={`${hostname}: ${product.matchedUrl ? "Open the verified product page" : displayStatusMessage(product.statusMessage)}`}><i className="site-tag-dot"/>{hostname}<Icon name="external" size={10}/></a>; })}</div><small>{group.products.length} website{group.products.length === 1 ? "" : "s"}</small></td>
            <td><code>{primary.ean}</code></td>
            <td><span className={`result-badge ${result.className}`}>{result.label}</span><small title={group.products.map(product => `${websiteHostname(product.websiteUrl)}: ${displayStatusMessage(product.statusMessage)}`).join(" · ")}>{group.products.map(product => `${websiteHostname(product.websiteUrl)}: ${displayStatusMessage(product.statusMessage)}`).join(" · ")}</small></td>
            <td>{pricedProducts.length ? <div className="product-price-list">{pricedProducts.map(product => <a className="product-price-item" key={product.id} href={product.matchedUrl || product.websiteUrl} target="_blank" rel="noreferrer"><span>{websiteHostname(product.websiteUrl)}</span><strong>{formatProductPrice(product.priceCents, product.currency)}</strong></a>)}</div> : <strong>—</strong>}{primary.ownPriceCents != null && <small>Your price: {formatProductPrice(primary.ownPriceCents, primary.currency)}</small>}</td>
            <td><div className="group-stock"><span className={stockClass ? `stock ${stockClass}` : "stock"}>{stockLabel}</span>{knownStockProducts.length > 1 && <small>{knownStockProducts.map(product => `${websiteHostname(product.websiteUrl)}: ${product.inStock ? "In" : "Out"}`).join(" · ")}</small>}</div></td>
            <td>{latestCheckedAt ? formatAppDateTime(latestCheckedAt) : "Never"}<small>{group.products.length} site{group.products.length === 1 ? "" : "s"}</small></td>
            <td><div className="group-actions">{group.products.map(product => { const hostname = websiteHostname(product.websiteUrl); return <div className="group-action" key={product.id}><span className="group-action-site" title={hostname}>{hostname}</span><div className="row-buttons"><button onClick={() => scanOne(product.id)} disabled={product.status === "searching"} title={`Search ${hostname} again`} aria-label={`Search ${primary.productName} on ${hostname} again`}><Icon name="refresh" size={15}/></button><button onClick={() => removeProduct(product)} title={`Remove from ${hostname}`} aria-label={`Remove ${primary.productName} from ${hostname}`}><Icon name="trash" size={15}/></button></div></div>; })}</div></td>
          </tr>{expandedProductKey === group.key && <tr className="product-history-row"><td colSpan={8}><ProductHistoryPanel group={group} historyByProduct={historyByProduct} onRetry={scanOne} onProductUpdated={mergeProduct}/></td></tr>}</Fragment>;
        })}</tbody></table></div>}
      </section>
      <footer><span><i/>Verified public-page monitoring</span><span>AI reviews results and recovers failed store searches</span></footer>
    </section>

    {importOpen && <div className="modal-backdrop" onMouseDown={() => !importProgress && setImportOpen(false)}><div className="modal import-modal" role="dialog" aria-modal="true" aria-labelledby="import-title" onMouseDown={event => event.stopPropagation()}>
       <button className="modal-close" onClick={() => !importProgress && setImportOpen(false)} aria-label="Close"><Icon name="close"/></button><span className="modal-icon"><Icon name="file"/></span><h2 id="import-title">Import products from Excel</h2><p>Use one row per product. Only Product Name and EAN are required. Each row will be searched on the websites selected below.</p>
       <CountrySelect value={discoveryCountry} onChange={setDiscoveryCountry} helpText="Required when automatic discovery is selected."/>
      <div className="import-website-picker"><div><strong>Websites to search</strong><span>{selectedWebsites.length ? `${selectedWebsites.length} selected` : "Automatic discovery"}</span></div><div className="website-list selectable">{websites.length ? websites.map(website => { const selected = selectedWebsiteIds.includes(website.id); return <button type="button" key={website.id} aria-pressed={selected} className={selected ? "selected" : ""} onClick={() => toggleWebsite(website.id)}><i>{selected ? "✓" : ""}</i>{new URL(website.url).hostname}</button>; }) : <small>Nexus will find stores from the imported EANs.</small>}</div></div>
       <div className="import-steps"><span><b>1</b>Fill in product name and EAN</span><span><b>2</b>Choose websites or use automatic discovery</span><span><b>3</b>Upload the .xlsx file</span></div><a className="template-download" href="/nexus-product-import-template.xlsx" download><Icon name="download"/>Download Excel template</a><input ref={fileRef} className="file-input" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={event => event.target.files?.[0] && importWorkbook(event.target.files[0])}/><button className="primary modal-submit" disabled={!!importProgress || discoveringWebsites || (!selectedWebsites.length && !discoveryCountry)} onClick={() => fileRef.current?.click()}><Icon name="upload"/>{importProgress || (selectedWebsites.length ? "Choose Excel file" : "Find stores & import Excel")}</button><small className="import-limit">Products are saved to the server queue first, then searched in fair batches of three. Closing this tab does not remove queued work.</small>
    </div></div>}
    {toast && <div className="toast"><Icon name="bolt" size={17}/>{toast}</div>}
  </main>;
}

function ProductHistoryPanel({ group, historyByProduct, onRetry, onProductUpdated }: { group: ProductGroup; historyByProduct: Record<string, ProductHistoryState>; onRetry: (id: string, quiet?: boolean) => Promise<Product | null>; onProductUpdated: (product: Product) => void }) {
  const histories = group.products.map(product => ({ product, state: historyByProduct[product.id] ?? { loading: true, snapshots: [], summaryByCurrency: [], latestRun: null, attempts: [], error: "" } }));
  const currencies = [...new Set(histories.flatMap(({ state }) => state.snapshots.map(snapshot => snapshot.currency || "EUR")))];
  const charts = currencies.map(currency => ({
    currency,
    histories: histories.map(({ product, state }) => ({ product, snapshots: state.snapshots.filter(snapshot => (snapshot.currency || "EUR") === currency) })).filter(history => history.snapshots.length),
  })).filter(chart => chart.histories.length);
  const errors = histories.filter(({ state }) => state.error);
  const noHistory = histories.filter(({ state }) => !state.loading && !state.error && !state.snapshots.length);
  const loading = histories.some(({ state }) => state.loading);
  const observations = histories.reduce((total, { state }) => total + state.snapshots.length, 0);
  const summaries = histories.flatMap(({ product, state }) => state.summaryByCurrency.map(summary => ({ product, summary })));

  return <div className="price-history-panel">
    <div className="price-history-head">
      <div><span className="eyebrow">PRICE HISTORY</span><h3>{group.primary.productName}</h3><p>Confirmed price observations grouped by website. Click a point to see its date and stock state.</p></div>
      <span className="price-history-count">{observations} observation{observations === 1 ? "" : "s"}</span>
    </div>
    {loading && !observations && <div className="price-history-message"><span className="spinner"/><span>Loading previous prices…</span></div>}
    {summaries.length > 0 && <div className="history-summary-grid">{summaries.map(({ product, summary }) => <article key={`${product.id}-${summary.currency}`}><strong>{websiteHostname(product.websiteUrl)}</strong><span>{summary.currency} · {summary.observations} observations</span><div><b>Current <em>{formatProductPrice(summary.latestPriceCents, summary.currency)}</em></b><b>Lowest <em>{formatProductPrice(summary.minPriceCents, summary.currency)}</em></b><b>Highest <em>{formatProductPrice(summary.maxPriceCents, summary.currency)}</em></b><b>Average <em>{formatProductPrice(summary.averagePriceCents, summary.currency)}</em></b></div><small>{summary.latestCapturedAt ? `Latest ${formatAppDateTime(summary.latestCapturedAt)}` : "No latest date"}{summary.changePercent != null ? ` · ${summary.changePercent > 0 ? "+" : ""}${summary.changePercent.toFixed(2)}% since first observation` : ""}</small></article>)}</div>}
    {charts.map(chart => <PriceHistoryChart key={chart.currency} currency={chart.currency} histories={chart.histories}/>) }
    {loading && observations > 0 && <p className="price-history-loading">Updating the remaining site histories…</p>}
    {noHistory.length > 0 && <p className="price-history-no-data">No confirmed price history yet for {noHistory.map(({ product }) => websiteHostname(product.websiteUrl)).join(", ")}.</p>}
    {errors.length > 0 && <div className="price-history-errors">{errors.map(({ product, state }) => <span key={product.id}>{websiteHostname(product.websiteUrl)}: {state.error}</span>)}</div>}
    <div className="scan-transparency"><div className="history-subhead"><strong>Scan transparency</strong><span>Why each site has its current status</span></div>{histories.map(({ product, state }) => <article key={product.id}><div><strong>{websiteHostname(product.websiteUrl)}</strong><span className={`result-badge ${product.status}`}>{statusLabel(product.status)}</span><small>{displayStatusMessage(product.statusMessage)}{state.latestRun?.reasonCode ? ` · ${reasonLabel(state.latestRun.reasonCode)}` : ""}</small>{state.attempts.length > 0 && <details><summary>{state.attempts.length} audited attempt{state.attempts.length === 1 ? "" : "s"}</summary><span>{state.attempts.map(attempt => `${reasonLabel(attempt.reasonCode)} · ${attempt.durationMs} ms`).join(" · ")}</span></details>}</div><button type="button" onClick={() => onRetry(product.id)} disabled={product.status === "searching"}>Retry</button></article>)}</div>
    <div className="alert-settings-list"><div className="history-subhead"><strong>Price alerts</strong><span>Email alerts use the account email when the scan detects a new threshold crossing.</span></div>{group.products.map(product => <AlertSettings key={product.id} product={product} onProductUpdated={onProductUpdated}/>)}</div>
    {!loading && !charts.length && !errors.length && !noHistory.length && <div className="price-history-message">No previous confirmed prices are available yet.</div>}
  </div>;
}

function AlertSettings({ product, onProductUpdated }: { product: Product; onProductUpdated: (product: Product) => void }) {
  const [enabled, setEnabled] = useState(product.monitoringEnabled !== false);
  const [priceDrop, setPriceDrop] = useState(product.alertOnPriceDrop !== false);
  const [restock, setRestock] = useState(product.alertOnRestock !== false);
  const [target, setTarget] = useState(product.alertTargetPriceCents == null ? "" : (product.alertTargetPriceCents / 100).toFixed(2));
  const [percentage, setPercentage] = useState(product.alertDropPercentBps == null ? "" : (product.alertDropPercentBps / 100).toFixed(2));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  async function save() {
    setSaving(true); setMessage("");
    try {
      const data = await jsonRequest<{ product: Product }>(`/api/products/${product.id}`, { method: "PATCH", body: JSON.stringify({ monitoringEnabled: enabled, alertOnPriceDrop: priceDrop, alertOnRestock: restock, alertTargetPriceCents: target === "" ? null : Math.round(Number(target) * 100), alertDropPercentBps: percentage === "" ? null : Math.round(Number(percentage) * 100) }) });
      onProductUpdated(data.product); setMessage("Saved");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save"); }
    finally { setSaving(false); }
  }
  return <article className="alert-settings"><strong>{websiteHostname(product.websiteUrl)}</strong><label><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)}/> Monitoring</label><label><input type="checkbox" checked={priceDrop} onChange={event => setPriceDrop(event.target.checked)}/> Price drops</label><label><input type="checkbox" checked={restock} onChange={event => setRestock(event.target.checked)}/> Restock</label><label><span>Target price</span><input type="number" min="0" step="0.01" value={target} onChange={event => setTarget(event.target.value)} placeholder="Optional"/></label><label><span>Drop %</span><input type="number" min="0.01" max="100" step="0.01" value={percentage} onChange={event => setPercentage(event.target.value)} placeholder="Optional"/></label><button type="button" onClick={save} disabled={saving}>{saving ? "Saving…" : message || "Save"}</button></article>;
}

type SiteHistory = { product: Product; snapshots: PriceSnapshot[] };
const HISTORY_COLORS = ["#16866a", "#4e78c1", "#d78a43", "#a05a9d", "#d05f54", "#4c9b9b"];

function PriceHistoryChart({ currency, histories }: { currency: string; histories: SiteHistory[] }) {
  const plot = { left: 52, right: 708, top: 18, bottom: 180 };
  const snapshots = histories.flatMap(history => history.snapshots);
  const times = snapshots.map(snapshot => new Date(snapshot.capturedAt).getTime());
  const prices = snapshots.map(snapshot => snapshot.priceCents);
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const spread = maxPrice - minPrice;
  const padding = spread > 0 ? spread * 0.12 : Math.max(maxPrice * 0.12, 100);
  const domainMin = Math.max(0, minPrice - padding);
  const domainMax = maxPrice + padding || 1;
  const xFor = (time: number) => maxTime === minTime ? (plot.left + plot.right) / 2 : plot.left + ((time - minTime) / (maxTime - minTime)) * (plot.right - plot.left);
  const yFor = (price: number) => plot.bottom - ((price - domainMin) / (domainMax - domainMin)) * (plot.bottom - plot.top);
  const yTicks = [0, 0.5, 1].map(ratio => ({ ratio, value: domainMax - (domainMax - domainMin) * ratio }));

  return <section className="price-history-chart">
    <div className="price-history-chart-head"><strong>{currency}</strong><span>{histories.length} website{histories.length === 1 ? "" : "s"}</span></div>
    <div className="price-history-chart-wrap">
      <svg viewBox="0 0 760 228" role="img" aria-label={`${currency} price history for ${histories.map(history => websiteHostname(history.product.websiteUrl)).join(", ")}`}>
        {yTicks.map(tick => <g key={tick.ratio}><line x1={plot.left} x2={plot.right} y1={yFor(tick.value)} y2={yFor(tick.value)} className="history-grid-line"/><text x={plot.left - 8} y={yFor(tick.value) + 3} textAnchor="end" className="history-axis-label">{formatProductPrice(Math.round(tick.value), currency)}</text></g>)}
        <line x1={plot.left} x2={plot.right} y1={plot.bottom} y2={plot.bottom} className="history-axis-line"/>
        {histories.map((history, index) => {
          const color = HISTORY_COLORS[index % HISTORY_COLORS.length];
          const points = [...history.snapshots].sort((left, right) => new Date(left.capturedAt).getTime() - new Date(right.capturedAt).getTime()).map(snapshot => ({ snapshot, x: xFor(new Date(snapshot.capturedAt).getTime()), y: yFor(snapshot.priceCents) }));
          const path = points.map((point, pointIndex) => `${pointIndex ? "L" : "M"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
          return <g key={history.product.id}>
            <path d={path} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            {points.map(point => <circle key={point.snapshot.id} cx={point.x} cy={point.y} r="4" fill="#fff" stroke={color} strokeWidth="2"><title>{`${formatProductPrice(point.snapshot.priceCents, currency)} · ${formatAppDateTime(point.snapshot.capturedAt)} · ${point.snapshot.inStock === false ? "Out of stock" : point.snapshot.inStock === true ? "In stock" : "Stock unknown"}`}</title></circle>)}
          </g>;
        })}
        <text x={plot.left} y="211" className="history-axis-label">{formatHistoryDate(minTime)}</text>
        <text x={plot.right} y="211" textAnchor="end" className="history-axis-label">{formatHistoryDate(maxTime)}</text>
      </svg>
    </div>
    <div className="price-history-legend">{histories.map((history, index) => {
      const sorted = [...history.snapshots].sort((left, right) => new Date(left.capturedAt).getTime() - new Date(right.capturedAt).getTime());
      const first = sorted[0];
      const latest = sorted.at(-1)!;
      const change = latest.priceCents - first.priceCents;
      return <div key={history.product.id}><i style={{ background: HISTORY_COLORS[index % HISTORY_COLORS.length] }}/><span><strong>{websiteHostname(history.product.websiteUrl)}</strong><small>{formatProductPrice(latest.priceCents, currency)} · {change === 0 ? "No change" : `${change > 0 ? "+" : "−"}${formatProductPrice(Math.abs(change), currency)}`}</small></span></div>;
    })}</div>
  </section>;
}

function formatHistoryDate(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(timestamp));
}

function fairProductBatches(items: Product[], maximumBatchSize: number) {
  const queues = new Map<string, Product[]>();
  for (const item of items) {
    const hostname = websiteHostname(item.websiteUrl).toLowerCase();
    queues.set(hostname, [...(queues.get(hostname) ?? []), item]);
  }
  const batches: Product[][] = [];
  while ([...queues.values()].some((queue) => queue.length)) {
    const batch: Product[] = [];
    for (const queue of queues.values()) {
      if (batch.length >= Math.max(1, maximumBatchSize)) break;
      const item = queue.shift();
      if (item) batch.push(item);
    }
    if (batch.length) batches.push(batch);
  }
  return batches;
}

function groupProducts(items: Product[]): ProductGroup[] {
  const groups = new Map<string, ProductGroup>();
  for (const product of items) {
    const key = productGroupKey(product);
    const group = groups.get(key);
    if (group) group.products.push(product);
    else groups.set(key, { key, products: [product], primary: product });
  }
  return [...groups.values()];
}

function productGroupKey(product: Product) {
  const normalizedEan = product.ean.replace(/\D/g, "");
  return normalizedEan ? `ean:${normalizedEan}` : `name:${product.productName.trim().toLowerCase()}`;
}

function websiteHostname(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return url; }
}

function restoreProductDrafts(value: unknown): ProductDraft[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  const restored: ProductDraft[] = [];
  for (const [index, item] of value.slice(0, 250).entries()) {
    if (!item || typeof item !== "object") continue;
    const record = item as Partial<ProductDraft>;
    const idCandidate = typeof record.id === "string" && record.id.trim() ? record.id.trim() : `product-${index + 1}`;
    const id = ids.has(idCandidate) ? `${idCandidate}-${index + 1}` : idCandidate;
    ids.add(id);
    restored.push({
      id,
      productName: typeof record.productName === "string" ? record.productName : "",
      ean: typeof record.ean === "string" ? record.ean : "",
      sku: typeof record.sku === "string" ? record.sku : "",
      ownPrice: typeof record.ownPrice === "string" ? record.ownPrice : "",
    });
  }
  return restored;
}

function readStoredWebsiteSelection(key: string) {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return null;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) && parsed.every((id) => typeof id === "string") ? parsed as string[] : null;
  } catch {
    return null;
  }
}

function normalizeImportHeader(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\/_()\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function importCellText(value: unknown) {
  if (value == null) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  return String(value).trim();
}

function parseImportedPrice(value: unknown, rowNumber?: number) {
  const raw = importCellText(value).replace(/\s/g, "");
  if (!raw) return null;
  const normalized = raw.includes(",") && raw.includes(".")
    ? raw.lastIndexOf(",") > raw.lastIndexOf(".") ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/,/g, "")
    : raw.replace(",", ".");
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0) throw new Error(`Invalid price in Excel row ${rowNumber ?? ""}.`);
  const cents = Math.round(amount * 100);
  if (!Number.isSafeInteger(cents) || cents > 1_000_000_000) throw new Error(`Invalid price in Excel row ${rowNumber ?? ""}.`);
  return cents;
}

function summarizeGroupResult(items: Product[]) {
  const found = items.filter(product => product.status === "found").length;
  const waiting = items.filter(product => ["queued", "searching"].includes(product.status)).length;
  if (found === items.length) return { className: "found", label: `Found on ${found} site${found === 1 ? "" : "s"}` };
  if (found > 0) return { className: "partial", label: `${found} of ${items.length} found` };
  if (waiting === items.length) {
    const searching = items.some(product => product.status === "searching");
    return { className: searching ? "searching" : "queued", label: searching ? "Searching" : "Queued" };
  }
  const primary = items.find(product => !["queued", "searching"].includes(product.status)) ?? items[0];
  return { className: primary.status, label: primary.status === "not_found" ? "Not found" : primary.status.replace(/_/g, " ") };
}

function statusLabel(value: string) {
  return value === "not_found" ? "Not found" : value === "needs_review" ? "Needs review" : value === "unavailable" ? "Unavailable" : value.replaceAll("_", " ");
}

function reasonLabel(value: string) {
  const labels: Record<string, string> = { captcha: "CAPTCHA", bot_wall: "Bot wall", login_wall: "Login required", js_challenge: "JavaScript challenge", wrong_product: "Wrong product", low_confidence: "Low confidence", price_missing: "Price missing", profile_drift: "Profile drift", timeout: "Timed out", robots_disallowed: "Blocked by policy", rate_limited: "Rate limited", request_queue_busy: "Scan queue busy" };
  return labels[value] || statusLabel(value);
}

function latestProductCheck(items: Product[]) {
  return items.map(product => product.lastCheckedAt).filter((date): date is string => Boolean(date)).sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] ?? null;
}

function formatProductPrice(priceCents: number | null, currency: string | null) {
  if (priceCents == null) return "—";
  if (!currency || !/^[A-Z]{3}$/.test(currency)) return `${(priceCents / 100).toLocaleString()} ${currency || "EUR"}`;
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(priceCents / 100);
}

function displayStatusMessage(message: string) {
  return /challenge detected\./i.test(message) ? "Website presented an access challenge." : message;
}
