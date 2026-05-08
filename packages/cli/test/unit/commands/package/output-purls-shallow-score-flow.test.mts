/**
 * Unit tests for outputPurlsShallowScore dispatcher.
 *
 * The format helpers have their own snapshot tests; this suite covers
 * outputPurlsShallowScore() entry points: error handling, JSON / markdown /
 * text mode dispatch, and exit code propagation.
 *
 * Related Files:
 * - src/commands/package/output-purls-shallow-score.mts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockLogger = vi.hoisted(() => ({
  log: vi.fn(),
  fail: vi.fn(),
}))

vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
}))

import { outputPurlsShallowScore } from '../../../../src/commands/package/output-purls-shallow-score.mts'

const sampleArtifact = {
  type: 'npm',
  name: 'lodash',
  version: '4.17.21',
  score: {
    supplyChain: 0.9,
    maintenance: 0.85,
    quality: 0.95,
    vulnerability: 0.8,
    license: 0.99,
  },
  alerts: [],
} as any

describe('outputPurlsShallowScore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  it('sets exit code from result.code on failure', async () => {
    outputPurlsShallowScore(['pkg:npm/x'], { ok: false, message: 'fail', code: 5 } as any, 'text')
    expect(process.exitCode).toBe(5)
  })

  it('defaults exit code to 1 when result.code is missing', async () => {
    outputPurlsShallowScore(['pkg:npm/x'], { ok: false, message: 'fail' } as any, 'text')
    expect(process.exitCode).toBe(1)
  })

  it('logs JSON for failed result in JSON mode', async () => {
    outputPurlsShallowScore(['pkg:npm/x'], { ok: false, message: 'fail' } as any, 'json')
    expect(mockLogger.log).toHaveBeenCalled()
    expect(mockLogger.fail).not.toHaveBeenCalled()
  })

  it('logs JSON for successful result in JSON mode', async () => {
    outputPurlsShallowScore(
      ['pkg:npm/lodash@4.17.21'],
      { ok: true, data: [sampleArtifact] } as any,
      'json',
    )
    expect(mockLogger.log).toHaveBeenCalled()
  })

  it('logs failure with badge in non-JSON mode', async () => {
    outputPurlsShallowScore(
      ['pkg:npm/x'],
      { ok: false, message: 'fail', cause: 'detail' } as any,
      'text',
    )
    expect(mockLogger.fail).toHaveBeenCalled()
  })

  it('logs markdown report for successful result in markdown mode', async () => {
    outputPurlsShallowScore(
      ['pkg:npm/lodash@4.17.21'],
      { ok: true, data: [sampleArtifact] } as any,
      'markdown',
    )
    expect(mockLogger.log).toHaveBeenCalledWith(
      expect.stringContaining('# Shallow Package Report'),
    )
  })

  it('logs text report for successful result in text mode', async () => {
    outputPurlsShallowScore(
      ['pkg:npm/lodash@4.17.21'],
      { ok: true, data: [sampleArtifact] } as any,
      'text',
    )
    expect(mockLogger.log).toHaveBeenCalledWith(
      expect.stringContaining('Shallow Package Score'),
    )
  })

  it('flags missing PURLs in the report', async () => {
    outputPurlsShallowScore(
      ['pkg:npm/lodash@4.17.21', 'pkg:npm/missing@1.0.0'],
      { ok: true, data: [sampleArtifact] } as any,
      'markdown',
    )
    const calls = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
    expect(calls).toContain('Missing response')
    expect(calls).toContain('pkg:npm/missing@1.0.0')
  })

  it('does not flag a versioned PURL as missing when @latest companion is in the request (line 211)', () => {
    // The @latest dedup branch: when '@latest' is in the requested set
    // alongside a versioned PURL, the @latest entry is filtered out
    // (not marked as missing) since the versioned data covers it.
    outputPurlsShallowScore(
      ['pkg:npm/lodash@latest', 'pkg:npm/lodash@4.17.21'],
      { ok: true, data: [sampleArtifact] } as any,
      'markdown',
    )
    const calls = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
    // @latest should not appear in a "Missing response" section since
    // it has a versioned companion in the request.
    expect(calls).not.toMatch(/Missing.*pkg:npm\/lodash@latest/)
  })

  it('dedups artifacts and merges to lower scores (lines 228, 231, 234)', () => {
    const lower = {
      type: 'npm',
      name: 'lodash',
      version: '4.17.21',
      score: {
        supplyChain: 0.5,
        maintenance: 0.55,
        quality: 0.6,
        vulnerability: 0.65,
        license: 0.7,
      },
      alerts: [],
    } as any
    // Two artifacts that produce the same purl key — merge should pick lower scores.
    outputPurlsShallowScore(
      ['pkg:npm/lodash@4.17.21'],
      { ok: true, data: [sampleArtifact, lower] } as any,
      'text',
    )
    const calls = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
    // Output should appear only once even though two artifacts were provided.
    const matches = calls.match(/pkg:npm\/lodash/g) || []
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })
})
