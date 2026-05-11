/**
 * @fileoverview Emit `socket-wheelhouse-schema.json` from the
 * TypeBox source.
 *
 * Run via `pnpm run socket-wheelhouse:emit-schema` from a fleet
 * repo (the worktree where TypeBox is installed). Mirrors the lockstep
 * emit pattern.
 */

import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { spawn } from '@socketsecurity/lib/spawn'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { SocketRepoTemplateConfigSchema } from './socket-wheelhouse-schema.mts'

const logger = getDefaultLogger()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
// Schema lives in `.config/` next to the per-repo
// `.config/socket-wheelhouse.json` it describes — the marker's
// `$schema` ref is `./socket-wheelhouse-schema.json`.
const outPath = path.join(
  rootDir,
  '.config',
  'socket-wheelhouse-schema.json',
)

const enriched = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://github.com/SocketDev/socket-wheelhouse-schema.json',
  title: 'socket-wheelhouse per-repo config',
  ...SocketRepoTemplateConfigSchema,
}

writeFileSync(outPath, JSON.stringify(enriched, null, 2) + '\n', 'utf8')

// Run oxfmt on the output so the file matches what oxfmt would
// produce. Without this, `pnpm run check --all` (which runs oxfmt
// over the tree) would flag the emitted schema as drifted on every
// repo that re-emits it. The schema is in IDENTICAL_FILES, so the
// formatted form is the byte-canonical form fleet-wide.
await spawn('pnpm', ['exec', 'oxfmt', outPath], {
  cwd: rootDir,
  stdio: 'inherit',
})

logger.success(`wrote ${path.relative(rootDir, outPath)}`)
