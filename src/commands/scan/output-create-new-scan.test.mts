/**
 * Unit tests for the create-scan output layer.
 *
 * Test Coverage:
 * - outputCreateNewScan: the `reachabilityFallback` marker in the JSON and
 *   markdown payloads, and its absence on a full reachability run.
 *
 * Related Files:
 * - commands/scan/output-create-new-scan.mts (implementation)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { logger } from '@socketsecurity/registry/lib/logger'

import { outputCreateNewScan } from './output-create-new-scan.mts'

import type { FullScanResult } from '@socketsecurity/sdk'

const SCAN_DATA = {
  html_report_url: 'https://socket.dev/report',
  id: 'scan-id',
} as unknown as FullScanResult['data']

const FALLBACK = {
  cause: 'upstream gateway disconnected',
  message: 'Failed to fetch artifacts from Socket API',
}

describe('outputCreateNewScan reachability fallback', () => {
  let logged: string[]
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logged = []
    logSpy = vi
      .spyOn(logger, 'log')
      .mockImplementation((...args: unknown[]) => {
        logged.push(String(args[0] ?? ''))
        return logger
      })
  })

  afterEach(() => {
    logSpy.mockRestore()
  })

  it('marks the JSON payload when the scan fell back to a regular scan', async () => {
    await outputCreateNewScan(
      { data: SCAN_DATA, ok: true },
      { outputKind: 'json', reachabilityFallback: FALLBACK },
    )

    expect(JSON.parse(logged.join(''))).toEqual({
      data: { html_report_url: 'https://socket.dev/report', id: 'scan-id' },
      ok: true,
      reachabilityFallback: FALLBACK,
    })
  })

  it('leaves the JSON payload unmarked on a full reachability run', async () => {
    await outputCreateNewScan(
      { data: SCAN_DATA, ok: true },
      { outputKind: 'json' },
    )

    expect(JSON.parse(logged.join(''))).not.toHaveProperty(
      'reachabilityFallback',
    )
  })

  it('notes the fallback in the markdown report', async () => {
    await outputCreateNewScan(
      { data: SCAN_DATA, ok: true },
      { outputKind: 'markdown', reachabilityFallback: FALLBACK },
    )

    expect(logged.join('\n')).toContain(
      'Reachability analysis failed (Failed to fetch artifacts from Socket API); this Scan holds regular SCA results only.',
    )
  })
})
