#!/usr/bin/env node
/*
 * @file `check --all` gate: the SkillSpector pin agrees across all three places
 *   it is recorded, so the locked uv project can never drift from the
 *   fleet-canonical SHA. SkillSpector has no PyPI release / no GH tags
 *   upstream, so a git SHA IS the pin; this check is the code-is-law backstop
 *   that keeps the three records in lockstep:
 *
 *   1. external-tools.json skillspector.version (fleet-canonical SHA)
 *   2. pyproject.toml [tool.uv.sources] skillspector.rev
 *   3. uv.lock the resolved git source for `skillspector` The generic
 *      `uv-lockfiles-are-current` check already proves the lock exists +
 *      carries an `exclude-newer` soak pin; this check adds the cross-reference
 *      that all three SHAs match (external-tools.json is the source of truth —
 *      the pyproject `rev` and the lock's resolved SHA must both descend from
 *      it). Vacuous pass when the uv project is absent (a downstream fleet repo
 *      that doesn't ship SkillSpector). Exit codes: 0 — pins agree (or no
 *      project); 1 — a mismatch (the divergent values + the fix are printed).
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

const SECURITY_TOOLS_DIR = path.join(
  REPO_ROOT,
  'template/base/.claude/hooks/fleet/setup-security-tools',
)
const PROJECT_DIR = path.join(SECURITY_TOOLS_DIR, 'skillspector')
const PYPROJECT = path.join(PROJECT_DIR, 'pyproject.toml')
const UV_LOCK = path.join(PROJECT_DIR, 'uv.lock')
const EXTERNAL_TOOLS = path.join(SECURITY_TOOLS_DIR, 'external-tools.json')

// The pyproject `rev` and external-tools `version` use the SHORT SHA; the lock
// records the FULL SHA. A match is "one is a prefix of the other" (both lowercased).
export function shaAgrees(a: string, b: string): boolean {
  if (!a || !b) {
    return false
  }
  const x = a.toLowerCase()
  const y = b.toLowerCase()
  return x.startsWith(y) || y.startsWith(x)
}

// Pull `skillspector.version` out of external-tools.json. The file is the
// shared `{ tools: { <name>: { version } } }` container.
export function readExternalToolsSha(text: string): string | undefined {
  try {
    const parsed = JSON.parse(text) as {
      tools?:
        | { skillspector?: { version?: string | undefined } | undefined }
        | undefined
    }
    return parsed.tools?.skillspector?.version
  } catch {
    return undefined
  }
}

// Pull `rev` out of the pyproject `[tool.uv.sources] skillspector = { … rev = "…" }`.
// A focused regex avoids pulling in a TOML parser for one field.
export function readPyprojectRev(text: string): string | undefined {
  const line = text
    .split(/\r?\n/u)
    .find(l => /^\s*skillspector\s*=.*\brev\s*=/.test(l))
  if (!line) {
    return undefined
  }
  const m = /\brev\s*=\s*"([^"]+)"/.exec(line)
  return m?.[1]
}

// Pull the resolved git SHA out of uv.lock's `skillspector` package entry:
// `source = { git = "…?rev=<short>#<full>" }`. Return the FULL SHA (after `#`).
export function readLockSha(text: string): string | undefined {
  const lines = text.split(/\r?\n/u)
  for (let i = 0, { length } = lines; i < length; i += 1) {
    if (lines[i] === 'name = "skillspector"') {
      // The `source = { git = … }` line follows within the package block.
      for (
        let j = i + 1;
        j < length && !lines[j]!.startsWith('[[package]]');
        j += 1
      ) {
        const m = /git = "[^"]*#([0-9a-f]+)"/.exec(lines[j]!)
        if (m) {
          return m[1]
        }
      }
    }
  }
  return undefined
}

function main(): number {
  // Vacuous pass when the project isn't present (downstream repo without it).
  if (!existsSync(PYPROJECT)) {
    logger.log(
      'skillspector-pin-is-consistent: no SkillSpector uv project (n/a).',
    )
    return 0
  }
  if (!existsSync(UV_LOCK) || !existsSync(EXTERNAL_TOOLS)) {
    logger.fail(
      'skillspector-pin-is-consistent: project present but incomplete.',
    )
    logger.error(`  where: ${PROJECT_DIR}`)
    logger.error(
      '  saw:   pyproject.toml without its uv.lock / external-tools.json',
    )
    logger.error('  want:  all three records present')
    logger.error(
      '  fix:   run `uv lock` in the project dir + restore external-tools.json',
    )
    return 1
  }

  const canonicalSha = readExternalToolsSha(
    readFileSync(EXTERNAL_TOOLS, 'utf8'),
  )
  const pyprojectRev = readPyprojectRev(readFileSync(PYPROJECT, 'utf8'))
  const lockSha = readLockSha(readFileSync(UV_LOCK, 'utf8'))

  if (!canonicalSha) {
    logger.fail(
      'skillspector-pin-is-consistent: external-tools.json has no skillspector.version.',
    )
    logger.error(`  where: ${EXTERNAL_TOOLS}`)
    logger.error('  fix:   set tools.skillspector.version to the pinned SHA')
    return 1
  }
  if (!pyprojectRev) {
    logger.fail(
      'skillspector-pin-is-consistent: pyproject.toml has no skillspector rev.',
    )
    logger.error(`  where: ${PYPROJECT}`)
    logger.error(
      '  fix:   set [tool.uv.sources] skillspector = { git = "…", rev = "<sha>" }',
    )
    return 1
  }
  if (!lockSha) {
    logger.fail(
      'skillspector-pin-is-consistent: uv.lock has no resolved skillspector git SHA.',
    )
    logger.error(`  where: ${UV_LOCK}`)
    logger.error('  fix:   run `uv lock` to regenerate the lock')
    return 1
  }

  const pyprojectOk = shaAgrees(canonicalSha, pyprojectRev)
  const lockOk = shaAgrees(canonicalSha, lockSha)
  if (!pyprojectOk || !lockOk) {
    logger.fail(
      'skillspector-pin-is-consistent: SkillSpector pin diverges across its records.',
    )
    logger.error(
      `  external-tools.json version: ${canonicalSha} (source of truth)`,
    )
    logger.error(
      `  pyproject.toml       rev:     ${pyprojectRev}${pyprojectOk ? '' : '  ← MISMATCH'}`,
    )
    logger.error(
      `  uv.lock              SHA:     ${lockSha}${lockOk ? '' : '  ← MISMATCH'}`,
    )
    logger.error(
      '  fix:   align all three to the external-tools.json SHA, then re-run `uv lock`',
    )
    return 1
  }

  logger.log(
    `skillspector-pin-is-consistent: pin ${canonicalSha} agrees across all three records.`,
  )
  return 0
}

process.exitCode = main()
