import { sameStoreHostname } from "./site-search-profiles.ts";

type DiscoveryInput = {
  websiteUrl: string;
  productName: string;
  ean: string;
  apiKey?: string;
};

export type AiDiscoveryResult = {
  attempted: boolean;
  urls: string[];
  error?: string;
};

export async function discoverProductPageUrls(input: DiscoveryInput): Promise<AiDiscoveryResult> {
  const apiKey = input.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) return { attempted: false, urls: [] };

  const root = new URL(input.websiteUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_DISCOVERY_MODEL || "gpt-5.6-luna",
        reasoning: { effort: "low" },
        tools: [{ type: "web_search", filters: { allowed_domains: [root.hostname] } }],
        tool_choice: "required",
        include: ["web_search_call.action.sources"],
        max_tool_calls: 2,
        max_output_tokens: 500,
        store: false,
        input: `Find the exact public product-detail page on ${root.hostname}. Product name: ${input.productName}. EAN/GTIN: ${input.ean}. Prioritize a page that visibly contains the exact EAN. Do not use other domains and do not guess a price.`,
      }),
    });
    if (!response.ok) return { attempted: true, urls: [], error: `AI discovery returned ${response.status}.` };
    const payload = await response.json() as unknown;
    return { attempted: true, urls: extractAiCandidateUrls(payload, root) };
  } catch (error) {
    return { attempted: true, urls: [], error: error instanceof Error && error.name === "AbortError" ? "AI discovery timed out." : "AI discovery was unavailable." };
  } finally {
    clearTimeout(timer);
  }
}

export function extractAiCandidateUrls(payload: unknown, root: URL) {
  if (!payload || typeof payload !== "object") return [];
  const output = Array.isArray((payload as { output?: unknown[] }).output) ? (payload as { output: unknown[] }).output : [];
  const candidates: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (record.type === "web_search_call") {
      const action = record.action && typeof record.action === "object" ? record.action as Record<string, unknown> : {};
      if (Array.isArray(action.sources)) for (const source of action.sources) {
        if (source && typeof source === "object" && typeof (source as { url?: unknown }).url === "string") candidates.push((source as { url: string }).url);
      }
    }
    if (record.type === "message" && Array.isArray(record.content)) for (const content of record.content) {
      if (!content || typeof content !== "object" || !Array.isArray((content as { annotations?: unknown[] }).annotations)) continue;
      for (const annotation of (content as { annotations: unknown[] }).annotations) {
        if (annotation && typeof annotation === "object" && typeof (annotation as { url?: unknown }).url === "string") candidates.push((annotation as { url: string }).url);
      }
    }
  }

  const seen = new Set<string>();
  const urls: string[] = [];
  for (const value of candidates) {
    try {
      const url = new URL(value);
      url.hash = "";
      if (!["http:", "https:"].includes(url.protocol) || !sameStoreHostname(url.hostname, root.hostname)) continue;
      const normalized = url.toString();
      if (!seen.has(normalized)) { seen.add(normalized); urls.push(normalized); }
    } catch { /* Invalid AI sources are ignored. */ }
  }
  return urls.slice(0, 5);
}
