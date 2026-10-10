import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  parsePatchManifest,
  readPatchManifest,
  writePatchManifest,
} from '../../../../src/core/patch/manifest.mts'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

const manifestFixture = {
  patches: {
    'pkg:npm/on-headers@1.0.2': {
      uuid: '00000000-0000-0000-0000-000000000000',
      exportedAt: '2025-09-10T20:10:19.407Z',
      files: {
        'index.js': {
          beforeHash: 'a'.repeat(64),
          afterHash: 'b'.repeat(64),
        },
      },
      vulnerabilities: {
        'GHSA-76c9-3jph-rj3q': {
          cves: ['CVE-2025-7339'],
          summary: 'Header handling issue',
          severity: 'LOW',
          description: 'A response header issue.',
        },
      },
      description: 'Patch for on-headers',
      license: 'MIT',
      tier: 'free',
    },
  },
}

describe('patch manifest', () => {
  it('parses the manifest shape and preserves additional state', () => {
    const parsed = parsePatchManifest(
      JSON.stringify({ ...manifestFixture, setup: { exclude: ['examples'] } }),
    )

    expect(parsed.patches['pkg:npm/on-headers@1.0.2']?.uuid).toBe(
      '00000000-0000-0000-0000-000000000000',
    )
    expect(parsed['setup']).toEqual({ exclude: ['examples'] })
  })

  it('rejects malformed patch records', () => {
    expect(() =>
      parsePatchManifest('{"patches":{"pkg:npm/x@1":{"uuid":1}}}'),
    ).toThrow('Manifest patch record is invalid')
  })

  it('reads and atomically replaces a manifest in the project state directory', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'socket-patch-'))
    try {
      await writePatchManifest(projectRoot, manifestFixture)
      const parsed = await readPatchManifest(projectRoot)
      const disk = await readFile(
        path.join(projectRoot, '.socket', 'manifest.json'),
        'utf8',
      )

      expect(parsed).toEqual(manifestFixture)
      expect(JSON.parse(disk)).toEqual(manifestFixture)
    } finally {
      await safeDelete(projectRoot)
    }
  })

  it('returns no manifest when the project has no patch state directory', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'socket-patch-'))
    try {
      expect(await readPatchManifest(projectRoot)).toBeUndefined()
    } finally {
      await safeDelete(projectRoot)
    }
  })

  it('does not follow a manifest symlink', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'socket-patch-'))
    const outsidePath = path.join(projectRoot, 'outside.json')
    const socketDirectory = path.join(projectRoot, '.socket')
    const manifestPath = path.join(socketDirectory, 'manifest.json')
    try {
      await mkdir(socketDirectory)
      await writeFile(outsidePath, JSON.stringify(manifestFixture))
      await symlink(outsidePath, manifestPath)

      await expect(readPatchManifest(projectRoot)).rejects.toThrow(
        'must be a regular file',
      )
    } finally {
      await safeDelete(projectRoot)
    }
  })
})
