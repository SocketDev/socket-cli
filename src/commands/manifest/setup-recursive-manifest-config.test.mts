import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./discover-manifest-roots.mts', async importOriginal => {
  const actual =
    await importOriginal<typeof import('./discover-manifest-roots.mts')>()
  return {
    findBuildToolCandidates: vi.fn(),
    // Identity: test dirs are already-absolute plain strings, no symlinks involved.
    realpathOrResolved: vi.fn(async (dir: string) => dir),
    // Real (pure) implementation - no need to mock it.
    withoutDisabledFlags: actual.withoutDisabledFlags,
  }
})
vi.mock('./enumerate-workspaces.mts', () => ({
  enumerateWorkspaces: vi.fn(),
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

import { logger } from '@socketsecurity/registry/lib/logger'
import { select } from '@socketsecurity/registry/lib/prompts'

import { findBuildToolCandidates } from './discover-manifest-roots.mts'
import { enumerateWorkspaces } from './enumerate-workspaces.mts'
import { setupGradle, setupMaven, setupSbt } from './setup-manifest-config.mts'
import {
  configureCandidate,
  disableExclusionRoot,
  discoverBuildRoots,
  markWorkspaceCoverage,
  processCandidate,
  scanBuildRoots,
  setupRecursiveManifestConfig,
  sortCandidatesForDisplay,
} from './setup-recursive-manifest-config.mts'
import {
  readOrDefaultSocketJson,
  readSocketJsonCascade,
  readSocketJsonSync,
  writeSocketJson,
} from '../../utils/socket-json.mts'

import type { BuildTool } from './scripts/build-tool.mts'
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

describe('scanBuildRoots', () => {
  const cwd = '/repo'

  beforeEach(() => {
    vi.mocked(findBuildToolCandidates).mockReset()
  })

  it('runs the unfiltered and excludePaths-filtered walks once each and returns both', async () => {
    const unfiltered = new Map([['gradle', ['/repo/a', '/repo/legacy']]])
    const filtered = new Map([['gradle', ['/repo/a']]])
    vi.mocked(findBuildToolCandidates).mockImplementation(
      async ({ excludePaths }) =>
        excludePaths?.length ? filtered : unfiltered,
    )

    const result = await scanBuildRoots({
      cwd,
      excludePaths: ['legacy'],
      sockJson: emptySockJson(),
    })

    expect(result).toEqual({
      fullByTool: unfiltered,
      includedByTool: filtered,
    })
    expect(findBuildToolCandidates).toHaveBeenCalledTimes(2)
  })
})

describe('discoverBuildRoots', () => {
  const cwd = '/repo'

  it('excludes cwd itself', async () => {
    const result = await discoverBuildRoots({
      cwd,
      fullByTool: new Map([['gradle', [cwd]]]),
      includedByTool: new Map([['gradle', [cwd]]]),
    })

    expect(result).toEqual({ excluded: [], included: [] })
  })

  it('marks a dir excluded when it is present in the full walk but absent from the excludePaths-filtered walk', async () => {
    const legacy = '/repo/legacy'
    const active = '/repo/active'

    const result = await discoverBuildRoots({
      cwd,
      excludePaths: ['legacy'],
      fullByTool: new Map([['gradle', [legacy, active]]]),
      includedByTool: new Map([['gradle', [active]]]),
    })

    expect(result).toEqual({
      excluded: [{ dir: legacy, ecosystems: ['gradle'] }],
      included: [{ dir: active, ecosystem: 'gradle' }],
    })
  })

  it('groups sibling projects under a non-project excluded ancestor into a single exclusion root', async () => {
    // legacy/ itself has no build file of its own - only its two children do -
    // so it never appears as a candidate, but --exclude-paths=legacy should
    // still collapse both into one write at legacy, not two writes at
    // legacy/a and legacy/b.
    const a = '/repo/legacy/a'
    const b = '/repo/legacy/b'

    const result = await discoverBuildRoots({
      cwd,
      excludePaths: ['legacy'],
      fullByTool: new Map([
        ['maven', [a]],
        ['gradle', [b]],
      ]),
      includedByTool: new Map([
        ['maven', []],
        ['gradle', []],
      ]),
    })

    expect(result).toEqual({
      excluded: [{ dir: '/repo/legacy', ecosystems: ['gradle', 'maven'] }],
      included: [],
    })
  })
})

describe('markWorkspaceCoverage', () => {
  const cwd = '/repo'
  const reactor = '/repo/reactor'

  beforeEach(() => {
    vi.mocked(readSocketJsonCascade).mockReset()
    vi.mocked(readSocketJsonCascade).mockImplementation(
      () =>
        ({
          version: 1,
          defaults: { manifest: { maven: { bin: 'mvn' } } },
        }) as SocketJson,
    )
    vi.mocked(enumerateWorkspaces).mockReset()
  })

  it('marks the candidate itself plus its declared members as covered', async () => {
    vi.mocked(enumerateWorkspaces).mockResolvedValue({
      projects: [
        {
          type: 'maven',
          name: 'moduleA',
          subprojectDir: 'moduleA',
          dependencies: [],
          resolvedAs: [],
        },
        {
          type: 'maven',
          name: 'moduleB',
          subprojectDir: 'moduleB',
          dependencies: [],
          resolvedAs: [],
        },
      ],
    })
    const coveredByEcosystem = new Map<BuildTool, Set<string>>()

    const result = await markWorkspaceCoverage({
      candidate: { dir: reactor, ecosystem: 'maven' },
      coveredByEcosystem,
      cwd,
      rootSockJson: emptySockJson(),
    })

    expect(result).toEqual({ ok: true, data: undefined })
    expect(coveredByEcosystem.get('maven')).toEqual(
      new Set([reactor, `${reactor}/moduleA`, `${reactor}/moduleB`]),
    )
  })

  it('does not mark a sibling subprojectDir that escapes the candidate directory as covered', async () => {
    vi.mocked(enumerateWorkspaces).mockResolvedValue({
      projects: [
        {
          type: 'maven',
          name: 'moduleA',
          subprojectDir: 'moduleA',
          dependencies: [],
          resolvedAs: [],
        },
        {
          type: 'maven',
          name: 'shared-lib',
          subprojectDir: '../shared-lib',
          dependencies: [],
          resolvedAs: [],
        },
      ],
    })
    const coveredByEcosystem = new Map<BuildTool, Set<string>>()

    await markWorkspaceCoverage({
      candidate: { dir: reactor, ecosystem: 'maven' },
      coveredByEcosystem,
      cwd,
      rootSockJson: emptySockJson(),
    })

    expect(coveredByEcosystem.get('maven')).toEqual(
      new Set([reactor, `${reactor}/moduleA`]),
    )
    expect(coveredByEcosystem.get('maven')?.has(`${cwd}/shared-lib`)).toBe(
      false,
    )
  })

  it('does not enumerate, and marks nothing covered, for a disabled candidate', async () => {
    vi.mocked(readSocketJsonCascade).mockReturnValue({
      version: 1,
      defaults: { manifest: { maven: { disabled: true } } },
    } as SocketJson)
    const coveredByEcosystem = new Map<BuildTool, Set<string>>()

    const result = await markWorkspaceCoverage({
      candidate: { dir: reactor, ecosystem: 'maven' },
      coveredByEcosystem,
      cwd,
      rootSockJson: emptySockJson(),
    })

    expect(result).toEqual({ ok: true, data: undefined })
    expect(enumerateWorkspaces).not.toHaveBeenCalled()
    expect(coveredByEcosystem.size).toBe(0)
  })

  it('fails closed - marks nothing covered and reports failure - when enumeration fails', async () => {
    vi.mocked(enumerateWorkspaces).mockResolvedValue(undefined)
    const coveredByEcosystem = new Map<BuildTool, Set<string>>()

    const result = await markWorkspaceCoverage({
      candidate: { dir: reactor, ecosystem: 'maven' },
      coveredByEcosystem,
      cwd,
      rootSockJson: emptySockJson(),
    })

    expect(result.ok).toBe(false)
    expect(coveredByEcosystem.size).toBe(0)
  })

  it('forwards --exclude-paths, re-anchored to the candidate dir, so a member excluded specifically to dodge a broken resolution is actually skipped', async () => {
    vi.mocked(enumerateWorkspaces).mockResolvedValue({ projects: [] })
    const coveredByEcosystem = new Map<BuildTool, Set<string>>()

    await markWorkspaceCoverage({
      candidate: { dir: reactor, ecosystem: 'maven' },
      coveredByEcosystem,
      cwd,
      excludePaths: ['reactor/moduleB'],
      rootSockJson: emptySockJson(),
    })

    expect(enumerateWorkspaces).toHaveBeenCalledWith(
      expect.objectContaining({ excludePaths: ['moduleB'] }),
    )
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

describe('configureCandidate', () => {
  const cwd = '/repo'
  const dir = '/repo/nested-gradle'

  beforeEach(() => {
    vi.mocked(readSocketJsonCascade).mockReset()
    vi.mocked(readOrDefaultSocketJson).mockReset()
    vi.mocked(writeSocketJson).mockReset()
    vi.mocked(writeSocketJson).mockResolvedValue({ ok: true, data: undefined })
    vi.mocked(setupGradle).mockReset()
  })

  it('seeds the sub-wizard with the cascaded value, own-file value winning, but only writes fields that actually differ from what dir would inherit', async () => {
    vi.mocked(readOrDefaultSocketJson).mockImplementation(
      () =>
        ({
          version: 1,
          defaults: { manifest: { gradle: { javaHome: '/opt/jdk-17' } } },
        }) as SocketJson,
    )
    vi.mocked(readSocketJsonCascade).mockImplementation(
      () =>
        ({
          version: 1,
          defaults: {
            manifest: { gradle: { bin: './gradlew', javaHome: '/opt/jdk-11' } },
          },
        }) as SocketJson,
    )
    vi.mocked(setupGradle).mockImplementation(async config => {
      expect(config).toEqual({ bin: './gradlew', javaHome: '/opt/jdk-17' })
      ;(config as Record<string, unknown>)['gradleOpts'] = '--offline'
      return { ok: true, data: { canceled: false } }
    })

    const result = await configureCandidate({
      cwd,
      dir,
      ecosystem: 'gradle',
      rootSockJson: emptySockJson(),
    })

    expect(result).toEqual({ ok: true, data: { canceled: false } })
    expect(writeSocketJson).toHaveBeenCalledWith(
      dir,
      expect.objectContaining({
        defaults: {
          manifest: {
            gradle: {
              // `bin` is omitted: it's identical to what dir already inherits
              // from its ancestors, so writing it would only pin a value that
              // should keep tracking the ancestor's own if that ever changes.
              javaHome: '/opt/jdk-17',
              gradleOpts: '--offline',
            },
          },
        },
      }),
    )
  })

  it('propagates a cancellation from the sub-wizard without writing', async () => {
    vi.mocked(readOrDefaultSocketJson).mockImplementation(() => emptySockJson())
    vi.mocked(readSocketJsonCascade).mockImplementation(() => emptySockJson())
    vi.mocked(setupGradle).mockResolvedValue({
      ok: true,
      data: { canceled: true },
    })

    const result = await configureCandidate({
      cwd,
      dir,
      ecosystem: 'gradle',
      rootSockJson: emptySockJson(),
    })

    expect(result).toEqual({ ok: true, data: { canceled: true } })
    expect(writeSocketJson).not.toHaveBeenCalled()
  })

  it('writes nothing when nothing is inherited and every prompt is left blank', async () => {
    vi.mocked(readOrDefaultSocketJson).mockImplementation(() => emptySockJson())
    vi.mocked(readSocketJsonCascade).mockImplementation(() => emptySockJson())
    // A no-op wizard: doesn't set a single field on the seed it's handed.
    vi.mocked(setupGradle).mockResolvedValue({
      ok: true,
      data: { canceled: false },
    })

    const result = await configureCandidate({
      cwd,
      dir,
      ecosystem: 'gradle',
      rootSockJson: emptySockJson(),
    })

    expect(result).toEqual({ ok: true, data: { canceled: false } })
    expect(writeSocketJson).not.toHaveBeenCalled()
  })
})

describe('processCandidate', () => {
  const cwd = '/repo'
  const dir = '/repo/legacy/nested'

  beforeEach(() => {
    vi.mocked(select).mockReset()
    vi.mocked(readSocketJsonCascade).mockReset()
    vi.mocked(readOrDefaultSocketJson).mockReset()
    vi.mocked(readOrDefaultSocketJson).mockImplementation(() => emptySockJson())
    vi.mocked(writeSocketJson).mockReset()
    vi.mocked(writeSocketJson).mockResolvedValue({ ok: true, data: undefined })
    vi.mocked(setupGradle).mockReset()
  })

  it('skips silently, without prompting, when the cascade already shows it disabled', async () => {
    vi.mocked(readSocketJsonCascade).mockReturnValue({
      version: 1,
      defaults: { manifest: { gradle: { disabled: true } } },
    } as SocketJson)

    const result = await processCandidate({
      cwd,
      dir,
      ecosystem: 'gradle',
      rootSockJson: emptySockJson(),
    })

    expect(result).toEqual({
      ok: true,
      data: { canceled: false, outcome: 'skipped', reenabled: false },
    })
    expect(select).not.toHaveBeenCalled()
  })

  it('offers to re-enable when the candidate own file (not just an ancestor) sets disabled:true, then still asks to configure it', async () => {
    vi.mocked(readSocketJsonCascade).mockReturnValue({
      version: 1,
      defaults: { manifest: { gradle: { disabled: true } } },
    } as SocketJson)
    vi.mocked(readOrDefaultSocketJson).mockImplementation(
      () =>
        ({
          version: 1,
          defaults: {
            manifest: { gradle: { disabled: true, bin: './gradlew' } },
          },
        }) as SocketJson,
    )
    vi.mocked(select).mockImplementation(async ({ message }) => {
      if (message.includes('re-enable')) {
        return true
      }
      // The configure-or-leave-as-is question, asked right after re-enabling.
      return 'inherit'
    })

    const result = await processCandidate({
      cwd,
      dir,
      ecosystem: 'gradle',
      rootSockJson: emptySockJson(),
    })

    expect(result).toEqual({
      ok: true,
      data: { canceled: false, outcome: 'inherited', reenabled: true },
    })
    expect(writeSocketJson).toHaveBeenCalledWith(
      dir,
      expect.objectContaining({
        defaults: {
          manifest: { gradle: { disabled: false, bin: './gradlew' } },
        },
      }),
    )
  })

  it('declining the re-enable offer leaves the candidate disabled and writes nothing', async () => {
    vi.mocked(readSocketJsonCascade).mockReturnValue({
      version: 1,
      defaults: { manifest: { gradle: { disabled: true } } },
    } as SocketJson)
    vi.mocked(readOrDefaultSocketJson).mockImplementation(
      () =>
        ({
          version: 1,
          defaults: { manifest: { gradle: { disabled: true } } },
        }) as SocketJson,
    )
    vi.mocked(select).mockResolvedValue(false)

    const result = await processCandidate({
      cwd,
      dir,
      ecosystem: 'gradle',
      rootSockJson: emptySockJson(),
    })

    expect(result).toEqual({
      ok: true,
      data: { canceled: false, outcome: 'skipped', reenabled: false },
    })
    expect(writeSocketJson).not.toHaveBeenCalled()
  })

  it('does not offer a disable choice - that stays --exclude-paths-only', async () => {
    vi.mocked(readSocketJsonCascade).mockImplementation(() => emptySockJson())
    vi.mocked(select).mockImplementation(async ({ choices }) => {
      expect(choices.map((c: { value: unknown }) => c.value)).toEqual([
        'inherit',
        'configure',
      ])
      return 'inherit'
    })

    const result = await processCandidate({
      cwd,
      dir,
      ecosystem: 'gradle',
      rootSockJson: emptySockJson(),
    })

    expect(result).toEqual({
      ok: true,
      data: { canceled: false, outcome: 'inherited', reenabled: false },
    })
    expect(writeSocketJson).not.toHaveBeenCalled()
  })

  it('configures the candidate when the user picks configure', async () => {
    vi.mocked(readSocketJsonCascade).mockImplementation(() => emptySockJson())
    vi.mocked(select).mockResolvedValue('configure')
    vi.mocked(setupGradle).mockImplementation(async config => {
      ;(config as Record<string, unknown>)['bin'] = './gradlew'
      return { ok: true, data: { canceled: false } }
    })

    const result = await processCandidate({
      cwd,
      dir,
      ecosystem: 'gradle',
      rootSockJson: emptySockJson(),
    })

    expect(result).toEqual({
      ok: true,
      data: { canceled: false, outcome: 'configured', reenabled: false },
    })
    expect(setupGradle).toHaveBeenCalledTimes(1)
    expect(writeSocketJson).toHaveBeenCalled()
  })

  it('leaves the candidate untouched when the user picks inherit', async () => {
    vi.mocked(readSocketJsonCascade).mockImplementation(() => emptySockJson())
    vi.mocked(select).mockResolvedValue('inherit')

    const result = await processCandidate({
      cwd,
      dir,
      ecosystem: 'gradle',
      rootSockJson: emptySockJson(),
    })

    expect(result).toEqual({
      ok: true,
      data: { canceled: false, outcome: 'inherited', reenabled: false },
    })
    expect(writeSocketJson).not.toHaveBeenCalled()
  })

  it('reports a cancellation from the action prompt itself', async () => {
    vi.mocked(readSocketJsonCascade).mockImplementation(() => emptySockJson())
    vi.mocked(select).mockResolvedValue(null)

    const result = await processCandidate({
      cwd,
      dir,
      ecosystem: 'gradle',
      rootSockJson: emptySockJson(),
    })

    expect(result.ok && result.data.canceled).toBe(true)
    expect(writeSocketJson).not.toHaveBeenCalled()
  })
})

describe('setupRecursiveManifestConfig', () => {
  const cwd = '/repo'

  beforeEach(() => {
    vi.mocked(select).mockReset()
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
    // Default: nothing found anywhere - most tests override this per-scenario.
    vi.mocked(findBuildToolCandidates).mockResolvedValue(new Map())
    vi.mocked(readOrDefaultSocketJson).mockReset()
    vi.mocked(readOrDefaultSocketJson).mockImplementation(() => emptySockJson())
    vi.mocked(readSocketJsonCascade).mockReset()
    vi.mocked(readSocketJsonCascade).mockImplementation(() => emptySockJson())
    vi.mocked(writeSocketJson).mockReset()
    vi.mocked(writeSocketJson).mockResolvedValue({ ok: true, data: undefined })
    vi.mocked(enumerateWorkspaces).mockReset()
    // Default: no reactor members declared anywhere - most tests don't care
    // about pruning specifically, so nothing should get collapsed.
    vi.mocked(enumerateWorkspaces).mockResolvedValue({ projects: [] })
  })

  it('asks about nothing and finishes immediately when the scan finds no build roots anywhere', async () => {
    const result = await setupRecursiveManifestConfig(cwd, false)

    expect(result).toEqual({ ok: true, data: { canceled: false } })
    expect(select).not.toHaveBeenCalled()
    expect(setupGradle).not.toHaveBeenCalled()
    expect(setupMaven).not.toHaveBeenCalled()
    expect(setupSbt).not.toHaveBeenCalled()
    expect(writeSocketJson).not.toHaveBeenCalled()
    expect(findBuildToolCandidates).toHaveBeenCalled()
  })

  it('only asks about ecosystems detected somewhere in the tree, with plain phrasing', async () => {
    // Maven is detected (a candidate exists, elsewhere in the tree); gradle
    // and sbt have none anywhere, so neither should ever be asked about.
    vi.mocked(findBuildToolCandidates).mockResolvedValue(
      new Map([['maven', [`${cwd}/service`]]]),
    )
    const messages: string[] = []
    vi.mocked(select).mockImplementation(async ({ message }) => {
      messages.push(message)
      return false
    })

    await setupRecursiveManifestConfig(cwd, false)

    expect(setupGradle).not.toHaveBeenCalled()
    expect(setupSbt).not.toHaveBeenCalled()
    // Exactly one root question (Maven) - phrased as a nested-project default
    // since the only maven candidate is elsewhere in the tree, not at cwd
    // itself - no "detected"/"root"/"anyway" wording either way.
    expect(messages[0]).toBe(
      'Configure Maven defaults for any nested projects?',
    )
    expect(messages[0]).not.toMatch(/detected|root|anyway/i)
  })

  it('distinguishes a project-specific ecosystem from a purely inherited one at the root', async () => {
    // cwd IS a maven project (e.g. a reactor root); gradle only exists in a
    // project nested somewhere beneath it (e.g. a submodule's own gradle
    // build) - the two questions must read differently, since the maven one
    // configures settings for cwd itself while the gradle one only ever sets
    // an inheritable default for something else.
    vi.mocked(findBuildToolCandidates).mockResolvedValue(
      new Map([
        ['maven', [cwd]],
        ['gradle', [`${cwd}/module-b/standalone-gradle-lib`]],
      ]),
    )
    const messages: string[] = []
    vi.mocked(select).mockImplementation(async ({ message }) => {
      messages.push(message)
      return false
    })

    await setupRecursiveManifestConfig(cwd, false)

    expect(messages).toEqual([
      'Configure Maven settings for this project?',
      'Configure Gradle defaults for any nested projects?',
      'Configure other build roots found beneath this one, individually?',
    ])
  })

  it('scans with disabled flags stripped, so an already-disabled ecosystem is still detected', async () => {
    vi.mocked(readOrDefaultSocketJson).mockImplementation(
      () =>
        ({
          version: 1,
          defaults: { manifest: { maven: { disabled: true, bin: 'mvn' } } },
        }) as SocketJson,
    )
    const seenSockJsons: SocketJson[] = []
    vi.mocked(findBuildToolCandidates).mockImplementation(
      async ({ sockJson }) => {
        seenSockJsons.push(sockJson)
        return new Map([['maven', [cwd]]])
      },
    )

    await setupRecursiveManifestConfig(cwd, false)

    expect(seenSockJsons.length).toBeGreaterThan(0)
    for (const seen of seenSockJsons) {
      expect(seen.defaults?.manifest?.maven?.disabled).toBe(false)
    }
  })

  it('offers to re-enable an ecosystem disabled at the root, before asking to configure it', async () => {
    vi.mocked(findBuildToolCandidates).mockResolvedValue(
      new Map([['maven', [cwd]]]),
    )
    vi.mocked(readSocketJsonSync).mockImplementation(() => ({
      ok: true,
      data: {
        version: 1,
        defaults: { manifest: { maven: { disabled: true, bin: 'mvn' } } },
      } as SocketJson,
    }))
    const messages: string[] = []
    vi.mocked(select).mockImplementation(async ({ message }) => {
      messages.push(message)
      if (message.includes('re-enable')) {
        return true
      }
      if (message.startsWith('Configure Maven')) {
        return false
      }
      return false
    })

    const result = await setupRecursiveManifestConfig(cwd, false)

    expect(result).toEqual({ ok: true, data: { canceled: false } })
    expect(messages[0]).toBe('Maven is currently disabled here - re-enable it?')
    expect(writeSocketJson).toHaveBeenCalledWith(
      cwd,
      expect.objectContaining({
        defaults: { manifest: { maven: { disabled: false, bin: 'mvn' } } },
      }),
    )
  })

  it('declining the root re-enable question leaves the ecosystem disabled and skips configuring it', async () => {
    vi.mocked(findBuildToolCandidates).mockResolvedValue(
      new Map([['maven', [cwd]]]),
    )
    vi.mocked(readSocketJsonSync).mockImplementation(() => ({
      ok: true,
      data: {
        version: 1,
        defaults: { manifest: { maven: { disabled: true, bin: 'mvn' } } },
      } as SocketJson,
    }))
    vi.mocked(select).mockResolvedValueOnce(false)

    const result = await setupRecursiveManifestConfig(cwd, false)

    expect(result).toEqual({ ok: true, data: { canceled: false } })
    expect(setupMaven).not.toHaveBeenCalled()
    expect(writeSocketJson).not.toHaveBeenCalled()
  })

  it('stops when canceling the only detected root ecosystem question', async () => {
    vi.mocked(findBuildToolCandidates).mockResolvedValue(
      new Map([['maven', [cwd]]]),
    )
    vi.mocked(select).mockResolvedValueOnce(null)

    const result = await setupRecursiveManifestConfig(cwd, false)

    expect(result.ok && result.data.canceled).toBe(true)
  })

  it('stops when a root ecosystem sub-wizard is canceled', async () => {
    vi.mocked(findBuildToolCandidates).mockResolvedValue(
      new Map([['maven', [cwd]]]),
    )
    vi.mocked(select).mockResolvedValueOnce(true)
    vi.mocked(setupMaven).mockResolvedValue({
      ok: true,
      data: { canceled: true },
    })

    const result = await setupRecursiveManifestConfig(cwd, false)

    expect(result.ok && result.data.canceled).toBe(true)
  })

  it('propagates a hard failure reading the root socket.json', async () => {
    vi.mocked(findBuildToolCandidates).mockResolvedValue(
      new Map([['maven', [cwd]]]),
    )
    vi.mocked(readSocketJsonSync).mockImplementation(() => ({
      ok: false,
      message: 'boom',
    }))

    const result = await setupRecursiveManifestConfig(cwd, false)

    expect(result.ok).toBe(false)
    expect(findBuildToolCandidates).toHaveBeenCalled()
  })

  it('configures maven at the root (itself the only candidate) and writes it, with no individual-configure gate', async () => {
    // The only maven candidate anywhere IS cwd itself, so there's nothing
    // left to configure individually afterward.
    vi.mocked(findBuildToolCandidates).mockResolvedValue(
      new Map([['maven', [cwd]]]),
    )
    vi.mocked(select)
      // Configure Maven? -> yes.
      .mockResolvedValueOnce(true)
    vi.mocked(setupMaven).mockImplementation(async config => {
      ;(config as Record<string, unknown>)['bin'] = './mvnw'
      return { ok: true, data: { canceled: false } }
    })

    const result = await setupRecursiveManifestConfig(cwd, false)

    expect(result).toEqual({ ok: true, data: { canceled: false } })
    expect(setupMaven).toHaveBeenCalledTimes(1)
    expect(writeSocketJson).toHaveBeenCalledWith(cwd, expect.any(Object))
    // No individual-configure gate: nothing else was found to ask about.
    expect(select).toHaveBeenCalledTimes(1)
  })

  it('does not write when the user says yes to configure Maven but leaves every prompt blank', async () => {
    vi.mocked(findBuildToolCandidates).mockResolvedValue(
      new Map([['maven', [cwd]]]),
    )
    vi.mocked(select).mockResolvedValueOnce(true)
    // A no-op wizard: doesn't set a single field.
    vi.mocked(setupMaven).mockResolvedValue({
      ok: true,
      data: { canceled: false },
    })

    const result = await setupRecursiveManifestConfig(cwd, false)

    expect(result).toEqual({ ok: true, data: { canceled: false } })
    expect(setupMaven).toHaveBeenCalledTimes(1)
    expect(writeSocketJson).not.toHaveBeenCalled()
  })

  it('applies --exclude-paths unconditionally, without asking to configure anything individually', async () => {
    const legacy = `${cwd}/legacy`
    vi.mocked(findBuildToolCandidates).mockImplementation(
      async ({ excludePaths }) =>
        excludePaths?.length
          ? new Map([['gradle', []]])
          : new Map([['gradle', [legacy]]]),
    )

    const result = await setupRecursiveManifestConfig(cwd, false, ['legacy'])

    expect(result).toEqual({ ok: true, data: { canceled: false } })
    expect(writeSocketJson).toHaveBeenCalledWith(
      legacy,
      expect.objectContaining({
        defaults: { manifest: { gradle: { disabled: true } } },
      }),
    )
    // Nothing left to configure individually (the only candidate was
    // excluded), so the individual-configure gate is never asked.
    expect(select).not.toHaveBeenCalled()
  })

  it('reports nothing excluded without writing anything, then asks about the remaining candidate individually', async () => {
    vi.mocked(findBuildToolCandidates).mockResolvedValue(
      new Map([['gradle', [`${cwd}/active`]]]),
    )
    vi.mocked(select)
      // Configure Gradle defaults? -> no (gradle is detected via `active`).
      .mockResolvedValueOnce(false)
      // Configure other build roots individually? -> no.
      .mockResolvedValueOnce(false)

    const result = await setupRecursiveManifestConfig(cwd, false, ['legacy'])

    expect(result).toEqual({ ok: true, data: { canceled: false } })
    expect(findBuildToolCandidates).toHaveBeenCalled()
    expect(writeSocketJson).not.toHaveBeenCalled()
  })

  it('only writes disabled:true to the topmost of an excluded subtree', async () => {
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
    // Everything was excluded, so the individual-configure gate is skipped.
    expect(select).not.toHaveBeenCalled()
  })

  it('reports the discovered count and walks the remaining candidate even when no --exclude-paths is given', async () => {
    vi.mocked(findBuildToolCandidates).mockResolvedValue(
      new Map([['gradle', [`${cwd}/active`]]]),
    )
    const messages: string[] = []
    vi.mocked(select).mockImplementation(async ({ message }) => {
      messages.push(message)
      // Configure Gradle defaults? -> no (gradle is detected via `active`,
      // a nested project, not cwd itself).
      if (message.startsWith('Configure Gradle defaults')) {
        return false
      }
      // Configure other build roots individually? -> yes.
      if (message.startsWith('Configure other build roots')) {
        return true
      }
      // Candidate action prompt -> anything but 'configure' is a safe no-op
      // (inherit), so this never touches writeSocketJson.
      return 'inherit'
    })
    const logSpy = vi.spyOn(logger, 'log')

    try {
      const result = await setupRecursiveManifestConfig(cwd, false)

      expect(result).toEqual({ ok: true, data: { canceled: false } })
      expect(writeSocketJson).not.toHaveBeenCalled()
      expect(messages).toContain(
        'Configure other build roots found beneath this one, individually?',
      )
      const logged = logSpy.mock.calls.map(c => String(c[0])).join('\n')
      expect(logged).toMatch(/Detected: Gradle/)
      expect(logged).toMatch(/0 configured \(0 re-enabled\), 1 left as-is/)
    } finally {
      logSpy.mockRestore()
    }
  })

  it('configures and leaves candidates inheriting in a single pass, skipping candidates already disabled via cascade', async () => {
    const serviceA = `${cwd}/serviceA`
    const serviceB = `${cwd}/serviceB`
    const serviceBSubmodule = `${serviceB}/submodule`
    const serviceC = `${cwd}/serviceC`

    vi.mocked(select)
      // Configure Maven? -> no.
      .mockResolvedValueOnce(false)
      // Configure Gradle? -> no.
      .mockResolvedValueOnce(false)
      // Configure other build roots individually? -> yes.
      .mockResolvedValueOnce(true)
      // serviceA (depth 1) -> configure.
      .mockResolvedValueOnce('configure')
      // serviceC (depth 1) -> inherit.
      .mockResolvedValueOnce('inherit')
    // serviceB and serviceB/submodule are already disabled - via a prior
    // --exclude-paths run, say - so neither is ever prompted.
    vi.mocked(findBuildToolCandidates).mockResolvedValue(
      new Map([
        ['maven', [serviceA, serviceB, serviceBSubmodule]],
        ['gradle', [serviceC]],
      ]),
    )
    vi.mocked(readSocketJsonCascade).mockImplementation(dir =>
      dir === serviceB || dir === serviceBSubmodule
        ? ({
            version: 1,
            defaults: { manifest: { maven: { disabled: true } } },
          } as SocketJson)
        : emptySockJson(),
    )
    vi.mocked(setupMaven).mockImplementation(async config => {
      ;(config as Record<string, unknown>)['bin'] = './mvnw'
      return { ok: true, data: { canceled: false } }
    })

    const result = await setupRecursiveManifestConfig(cwd, false)

    expect(result).toEqual({ ok: true, data: { canceled: false } })
    expect(select).toHaveBeenCalledTimes(5)
    expect(writeSocketJson).toHaveBeenCalledTimes(1)
    expect(writeSocketJson).toHaveBeenCalledWith(
      serviceA,
      expect.objectContaining({
        defaults: { manifest: { maven: { bin: './mvnw' } } },
      }),
    )
  })

  it('seeds coverage from cwd itself, so a reactor rooted exactly at cwd still gets its declared members pruned', async () => {
    // cwd IS the maven reactor root (has its own pom.xml) - discoverBuildRoots
    // always excludes cwd from `included` (it already got its own root
    // wizard), so without seeding coverage from cwd specifically, module-a
    // and module-b would never be recognized as reactor members.
    const independentService = `${cwd}/independent-service`
    const moduleA = `${cwd}/module-a`
    const moduleB = `${cwd}/module-b`

    vi.mocked(findBuildToolCandidates).mockResolvedValue(
      new Map([['maven', [cwd, independentService, moduleA, moduleB]]]),
    )
    vi.mocked(enumerateWorkspaces).mockImplementation(async ({ cwd: dir }) =>
      dir === cwd
        ? {
            projects: [
              {
                type: 'maven',
                name: 'module-a',
                subprojectDir: 'module-a',
                dependencies: [],
                resolvedAs: [],
              },
              {
                type: 'maven',
                name: 'module-b',
                subprojectDir: 'module-b',
                dependencies: [],
                resolvedAs: [],
              },
            ],
          }
        : { projects: [] },
    )
    const messages: string[] = []
    vi.mocked(select).mockImplementation(async ({ message }) => {
      messages.push(message)
      if (message.startsWith('Configure Maven settings')) {
        return false
      }
      if (message.startsWith('Configure other build roots')) {
        return true
      }
      return 'inherit'
    })

    const result = await setupRecursiveManifestConfig(cwd, false)

    expect(result).toEqual({ ok: true, data: { canceled: false } })
    // Only independent-service is ever asked about - module-a/module-b are
    // recognized as covered via cwd's own enumeration and never prompted.
    // cwd itself is a maven project (the reactor root), so the root question
    // is phrased as this project's own settings, not a nested-project default.
    expect(messages).toEqual([
      'Configure Maven settings for this project?',
      'Configure other build roots found beneath this one, individually?',
      'independent-service (maven)',
    ])
  })

  it("aborts the whole walk (fail-closed) when a candidate's workspace layout cannot be determined", async () => {
    const independentService = `${cwd}/independent-service`
    const laterCandidate = `${cwd}/zzz-later`

    vi.mocked(findBuildToolCandidates).mockResolvedValue(
      new Map([['maven', [independentService, laterCandidate]]]),
    )
    vi.mocked(select).mockImplementation(async ({ message }) => {
      if (message.startsWith('Configure Maven defaults')) {
        return false
      }
      if (message.startsWith('Configure other build roots')) {
        return true
      }
      return 'inherit'
    })
    // Simulates a missing $JAVA8_HOME env var reference: enumeration fails
    // for independent-service specifically.
    vi.mocked(enumerateWorkspaces).mockImplementation(async ({ cwd: dir }) =>
      dir === independentService ? undefined : { projects: [] },
    )

    const result = await setupRecursiveManifestConfig(cwd, false)

    expect(result.ok).toBe(false)
    // The later candidate is never reached - the walk aborted right after
    // independent-service's own enumeration failed, not after processing
    // everything and reporting failures at the end.
    expect(enumerateWorkspaces).not.toHaveBeenCalledWith(
      expect.objectContaining({ cwd: laterCandidate }),
    )
  })
})
