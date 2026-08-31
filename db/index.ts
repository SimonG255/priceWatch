import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const globalWithDb = globalThis as typeof globalThis & {
  __pricewatch_pg?: ReturnType<typeof postgres>;
  __pricewatch_db?: ReturnType<typeof drizzle<typeof schema>>;
  __pricewatch_db_url?: string;
};

function normalizeDatabaseUrl(rawUrl: string) {
  const trimmed = rawUrl.trim();
  if (!trimmed) return "";

  try {
    new URL(trimmed);
    return trimmed;
  } catch {
    // Some Supabase passwords include reserved URL characters such as [ ] ? = .
    // Postgres accepts those only when they are percent-encoded.
    const match = trimmed.match(/^((?:postgres|postgresql):\/\/)([^:@/]+):([^@]+)@(.+)$/i);
    if (!match) return trimmed;

    const [, scheme, username, password, rest] = match;
    return `${scheme}${username}:${encodeURIComponent(password)}@${rest}`;
  }
}

export function getDatabaseUrl() {
  const connectionString = normalizeDatabaseUrl(
    process.env.DATABASE_URL?.trim() ?? process.env.SUPABASE_DB_URL?.trim() ?? process.env.DIRECT_URL?.trim() ?? "",
  );

  if (!connectionString || !/^postgres(?:ql)?:\/\//i.test(connectionString)) {
    throw new Error(
      "Supabase database connection string is not configured. Set DIRECT_URL, SUPABASE_DB_URL, or DATABASE_URL.",
    );
  }

  return connectionString;
}

export function getDb() {
  const connectionString = getDatabaseUrl();
  const usesTransactionPooler = /:6543(?:\/|$)/.test(connectionString);

  if (!globalWithDb.__pricewatch_pg || globalWithDb.__pricewatch_db_url !== connectionString) {
    globalWithDb.__pricewatch_pg = postgres(connectionString, {
      max: 1,
      connect_timeout: 8,
      idle_timeout: 20,
      max_lifetime: 300,
      prepare: !usesTransactionPooler,
      ssl: "require",
    });
    globalWithDb.__pricewatch_db = drizzle(globalWithDb.__pricewatch_pg, { schema });
    globalWithDb.__pricewatch_db_url = connectionString;
  }

  return globalWithDb.__pricewatch_db!;
}

let productsSchemaReady: Promise<void> | null = null;

export async function ensureProductsSchema() {
  if (!productsSchemaReady) {
    productsSchemaReady = getDb()
      .execute(sql`SELECT 1 FROM monitored_products LIMIT 1`)
      .then(() => undefined)
      .catch((error: unknown) => {
        productsSchemaReady = null;

        const messages: string[] = [];
        let currentError: unknown = error;
        while (currentError) {
          if (currentError instanceof Error) {
            messages.push(currentError.message);
            currentError = currentError.cause;
          } else if (typeof currentError === "object") {
            const candidate = currentError as { code?: unknown; message?: unknown; cause?: unknown };
            if (candidate.code) messages.push(String(candidate.code));
            if (candidate.message) messages.push(String(candidate.message));
            currentError = candidate.cause;
          } else {
            messages.push(String(currentError));
            break;
          }
        }
        const isAuthFailure = messages.some(
          (message) => message.includes("password authentication failed") || message.includes("28P01"),
        );

        throw new Error(
          isAuthFailure
            ? "Nexus database credentials are invalid or stale. Update DIRECT_URL/SUPABASE_DB_URL/DATABASE_URL with the current Supabase connection string from the project dashboard."
            : "Nexus database migrations are not ready.",
          { cause: error },
        );
      });
  }
  return productsSchemaReady;
}
