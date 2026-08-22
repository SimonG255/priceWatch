"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import readXlsxFile from "read-excel-file";
import writeXlsxFile from "write-excel-file";
import { createClient as createSupabaseClient } from "../../lib/supabase/client";

type IconName = "grid" | "box" | "settings" | "plus" | "search" | "bolt" | "external" | "menu" | "close" | "upload" | "download" | "refresh" | "trash" | "file";
type Product = {
  id: string; websiteUrl: string; productName: string; ean: string; sku: string; notes: string;
  status: "queued" | "searching" | "found" | "not_found" | "blocked" | "error";
  statusMessage: string; matchedUrl: string | null; resultTitle: string | null; priceCents: number | null;
  currency: string | null; inStock: boolean | null; matchType: string | null; lastCheckedAt: string | null; createdAt: string;
};
type Website = { id: string; url: string; createdAt: string };

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

async function jsonRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) } });
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error || "The request could not be completed.");
  return body;
}

export default function Dashboard({ displayName, email, customPlan, authProvider, isAdmin }: { displayName: string; email: string; customPlan: { urls: number; checks: number } | null; authProvider: "supabase" | "chatgpt"; isAdmin: boolean }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [websites, setWebsites] = useState<Website[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [menu, setMenu] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [newWebsiteUrl, setNewWebsiteUrl] = useState("");
  const [productName, setProductName] = useState("");
  const [ean, setEan] = useState("");
  const [sku, setSku] = useState("");
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [importProgress, setImportProgress] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const planLimit = customPlan?.urls ?? 150;
  const firstName = displayName.split(/\s|@/)[0] || "there";
  const initials = displayName.split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase() || "PW";

  useEffect(() => {
    Promise.all([jsonRequest<{ products: Product[] }>("/api/products"), jsonRequest<{ websites: Website[] }>("/api/websites")])
      .then(([productData, websiteData]) => { setProducts(productData.products); setWebsites(websiteData.websites); setWebsiteUrl(websiteData.websites[0]?.url || ""); })
      .catch(err => setError(err.message)).finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? products.filter(product => `${product.productName} ${product.ean} ${product.websiteUrl} ${product.sku}`.toLowerCase().includes(needle)) : products;
  }, [products, query]);
  const foundCount = products.filter(product => product.status === "found").length;
  const waitingCount = products.filter(product => ["queued", "searching"].includes(product.status)).length;
  const pricedCount = products.filter(product => product.priceCents != null).length;

  function showToast(message: string) { setToast(message); window.setTimeout(() => setToast(""), 3200); }
  function mergeProduct(product: Product) { setProducts(current => current.some(item => item.id === product.id) ? current.map(item => item.id === product.id ? product : item) : [product, ...current]); }

  async function scanOne(id: string, quiet = false) {
    setProducts(current => current.map(product => product.id === id ? { ...product, status: "searching", statusMessage: "Searching public pages…" } : product));
    try {
      const { product } = await jsonRequest<{ product: Product }>(`/api/products/${id}/scan`, { method: "POST", body: "{}" });
      mergeProduct(product);
      if (!quiet) showToast(product.status === "found" ? "Product found and saved" : product.statusMessage);
      return product;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Search failed.";
      setProducts(current => current.map(product => product.id === id ? { ...product, status: "error", statusMessage: message } : product));
      if (!quiet) setError(message);
      return null;
    }
  }

  async function addProduct(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      if (products.length >= planLimit) throw new Error(`Your plan allows ${planLimit.toLocaleString()} monitored URLs.`);
      const { product } = await jsonRequest<{ product: Product }>("/api/products", { method: "POST", body: JSON.stringify({ websiteUrl, productName, ean, sku }) });
      mergeProduct(product); setWebsiteUrl(""); setProductName(""); setEan(""); setSku("");
      await scanOne(product.id);
    } catch (err) { setError(err instanceof Error ? err.message : "Product could not be added."); }
    finally { setSaving(false); }
  }

  async function addWebsite(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const { website } = await jsonRequest<{ website: Website }>("/api/websites", { method: "POST", body: JSON.stringify({ url: newWebsiteUrl }) });
      setWebsites(current => current.some(item => item.id === website.id) ? current : [...current, website]);
      setWebsiteUrl(website.url); setNewWebsiteUrl(""); showToast("Website added");
    } catch (err) { setError(err instanceof Error ? err.message : "Website could not be added."); }
    finally { setSaving(false); }
  }

  async function importWorkbook(file: File) {
    setError(""); setImportProgress("Reading workbook…");
    try {
      let rows: unknown[][];
      try { rows = await readXlsxFile(file, { sheet: "Products" }) as unknown[][]; }
      catch { rows = await readXlsxFile(file) as unknown[][]; }
      const headerRow = rows.findIndex(row => row.some(cell => ["product name", "name", "ean", "gtin", "barcode"].includes(String(cell ?? "").trim().toLowerCase())));
      if (headerRow < 0) throw new Error("Could not find Product Name and EAN headers.");
      const headers = rows[headerRow].map(cell => String(cell ?? "").trim().toLowerCase());
      const column = (names: string[]) => headers.findIndex(header => names.includes(header));
      const nameIndex = column(["product name", "name"]); const eanIndex = column(["ean", "gtin", "barcode"]);
      const skuIndex = column(["sku (optional)", "sku"]); const notesIndex = column(["notes (optional)", "notes"]);
      if ([nameIndex, eanIndex].some(index => index < 0)) throw new Error("The workbook needs Product Name and EAN columns.");
      if (!websites.length) throw new Error("Add at least one website before importing products.");
      const imported = rows.slice(headerRow + 1).map(row => ({
        productName: String(row[nameIndex] ?? "").trim(), ean: String(row[eanIndex] ?? "").trim(),
        sku: skuIndex >= 0 ? String(row[skuIndex] ?? "").trim() : "", notes: notesIndex >= 0 ? String(row[notesIndex] ?? "").trim() : "",
      })).filter(row => row.productName && row.ean && !/example product/i.test(row.productName));
      if (!imported.length) throw new Error("No product rows were found. Delete the example row and add your products first.");
      const remaining = planLimit - products.length;
      const searchesToCreate = imported.length * websites.length;
      if (searchesToCreate > remaining) throw new Error(`This import creates ${searchesToCreate} searches across ${websites.length} websites, but your plan has room for ${Math.max(0, remaining)}.`);
      setImportProgress(`Saving ${searchesToCreate} product searches…`);
      const { products: created } = await jsonRequest<{ products: Product[] }>("/api/products/bulk", { method: "POST", body: JSON.stringify({ products: imported }) });
      setProducts(current => {
        const map = new Map(current.map(product => [product.id, product])); created.forEach(product => map.set(product.id, product)); return [...created, ...[...map.values()].filter(product => !created.some(item => item.id === product.id))];
      });
      for (let index = 0; index < created.length; index += 3) {
        const batch = created.slice(index, index + 3);
        setImportProgress(`Searching ${Math.min(index + 3, created.length)} of ${created.length} products…`);
        await Promise.all(batch.map(product => scanOne(product.id, true)));
      }
      setImportOpen(false); setImportProgress(""); showToast(`${imported.length} products searched on ${websites.length} websites`);
    } catch (err) { setImportProgress(""); setError(err instanceof Error ? err.message : "The workbook could not be imported."); }
    finally { if (fileRef.current) fileRef.current.value = ""; }
  }

  async function exportWorkbook() {
    if (!products.length) { showToast("Add a product before exporting"); return; }
    const header = ["Website URL", "Product Name", "EAN", "SKU", "Notes", "Status", "Matched URL", "Result title", "Price", "Currency", "In stock", "Last checked"];
    const data = [
      header.map(value => ({ value, type: String, fontWeight: "bold" as const, color: "#FFFFFF", backgroundColor: "#123F37" })),
      ...products.map(product => [
        product.websiteUrl, product.productName, product.ean, product.sku, product.notes, product.status, product.matchedUrl ?? "", product.resultTitle ?? "",
        product.priceCents == null ? "" : product.priceCents / 100, product.currency ?? "", product.inStock == null ? "" : product.inStock ? "Yes" : "No", product.lastCheckedAt ?? "",
      ].map((value, index) => ({ value, type: index === 8 && typeof value === "number" ? Number : String }))),
    ];
    await writeXlsxFile(data, { fileName: `pricewatch-products-${new Date().toISOString().slice(0, 10)}.xlsx`, sheet: "Products", columns: [34, 30, 16, 16, 28, 14, 36, 30, 12, 10, 10, 22].map(width => ({ width })) });
    showToast("Excel export downloaded");
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
      <div className="brand"><span className="logo"><Icon name="bolt" size={17}/></span><span>PriceWatch</span></div>
      <button className="mobile-close" onClick={() => setMenu(false)} aria-label="Close navigation"><Icon name="close"/></button>
      <nav><button className="nav-item active" onClick={() => {setMenu(false);document.getElementById("search-product")?.scrollIntoView({behavior:"smooth"})}}><Icon name="search"/><span>Product search</span></button><button className="nav-item" onClick={() => {setMenu(false);document.getElementById("product-list")?.scrollIntoView({behavior:"smooth"})}}><Icon name="box"/><span>Products</span><span className="nav-count">{products.length}</span></button>{isAdmin && <button className="nav-item" onClick={() => window.location.assign("/admin")}><Icon name="settings"/><span>Admin profiles</span></button>}</nav>
      <div className="side-bottom"><div className="plan-card"><div><span>{customPlan ? "Custom plan" : "Business plan"}</span><strong>{products.length} of {planLimit.toLocaleString()}</strong></div><div className="meter"><i style={{width:`${Math.min(100, products.length / planLimit * 100)}%`}}/></div><button onClick={() => window.location.assign("/#pricing")}>Manage plan</button></div><div className="profile"><span className="avatar">{initials}</span><span className="profile-copy"><strong>{displayName}</strong><small>{email}</small></span><button className="signout-mini" onClick={signOut}>Sign out</button></div></div>
    </aside>
    {menu && <button className="scrim" onClick={() => setMenu(false)} aria-label="Close menu"/>}

    <section className="content search-content">
      <header><button className="menu-btn" onClick={() => setMenu(true)} aria-label="Open navigation"><Icon name="menu"/></button><div><p>{customPlan ? `${customPlan.urls.toLocaleString()} URLs · ${customPlan.checks} checks/day` : "Public product monitoring"}</p><h1>Good morning, {firstName}.</h1></div><div className="header-actions"><button className="secondary-action" onClick={() => setImportOpen(true)}><Icon name="upload"/>Import Excel</button><button className="primary" onClick={exportWorkbook}><Icon name="download"/>Export Excel</button></div></header>

      <section className="product-search-card website-card">
        <div className="search-intro"><span className="search-mark"><Icon name="external" size={22}/></span><div><span className="eyebrow">YOUR WEBSITES</span><h2>Add websites separately</h2><p>Save each public store once. Excel imports search every saved website, while manually added products use the website you select.</p></div></div>
        <form className="website-form" onSubmit={addWebsite}><label><span>Website URL</span><input required type="url" value={newWebsiteUrl} onChange={event => setNewWebsiteUrl(event.target.value)} placeholder="https://competitor-store.com"/></label><button className="secondary-action" disabled={saving} type="submit"><Icon name="plus"/>Add website</button></form>
        <div className="website-list">{websites.length ? websites.map(website => <button type="button" key={website.id} className={websiteUrl === website.url ? "selected" : ""} onClick={() => setWebsiteUrl(website.url)}>{new URL(website.url).hostname}</button>) : <small>No websites added yet.</small>}</div>
      </section>

      <section className="product-search-card" id="search-product">
        <div className="search-intro"><span className="search-mark"><Icon name="search" size={22}/></span><div><span className="eyebrow">ADD A PRODUCT</span><h2>Choose where to search for this product</h2><p>Enter the product name and EAN, then select one of your saved websites.</p></div></div>
        <form className="product-search-form" onSubmit={addProduct}>
          <label className="wide-field"><span>Website to search</span><select required value={websiteUrl} onChange={event => setWebsiteUrl(event.target.value)}><option value="" disabled>{websites.length ? "Choose a website" : "Add a website above first"}</option>{websites.map(website => <option key={website.id} value={website.url}>{new URL(website.url).hostname}</option>)}</select></label>
          <label><span>Product name</span><input required value={productName} onChange={event => setProductName(event.target.value)} placeholder="Logitech MX Master 4"/></label>
          <label><span>EAN / GTIN</span><input required inputMode="numeric" value={ean} onChange={event => setEan(event.target.value)} placeholder="5099206123456"/></label>
          <label><span>SKU <small>optional</small></span><input value={sku} onChange={event => setSku(event.target.value)} placeholder="MXM4-GRAPHITE"/></label>
          <button className="primary search-submit" disabled={saving} type="submit"><Icon name="search"/>{saving ? "Searching…" : "Add & search product"}</button>
        </form>
        <details className="search-routing-help">
          <summary>How PriceWatch chooses a website search URL</summary>
          <p>The public search form on the submitted website is used first. If none is available, PriceWatch recognizes known routes for Amazon, eBay, Etsy, Shopify, Magento, WooCommerce, PrestaShop, BigCommerce, and Shopware, then safely tries common <code>q</code>, <code>query</code>, <code>search</code>, and <code>s</code> parameters.</p>
        </details>
        <div className="responsible-note"><Icon name="bolt" size={15}/><span>Public pages only. PriceWatch uses limited requests, follows same-site links, and reports when a store blocks automated checks.</span></div>
      </section>

      <section className="search-stats"><article><span>Products</span><b>{products.length}</b><small>{Math.max(0, planLimit-products.length).toLocaleString()} plan slots left</small></article><article><span>Matches found</span><b>{foundCount}</b><small>EAN or name + price</small></article><article><span>Prices captured</span><b>{pricedCount}</b><small>Latest public results</small></article><article><span>Waiting</span><b>{waitingCount}</b><small>Queued or searching</small></article></section>

      {error && <div className="dashboard-error" role="alert"><span>{error}</span><button onClick={() => setError("")} aria-label="Dismiss error"><Icon name="close" size={15}/></button></div>}

      <section className="product-list-card" id="product-list">
        <div className="product-list-head"><div><h2>Monitored products</h2><p>Every product is tied to one website and EAN.</p></div><div className="list-actions"><label className="search"><Icon name="search" size={16}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search name, EAN or site"/></label><button onClick={() => setImportOpen(true)}><Icon name="upload"/>Bulk import</button></div></div>
        {loading ? <div className="empty-products"><span className="spinner"/><h3>Loading your products…</h3></div> : filtered.length === 0 ? <div className="empty-products"><span><Icon name="box" size={25}/></span><h3>{products.length ? "No products match this search" : "No products yet"}</h3><p>{products.length ? "Try another name, EAN, or website." : "Add one above, or import many products from Excel."}</p>{!products.length && <button className="secondary-action" onClick={() => setImportOpen(true)}><Icon name="upload"/>Import Excel</button>}</div> : <div className="monitor-table-wrap"><table className="monitor-table"><thead><tr><th>Product</th><th>Website</th><th>EAN</th><th>Result</th><th>Price</th><th>Stock</th><th>Last checked</th><th/></tr></thead><tbody>{filtered.map(product => <tr key={product.id}><td><strong>{product.productName}</strong><small>{product.sku || "No SKU"}</small></td><td><a href={product.websiteUrl} target="_blank" rel="noreferrer">{new URL(product.websiteUrl).hostname}<Icon name="external" size={12}/></a></td><td><code>{product.ean}</code></td><td><span className={`result-badge ${product.status}`}>{product.status === "not_found" ? "Not found" : product.status}</span><small title={product.statusMessage}>{product.statusMessage}</small></td><td><strong>{product.priceCents == null ? "—" : new Intl.NumberFormat(undefined,{style:"currency",currency:product.currency || "EUR"}).format(product.priceCents/100)}</strong>{product.matchedUrl && <a className="match-link" href={product.matchedUrl} target="_blank" rel="noreferrer">Open match</a>}</td><td>{product.inStock == null ? "—" : <span className={product.inStock ? "stock in" : "stock out"}>{product.inStock ? "In stock" : "Out"}</span>}</td><td>{product.lastCheckedAt ? new Intl.DateTimeFormat(undefined,{dateStyle:"medium",timeStyle:"short"}).format(new Date(product.lastCheckedAt)) : "Never"}</td><td><div className="row-buttons"><button onClick={() => scanOne(product.id)} disabled={product.status === "searching"} title="Search again"><Icon name="refresh" size={15}/></button><button onClick={() => removeProduct(product)} title="Remove"><Icon name="trash" size={15}/></button></div></td></tr>)}</tbody></table></div>}
      </section>
      <footer><span><i/>Responsible public-page monitoring</span><span>Up to 3 imported products searched at once</span></footer>
    </section>

    {importOpen && <div className="modal-backdrop" onMouseDown={() => !importProgress && setImportOpen(false)}><div className="modal import-modal" role="dialog" aria-modal="true" aria-labelledby="import-title" onMouseDown={event => event.stopPropagation()}><button className="modal-close" onClick={() => !importProgress && setImportOpen(false)} aria-label="Close"><Icon name="close"/></button><span className="modal-icon"><Icon name="file"/></span><h2 id="import-title">Import products from Excel</h2><p>Use one row per product. Only Product Name and EAN are required; every product will be searched on all {websites.length || "saved"} websites.</p><div className="import-steps"><span><b>1</b>Add your websites</span><span><b>2</b>Fill in name and EAN</span><span><b>3</b>Upload the .xlsx file</span></div><a className="template-download" href="/pricewatch-product-import-template.xlsx" download><Icon name="download"/>Download Excel template</a><input ref={fileRef} className="file-input" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={event => event.target.files?.[0] && importWorkbook(event.target.files[0])}/><button className="primary modal-submit" disabled={!!importProgress || !websites.length} onClick={() => fileRef.current?.click()}><Icon name="upload"/>{importProgress || (websites.length ? "Choose Excel file" : "Add a website first")}</button><small className="import-limit">Each imported product creates one monitored search per saved website, then searches them in small batches.</small></div></div>}
    {toast && <div className="toast"><Icon name="bolt" size={17}/>{toast}</div>}
  </main>;
}
