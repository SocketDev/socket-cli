/**
 * @file Shared oxfmt scope resolution for the fleet `lint` and `format`
 *   runners. Both MUST format the SAME file set, so the config picker, the
 *   `--ignore-path` resolver, and the oxfmt argv builder live here once. The
 *   hazard this prevents: a bare `oxfmt --write .` (no `--ignore-path`)
 *   reformats `.claude/`, the generated `.agents/` mirror, vendored trees, and
 *   the markdown the fleet lints with markdownlint — hundreds of files the gate
 *   never checks. Routing every oxfmt call through `buildOxfmtArgs` (which
 *   always threads `--ignore-path`) is what keeps `pnpm run format` and the
 *   lint gate in lock-step.
 */

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Two-file extends layout: `.config/fleet/<config>.json` is fleet-canonical
// (byte-identical across the fleet, owned by the wheelhouse cascade).
// A repo with overrides ships `.config/repo/<config>.json` that uses
// `extends: ['../fleet/<config>.json']` + a small `overrides` block.
// Auto-discover: prefer the repo overlay if it exists, else the fleet
// canonical. Picks at invocation time — adding the overlay doesn't
// require touching scripts. The basename (oxlintrc.json / oxfmtrc.json)
// stays identical on both sides; only the directory differs.
export function pickConfig(
  basename: string,
  options?: { cwd?: string | undefined } | undefined,
): string {
  // `cwd` exists for tests: worker-thread pools can't process.chdir(), so a
  // fixture root is passed explicitly. Runtime callers omit it (repo root).
  const opts = { __proto__: null, ...options } as {
    cwd?: string | undefined
  }
  const base = opts.cwd ?? '.'
  const repoOverlay = path.join(base, '.config', 'repo', basename)
  if (existsSync(repoOverlay)) {
    return repoOverlay
  }
  return path.join(base, '.config', 'fleet', basename)
}

// Resolve the oxfmt `--ignore-path`. The fleet canonical
// `.config/fleet/.prettierignore` excludes `.claude/`, the `.agents/` mirror,
// `**/fleet/**` — the patterns every repo shares.
// A repo with its OWN verbatim trees (e.g. socket-btm's
// `additions/source-patched/` synced into the Node build, or `test/fixtures/`
// corpora) declares them in a repo overlay at `.config/repo/.prettierignore`.
// oxfmt takes a single `--ignore-path` and does NOT honor the flag twice, so
// when an overlay exists we concatenate fleet + repo into one temp file and pass
// that. The fleet file alone is returned when there is no overlay (the common
// case). Cached so repeat call sites share one temp file per invocation.
export const FLEET_IGNORE_PATH = path.join(
  '.config',
  'fleet',
  '.prettierignore',
)
let cachedIgnorePath: string | undefined
export function pickIgnorePath(
  options?: { cwd?: string | undefined } | undefined,
): string {
  // `cwd` exists for tests (worker-thread pools can't process.chdir());
  // explicit-cwd calls skip the cache so fixture roots never leak into the
  // runtime (cwd-less) resolution.
  const opts = { __proto__: null, ...options } as {
    cwd?: string | undefined
  }
  const base = opts.cwd ?? '.'
  const cacheable = opts.cwd === undefined
  if (cacheable && cachedIgnorePath !== undefined) {
    return cachedIgnorePath
  }
  const fleetIgnore = path.join(base, FLEET_IGNORE_PATH)
  const repoOverlay = path.join(base, '.config', 'repo', '.prettierignore')
  if (!existsSync(repoOverlay)) {
    if (cacheable) {
      cachedIgnorePath = fleetIgnore
    }
    return fleetIgnore
  }
  let fleetBody = ''
  let repoBody = ''
  try {
    fleetBody = readFileSync(fleetIgnore, 'utf8')
  } catch {}
  try {
    repoBody = readFileSync(repoOverlay, 'utf8')
  } catch {}
  const dir = mkdtempSync(path.join(os.tmpdir(), 'fleet-prettierignore-'))
  const combined = path.join(dir, '.prettierignore')
  writeFileSync(
    combined,
    `${fleetBody}\n# --- .config/repo/.prettierignore (repo-specific verbatim trees) ---\n${repoBody}\n`,
    'utf8',
  )
  if (cacheable) {
    cachedIgnorePath = combined
  }
  return combined
}

// Build the `pnpm exec oxfmt …` argv. The `--ignore-path` is non-negotiable —
// it is the whole reason this helper exists, so it is threaded unconditionally.
// `check: true` verifies without writing (the `format:check` script); otherwise
// oxfmt writes. `files` defaults to `['.']` (the whole scoped tree); explicit
// paths format just those. Pure + exported so the `--ignore-path` invariant is
// unit-testable without spawning a subprocess.
export function buildOxfmtArgs(
  options?:
    | {
        check?: boolean | undefined
        cwd?: string | undefined
        files?: readonly string[] | undefined
      }
    | undefined,
): string[] {
  const opts = { __proto__: null, ...options } as {
    check?: boolean | undefined
    cwd?: string | undefined
    files?: readonly string[] | undefined
  }
  const files = opts.files?.length ? [...opts.files] : ['.']
  return [
    'exec',
    'oxfmt',
    '-c',
    pickConfig('oxfmtrc.json', { cwd: opts.cwd }),
    '--ignore-path',
    pickIgnorePath({ cwd: opts.cwd }),
    opts.check ? '--check' : '--write',
    '--no-error-on-unmatched-pattern',
    ...files,
  ]
}

// Compile one anchored .prettierignore glob to a RegExp. The fleet ignore file
// is enforced to hold only `**/`-anchored globs
// (scripts/fleet/check/prettierignore-globs-are-anchored.mts), so the dialect
// here is small: `**/` = zero or more leading segments, `**` = any run
// including `/`, `*` = one segment, everything else literal. A trailing `/**`
// therefore matches the whole subtree.
export function ignoreGlobToRegExp(glob: string): RegExp {
  let out = '^'
  for (let i = 0, { length } = glob; i < length; i += 1) {
    const c = glob[i]!
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          out += '(?:.*/)?'
          i += 2
        } else {
          out += '.*'
          i += 1
        }
      } else {
        out += '[^/]*'
      }
    } else {
      out += c.replace(/[$()+.?[\]\\^{|}]/, m => `\\${m}`)
    }
  }
  return new RegExp(`${out}$`)
}

/**
 * Non-comment, non-negation pattern lines of an ignore file body. Negations
 * (`!re-include`) are not part of the fleet ignore dialect — the anchored-glob
 * check rejects them — so they are excluded rather than half-implemented.
 */
export function parseIgnoreGlobs(content: string): string[] {
  return content
    .split('\n')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('#') && !s.startsWith('!'))
}

// The GENERATED / VENDORED / dep-0 path segments — artifacts a bundler, codegen
// step, or upstream owns, never hand-written. These are dropped from the gate in
// EVERY scope, even under template/ (which otherwise stays gated as the
// wheelhouse canon): the built bootstrap/fleet.mjs, the _dispatch hook bundle, and the build/vendor/upstream trees
// live
// beside hand-written template sources but must never be format- or lint-gated.
// The MIRROR exclusions (.claude / .agents / **/fleet/**) are deliberately NOT
// here — template/ dogfoods those. Twin of the generated/vendored entries in
// .config/fleet/.prettierignore (+ scripts/fleet/constants/generated-globs.mts).
const NEVER_GATED_SEGMENTS = new Set([
  'build',
  'coverage',
  'dist',
  'fixtures',
  'out',
  'upstream',
])

/**
 * Whether `unixPath` is a generated / vendored / dep-0 artifact that must never
 * be format- or lint-gated in any scope — the built dep-0 fetcher bundle, a
 * `_dispatch/` hook bundle, a gh-aw `*.lock.yml`, a `.d.ts` type declaration,
 * or anything under a {@link NEVER_GATED_SEGMENTS} directory. Applied BEFORE
 * the `template/**` keep so those artifacts drop out even inside the wheelhouse
 * canon.
 */
export function isNeverGated(filePath: string): boolean {
  const p = normalizePath(filePath)
  // The rolldown-inlined dep-0 fetcher bundle (bootstrap/src/* IS gated).
  // socket-lint: allow uncommented-regex -- generated-artifact path, described above.
  if (/(?:^|\/)bootstrap\/fleet\.mjs$/.test(p)) {
    return true
  }
  // A `.d.ts` / `.d.mts` / `.d.cts` type-declaration file (compiler output).
  // socket-lint: allow uncommented-regex -- generated-artifact path, described above.
  if (/\.d\.[cm]?ts$/.test(p)) {
    return true
  }
  if (
    p.includes('/_dispatch/') ||
    p.includes('/hooks/fleet/_dist/') ||
    p.endsWith('/hooks/fleet/index.cjs') ||
    p.endsWith('.lock.yml')
  ) {
    return true
  }
  // The rolldown-bundled fleet oxlint plugin (build-oxlint-bundle.mts output).
  // socket-lint: allow uncommented-regex -- generated-artifact path, described above.
  if (/(?:^|\/)\.config\/fleet\/oxlint-plugin\.mjs$/.test(p)) {
    return true
  }
  return p.split('/').some(seg => NEVER_GATED_SEGMENTS.has(seg))
}

/**
 * Filter a file list down to the paths the merged .prettierignore does NOT
 * exclude. oxfmt skips `--ignore-path` for files passed explicitly on the argv
 * (hit live: a member's staged pre-commit red-lit `.claude/skills/fleet/…`
 * cascade payload that the ignore file excludes, wedging every payload
 * landing), so the staged/modified lanes must pre-filter. `template/**` is kept
 * — it exists only in the wheelhouse, where it is the canonical SOURCE every
 * mirror is cut from, the one place those bytes stay gated — EXCEPT for
 * {@link isNeverGated} generated/vendored artifacts, which are dropped
 * everywhere (oxlint bypasses its own ignorePatterns for files passed
 * explicitly, so a staged/dogfood generated file would otherwise red-lint the
 * gate on bundler/vendored bytes the gate never owns).
 */
export function filterFormatIgnored(
  files: readonly string[],
  options?: { cwd?: string | undefined } | undefined,
): string[] {
  const opts = { __proto__: null, ...options } as {
    cwd?: string | undefined
  }
  let body = ''
  try {
    body = readFileSync(
      pickIgnorePath(opts.cwd ? { cwd: opts.cwd } : undefined),
      'utf8',
    )
  } catch {
    return files.filter(f => !isNeverGated(f.replaceAll('\\', '/')))
  }
  const regs = parseIgnoreGlobs(body).map(ignoreGlobToRegExp)
  return files.filter(f => {
    const unix = f.replaceAll('\\', '/')
    // Generated / vendored / dep-0 artifacts are never gated, in any scope.
    if (isNeverGated(unix)) {
      return false
    }
    // template/** stays gated (the canon every mirror is cut from).
    if (unix.startsWith('template/')) {
      return true
    }
    return !regs.some(r => r.test(unix))
  })
}

// Newline-split `git` porcelain output with array args (no shell, no injection
// surface). Empty on a non-zero status so callers fail open to a broad scope.
function gitFiles(args: readonly string[]): string[] {
  const r = spawnSync('git', [...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    stdioString: true,
  })
  if (r.status !== 0 || typeof r.stdout !== 'string') {
    return []
  }
  return r.stdout
    .split('\n')
    .map(s => s.trim())
    .filter(s => s.length > 0)
}

/**
 * Paths STAGED for the next commit (Added/Copied/Modified/Renamed). The
 * pre-commit + `--staged` lanes across the fleet runners scope to exactly this
 * set so a lint/format/test run touches only what is being committed.
 */
export function getStagedFiles(): string[] {
  return gitFiles(['diff', '--cached', '--name-only', '--diff-filter=ACMR'])
}

/**
 * Paths MODIFIED in the working tree vs HEAD (the local-dev `--modified`
 * scope) — same ACMR filter as {@link getStagedFiles}, rooted at HEAD.
 */
export function getModifiedFiles(): string[] {
  return gitFiles(['diff', '--name-only', '--diff-filter=ACMR', 'HEAD'])
}
