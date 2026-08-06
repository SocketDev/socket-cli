/**
 * @file The canonical linter lane table. `check` and `fix` are the two faces of
 *   ONE list of tools: whatever `pnpm run check` verifies, `pnpm run fix`
 *   auto-fixes, because both read this file. Keeping the argv here — rather
 *   than duplicated across package.json entries — is what stops the check lane
 *   and the fix lane from drifting apart and letting a rule fire in CI that no
 *   local fixer ever touches.
 *
 *   Lanes, in run order:
 *
 *     oxlint  the fast rule pass (.oxlintrc.json)
 *     biome   the formatter (biome.json)
 *     eslint  the type-aware rule pass (eslint.config.js)
 *
 *   Every lane's binary comes from the repo's own `node_modules/.bin`, which is
 *   prepended to PATH rather than spelled as an absolute argv[0] so a path
 *   containing spaces cannot break the Windows shell spawn.
 */

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { FORMATTABLE_EXTENSIONS, LINTABLE_EXTENSIONS } from './scope.mts'

/** The repo root, two levels up from `scripts/lib/`. */
export const REPO_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
)

const WIN32 = process.platform === 'win32'

/**
 * One linter lane. `args()` builds the full argv for a run: `files` empty means
 * the whole workspace, otherwise exactly those paths. `extensions` is the
 * filter a scoped run applies before the lane is spawned.
 */
export interface LintLane {
  readonly name: string
  readonly bin: string
  readonly extensions: ReadonlySet<string>
  /**
   * Whether the tool reads .gitignore on its own. A lane that does not has to
   * be handed an explicit file list for a whole-workspace run, or it gates the
   * build output under `dist/` and the vendored trees under `external/`.
   */
  readonly honorsVcsIgnore: boolean
  args(options: { fix: boolean; files: readonly string[] }): string[]
}

/**
 * The lane table, in run order. oxlint first because it is the fastest and its
 * autofixes are the ones the formatter then re-wraps; biome second so the
 * formatter owns the final wrapping; eslint last because it is the slowest.
 */
export const LINT_LANES: readonly LintLane[] = [
  {
    name: 'oxlint',
    bin: 'oxlint',
    extensions: LINTABLE_EXTENSIONS,
    honorsVcsIgnore: true,
    args({ files, fix }) {
      return [
        '-c=.oxlintrc.json',
        '--ignore-path=.oxlintignore',
        '--tsconfig=tsconfig.json',
        ...(fix ? ['--fix'] : []),
        ...(files.length ? [...files] : ['.']),
      ]
    },
  },
  {
    name: 'biome',
    bin: 'biome',
    extensions: FORMATTABLE_EXTENSIONS,
    honorsVcsIgnore: false,
    args({ files, fix }) {
      return [
        'format',
        '--colors=off',
        '--no-errors-on-unmatched',
        '--files-ignore-unknown=true',
        ...(fix ? ['--fix'] : []),
        ...(files.length ? [...files] : ['.']),
      ]
    },
  },
  {
    name: 'eslint',
    bin: 'eslint',
    extensions: LINTABLE_EXTENSIONS,
    honorsVcsIgnore: true,
    args({ files, fix }) {
      return [
        '--report-unused-disable-directives',
        '--no-warn-ignored',
        ...(fix ? ['--fix'] : []),
        ...(files.length ? [...files] : ['.']),
      ]
    },
  },
]

/**
 * The environment a lane runs in: the repo's `node_modules/.bin` prepended to
 * PATH so a bare binary name resolves to the pinned local copy and never to
 * whatever the machine happens to have installed globally.
 */
export function laneEnv(): NodeJS.ProcessEnv {
  const binDir = path.join(REPO_ROOT, 'node_modules', '.bin')
  const pathKey =
    Object.keys(process.env).find(k => k.toUpperCase() === 'PATH') ?? 'PATH'
  return {
    ...process.env,
    [pathKey]: `${binDir}${path.delimiter}${process.env[pathKey] ?? ''}`,
  }
}

/**
 * Run one lane and return its exit code. Output is inherited so a linter's own
 * formatting, colors, and progress reach the terminal unchanged. A spawn that
 * never started (a missing binary) is reported as 1 rather than as a silent 0.
 */
export function runLane(
  lane: LintLane,
  options: { fix: boolean; files: readonly string[] },
): number {
  const result = spawnSync(lane.bin, lane.args(options), {
    cwd: REPO_ROOT,
    env: laneEnv(),
    shell: WIN32,
    stdio: 'inherit',
  })
  if (result.error) {
    process.stderr.write(
      `${lane.name} did not start\n` +
        `  Where: scripts/lib/linters.mts, spawning \`${lane.bin}\`.\n` +
        `  Saw: ${result.error.message}; wanted the binary from node_modules/.bin.\n` +
        '  Fix: run `pnpm install`, then retry.\n',
    )
    return 1
  }
  return result.status ?? 1
}
