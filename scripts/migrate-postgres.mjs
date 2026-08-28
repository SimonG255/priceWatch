import { readFile } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import postgres from "postgres";

try {
  process.loadEnvFile(".env.local");
} catch {
  // Production environments provide variables through the process environment.
}

function databaseUrl() {
  const raw = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL ?? process.env.DIRECT_URL ?? "";
  if (!raw || !/^postgres(?:ql)?:\/\//i.test(raw)) {
    throw new Error("Set DATABASE_URL, SUPABASE_DB_URL, or DIRECT_URL to a PostgreSQL connection string.");
  }
  try {
    new URL(raw);
    return raw;
  } catch {
    const match = raw.match(/^((?:postgres|postgresql):\/\/)([^:@/]+):([^@]+)@(.+)$/i);
    if (!match) return raw;
    const [, scheme, username, password, rest] = match;
    return `${scheme}${username}:${encodeURIComponent(password)}@${rest}`;
  }
}

const migrationsDirectory = join(process.cwd(), "drizzle-postgres");
const migrationFiles = (await readdir(migrationsDirectory))
  .filter((file) => /^\d+_.+\.sql$/.test(file))
  .sort();

if (!migrationFiles.length) {
  console.log("No PostgreSQL migrations found.");
  process.exit(0);
}

const sql = postgres(databaseUrl(), {
  max: 1,
  prepare: false,
  ssl: "require",
});

try {
  await sql.begin(async (transaction) => {
    await transaction`select pg_advisory_xact_lock(hashtext('pricewatch-postgres-migrations'))`;
    await transaction`create table if not exists public.pricewatch_schema_migrations (
      id text primary key,
      applied_at timestamptz not null default now()
    )`;

    const appliedRows = await transaction`select id from public.pricewatch_schema_migrations`;
    const applied = new Set(appliedRows.map((row) => row.id));
    let appliedCount = 0;

    for (const file of migrationFiles) {
      if (applied.has(file)) continue;
      const contents = await readFile(join(migrationsDirectory, file), "utf8");
      for (const statement of contents.split(/^\s*--\s*statement-breakpoint\s*$/m).map((item) => item.trim()).filter(Boolean)) {
        await transaction.unsafe(statement);
      }
      await transaction`insert into public.pricewatch_schema_migrations (id) values (${file})`;
      console.log(`Applied ${file}`);
      appliedCount += 1;
    }

    if (!appliedCount) console.log("PostgreSQL schema is already up to date.");
  });
} finally {
  await sql.end({ timeout: 5 });
}
