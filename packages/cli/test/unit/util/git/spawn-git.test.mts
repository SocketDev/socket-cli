/**
 * Unit tests for the git spawn chokepoint.
 *
 * Purpose: prove the four hardening properties every CLI git invocation is
 * supposed to carry, by asserting on the argv and env handed to the injected
 * spawn seam rather than by running git.
 *
 * Test Coverage:
 *
 * - The resolved command is an absolute path, never the bare name `git`.
 * - Every `GIT_*` variable is dropped from the child environment, PATH is
 *   replaced with the sanitized search path, and `GIT_TERMINAL_PROMPT=0` is set.
 * - The hygiene `-c` overrides and the two top-level flags precede the
 *   subcommand.
 * - An operand spelled `--upload-pack=…` lands after `--end-of-options`, so git
 *   reads it as a ref rather than as an option.
 * - Resolution is memoized per protected root + PATH, and a miss throws.
 *
 * Related Files: - src/util/git/spawn-git.mts (implementation)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDefaultProtectedRoot, mockIsDebug, mockResolveTrustedExecutable, mockSpawn } =
  vi.hoisted(() => ({
    mockDefaultProtectedRoot: vi.fn(),
    mockIsDebug: vi.fn(),
    mockResolveTrustedExecutable: vi.fn(),
    mockSpawn: vi.fn(),
  }))

vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: mockSpawn,
}))

vi.mock(import('@socketsecurity/lib-stable/debug/namespace'), () => ({
  isDebug: mockIsDebug,
}))

vi.mock(
  import('../../../../src/util/trusted-executable.mts'),
  async importOriginal => ({
    ...(await importOriginal()),
    defaultProtectedRoot: mockDefaultProtectedRoot,
    resolveTrustedExecutable: mockResolveTrustedExecutable,
  }),
)

const {
  GIT_OPERAND_FENCE,
  buildGitChildEnv,
  clearGitExecutableCache,
  gitQuietStdio,
  listGitHygieneArgs,
  omitGitEnvVars,
  resolveGitExecutable,
  spawnGit,
} = await import('../../../../src/util/git/spawn-git.mts')

const TRUSTED_GIT = '/usr/bin/git'
const SAFE_PATH = '/usr/bin:/bin'
const HOSTILE_REPO = '/tmp/hostile-checkout'

function lastSpawnCall(): {
  args: string[]
  cmd: string
  options: { cwd?: string; env?: Record<string, string | undefined> }
} {
  const call = mockSpawn.mock.calls.at(-1)
  if (!call) {
    throw new Error('spawn was never called')
  }
  return { cmd: call[0], args: call[1], options: call[2] ?? {} }
}

beforeEach(() => {
  vi.clearAllMocks()
  clearGitExecutableCache()
  mockIsDebug.mockReturnValue(false)
  mockDefaultProtectedRoot.mockResolvedValue(HOSTILE_REPO)
  mockResolveTrustedExecutable.mockResolvedValue({
    environment: { PATH: SAFE_PATH },
    executable: TRUSTED_GIT,
  })
  mockSpawn.mockResolvedValue({ code: 0, stderr: '', stdout: '' })
})

afterEach(() => {
  clearGitExecutableCache()
})

describe('omitGitEnvVars', () => {
  it('drops every GIT_* variable and keeps the rest', () => {
    const result = omitGitEnvVars({
      GIT_ASKPASS: '/tmp/evil-askpass',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_GLOBAL: '/tmp/evil.gitconfig',
      GIT_DIR: '/tmp/evil/.git',
      GIT_EXTERNAL_DIFF: '/tmp/evil-diff',
      GIT_INDEX_FILE: '/tmp/evil-index',
      GIT_PAGER: '/tmp/evil-pager',
      GIT_SSH_COMMAND: 'sh -c evil',
      GIT_WORK_TREE: '/tmp/evil',
      HOME: '/home/user',
      PATH: '/usr/bin',
    })

    expect(Object.keys(result).sort()).toStrictEqual(['HOME', 'PATH'])
  })

  it('matches the GIT_ prefix case-insensitively', () => {
    expect(omitGitEnvVars({ git_dir: '/tmp/evil/.git' })).toStrictEqual({})
  })

  it('leaves a variable that merely starts with GIT', () => {
    expect(omitGitEnvVars({ GITHUB_TOKEN: 'tok' })).toStrictEqual({
      GITHUB_TOKEN: 'tok',
    })
  })
})

describe('buildGitChildEnv', () => {
  it('replaces PATH with the sanitized search path', () => {
    const result = buildGitChildEnv(
      { HOME: '/home/user', PATH: `${HOSTILE_REPO}/bin:/usr/bin` },
      SAFE_PATH,
    )

    expect(result['PATH']).toBe(SAFE_PATH)
    expect(result['HOME']).toBe('/home/user')
  })

  it('replaces a lowercase path key rather than leaving both', () => {
    const result = buildGitChildEnv({ Path: `${HOSTILE_REPO}/bin` }, SAFE_PATH)

    expect(result).toStrictEqual({
      GIT_TERMINAL_PROMPT: '0',
      PATH: SAFE_PATH,
    })
  })

  it('sets GIT_TERMINAL_PROMPT=0 after stripping the GIT_ namespace', () => {
    const result = buildGitChildEnv({ GIT_TERMINAL_PROMPT: '1' }, SAFE_PATH)

    expect(result['GIT_TERMINAL_PROMPT']).toBe('0')
  })
})

describe('listGitHygieneArgs', () => {
  it('carries the top-level flags and every config override', () => {
    expect(listGitHygieneArgs()).toStrictEqual([
      '--literal-pathspecs',
      '--no-pager',
      '-c',
      'core.fsmonitor=false',
      '-c',
      'core.hooksPath=',
      '-c',
      'credential.helper=',
      '-c',
      'protocol.allow=never',
      '-c',
      'protocol.ext.allow=never',
      '-c',
      'protocol.file.allow=always',
      '-c',
      'protocol.git.allow=always',
      '-c',
      'protocol.http.allow=always',
      '-c',
      'protocol.https.allow=always',
      '-c',
      'protocol.ssh.allow=always',
    ])
  })

  it('returns a fresh array so a caller cannot mutate the shared prefix', () => {
    const first = listGitHygieneArgs()
    first.push('-c', 'core.hooksPath=/tmp/evil-hooks')

    expect(listGitHygieneArgs()).not.toContain('/tmp/evil-hooks')
  })
})

describe('gitQuietStdio', () => {
  it('discards output outside debug mode', () => {
    mockIsDebug.mockReturnValue(false)

    expect(gitQuietStdio()).toBe('ignore')
  })

  it('forwards output in debug mode', () => {
    mockIsDebug.mockReturnValue(true)

    expect(gitQuietStdio()).toBe('inherit')
  })
})

describe('resolveGitExecutable', () => {
  it('returns the canonical executable and sanitized search path', async () => {
    const result = await resolveGitExecutable({
      cwd: HOSTILE_REPO,
      env: { PATH: `${HOSTILE_REPO}/bin:${SAFE_PATH}` },
    })

    expect(result).toStrictEqual({
      executable: TRUSTED_GIT,
      searchPath: SAFE_PATH,
    })
  })

  it('protects the outermost checkout, not the current directory', async () => {
    await resolveGitExecutable({ cwd: `${HOSTILE_REPO}/packages/app`, env: {} })

    expect(mockDefaultProtectedRoot).toHaveBeenCalledWith(
      `${HOSTILE_REPO}/packages/app`,
    )
    expect(mockResolveTrustedExecutable).toHaveBeenCalledWith(
      'git',
      {},
      HOSTILE_REPO,
    )
  })

  it('memoizes per protected root and PATH', async () => {
    const env = { PATH: SAFE_PATH }
    await resolveGitExecutable({ cwd: HOSTILE_REPO, env })
    await resolveGitExecutable({ cwd: HOSTILE_REPO, env })

    expect(mockResolveTrustedExecutable).toHaveBeenCalledTimes(1)
  })

  it('re-resolves when PATH changes', async () => {
    await resolveGitExecutable({ cwd: HOSTILE_REPO, env: { PATH: SAFE_PATH } })
    await resolveGitExecutable({ cwd: HOSTILE_REPO, env: { PATH: '/opt/bin' } })

    expect(mockResolveTrustedExecutable).toHaveBeenCalledTimes(2)
  })

  it('throws naming the checkout when nothing resolves outside it', async () => {
    mockResolveTrustedExecutable.mockResolvedValue(undefined)

    await expect(
      resolveGitExecutable({ cwd: HOSTILE_REPO, env: {} }),
    ).rejects.toThrow(
      /Cannot resolve a trusted git executable.*\/tmp\/hostile-checkout.*Install git/s,
    )
  })
})

describe('spawnGit', () => {
  it('spawns the absolute executable, never the bare name', async () => {
    await spawnGit(['status'], { cwd: HOSTILE_REPO, env: { PATH: SAFE_PATH } })

    const { cmd } = lastSpawnCall()
    expect(cmd).toBe(TRUSTED_GIT)
    expect(cmd).not.toBe('git')
  })

  it('places the hygiene prefix before the subcommand', async () => {
    await spawnGit(['ls-remote', '--heads'], {
      cwd: HOSTILE_REPO,
      env: { PATH: SAFE_PATH },
    })

    const { args } = lastSpawnCall()
    expect(args.slice(0, listGitHygieneArgs().length)).toStrictEqual(
      listGitHygieneArgs(),
    )
    expect(args.indexOf('ls-remote')).toBe(listGitHygieneArgs().length)
  })

  it('disables the scanned repository hooks and the ext transport', async () => {
    await spawnGit(['commit', '-m', 'chore: fix'], { cwd: HOSTILE_REPO })

    const { args } = lastSpawnCall()
    for (const override of [
      'core.fsmonitor=false',
      'core.hooksPath=',
      'credential.helper=',
      'protocol.allow=never',
      'protocol.ext.allow=never',
    ]) {
      expect(args[args.indexOf(override) - 1]).toBe('-c')
    }
  })

  it('strips GIT_* from the child env and pins the sanitized PATH', async () => {
    await spawnGit(['status'], {
      cwd: HOSTILE_REPO,
      env: {
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'core.hooksPath',
        GIT_CONFIG_VALUE_0: `${HOSTILE_REPO}/evil-hooks`,
        GIT_DIR: `${HOSTILE_REPO}/.git`,
        GIT_SSH_COMMAND: 'sh -c evil',
        HOME: '/home/user',
        PATH: `${HOSTILE_REPO}/bin:${SAFE_PATH}`,
      },
    })

    const { options } = lastSpawnCall()
    expect(options.env).toStrictEqual({
      GIT_TERMINAL_PROMPT: '0',
      HOME: '/home/user',
      PATH: SAFE_PATH,
    })
  })

  it('fences an operand that is spelled like an option', async () => {
    const hostileBranch = '--upload-pack=touch /tmp/pwned'
    await spawnGit(['ls-remote', '--heads'], {
      cwd: HOSTILE_REPO,
      operands: ['origin', hostileBranch],
    })

    const { args } = lastSpawnCall()
    const fenceIndex = args.indexOf(GIT_OPERAND_FENCE)
    expect(fenceIndex).toBeGreaterThan(-1)
    expect(args.indexOf(hostileBranch)).toBeGreaterThan(fenceIndex)
    expect(args.slice(fenceIndex)).toStrictEqual([
      GIT_OPERAND_FENCE,
      'origin',
      hostileBranch,
    ])
  })

  it('omits the fence when there are no operands', async () => {
    await spawnGit(['diff', '--name-only'], { cwd: HOSTILE_REPO })

    expect(lastSpawnCall().args).not.toContain(GIT_OPERAND_FENCE)
  })

  it('omits the fence for an empty operand list', async () => {
    await spawnGit(['status'], { cwd: HOSTILE_REPO, operands: [] })

    expect(lastSpawnCall().args).not.toContain(GIT_OPERAND_FENCE)
  })

  it('forwards cwd and stdio to spawn', async () => {
    await spawnGit(['status'], { cwd: HOSTILE_REPO, stdio: 'ignore' })

    const { options } = lastSpawnCall()
    expect(options.cwd).toBe(HOSTILE_REPO)
    expect(options).toHaveProperty('stdio', 'ignore')
  })

  it('leaves stdio unset when the caller omits it', async () => {
    await spawnGit(['status'], { cwd: HOSTILE_REPO })

    expect(lastSpawnCall().options).not.toHaveProperty('stdio')
  })

  it('propagates the resolution failure instead of falling back to bare git', async () => {
    mockResolveTrustedExecutable.mockResolvedValue(undefined)

    await expect(spawnGit(['status'], { cwd: HOSTILE_REPO })).rejects.toThrow(
      /Cannot resolve a trusted git executable/,
    )
    expect(mockSpawn).not.toHaveBeenCalled()
  })
})
