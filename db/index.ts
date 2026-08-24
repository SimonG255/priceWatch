import { env } from "cloudflare:workers";
import { sql } from "drizzle-orm";
import { drizzle as drizzleD1 } from "drizzle-orm/d1";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const globalWithDb = globalThis as typeof globalThis & {
  __pricewatch_pg?: ReturnType<typeof postgres>;
  __pricewatch_db?: ReturnType<typeof drizzlePg<typeof schema>>;
};

export function getDb(): any {
  const databaseUrl = process.env.DATABASE_URL?.trim() || process.env.DIRECT_URL?.trim();
  if (databaseUrl) {
    if (!globalWithDb.__pricewatch_pg) {
      globalWithDb.__pricewatch_pg = postgres(databaseUrl, { prepare: false, max: 10 });
    }
    if (!globalWithDb.__pricewatch_db) {
      globalWithDb.__pricewatch_db = drizzlePg(globalWithDb.__pricewatch_pg, { schema });
    }
    return globalWithDb.__pricewatch_db as any;
  }

  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database.",
    );
  }

  return drizzleD1(env.DB, { schema }) as any;
}

let productsSchemaReady: Promise<void> | null = null;

/**
 * Schema evolution is handled by the versioned Drizzle migrations packaged
 * with every Sites deployment. Request handlers perform one cheap readiness
 * check per isolate instead of issuing dozens of runtime DDL statements.
 */
export async function ensureProductsSchema() {
  const databaseUrl = process.env.DATABASE_URL?.trim() || process.env.DIRECT_URL?.trim();
  if (databaseUrl) {
    if (!productsSchemaReady) {
      productsSchemaReady = getDb()
        .execute(sql`SELECT 1 FROM monitored_products LIMIT 1`)
        .then(() => undefined)
        .catch((error: unknown) => {
          productsSchemaReady = null;
          throw new Error("PriceWatch database migrations are not ready.", { cause: error });
        });
    }
    return productsSchemaReady;
  }

  if (!env.DB) throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  if (!productsSchemaReady) {
    productsSchemaReady = env.DB.prepare("SELECT 1 FROM monitored_products LIMIT 1")
      .first()
      .then(() => undefined)
      .catch((error: unknown) => {
        productsSchemaReady = null;
        throw new Error("PriceWatch database migrations are not ready.", { cause: error });
      });
  }
  return productsSchemaReady;
}
