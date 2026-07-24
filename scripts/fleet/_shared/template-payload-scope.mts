/**
 * @file Template code-payload lint scope — the `template/base/` sources of the
 *   fleet-canonical cascade payload, and the ignore floor their dedicated
 *   oxlint pass runs with. The canonical `ignorePatterns` exclude the LIVE
 *   cascaded mirrors with `**∕`-anchored globs (`**∕scripts/fleet/**`,
 *   `**∕.claude`, `**∕.config/fleet/**`, …) because downstream repos consume
 *   them as opaque tooling — but those any-depth globs ALSO match the template
 *   SOURCE paths, so the one place the code CAN be fixed was silently skipped
 *   by every default lint gate (oxlint's CLI `--ignore-pattern` has no working
 *   `!` re-include, so the exclusion can't be negated in place). The runners in
 *   `lint-runners.mts` give these dirs a dedicated oxlint pass with the same
 *   canonical config so their files lint exactly as their live equivalents:
 *   every fleet override glob and per-rule filename matcher is `**∕`-anchored,
 *   so `template/base/scripts/fleet/x.mts` scopes identically to
 *   `scripts/fleet/x.mts`. Member repos have no `template/base/`, so
 *   everything here resolves to a no-op there.
 */

import { existsSync } from 'node:fs'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { GENERATED_GLOBS } from '../constants/generated-globs.mts'

// Each entry is a subtree the canonical ignores fully shadow — keep in
// lock-step with the `#fleet-canonical-begin` ignore block in
// `.config/fleet/oxlintrc.json` so nothing is linted twice. Fixtures/docs/
// static template assets are NOT listed; they stay unlinted. One rule is
// carved out for these dirs in the canonical config's overrides block:
// `socket/max-file-lines` is off at the template payload tier, matching the
// dogfood config's standing scripts-and-infra exemption (the payload is
// single-file-per-hook by design and predates the cap; splitting load-bearing
// hooks is a refactor campaign, not lint debt) — the carve-out globs there
// mirror this list.
export const TEMPLATE_PAYLOAD_DIRS: readonly string[] = [
  'template/base/.claude',
  'template/base/.config/fleet',
  'template/base/.git-hooks',
  'template/base/scripts/fleet',
  'template/base/test/fleet/_shared',
  'template/base/test/fleet/scripts',
]

// Ignore floor for the template-payload pass. The canonical ignore list can't
// be reused wholesale (its fleet-canonical mirror globs are exactly what
// swallowed the payload), so this is the generated/vendored floor that must
// still hold INSIDE the payload dirs: the shared generated-tree globs, deps +
// declaration junk, and the built hook-dispatch bundles (same set the dogfood
// config excludes — they're rolldown output, not source).
export const TEMPLATE_PAYLOAD_IGNORES: readonly string[] = [
  ...GENERATED_GLOBS,
  '**/node_modules',
  '**/test/fixtures',
  '**/*.d.ts',
  '**/.claude/hooks/fleet/_dist/**',
  '**/.claude/hooks/fleet/index.cjs',
  '**/.claude/hooks/fleet/_dispatch/excluded-bundle.cjs',
  '**/.claude/hooks/fleet/_dispatch/snapshot-bundle.cjs',
  '**/wasm_exec.js',
]

/**
 * True when `file` (repo-relative) lives inside a template code-payload dir —
 * i.e. it is the SOURCE of a fleet-canonical cascaded file and must lint in
 * the default gates even though the canonical ignores shadow its path.
 */
export function isTemplatePayloadPath(file: string): boolean {
  const normalized = normalizePath(file)
  for (let i = 0, { length } = TEMPLATE_PAYLOAD_DIRS; i < length; i += 1) {
    const dir = TEMPLATE_PAYLOAD_DIRS[i]!
    if (normalized === dir || normalized.startsWith(`${dir}/`)) {
      return true
    }
  }
  return false
}

/**
 * The template code-payload dirs that exist in this repo (wheelhouse: all of
 * them; member repos: none — the pass is skipped).
 */
export function templatePayloadLintPaths(): string[] {
  return TEMPLATE_PAYLOAD_DIRS.filter(dir => existsSync(dir))
}

/**
 * Re-emit `patterns` as CLI `--ignore-pattern` args. A CLI glob matches by
 * full path, so a bare directory pattern (`**∕test/repo`) matches the dir
 * entry but NOT the files under it — unlike a config `ignorePatterns` entry,
 * which prunes the whole subtree. Emit both the bare pattern (dir entry + file
 * patterns like `**∕*.d.ts`) and a `/**` recursion variant (subtree contents)
 * unless it already recurses. The extra `/**` on a file pattern matches
 * nothing — harmless. `#…`-prefixed fleet-canonical markers are gitignore
 * comments and are dropped.
 */
export function toIgnorePatternArgs(patterns: readonly unknown[]): string[] {
  const args: string[] = []
  for (let i = 0, { length } = patterns; i < length; i += 1) {
    const pattern = patterns[i]
    if (typeof pattern !== 'string' || !pattern || pattern.startsWith('#')) {
      continue
    }
    args.push('--ignore-pattern', pattern)
    if (!pattern.endsWith('/**') && !pattern.endsWith('/*')) {
      args.push('--ignore-pattern', `${pattern}/**`)
    }
  }
  return args
}

/**
 * CLI ignore args for the template-payload pass: the payload ignore FLOOR
 * only, never the canonical mirror globs (which are exactly what shadowed the
 * payload source).
 */
export function templatePayloadIgnoreArgs(): string[] {
  return toIgnorePatternArgs(TEMPLATE_PAYLOAD_IGNORES)
}
