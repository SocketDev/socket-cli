/**
 * @file Emit `socket-wheelhouse-schema.json` from the TypeBox source. Run via
 *   `pnpm run socket-wheelhouse:emit-schema` from a fleet repo (the worktree
 *   where TypeBox is installed). Mirrors the lockstep emit pattern. The schema
 *   is a per-repo artifact derived from the fleet-canonical TypeBox source: it
 *   is written next to the per-repo config at `.config/repo/`, whose `$schema`
 *   ref is the sibling `./socket-wheelhouse-schema.json`. `.config/repo/` is
 *   the repo-owned tier (not cascaded), so every repo emits its own copy from
 *   the identical source rather than receiving a byte-mirrored one.
 */

import { writeFileSync } from 'node:fs'
import path from 'node:path'

import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from './paths.mts'
import { SocketWheelhouseConfigSchema } from './socket-wheelhouse-schema.mts'
import { isMainModule } from './_shared/is-main-module.mts'

const logger = getDefaultLogger()

// Schema lives in `.config/repo/` next to the per-repo
// `.config/repo/socket-wheelhouse.json` it describes — the marker's
// `$schema` ref is the sibling `./socket-wheelhouse-schema.json`.
const outPath = path.join(
  REPO_ROOT,
  '.config',
  'repo',
  'socket-wheelhouse-schema.json',
)

export function buildSocketWheelhouseSchemaDocument(): Record<string, unknown> {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://github.com/SocketDev/socket-wheelhouse-schema.json',
    title: 'socket-wheelhouse per-repo config',
    ...SocketWheelhouseConfigSchema,
  }
}

export async function main(): Promise<void> {
  writeFileSync(
    outPath,
    JSON.stringify(buildSocketWheelhouseSchemaDocument(), null, 2) + '\n',
    'utf8',
  )

  // Format the output through the package.json wrapper (it owns the config +
  // ignore set; never a bare oxfmt invocation). Without this, `pnpm run check
  // --all` would flag the emitted schema as drifted on every repo that
  // re-emits it.
  await spawn('pnpm', ['run', 'format', outPath], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  })

  logger.success(`wrote ${path.relative(REPO_ROOT, outPath)}`)
}

if (isMainModule(import.meta.url)) {
  void main()
}
