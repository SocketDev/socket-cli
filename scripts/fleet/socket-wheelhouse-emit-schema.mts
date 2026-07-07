/**
 * @file Emit `socket-wheelhouse-schema.json` from the TypeBox source. Run via
 *   `pnpm run socket-wheelhouse:emit-schema` from a fleet repo (the worktree
 *   where TypeBox is installed). Mirrors the lockstep emit pattern.
 *   WHEELHOUSE-AWARE: when a `template/base/` tree exists, the schema is
 *   written to the canonical `template/base/.config/` path so the dogfood
 *   cascade propagates it to every member — writing only to the live
 *   `.config/` would be reverted by the next cascade. A member writes its own
 *   live `.config/` directly.
 */

import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from './paths.mts'
import { SocketWheelhouseConfigSchema } from './socket-wheelhouse-schema.mts'

const logger = getDefaultLogger()

/**
 * The directory holding the CANONICAL schema file. In the wheelhouse that is
 * `template/base/.config/` — its live tree is cascade-generated, so a write
 * to live would be reverted by the next dogfood cascade. A member has no
 * `template/base/`, so it writes its own live `.config/` directly.
 */
function canonicalConfigDir(): string {
  const templateBase = path.join(REPO_ROOT, 'template', 'base')
  return existsSync(templateBase)
    ? path.join(templateBase, '.config')
    : path.join(REPO_ROOT, '.config')
}

// Schema lives in `.config/` next to the per-repo
// `.config/socket-wheelhouse.json` it describes — the marker's
// `$schema` ref is `./socket-wheelhouse-schema.json`.
const outPath = path.join(canonicalConfigDir(), 'socket-wheelhouse-schema.json')

const enriched = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://github.com/SocketDev/socket-wheelhouse-schema.json',
  title: 'socket-wheelhouse per-repo config',
  ...SocketWheelhouseConfigSchema,
}

writeFileSync(outPath, JSON.stringify(enriched, null, 2) + '\n', 'utf8')

// Run oxfmt on the output so the file matches what oxfmt would
// produce. Without this, `pnpm run check --all` (which runs oxfmt
// over the tree) would flag the emitted schema as drifted on every
// repo that re-emits it. The schema is in IDENTICAL_FILES, so the
// formatted form is the byte-canonical form fleet-wide.
await spawn(
  'pnpm',
  ['exec', 'oxfmt', '-c', '.config/fleet/oxfmtrc.json', outPath],
  {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  },
)

logger.success(`wrote ${path.relative(REPO_ROOT, outPath)}`)
