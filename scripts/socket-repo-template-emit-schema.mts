/**
 * @fileoverview Emit `socket-repo-template-schema.json` from the
 * TypeBox source.
 *
 * Run via `pnpm run socket-repo-template:emit-schema` from a fleet
 * repo (the worktree where TypeBox is installed). Mirrors the xport
 * emit pattern.
 */

import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { spawn } from '@socketsecurity/lib/spawn'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { SocketRepoTemplateConfigSchema } from './socket-repo-template-schema.mts'

const logger = getDefaultLogger()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const outPath = path.join(rootDir, 'socket-repo-template-schema.json')

const enriched = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://github.com/SocketDev/socket-repo-template-schema.json',
  title: 'socket-repo-template per-repo config',
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
