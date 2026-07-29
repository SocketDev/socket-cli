/**
 * @file The socket-mcp lock-step wiring holds. socket-cli is absorbing
 *   `@socketsecurity/mcp`, and the `mcp/socket-mcp-absorption` row plus the
 *   `upstream/socket-mcp` reference block are what make an unadopted upstream
 *   fix a mechanical signal instead of something a human has to notice. The
 *   harness that reads them, `pnpm run lockstep`, is not part of `check --all`,
 *   so this suite is where CI feels a deleted row, a dangling upstream
 *   reference, a renamed source directory, or a dropped `.gitmodules` pin.
 *   Drift is NOT asserted against: the row is deliberately below its parity
 *   floor until the OAuth adoption lands, and pinning the score here would
 *   force an edit to this file the day it does.
 */
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolvePinnedSha } from '../../../scripts/fleet/gen/gitmodules-hash.mts'
import {
  checkCrossRowConsistency,
  checkFeatureParity,
} from '../../../scripts/fleet/lockstep/checks.mts'
import {
  loadManifestTree,
  resolveManifestRoot,
} from '../../../scripts/fleet/lockstep/manifest.mts'
import { REPO_ROOT } from '../../../scripts/fleet/paths.mts'

const AREA = 'socket-cli'
const ROW_ID = 'mcp/socket-mcp-absorption'
const SUBMODULE_PATH = 'upstream/socket-mcp'

describe('socket-mcp lock-step row', () => {
  const { merged } = loadManifestTree(resolveManifestRoot(REPO_ROOT), REPO_ROOT)

  it('is declared exactly once', () => {
    expect(merged.rows.filter(r => r.id === ROW_ID)).toHaveLength(1)
  })

  it('passes the harness referential-integrity pass', () => {
    expect(
      checkCrossRowConsistency(
        merged.rows.map(row => ({ area: AREA, row })),
        merged,
      ),
    ).toStrictEqual([])
  })

  it('scores against source and test directories that exist', () => {
    const row = merged.rows.find(r => r.id === ROW_ID)
    expect(row?.kind).toBe('feature-parity')
    if (row?.kind !== 'feature-parity') {
      return
    }
    const report = checkFeatureParity(row, merged, AREA, REPO_ROOT)
    // `error` means a declared path is gone; `drift` means the patterns have
    // not all landed yet, which is the expected state pre-adoption.
    expect(report.severity).not.toBe('error')
    expect(report.messages.filter(m => m.includes('missing'))).toStrictEqual([])
  })

  it('resolves its pin from the .gitmodules reference block', () => {
    expect(
      resolvePinnedSha(path.join(REPO_ROOT, '.gitmodules'), SUBMODULE_PATH),
    ).toMatch(/^[0-9a-f]{40}$/)
  })
})
