import type { MetadataRoute } from "next";

const origin = "https://pricewatch-monitor.simongajsek6.chatgpt.site";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: origin, lastModified: new Date("2026-08-22"), changeFrequency: "weekly", priority: 1 },
    { url: `${origin}/privacy`, lastModified: new Date("2026-08-22"), changeFrequency: "yearly", priority: 0.3 },
    { url: `${origin}/terms`, lastModified: new Date("2026-08-22"), changeFrequency: "yearly", priority: 0.3 },
  ];
}
