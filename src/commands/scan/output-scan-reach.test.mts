/**
 * Regression tests for outputScanReach facts-file resolution.
 *
 * Test Coverage:
 * - Per-vulnerability reachability errors must be read from the facts
 *   file Coana actually wrote at `<cwd>/.socket.facts.json`, not from a
 *   relative path resolved against `process.cwd()`, so `--cwd <dir>` runs
 *   surface their errors instead of silently reporting none.
 *
 * Related Files:
 * - output-scan-reach.mts (implementation)
 * - utils/coana.mts (extractReachabilityErrors — exercised for real)
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { logger } from '@socketsecurity/registry/lib/logger'

import { outputScanReach } from './output-scan-reach.mts'

import type { ReachabilityAnalysisResult } from './perform-reachability-analysis.mts'
import type { CResult } from '../../types.mts'

vi.mock('../../constants.mts', () => ({
  default: {
    DOT_SOCKET_DOT_FACTS_JSON: '.socket.facts.json',
  },
}))

const errorComponentsBody = {
  components: [
    {
      name: 'lodash',
      version: '4.17.21',
      reachability: [
        {
          ghsa_id: 'GHSA-aaaa-bbbb-cccc',
          reachability: [{ type: 'error', subprojectPath: 'packages/web' }],
        },
      ],
    },
  ],
}

describe('outputScanReach facts-file resolution', () => {
  let scanCwd: string
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    scanCwd = mkdtempSync(path.join(tmpdir(), 'socket-rea495-out-'))
    // Silence the rest of the text output; only assert on warnings.
    vi.spyOn(logger, 'log').mockImplementation(() => logger)
    vi.spyOn(logger, 'info').mockImplementation(() => logger)
    vi.spyOn(logger, 'success').mockImplementation(() => logger)
    warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger)
  })

  afterEach(() => {
    rmSync(scanCwd, { force: true, recursive: true })
    vi.restoreAllMocks()
  })

  it('reads reachability errors from the facts file under the scan cwd, not process.cwd()', async () => {
    writeFileSync(
      path.join(scanCwd, '.socket.facts.json'),
      JSON.stringify(errorComponentsBody),
    )

    expect(scanCwd).not.toBe(process.cwd())

    const result: CResult<ReachabilityAnalysisResult> = {
      ok: true,
      data: {
        reachabilityReport: '.socket.facts.json',
        tier1ReachabilityScanId: undefined,
      },
    }

    await outputScanReach(result, {
      cwd: scanCwd,
      outputKind: 'text',
      outputPath: '',
    })

    // The summary warning plus one per-vulnerability warning are emitted.
    expect(warnSpy).toHaveBeenCalled()
    const warned = warnSpy.mock.calls.map(c => String(c[0])).join('\n')
    expect(warned).toContain('GHSA-aaaa-bbbb-cccc')
    expect(warned).toContain('lodash@4.17.21')
  })
})
