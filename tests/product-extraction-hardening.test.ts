import assert from "node:assert/strict";
import test from "node:test";
import { extractProductMatch } from "../lib/product-extraction.ts";

const productName = "Acme Coffee Machine X1";
const ean = "1234567890123";
const url = "https://shop.example/products/x1";

test("does not manufacture product identity from the requested input", () => {
  const empty = extractProductMatch("<html><body></body></html>", url, productName, ean);
  assert.equal(empty.title, "");
  assert.equal(empty.nameScore, 0);
  assert.equal(empty.eanMatch, false);
  const echoed = extractProductMatch(`<html><body><input value="${ean}"></body></html>`, url, productName, ean);
  assert.equal(echoed.eanMatch, false);
});

test("prefers sale metadata over the regular product price", () => {
  const match = extractProductMatch(`<html><head>
    <meta property="product:price:amount" content="100.00">
    <meta property="product:sale_price:amount" content="80.00">
    <meta property="product:price:currency" content="EUR">
  </head><body><h1>${productName}</h1><p>EAN ${ean}</p></body></html>`, url, productName, ean);
  assert.equal(match.priceCents, 8000);
  assert.equal(match.currency, "EUR");
});

test("resolves a linked JSON-LD offer by @id", () => {
  const match = extractProductMatch(`<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Product", name: productName, gtin13: ean, offers: { "@id": "#offer" } },
      { "@id": "#offer", "@type": "Offer", price: "49.90", priceCurrency: "EUR", availability: "https://schema.org/InStock", url },
    ],
  })}</script>`, url, productName, ean);
  assert.equal(match.priceCents, 4990);
  assert.equal(match.structuredExactEan, true);
  assert.equal(match.inStock, true);
});

test("detects localized and negative stock phrases in the right order", () => {
  const base = (availability: string) => `<html><body><h1>${productName}</h1><p>EAN ${ean}</p><div class="current-price">€20.00</div><p>${availability}</p></body></html>`;
  assert.equal(extractProductMatch(base("Not available"), url, productName, ean).inStock, false);
  assert.equal(extractProductMatch(base("Ni na zalogi"), url, productName, ean).inStock, false);
  assert.equal(extractProductMatch(base("Na zalogi"), url, productName, ean).inStock, true);
});
