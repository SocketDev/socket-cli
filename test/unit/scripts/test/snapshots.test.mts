import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  dependencySnapshotArgs,
  nativeSnapshotArgs,
  parseSnapshotArgs,
  runSnapshotWorkflow,
  terminalSnapshotArgs,
} from '../../../../scripts/test/snapshots.mts'

import type { SnapshotWorkflowDependencies } from '../../../../scripts/test/snapshots.mts'

describe('native snapshot runner', () => {
  it('parses check and update invocations', () => {
    expect(parseSnapshotArgs([])).toEqual({ update: false })
    expect(parseSnapshotArgs(['--update'])).toEqual({ update: true })
    expect(parseSnapshotArgs(['-u'])).toEqual({ update: true })
    expect(parseSnapshotArgs(['--update', '--dep', 'coana'])).toEqual({
      update: true,
      dependencyName: 'coana',
    })
    expect(parseSnapshotArgs(['--dep=coana', '--update'])).toEqual({
      update: true,
      dependencyName: 'coana',
    })
    expect(() => parseSnapshotArgs(['--dep', 'unknown', '--update'])).toThrow(
      'Unknown snapshot dependency',
    )
    expect(() => parseSnapshotArgs(['--update', '--dep'])).toThrow(
      'Partner names to map: socket-patch, socket-python-cli',
    )
    expect(() => parseSnapshotArgs(['--update', '--dep='])).toThrow(
      'Provide a dependency name',
    )
    expect(() => parseSnapshotArgs(['--update', '--dep', '   '])).toThrow(
      'Provide a dependency name',
    )
    expect(() => parseSnapshotArgs(['--dep', 'coana'])).toThrow(
      'only be used with --update',
    )
    expect(() => parseSnapshotArgs(['--build'])).toThrow('Unknown argument')
  })

  it('selects only the Coana help snapshots for a dependency refresh', () => {
    expect(dependencySnapshotArgs('coana')).toEqual([
      '--build',
      'test/native/commands/cli.native.test.mts',
      '--testNamePattern',
      'captures native help for (fix|scan create|scan reach)',
      '--update',
    ])
  })

  it('builds and runs only the native screenshot suites', () => {
    expect(nativeSnapshotArgs(false)).toEqual([
      '--build',
      'test/native/commands/cli.native.test.mts',
      'test/native/commands/cli-behavior.native.test.mts',
      'test/native/commands/tui.native.test.mts',
    ])
    expect(nativeSnapshotArgs(true)).toEqual([
      '--build',
      'test/native/commands/cli.native.test.mts',
      'test/native/commands/cli-behavior.native.test.mts',
      'test/native/commands/tui.native.test.mts',
      '--update',
    ])
  })

  it('runs the self-update terminal notice screenshot with matching update mode', () => {
    expect(terminalSnapshotArgs(false)).toEqual([
      'node_modules/vitest/vitest.mjs',
      'run',
      '--config',
      '.config/vitest.terminal.config.mts',
      'test/unit/utils/self-update.terminal.test.mts',
    ])
    expect(terminalSnapshotArgs(true)).toEqual([
      ...terminalSnapshotArgs(false),
      '--update',
    ])
  })

  it('writes a report after native success and always releases the lock', async () => {
    const events: string[] = []
    const dependencies = workflowDependencies(events)
    await expect(runSnapshotWorkflow(true, dependencies)).resolves.toBe(0)
    expect(events).toEqual([
      'acquire',
      'create-artifacts',
      'native:true:/artifacts/run-a',
      'terminal:true:/artifacts/run-a',
      'write-result:/artifacts/run-a:source',
      `report:/artifacts/run-a:${path.join('/artifacts/run-a', 'index.html')}`,
      `print:${path.join('/artifacts/run-a', 'index.html')}`,
      'release',
    ])
  })

  it('does not create a passing receipt or report after native failure', async () => {
    const events: string[] = []
    const dependencies = workflowDependencies(events, true)
    await expect(runSnapshotWorkflow(false, dependencies)).rejects.toThrow(
      'native failed',
    )
    expect(events).toEqual([
      'acquire',
      'create-artifacts',
      'native:false:/artifacts/run-a',
      'release',
    ])
  })

  it('updates only the selected dependency snapshots', async () => {
    const events: string[] = []
    await expect(
      runSnapshotWorkflow(true, workflowDependencies(events), 'coana'),
    ).resolves.toBe(0)
    expect(events).toEqual([
      'acquire',
      'create-artifacts',
      'dependency-native:coana:/artifacts/run-a',
      'write-result:/artifacts/run-a:source',
      `report:/artifacts/run-a:${path.join('/artifacts/run-a', 'index.html')}`,
      `print:${path.join('/artifacts/run-a', 'index.html')}`,
      'release',
    ])
  })
})

function workflowDependencies(
  events: string[],
  nativeFails = false,
): SnapshotWorkflowDependencies {
  return {
    async acquireLock() {
      events.push('acquire')
    },
    async releaseLock() {
      events.push('release')
    },
    async createArtifactsDir() {
      events.push('create-artifacts')
      return '/artifacts/run-a'
    },
    runNative(update, artifactsDir) {
      events.push(`native:${update}:${artifactsDir}`)
      if (nativeFails) {
        throw new Error('native failed')
      }
    },
    runDependencyNative(dependency, artifactsDir) {
      events.push(`dependency-native:${dependency}:${artifactsDir}`)
    },
    runTerminal(update, artifactsDir) {
      events.push(`terminal:${update}:${artifactsDir}`)
    },
    async writeTestResult(artifactsDir, sourceCommit) {
      events.push(
        `write-result:${artifactsDir}:${sourceCommit ? 'source' : 'no-source'}`,
      )
    },
    runReport(artifactsDir, reportPath) {
      events.push(`report:${artifactsDir}:${reportPath}`)
    },
    printReport(reportPath) {
      events.push(`print:${reportPath}`)
    },
  }
}
