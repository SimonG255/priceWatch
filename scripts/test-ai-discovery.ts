import { discoverProductPageUrls } from "../lib/ai-product-discovery.ts";

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("Set OPENAI_API_KEY in your environment or .env.local before running.");
    process.exit(1);
  }
  const websiteUrl = process.argv[2] || "https://www.example.com/";
  const productName = process.argv[3] || "Example Product";
  const ean = process.argv[4] || "0000000000000";
  const result = await discoverProductPageUrls({ websiteUrl, productName, ean, apiKey });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
