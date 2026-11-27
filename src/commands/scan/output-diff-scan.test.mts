import { afterEach, describe, expect, it, vi } from 'vitest'

import { outputDiffScan } from './output-diff-scan.mts'

vi.mock('../../utils/logger.mts', () => ({
  logger: { error: vi.fn(), fail: vi.fn(), info: vi.fn(), log: vi.fn() },
}))

const diff = {
  after: { id: 'after' },
  artifacts: {
    added: [],
    removed: [],
    replaced: [],
    unchanged: [
      {
        type: 'npm',
        name: 'left-pad',
        version: '1.0.0',
        alerts: [{ action: 'error', type: 'test-alert', key: 'alert-1' }],
      },
    ],
    updated: [],
  },
  before: { id: 'before' },
  directDependenciesChanged: false,
  diff_report_url: '',
}

describe('outputDiffScan strict blocking', () => {
  afterEach(() => {
    process.exitCode = 0
    vi.clearAllMocks()
  })

  it('fails for new blocking alerts in ordinary diff mode', async () => {
    const changed = structuredClone(diff)
    changed.artifacts.added.push({
      type: 'npm',
      name: 'new-package',
      version: '1.0.0',
      alerts: [{ action: 'error', type: 'test-alert', key: 'alert-2' }],
    })
    await outputDiffScan({ ok: true, data: changed } as never, {
      depth: 0,
      file: '',
      outputKind: 'json',
      strictBlocking: false,
    })
    expect(process.exitCode).toBe(1)
  })

  it('fails when an unchanged alert blocks under strict mode', async () => {
    await outputDiffScan({ ok: true, data: diff } as never, {
      depth: 0,
      file: '',
      outputKind: 'json',
      strictBlocking: true,
    })
    expect(process.exitCode).toBe(1)
  })

  it('does not fail on unchanged blocking alerts by default', async () => {
    await outputDiffScan({ ok: true, data: diff } as never, {
      depth: 0,
      file: '',
      outputKind: 'json',
      strictBlocking: false,
    })
    expect(process.exitCode).toBe(0)
  })

  it('does not fail when unchanged alerts are nonblocking', async () => {
    const nonBlocking = structuredClone(diff)
    nonBlocking.artifacts.unchanged[0]!.alerts![0]!.action = 'warn'
    await outputDiffScan({ ok: true, data: nonBlocking } as never, {
      depth: 0,
      file: '',
      outputKind: 'json',
      strictBlocking: true,
    })
    expect(process.exitCode).toBe(0)
  })
})
