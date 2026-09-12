#!/usr/bin/env node
// Dep-0 hydration and workspace reconciliation use only Node built-ins.
// oxlint-disable-next-line socket/prefer-spawn-over-execsync -- dep-0 bare-node
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { execFileSync as pnpmExecFileSync } from 'node:child_process'
import pnpmCrypto from 'node:crypto'
import {
  closeSync as pnpmCloseSync,
  constants as pnpmConstants,
  fstatSync as pnpmFstatSync,
  lstatSync as pnpmLstatSync,
  opendirSync as pnpmOpendirSync,
  openSync as pnpmOpenSync,
  readSync as pnpmReadSync,
  realpathSync as pnpmRealpathSync,
} from 'node:fs'
import type { Dirent as PnpmDirectoryEntry } from 'node:fs'
import pnpmPath from 'node:path'
import pnpmProcess from 'node:process'
const { pnpmEcosystemFingerprint } = (function () {
  // The install fingerprint and Actions cache resolve before npm dependencies exist.
  // oxlint-disable-next-line socket/prefer-spawn-over-execsync -- dep-0 config query

  interface PnpmEcosystemOwnership {
    cargo: boolean
    python: boolean
  }

  interface PnpmEcosystemOptions {
    config?: unknown | undefined
    maxBytes?: number | undefined
    maxEntries?: number | undefined
  }

  interface PnpmDirectoryIdentity {
    readonly dev: number
    readonly ino: number
  }
  interface PnpmEcosystemScan {
    readonly root: string
    readonly files: string[]
    readonly directories: Map<string, PnpmDirectoryIdentity>
  }

  const PNPM_CONFIG_TIMEOUT_MS = 5000
  const PNPM_CONFIG_MAX_BYTES = 1_048_576
  const PNPM_INPUT_MAX_ENTRIES = 50_000
  const PNPM_INPUT_MAX_BYTES = 16 * 1024 * 1024
  const PNPM_INPUT_SKIP_DIRS = new Set([
    '.cache',
    '.git',
    '.pnpm',
    '.venv',
    'build',
    'coverage',
    'deps',
    'external',
    'fixtures',
    'node_modules',
    'target',
    'third_party',
    'upstream',
    'vendor',
  ])

  function pnpmConfigRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
  }

  function pnpmEcosystemOwnership(config: unknown): PnpmEcosystemOwnership {
    if (!pnpmConfigRecord(config)) {
      throw new TypeError(
        'Invalid pnpm configuration. Where: ecosystem ownership. Saw a non-object; wanted parsed pnpm config. Fix the workspace configuration.',
      )
    }
    const ownership = { cargo: false, python: false }
    for (const name of ['cargo', 'python'] as const) {
      const section = config[name]
      if (section === undefined || section === null) {
        continue
      }
      if (
        !pnpmConfigRecord(section) ||
        (section['enabled'] !== undefined &&
          typeof section['enabled'] !== 'boolean')
      ) {
        throw new TypeError(
          `Invalid pnpm ${name} setting. Where: ecosystem ownership. Wanted an enabled boolean. Fix pnpm-workspace.yaml.`,
        )
      }
      ownership[name] = section['enabled'] === true
    }
    return ownership
  }

  function readPnpmEcosystemOwnership(
    root: string,
    options: PnpmEcosystemOptions = {},
  ): PnpmEcosystemOwnership {
    if (options.config !== undefined) {
      return pnpmEcosystemOwnership(options.config)
    }
    const args = ['config', 'list', '--json']
    const windows = pnpmProcess.platform === 'win32'
    let config: unknown
    try {
      config = JSON.parse(
        pnpmExecFileSync(
          windows ? 'bash' : 'pnpm',
          windows ? ['-c', 'exec pnpm "$@"', 'pnpm', ...args] : args,
          {
            cwd: root,
            encoding: 'utf8',
            maxBuffer: PNPM_CONFIG_MAX_BYTES,
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: PNPM_CONFIG_TIMEOUT_MS,
          },
        ),
      )
    } catch {
      throw new Error(
        'Cannot read pnpm ecosystem ownership. Where: pnpm config list --json. Wanted valid configuration within five seconds. Fix pnpm setup or workspace configuration and retry.',
      )
    }
    return pnpmEcosystemOwnership(config)
  }

  function isPnpmInputDirectory(name: string): boolean {
    return (
      !PNPM_INPUT_SKIP_DIRS.has(name) &&
      !name.endsWith('-bundled') &&
      !name.endsWith('-vendored')
    )
  }

  function capturePnpmDirectory(directory: string): PnpmDirectoryIdentity {
    const metadata = pnpmLstatSync(directory)
    if (!metadata.isDirectory() || pnpmRealpathSync(directory) !== directory) {
      throw new Error(
        `Pnpm input directory changed. Where: ${directory}. Wanted a contained directory without symlinks. Retry after edits finish.`,
      )
    }
    return {
      __proto__: null,
      dev: metadata.dev,
      ino: metadata.ino,
    } as PnpmDirectoryIdentity
  }

  function assertPnpmDirectories(
    directory: string,
    scan: Pick<PnpmEcosystemScan, 'root' | 'directories'>,
  ): void {
    let current = directory
    while (true) {
      const expected = scan.directories.get(current)
      const actual = capturePnpmDirectory(current)
      if (
        !expected ||
        expected.dev !== actual.dev ||
        expected.ino !== actual.ino
      ) {
        throw new Error(
          `Pnpm input directory changed. Where: ${current}. Wanted the directory recorded during discovery. Retry after edits finish.`,
        )
      }
      if (current === scan.root) {
        return
      }
      current = pnpmPath.dirname(current)
    }
  }

  function pnpmEcosystemFiles(
    root: string,
    ownership: PnpmEcosystemOwnership,
    options: PnpmEcosystemOptions = {},
  ): string[] {
    return collectPnpmEcosystemFiles(root, ownership, options).files
  }

  function collectPnpmEcosystemFiles(
    root: string,
    ownership: PnpmEcosystemOwnership,
    config: PnpmEcosystemOptions,
  ): PnpmEcosystemScan {
    const names = new Set<string>()
    if (ownership.cargo) {
      names.add('Cargo.toml')
      names.add('Cargo.lock')
    }
    if (ownership.python) {
      names.add('pyproject.toml')
      names.add('pylock.toml')
    }
    if (names.size === 0) {
      return {
        __proto__: null,
        root,
        directories: new Map<string, PnpmDirectoryIdentity>(),
        files: [],
      } as PnpmEcosystemScan
    }
    root = pnpmRealpathSync(root)
    const scan = {
      root,
      directories: new Map([[root, capturePnpmDirectory(root)]]),
    }
    const { maxEntries = PNPM_INPUT_MAX_ENTRIES } = {
      __proto__: null,
      ...config,
    } as PnpmEcosystemOptions
    const stack = ['']
    const files: string[] = []
    let count = 0
    while (stack.length) {
      const relative = stack.pop()
      if (relative === undefined) {
        break
      }
      const directoryPath = pnpmPath.join(root, relative)
      assertPnpmDirectories(directoryPath, scan)
      const directory = pnpmOpendirSync(directoryPath)
      try {
        assertPnpmDirectories(directoryPath, scan)
        let entry: PnpmDirectoryEntry | null
        while ((entry = directory.readSync()) !== null) {
          count += 1
          if (count > maxEntries) {
            throw new Error(
              `Cannot fingerprint pnpm ecosystem inputs. Where: ${root}. Saw more than ${maxEntries} entries. Fix the workspace layout or its vendor exclusions.`,
            )
          }
          if (entry.isSymbolicLink()) {
            continue
          }
          const child = relative ? `${relative}/${entry.name}` : entry.name
          if (entry.isDirectory()) {
            if (isPnpmInputDirectory(entry.name)) {
              const childPath = pnpmPath.join(root, child)
              scan.directories.set(childPath, capturePnpmDirectory(childPath))
              stack.push(child)
            }
          } else if (entry.isFile() && names.has(entry.name)) {
            files.push(child)
          }
        }
      } finally {
        directory.closeSync()
      }
    }
    return {
      __proto__: null,
      ...scan,
      files: files.toSorted(),
    } as PnpmEcosystemScan
  }

  function readPnpmInput(
    file: string,
    remainingBytes: number,
    scan: PnpmEcosystemScan,
  ): Buffer {
    const parent = pnpmPath.dirname(file)
    assertPnpmDirectories(parent, scan)
    const metadata = pnpmLstatSync(file)
    if (!metadata.isFile() || metadata.size > remainingBytes) {
      throw new Error(
        `Cannot fingerprint pnpm ecosystem input. Where: ${file}. Wanted a regular file within the remaining ${remainingBytes} bytes. Fix the workspace inputs.`,
      )
    }
    const flags =
      pnpmConstants.O_RDONLY |
      (pnpmConstants.O_NOFOLLOW ?? 0) |
      (pnpmConstants.O_NONBLOCK ?? 0)
    const descriptor = pnpmOpenSync(file, flags)
    try {
      assertPnpmDirectories(parent, scan)
      const opened = pnpmFstatSync(descriptor)
      if (
        !opened.isFile() ||
        opened.size !== metadata.size ||
        opened.ino !== metadata.ino ||
        opened.dev !== metadata.dev
      ) {
        throw new Error(
          `Pnpm input changed while opening. Where: ${file}. Wanted a stable regular file. Retry after edits finish.`,
        )
      }
      const bytes = Buffer.alloc(metadata.size)
      let offset = 0
      while (offset < bytes.length) {
        const count = pnpmReadSync(
          descriptor,
          bytes,
          offset,
          bytes.length - offset,
          offset,
        )
        if (count === 0) {
          throw new Error(
            `Pnpm input changed while reading. Where: ${file}. Wanted complete file bytes. Retry after edits finish.`,
          )
        }
        offset += count
      }
      if (pnpmReadSync(descriptor, Buffer.alloc(1), 0, 1, offset) !== 0) {
        throw new Error(
          `Pnpm input grew while reading. Where: ${file}. Wanted stable file bytes. Retry after edits finish.`,
        )
      }
      assertPnpmDirectories(parent, scan)
      return bytes
    } finally {
      pnpmCloseSync(descriptor)
    }
  }

  function pnpmEcosystemFingerprint(
    root: string,
    options: PnpmEcosystemOptions = {},
  ): string {
    const ownership = readPnpmEcosystemOwnership(root, options)
    if (!ownership.cargo && !ownership.python) {
      return ''
    }
    const hash = pnpmCrypto
      .createHash('sha256')
      .update(JSON.stringify(ownership))
    const maxBytes = options.maxBytes ?? PNPM_INPUT_MAX_BYTES
    let totalBytes = 0
    const scan = collectPnpmEcosystemFiles(root, ownership, options)
    for (const relative of scan.files) {
      const bytes = readPnpmInput(
        pnpmPath.join(scan.root, relative),
        maxBytes - totalBytes,
        scan,
      )
      totalBytes += bytes.length
      hash.update(JSON.stringify([relative, bytes.length])).update(bytes)
    }
    return hash.digest('hex')
  }

  const pnpmBootstrapApi = {
    pnpmEcosystemOwnership,
    readPnpmEcosystemOwnership,
    pnpmEcosystemFiles,
    pnpmEcosystemFingerprint,
  }
  return pnpmBootstrapApi
})()

import { readFileSync as bootstrapReadFileSync } from 'node:fs'
import bootstrapProcess from 'node:process'
const bootstrapRunner = (function (
  readFileSync: typeof bootstrapReadFileSync,
  process: typeof bootstrapProcess,
) {
  interface ScriptResult {
    readonly exitCode: number
    readonly data?: unknown | undefined
    readonly error?: string | undefined
  }

  function renderScriptResult(result: ScriptResult): string {
    if (
      !Number.isInteger(result.exitCode) ||
      result.exitCode < 0 ||
      result.exitCode > 255
    ) {
      throw new Error(
        'Script result requires an integer exit code between 0 and 255.',
      )
    }
    return JSON.stringify({
      ok: result.exitCode === 0,
      exitCode: result.exitCode,
      ...(result.data === undefined ? {} : { data: result.data }),
      ...(result.error === undefined ? {} : { error: result.error }),
    })
  }

  class ScriptExit extends Error {
    readonly exitCode: number

    constructor(exitCode: number) {
      if (!Number.isInteger(exitCode) || exitCode < 1 || exitCode > 255) {
        throw new Error(
          'Script abort requires an integer exit code between 1 and 255.',
        )
      }
      super(
        `Script stopped with exit code ${exitCode}. Review the preceding diagnostic and retry.`,
      )
      this.name = 'ScriptExit'
      this.exitCode = exitCode
    }
  }

  function abortScript(exitCode: number): never {
    throw new ScriptExit(exitCode)
  }

  /**
   * True when argv carries a bare `--`.
   *
   * `pnpm run <script> -- --flag` forwards the `--` to the script, and the argv
   * parser truncates there — every flag after it is DISCARDED, not collected as
   * a positional. The script then runs with default behaviour while the caller
   * believes they passed flags. That is merely confusing for a read-only script
   * and dangerous for a destructive one: `prune:branch-backups -- --dry-run`
   * drops the `--dry-run` and performs a live run against every repo.
   *
   * Checked against `process.argv` because by the time parsing finishes the
   * dropped flags are unrecoverable — the parsed result cannot tell you what
   * was lost.
   */
  function hasBareDoubleDash(argv: readonly string[]): boolean {
    return argv.includes('--')
  }

  /**
   * The message shown when argv carries a bare `--`. Names the script so the
   * corrected command can be pasted directly.
   */
  function bareDoubleDashMessage(scriptName: string): string {
    return (
      'a bare `--` in the command line\n' +
      `  Where: the argv for ${scriptName}.\n` +
      '  Saw:   flags after `--`. The argv parser truncates there, so those ' +
      'flags were NOT applied and the script ran with its defaults.\n' +
      `  Fix:   drop the \`--\`, e.g. \`pnpm run ${scriptName} --dry-run\`.`
    )
  }

  /**
   * A script's self-description, answered without running its side effect.
   * `--describe` prints `describe` verbatim — one line, what the script does —
   * so script inventories and agents can read purpose without opening the file.
   * `-h`/`--help` prints `describe`, a blank line, then `help`, which opens
   * with a `Usage:` line naming the sanctioned invocation and lists the flags
   * `main()` actually parses.
   */
  interface ScriptMeta {
    readonly json?: 'native' | 'result' | undefined
    readonly describe: string
    readonly help: string
  }

  /**
   * The help request found on argv, if any: `--describe` wins over
   * `-h`/`--help` when both are present (the narrower ask costs one line;
   * printing both forms for a mixed argv helps no caller). Pure — exported for
   * tests.
   */
  function helpRequest(
    argv: readonly string[],
  ): 'describe' | 'help' | undefined {
    if (argv.includes('--describe')) {
      return 'describe'
    }
    if (argv.includes('-h') || argv.includes('--help')) {
      return 'help'
    }
    return undefined
  }

  /**
   * True when argv carries `--json` on its own — orthogonal to `helpRequest`,
   * which only reads `--describe`/`-h`/`--help`. A script's own `main()` calls
   * this to switch its RESULT output to structured JSON without re-parsing
   * argv itself; `--describe --json` (either order) is answered entirely by
   * the runner before `main()` runs and never reaches this predicate. Pure —
   * exported for tests and entry scripts.
   */
  function isJsonRequested(argv: readonly string[]): boolean {
    return argv.includes('--json')
  }

  /**
   * The text a help request prints: the one-liner alone for `--describe`, or
   * the one-liner + blank line + usage body for `--help`. Pure — exported for
   * tests.
   */
  function helpText(kind: 'describe' | 'help', meta: ScriptMeta): string {
    return kind === 'describe'
      ? meta.describe
      : `${meta.describe}\n\n${meta.help}`
  }

  /**
   * The `--describe --json` payload: the fleet CLI self-description manifest
   * (canonical schema: socket-wheelhouse `schemas/cli-describe.schema.json`),
   * minimal for a script — identity plus the one-line purpose; a script's flags
   * live in its `help` prose, not structured meta. Pure — exported for tests.
   */
  interface DescribeIdentity {
    readonly name: string
    readonly version: string
  }

  function describeManifestText(
    meta: ScriptMeta,
    config: DescribeIdentity,
  ): string {
    const { name, version } = { __proto__: null, ...config } as DescribeIdentity
    return JSON.stringify(
      {
        $schema:
          'https://raw.githubusercontent.com/SocketDev/socket-wheelhouse/main/schemas/cli-describe.schema.json',
        name,
        version,
        description: meta.describe,
      },
      undefined,
      2,
    )
  }

  function errorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message
    }
    return String(error)
  }

  type MainFn = () =>
    | number
    | void
    | ScriptResult
    | Promise<number | void | ScriptResult>

  function scriptVersion(): string {
    try {
      const value: unknown = JSON.parse(readFileSync('package.json', 'utf8'))
      if (
        value !== null &&
        typeof value === 'object' &&
        'version' in value &&
        typeof value.version === 'string'
      ) {
        return value.version
      }
    } catch {}
    return '0.0.0'
  }

  function writeLine(text: string): void {
    process.stdout.write(`${text}\n`)
  }

  function runMainMinimal(main: MainFn, meta: ScriptMeta): void {
    void runMainMinimalAsync(main, meta)
  }

  async function runMainMinimalAsync(
    main: MainFn,
    meta: ScriptMeta,
  ): Promise<void> {
    const argv = process.argv.slice(2)
    const json = isJsonRequested(argv)
    const request = helpRequest(argv)
    const name = process.argv[1]?.split('/').pop() ?? 'script'
    if (request) {
      writeLine(
        request === 'describe' && json
          ? describeManifestText(meta, { name, version: scriptVersion() })
          : helpText(request, meta),
      )
      process.exitCode = 0
      return
    }
    try {
      if (hasBareDoubleDash(argv)) {
        throw new Error(bareDoubleDashMessage(name))
      }
      if (json && !meta.json) {
        throw new Error('This script has not declared JSON execution support.')
      }
      await invokeMinimalMain(main, meta)
    } catch (error) {
      const message = errorMessage(error)
      const exitCode = error instanceof ScriptExit ? error.exitCode : 1
      process.exitCode = exitCode
      if (json) {
        writeLine(renderScriptResult({ exitCode, error: message }))
      } else {
        process.stderr.write(`${message}\n`)
      }
    }
  }

  async function invokeMinimalMain(
    main: MainFn,
    meta: ScriptMeta,
  ): Promise<void> {
    const json = isJsonRequested(process.argv.slice(2))
    const result = await main()
    const code =
      typeof result === 'object' && result !== null ? result.exitCode : result
    if (typeof code === 'number') {
      process.exitCode = code
    } else if (!process.exitCode) {
      process.exitCode = 0
    }
    if (json && meta.json === 'result') {
      writeLine(
        renderScriptResult({
          ...(typeof result === 'object' && result !== null ? result : {}),
          exitCode: Number(process.exitCode ?? 0),
        }),
      )
    } else if (!json && typeof result === 'object' && result?.error) {
      process.stderr.write(`${result.error}\n`)
    }
  }

  return { runMainMinimal, abortScript }
})(bootstrapReadFileSync, bootstrapProcess)
const { runMainMinimal } = bootstrapRunner
type ScriptMeta = Parameters<typeof runMainMinimal>[1]

const SCRIPT_META: ScriptMeta = {
  describe:
    'Prepare a thin fleet checkout and repair its workspace dependencies.',
  help: 'Usage: node scripts/repo/bootstrap/prepare.mts [--hydrate-only | --pipeline] [--json]',
  json: 'result',
}

const HERE = path.dirname(fileURLToPath(import.meta.url))
// Function declarations hoist, so the sorted-position definition below is
// usable here.
const REPO_ROOT = resolveRepoRoot(HERE)

export const FLEET_WORKSPACE_PACKAGES: readonly string[] = [
  '.claude/hooks/fleet/*',
  '.claude/hooks/repo/*',
  '.config/fleet/oxlint-plugin',
  '.config/fleet/oxlint-plugin/fleet/*',
  '.config/repo/oxlint-plugin/*',
]

export function ensureWorkspacePackages(
  yaml: string,
  required: readonly string[],
): string {
  const lines = yaml.split('\n')
  const blockIdx = lines.findIndex(l => l.trimEnd() === 'packages:')
  const present = new Set<string>()
  // Index to splice missing bullets at: right AFTER the last existing bullet
  // (so they join the list, not land past a trailing blank line / comment).
  let insertAt = -1
  if (blockIdx !== -1) {
    insertAt = blockIdx + 1
    for (let i = blockIdx + 1; i < lines.length; i += 1) {
      const ln = lines[i]!
      // The block ends at the first non-indented, non-blank line.
      if (ln !== '' && !/^\s/.test(ln)) {
        break
      }
      // ^\s*-\s*        a YAML list bullet
      // ['"]?(...)['"]?  the (optionally quoted) glob value
      // \s*(?:#.*)?$     optional trailing inline comment
      const m = /^\s*-\s*['"]?([^'"#\s]+)['"]?\s*(?:#.*)?$/.exec(ln)
      if (m) {
        present.add(m[1]!)
        insertAt = i + 1
      }
    }
  }
  const missing = required.filter(r => !present.has(r))
  if (missing.length === 0) {
    return yaml
  }
  const bullets = missing.map(m => `  - '${m}'`)
  if (blockIdx === -1) {
    return [`packages:`, ...bullets, '', ...lines].join('\n')
  }
  return [
    ...lines.slice(0, insertAt),
    ...bullets,
    ...lines.slice(insertAt),
  ].join('\n')
}

export function fetchBundle(): boolean {
  const fleet = path.join(HERE, 'fleet.mjs')
  if (!existsSync(fleet)) {
    log('no scripts/repo/bootstrap/fleet.mjs beside me — skipping bundle fetch')
    return false
  }
  // The PRODUCER branch. A checkout carrying `template/base/universal` holds the canon
  // locally: there is no bundle to fetch and no pin to compare, so it
  // materializes from its own template instead. Everything after this step —
  // the pnpm-workspace repair and the reconcile install — is identical, and is
  // exactly what a producer needs too: the mirrors it just placed include ~380
  // workspace package.json files that the first install could not see.
  // Branching here rather than writing a second doctor keeps one code path.
  if (existsSync(path.join(REPO_ROOT, 'template', 'base', 'universal'))) {
    if (!tryRun('node', [fleet, '--from-template'])) {
      log(
        'materialize (fleet.mjs --from-template) reported a problem — continuing',
      )
      return false
    }
    return true
  }
  if (!tryRun('node', [fleet, '--ensure-current'])) {
    log(
      'bundle refresh (fleet.mjs --ensure-current) reported a problem — continuing',
    )
    return false
  }
  return true
}

export function isMainModule(): boolean {
  const entry = process.argv[1]
  if (!entry) {
    return false
  }
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entry)
  } catch {
    return false
  }
}

export function log(message: string): void {
  if (process.argv.includes('--json')) {
    process.stderr.write(`fleet-prepare: ${message}\n`)
    return
  }
  // oxlint-disable-next-line socket/no-console-prefer-logger -- dep-0 bootstrap
  console.log(`fleet-prepare: ${message}`)
}

export function reconcileInstall(): boolean {
  // --ignore-scripts keeps this pass from re-entering `prepare` (a loop); fleet
  // packages have no build step, so skipping lifecycle scripts loses nothing.
  return tryRun('pnpm', ['install', '--ignore-scripts'], {
    ...process.env,
    NO_UPDATE_NOTIFIER: '1',
  })
}

export function repairWorkspacePackages(): void {
  const wsPath = path.join(REPO_ROOT, 'pnpm-workspace.yaml')
  if (!existsSync(wsPath)) {
    log('no pnpm-workspace.yaml — skipping workspace repair')
    return
  }
  const before = readFileSync(wsPath, 'utf8')
  const after = ensureWorkspacePackages(before, FLEET_WORKSPACE_PACKAGES)
  if (after !== before) {
    writeFileSync(wsPath, after)
    log('repaired pnpm-workspace.yaml packages: (added missing fleet dirs)')
  }
}

// The dep-0 doctor lives at <repo-root>/scripts/repo/bootstrap/ (three levels
// deep), so walk up to the nearest package.json ancestor rather than assuming a
// fixed depth — the same repo-root rule as scripts/fleet/paths.mts
// resolveRepoRoot, kept dep-0 (node: builtins only). `fleet.mjs` sits beside
// this file, so HERE (not REPO_ROOT) is used to locate it.
export function resolveRepoRoot(startDir: string): string {
  let cur = startDir
  const { root } = path.parse(cur)
  while (cur && cur !== root) {
    if (existsSync(path.join(cur, 'package.json'))) {
      return cur
    }
    const parent = path.dirname(cur)
    if (parent === cur) {
      break
    }
    cur = parent
  }
  return path.resolve(startDir, '..', '..', '..')
}

export async function hydrateWorkspace(
  options?: { strict?: boolean | undefined } | undefined,
): Promise<boolean> {
  if (!fetchBundle() && options?.strict !== false) return false
  const wsPath = path.join(REPO_ROOT, 'pnpm-workspace.yaml')
  if (existsSync(wsPath)) {
    const before = readFileSync(wsPath, 'utf8')
    if (
      /^(catalogDriftIgnore|confirmModulesPurge|managePackageManagerVersions):/m.test(
        before,
      )
    ) {
      const { migrateWorkspaceSettings } = await import(
        pathToFileURL(path.join(HERE, 'fleet.mjs')).href
      )
      writeFileSync(wsPath, migrateWorkspaceSettings(REPO_ROOT, before))
    }
  }
  repairWorkspacePackages()
  return true
}

export function workspaceInstallFingerprint(
  options?:
    | { root?: string | undefined; ecosystemConfig?: unknown }
    | undefined,
): string {
  const root = options?.root ?? REPO_ROOT
  const files = ['package.json', 'pnpm-workspace.yaml']
  for (const pattern of FLEET_WORKSPACE_PACKAGES) {
    if (!pattern.endsWith('/*')) {
      const relative = `${pattern}/package.json`
      if (existsSync(path.join(root, relative))) files.push(relative)
      continue
    }
    const parent = pattern.slice(0, -2)
    const directory = path.join(root, parent)
    if (!existsSync(directory)) continue
    for (const child of readdirSync(directory)) {
      const relative = `${parent}/${child}/package.json`
      if (existsSync(path.join(root, relative))) files.push(relative)
    }
  }
  const hash = createHash('sha256')
  const ecosystemFingerprint = pnpmEcosystemFingerprint(root, {
    config: options?.ecosystemConfig,
  })
  if (ecosystemFingerprint) hash.update(ecosystemFingerprint)
  for (const relative of files.toSorted()) {
    const bytes = readFileSync(path.join(root, relative))
    hash.update(JSON.stringify([relative, bytes.length]))
    hash.update(bytes)
  }
  return hash.digest('hex')
}

export function runWorkspacePipeline(): number {
  const manifest = JSON.parse(
    readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'),
  ) as { scripts?: Record<string, unknown> }
  if (
    manifest.scripts?.['build:oxlint-bundle'] !==
    'node scripts/fleet/build-oxlint-bundle.mts'
  ) {
    log(
      'Pipeline build task is unavailable. Where: package.json scripts. Wanted the canonical build:oxlint-bundle command. Fix: synchronize the fleet package scripts.',
    )
    return 1
  }
  return tryRun('pnpm', ['pipeline', 'fleet-prepare', '--full', '--no-cache'], {
    ...process.env,
    FLEET_PREINSTALL_STATE: workspaceInstallFingerprint(),
  })
    ? 0
    : 1
}

export async function runPrepare(): Promise<number> {
  const expected = process.env['FLEET_PREINSTALL_STATE']
  const hydrateOnly = process.argv.includes('--hydrate-only')
  const pipeline = process.argv.includes('--pipeline')
  if (hydrateOnly && pipeline) return 1
  if (
    !(await hydrateWorkspace({
      strict: hydrateOnly || pipeline || expected !== undefined,
    }))
  )
    return 1
  if (hydrateOnly) return 0
  if (pipeline) return runWorkspacePipeline()
  if (expected !== undefined) {
    if (expected !== workspaceInstallFingerprint()) {
      log(
        'Workspace inputs changed during installation. Where: prepare. Saw a different preinstall fingerprint. Fix: hydrate again before starting the pipeline.',
      )
      return 1
    }
  } else if (!reconcileInstall()) {
    log('reconcile `pnpm install --ignore-scripts` failed')
    return 1
  }
  return 0
}

export function prepareCommandInvocation(
  command: string,
  args: readonly string[],
  platform: NodeJS.Platform,
): { command: string; args: string[] } {
  return command === 'pnpm' && platform === 'win32'
    ? { command: 'bash', args: ['-c', 'exec pnpm "$@"', 'pnpm', ...args] }
    : { command, args: [...args] }
}

export function tryRun(
  cmd: string,
  args: readonly string[],
  env?: NodeJS.ProcessEnv | undefined,
): boolean {
  try {
    const invocation = prepareCommandInvocation(cmd, args, process.platform)
    execFileSync(invocation.command, invocation.args, {
      cwd: REPO_ROOT,
      env: env ?? process.env,
      stdio: process.argv.includes('--json')
        ? ['inherit', 2, 'inherit']
        : 'inherit',
    })
    return true
  } catch {
    return false
  }
}

// Realpath both sides: Node resolves the REAL path for `import.meta.url`
// while `process.argv[1]` keeps the path as invoked, so a bare URL equality
// silently skips the CLI body under a symlinked invocation.
if (isMainModule()) {
  runMainMinimal(runPrepare, SCRIPT_META)
}
