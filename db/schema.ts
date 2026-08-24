import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const monitoredProducts = sqliteTable("monitored_products", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  websiteUrl: text("website_url").notNull(),
  productName: text("product_name").notNull(),
  ean: text("ean").notNull(),
  sku: text("sku").notNull().default(""),
  notes: text("notes").notNull().default(""),
  status: text("status").notNull().default("queued"),
  statusMessage: text("status_message").notNull().default("Ready to search"),
  matchedUrl: text("matched_url"),
  resultTitle: text("result_title"),
  priceCents: integer("price_cents"),
  currency: text("currency"),
  inStock: integer("in_stock", { mode: "boolean" }),
  matchType: text("match_type"),
  lastCheckedAt: text("last_checked_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("monitored_products_owner_idx").on(table.ownerEmail),
  uniqueIndex("monitored_products_owner_url_ean_uidx").on(table.ownerEmail, table.websiteUrl, table.ean),
]);

export const monitoredWebsites = sqliteTable("monitored_websites", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  url: text("url").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("monitored_websites_owner_idx").on(table.ownerEmail),
  uniqueIndex("monitored_websites_owner_url_uidx").on(table.ownerEmail, table.url),
]);

export const customSearchProfiles = sqliteTable("custom_search_profiles", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  hostname: text("hostname").notNull().default(""),
  htmlSignature: text("html_signature").notNull().default(""),
  searchUrlTemplate: text("search_url_template").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
