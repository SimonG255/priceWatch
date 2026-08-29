import type { Metadata } from "next";
import Link from "next/link";
import CustomPlan from "./CustomPlan";

export const metadata: Metadata = {
  title: "Competitor price monitoring for e-commerce",
  description: "Track competitor prices and stock automatically. See every market move, protect your margins, and act from one focused dashboard.",
  alternates: { canonical: "/" },
};

function Bolt({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m13 2-8 12h7l-1 8 8-12h-7l1-8Z"/></svg>;
}

function Check() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>;
}

export default function LandingPage() {
  return (
    <main className="launch-page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({ "@context": "https://schema.org", "@type": "SoftwareApplication", name: "PriceWatch", applicationCategory: "BusinessApplication", operatingSystem: "Web", description: "Competitor price and stock monitoring for e-commerce teams.", offers: [{ "@type": "Offer", name: "Starter", price: "250", priceCurrency: "EUR" }, { "@type": "Offer", name: "Business", price: "500", priceCurrency: "EUR" }, { "@type": "Offer", name: "Pro", price: "1000", priceCurrency: "EUR" }] }) }} />
      <nav className="launch-nav" aria-label="Main navigation">
        <Link className="launch-logo" href="/"><span><Bolt size={16}/></span>PriceWatch</Link>
        <div className="launch-links"><a href="#how-it-works">How it works</a><a href="#pricing">Pricing</a><a href="#responsible">Responsible data</a></div>
        <div className="launch-actions"><a className="text-link" href="/login">Sign in</a><a className="launch-button small" href="/login">Start free trial</a></div>
      </nav>

      <section className="launch-hero">
        <div className="hero-copy">
          <div className="launch-kicker"><span/>14-day free trial · Early access</div>
          <h1>Know when the<br/>market <em>moves.</em></h1>
          <p>PriceWatch checks competitor product pages, records price and stock changes, and tells you exactly when it is time to act.</p>
          <div className="hero-actions"><a className="launch-button" href="/login">Start 14-day free trial <span>→</span></a><a className="watch-demo" href="#product-demo"><span className="play">▶</span>See the product</a></div>
          <div className="hero-trust"><span><Check/>14 days free</span><span><Check/>No credit card</span><span><Check/>Cancel anytime</span></div>
        </div>
        <div className="hero-product" id="product-demo" aria-label="PriceWatch dashboard preview">
          <div className="demo-top"><div className="demo-brand"><span><Bolt size={12}/></span>PriceWatch</div><div className="demo-search">⌕ &nbsp; Search products</div><div className="demo-avatar">AK</div></div>
          <div className="demo-body"><aside><i/><i/><i/><i/></aside><section><div className="demo-heading"><div><small>FEATURED PRODUCT</small><b>Logitech MX Master 4</b></div><span>Live monitoring</span></div><div className="demo-metrics"><div><small>Your price</small><b>€119.99</b></div><div><small>Market low</small><b className="mint-text">€109.99</b></div><div><small>Stores tracked</small><b>4</b></div></div><div className="demo-chart"><div className="demo-tooltip">€109.99 <small>−€10</small></div><svg viewBox="0 0 500 130" preserveAspectRatio="none"><path d="M0 31 C45 23 70 40 110 36 S170 51 220 47 S285 56 325 70 S395 66 430 94 S465 93 500 105 L500 130 L0 130Z" fill="#dff4ed"/><path d="M0 31 C45 23 70 40 110 36 S170 51 220 47 S285 56 325 70 S395 66 430 94 S465 93 500 105" fill="none" stroke="#139376" strokeWidth="3"/><path d="M0 61H500" stroke="#173d35" strokeDasharray="5 5"/></svg></div><div className="demo-table"><div><span className="store-dot orange">TN</span><b>TechNest</b><strong>€109.99</strong><em>↓ €10.00</em></div><div><span className="store-dot purple">GH</span><b>GadgetHub</b><strong>€124.99</strong><em className="muted-change">—</em></div><div><span className="store-dot green">EM</span><b>ElectroMart</b><strong>€129.00</strong><em className="up-change">↑ €3.00</em></div></div></section></div>
          <div className="price-alert"><span>↓</span><div><b>Price drop detected</b><small>TechNest · €119.99 → €109.99</small></div><time>now</time></div>
        </div>
      </section>

      <section className="launch-proof"><p>Built for teams that cannot afford to discover price changes too late</p><div><span>Independent shops</span><span>DTC brands</span><span>Marketplaces</span><span>Category managers</span><span>Online retailers</span></div></section>

      <section className="launch-section" id="how-it-works"><div className="section-intro"><span className="section-label">A SIMPLE DAILY ADVANTAGE</span><h2>From website and EAN to<br/>a verified product match.</h2><p>Add one product or import an entire Excel catalogue.</p></div><div className="steps"><article><span>01</span><div className="step-icon">↗</div><h3>Enter website, name &amp; EAN</h3><p>Give PriceWatch the public store website, exact product name, and barcode identifier.</p></article><article><span>02</span><div className="step-icon">⌁</div><h3>We search public pages</h3><p>PriceWatch checks likely same-site pages, prioritizes exact EAN matches, and captures price and stock when available.</p></article><article><span>03</span><div className="step-icon">⇩</div><h3>Import or export Excel</h3><p>Upload multiple products from the template, then export the catalogue with match status and latest results.</p></article></div></section>

      <section className="value-section"><div><span className="section-label light">DESIGNED FOR DECISIONS</span><h2>Your market, without<br/>the manual checking.</h2><p>PriceWatch turns scattered public product pages into a useful daily operating signal.</p><ul><li><Check/><span><b>Price history that compounds</b>Build a reliable record of every observed change.</span></li><li><Check/><span><b>Alerts with context</b>See your price, their price, and the exact difference.</span></li><li><Check/><span><b>Stock intelligence</b>Know when competitor inventory disappears or returns.</span></li></ul></div><div className="alert-stack"><article><span className="alert-arrow down-arrow">↓</span><div><small>PRICE DROP · 18 MIN AGO</small><b>TechNest lowered MX Master 4</b><p>€119.99 <s>→</s> <strong>€109.99</strong></p></div><em>−8.3%</em></article><article><span className="alert-arrow check-arrow">✓</span><div><small>RESTOCK · 2 HOURS AGO</small><b>GadgetHub is back in stock</b><p>Keychron Q6 Max · <strong>€229.00</strong></p></div></article><article><span className="alert-arrow rise-arrow">↑</span><div><small>PRICE INCREASE · YESTERDAY</small><b>ElectroMart raised MX Master 4</b><p>€126.00 <s>→</s> <strong>€129.00</strong></p></div><em className="coral-text">+2.4%</em></article></div></section>

      <section className="responsible-section" id="responsible"><div className="responsible-mark"><Bolt size={25}/></div><div><span className="section-label">RESPONSIBLE BY DESIGN</span><h2>Useful monitoring.<br/>Respectful collection.</h2></div><div><p>PriceWatch is designed for public business information and sensible monitoring—not bypassing access controls.</p><ul><li><Check/>Public product pages only</li><li><Check/>Reasonable request rates</li><li><Check/>Caching to avoid repeat fetches</li><li><Check/>No CAPTCHA or paywall bypass</li></ul></div></section>

      <section className="pricing-section" id="pricing"><div className="section-intro"><span className="section-label">CLEAR, URL-BASED PRICING</span><h2>Start small. Scale when the<br/>signal proves valuable.</h2><p>Try every plan free for 14 days. Hosting and AI-assisted monitoring are included.</p></div><div className="pricing-grid"><article><span>Starter</span><h3>€250<small>/month</small></h3><p>For a focused product range.</p><ul><li><Check/>14-day free trial</li><li><Check/>150 monitored URLs</li><li><Check/>Daily price checks</li><li><Check/>Price history</li><li><Check/>AI-assisted recovery</li></ul><a href="/login?plan=starter">Start free trial</a></article><article className="featured-plan"><div className="popular">MOST POPULAR</div><span>Business</span><h3>€500<small>/month</small></h3><p>For active e-commerce teams.</p><ul><li><Check/>14-day free trial</li><li><Check/>350 monitored URLs</li><li><Check/>4 checks per day</li><li><Check/>Email alerts</li><li><Check/>Stock monitoring</li></ul><a href="/login?plan=business">Start free trial</a></article><article><span>Pro</span><h3>€1,000<small>/month</small></h3><p>For larger catalogues.</p><ul><li><Check/>14-day free trial</li><li><Check/>1,500 monitored URLs</li><li><Check/>Frequent checks</li><li><Check/>CSV and API export</li><li><Check/>Priority AI-assisted recovery</li></ul><a href="/login?plan=pro">Start free trial</a></article><CustomPlan/></div><p className="pricing-note">14 days free with no card required. Prices include platform hosting and a fair-use allowance for AI-assisted checks. Billing is not activated during early access.</p></section>

      <section className="faq-section"><div><span className="section-label">COMMON QUESTIONS</span><h2>Good to know<br/>before you start.</h2></div><div className="faq-list"><details><summary>Which websites can PriceWatch monitor?<span>+</span></summary><p>PriceWatch searches public store pages. It reports blocked or unsupported sites instead of trying to bypass their protections.</p></details><details><summary>What information do I enter?<span>+</span></summary><p>Each product needs a public website, a product name, and a valid EAN, UPC, or GTIN barcode. SKU, notes, and your own price are optional.</p></details><details><summary>Can I add many products?<span>+</span></summary><p>Yes. Download the Excel template and import up to 250 product–website searches per request within your plan limit.</p></details><details><summary>Can PriceWatch bypass blocked pages?<span>+</span></summary><p>No. It does not bypass logins, CAPTCHAs, paywalls, or intentional access controls.</p></details></div></section>

      <section className="final-cta"><span className="section-label light">YOUR NEXT PRICE CHANGE IS COMING</span><h2>See it before it<br/>costs you margin.</h2><p>Start your 14-day free trial and search your first product by website, name, and EAN.</p><a className="launch-button inverted" href="/login">Start free trial <span>→</span></a></section>
      <footer className="launch-footer"><Link className="launch-logo" href="/"><span><Bolt size={16}/></span>PriceWatch</Link><p>Competitive intelligence for focused e-commerce teams.</p><div><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/login">Sign in</a></div><small>© 2026 PriceWatch. Early access.</small></footer>
    </main>
  );
}
