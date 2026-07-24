#!/usr/bin/env node
// Generator + drift gate for the canonical JSON Schema published from the fleet's
// TypeBox external-tools schema. The TypeBox schema in
// scripts/fleet/lib/external-tools-schema.mts is the single source of truth (it
// drives the runtime validator check/external-tools-are-valid.mts); this emits
// the JSON-Schema artifact every external-tools.json references via `$schema`,
// hosted canonically in WHEELHOUSE (not socket-btm) so editors/IDEs resolve one
// schema. Regenerate on a schema change; --check fails on drift.
//
// Usage:
//   node scripts/fleet/external-tools/schema.mts          (re)write the file
//   node scripts/fleet/external-tools/schema.mts --check  exit 1 on drift

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
// oxlint-disable-next-line socket/prefer-async-spawn -- generator main() is sync (writeFileSync); the in-place oxfmt pass below must run before main returns
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { ToolsConfig } from '../lib/external-tools-schema.mts'
import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

// Canonical wheelhouse-hosted URL every external-tools.json points its `$schema`
// at. Raw GitHub on the default branch so editor schema resolution works without
// a publish step.
export const SCHEMA_ID =
  'https://raw.githubusercontent.com/SocketDev/socket-wheelhouse/main/scripts/fleet/build-infra/lib/external-tools-schema.json'

// Template-first: the generated schema lives in template/base/ (the
// scripts/fleet dir mirror propagates it to the live tree + every member).
// Writing the live mirror directly would drift it from the template and the
// next cascade would revert the regenerated output.
const SCHEMA_PATH = path.join(
  REPO_ROOT,
  'template',
  'base',
  'scripts',
  'fleet',
  'build-infra',
  'lib',
  'external-tools-schema.json',
)

/**
 * Build the JSON-Schema document from the TypeBox ToolsConfig. TypeBox schemas
 * are already JSON-Schema-shaped; JSON-round-tripping drops the TypeBox Symbol
 * metadata, leaving a plain `{ type, properties, required, additionalProperties
 * }` object. A meta `$schema` + self `$id` + title/description make it a
 * standalone, editor-resolvable document.
 */
export function buildExternalToolsSchema(): Record<string, unknown> {
  const body = JSON.parse(JSON.stringify(ToolsConfig)) as Record<
    string,
    unknown
  >
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: SCHEMA_ID,
    title: 'Fleet external-tools data file',
    description:
      'Schema for every external-tools.json across the fleet (build/release tools, security-hook tools). Generated from scripts/fleet/lib/external-tools-schema.mts — edit that TypeBox source, then regenerate with scripts/fleet/external-tools/schema.mts.',
    ...body,
  }
}

export function serializeSchema(schema: Record<string, unknown>): string {
  return `${JSON.stringify(schema, null, 2)}\n`
}

function main(): void {
  const generated = buildExternalToolsSchema()
  if (process.argv.includes('--check')) {
    let current: unknown
    try {
      current = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'))
    } catch (e) {
      logger.fail(
        `[external-tools-schema] cannot read/parse ${path.relative(REPO_ROOT, SCHEMA_PATH)}: ${String(e)}`,
      )
      process.exitCode = 1
      return
    }
    // Compare parsed content (robust to formatter differences).
    if (JSON.stringify(current) !== JSON.stringify(generated)) {
      logger.fail(
        [
          `[external-tools-schema] ${path.relative(REPO_ROOT, SCHEMA_PATH)} is stale.`,
          'It is generated from the TypeBox source scripts/fleet/lib/external-tools-schema.mts.',
          'Regenerate: node scripts/fleet/external-tools/schema.mts',
        ].join('\n'),
      )
      process.exitCode = 1
      return
    }
    logger.success(
      `[external-tools-schema] ${path.relative(REPO_ROOT, SCHEMA_PATH)} is current.`,
    )
    return
  }
  writeFileSync(SCHEMA_PATH, serializeSchema(generated))
  // JSON.stringify always multi-lines arrays; oxfmt inlines the short ones.
  // Format in place so a regenerate yields gate-clean output (the --check above
  // compares parsed content, so formatting is never read as drift).
  spawnSync(
    path.join(REPO_ROOT, 'node_modules', '.bin', 'oxfmt'),
    [
      '-c',
      path.join(REPO_ROOT, '.config', 'fleet', 'oxfmtrc.json'),
      SCHEMA_PATH,
    ],
    { stdio: 'ignore' },
  )
  logger.success(`Wrote ${path.relative(REPO_ROOT, SCHEMA_PATH)}.`)
}

if (isMainModule(import.meta.url)) {
  main()
}
