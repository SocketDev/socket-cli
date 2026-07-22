/**
 * @file Code-as-law DRY: `.npmrc`'s versioned-soak-MIRROR block is DERIVED from
 *   the CANONICAL source — `pnpm-workspace.yaml`'s `minimumReleaseAgeExclude`
 *   version-pins — never hand-copied. pnpm reads the dated `'name@version'`
 *   pins directly; npm (>= v12, PR npm/cli#9532) reads `.npmrc`
 *   `min-release-age-exclude[]=…` but matches by NAME or glob ONLY (no
 *   `@version`), so this block carries the BARE NAME of every third-party
 *   version-pin. Both flow from the ONE canonical list, so a soak-bypass added
 *   with `scripts/fleet/soak-bypass.mts` lands in both files atomically. The
 *   block lives between `# BEGIN versioned-soak-mirror` and `# END
 *   versioned-soak-mirror` markers. `--fix` regenerates it from the live
 *   `pnpm-workspace.yaml`; the default (check) mode fails the gate when
 *   `.npmrc` drifts, with What / Where / Saw-vs-wanted / Fix. Wired into the
 *   cascade (--fix) + `scripts/check.mts` (gate). Socket-owned scopes are NOT
 *   mirrored here — they live in the sibling `# BEGIN socket-soak-excludes`
 *   block (derived from SOCKET_PACKAGE_PATTERNS), and a version-pin never
 *   carries a Socket name. Globs and bare names in the pnpm block are likewise
 *   skipped: only third-party `name@version` pins have a name to mirror. Usage:
 *   node scripts/fleet/check/npmrc-versioned-soak-mirror-is-derived.mts
 *   [--fix]
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { parseArgs } from '@socketsecurity/lib-stable/argv/parse'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { isSocketSourcedPackage } from '../constants/socket-scopes.mts'
import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { parseSoakExcludeBlock } from './fleet-soak-exclude-parity.mts'

const logger = getDefaultLogger()

const BEGIN_MARKER = '# BEGIN versioned-soak-mirror'
const END_MARKER = '# END versioned-soak-mirror'

/**
 * The `.npmrc` `min-release-age-exclude[]=<name>` lines that MIRROR the
 * third-party version-pins in a `pnpm-workspace.yaml`'s
 * `minimumReleaseAgeExclude:` block. Keeps only `name@version` entries (a glob
 * or bare name has no single version to mirror), strips the `@version` to the
 * bare NAME (npm can't pin versions — npm/cli#9532), drops Socket-owned names
 * (covered by the socket-soak-excludes block), then dedupes + sorts so the
 * output is deterministic regardless of pin order.
 */
export function versionedSoakMirrorLines(
  workspaceYaml: string,
): readonly string[] {
  const names = new Set<string>()
  for (const entry of parseSoakExcludeBlock(workspaceYaml)) {
    // Globs (`@scope/*`) have no single version to mirror.
    if (entry.includes('*')) {
      continue
    }
    // A version-pin is `name@version`; the `@` that splits it is never the
    // scope-leading one, so `lastIndexOf` handles `@scope/name@1.2.3`.
    const at = entry.lastIndexOf('@')
    if (at <= 0) {
      // Bare name (no `@version`) — not a third-party version-pin.
      continue
    }
    const name = entry.slice(0, at)
    // Socket scopes ship through our own provenance pipeline and live in the
    // sibling socket-soak-excludes block — never mirror them here.
    if (isSocketSourcedPackage(name)) {
      continue
    }
    names.add(name)
  }
  return [...names].sort().map(name => `min-release-age-exclude[]=${name}`)
}

export interface DeriveResult {
  // The .npmrc text with the versioned-soak-mirror block regenerated.
  next: string
  // False when the BEGIN/END markers are absent or malformed (can't derive).
  markersOk: boolean
  // True when `next` differs from the input (drift was present).
  changed: boolean
}

/**
 * Regenerate the `versioned-soak-mirror` block of an `.npmrc` from `lines`
 * (the derived `min-release-age-exclude[]=…` entries). Pure: replaces only the
 * lines strictly between the BEGIN and END markers, leaving everything else
 * byte-for-byte. `markersOk` is false (and `next` is the input unchanged) when
 * a marker is missing or out of order.
 */
export function deriveNpmrcVersionedMirrorBlock(
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

export interface RunCheckOptions {
  fix?: boolean | undefined
}

/**
 * Read `<repoRoot>/.npmrc`, derive its versioned-soak-mirror block from
 * `<repoRoot>/pnpm-workspace.yaml`, and either rewrite it (`options.fix`) or
 * fail the gate on drift. Returns the intended exit code (0 = derived/healthy
 * or no .npmrc, 1 = missing markers or drift in check mode).
 *
 * In the wheelhouse (dogfood), `template/base/.npmrc` is the SOURCE that
 * cascades to the live `.npmrc` + every member, so it is check/fix'd there.
 * `template/base` has no `pnpm-workspace.yaml` of its own (it is synthesized
 * per-repo), so the canonical version-pins are always read from the repo's LIVE
 * `pnpm-workspace.yaml` — which, in the wheelhouse, is the parity-guarded
 * mirror of the cascade manifest.
 */
export function runCheck(
  repoRoot: string,
  options?: RunCheckOptions | undefined,
): number {
  const opts = { __proto__: null, ...options } as RunCheckOptions
  const fix = opts.fix === true
  const templateNpmrc = path.join(repoRoot, 'template', 'base', '.npmrc')
  const npmrcPath = existsSync(templateNpmrc)
    ? templateNpmrc
    : path.join(repoRoot, '.npmrc')
  if (!existsSync(npmrcPath)) {
    // A repo with no .npmrc has nothing to derive — inert.
    return 0
  }
  const workspacePath = path.join(repoRoot, 'pnpm-workspace.yaml')
  // No workspace file → no version-pins → the mirror should be empty. An
  // unreadable/absent file yields no lines rather than a crash.
  const workspaceYaml = existsSync(workspacePath)
    ? readFileSync(workspacePath, 'utf8')
    : ''
  const npmrc = readFileSync(npmrcPath, 'utf8')
  const result = deriveNpmrcVersionedMirrorBlock(
    npmrc,
    versionedSoakMirrorLines(workspaceYaml),
  )
  if (!result.markersOk) {
    logger.fail(
      [
        '[npmrc-versioned-soak-mirror-is-derived] Missing the derived-block markers.',
        '',
        `  Where: ${npmrcPath}`,
        `  Wanted: a \`${BEGIN_MARKER}\` … \`${END_MARKER}\` block wrapping the`,
        '          name-only `min-release-age-exclude[]=` mirror lines.',
        '  Fix: add the markers around the versioned-soak mirror entries so the',
        '       block can be regenerated from pnpm-workspace.yaml version-pins.',
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
      '[npmrc-versioned-soak-mirror-is-derived] Regenerated .npmrc versioned-soak-mirror block from pnpm-workspace.yaml.',
    )
    return 0
  }
  logger.fail(
    [
      '[npmrc-versioned-soak-mirror-is-derived] .npmrc versioned-soak mirror drifted from pnpm-workspace.yaml.',
      '',
      `  Where: ${npmrcPath} (between ${BEGIN_MARKER} … ${END_MARKER})`,
      '  Saw vs. wanted: the block does not match the bare names derived from',
      '  pnpm-workspace.yaml `minimumReleaseAgeExclude` version-pins — the',
      '  canonical source npm (name-only) and pnpm (dated `name@version`) share.',
      '  Fix: add/remove the soak-bypass via',
      '  `node scripts/fleet/soak-bypass.mts <pkg>@<version>` (never .npmrc by',
      '  hand), or run this check with `--fix` (the cascade does this',
      '  automatically).',
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

// Guarded so importing this module (the writer + unit test) doesn't run the
// CLI — the writer imports `runCheck` to regenerate the .npmrc mirror after a
// soak-bypass edit, and an unguarded main() would run the check (and set
// process.exitCode) on import against the pre-write state.
if (isMainModule(import.meta.url)) {
  try {
    main()
  } catch (e) {
    logger.error(e)
    process.exitCode = 1
  }
}
