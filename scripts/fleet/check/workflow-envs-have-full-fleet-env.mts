#!/usr/bin/env node
/**
 * @file `check --all` gate: any GitHub Actions workflow that opts into the
 *   fleet no-phone-home posture — its top-level `env:` block sets ANY
 *   `FLEET_ENV` knob — MUST set the COMPLETE list. This is the lockstep that
 *   keeps "a lot of the fleet setup is identical" honest: a new knob added to
 *   ci.yml (e.g. OTEL_SDK_DISABLED) can no longer silently miss a sibling
 *   workflow (github-release.yml) whose partial block would let a release build
 *   phone home. Reads the SAME `FLEET_ENV` source of truth the shell-rc bridge
 *   \+ CI env blocks derive from (code is law, DRY). The pure
 *   `findWorkflowEnvDrift` / `parseTopLevelEnv` are exported so the test drives
 *   them without disk. Checks the canonical copy of each workflow (the
 *   `template/base` version wins over the live mirror where both exist).
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { FLEET_ENV } from '../../../.claude/hooks/fleet/_shared/fleet-env.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

// This check lives at scripts/fleet/check/<name>.mts, so the repo root is three
// directories up. Anchored on the module URL rather than process.cwd() so it
// resolves the same no matter which directory the check is invoked from.
const REPO_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
)

export interface FleetEnvKnobMiss {
  name: string
  expected: string
  actual: string | undefined
}

export interface WorkflowEnvViolation {
  workflow: string
  missing: FleetEnvKnobMiss[]
}

/**
 * Parse a workflow's TOP-LEVEL `env:` block into a `NAME → value` map. Only the
 * column-0 `env:` is read (a job-scoped `env:` is indented and ignored).
 * Surrounding single/double quotes are stripped so `'1'` compares equal to the
 * `FLEET_ENV` knob value; comment lines inside the block are skipped.
 */
export function parseTopLevelEnv(text: string): Map<string, string> {
  const out = new Map<string, string>()
  // Column-0 `env:` line, optional trailing spaces + newline, then capture the
  // block body: one-or-more following lines that each begin with whitespace.
  const block = text.match(/^env:[ \t]*\n((?:[ \t]+.*\n?)+)/m)
  if (!block) {
    return out
  }
  const lines = block[1]!.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    // One `NAME: value` entry: leading indent, an env-var name, a colon +
    // optional spaces, then the value (captured non-greedily, trailing spaces
    // trimmed by the final `[ \t]*$`).
    const pair = lines[i]!.match(/^[ \t]+([A-Za-z0-9_]+):[ \t]*(.+?)[ \t]*$/)
    if (!pair) {
      continue
    }
    const value = pair[2]!.replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1')
    out.set(pair[1]!, value)
  }
  return out
}

/**
 * If a workflow opts into the fleet posture — its top-level `env:` sets ANY
 * `FLEET_ENV` knob — every knob must be present with its expected value.
 * Returns the violation (missing / wrong-valued knobs) or `undefined` when the
 * workflow is clean or does not carry the posture at all.
 */
export function findWorkflowEnvDrift(
  workflow: string,
  text: string,
): WorkflowEnvViolation | undefined {
  const env = parseTopLevelEnv(text)
  const carriesPosture = FLEET_ENV.some(knob => env.has(knob.name))
  if (!carriesPosture) {
    return undefined
  }
  const missing: FleetEnvKnobMiss[] = []
  for (let i = 0, { length } = FLEET_ENV; i < length; i += 1) {
    const knob = FLEET_ENV[i]!
    const actual = env.get(knob.name)
    if (actual !== knob.value) {
      missing.push({ actual, expected: knob.value, name: knob.name })
    }
  }
  return missing.length ? { missing, workflow } : undefined
}

/**
 * The canonical workflow files to check: every `.github/workflows/*.yml` in
 * both the live tree and `template/base`, deduped by basename so the
 * `template/base` copy wins because it is the cascade source. Generated
 * `.lock.yml` gh-aw outputs are excluded — they are compiled, not
 * hand-authored.
 */
export function collectWorkflowFiles(repoDir: string): string[] {
  const byName = new Map<string, string>()
  const dirs = [
    path.join(repoDir, '.github', 'workflows'),
    path.join(repoDir, 'template', 'base', '.github', 'workflows'),
  ]
  for (let i = 0, { length } = dirs; i < length; i += 1) {
    const dir = dirs[i]!
    if (!existsSync(dir)) {
      continue
    }
    const entries = readdirSync(dir)
    for (let j = 0, len = entries.length; j < len; j += 1) {
      const name = entries[j]!
      if (!name.endsWith('.yml') || name.endsWith('.lock.yml')) {
        continue
      }
      byName.set(name, path.join(dir, name))
    }
  }
  return [...byName.values()].toSorted()
}

async function main(): Promise<void> {
  const repoDir = REPO_DIR
  const files = collectWorkflowFiles(repoDir)
  const violations: WorkflowEnvViolation[] = []
  for (let i = 0, { length } = files; i < length; i += 1) {
    const file = files[i]!
    const drift = findWorkflowEnvDrift(
      path.relative(repoDir, file),
      readFileSync(file, 'utf8'),
    )
    if (drift) {
      violations.push(drift)
    }
  }
  if (violations.length === 0) {
    logger.success('Every FLEET_ENV-carrying workflow env block is complete.')
    return
  }
  logger.fail(
    'A workflow env block that sets the fleet no-phone-home posture is ' +
      'missing FLEET_ENV knobs (add them, in lockstep with ' +
      '.claude/hooks/fleet/_shared/fleet-env.mts):',
  )
  for (let i = 0, { length } = violations; i < length; i += 1) {
    const v = violations[i]!
    logger.error(`  ${v.workflow}`)
    for (let j = 0, len = v.missing.length; j < len; j += 1) {
      const m = v.missing[j]!
      logger.error(
        `    ${m.name}: expected '${m.expected}', got ${m.actual === undefined ? '(unset)' : `'${m.actual}'`}`,
      )
    }
  }
  process.exitCode = 1
}

if (isMainModule(import.meta.url)) {
  void main()
}
