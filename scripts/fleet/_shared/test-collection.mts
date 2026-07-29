/**
 * @file Shared model of "which runner does this repo declare, and which test
 *   files does that runner actually collect". Two gates read it:
 *   `test-files-are-vitest-run` (a file vitest COLLECTS must register through
 *   vitest's API) and `test-files-are-runner-collected` (a declared command
 *   must reach files, and a file on disk must be reachable by a command).
 *   Both failures are SILENT at runtime — a runner that collects nothing, or
 *   collects a file written for another runner, exits 0 with a zero count —
 *   so the model lives here once instead of drifting between two scanners.
 *   Resolution is static: package.json scripts name the runner, the vitest
 *   config module supplies include/exclude, and fast-glob answers which files
 *   match. The one dynamic step is importing the vitest config module, which
 *   is how a config with conditional includes (lanes, env-gated tiers) is read
 *   accurately rather than guessed from its source text.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { globSync } from '@socketsecurity/lib-stable/globs/match'

import { toUnixPath } from './unix-path.mts'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'

/**
 * Test runners the fleet knows how to reason about.
 */
export type RunnerId = 'bun' | 'jest' | 'node' | 'vitest'

/**
 * Every runner id, in the order runner detection probes them.
 */
export const RUNNER_IDS: readonly RunnerId[] = ['bun', 'jest', 'node', 'vitest']

/**
 * Human-readable runner name for error messages.
 */
export const RUNNER_LABELS: Readonly<Record<RunnerId, string>> = {
  bun: 'bun:test',
  jest: 'jest',
  node: 'node:test',
  vitest: 'vitest',
}

/**
 * The module specifier each runner's registration API is imported from. A test
 * file registers its cases through exactly one of these; which one it imports
 * IS its runner choice.
 */
export const RUNNER_SPECIFIERS: Readonly<Record<RunnerId, readonly string[]>> =
  {
    bun: ['bun:test'],
    jest: ['@jest/globals'],
    node: ['node:test'],
    vitest: ['vitest'],
  }

/**
 * Shapes that read as a test file on disk, independent of any config. Broader
 * than any single runner's default so an orphaned suite is visible even when
 * no config reaches it.
 */
export const TEST_FILE_GLOBS: readonly string[] = [
  '**/*.{test,spec}.{js,jsx,ts,tsx,mjs,mts,cjs,cts}',
]

/**
 * Trees that never hold runnable tests: dependencies, build output, fixture
 * corpora, and the wheelhouse's cascade-canonical `template/` sources (whose
 * LIVE copies are what a member actually runs).
 */
export const NON_RUNNABLE_GLOBS: readonly string[] = [
  '**/node_modules/**',
  '**/{dist,build,out,coverage}/**',
  '**/upstream/**',
  '**/fixtures/**',
  '**/.{git,cache,idea,output,temp}/**',
  '**/.claude/worktrees/**',
  'template/**',
]

/**
 * Vitest's own default include when a repo ships no config.
 */
export const VITEST_DEFAULT_INCLUDE: readonly string[] = [
  '**/*.{test,spec}.?(c|m)[jt]s?(x)',
]

/**
 * Vitest's own default exclude when a repo ships no config.
 */
export const VITEST_DEFAULT_EXCLUDE: readonly string[] = [
  '**/node_modules/**',
  '**/dist/**',
  '**/cypress/**',
  '**/.{idea,git,cache,output,temp}/**',
]

/**
 * `bun test` discovery when bunfig.toml declares no roots.
 */
export const BUN_DEFAULT_INCLUDE: readonly string[] = [
  '**/*.{test,spec}.{js,jsx,ts,tsx,mjs,mts,cjs,cts}',
  '**/*_{test,spec}.{js,jsx,ts,tsx,mjs,mts,cjs,cts}',
]

/**
 * `node --test` discovery when the command names no positional path.
 */
export const NODE_TEST_DEFAULT_INCLUDE: readonly string[] = [
  '**/*.test.{js,mjs,cjs,ts,mts,cts}',
  '**/test/**/*.{js,mjs,cjs,ts,mts,cts}',
]

/**
 * Package.json script names that are a repo's TEST GATE — what pre-push and CI
 * run. A file no gate command collects is dark in the gate even when some
 * opt-in lane script can reach it.
 */
export const GATE_SCRIPT_NAMES: readonly string[] = ['test', 'cover']

/**
 * Vitest config locations, in the fleet's repo-first resolution order.
 */
export const VITEST_CONFIG_CANDIDATES: readonly string[] = [
  '.config/repo/vitest.config.mts',
  '.config/vitest.config.mts',
  'vitest.config.mts',
  'vitest.config.ts',
  'vitest.config.js',
]

/**
 * A package.json script that drives a test runner.
 */
export interface TestCommand {
  /**
   * Path of the config the runner loads, relative to `packageDir`.
   */
  configPath: string | undefined
  /**
   * Whether this script is part of the repo's test GATE.
   */
  isGate: boolean
  /**
   * The raw command string.
   */
  command: string
  /**
   * Repo-relative directory the script is declared in. `.` for the root
   * manifest; a workspace package's own directory otherwise.
   */
  packageDir: string
  /**
   * The runner the command drives.
   */
  runner: RunnerId
  /**
   * The package.json script name.
   */
  script: string
}

/**
 * Workspace manifest whose `packages:` globs name the sub-packages the root
 * test script delegates to.
 */
export const WORKSPACE_MANIFEST = 'pnpm-workspace.yaml'

/**
 * The root vitest config whose presence keeps a workspace run single-suite.
 * Same constant the fleet test runner resolves `--config` against.
 */
export const ROOT_VITEST_CONFIG = '.config/repo/vitest.config.mts'

/**
 * The second suite the fleet coverage runner drives when a repo ships it —
 * forks + full isolation for tests that mock globals or mutate process.env.
 * The shared config EXCLUDES `test/isolated/**` whenever this file exists, so
 * without modeling it those suites read as collected by nothing.
 */
export const ISOLATED_VITEST_CONFIG = '.config/repo/vitest.config.isolated.mts'

/**
 * The `packages:` entries of a pnpm workspace manifest. Read with a targeted
 * line scan rather than a YAML parser: the section is a flat list of scalars,
 * and a dependency-free read keeps this model loadable from a check script
 * that runs before install in a fresh clone.
 */
export function readWorkspacePackageGlobs(root: string): string[] {
  const manifestPath = path.join(root, WORKSPACE_MANIFEST)
  if (!existsSync(manifestPath)) {
    return []
  }
  const globs: string[] = []
  let inPackages = false
  const lines = readFileSync(manifestPath, 'utf8').split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (/^packages:\s*$/.test(line)) {
      inPackages = true
      continue
    }
    if (!inPackages) {
      continue
    }
    // A non-indented, non-comment, non-empty line ends the block.
    if (/^\S/.test(line)) {
      break
    }
    // `  - <glob>` with the glob optionally quoted.
    const entry = /^\s+-\s+(['"]?)([^'"#]+)\1\s*(?:#.*)?$/.exec(line)
    if (entry?.[2]) {
      globs.push(entry[2].trim())
    }
  }
  return globs
}

/**
 * Repo-relative directories of every workspace package that ships a manifest.
 * A root `pnpm test` in a workspace delegates to these packages' own test
 * scripts, so their suites are reachable even though no root config names them.
 */
export function listWorkspacePackageDirs(root: string): string[] {
  const globs = readWorkspacePackageGlobs(root)
  if (!globs.length) {
    return []
  }
  return globSync(
    globs.map(g => `${g.replace(/\/+$/, '')}/package.json`),
    { cwd: root, ignore: ['**/node_modules/**'] },
  )
    .map(rel => path.posix.dirname(rel.split(path.sep).join('/')))
    .toSorted()
}

/**
 * Resolved collection globs for one runner invocation.
 */
export interface RunnerCollection {
  /**
   * Repo-relative directory the globs are anchored at.
   */
  base: string
  /**
   * Repo-relative paths the invocation collects.
   */
  collected: readonly string[]
  exclude: readonly string[]
  include: readonly string[]
}

/**
 * Thrown when a declared runner's config cannot be resolved. The gates let it
 * escape: an unreadable config is the exact state that produces a false green,
 * so it must fail loud rather than degrade to a permissive default.
 */
export class TestConfigResolutionError extends Error {
  readonly configPath: string
  readonly script: string
  constructor(message: string, configPath: string, script: string) {
    super(message)
    this.name = 'TestConfigResolutionError'
    this.configPath = configPath
    this.script = script
  }
}

/**
 * The runner a test file registers through, from its imports. `undefined`
 * means no registration import is visible — a file using vitest's `globals`
 * mode, or a helper that only exports. Absence of evidence is never a finding.
 */
export function detectTestFileRunner(text: string): RunnerId | undefined {
  for (let i = 0, { length } = RUNNER_IDS; i < length; i += 1) {
    const runner = RUNNER_IDS[i]!
    for (const specifier of RUNNER_SPECIFIERS[runner]) {
      // Only a real import counts. A specifier named inside a string literal,
      // a comment, or a deny-list is data, not a runner choice — the rule's own
      // specs embed exactly that.
      const quoted = specifier.replace('/', '\\/')
      const importRe = new RegExp(
        `^\\s*(?:import\\s[^\\n]*from\\s+|import\\s+)['"]${quoted}['"]`,
        'm',
      )
      // The CJS form is anchored the same way. An unanchored `require(...)`
      // matcher fires on the specifier quoted INSIDE a string literal — this
      // module's own spec passes exactly that text as a fixture — so the
      // binding keyword must open the line.
      // `^\s*` — line start, any indent
      // `(?:const|let|var)\s[^\n]*=\s*` — a binding whose initializer follows
      // `require\(\s*['"]…['"]\s*\)` — the call, quotes either style
      const requireRe = new RegExp(
        `^\\s*(?:const|let|var)\\s[^\\n]*=\\s*require\\(\\s*['"]${quoted}['"]\\s*\\)`,
        'm',
      )
      if (importRe.test(text) || requireRe.test(text)) {
        return runner
      }
    }
  }
  return undefined
}

/**
 * The runner a package.json command drives. Fleet scripts defer to
 * `scripts/fleet/{test,cover}.mts`, which drive vitest; a bare binary
 * invocation names its runner directly. `undefined` means the command drives
 * no test runner this model knows (a type-check pass, a fuzz harness) — it is
 * skipped rather than guessed at.
 */
export function detectTestCommandRunner(command: string): RunnerId | undefined {
  if (/\bscripts\/(?:fleet|repo)\/(?:cover|test)\.mts\b/.test(command)) {
    return 'vitest'
  }
  // `(?:^|[\s&|;])` — start of string or a shell separator before the token
  // `bun` — the literal binary name
  // `\s+test\b` — whitespace then the `test` subcommand, whole-word
  if (/(?:^|[\s&|;])bun\s+test\b/.test(command)) {
    return 'bun'
  }
  // `(?:^|[\s&|;/])` — start of string or a shell separator / path separator before the token
  // `vitest\b` — the literal binary name, whole-word (won't match `run-vitest` etc.)
  if (/(?:^|[\s&|;/])vitest\b/.test(command)) {
    return 'vitest'
  }
  if (/\bnode\s[^&|;]*--test\b/.test(command)) {
    return 'node'
  }
  // `(?:^|[\s&|;/])` — start of string or a shell separator / path separator before the token
  // `jest\b` — the literal binary name, whole-word (won't match `jest-circus` etc.)
  if (/(?:^|[\s&|;/])jest\b/.test(command)) {
    return 'jest'
  }
  return undefined
}

/**
 * The `--config <path>` a command names, when it names one.
 */
export function extractConfigFlagPath(command: string): string | undefined {
  const match = /--config[= ]\s*(['"]?)([^\s'"]+)\1/.exec(command)
  return match?.[2]
}

/**
 * The vitest config a command loads, repo-first, or `undefined` for none.
 */
export function resolveVitestConfigPath(
  root: string,
  command: string,
): string | undefined {
  const flagged = extractConfigFlagPath(command)
  if (flagged) {
    return flagged
  }
  for (let i = 0, { length } = VITEST_CONFIG_CANDIDATES; i < length; i += 1) {
    const candidate = VITEST_CONFIG_CANDIDATES[i]!
    if (existsSync(path.join(root, candidate))) {
      return candidate
    }
  }
  return undefined
}

/**
 * Every package.json script that drives a test runner, in declaration order.
 * Scripts whose runner is unknown are dropped — a `test:tsc` type pass is not
 * a collection surface.
 */
export function readManifestTestCommands(
  root: string,
  packageDir: string,
): TestCommand[] {
  const packageRoot = path.join(root, packageDir)
  const manifestPath = path.join(packageRoot, 'package.json')
  if (!existsSync(manifestPath)) {
    return []
  }
  let scripts: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      scripts?: Record<string, unknown> | undefined
    }
    scripts = parsed?.scripts ?? {}
  } catch {
    return []
  }
  const commands: TestCommand[] = []
  for (const [script, raw] of Object.entries(scripts)) {
    if (typeof raw !== 'string') {
      continue
    }
    // `^` — must match from the start of the script name
    // `(?:test|cover|coverage)` — one of the three recognized top-level script prefixes
    // `(?::|$)` — immediately followed by `:` (namespaced, e.g. `test:unit`) or end of name
    if (!/^(?:test|cover|coverage)(?::|$)/.test(script)) {
      continue
    }
    const runner = detectTestCommandRunner(raw)
    if (!runner) {
      continue
    }
    const isGate = GATE_SCRIPT_NAMES.includes(script)
    commands.push({
      command: raw,
      configPath:
        runner === 'vitest'
          ? resolveVitestConfigPath(packageRoot, raw)
          : undefined,
      isGate,
      packageDir,
      runner,
      script,
    })
    // The coverage runner drives a SECOND suite from the isolated config when
    // the repo ships one. It is one command running two configs, so the
    // isolated suite gets its own entry rather than being invisible.
    if (
      /\bscripts\/fleet\/cover\.mts\b/.test(raw) &&
      existsSync(path.join(packageRoot, ISOLATED_VITEST_CONFIG))
    ) {
      commands.push({
        command: raw,
        configPath: ISOLATED_VITEST_CONFIG,
        isGate,
        packageDir,
        runner: 'vitest',
        script: `${script}:isolated`,
      })
    }
  }
  return commands
}

/**
 * Whether a root test run fans out to the workspace packages' own scripts.
 * Mirrors `shouldDelegateWorkspace` in the fleet test runner: delegation is a
 * FALLBACK for a workspace with no root vitest config. A repo that ships the
 * root config runs one suite from it, and its workspace members — in a fleet
 * repo, every hook directory — are packaging units, not test surfaces.
 */
export function workspaceRunIsDelegated(root: string): boolean {
  return (
    !existsSync(path.join(root, ROOT_VITEST_CONFIG)) &&
    existsSync(path.join(root, WORKSPACE_MANIFEST))
  )
}

/**
 * Every test-driving script the repo declares — the root manifest's, plus each
 * workspace package's own when the root run delegates to them. Without the
 * delegated tier, every sub-package suite in such a workspace reads as an
 * orphan; with it applied unconditionally, a fleet repo's few hundred hook
 * packages each read as a test surface.
 */
export function readDeclaredTestCommands(root: string): TestCommand[] {
  const commands = readManifestTestCommands(root, '.')
  if (!workspaceRunIsDelegated(root)) {
    return commands
  }
  const packageDirs = listWorkspacePackageDirs(root)
  for (let i = 0, { length } = packageDirs; i < length; i += 1) {
    commands.push(...readManifestTestCommands(root, packageDirs[i]!))
  }
  return commands
}

/**
 * Every test-shaped file on disk, repo-relative, excluding non-runnable trees.
 */
export function listRepoTestFiles(root: string): string[] {
  return globSync([...TEST_FILE_GLOBS], {
    cwd: root,
    ignore: [...NON_RUNNABLE_GLOBS],
  }).toSorted()
}

/**
 * The `test` block of a vitest config module. Imported rather than parsed: a
 * fleet config resolves its include from lanes and its exclude from a shared
 * constants module, so only evaluation gives the real answer.
 */
export async function loadVitestConfigTestBlock(
  root: string,
  configPath: string,
  script: string,
): Promise<Record<string, unknown>> {
  const absolute = path.join(root, configPath)
  if (!existsSync(absolute)) {
    throw new TestConfigResolutionError(
      `Vitest config named by the \`${script}\` script does not exist.\n` +
        `  Where: ${configPath} (named by \`--config\`)\n` +
        `  Saw: no file at that path. Wanted: a readable vitest config.\n` +
        `  Fix: point the \`--config\` flag at an existing config, or drop the ` +
        `flag so the repo-first resolution order applies.`,
      configPath,
      script,
    )
  }
  let loaded: unknown
  try {
    const mod = (await import(pathToFileURL(absolute).href)) as {
      // oxlint-disable-next-line typescript/no-redundant-type-constituents -- fleet optional-explicit-undefined convention: the explicit | undefined on an optional is intentional, not redundant.
      default?: unknown | undefined
    }
    loaded = mod.default
  } catch (e) {
    throw new TestConfigResolutionError(
      `Vitest config for the \`${script}\` script could not be loaded.\n` +
        `  Where: ${configPath}\n` +
        `  Saw: ${errorMessage(e)}\n` +
        `  Wanted: a module whose default export resolves to a vitest config.\n` +
        `  Fix: run the config through \`node ${configPath}\` and repair the ` +
        `import it fails on. A config this gate cannot read is a config whose ` +
        `collected set nobody can verify.`,
      configPath,
      script,
    )
  }
  const resolved =
    typeof loaded === 'function'
      ? await (loaded as (env: Record<string, string>) => unknown)({
          command: 'serve',
          mode: 'test',
        })
      : await loaded
  const block = (resolved as { test?: unknown | undefined } | undefined)?.test
  if (!block || typeof block !== 'object') {
    throw new TestConfigResolutionError(
      `Vitest config for the \`${script}\` script exposes no \`test\` block.\n` +
        `  Where: ${configPath}\n` +
        `  Saw: default export without a \`test\` property.\n` +
        `  Wanted: \`export default defineConfig({ test: { include: [...] } })\`.\n` +
        `  Fix: give the config a \`test\` block, or remove the config so ` +
        `vitest's own defaults apply.`,
      configPath,
      script,
    )
  }
  return block as Record<string, unknown>
}

/**
 * String entries of a config value that may be a string array.
 */
export function readGlobList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

/**
 * Include/exclude for a vitest config, unioning any `projects` sub-configs —
 * a projects-based config carries its real include there, not at the top.
 */
export function mergeVitestProjectGlobs(block: Record<string, unknown>): {
  exclude: string[]
  include: string[]
} {
  const include = readGlobList(block['include'])
  const exclude = readGlobList(block['exclude'])
  const projects = block['projects']
  if (Array.isArray(projects)) {
    for (const project of projects) {
      const nested = (project as { test?: unknown | undefined } | undefined)
        ?.test
      if (nested && typeof nested === 'object') {
        include.push(
          ...readGlobList((nested as Record<string, unknown>)['include']),
        )
      }
    }
  }
  return { exclude, include }
}

/**
 * What one declared command collects. `base` honors vitest's `test.root`, so a
 * config rooted at `tests/` reports repo-relative paths like the rest.
 */
export async function resolveCommandCollection(
  root: string,
  command: TestCommand,
): Promise<RunnerCollection> {
  const packageDir = command.packageDir || '.'
  if (command.runner === 'vitest') {
    if (!command.configPath) {
      return globCollection(
        root,
        packageDir,
        VITEST_DEFAULT_INCLUDE,
        VITEST_DEFAULT_EXCLUDE,
      )
    }
    const block = await loadVitestConfigTestBlock(
      path.join(root, packageDir),
      command.configPath,
      command.script,
    )
    const { exclude, include } = mergeVitestProjectGlobs(block)
    const configuredRoot = block['root']
    const base =
      typeof configuredRoot === 'string'
        ? path.posix.join(packageDir, configuredRoot)
        : packageDir
    return globCollection(
      root,
      base,
      include.length ? include : VITEST_DEFAULT_INCLUDE,
      exclude.length ? exclude : VITEST_DEFAULT_EXCLUDE,
    )
  }
  if (command.runner === 'bun') {
    return globCollection(root, packageDir, BUN_DEFAULT_INCLUDE, [
      '**/node_modules/**',
    ])
  }
  if (command.runner === 'node') {
    return globCollection(root, packageDir, NODE_TEST_DEFAULT_INCLUDE, [
      '**/node_modules/**',
    ])
  }
  return globCollection(
    root,
    packageDir,
    VITEST_DEFAULT_INCLUDE,
    VITEST_DEFAULT_EXCLUDE,
  )
}

/**
 * Glob one include/exclude pair anchored at `base`, reported repo-relative.
 * A config may write its globs ABSOLUTE — resolved against its own directory,
 * the shape the fleet's isolated-suite config uses — and fast-glob then hands
 * back absolute matches. Both forms are folded to one repo-relative,
 * forward-slash key so a collected path compares against the on-disk list.
 */
export function globCollection(
  root: string,
  base: string,
  include: readonly string[],
  exclude: readonly string[],
): RunnerCollection {
  const cwd = path.join(root, base)
  const matched = existsSync(cwd)
    ? globSync([...include], { cwd, ignore: [...exclude] })
    : []
  const prefix =
    base === '' || base === '.'
      ? ''
      : `${toUnixPath(base).replace(/\/+$/, '')}/`
  const collected: string[] = []
  for (let i = 0, { length } = matched; i < length; i += 1) {
    const hit = matched[i]!
    collected.push(
      path.isAbsolute(hit)
        ? toUnixPath(path.relative(root, hit))
        : `${prefix}${toUnixPath(hit)}`,
    )
  }
  return {
    base,
    collected: collected.toSorted(),
    exclude,
    include,
  }
}
