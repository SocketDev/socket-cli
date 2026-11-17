import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { logger } from '@socketsecurity/registry/lib/logger'

vi.mock('../../utils/coana-release.mts', () => ({
  spawnCoana: vi.fn(),
}))

import {
  keepFacts,
  listBuildProjects,
  listDotnetSolutionMembers,
  runManifestFacts,
} from './run-manifest-facts.mts'
import { COANA_CLI_VERSION } from '../../constants.mts'
import { spawnCoana } from '../../utils/coana-release.mts'

import type { SocketFactsWorkDir } from './run-manifest-facts.mts'

type Call = { args: string[]; request: any }

const baseArgs = {
  bin: 'mvn',
  buildOpts: ['-Pci'],
  ecosystem: 'maven' as const,
  excludeConfigs: '',
  ignoreUnresolved: false,
  includeConfigs: '',
  verbose: false,
}

let cwd = ''
let calls: Call[] = []

// Answers each Coana run by writing `text` as its result file, or nothing when
// `text` is undefined.
function coanaWrites(text: string | undefined, ok = true): void {
  vi.mocked(spawnCoana).mockImplementation(async args => {
    const list = [...args]
    const request = JSON.parse(
      await fs.readFile(list[list.indexOf('--request') + 1]!, 'utf8'),
    )
    calls.push({ args: list, request })
    if (text !== undefined) {
      await fs.writeFile(list[list.indexOf('--output-file') + 1]!, text)
    }
    return ok
      ? { ok: true, data: '' }
      : { ok: false, message: 'Coana command failed', cause: 'exit code 3' }
  })
}

// Answers each Coana run with `result`, as `coana generate-socket-facts` writes
// it, or writes nothing when `result` is undefined.
function coanaAnswers(result: unknown, ok = true): void {
  coanaWrites(result === undefined ? undefined : JSON.stringify(result), ok)
}

beforeEach(async () => {
  cwd = await fs.realpath(
    await fs.mkdtemp(path.join(tmpdir(), 'run-manifest-facts-')),
  )
  calls = []
  vi.mocked(spawnCoana).mockReset()
  process.exitCode = undefined
})
afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(cwd, { recursive: true, force: true })
  delete process.env['SOCKET_CLI_MAVEN_PATH']
  process.exitCode = undefined
})

describe('runManifestFacts', () => {
  it('asks Coana for one build root with its options as written', async () => {
    const projects = [{ buildFiles: [path.join(cwd, 'pom.xml')], dir: cwd }]
    coanaAnswers({
      factsPath: path.join(cwd, 'pom.xml.socket.facts.json'),
      projects,
      status: 'generated',
      targetPath: path.join(cwd, 'pom.xml.socket.facts.json'),
    })
    const result = await runManifestFacts({
      ...baseArgs,
      context: { coanaVersion: '1.2.3', orgSlug: 'acme' },
      cwd,
      entryFile: 'pom.xml',
      excludeConfigs: 'test*',
      excludePaths: ['docs/**'],
      javaHome: '$JAVA11_HOME',
    })
    expect(result).toEqual({
      factsPath: path.join(cwd, 'pom.xml.socket.facts.json'),
      projects,
      sidecarEntry: undefined,
      targetPath: path.join(cwd, 'pom.xml.socket.facts.json'),
    })
    expect(calls[0]!.args.slice(0, 1)).toEqual(['generate-socket-facts'])
    expect(calls[0]!.args).not.toContain('--work-dir')
    expect(calls[0]!.request).toEqual({
      buildRoot: cwd,
      config: {
        bin: 'mvn',
        buildOpts: ['-Pci'],
        excludeConfigs: 'test*',
        ignoreUnresolved: false,
        javaHome: '$JAVA11_HOME',
        verbose: false,
      },
      entryFile: 'pom.xml',
      excludeBase: cwd,
      excludePaths: ['docs/**'],
      hints: {
        excludePathsFlag: '--exclude-paths',
        flags: ['excludeConfigs', 'ignoreUnresolved', 'verbose'],
        setupCommand: 'socket manifest setup',
        socketJson: 'socket.json',
      },
      tool: 'maven',
    })
    expect(vi.mocked(spawnCoana).mock.calls[0]![1]).toBe('acme')
    expect(vi.mocked(spawnCoana).mock.calls[0]![2]).toMatchObject({
      coanaVersion: '1.2.3',
      minimumVersion: COANA_CLI_VERSION,
    })
  })

  it("runs Coana in socket-cli's own cwd, so its logs show paths from there", async () => {
    coanaAnswers({ status: 'empty' })
    await runManifestFacts({ ...baseArgs, cwd })
    expect(vi.mocked(spawnCoana).mock.calls[0]![2]?.cwd).toBeUndefined()
  })

  it('sends the SOCKET_CLI_*_PATH override as the bin', async () => {
    const mvn = path.join(cwd, 'mvn')
    await fs.writeFile(mvn, '', { mode: 0o755 })
    process.env['SOCKET_CLI_MAVEN_PATH'] = mvn
    coanaAnswers({ status: 'empty' })
    await runManifestFacts({ ...baseArgs, cwd })
    expect(calls[0]!.request.config.bin).toBe(mvn)
  })

  it('fails the root without running Coana when the bin cannot be resolved', async () => {
    const fail = vi.spyOn(logger, 'fail')
    process.env['SOCKET_CLI_MAVEN_PATH'] = path.join(cwd, 'missing-mvn')
    expect(await runManifestFacts({ ...baseArgs, cwd })).toBeNull()
    expect(process.exitCode).toBe(1)
    expect(spawnCoana).not.toHaveBeenCalled()
    expect(fail).toHaveBeenCalledWith(
      expect.stringContaining('Could not run the maven build tool: '),
    )
  })

  it('generates into the work dir with files for reachability, leaving the facts there', async () => {
    const stateDir = path.join(cwd, 'state')
    const entry = {
      factsFile: path.join(cwd, 'pom.xml.socket.facts.json'),
      stateDir,
    }
    coanaAnswers({
      factsPath: path.join(stateDir, 'pom.xml.socket.facts.json'),
      projects: [],
      sidecarEntry: entry,
      status: 'generated',
      targetPath: entry.factsFile,
    })
    const workDir: SocketFactsWorkDir = {
      dir: '/w',
      entries: new Map(),
      withFiles: true,
    }
    const result = await runManifestFacts({
      ...baseArgs,
      context: { workDir },
      cwd,
    })
    expect(calls[0]!.args.slice(-3)).toEqual([
      '--with-files',
      '--work-dir',
      '/w',
    ])
    expect(result).toMatchObject({ sidecarEntry: entry })
    expect(workDir.entries.size).toBe(0)
  })

  it('keeps state without installing files for socket fix', async () => {
    coanaAnswers({
      factsPath: '/w/y/f',
      projects: [],
      sidecarEntry: { factsFile: '/r/f', stateDir: '/w/y' },
      status: 'generated',
      targetPath: '/r/f',
    })
    const workDir = { dir: '/w', entries: new Map(), withFiles: false }
    await runManifestFacts({ ...baseArgs, context: { workDir }, cwd })
    expect(calls[0]!.args.slice(-2)).toEqual(['--work-dir', '/w'])
    expect(calls[0]!.args).not.toContain('--with-files')
  })

  it('fails when Coana keeps no sidecar entry in the work dir', async () => {
    coanaAnswers({
      factsPath: '/w/y/f',
      projects: [],
      status: 'generated',
      targetPath: '/r/f',
    })
    const workDir = { dir: '/w', entries: new Map(), withFiles: true }
    expect(
      await runManifestFacts({ ...baseArgs, context: { workDir }, cwd }),
    ).toBeNull()
    expect(process.exitCode).toBe(1)
  })

  it('is nothing to upload when the build resolves nothing', async () => {
    coanaAnswers({ status: 'empty' })
    expect(await runManifestFacts({ ...baseArgs, cwd })).toBeUndefined()
    expect(process.exitCode).toBeUndefined()
  })

  it.for([
    {
      name: 'reports a failed build, which Coana reports itself',
      answer: () => coanaAnswers({ status: 'failed' }, false),
      reported: undefined,
    },
    {
      name: 'writes no result, naming the build and the cause',
      answer: () => coanaAnswers(undefined, false),
      reported: (dir: string) =>
        `Could not generate Socket facts for the maven project at \`${path.join(dir, 'alt.pom.xml')}\`: Coana command failed`,
    },
    {
      name: 'writes an unreadable result',
      answer: () => coanaWrites('{"status":"gener'),
      reported: () => "Coana's result is unreadable",
    },
  ])('fails the root when Coana $name', async ({ answer, reported }) => {
    const fail = vi.spyOn(logger, 'fail')
    answer()

    expect(
      await runManifestFacts({ ...baseArgs, cwd, entryFile: 'alt.pom.xml' }),
    ).toBeNull()
    expect(process.exitCode).toBe(1)
    if (reported) {
      expect(fail).toHaveBeenCalledWith(expect.stringContaining(reported(cwd)))
    } else {
      expect(fail).not.toHaveBeenCalled()
    }
  })

  it('does not run Coana outside an sbt build', async () => {
    coanaAnswers({ status: 'empty' })
    expect(
      await runManifestFacts({
        ...baseArgs,
        bin: 'sbt',
        cwd,
        ecosystem: 'sbt',
      }),
    ).toBeNull()
    expect(spawnCoana).not.toHaveBeenCalled()
  })
})

describe('keepFacts', () => {
  it('copies the facts to their target and keeps the sidecar entry', async () => {
    const factsPath = path.join(cwd, 'state', 'pom.xml.socket.facts.json')
    const targetPath = path.join(cwd, 'pom.xml.socket.facts.json')
    await fs.mkdir(path.dirname(factsPath))
    await fs.writeFile(factsPath, 'generated')
    await fs.writeFile(targetPath, 'committed')
    const sidecarEntry = { factsFile: targetPath, stateDir: '/w/x' }
    const workDir = { dir: '/w', entries: new Map(), withFiles: true }

    await keepFacts(workDir, {
      factsPath,
      projects: [],
      sidecarEntry,
      targetPath,
    })

    expect(await fs.readFile(targetPath, 'utf8')).toBe('generated')
    expect([...workDir.entries]).toEqual([[targetPath, sidecarEntry]])
  })

  it('leaves facts Coana wrote in place where they are', async () => {
    const targetPath = path.join(cwd, 'pom.xml.socket.facts.json')
    await fs.writeFile(targetPath, 'generated')

    await keepFacts(undefined, {
      factsPath: targetPath,
      projects: [],
      targetPath,
    })

    expect(await fs.readFile(targetPath, 'utf8')).toBe('generated')
  })
})

describe('listDotnetSolutionMembers', () => {
  it('lists the members once for the same request', async () => {
    coanaAnswers({ members: ['/r/A/A.csproj'] })
    const request = {
      buildOpts: [],
      cwd,
      entryFile: 'All.sln',
      javaHome: '$JAVA11_HOME',
    }
    expect(await listDotnetSolutionMembers(request)).toEqual(['/r/A/A.csproj'])
    expect(await listDotnetSolutionMembers(request)).toEqual(['/r/A/A.csproj'])
    expect(spawnCoana).toHaveBeenCalledOnce()
    expect(calls[0]!.args).toContain('--list-members')
    expect(calls[0]!.request).toEqual({
      buildRoot: cwd,
      config: {
        bin: 'dotnet',
        buildOpts: [],
        ignoreUnresolved: false,
        javaHome: '$JAVA11_HOME',
        verbose: false,
      },
      entryFile: 'All.sln',
      excludeBase: cwd,
      hints: {
        excludePathsFlag: '--exclude-paths',
        flags: ['excludeConfigs', 'ignoreUnresolved', 'verbose'],
        setupCommand: 'socket manifest setup',
        socketJson: 'socket.json',
      },
      tool: 'dotnet',
    })
  })

  it('cannot tell when the SDK cannot read the solution', async () => {
    coanaAnswers({ members: null })
    expect(
      await listDotnetSolutionMembers({
        buildOpts: [],
        cwd,
        entryFile: 'All.slnx',
      }),
    ).toBeUndefined()
  })

  it('lists nothing when Coana fails', async () => {
    coanaAnswers(undefined, false)
    expect(
      await listDotnetSolutionMembers({
        buildOpts: [],
        cwd,
        entryFile: 'Broken.sln',
      }),
    ).toEqual([])
  })
})

describe('listBuildProjects', () => {
  const listArgs = {
    bin: 'mvn',
    buildOpts: ['-Pci'],
    ecosystem: 'maven' as const,
    verbose: false,
  }

  it('asks Coana to list the build root, unresolved, with its options as written', async () => {
    const projects = [{ buildFiles: [path.join(cwd, 'pom.xml')], dir: cwd }]
    coanaAnswers({ buildRoot: cwd, projects, status: 'listed' })
    expect(
      await listBuildProjects({
        ...listArgs,
        cwd: path.join(cwd, 'reactor'),
        entryFile: 'pom.xml',
        excludeBase: cwd,
        excludePaths: ['reactor/moduleB'],
        javaHome: '$JAVA11_HOME',
      }),
    ).toEqual(projects)
    expect(calls[0]!.args).toContain('--list-projects')
    expect(calls[0]!.args).not.toContain('--work-dir')
    expect(calls[0]!.request).toMatchObject({
      buildRoot: path.join(cwd, 'reactor'),
      config: {
        bin: 'mvn',
        buildOpts: ['-Pci'],
        ignoreUnresolved: false,
        javaHome: '$JAVA11_HOME',
        verbose: false,
      },
      entryFile: 'pom.xml',
      excludeBase: cwd,
      excludePaths: ['reactor/moduleB'],
      tool: 'maven',
    })
  })

  it('lists with the Coana version and org of its context', async () => {
    coanaAnswers({ projects: [], status: 'listed' })
    await listBuildProjects({
      ...listArgs,
      context: { coanaVersion: '1.2.3', orgSlug: 'acme' },
      cwd,
    })
    expect(spawnCoana).toHaveBeenCalledWith(
      expect.arrayContaining(['--list-projects']),
      'acme',
      expect.objectContaining({ coanaVersion: '1.2.3' }),
    )
  })

  it('lists nothing without running Coana when the bin cannot be resolved', async () => {
    process.env['SOCKET_CLI_MAVEN_PATH'] = path.join(cwd, 'missing-mvn')
    expect(await listBuildProjects({ ...listArgs, cwd })).toBeUndefined()
    expect(spawnCoana).not.toHaveBeenCalled()
  })

  it('lists nothing when the build cannot list its projects', async () => {
    coanaAnswers({ status: 'failed' }, false)
    expect(await listBuildProjects({ ...listArgs, cwd })).toBeUndefined()
  })

  it('lists nothing when Coana writes no result', async () => {
    coanaAnswers(undefined, false)
    expect(await listBuildProjects({ ...listArgs, cwd })).toBeUndefined()
  })

  it('lists nothing when Coana writes an unreadable result', async () => {
    coanaWrites('')
    expect(await listBuildProjects({ ...listArgs, cwd })).toBeUndefined()
  })
})
