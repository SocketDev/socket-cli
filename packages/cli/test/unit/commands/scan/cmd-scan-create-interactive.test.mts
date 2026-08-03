/**
 * Unit tests for the `socket scan create` interactive target/org resolver.
 *
 * Purpose: covers the auto-manifest hint, which is suppressed once a
 * `.socket.facts.json` is present at cwd.
 *
 * Related Files: - src/commands/scan/cmd-scan-create-interactive.mts.
 */

import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

const mockDetectManifestActions = vi.hoisted(() => vi.fn())
const mockInfo = vi.hoisted(() => vi.fn())

vi.mock(
  import('../../../../src/commands/manifest/detect-manifest-actions.mts'),
  () => ({
    detectManifestActions: mockDetectManifestActions,
  }),
)

vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => ({
    error: vi.fn(),
    info: mockInfo,
  }),
}))

import { resolveScanCreateTargetsAndOrg } from '../../../../src/commands/scan/cmd-scan-create-interactive.mts'

import type { SocketJson } from '../../../../src/util/socket/json.mts'

describe('resolveScanCreateTargetsAndOrg auto-manifest hint', () => {
  let cwd = ''

  beforeEach(() => {
    vi.clearAllMocks()
    mockDetectManifestActions.mockResolvedValue({ count: 3 })
    cwd = mkdtempSync(path.join(os.tmpdir(), 'socket-scan-create-'))
  })

  afterEach(async () => {
    await safeDelete(cwd)
  })

  async function resolve() {
    return await resolveScanCreateTargetsAndOrg({
      autoManifest: false,
      cli: { input: [cwd] },
      cwd,
      dryRun: true,
      hasApiToken: false,
      interactive: false,
      orgSlug: 'test-org',
      outputKind: 'text',
      sockJson: {} as SocketJson,
    })
  }

  it('hints at --auto-manifest when manifests are detected', async () => {
    await resolve()

    expect(mockInfo).toHaveBeenCalledWith(
      expect.stringContaining('Detected 3 manifest targets'),
    )
  })

  it('suppresses the hint when a .socket.facts.json is already present', async () => {
    writeFileSync(path.join(cwd, '.socket.facts.json'), '{}')

    await resolve()

    expect(mockInfo).not.toHaveBeenCalledWith(
      expect.stringContaining('Detected 3 manifest targets'),
    )
  })
})
