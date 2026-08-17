import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  findCrossMajorDuplicates,
  hoistAdvisory,
} from '../../../../src/commands/optimize/hoist-advisory.mts'

const probeMock = vi.hoisted(() => vi.fn())
const assessMock = vi.hoisted(() => vi.fn())
const manifestMock = vi.hoisted(() => vi.fn())

vi.mock(import('@socketsecurity/lib-stable/debug/output'), () => ({
  debug: vi.fn(),
  debugDir: vi.fn(),
}))

vi.mock(import('@socketsecurity/odai'), () => ({
  assessHoistSafety: assessMock,
  createOdaiModel: vi.fn(async () => ({})),
  probeAvailability: probeMock,
}))

vi.mock(
  import('@socketsecurity/lib-stable/packages/manifest'),
  () => ({
    fetchPackageManifest: manifestMock,
  }),
)

const LOCKFILE = `
lockfileVersion: '9.0'
packages:
  ansi-styles@3.2.1:
    resolution: {integrity: sha1-aaa}
  ansi-styles@4.3.0:
    resolution: {integrity: sha1-bbb}
  ansi-styles@6.2.1:
    resolution: {integrity: sha1-ccc}
  semver@7.6.3:
    resolution: {integrity: sha1-ddd}
`

describe('findCrossMajorDuplicates', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hoist-advisory-'))
  })

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true })
  })

  it('finds packages present under two or more majors', async () => {
    writeFileSync(path.join(dir, 'pnpm-lock.yaml'), LOCKFILE)
    const duplicates = await findCrossMajorDuplicates(dir)
    expect(duplicates).toEqual([
      {
        majors: [3, 4, 6],
        name: 'ansi-styles',
        versions: ['3.2.1', '4.3.0', '6.2.1'],
      },
    ])
  })

  it('returns none when every package sits on one major', async () => {
    writeFileSync(
      path.join(dir, 'pnpm-lock.yaml'),
      'packages:\n  semver@7.6.3:\n    resolution: {integrity: sha1-ddd}',
    )
    expect(await findCrossMajorDuplicates(dir)).toEqual([])
  })

  it('returns none without a lockfile', async () => {
    expect(await findCrossMajorDuplicates(dir)).toEqual([])
  })
})

describe('hoistAdvisory', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hoist-advisory-'))
    writeFileSync(path.join(dir, 'pnpm-lock.yaml'), LOCKFILE)
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ engines: { node: '>=20' } }),
    )
  })

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true })
    vi.clearAllMocks()
  })

  it('degrades to the mechanical list when odai is unavailable', async () => {
    probeMock.mockResolvedValue({ available: false })
    const lines = await hoistAdvisory(dir)
    expect(lines).toHaveLength(1)
    expect(lines[0]!.suggestion).toContain('majors 3, 4, 6')
    expect(lines[0]!.suggestion).toContain('odai backend unavailable')
    expect(assessMock).not.toHaveBeenCalled()
  })

  it('gives a safe-to-unify suggestion when odai says safe', async () => {
    probeMock.mockResolvedValue({ available: true })
    manifestMock.mockResolvedValue({ readme: '# Changelog\n\n## 6.0.0\nNothing scary.' })
    assessMock.mockResolvedValue({
      ok: true,
      data: { breakingChanges: [], reason: '', verdict: 'safe' },
    })
    const lines = await hoistAdvisory(dir)
    expect(lines[0]!.suggestion).toContain('3.2.1 → 6.2.1')
    expect(lines[0]!.suggestion).toContain('safe to unify')
    expect(lines[0]!.suggestion).toContain("hoistPattern: ['ansi-styles']")
  })

  it('abstains when odai finds breaking changes', async () => {
    probeMock.mockResolvedValue({ available: true })
    manifestMock.mockResolvedValue({ readme: '# Changelog\n\n## 6.0.0\nDropped Node 14.' })
    assessMock.mockResolvedValue({
      ok: true,
      data: {
        breakingChanges: ['dropped Node 14 support'],
        reason: 'node drop',
        verdict: 'unsafe',
      },
    })
    const lines = await hoistAdvisory(dir)
    expect(lines[0]!.suggestion).toContain('unsafe')
    expect(lines[0]!.suggestion).toContain('dropped Node 14 support')
  })

  it('returns no lines for an empty project path', async () => {
    expect(await hoistAdvisory(undefined)).toEqual([])
  })
})
