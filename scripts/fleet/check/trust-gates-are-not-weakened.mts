#!/usr/bin/env node
/*
 * @file Commit-time gate mirroring two edit-time hooks for the non-Claude edit
 *   path (manual `git checkout`, external editor, a merge):
 *
 *   - `trust-downgrade-guard` — the pnpm/npm trust-gate FLOORS. This script
 *     asserts the repo's `pnpm-workspace.yaml` still carries a
 *     `minimumReleaseAge` of at least 10080, `trustPolicy: no-downgrade`, and
 *     `blockExoticSubdeps: true`, and that `.npmrc` `min-release-age` (if set)
 *     meets the 7-day floor.
 *   - `npmrc-trust-optout-guard` — the pnpm trust-aware env-expansion opt-out.
 *     This script scans tracked scripts / workflows / configs for a committed
 *     `PNPM_CONFIG_NPMRC_AUTH_FILE` / `NPM_CONFIG_USERCONFIG=<repo .npmrc>`
 *     assignment and for a `${ENV}` placeholder beside an `_authToken` /
 *     `registry` key in a committed `.npmrc`. Defense in depth (code is law):
 *     the hooks block in-session; this catches anything that lands another way.
 *     All detection logic is imported from the SAME `_shared/` modules the
 *     hooks use, so the edit-time and commit-time surfaces never drift. Exit
 *     codes:
 *   - 0 — clean.
 *   - 1 — a floor is below spec, or a committed opt-out was found.
 */

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import {
  detectAuthEnvPlaceholderInNpmrc,
  detectOptoutInFileText,
} from '../../../.claude/hooks/fleet/_shared/npmrc-trust.mts'
import { checkGateFloors } from '../../../.claude/hooks/fleet/_shared/trust-gates.mts'
import { PNPM_WORKSPACE_YAML, REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

const NPMRC_PATH = path.join(REPO_ROOT, '.npmrc')

// Tracked text files where a committed trust-opt-out env var would live — the
// same surface trust-opt-out can persist on (CI scripts, workflows, container
// builds, dotenv).
const SCAN_GLOBS = [
  '*.sh',
  '*.bash',
  '*.zsh',
  '*.mts',
  '*.ts',
  '*.mjs',
  '*.js',
  '*.yml',
  '*.yaml',
  '*.env',
  'Dockerfile',
  '*.Dockerfile',
]

function readTextOrUndefined(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
}

function trackedFiles(): string[] {
  const result = spawnSync('git', ['ls-files', '--', ...SCAN_GLOBS], {
    stdio: 'pipe',
  })
  if (result.status !== 0) {
    // Fail LOUD. A non-zero `git ls-files` means git ITSELF errored — not "0
    // matches" (that is exit 0 with empty stdout). Returning [] here would scan
    // zero files and let `main()` report green: a vacuous pass that hides a
    // committed trust-gate opt-out. A check that could not read its inputs must
    // never report success.
    const stderr =
      typeof result.stderr === 'string'
        ? result.stderr
        : String(result.stderr ?? '')
    logger.fail(
      '[trust-gates-are-not-weakened] could not enumerate tracked files; the ' +
        'opt-out scan did not run.\n' +
        `  Where: ${process.cwd()}\n` +
        `  Saw: git ls-files exited ${String(result.status)}${stderr ? ` — ${stderr.trim()}` : ''}\n` +
        '  Fix: run the check inside a git work tree (a scan that reads zero ' +
        'files must not report green).',
    )
    process.exit(1)
  }
  const out =
    typeof result.stdout === 'string' ? result.stdout : String(result.stdout)
  return out
    .split('\n')
    .filter(Boolean)
    .filter(f => !isTestFile(f))
}

// The detector SOURCE legitimately names the opt-out env vars (the
// npmrc-trust-optout-guard hook + the _shared/npmrc-trust.mts module it and
// this check import). Those files ARE the detector — they'd self-flag this
// gate. Mirrors env-kill-switches-are-absent's SELF_EXEMPT_HOOKS.
const SELF_EXEMPT_PATH_RE =
  /(?:^|\/)(?:\.claude\/hooks\/fleet\/npmrc-trust-optout-guard\/|\.claude\/hooks\/fleet\/_shared\/npmrc-trust\.mts$)/

// Test files legitimately CONTAIN the opt-out env-var patterns as detector
// INPUT (e.g. trust-gates-detectors.test.mts feeds
// `PNPM_CONFIG_NPMRC_AUTH_FILE=.npmrc pnpm i` to detectOptoutInCommands), and
// the detector source itself names them — both would self-flag this gate. Skip
// them, same exemption env-kill-switches-are-absent applies to its own.
function isTestFile(relPath: string): boolean {
  const p = normalizePath(relPath)
  const base = p.split('/').pop() ?? ''
  return (
    base.endsWith('.test.mts') ||
    base.endsWith('.test.ts') ||
    SELF_EXEMPT_PATH_RE.test(p)
  )
}

interface OptoutHit {
  readonly file: string
  readonly detail: string
}

// The opt-out detector + its hook are where these env-var names legitimately
// live as detection literals, not as a real opt-out. Skip the guard's own dir
// (in both the live and template trees) so the enforcer doesn't flag itself.
function isSelfDetectorPath(file: string): boolean {
  return file.includes('npmrc-trust-optout-guard/')
}

function scanCommittedOptouts(): OptoutHit[] {
  const hits: OptoutHit[] = []
  const files = trackedFiles()
  for (let i = 0, { length } = files; i < length; i += 1) {
    const file = files[i]!
    if (isSelfDetectorPath(file)) {
      continue
    }
    const text = readTextOrUndefined(file)
    if (text === undefined) {
      continue
    }
    for (const { line, name } of detectOptoutInFileText(text)) {
      hits.push({ detail: `${name} set at line ${line}`, file })
    }
  }
  // The auth-placeholder shape lives specifically in a committed `.npmrc`.
  const npmrcText = readTextOrUndefined(NPMRC_PATH)
  if (npmrcText !== undefined) {
    for (const line of detectAuthEnvPlaceholderInNpmrc(npmrcText)) {
      hits.push({
        detail: `\`\${ENV}\` placeholder beside an auth/registry key at line ${line}`,
        file: '.npmrc',
      })
    }
  }
  return hits
}

export function main(): void {
  const floorViolations = checkGateFloors(
    readTextOrUndefined(PNPM_WORKSPACE_YAML),
    readTextOrUndefined(NPMRC_PATH),
  )
  const optoutHits = scanCommittedOptouts()

  if (floorViolations.length === 0 && optoutHits.length === 0) {
    logger.log(
      'trust-gates: floors intact (minimumReleaseAge / trustPolicy / ' +
        'blockExoticSubdeps); no committed trust-expansion opt-out.',
    )
    process.exit(0)
  }

  if (floorViolations.length > 0) {
    logger.error('')
    logger.error(
      `[trust-gates] ${floorViolations.length} supply-chain trust gate(s) below the floor:`,
    )
    for (let i = 0, { length } = floorViolations; i < length; i += 1) {
      const v = floorViolations[i]!
      logger.error(`  ✗ ${v.file} ${v.gate}: saw ${v.saw}, want ${v.wanted}`)
    }
    logger.error('')
    logger.error(
      '  These gates are malware / package-takeover protection. Restore the',
      'floor value in the file — never lower it to make a stale lockfile resolve;',
    )
    logger.error(
      '  add the soak / exclude entry for the specific version instead.',
    )
  }

  if (optoutHits.length > 0) {
    logger.error('')
    logger.error(
      `[trust-gates] ${optoutHits.length} committed pnpm trust-expansion opt-out(s):`,
    )
    for (let i = 0, { length } = optoutHits; i < length; i += 1) {
      const h = optoutHits[i]!
      logger.error(`  ✗ ${h.file}: ${h.detail}`)
    }
    logger.error('')
    logger.error(
      '  PNPM_CONFIG_NPMRC_AUTH_FILE / a repo-local NPM_CONFIG_USERCONFIG, or a',
    )
    logger.error(
      '  `${ENV}` beside an auth/registry key, re-opens the credential-',
    )
    logger.error(
      '  exfiltration hole pnpm 10.34.2 / 11.5.3 closed. Keep auth in the OS',
    )
    logger.error(
      '  keychain / CI secrets via a HOME-level `~/.npmrc`; drop the opt-out.',
    )
  }

  process.exit(1)
}

// Run only when invoked directly (CLI / CI), not when imported by unit tests
// — main() calls process.exit, which would tear down the test runner.
if (isMainModule(import.meta.url)) {
  main()
}
