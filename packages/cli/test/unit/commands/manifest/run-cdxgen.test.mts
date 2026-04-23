/**
 * Unit tests for run-cdxgen helpers.
 *
 * Covers the lockfile/node_modules probe and Node.js type detection that
 * gate the default `socket cdxgen` path against shipping empty-components
 * SBOMs (SMO-590).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockFindUp = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/utils/fs/find-up.mts', () => ({
  findUp: mockFindUp,
}))

const { detectNodejsCdxgenSources, isNodejsCdxgenType } = await import(
  '../../../../src/commands/manifest/run-cdxgen.mts'
)

describe('isNodejsCdxgenType', () => {
  it('treats an undefined type as Node.js (the cdxgen default)', () => {
    expect(isNodejsCdxgenType(undefined)).toBe(true)
    expect(isNodejsCdxgenType(null)).toBe(true)
  })

  it.each(['js', 'javascript', 'typescript', 'nodejs', 'npm', 'pnpm', 'ts'])(
    'recognizes %s as Node.js',
    type => {
      expect(isNodejsCdxgenType(type)).toBe(true)
    },
  )

  it.each(['python', 'java', 'go', 'rust'])('rejects %s', type => {
    expect(isNodejsCdxgenType(type)).toBe(false)
  })

  it('matches arrays containing at least one Node.js entry', () => {
    expect(isNodejsCdxgenType(['python', 'js'])).toBe(true)
    expect(isNodejsCdxgenType(['python', 'java'])).toBe(false)
  })
})

describe('detectNodejsCdxgenSources', () => {
  beforeEach(() => {
    mockFindUp.mockReset()
  })

  it('reports neither source when nothing is found', async () => {
    mockFindUp.mockResolvedValue(undefined)
    const result = await detectNodejsCdxgenSources('/tmp/project')
    expect(result).toEqual({ hasLockfile: false, hasNodeModules: false })
  })

  it('detects a pnpm-lock.yaml', async () => {
    mockFindUp.mockImplementation((name: string) =>
      Promise.resolve(name === 'pnpm-lock.yaml' ? '/x/pnpm-lock.yaml' : undefined),
    )
    const result = await detectNodejsCdxgenSources('/tmp/project')
    expect(result.hasLockfile).toBe(true)
    expect(result.hasNodeModules).toBe(false)
  })

  it('detects a package-lock.json', async () => {
    mockFindUp.mockImplementation((name: string) =>
      Promise.resolve(
        name === 'package-lock.json' ? '/x/package-lock.json' : undefined,
      ),
    )
    const result = await detectNodejsCdxgenSources('/tmp/project')
    expect(result.hasLockfile).toBe(true)
  })

  it('detects a yarn.lock', async () => {
    mockFindUp.mockImplementation((name: string) =>
      Promise.resolve(name === 'yarn.lock' ? '/x/yarn.lock' : undefined),
    )
    const result = await detectNodejsCdxgenSources('/tmp/project')
    expect(result.hasLockfile).toBe(true)
  })

  it('detects node_modules/', async () => {
    mockFindUp.mockImplementation((name: string) =>
      Promise.resolve(name === 'node_modules' ? '/x/node_modules' : undefined),
    )
    const result = await detectNodejsCdxgenSources('/tmp/project')
    expect(result.hasLockfile).toBe(false)
    expect(result.hasNodeModules).toBe(true)
  })
})
