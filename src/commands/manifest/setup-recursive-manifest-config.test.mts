import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./discover-manifest-roots.mts', () => ({
  findBuildToolCandidates: vi.fn(),
  // Identity: test dirs are already-absolute plain strings, no symlinks involved.
  realpathOrResolved: vi.fn(async (dir: string) => dir),
}))
vi.mock('@socketsecurity/registry/lib/prompts', () => ({
  select: vi.fn(),
}))
vi.mock('./setup-manifest-config.mts', () => ({
  setupGradle: vi.fn(),
  setupMaven: vi.fn(),
  setupSbt: vi.fn(),
}))
vi.mock('../../utils/socket-json.mts', () => ({
  readOrDefaultSocketJson: vi.fn(),
  readSocketJsonCascade: vi.fn(),
  readSocketJsonSync: vi.fn(),
  writeSocketJson: vi.fn(),
}))

import { select } from '@socketsecurity/registry/lib/prompts'

import { findBuildToolCandidates } from './discover-manifest-roots.mts'
import { setupGradle, setupMaven, setupSbt } from './setup-manifest-config.mts'
import {
  disableExclusionRoot,
  discoverExcludedCandidates,
  setupRecursiveManifestConfig,
  sortCandidatesForDisplay,
} from './setup-recursive-manifest-config.mts'
import {
  readOrDefaultSocketJson,
  readSocketJsonCascade,
  readSocketJsonSync,
  writeSocketJson,
} from '../../utils/socket-json.mts'

import type { SocketJson } from '../../utils/socket-json.mts'

function emptySockJson(): SocketJson {
  return { version: 1 } as SocketJson
}

// In-memory `dir -> own gradle section` store backing readSocketJsonCascade/
// readOrDefaultSocketJson/writeSocketJson, so a write made while processing
// one candidate is visible (via cascade) to a later candidate nested under
// it - the exact ordering behavior the "topmost only" tests exercise.
function makeFakeGradleDisk(cwd: string) {
  const store = new Map<string, Record<string, unknown>>()
  const ancestorsFarToNear = (dir: string): string[] => {
    const chain: string[] = []
    let current = dir
    while (current !== cwd) {
      chain.unshift(current)
      const parent = current.slice(0, current.lastIndexOf('/'))
      if (!parent || parent === current) {
        break
      }
      current = parent
    }
    return chain
  }
  return {
    readOrDefaultSocketJson: vi.fn((dir: string) => {
      const own = store.get(dir)
      return own
        ? ({
            version: 1,
            defaults: { manifest: { gradle: own } },
          } as SocketJson)
        : emptySockJson()
    }),
    readSocketJsonCascade: vi.fn((dir: string) => {
      let merged: Record<string, unknown> = {}
      for (const ancestor of ancestorsFarToNear(dir)) {
        const own = store.get(ancestor)
        if (own) {
          merged = { ...merged, ...own }
        }
      }
      return {
        version: 1,
        defaults: { manifest: { gradle: merged } },
      } as SocketJson
    }),
    writeSocketJson: vi.fn(async (dir: string, sockJson: SocketJson) => {
      store.set(
        dir,
        (sockJson.defaults?.manifest?.gradle as Record<string, unknown>) ?? {},
      )
      return { ok: true, data: undefined }
    }),
  }
}

describe('sortCandidatesForDisplay', () => {
  const cwd = '/repo'

  it('sorts shallower dirs before deeper ones, parent before child', () => {
    const sorted = sortCandidatesForDisplay(
      [
        { dir: '/repo/module-b/standalone-gradle-lib', ecosystems: ['gradle'] },
        { dir: '/repo/independent-service', ecosystems: ['maven'] },
      ],
      cwd,
    )
    expect(sorted).toEqual([
      { dir: '/repo/independent-service', ecosystems: ['maven'] },
      { dir: '/repo/module-b/standalone-gradle-lib', ecosystems: ['gradle'] },
    ])
  })
})

describe('discoverExcludedCandidates', () => {
  const cwd = '/repo'

  beforeEach(() => {
    vi.mocked(findBuildToolCandidates).mockReset()
  })

  it('excludes cwd itself', async () => {
    vi.mocked(findBuildToolCandidates).mockResolvedValue(
      new Map([['gradle', [cwd]]]),
    )

    const result = await discoverExcludedCandidates({
      cwd,
      rootSockJson: emptySockJson(),
    })

    expect(result).toEqual([])
  })

  it('marks a dir excluded when it is present in the full walk but absent from the excludePaths-filtered walk', async () => {
    const legacy = '/repo/legacy'
    const active = '/repo/active'
    vi.mocked(findBuildToolCandidates).mockImplementation(
      async ({ excludePaths }) =>
        excludePaths?.length
          ? new Map([['gradle', [active]]])
          : new Map([['gradle', [legacy, active]]]),
    )

    const result = await discoverExcludedCandidates({
      cwd,
      excludePaths: ['legacy'],
      rootSockJson: emptySockJson(),
    })

    expect(result).toEqual([{ dir: legacy, ecosystems: ['gradle'] }])
  })

  it('groups sibling projects under a non-project excluded ancestor into a single exclusion root', async () => {
    // legacy/ itself has no build file of its own - only its two children do -
    // so it never appears as a candidate, but --exclude-paths=legacy should
    // still collapse both into one write at legacy, not two writes at
    // legacy/a and legacy/b.
    const a = '/repo/legacy/a'
    const b = '/repo/legacy/b'
    vi.mocked(findBuildToolCandidates).mockImplementation(
      async ({ excludePaths }) =>
        excludePaths?.length
          ? new Map([
              ['maven', []],
              ['gradle', []],
            ])
          : new Map([
              ['maven', [a]],
              ['gradle', [b]],
            ]),
    )

    const result = await discoverExcludedCandidates({
      cwd,
      excludePaths: ['legacy'],
      rootSockJson: emptySockJson(),
    })

    expect(result).toEqual([
      { dir: '/repo/legacy', ecosystems: ['gradle', 'maven'] },
    ])
  })
})

describe('disableExclusionRoot', () => {
  const cwd = '/repo'
  const dir = '/repo/legacy'

  beforeEach(() => {
    vi.mocked(readSocketJsonCascade).mockReset()
    vi.mocked(readOrDefaultSocketJson).mockReset()
    vi.mocked(writeSocketJson).mockReset()
    vi.mocked(writeSocketJson).mockResolvedValue({ ok: true, data: undefined })
  })

  it('no-ops when the cascade already shows every ecosystem disabled', async () => {
    vi.mocked(readSocketJsonCascade).mockReturnValue({
      version: 1,
      defaults: { manifest: { gradle: { disabled: true } } },
    } as SocketJson)

    await disableExclusionRoot({
      cwd,
      dir,
      ecosystems: ['gradle'],
      rootSockJson: emptySockJson(),
    })

    expect(writeSocketJson).not.toHaveBeenCalled()
  })

  it('writes disabled:true, preserving other own-file content', async () => {
    vi.mocked(readSocketJsonCascade).mockImplementation(() => emptySockJson())
    vi.mocked(readOrDefaultSocketJson).mockImplementation(
      () =>
        ({
          version: 1,
          defaults: { manifest: { gradle: { bin: './gradlew' } } },
        }) as SocketJson,
    )

    await disableExclusionRoot({
      cwd,
      dir,
      ecosystems: ['gradle'],
      rootSockJson: emptySockJson(),
    })

    expect(writeSocketJson).toHaveBeenCalledWith(
      dir,
      expect.objectContaining({
        defaults: {
          manifest: { gradle: { bin: './gradlew', disabled: true } },
        },
      }),
    )
  })

  it('writes only the ecosystems not already covered by cascade', async () => {
    vi.mocked(readSocketJsonCascade).mockReturnValue({
      version: 1,
      defaults: { manifest: { gradle: { disabled: true } } },
    } as SocketJson)
    vi.mocked(readOrDefaultSocketJson).mockImplementation(() => emptySockJson())

    await disableExclusionRoot({
      cwd,
      dir,
      ecosystems: ['gradle', 'maven'],
      rootSockJson: emptySockJson(),
    })

    expect(writeSocketJson).toHaveBeenCalledWith(
      dir,
      expect.objectContaining({
        defaults: { manifest: { maven: { disabled: true } } },
      }),
    )
  })
})

describe('setupRecursiveManifestConfig', () => {
  const cwd = '/repo'

  beforeEach(() => {
    vi.mocked(select).mockReset()
    // Default: decline all three root ecosystem questions ("No" x3), then
    // never reach the write-confirmation select at all (configuredAny stays
    // false) - matches the common case of a root with no baseline defaults.
    vi.mocked(select).mockResolvedValue(false)
    vi.mocked(setupGradle).mockReset()
    vi.mocked(setupMaven).mockReset()
    vi.mocked(setupSbt).mockReset()
    vi.mocked(readSocketJsonSync).mockReset()
    vi.mocked(readSocketJsonSync).mockImplementation(() => ({
      ok: true,
      data: emptySockJson(),
    }))
    vi.mocked(findBuildToolCandidates).mockReset()
    vi.mocked(readOrDefaultSocketJson).mockReset()
    vi.mocked(readOrDefaultSocketJson).mockImplementation(() => emptySockJson())
    vi.mocked(readSocketJsonCascade).mockReset()
    vi.mocked(readSocketJsonCascade).mockImplementation(() => emptySockJson())
    vi.mocked(writeSocketJson).mockReset()
    vi.mocked(writeSocketJson).mockResolvedValue({ ok: true, data: undefined })
  })

  it('proceeds to discovery when all three root ecosystem questions are declined', async () => {
    vi.mocked(select)
      // Configure Maven/Gradle/sbt? -> no, no, no.
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      // Recursively discover...? -> yes.
      .mockResolvedValue(true)
    vi.mocked(findBuildToolCandidates).mockResolvedValue(new Map())

    const result = await setupRecursiveManifestConfig(cwd, false)

    expect(result).toEqual({ ok: true, data: { canceled: false } })
    expect(setupGradle).not.toHaveBeenCalled()
    expect(setupMaven).not.toHaveBeenCalled()
    expect(setupSbt).not.toHaveBeenCalled()
    expect(writeSocketJson).not.toHaveBeenCalled()
    expect(findBuildToolCandidates).toHaveBeenCalled()
  })

  it('skips discovery entirely when the user declines the recursive-discovery gate', async () => {
    vi.mocked(select)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      // Recursively discover...? -> no.
      .mockResolvedValue(false)

    const result = await setupRecursiveManifestConfig(cwd, false)

    expect(result).toEqual({ ok: true, data: { canceled: false } })
    expect(findBuildToolCandidates).not.toHaveBeenCalled()
  })

  it('configures maven at the root and writes it, then still proceeds to discovery', async () => {
    vi.mocked(select)
      // Configure Maven? -> yes.
      .mockResolvedValueOnce(true)
      // Configure Gradle? -> no.
      .mockResolvedValueOnce(false)
      // Configure sbt? -> no.
      .mockResolvedValueOnce(false)
      // Write the config? -> yes.
      .mockResolvedValueOnce(true)
    vi.mocked(setupMaven).mockResolvedValue({
      ok: true,
      data: { canceled: false },
    })
    vi.mocked(findBuildToolCandidates).mockResolvedValue(new Map())

    const result = await setupRecursiveManifestConfig(cwd, false)

    expect(result).toEqual({ ok: true, data: { canceled: false } })
    expect(setupMaven).toHaveBeenCalledTimes(1)
    expect(writeSocketJson).toHaveBeenCalledWith(cwd, expect.any(Object))
  })

  it('stops when canceling one of the root ecosystem questions', async () => {
    vi.mocked(select).mockResolvedValueOnce(null)

    const result = await setupRecursiveManifestConfig(cwd, false)

    expect(result.ok && result.data.canceled).toBe(true)
    expect(findBuildToolCandidates).not.toHaveBeenCalled()
  })

  it('stops when a root ecosystem sub-wizard is canceled', async () => {
    vi.mocked(select).mockResolvedValueOnce(true)
    vi.mocked(setupMaven).mockResolvedValue({
      ok: true,
      data: { canceled: true },
    })

    const result = await setupRecursiveManifestConfig(cwd, false)

    expect(result.ok && result.data.canceled).toBe(true)
    expect(findBuildToolCandidates).not.toHaveBeenCalled()
  })

  it('propagates a hard failure reading the root socket.json', async () => {
    vi.mocked(readSocketJsonSync).mockImplementation(() => ({
      ok: false,
      message: 'boom',
    }))

    const result = await setupRecursiveManifestConfig(cwd, false)

    expect(result.ok).toBe(false)
    expect(findBuildToolCandidates).not.toHaveBeenCalled()
  })

  it('reports nothing excluded without writing anything', async () => {
    vi.mocked(select)
      // Configure Maven/Gradle/sbt? -> no, no, no.
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      // Recursively discover...? -> yes.
      .mockResolvedValue(true)
    vi.mocked(findBuildToolCandidates).mockResolvedValue(
      new Map([['gradle', [`${cwd}/active`]]]),
    )

    const result = await setupRecursiveManifestConfig(cwd, false, ['legacy'])

    expect(result).toEqual({ ok: true, data: { canceled: false } })
    expect(findBuildToolCandidates).toHaveBeenCalled()
    expect(writeSocketJson).not.toHaveBeenCalled()
  })

  it('only writes disabled:true to the topmost of an excluded subtree', async () => {
    vi.mocked(select)
      // Configure Maven/Gradle/sbt? -> no, no, no.
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      // Recursively discover...? -> yes.
      .mockResolvedValue(true)
    const legacy = `${cwd}/legacy`
    const nested = `${legacy}/nested`
    const fake = makeFakeGradleDisk(cwd)
    vi.mocked(readOrDefaultSocketJson).mockImplementation(
      fake.readOrDefaultSocketJson,
    )
    vi.mocked(readSocketJsonCascade).mockImplementation(
      fake.readSocketJsonCascade,
    )
    vi.mocked(writeSocketJson).mockImplementation(fake.writeSocketJson)
    vi.mocked(findBuildToolCandidates).mockImplementation(
      async ({ excludePaths }) =>
        excludePaths?.length
          ? new Map([['gradle', []]])
          : new Map([['gradle', [legacy, nested]]]),
    )

    const result = await setupRecursiveManifestConfig(cwd, false, ['legacy'])

    expect(result).toEqual({ ok: true, data: { canceled: false } })
    expect(writeSocketJson).toHaveBeenCalledTimes(1)
    expect(writeSocketJson).toHaveBeenCalledWith(
      legacy,
      expect.objectContaining({
        defaults: { manifest: { gradle: { disabled: true } } },
      }),
    )
  })
})
