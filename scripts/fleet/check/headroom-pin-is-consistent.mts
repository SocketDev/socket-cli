#!/usr/bin/env node
/*
 * @file `check --all` gate: the headroom-ai pin agrees across all three places
 *   it is recorded, so the locked uv project can never drift from the
 *   fleet-canonical version. headroom-ai ships on PyPI with versioned releases,
 *   so the version IS the pin (unlike SkillSpector's git SHA); this check is the
 *   code-is-law backstop that keeps the three records in lockstep:
 *
 *   1. external-tools.json headroom.version (fleet-canonical version)
 *   2. pyproject.toml dependencies headroom-ai[proxy]==<version>
 *   3. uv.lock the resolved headroom-ai package version
 *
 *   The generic `uv-lockfiles-are-current` check proves the lock is internally
 *   consistent; this one proves the three RECORDS agree, so a hand-edit to one
 *   (a bumped external-tools version without re-locking, say) is caught at commit
 *   time rather than installing a version nobody pinned.
 *
 *   Usage: node scripts/fleet/check/headroom-pin-is-consistent.mts [--quiet]
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

const SECURITY_TOOLS_DIR = path.join(
  REPO_ROOT,
  'template/base/.claude/hooks/fleet/setup-security-tools',
)
const PROJECT_DIR = path.join(SECURITY_TOOLS_DIR, 'headroom')
const PYPROJECT = path.join(PROJECT_DIR, 'pyproject.toml')
const UV_LOCK = path.join(PROJECT_DIR, 'uv.lock')
const EXTERNAL_TOOLS = path.join(SECURITY_TOOLS_DIR, 'external-tools.json')

// Exact version-string equality (trimmed). PyPI versions are pinned with `==`,
// so unlike the SkillSpector SHA-prefix match these must be identical.
export function versionAgrees(a: string, b: string): boolean {
  return Boolean(a) && Boolean(b) && a.trim() === b.trim()
}

// Pull `headroom.version` out of external-tools.json (the shared
// `{ tools: { <name>: { version } } }` container).
export function readExternalToolsVersion(text: string): string | undefined {
  try {
    const parsed = JSON.parse(text) as {
      tools?:
        | { headroom?: { version?: string | undefined } | undefined }
        | undefined
    }
    return parsed.tools?.headroom?.version
  } catch {
    return undefined
  }
}

// Pull the `==<version>` pin out of the pyproject `headroom-ai[proxy]==X`
// dependency entry. A focused regex avoids pulling in a TOML parser.
export function readPyprojectVersion(text: string): string | undefined {
  const m = /headroom-ai(?:\[[^\]]*\])?==([0-9][^"'\s]*)/.exec(text)
  return m?.[1]
}

// Pull the resolved `version` out of uv.lock's `headroom-ai` package block.
export function readLockVersion(text: string): string | undefined {
  const lines = text.split(/\r?\n/u)
  for (let i = 0, { length } = lines; i < length; i += 1) {
    if (lines[i] === 'name = "headroom-ai"') {
      for (
        let j = i + 1;
        j < length && !lines[j]!.startsWith('[[package]]');
        j += 1
      ) {
        const m = /^version = "([^"]+)"/.exec(lines[j]!)
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
    logger.log('headroom-pin-is-consistent: no headroom uv project (n/a).')
    return 0
  }
  if (!existsSync(UV_LOCK) || !existsSync(EXTERNAL_TOOLS)) {
    logger.fail('headroom-pin-is-consistent: project present but incomplete.')
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

  const canonical = readExternalToolsVersion(
    readFileSync(EXTERNAL_TOOLS, 'utf8'),
  )
  const pyprojectVersion = readPyprojectVersion(readFileSync(PYPROJECT, 'utf8'))
  const lockVersion = readLockVersion(readFileSync(UV_LOCK, 'utf8'))

  if (!canonical) {
    logger.fail(
      'headroom-pin-is-consistent: external-tools.json has no headroom.version.',
    )
    logger.error(`  where: ${EXTERNAL_TOOLS}`)
    logger.error('  fix:   set tools.headroom.version to the pinned release')
    return 1
  }
  if (!pyprojectVersion) {
    logger.fail(
      'headroom-pin-is-consistent: pyproject.toml has no headroom-ai==<version> pin.',
    )
    logger.error(`  where: ${PYPROJECT}`)
    logger.error(
      '  fix:   set dependencies = ["headroom-ai[proxy]==<version>"]',
    )
    return 1
  }
  if (!lockVersion) {
    logger.fail(
      'headroom-pin-is-consistent: uv.lock has no resolved headroom-ai version.',
    )
    logger.error(`  where: ${UV_LOCK}`)
    logger.error('  fix:   run `uv lock` to regenerate the lock')
    return 1
  }

  const pyprojectOk = versionAgrees(canonical, pyprojectVersion)
  const lockOk = versionAgrees(canonical, lockVersion)
  if (!pyprojectOk || !lockOk) {
    logger.fail(
      'headroom-pin-is-consistent: headroom-ai pin diverges across its records.',
    )
    logger.error(
      `  external-tools.json version: ${canonical} (source of truth)`,
    )
    logger.error(
      `  pyproject.toml       ==:      ${pyprojectVersion}${pyprojectOk ? '' : '  ← MISMATCH'}`,
    )
    logger.error(
      `  uv.lock              version:  ${lockVersion}${lockOk ? '' : '  ← MISMATCH'}`,
    )
    logger.error(
      '  fix:   align all three to the external-tools.json version, then re-run `uv lock`',
    )
    return 1
  }

  logger.log(
    `headroom-pin-is-consistent: pin ${canonical} agrees across all three records.`,
  )
  return 0
}

if (isMainModule(import.meta.url)) {
  process.exitCode = main()
}
