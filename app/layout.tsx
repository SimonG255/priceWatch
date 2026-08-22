import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://pricewatch-monitor.simongajsek6.chatgpt.site"),
  title: {
    default: "PriceWatch — Competitor price monitoring",
    template: "%s · PriceWatch",
  },
  description: "Track competitor prices and stock automatically. See every market move, protect your margins, and act from one focused dashboard.",
  openGraph: {
    type: "website",
    title: "PriceWatch — Know when the market moves.",
    description: "Competitor price and stock monitoring for focused e-commerce teams.",
    url: "/",
    siteName: "PriceWatch",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "PriceWatch — Know when the market moves." }],
  },
  twitter: {
    card: "summary_large_image",
    title: "PriceWatch — Know when the market moves.",
    description: "Competitor price and stock monitoring for focused e-commerce teams.",
    images: ["/og.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
