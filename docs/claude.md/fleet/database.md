# Database & ORM

When a fleet repo needs a database, the stack is fixed: **PostgreSQL** as the engine, **Drizzle ORM** as the query/schema layer, and **`node:smol-sql`** as the driver on the node-smol runtime. This is the stack `depot` runs in production; new repos copy it rather than re-deciding.

## The choices, and why

- **Postgres, not SQLite/MySQL/Mongo.** depot standardized on Postgres; the fleet follows so schemas, migrations, and operational knowledge transfer across repos. `node:smol-sql` speaks Postgres natively (it's a unified PG + SQLite interface), so a node-smol-based service needs no external driver dependency for PG.
- **Drizzle ORM, not Prisma/Kysely/TypeORM/raw SQL.** Drizzle is TypeScript-first, ships its schema as code (no separate DSL), and has a thin runtime. depot uses `drizzle-orm/pg-core` for table definitions and the typed query builder.
- **`node:smol-sql` as the driver.** node-smol ships a Bun-compatible `SQL` class (`new SQL('postgres://…')`). Drizzle's `drizzle-orm/bun-sql` adapter binds to that shape, so on the node-smol runtime the driver is built in. Off node-smol (or in tooling that runs on stock Node today), use `drizzle-orm/postgres-js` with the `postgres` npm driver as the fallback; the schema and query code are identical across both adapters.
- **`pglite` for tests.** `@electric-sql/pglite` + `drizzle-orm/pglite` give an in-process Postgres with no external server, so CI and unit tests run the real dialect without a container. depot's test-helpers wire this.

## Layout (per data-owning package)

```
packages/<pkg>/
  .config/drizzle.config.mts     # drizzle-kit config (NOT root drizzle.config.ts)
  schema/
    index.mts                    # re-exports every table + relations
    <domain>.mts                 # pg-core table defs, one file per domain
  db.mts                         # createDb() factory: driver + pooled client + schema bind
  migrations/                    # drizzle-kit generated .sql (NOT .mts)
```

All TypeScript files are `.mts` per the fleet `.mts`-runner rule: config, schema, and `db.mts`. drizzle-kit's esbuild-based loader reads `.mts` for both the config and the `schema:` target (verified, drizzle-kit 0.31.9). The one exception is `migrations/`: drizzle-kit _generates_ those as plain `.sql` DDL files (+ a `meta/` snapshot dir), not TypeScript. They're generated data artifacts, like a lockfile, so the `.mts` rule does not apply; never hand-rename a migration to `.mts`.

- **`.config/drizzle.config.mts`**, not a root `drizzle.config.ts`. Per the fleet `.config/` placement + `.mts`-runner rules. drizzle-kit reads it via `--config .config/drizzle.config.mts`.
- **`schema/` directory**, one file per domain, with an `index.mts` barrel that `db.mts` binds. Don't inline tables in `db.mts`.
- **`db.mts` is the single client factory.** One `createDb(options)` that takes pool config as typed options (no `process.env` reads inside it) plus a `createDbFromEnv()` that reads the DB URL env var. depot's `packages/store/db.ts` is the reference shape (depot predates the fleet `.mts` convention; new repos use `.mts`).

## .config/drizzle.config.mts

Generic, repo-agnostic: no table definitions, no repo-specific schema
paths or database name. Copy verbatim; the only thing a repo supplies is
its `DATABASE_URL`.

```ts
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  // Paths are resolved relative to the directory drizzle-kit runs in
  // (process cwd = package root), NOT the config file's location. So
  // `./schema` / `./migrations` stay package-root-relative even though
  // the config itself lives under `.config/`.
  schema: './schema/index.mts',
  out: './migrations',
  dbCredentials: {
    // URL env var is an APPLICATION convention, not Postgres-native:
    // neither drizzle-kit nor the postgres.js driver auto-reads it, and
    // libpq has no single-URL env var. We read POSTGRES_URL first, then
    // DATABASE_URL (the order node:smol-sql uses), and pass the string
    // explicitly. See "Env var precedence" below for the full chain.
    url: process.env['POSTGRES_URL'] ?? process.env['DATABASE_URL']!,
  },
})
```

drizzle-kit accepts the `.mts` extension and an explicit `--config` path
(verified with drizzle-kit 0.31.9: its esbuild-based loader bundles
`.config/drizzle.config.mts` and runs). Invoke from the package root so
the cwd-relative `schema` / `out` paths resolve:

```bash
pnpm exec drizzle-kit generate --config .config/drizzle.config.mts
pnpm exec drizzle-kit migrate  --config .config/drizzle.config.mts
```

Wire those as `db:generate` / `db:migrate` package scripts so callers
never retype the `--config` path.

## Driver wiring

node-smol runtime (preferred):

```ts
import { drizzle } from 'drizzle-orm/bun-sql'
import { SQL } from 'node:smol-sql'

const url = process.env['POSTGRES_URL'] ?? process.env['DATABASE_URL']
const client = new SQL(url)
export const db = drizzle({ client, schema })
```

Stock-Node fallback (tooling, pre-node-smol services):

```ts
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

const client = postgres(url, { max: poolSize, connect_timeout, idle_timeout })
export const db = drizzle(client, { schema })
```

The `schema` import and every query built on `db` are identical between the two. Only the import line + client constructor differ, so migrating a repo onto node-smol is a one-file change in `db.mts`.

## Env var precedence

There are two layers, and only one of them is Postgres-native:

1. **Single connection-URL env var: an application convention, not a Postgres feature.** libpq defines no single-URL env var, and neither the `postgres.js` driver nor drizzle-kit auto-reads one. So `createDbFromEnv()` reads it and passes the string explicitly. Order: **`POSTGRES_URL` → `DATABASE_URL`** (the same precedence `node:smol-sql` uses). Prefer `POSTGRES_URL` (engine-specific, unambiguous when a service talks to more than one datastore); fall back to `DATABASE_URL` (the 12-factor / Heroku norm) so a single-DB host that only sets the generic name still works.

2. **Discrete libpq vars: the actual Postgres-native fallback.** `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD` (Postgres docs §34.15). These do NOT assemble into a URL; they are a separate connection-input mechanism that libpq consumes parameter-by-parameter. When no URL env is set, the connection string reaching `PQconnectdb` is empty, and libpq fills each unset parameter from its own `PG*` var (host from `PGHOST`, dbname from `PGDATABASE`, etc.), then a built-in default. No URL is ever built from them. This is what Postgres itself supports, so it's the bottom of the chain and works in any standard PG environment (CI containers, managed PG that injects `PG*`).

Full precedence: explicit `url` argument → `POSTGRES_URL` → `DATABASE_URL` → libpq `PG*` (consumed natively by libpq, not assembled into a URL). Don't invent a repo-specific env var name; the chain above is the fleet standard.

**C++/JS parity.** In `node:smol-sql`, env resolution is single-sourced in the JS layer (`POSTGRES_URL || DATABASE_URL`); the C++ binding takes the resolved connection string as a required input and hands it to `PQconnectdb`, which applies the `PG*` fallback. The C++ side reads no connection env var of its own, so the two halves can't drift on precedence. Keep it that way: a `getenv("DATABASE_URL")` added to the C++ pool would create a second resolution point and break the alignment.

## Validation: typebox, not the ORM

Drizzle covers the database boundary (table shape, query types). For validating data crossing a _wire_ boundary (API request/response, config files, IPC payloads), use **`@sinclair/typebox`**, the fleet's canonical schema-validation library. Don't reach for zod / valibot / ajv-with-hand-schemas. depot's `packages/types` defines its exposed + internal types as TypeBox schemas. The two layers are complementary: typebox guards what comes in off the wire, Drizzle types what goes to the database.

## When NOT to add a database

Most fleet repos are libraries, parsers, or CLIs with no persistent state; they need no database at all. Don't add Drizzle/Postgres speculatively. The stack applies only when a repo genuinely persists relational state (a service, a registry API, an events store). A cache or a flat-file index is not a database need.

## Reference implementation

`depot/packages/store/` is the canonical worked example: `db.ts` (pooled postgres-js client with typed pool options), `schema/` (pg-core tables), `drizzle.config.ts` (being migrated to `.config/drizzle.config.mts` per fleet convention), and pglite-backed test-helpers. `depot/packages/events-store/` shows a second data domain with the same shape.
