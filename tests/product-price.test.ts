import assert from "node:assert/strict";
import test from "node:test";
import { extractProductMatch, parsePriceCents } from "../lib/product-extraction.ts";

test("selects the JSON-LD product whose EAN matches", () => {
  const html = `
    <html><head><title>Search results</title></head><body>
      <div>Shipping €4.99</div>
      <script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org",
        "@graph": [
          { "@type": "Product", name: "Related keyboard", gtin13: "4000000000001", offers: { "@type": "Offer", price: "49.99", priceCurrency: "EUR" } },
          { "@type": "Product", name: "Logitech MX Master 4", gtin13: "5099206123456", url: "/mx-master-4", offers: { "@type": "Offer", price: "109.99", priceCurrency: "EUR", availability: "https://schema.org/InStock" } },
        ],
      })}</script>
    </body></html>`;
  const result = extractProductMatch(html, "https://shop.example/search", "Logitech MX Master 4", "5099206123456");
  assert.equal(result.priceCents, 10999);
  assert.equal(result.currency, "EUR");
  assert.equal(result.url, "https://shop.example/mx-master-4");
  assert.equal(result.priceSource, "structured");
});

test("prefers a current price element over crossed-out and shipping prices", () => {
  const html = `
    <html><head><meta property="og:title" content="Logitech MX Master 4"></head><body>
      <h1>Logitech MX Master 4</h1><p>EAN: 5099206123456</p>
      <div class="shipping-price">Delivery €4,99</div>
      <span class="old-price"><del>€129,99</del></span>
      <span class="current-price">€109,90</span>
      <div class="related-price">€39,99</div>
    </body></html>`;
  const result = extractProductMatch(html, "https://shop.example/mx-master-4", "Logitech MX Master 4", "5099206123456");
  assert.equal(result.priceCents, 10990);
  assert.equal(result.currency, "EUR");
  assert.equal(result.priceSource, "product-element");
});

test("parses common European and US price formats", () => {
  assert.equal(parsePriceCents("€1.299,99"), 129999);
  assert.equal(parsePriceCents("$1,299.99"), 129999);
  assert.equal(parsePriceCents("1 299,95 EUR"), 129995);
});

test("returns no price when only shipping and unrelated prices are present", () => {
  const html = `
    <html><head><title>Logitech MX Master 4</title></head><body>
      <h1>Logitech MX Master 4</h1><p>EAN 5099206123456</p>
      <aside>Shipping €4.99</aside><section>Related products from €29.99</section>
    </body></html>`;
  const result = extractProductMatch(html, "https://shop.example/mx-master-4", "Logitech MX Master 4", "5099206123456");
  assert.equal(result.priceCents, undefined);
});

test("uses AggregateOffer lowPrice when an exact product publishes a range", () => {
  const html = `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org", "@type": "Product", name: "Sony WH-1000XM6", gtin13: "4548736160000",
    offers: { "@type": "AggregateOffer", lowPrice: "349,00", highPrice: "399,00", priceCurrency: "EUR" },
  })}</script>`;
  const result = extractProductMatch(html, "https://shop.example/sony", "Sony WH-1000XM6", "4548736160000");
  assert.equal(result.priceCents, 34900);
});
