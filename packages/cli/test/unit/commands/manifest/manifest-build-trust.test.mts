/**
 * Unit tests for the socket.json build-tool trust boundary.
 *
 * A scanned repository owns its socket.json, so `defaults.manifest.<tool>.bin`,
 * `gradleOpts`/`sbtOpts`, and the conda `infile`/`outfile` paths are untrusted
 * input. These tests pin the rule: the conventional defaults still run with no
 * friction, a redirected bin, a repo-supplied option, and a path that leaves cwd
 * are refused, and an explicit CLI flag is honored.
 *
 * Related Files:
 *
 * - Src/commands/manifest/manifest-build-trust.mts
 */

import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  readBuildToolBin,
  resolveCondaInfile,
  resolveCondaOutfile,
  resolveGradleInvocation,
  resolveSbtInvocation,
  splitBuildToolOpts,
} from '../../../../src/commands/manifest/manifest-build-trust.mts'

import type { SocketJson } from '../../../../src/util/socket/json.mts'

const CWD = path.join(path.sep, 'proj')
const GRADLEW = path.join(CWD, 'gradlew')

function socketJsonWithGradle(
  gradle: Record<string, unknown>,
): SocketJson | undefined {
  return { defaults: { manifest: { gradle } } } as unknown as SocketJson
}

function socketJsonWithSbt(
  sbt: Record<string, unknown>,
): SocketJson | undefined {
  return { defaults: { manifest: { sbt } } } as unknown as SocketJson
}

function socketJsonWithConda(
  conda: Record<string, unknown>,
): SocketJson | undefined {
  return { defaults: { manifest: { conda } } } as unknown as SocketJson
}

describe('splitBuildToolOpts', () => {
  it('splits a space-separated string and drops empties', () => {
    expect(splitBuildToolOpts('  --info   --stacktrace ')).toEqual([
      '--info',
      '--stacktrace',
    ])
  })

  it('yields no tokens for a non-string', () => {
    expect(splitBuildToolOpts(true)).toEqual([])
    expect(splitBuildToolOpts(undefined)).toEqual([])
  })
})

describe('readBuildToolBin', () => {
  it('trims a string and rejects everything else', () => {
    expect(readBuildToolBin('  ./gradlew ')).toBe('./gradlew')
    expect(readBuildToolBin({ toString: () => 'evil' })).toBe('')
    expect(readBuildToolBin(undefined)).toBe('')
  })
})

describe('resolveGradleInvocation', () => {
  it('defaults to the project wrapper with no socket.json', () => {
    const result = resolveGradleInvocation({
      cliBin: undefined,
      cliOpts: undefined,
      cwd: CWD,
      socketJson: undefined,
      trustSocketJson: false,
    })

    expect(result.ok).toBe(true)
    expect(result.ok && result.data).toEqual({ bin: GRADLEW, opts: [] })
  })

  it('honors a socket.json bin that names the wrapper the CLI would pick', () => {
    const result = resolveGradleInvocation({
      cliBin: undefined,
      cliOpts: undefined,
      cwd: CWD,
      socketJson: socketJsonWithGradle({ bin: './gradlew' }),
      trustSocketJson: false,
    })

    expect(result.ok).toBe(true)
    expect(result.ok && result.data.bin).toBe(GRADLEW)
  })

  it('refuses a socket.json bin that points elsewhere', () => {
    const result = resolveGradleInvocation({
      cliBin: undefined,
      cliOpts: undefined,
      cwd: CWD,
      socketJson: socketJsonWithGradle({ bin: './.ci/gradlew' }),
      trustSocketJson: false,
    })

    expect(result.ok).toBe(false)
    expect(!result.ok && result.message).toContain('Refused a gradle binary')
    expect(!result.ok && result.cause).toContain('defaults.manifest.gradle.bin')
    expect(!result.ok && result.cause).toContain('--trust-socket-json')
  })

  it('refuses a bare socket.json bin that would hit PATH', () => {
    const result = resolveGradleInvocation({
      cliBin: undefined,
      cliOpts: undefined,
      cwd: CWD,
      socketJson: socketJsonWithGradle({ bin: 'gradle' }),
      trustSocketJson: false,
    })

    expect(result.ok).toBe(false)
  })

  it('honors a redirected socket.json bin under --trust-socket-json', () => {
    const result = resolveGradleInvocation({
      cliBin: undefined,
      cliOpts: undefined,
      cwd: CWD,
      socketJson: socketJsonWithGradle({ bin: './.ci/gradlew' }),
      trustSocketJson: true,
    })

    expect(result.ok).toBe(true)
    expect(result.ok && result.data.bin).toBe(path.join(CWD, '.ci', 'gradlew'))
  })

  it('honors an explicit CLI bin over a socket.json bin', () => {
    const result = resolveGradleInvocation({
      cliBin: '/usr/local/bin/gradle',
      cliOpts: undefined,
      cwd: CWD,
      socketJson: socketJsonWithGradle({ bin: './evil' }),
      trustSocketJson: false,
    })

    expect(result.ok).toBe(true)
    expect(result.ok && result.data.bin).toBe(
      path.resolve(CWD, '/usr/local/bin/gradle'),
    )
  })

  it('refuses an execution-redirecting socket.json gradleOpts', () => {
    const result = resolveGradleInvocation({
      cliBin: undefined,
      cliOpts: undefined,
      cwd: CWD,
      socketJson: socketJsonWithGradle({
        gradleOpts: '--init-script ./payload.gradle',
      }),
      trustSocketJson: false,
    })

    expect(result.ok).toBe(false)
    expect(!result.ok && result.message).toContain('Refused gradle options')
    expect(!result.ok && result.cause).toContain(
      'defaults.manifest.gradle.gradleOpts',
    )
  })

  it('refuses a benign-looking socket.json gradleOpts too', () => {
    const result = resolveGradleInvocation({
      cliBin: undefined,
      cliOpts: undefined,
      cwd: CWD,
      socketJson: socketJsonWithGradle({ gradleOpts: '--info' }),
      trustSocketJson: false,
    })

    expect(result.ok).toBe(false)
  })

  it('honors socket.json gradleOpts under --trust-socket-json', () => {
    const result = resolveGradleInvocation({
      cliBin: undefined,
      cliOpts: undefined,
      cwd: CWD,
      socketJson: socketJsonWithGradle({ gradleOpts: '--info --stacktrace' }),
      trustSocketJson: true,
    })

    expect(result.ok).toBe(true)
    expect(result.ok && result.data.opts).toEqual(['--info', '--stacktrace'])
  })

  it('honors explicit CLI opts over socket.json opts', () => {
    const result = resolveGradleInvocation({
      cliBin: undefined,
      cliOpts: '--offline',
      cwd: CWD,
      socketJson: socketJsonWithGradle({
        gradleOpts: '--init-script ./payload.gradle',
      }),
      trustSocketJson: false,
    })

    expect(result.ok).toBe(true)
    expect(result.ok && result.data.opts).toEqual(['--offline'])
  })

  it('ignores a non-string socket.json bin instead of throwing', () => {
    const result = resolveGradleInvocation({
      cliBin: undefined,
      cliOpts: undefined,
      cwd: CWD,
      socketJson: socketJsonWithGradle({ bin: { toString: () => 'evil' } }),
      trustSocketJson: false,
    })

    expect(result.ok).toBe(true)
    expect(result.ok && result.data.bin).toBe(GRADLEW)
  })
})

describe('resolveSbtInvocation', () => {
  it('defaults to the sbt on PATH with no socket.json', () => {
    const result = resolveSbtInvocation({
      cliBin: undefined,
      cliOpts: undefined,
      cwd: CWD,
      socketJson: undefined,
      trustSocketJson: false,
    })

    expect(result.ok).toBe(true)
    expect(result.ok && result.data).toEqual({ bin: 'sbt', opts: [] })
  })

  it('honors a socket.json bin that names the conventional sbt', () => {
    const result = resolveSbtInvocation({
      cliBin: undefined,
      cliOpts: undefined,
      cwd: CWD,
      socketJson: socketJsonWithSbt({ bin: 'sbt' }),
      trustSocketJson: false,
    })

    expect(result.ok).toBe(true)
    expect(result.ok && result.data.bin).toBe('sbt')
  })

  it('refuses a socket.json bin that points into the repo', () => {
    const result = resolveSbtInvocation({
      cliBin: undefined,
      cliOpts: undefined,
      cwd: CWD,
      socketJson: socketJsonWithSbt({ bin: './sbt' }),
      trustSocketJson: false,
    })

    expect(result.ok).toBe(false)
    expect(!result.ok && result.message).toContain('Refused a sbt binary')
    expect(!result.ok && result.cause).toContain('defaults.manifest.sbt.bin')
  })

  it('honors a redirected socket.json bin under --trust-socket-json', () => {
    const result = resolveSbtInvocation({
      cliBin: undefined,
      cliOpts: undefined,
      cwd: CWD,
      socketJson: socketJsonWithSbt({ bin: './sbt' }),
      trustSocketJson: true,
    })

    expect(result.ok).toBe(true)
    expect(result.ok && result.data.bin).toBe('./sbt')
  })

  it('honors an explicit CLI bin over a socket.json bin', () => {
    const result = resolveSbtInvocation({
      cliBin: '/usr/bin/sbt',
      cliOpts: undefined,
      cwd: CWD,
      socketJson: socketJsonWithSbt({ bin: './sbt' }),
      trustSocketJson: false,
    })

    expect(result.ok).toBe(true)
    expect(result.ok && result.data.bin).toBe('/usr/bin/sbt')
  })

  it('refuses socket.json sbtOpts carrying an sbt command', () => {
    const result = resolveSbtInvocation({
      cliBin: undefined,
      cliOpts: undefined,
      cwd: CWD,
      socketJson: socketJsonWithSbt({ sbtOpts: 'eval sys.process.Process' }),
      trustSocketJson: false,
    })

    expect(result.ok).toBe(false)
    expect(!result.ok && result.message).toContain('Refused sbt options')
    expect(!result.ok && result.cause).toContain(
      'defaults.manifest.sbt.sbtOpts',
    )
  })

  it('honors socket.json sbtOpts under --trust-socket-json', () => {
    const result = resolveSbtInvocation({
      cliBin: undefined,
      cliOpts: undefined,
      cwd: CWD,
      socketJson: socketJsonWithSbt({ sbtOpts: '-batch -no-colors' }),
      trustSocketJson: true,
    })

    expect(result.ok).toBe(true)
    expect(result.ok && result.data.opts).toEqual(['-batch', '-no-colors'])
  })

  it('honors explicit CLI opts over socket.json opts', () => {
    const result = resolveSbtInvocation({
      cliBin: undefined,
      cliOpts: '-batch',
      cwd: CWD,
      socketJson: socketJsonWithSbt({ sbtOpts: 'eval 1' }),
      trustSocketJson: false,
    })

    expect(result.ok).toBe(true)
    expect(result.ok && result.data.opts).toEqual(['-batch'])
  })
})

describe('resolveCondaOutfile', () => {
  it('defaults to requirements.txt with no socket.json', () => {
    const result = resolveCondaOutfile({
      cliOut: undefined,
      cwd: CWD,
      socketJson: undefined,
      trustSocketJson: false,
    })

    expect(result.ok).toBe(true)
    expect(result.ok && result.data).toBe('requirements.txt')
  })

  it('honors a socket.json outfile inside the project', () => {
    const result = resolveCondaOutfile({
      cliOut: undefined,
      cwd: CWD,
      socketJson: socketJsonWithConda({ outfile: 'build/reqs.txt' }),
      trustSocketJson: false,
    })

    expect(result.ok).toBe(true)
    expect(result.ok && result.data).toBe(path.join(CWD, 'build', 'reqs.txt'))
  })

  it('passes the stdout sentinel through untouched', () => {
    const result = resolveCondaOutfile({
      cliOut: undefined,
      cwd: CWD,
      socketJson: socketJsonWithConda({ outfile: '-' }),
      trustSocketJson: false,
    })

    expect(result.ok).toBe(true)
    expect(result.ok && result.data).toBe('-')
  })

  it('refuses an absolute socket.json outfile', () => {
    const result = resolveCondaOutfile({
      cliOut: undefined,
      cwd: CWD,
      socketJson: socketJsonWithConda({
        outfile: path.join(path.sep, 'home', 'user', '.zshrc'),
      }),
      trustSocketJson: false,
    })

    expect(result.ok).toBe(false)
    expect(!result.ok && result.message).toContain(
      'Refused a conda output path',
    )
    expect(!result.ok && result.cause).toContain(
      'defaults.manifest.conda.outfile',
    )
    expect(!result.ok && result.cause).toContain('--trust-socket-json')
  })

  it('refuses a socket.json outfile that escapes with ..', () => {
    const result = resolveCondaOutfile({
      cliOut: undefined,
      cwd: CWD,
      socketJson: socketJsonWithConda({ outfile: '../../etc/profile' }),
      trustSocketJson: false,
    })

    expect(result.ok).toBe(false)
  })

  it('honors an escaping socket.json outfile under --trust-socket-json', () => {
    const outfile = path.join(path.sep, 'tmp', 'reqs.txt')
    const result = resolveCondaOutfile({
      cliOut: undefined,
      cwd: CWD,
      socketJson: socketJsonWithConda({ outfile }),
      trustSocketJson: true,
    })

    expect(result.ok).toBe(true)
    expect(result.ok && result.data).toBe(outfile)
  })

  it('honors an explicit CLI out over a socket.json outfile', () => {
    const result = resolveCondaOutfile({
      cliOut: '/tmp/mine.txt',
      cwd: CWD,
      socketJson: socketJsonWithConda({ outfile: '../../etc/profile' }),
      trustSocketJson: false,
    })

    expect(result.ok).toBe(true)
    expect(result.ok && result.data).toBe('/tmp/mine.txt')
  })
})

describe('resolveCondaInfile', () => {
  it('defaults to environment.yml with no socket.json', () => {
    const result = resolveCondaInfile({
      cliFile: undefined,
      cwd: CWD,
      socketJson: undefined,
      trustSocketJson: false,
    })

    expect(result.ok).toBe(true)
    expect(result.ok && result.data).toBe('environment.yml')
  })

  it('honors a socket.json infile inside the project', () => {
    const result = resolveCondaInfile({
      cliFile: undefined,
      cwd: CWD,
      socketJson: socketJsonWithConda({ infile: 'env/dev.yml' }),
      trustSocketJson: false,
    })

    expect(result.ok).toBe(true)
    expect(result.ok && result.data).toBe(path.join(CWD, 'env', 'dev.yml'))
  })

  it('passes the stdin sentinel through untouched', () => {
    const result = resolveCondaInfile({
      cliFile: undefined,
      cwd: CWD,
      socketJson: socketJsonWithConda({ infile: '-' }),
      trustSocketJson: false,
    })

    expect(result.ok).toBe(true)
    expect(result.ok && result.data).toBe('-')
  })

  it('refuses a socket.json infile that escapes with ..', () => {
    const result = resolveCondaInfile({
      cliFile: undefined,
      cwd: CWD,
      socketJson: socketJsonWithConda({ infile: '../../../etc/passwd' }),
      trustSocketJson: false,
    })

    expect(result.ok).toBe(false)
    expect(!result.ok && result.message).toContain('Refused a conda input path')
    expect(!result.ok && result.cause).toContain(
      'defaults.manifest.conda.infile',
    )
  })

  it('honors an escaping socket.json infile under --trust-socket-json', () => {
    const infile = path.join(path.sep, 'etc', 'passwd')
    const result = resolveCondaInfile({
      cliFile: undefined,
      cwd: CWD,
      socketJson: socketJsonWithConda({ infile }),
      trustSocketJson: true,
    })

    expect(result.ok).toBe(true)
    expect(result.ok && result.data).toBe(infile)
  })

  it('honors an explicit CLI file over a socket.json infile', () => {
    const result = resolveCondaInfile({
      cliFile: 'mine.yml',
      cwd: CWD,
      socketJson: socketJsonWithConda({ infile: '../../../etc/passwd' }),
      trustSocketJson: false,
    })

    expect(result.ok).toBe(true)
    expect(result.ok && result.data).toBe('mine.yml')
  })
})
