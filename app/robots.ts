import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{
      userAgent: "*",
      allow: ["/", "/privacy", "/terms"],
      disallow: ["/admin", "/api", "/auth", "/callback", "/dashboard", "/login", "/reset-password", "/signin-with-chatgpt", "/signout-with-chatgpt"],
    }],
    sitemap: "https://pricewatch-monitor.simongajsek6.chatgpt.site/sitemap.xml",
  };
}
