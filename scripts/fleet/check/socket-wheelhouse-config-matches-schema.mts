/*
 * @file CI gate: the per-repo socket-wheelhouse config, when present, validates
 *   against the fleet TypeBox schema (scripts/fleet/socket-wheelhouse-schema.mts)
 *   — the same source the emitted .config/repo/socket-wheelhouse-schema.json
 *   derives from, so editor `$schema` hints and this gate can never disagree.
 *   The loader (loadSocketWheelhouseConfig) is deliberately fail-open for
 *   robustness in hooks; this check is where drift fails LOUD.
 *
 *   Fail-open (exit 0) when no config exists — a repo without one is legal.
 *   Exit codes: 0 — valid / absent; 1 — the config drifts from the schema
 *   (every violation printed with its JSON path).
 */

import process from 'node:process'

import { Value } from 'typebox/value'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { loadSocketWheelhouseConfig, REPO_ROOT } from '../paths.mts'
import { SocketWheelhouseConfigSchema } from '../socket-wheelhouse-schema.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

export function collectSchemaErrors(value: unknown): readonly string[] {
  if (Value.Check(SocketWheelhouseConfigSchema, value)) {
    return []
  }
  const errors: string[] = []
  for (const error of Value.Errors(SocketWheelhouseConfigSchema, value)) {
    // `instancePath` is the JSON Pointer to the offending value; it is empty
    // for a violation on the root object, which reads better as `/`.
    errors.push(`${error.instancePath || '/'}: ${error.message}`)
  }
  return errors
}

export interface RunCheckResult {
  readonly errors: readonly string[]
  readonly location: string | undefined
}

export function runCheck(rootDir: string): RunCheckResult {
  const loaded = loadSocketWheelhouseConfig(rootDir)
  if (!loaded) {
    return { errors: [], location: undefined }
  }
  return {
    errors: collectSchemaErrors(loaded.value),
    location: loaded.location.path,
  }
}

export function main(): void {
  // --root <dir> seams the repo root for tests spawning against fixture dirs.
  const argv = process.argv.slice(2)
  const rootFlagIndex = argv.indexOf('--root')
  const rootOverride =
    rootFlagIndex !== -1 ? argv[rootFlagIndex + 1] : undefined
  const { errors, location } = runCheck(rootOverride ?? REPO_ROOT)
  if (!location) {
    logger.success('no socket-wheelhouse config present; nothing to validate')
    return
  }
  if (!errors.length) {
    logger.success(`socket-wheelhouse config matches the schema (${location})`)
    return
  }
  logger.fail('socket-wheelhouse config drifts from the fleet schema.')
  logger.group()
  logger.error(`Where: ${location}`)
  logger.error(
    `Saw ${errors.length} violation(s); wanted a schema-valid config:`,
  )
  for (const e of errors) {
    logger.error(`  ${e}`)
  }
  logger.error(
    'Fix: correct the flagged fields against scripts/fleet/socket-wheelhouse-schema.mts ' +
      '(the emitted .config/repo/socket-wheelhouse-schema.json documents every field).',
  )
  logger.groupEnd()
  process.exitCode = 1
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'validates the per-repo socket-wheelhouse config against the fleet schema',
  help: `Usage: node scripts/fleet/check/socket-wheelhouse-config-matches-schema.mts [flags]
  --root <dir>  repo root to validate instead of this repo`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
