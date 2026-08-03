/**
 * Unit tests for trusted bin-path resolution.
 *
 * `findBinPathDetailsSync` walks every PATH match and takes the first one the
 * scanned project cannot control, which is what `socket raw-npm` /
 * `socket raw-npx` spawn. Tests cover the trust filter (shadow bins, the
 * working directory, wrapper unwrapping) and the shapes `whichRealSync`
 * returns.
 *
 * Related Files: - util/fs/path-resolve.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  findBinPathDetailsSync,
  isProjectControlledBinPath,
} from '../../../../src/util/fs/path-resolve.mts'
import { createTestWorkspace } from '../../../helpers/workspace-helper.mts'

import type * as BinResolveModule from '@socketsecurity/lib-stable/bin/resolve'
import type * as BinWhichModule from '@socketsecurity/lib-stable/bin/which'

const mockWhichRealSync = vi.hoisted(() => vi.fn())
const mockResolveRealBinSync = vi.hoisted(() => vi.fn((p: string) => p))

vi.mock(import('@socketsecurity/lib-stable/bin/resolve'), async () => {
  const actual = await vi.importActual<typeof BinResolveModule>(
    '@socketsecurity/lib-stable/bin/resolve',
  )
  return {
    ...actual,
    resolveRealBinSync: mockResolveRealBinSync,
  }
})

vi.mock(import('@socketsecurity/lib-stable/bin/which'), async () => {
  const actual = await vi.importActual<typeof BinWhichModule>(
    '@socketsecurity/lib-stable/bin/which',
  )
  return {
    ...actual,
    whichRealSync: mockWhichRealSync,
  }
})

describe('Bin path resolution', () => {
  describe('findBinPathDetailsSync', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('finds bin path when available', () => {
      mockWhichRealSync.mockReturnValue(['/usr/local/bin/npm'])

      const result = findBinPathDetailsSync('npm')

      expect(result).toEqual({
        name: 'npm',
        path: '/usr/local/bin/npm',
      })
    })

    it('handles no bin path found', () => {
      mockWhichRealSync.mockReturnValue(undefined)

      const result = findBinPathDetailsSync('nonexistent')

      expect(result).toEqual({
        name: 'nonexistent',
        path: undefined,
      })
    })

    it('handles empty array result', () => {
      mockWhichRealSync.mockReturnValue([])

      const result = findBinPathDetailsSync('npm')

      expect(result).toEqual({
        name: 'npm',
        path: undefined,
      })
    })

    it('handles single string result', () => {
      mockWhichRealSync.mockReturnValue('/usr/local/bin/npm')

      const result = findBinPathDetailsSync('npm')

      expect(result).toEqual({
        name: 'npm',
        path: '/usr/local/bin/npm',
      })
    })

    it('skips a node_modules/.bin shim and takes the first system match', async () => {
      const workspace = await createTestWorkspace({
        files: [
          { path: 'node_modules/.bin/npm', content: '#!/bin/sh\n' },
          { path: 'system/bin/npm', content: '#!/bin/sh\n' },
        ],
      })

      try {
        const shadowBinPath = workspace.resolve('node_modules/.bin/npm')
        const systemBinPath = workspace.resolve('system/bin/npm')
        mockWhichRealSync.mockReturnValue([shadowBinPath, systemBinPath])

        const result = findBinPathDetailsSync('npm', { cwd: '/elsewhere' })

        expect(result).toEqual({ name: 'npm', path: systemBinPath })
      } finally {
        await workspace.cleanup()
      }
    })

    it('skips a candidate served by the working directory', async () => {
      const workspace = await createTestWorkspace({
        files: [
          { path: 'repo/npm', content: '#!/bin/sh\n' },
          { path: 'system/bin/npm', content: '#!/bin/sh\n' },
        ],
      })

      try {
        const repoBinPath = workspace.resolve('repo/npm')
        const systemBinPath = workspace.resolve('system/bin/npm')
        mockWhichRealSync.mockReturnValue([repoBinPath, systemBinPath])

        const result = findBinPathDetailsSync('npm', {
          cwd: workspace.resolve('repo'),
        })

        expect(result).toEqual({ name: 'npm', path: systemBinPath })
      } finally {
        await workspace.cleanup()
      }
    })

    it('skips a wrapper that unwraps into the working directory', async () => {
      const workspace = await createTestWorkspace({
        files: [{ path: 'shim/npm-cli.js', content: '' }],
      })

      try {
        const unwrappedPath = workspace.resolve('shim/npm-cli.js')
        mockWhichRealSync.mockReturnValue(['/usr/local/bin/npm'])
        mockResolveRealBinSync.mockReturnValue(unwrappedPath)

        const result = findBinPathDetailsSync('npm', { cwd: workspace.path })

        expect(result).toEqual({ name: 'npm', path: undefined })
      } finally {
        mockResolveRealBinSync.mockImplementation((p: string) => p)
        await workspace.cleanup()
      }
    })

    it('reports no path when every candidate is project controlled', async () => {
      const workspace = await createTestWorkspace({
        files: [{ path: 'node_modules/.bin/npm', content: '#!/bin/sh\n' }],
      })

      try {
        mockWhichRealSync.mockReturnValue([
          workspace.resolve('node_modules/.bin/npm'),
        ])

        const result = findBinPathDetailsSync('npm', { cwd: workspace.path })

        expect(result).toEqual({ name: 'npm', path: undefined })
      } finally {
        await workspace.cleanup()
      }
    })
  })

  describe('isProjectControlledBinPath', () => {
    it('flags a node_modules/.bin shim', () => {
      expect(
        isProjectControlledBinPath('/repo/node_modules/.bin/npm', {
          cwd: '/elsewhere',
        }),
      ).toBe(true)
    })

    it('flags the working directory itself', () => {
      expect(isProjectControlledBinPath('/repo/npm', { cwd: '/repo' })).toBe(
        true,
      )
    })

    it('flags a descendant of the working directory', () => {
      expect(
        isProjectControlledBinPath('/repo/bin/npm', { cwd: '/repo' }),
      ).toBe(true)
    })

    it('allows a system directory', () => {
      expect(
        isProjectControlledBinPath('/usr/local/bin/npm', { cwd: '/repo' }),
      ).toBe(false)
    })

    it('allows a sibling directory with a shared prefix', () => {
      expect(
        isProjectControlledBinPath('/repo-tools/bin/npm', { cwd: '/repo' }),
      ).toBe(false)
    })

    it('allows an undefined path', () => {
      expect(isProjectControlledBinPath(undefined, { cwd: '/repo' })).toBe(
        false,
      )
    })
  })
})
