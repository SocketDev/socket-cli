import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  findCrossMajorDuplicates,
  hoistAdvisory,
} from '../../../../src/core/optimize/hoist-advisory.mts'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

const operationMock = vi.hoisted(() => vi.fn())
const assessMock = vi.hoisted(() => vi.fn())
const changelogMock = vi.hoisted(() => vi.fn())

vi.mock(import('@socketsecurity/lib-stable/debug/output'), () => ({
  debug: vi.fn(),
  debugDir: vi.fn(),
}))

vi.mock(import('@socketsecurity/odai/node'), () => ({
  assessHoistSafety: assessMock,
  withOdaiModel: operationMock,
  fetchChangelog: changelogMock,
}))

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

  afterEach(async () => {
    await safeDelete(dir)
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

  afterEach(async () => {
    await safeDelete(dir)
    vi.clearAllMocks()
  })

  it('degrades to the mechanical list when odai is unavailable', async () => {
    operationMock.mockRejectedValue(new Error('No eligible local backend'))
    const lines = await hoistAdvisory(dir)
    expect(lines).toHaveLength(1)
    expect(lines[0]!.suggestion).toContain('majors 3, 4, 6')
    expect(lines[0]!.suggestion).toContain('odai backend unavailable')
    expect(assessMock).not.toHaveBeenCalled()
  })

  it('gives a safe-to-unify suggestion when odai says safe', async () => {
    operationMock.mockImplementation(async callback =>
      callback({}, { abortSignal: new AbortController().signal }),
    )
    changelogMock.mockResolvedValue({
      source: 'registry-readme',
      text: '# Changelog\n\n## 6.0.0\nNothing scary.',
    })
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
    operationMock.mockImplementation(async callback =>
      callback({}, { abortSignal: new AbortController().signal }),
    )
    changelogMock.mockResolvedValue({
      source: 'registry-readme',
      text: '# Changelog\n\n## 6.0.0\nDropped Node 14.',
    })
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
    expect(lines[0]!.suggestion).toContain('assessed against registry-readme')
    // No model stamp on the released odai line: a meaningless label ('odai
    // modern') does not print.
    expect(lines[0]!.suggestion).not.toContain('odai modern')
  })

  it('says the model is unknown when only the backend is known', async () => {
    operationMock.mockImplementation(async callback =>
      callback({}, { abortSignal: new AbortController().signal }),
    )
    changelogMock.mockResolvedValue({
      source: 'registry-readme',
      text: '# Changelog\n\n## 6.0.0\nAll good.',
    })
    assessMock.mockResolvedValue({
      ok: true,
      data: { breakingChanges: [], reason: '', verdict: 'safe' },
      model: 'chrome-builtin',
    })
    const lines = await hoistAdvisory(dir)
    expect(lines[0]!.suggestion).toContain(
      '(odai unknown model via chrome-builtin)',
    )
  })

  it('labels the stamped model identity when odai provides it', async () => {
    operationMock.mockImplementation(async callback =>
      callback({}, { abortSignal: new AbortController().signal }),
    )
    changelogMock.mockResolvedValue({
      source: 'registry-readme',
      text: '# Changelog\n\n## 6.0.0\nAll good.',
    })
    assessMock.mockResolvedValue({
      ok: true,
      data: { breakingChanges: [], reason: '', verdict: 'safe' },
      model: 'Gemini Nano',
    })
    const lines = await hoistAdvisory(dir)
    expect(lines[0]!.suggestion).toContain('(odai Gemini Nano)')
  })

  it('preserves changelog provenance supplied by odai', async () => {
    operationMock.mockImplementation(async callback =>
      callback({}, { abortSignal: new AbortController().signal }),
    )
    changelogMock.mockResolvedValue({
      source: 'local-changelog',
      text: '# Changes',
    })
    assessMock.mockResolvedValue({
      ok: true,
      data: { breakingChanges: [], reason: '', verdict: 'safe' },
    })
    const lines = await hoistAdvisory(dir)
    expect(lines[0]!.suggestion).toContain('assessed against local-changelog')
    expect(changelogMock).toHaveBeenCalledWith('ansi-styles', {
      root: dir,
      version: '6.2.1',
      abortSignal: expect.any(AbortSignal),
    })
    expect(operationMock).toHaveBeenCalledWith(expect.any(Function), {
      timeoutMs: 5000,
    })
  })

  it('says assessment failed when extraction errors on real text', async () => {
    operationMock.mockImplementation(async callback =>
      callback({}, { abortSignal: new AbortController().signal }),
    )
    changelogMock.mockResolvedValue({
      source: 'registry-readme',
      text: '# Changelog\n\n## 6.0.0\nLots here.',
    })
    assessMock.mockResolvedValue({ ok: false })
    const lines = await hoistAdvisory(dir)
    expect(lines[0]!.suggestion).toContain(
      'assessment failed against registry-readme',
    )
    expect(lines[0]!.suggestion).toContain('review manually')
  })

  it('returns no lines for an empty project path', async () => {
    expect(await hoistAdvisory(undefined)).toEqual([])
  })
})
