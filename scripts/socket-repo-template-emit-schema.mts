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
logger.success(`wrote ${path.relative(rootDir, outPath)}`)
