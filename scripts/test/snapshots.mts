import { spawnSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import {
  SNAPSHOT_DEPENDENCIES,
  assertSnapshotDependenciesCurrent,
} from './snapshot-dependencies.mts'
import { isMainModule } from '../lib/is-main-module.mts'
import { runMain } from '../lib/run-main.mts'

import type { SnapshotDependencyName } from './snapshot-dependencies.mts'
import type { ScriptMeta } from '../lib/run-main.mts'
import type { SpawnSyncOptions } from 'node:child_process'

const ROOT = path.resolve(import.meta.dirname, '../..')
const ARTIFACTS_ROOT = path.join(ROOT, 'build/native-test-artifacts')
const LOCK_DIR = path.join(ARTIFACTS_ROOT, '.snapshot-run-lock')
const SNAPSHOT_TESTS = [
  'test/native/commands/cli.native.test.mts',
  'test/native/commands/cli-behavior.native.test.mts',
  'test/native/commands/tui.native.test.mts',
] as const

export interface SnapshotOptions {
  readonly update: boolean
  readonly dependencyName?: SnapshotDependencyName
}

function missingSnapshotDependencyError(): Error {
  return new Error(
    'Provide a dependency name. Usage: pnpm snapshots:update:dep <name>. ' +
      'Current example: pnpm snapshots:update:dep coana. ' +
      'Partner names to map: socket-patch, socket-python-cli. ' +
      `Currently mapped: ${Object.keys(SNAPSHOT_DEPENDENCIES).join(', ')}.`,
  )
}

export function parseSnapshotArgs(args: readonly string[]): SnapshotOptions {
  let update = false
  let dependencyName: SnapshotDependencyName | undefined
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!
    if (arg === '--update' || arg === '-u') {
      update = true
    } else if (arg === '--dep' || arg.startsWith('--dep=')) {
      const value = arg === '--dep' ? args[++index] : arg.slice('--dep='.length)
      if (!value?.trim()) {
        throw missingSnapshotDependencyError()
      }
      if (!(value in SNAPSHOT_DEPENDENCIES)) {
        throw new Error(
          `Unknown snapshot dependency: ${value}; available: ${Object.keys(SNAPSHOT_DEPENDENCIES).join(', ')}`,
        )
      }
      if (dependencyName) {
        throw new Error('Pass only one --dep option')
      }
      dependencyName = value as SnapshotDependencyName
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  if (dependencyName && !update) {
    throw new Error('--dep can only be used with --update')
  }
  return dependencyName ? { update, dependencyName } : { update }
}

export function nativeSnapshotArgs(update: boolean): string[] {
  return ['--build', ...SNAPSHOT_TESTS, ...(update ? ['--update'] : [])]
}

export function dependencySnapshotArgs(
  dependencyName: SnapshotDependencyName,
): string[] {
  const config = SNAPSHOT_DEPENDENCIES[dependencyName]
  return [
    '--build',
    'test/native/commands/cli.native.test.mts',
    '--testNamePattern',
    config.testNamePattern,
    '--update',
  ]
}

export function terminalSnapshotArgs(update: boolean): string[] {
  return [
    'node_modules/vitest/vitest.mjs',
    'run',
    '--config',
    '.config/vitest.terminal.config.mts',
    'test/unit/utils/self-update.terminal.test.mts',
    ...(update ? ['--update'] : []),
  ]
}

export function run(
  args: readonly string[],
  options: SpawnSyncOptions = {},
): void {
  const result = spawnSync(process.execPath, [...args], {
    cwd: ROOT,
    env: process.env,
    stdio: 'inherit',
    ...options,
  })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(
      `${args.join(' ')} exited with ${result.status ?? 'no exit status'}`,
    )
  }
}

export function sourceCommit(): string {
  const revision = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  if (revision.status !== 0) {
    return 'unknown'
  }
  const status = spawnSync('git', ['status', '--porcelain'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  if (status.status !== 0) {
    return 'unknown'
  }
  return `${revision.stdout.trim()}${status.stdout.trim() ? ' (dirty)' : ''}`
}

export async function writeTestResult(
  artifactsDir: string,
  sourceRevision = sourceCommit(),
): Promise<void> {
  const signing = JSON.parse(
    await fs.readFile(path.join(artifactsDir, 'signing-receipt.json'), 'utf8'),
  ) as {
    mode: string
    sourceSha256: string
    stagedSha256: string
  }
  const result = {
    status: 'passed',
    sourceCommit: sourceRevision,
    platform: `${process.platform}/${process.arch}`,
    signingMode: signing.mode,
    sourceSha256: signing.sourceSha256,
    binarySha256: signing.stagedSha256,
  }
  await fs.writeFile(
    path.join(artifactsDir, 'test-result.json'),
    `${JSON.stringify(result, null, 2)}\n`,
  )
}

export interface SnapshotWorkflowDependencies {
  acquireLock(): Promise<void>
  releaseLock(): Promise<void>
  createArtifactsDir(): Promise<string>
  runNative(update: boolean, artifactsDir: string): void
  runDependencyNative(dependencyName: SnapshotDependencyName, artifactsDir: string): void
  runTerminal(update: boolean, artifactsDir: string): void
  writeTestResult(artifactsDir: string, sourceCommit: string): Promise<void>
  runReport(artifactsDir: string, reportPath: string): void
  printReport(reportPath: string): void
}

const DEFAULT_DEPENDENCIES: SnapshotWorkflowDependencies = {
  async acquireLock() {
    await fs.mkdir(ARTIFACTS_ROOT, { recursive: true })
    try {
      await fs.mkdir(LOCK_DIR)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error(
          `Another snapshot run holds ${LOCK_DIR}; remove it only if that run has stopped`,
        )
      }
      throw error
    }
  },
  async releaseLock() {
    await fs.rm(LOCK_DIR, { recursive: true, force: true })
  },
  async createArtifactsDir() {
    return await fs.mkdtemp(
      path.join(
        ARTIFACTS_ROOT,
        `${process.platform}-${process.arch}-snapshots-`,
      ),
    )
  },
  runNative(update, artifactsDir) {
    run(['scripts/test/native.mts', ...nativeSnapshotArgs(update)], {
      env: { ...process.env, SOCKET_CLI_NATIVE_TEST_ARTIFACTS: artifactsDir },
    })
  },
  runDependencyNative(dependencyName, artifactsDir) {
    run(['scripts/test/native.mts', ...dependencySnapshotArgs(dependencyName)], {
      env: { ...process.env, SOCKET_CLI_NATIVE_TEST_ARTIFACTS: artifactsDir },
    })
  },
  runTerminal(update, artifactsDir) {
    run(terminalSnapshotArgs(update), {
      env: {
        ...process.env,
        SOCKET_CLI_NATIVE_TEST_ARTIFACTS: artifactsDir,
        SOCKET_CLI_NATIVE_TEST_UPDATE_SNAPSHOTS: String(update),
      },
    })
  },
  writeTestResult,
  runReport(artifactsDir, reportPath) {
    run([
      'scripts/test/terminal-report.mts',
      '--artifacts',
      artifactsDir,
      '--output',
      reportPath,
    ])
  },
  printReport(reportPath) {
    process.stdout.write(`Native snapshot report: ${reportPath}\n`)
  },
}

export async function runSnapshotWorkflow(
  update: boolean,
  dependencies: SnapshotWorkflowDependencies = DEFAULT_DEPENDENCIES,
  selectedDependencyName?: SnapshotDependencyName,
): Promise<number> {
  await dependencies.acquireLock()
  try {
    const artifactsDir = await dependencies.createArtifactsDir()
    const reportPath = path.join(artifactsDir, 'index.html')
    const sourceRevision = sourceCommit()
    if (selectedDependencyName) {
      dependencies.runDependencyNative(selectedDependencyName, artifactsDir)
    } else {
      if (!update) {
        await assertSnapshotDependenciesCurrent()
      }
      dependencies.runNative(update, artifactsDir)
      dependencies.runTerminal(update, artifactsDir)
    }
    await dependencies.writeTestResult(artifactsDir, sourceRevision)
    dependencies.runReport(artifactsDir, reportPath)
    dependencies.printReport(reportPath)
    return 0
  } finally {
    await dependencies.releaseLock()
  }
}

export async function main(): Promise<number> {
  const { dependencyName, update } = parseSnapshotArgs(process.argv.slice(2))
  return await runSnapshotWorkflow(update, DEFAULT_DEPENDENCIES, dependencyName)
}

const SCRIPT_META: ScriptMeta = {
  describe: 'builds, runs, and reports native terminal snapshot tests',
  help: `Usage: pnpm snapshots [--update|-u]
       pnpm snapshots:update
       pnpm snapshots:update:dep <name>

  Builds the native CLI, runs the focused terminal screenshot tests, and writes
  a self-contained HTML report into a fresh build/native-test-artifacts folder.
  Pass --update or -u to update the native screenshot baselines. Use the dep
  command to rebuild and update only snapshots affected by a pinned tool, for
  example: pnpm snapshots:update:dep coana.`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
