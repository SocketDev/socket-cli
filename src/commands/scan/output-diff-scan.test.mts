import { afterEach, describe, expect, it, vi } from 'vitest'

import { outputDiffScan } from './output-diff-scan.mts'

vi.mock('../../utils/logger.mts', () => ({
  logger: { error: vi.fn(), fail: vi.fn(), info: vi.fn(), log: vi.fn() },
}))

const diff = {
  after: { id: 'head' },
  artifacts: {
    added: [
      {
        type: 'npm',
        name: 'new-package',
        version: '1.0.0',
        alerts: [{ action: 'error', type: 'test-alert', key: 'alert-1' }],
      },
    ],
    removed: [],
    replaced: [],
    unchanged: [],
    updated: [],
  },
  before: { id: 'base' },
  directDependenciesChanged: false,
  diff_report_url: '',
}

describe('outputDiffScan', () => {
  afterEach(() => {
    process.exitCode = 0
    vi.clearAllMocks()
  })

  it('fails for new blocking findings in a PR diff', async () => {
    await outputDiffScan({ ok: true, data: diff } as never, {
      depth: 0,
      file: '',
      outputKind: 'json',
    })
    expect(process.exitCode).toBe(1)
  })
})
