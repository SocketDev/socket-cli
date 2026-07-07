/**
 * @file Code-as-law DRY: `.npmrc`'s Socket soak-exclude block is DERIVED from
 *   the single source `SOCKET_PACKAGE_PATTERNS` (constants/socket-scopes.mts),
 *   never hand-copied. npm reads `.npmrc` `min-release-age-exclude[]=…`; pnpm
 *   reads the (also-derived) `pnpm-workspace.yaml` `minimumReleaseAgeExclude`
 *   block — both flow from the one constant, so adding/removing a Socket scope
 *   touches ONE place. The block lives between `# BEGIN socket-soak-excludes`
 *   and `# END socket-soak-excludes` markers. `--fix` regenerates it from
 *   `npmrcSocketSoakExcludeLines()`; the default (check) mode fails the gate
 *   when `.npmrc` drifts from the constant, with What / Where / Saw-vs-wanted /
 *   Fix. Wired into the cascade (--fix) + `scripts/check.mts` (gate). Usage:
 *   node scripts/fleet/check/npmrc-socket-soak-excludes-are-derived.mts
 *   [--fix]
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { parseArgs } from '@socketsecurity/lib-stable/argv/parse'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { npmrcSocketSoakExcludeLines } from '../constants/socket-scopes.mts'
import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

const BEGIN_MARKER = '# BEGIN socket-soak-excludes'
const END_MARKER = '# END socket-soak-excludes'

export interface DeriveResult {
  // The .npmrc text with the socket block regenerated from the constant.
  next: string
  // False when the BEGIN/END markers are absent or malformed (can't derive).
  markersOk: boolean
  // True when `next` differs from the input (drift was present).
  changed: boolean
}

export interface RunCheckOptions {
  fix?: boolean | undefined
}

/**
 * Regenerate the `socket-soak-excludes` block of an `.npmrc` from `lines` (the
 * derived `min-release-age-exclude[]=…` entries). Pure: replaces only the lines
 * strictly between the BEGIN and END markers, leaving everything else byte-for-
 * byte. `markersOk` is false (and `next` is the input unchanged) when a marker
 * is missing or out of order.
 */
export function deriveNpmrcSocketBlock(
  npmrc: string,
  lines: readonly string[],
): DeriveResult {
  const all = npmrc.split('\n')
  const begin = all.findIndex(l => l.startsWith(BEGIN_MARKER))
  const end = all.findIndex(l => l.startsWith(END_MARKER))
  if (begin === -1 || end === -1 || end <= begin) {
    return { changed: false, markersOk: false, next: npmrc }
  }
  const next = [...all.slice(0, begin + 1), ...lines, ...all.slice(end)].join(
    '\n',
  )
  return { changed: next !== npmrc, markersOk: true, next }
}

/**
 * Read `<repoRoot>/.npmrc`, derive its Socket block, and either rewrite it
 * (`options.fix`) or fail the gate on drift. Returns the intended exit code
 * (0 = derived/healthy or no .npmrc; 1 = missing markers or drift in check
 * mode).
 */
export function runCheck(
  repoRoot: string,
  options?: RunCheckOptions | undefined,
): number {
  const opts = { __proto__: null, ...options } as RunCheckOptions
  const fix = opts.fix === true
  // In the wheelhouse (dogfood), template/base/.npmrc is the SOURCE that
  // cascades to the live .npmrc + every member; check/fix it there so a
  // re-cascade propagates the derived block. A member has no template/, so
  // fall back to its own live .npmrc.
  const templateNpmrc = path.join(repoRoot, 'template', 'base', '.npmrc')
  const npmrcPath = existsSync(templateNpmrc)
    ? templateNpmrc
    : path.join(repoRoot, '.npmrc')
  if (!existsSync(npmrcPath)) {
    // A repo with no .npmrc has nothing to derive — inert, like the fleet
    // checks that no-op when their target file is absent.
    return 0
  }
  const npmrc = readFileSync(npmrcPath, 'utf8')
  const result = deriveNpmrcSocketBlock(npmrc, npmrcSocketSoakExcludeLines())
  if (!result.markersOk) {
    logger.fail(
      [
        '[npmrc-socket-soak-excludes-are-derived] Missing the derived-block markers.',
        '',
        `  Where: ${npmrcPath}`,
        `  Wanted: a \`${BEGIN_MARKER}\` … \`${END_MARKER}\` block wrapping the`,
        '          Socket `min-release-age-exclude[]=` lines.',
        '  Fix: add the markers around the Socket soak-exclude entries so the',
        '       block can be regenerated from SOCKET_PACKAGE_PATTERNS.',
        '',
      ].join('\n'),
    )
    return 1
  }
  if (!result.changed) {
    return 0
  }
  if (fix) {
    writeFileSync(npmrcPath, result.next)
    logger.success(
      '[npmrc-socket-soak-excludes-are-derived] Regenerated .npmrc Socket block from SOCKET_PACKAGE_PATTERNS.',
    )
    return 0
  }
  logger.fail(
    [
      '[npmrc-socket-soak-excludes-are-derived] .npmrc Socket soak-excludes drifted from SOCKET_PACKAGE_PATTERNS.',
      '',
      `  Where: ${npmrcPath} (between ${BEGIN_MARKER} … ${END_MARKER})`,
      '  Saw vs. wanted: the block does not match the lines derived from',
      '  SOCKET_PACKAGE_PATTERNS (constants/socket-scopes.mts) — the single source.',
      '  Fix: edit SOCKET_PACKAGE_PATTERNS (never .npmrc by hand), then run',
      '  `node scripts/fleet/check/npmrc-socket-soak-excludes-are-derived.mts --fix`',
      '  (the cascade does this automatically).',
      '',
    ].join('\n'),
  )
  return 1
}

function main(): void {
  const { values } = parseArgs({
    options: { fix: { default: false, type: 'boolean' } },
    strict: false,
  })
  process.exitCode = runCheck(REPO_ROOT, { fix: !!values['fix'] })
}

try {
  main()
} catch (e) {
  logger.error(e)
  process.exitCode = 1
}
