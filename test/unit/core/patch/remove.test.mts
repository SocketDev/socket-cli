import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  readPatchManifest,
  writePatchManifest,
} from '../../../../src/core/patch/manifest.mts'
import {
  planPatchRemoval,
  removePatchRecords,
} from '../../../../src/core/patch/remove.mts'

import type { PatchManifest } from '../../../../src/core/patch/manifest.mts'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

const manifest: PatchManifest = {
  patches: {
    'pkg:npm/apple@1.0.0': {
      uuid: '11111111-1111-1111-1111-111111111111',
      exportedAt: '2026-01-01T00:00:00Z',
      files: {},
      vulnerabilities: {},
      description: 'apple patch',
      license: 'MIT',
      tier: 'free',
    },
    'pkg:npm/zebra@1.0.0': {
      uuid: '22222222-2222-2222-2222-222222222222',
      exportedAt: '2026-01-01T00:00:00Z',
      files: {},
      vulnerabilities: {},
      description: 'zebra patch',
      license: 'MIT',
      tier: 'free',
    },
  },
  setup: { exclude: ['examples'] },
}

describe('patch manifest removal', () => {
  it('plans identifier removal without changing the manifest', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'socket-patch-'))
    try {
      await writePatchManifest(projectRoot, manifest)
      const plan = await planPatchRemoval(
        projectRoot,
        '22222222-2222-2222-2222-222222222222',
      )

      expect(plan.removed).toEqual(['pkg:npm/zebra@1.0.0'])
      expect(await readPatchManifest(projectRoot)).toEqual(manifest)
    } finally {
      await safeDelete(projectRoot)
    }
  })

  it('removes only matching records and preserves unrelated manifest data', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'socket-patch-'))
    try {
      await writePatchManifest(projectRoot, manifest)
      const result = await removePatchRecords(
        projectRoot,
        'pkg:npm/zebra@1.0.0',
      )
      const updated = await readPatchManifest(projectRoot)

      expect(result).toEqual({
        removed: ['pkg:npm/zebra@1.0.0'],
        manifestFound: true,
      })
      expect(updated?.patches).toEqual({
        'pkg:npm/apple@1.0.0': manifest.patches['pkg:npm/apple@1.0.0'],
      })
      expect(updated?.['setup']).toEqual({ exclude: ['examples'] })
    } finally {
      await safeDelete(projectRoot)
    }
  })

  it('does not write when the identifier has no match', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'socket-patch-'))
    try {
      await writePatchManifest(projectRoot, manifest)
      const result = await removePatchRecords(projectRoot, 'pkg:npm/unknown@1')

      expect(result.removed).toEqual([])
      expect(await readPatchManifest(projectRoot)).toEqual(manifest)
    } finally {
      await safeDelete(projectRoot)
    }
  })
})
