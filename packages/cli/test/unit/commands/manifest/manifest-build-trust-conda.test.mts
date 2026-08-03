/**
 * Unit tests for the socket.json conda path trust boundary.
 *
 * `defaults.manifest.conda.infile` is read and `outfile` is written, both with
 * content derived from the scanned repository, so a path that resolves outside
 * cwd is refused unless the caller opts in with the trust flag. The
 * `environment.yml` / `requirements.txt` defaults stay frictionless.
 *
 * Related Files:
 *
 * - Src/commands/manifest/manifest-build-trust.mts
 */

import { mkdirSync, mkdtempSync, symlinkSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  resolveCondaInfile,
  resolveCondaOutfile,
} from '../../../../src/commands/manifest/manifest-build-trust.mts'

import type { SocketJson } from '../../../../src/util/socket/json.mts'

const CWD = path.join(path.sep, 'proj')

function socketJsonWithConda(
  conda: Record<string, unknown>,
): SocketJson | undefined {
  return { defaults: { manifest: { conda } } } as unknown as SocketJson
}

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

describe('conda path containment follows symlinks', () => {
  // path.resolve collapses `..` but follows no symlink, so a link inside the
  // project pointing outward reads as contained while the real read/write
  // lands outside it. Both directions need a real filesystem to prove.
  function projectWithEscapingSymlink(): { escape: string; project: string } {
    const base = mkdtempSync(path.join(os.tmpdir(), 'conda-trust-'))
    const project = path.join(base, 'project')
    const outside = path.join(base, 'outside')
    mkdirSync(project)
    mkdirSync(outside)
    const escape = path.join(project, 'escape')
    symlinkSync(outside, escape, 'dir')
    return { escape, project }
  }

  it('refuses an outfile reached through a symlink out of the project', () => {
    const { project } = projectWithEscapingSymlink()

    const result = resolveCondaOutfile({
      cliOut: undefined,
      cwd: project,
      socketJson: socketJsonWithConda({ outfile: 'escape/pwned.txt' }),
      trustSocketJson: false,
    })

    expect(result.ok).toBe(false)
  })

  it('refuses an infile reached through a symlink out of the project', () => {
    const { project } = projectWithEscapingSymlink()

    const result = resolveCondaInfile({
      cliFile: undefined,
      cwd: project,
      socketJson: socketJsonWithConda({ infile: 'escape/secrets.yml' }),
      trustSocketJson: false,
    })

    expect(result.ok).toBe(false)
  })

  it('allows a real path inside the project', () => {
    const { project } = projectWithEscapingSymlink()

    const result = resolveCondaOutfile({
      cliOut: undefined,
      cwd: project,
      socketJson: socketJsonWithConda({ outfile: 'build/requirements.txt' }),
      trustSocketJson: false,
    })

    expect(result.ok).toBe(true)
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
