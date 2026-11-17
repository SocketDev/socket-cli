import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../utils/coana-release.mts', () => ({
  spawnCoana: vi.fn(),
}))
vi.mock('../ci/fetch-default-org-slug.mts', () => ({
  getDefaultOrgSlug: vi.fn(async () => ({ ok: true, data: 'default-org' })),
}))

import {
  listDotnetSolutionMembers,
  runManifestFacts,
} from './run-manifest-facts.mts'
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

// Answers each Coana run with `result`, as `coana generate-socket-facts` writes
// it, or writes nothing when `result` is undefined.
function coanaAnswers(result: unknown, ok = true): void {
  vi.mocked(spawnCoana).mockImplementation(async args => {
    const list = [...args]
    const request = JSON.parse(
      await fs.readFile(list[list.indexOf('--request') + 1]!, 'utf8'),
    )
    calls.push({ args: list, request })
    if (result !== undefined) {
      await fs.writeFile(
        list[list.indexOf('--output-file') + 1]!,
        JSON.stringify(result),
      )
    }
    return ok
      ? { ok: true, data: '' }
      : { ok: false, message: 'Coana command failed', cause: 'exit code 3' }
  })
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
        flags: ['excludeConfigs', 'ignoreUnresolved', 'verbose'],
        setupCommand: 'socket manifest setup',
        socketJson: 'socket.json',
      },
      tool: 'maven',
    })
    expect(vi.mocked(spawnCoana).mock.calls[0]![1]).toBe('acme')
    expect(vi.mocked(spawnCoana).mock.calls[0]![2]).toMatchObject({
      coanaVersion: '1.2.3',
      cwd,
    })
  })

  it('sends the SOCKET_CLI_*_PATH override as the bin', async () => {
    const mvn = path.join(cwd, 'mvn')
    await fs.writeFile(mvn, '', { mode: 0o755 })
    process.env['SOCKET_CLI_MAVEN_PATH'] = mvn
    coanaAnswers({ status: 'empty' })
    await runManifestFacts({ ...baseArgs, cwd })
    expect(calls[0]!.request.config.bin).toBe(mvn)
  })

  it('installs files into the work dir and collects the root for reachability', async () => {
    const entry = {
      factsFile: '/r/pom.xml.socket.facts.json',
      stateDir: '/w/x',
    }
    coanaAnswers({
      factsPath: entry.factsFile,
      projects: [],
      sidecarEntry: entry,
      status: 'generated',
    })
    const workDir: SocketFactsWorkDir = {
      dir: '/w',
      entries: [],
      withFiles: true,
    }
    await runManifestFacts({ ...baseArgs, context: { workDir }, cwd })
    expect(calls[0]!.args.slice(-3)).toEqual([
      '--with-files',
      '--work-dir',
      '/w',
    ])
    expect(workDir.entries).toEqual([entry])
  })

  it('keeps state without installing files for socket fix', async () => {
    coanaAnswers({
      factsPath: '/r/f',
      projects: [],
      sidecarEntry: { factsFile: '/r/f', stateDir: '/w/y' },
      status: 'generated',
    })
    const workDir = { dir: '/w', entries: [], withFiles: false }
    await runManifestFacts({ ...baseArgs, context: { workDir }, cwd })
    expect(calls[0]!.args.slice(-2)).toEqual(['--work-dir', '/w'])
    expect(calls[0]!.args).not.toContain('--with-files')
  })

  it('is nothing to upload when the build resolves nothing', async () => {
    coanaAnswers({ status: 'empty' })
    expect(await runManifestFacts({ ...baseArgs, cwd })).toBeUndefined()
    expect(process.exitCode).toBeUndefined()
  })

  it('fails when Coana reports a failed build', async () => {
    coanaAnswers({ status: 'failed' }, false)
    expect(await runManifestFacts({ ...baseArgs, cwd })).toBeNull()
    expect(process.exitCode).toBe(1)
  })

  it('fails when Coana writes no result', async () => {
    coanaAnswers(undefined, false)
    expect(await runManifestFacts({ ...baseArgs, cwd })).toBeNull()
    expect(process.exitCode).toBe(1)
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

describe('listDotnetSolutionMembers', () => {
  it('lists the members once for the same request', async () => {
    coanaAnswers({ members: ['/r/A/A.csproj'] })
    const request = { buildOpts: [], dir: cwd, entryFile: 'All.sln' }
    expect(await listDotnetSolutionMembers(request)).toEqual(['/r/A/A.csproj'])
    expect(await listDotnetSolutionMembers(request)).toEqual(['/r/A/A.csproj'])
    expect(spawnCoana).toHaveBeenCalledOnce()
    expect(calls[0]!.args).toContain('--list-members')
    expect(calls[0]!.request).toMatchObject({
      buildRoot: cwd,
      entryFile: 'All.sln',
      excludeBase: cwd,
      tool: 'dotnet',
    })
  })

  it('cannot tell when the SDK cannot read the solution', async () => {
    coanaAnswers({ members: null })
    expect(
      await listDotnetSolutionMembers({
        buildOpts: [],
        dir: cwd,
        entryFile: 'All.slnx',
      }),
    ).toBeUndefined()
  })

  it('lists nothing when Coana fails', async () => {
    coanaAnswers(undefined, false)
    expect(
      await listDotnetSolutionMembers({
        buildOpts: [],
        dir: cwd,
        entryFile: 'Broken.sln',
      }),
    ).toEqual([])
  })
})
