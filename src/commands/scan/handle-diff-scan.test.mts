import { describe, expect, it, vi } from 'vitest'

import { handleDiffScan } from './handle-diff-scan.mts'

// Mock the dependencies.
vi.mock('./fetch-diff-scan.mts', () => ({
  fetchDiffScan: vi.fn(),
}))

vi.mock('./output-diff-scan.mts', () => ({
  outputDiffScan: vi.fn(),
}))

describe('handleDiffScan', () => {
  it('fetches and outputs scan diff successfully', async () => {
    const { fetchDiffScan } = await import('./fetch-diff-scan.mts')
    const { outputDiffScan } = await import('./output-diff-scan.mts')
    const mockFetch = vi.mocked(fetchDiffScan)
    const mockOutput = vi.mocked(outputDiffScan)

    const mockDiff = {
      ok: true,
      data: {
        added: [{ name: 'new-package', version: '1.0.0' }],
        removed: [{ name: 'old-package', version: '0.9.0' }],
        changed: [
          {
            name: 'updated-package',
            oldVersion: '1.0.0',
            newVersion: '2.0.0',
          },
        ],
      },
    }
    mockFetch.mockResolvedValue(mockDiff)

    await handleDiffScan({
      depth: 10,
      file: 'diff-report.json',
      id1: 'scan-123',
      id2: 'scan-456',
      orgSlug: 'test-org',
      outputKind: 'json',
    })

    expect(mockFetch).toHaveBeenCalledWith({
      id1: 'scan-123',
      id2: 'scan-456',
      orgSlug: 'test-org',
    })
    expect(mockOutput).toHaveBeenCalledWith(mockDiff, {
      depth: 10,
      file: 'diff-report.json',
      outputKind: 'json',
    })
  })

  it('handles fetch failure', async () => {
    const { fetchDiffScan } = await import('./fetch-diff-scan.mts')
    const { outputDiffScan } = await import('./output-diff-scan.mts')
    const mockFetch = vi.mocked(fetchDiffScan)
    const mockOutput = vi.mocked(outputDiffScan)

    const mockError = {
      ok: false,
      error: 'Scans not found',
    }
    mockFetch.mockResolvedValue(mockError)

    await handleDiffScan({
      depth: 5,
      file: '',
      id1: 'invalid-1',
      id2: 'invalid-2',
      orgSlug: 'test-org',
      outputKind: 'text',
    })

    expect(mockOutput).toHaveBeenCalledWith(mockError, {
      depth: 5,
      file: '',
      outputKind: 'text',
    })
  })

  it('handles markdown output format', async () => {
    const { fetchDiffScan } = await import('./fetch-diff-scan.mts')
    const { outputDiffScan } = await import('./output-diff-scan.mts')
    const mockFetch = vi.mocked(fetchDiffScan)
    const mockOutput = vi.mocked(outputDiffScan)

    mockFetch.mockResolvedValue({ ok: true, data: {} })

    await handleDiffScan({
      depth: 3,
      file: 'output.md',
      id1: 'scan-abc',
      id2: 'scan-def',
      orgSlug: 'my-org',
      outputKind: 'markdown',
    })

    expect(mockOutput).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        outputKind: 'markdown',
        file: 'output.md',
      }),
    )
  })

  it('handles different depth values', async () => {
    const { fetchDiffScan } = await import('./fetch-diff-scan.mts')
    const { outputDiffScan } = await import('./output-diff-scan.mts')
    const mockFetch = vi.mocked(fetchDiffScan)
    const mockOutput = vi.mocked(outputDiffScan)

    mockFetch.mockResolvedValue({ ok: true, data: {} })

    const depths = [0, 1, 5, 10, 100]

    for (const depth of depths) {
      // eslint-disable-next-line no-await-in-loop
      await handleDiffScan({
        depth,
        file: '',
        id1: 'scan-1',
        id2: 'scan-2',
        orgSlug: 'test-org',
        outputKind: 'json',
      })

      expect(mockOutput).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ depth }),
      )
    }
  })

  it('handles text output without file', async () => {
    const { fetchDiffScan } = await import('./fetch-diff-scan.mts')
    const { outputDiffScan } = await import('./output-diff-scan.mts')
    const mockFetch = vi.mocked(fetchDiffScan)
    const mockOutput = vi.mocked(outputDiffScan)

    mockFetch.mockResolvedValue({
      ok: true,
      data: {
        added: [],
        removed: [],
        changed: [],
        summary: 'No changes detected',
      },
    })

    await handleDiffScan({
      depth: 2,
      file: '',
      id1: 'scan-old',
      id2: 'scan-new',
      orgSlug: 'production-org',
      outputKind: 'text',
    })

    expect(mockOutput).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          summary: 'No changes detected',
        }),
      }),
      expect.objectContaining({
        file: '',
        outputKind: 'text',
      }),
    )
  })
})
