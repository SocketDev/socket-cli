import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  bareDoubleDashMessage,
  hasBareDoubleDash,
  helpRequest,
  helpText,
  runMainAsync,
  scriptErrorMessage,
  scriptNameFromEntry,
} from '../scripts/lib/run-main.mts'

import type { ScriptMeta } from '../scripts/lib/run-main.mts'

const rootPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

const META: ScriptMeta = {
  describe: 'does the thing',
  help: 'Usage: pnpm run thing [--flag]',
}

/** Silence the writes runMainAsync makes so the suite output stays readable. */
function captureOutput(): { out: string[]; err: string[] } {
  const out: string[] = []
  const err: string[] = []
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    out.push(String(chunk))
    return true
  })
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    err.push(String(chunk))
    return true
  })
  return { err, out }
}

afterEach(() => {
  vi.restoreAllMocks()
  // A leaked non-zero exit code would fail the whole vitest run.
  process.exitCode = undefined
})

describe('helpRequest', () => {
  it('finds --describe', () => {
    expect(helpRequest(['--describe'])).toBe('describe')
  })

  it('finds -h and --help', () => {
    expect(helpRequest(['-h'])).toBe('help')
    expect(helpRequest(['--help'])).toBe('help')
  })

  it('prefers --describe when both are present', () => {
    expect(helpRequest(['--help', '--describe'])).toBe('describe')
  })

  it('returns undefined for an ordinary argv', () => {
    expect(helpRequest(['--dry-run', 'file.mts'])).toBeUndefined()
  })
})

describe('helpText', () => {
  it('prints only the one-liner for a describe request', () => {
    expect(helpText('describe', META)).toBe('does the thing')
  })

  it('prints the one-liner, a blank line, then the usage body for help', () => {
    expect(helpText('help', META)).toBe(
      'does the thing\n\nUsage: pnpm run thing [--flag]',
    )
  })
})

describe('hasBareDoubleDash', () => {
  it('detects a bare double dash', () => {
    expect(hasBareDoubleDash(['--', '--dry-run'])).toBe(true)
  })

  it('ignores flags that merely start with dashes', () => {
    expect(hasBareDoubleDash(['--dry-run', '--all'])).toBe(false)
  })
})

describe('scriptNameFromEntry', () => {
  it('strips the directory and the extension', () => {
    expect(scriptNameFromEntry('/repo/scripts/update.mts')).toBe('update')
  })

  it('handles Windows separators', () => {
    expect(scriptNameFromEntry('C:\\repo\\scripts\\check.mts')).toBe('check')
  })

  it('falls back when there is no entry path', () => {
    expect(scriptNameFromEntry(undefined)).toBe('this script')
  })
})

describe('bareDoubleDashMessage', () => {
  it('names the script in a pasteable fix line', () => {
    expect(bareDoubleDashMessage('update')).toContain(
      'pnpm run update --dry-run',
    )
  })
})

describe('scriptErrorMessage', () => {
  it('uses an Error message without its stack', () => {
    expect(scriptErrorMessage(new Error('boom'))).toBe('boom')
  })

  it('stringifies a non-Error throw', () => {
    expect(scriptErrorMessage('plain')).toBe('plain')
  })
})

describe('runMainAsync gating', () => {
  it('answers --describe without running main', async () => {
    const { out } = captureOutput()
    const main = vi.fn()
    await runMainAsync(main, META, ['--describe'])
    expect(main).not.toHaveBeenCalled()
    expect(out.join('')).toBe('does the thing\n')
    expect(process.exitCode).toBe(0)
  })

  it('answers --help without running main', async () => {
    const { out } = captureOutput()
    const main = vi.fn()
    await runMainAsync(main, META, ['--help'])
    expect(main).not.toHaveBeenCalled()
    expect(out.join('')).toContain('Usage: pnpm run thing')
    expect(process.exitCode).toBe(0)
  })

  it('answers a help request even when argv also carries a bare --', async () => {
    const { out } = captureOutput()
    const main = vi.fn()
    await runMainAsync(main, META, ['--describe', '--', '--all'])
    expect(main).not.toHaveBeenCalled()
    expect(out.join('')).toBe('does the thing\n')
    expect(process.exitCode).toBe(0)
  })

  it('refuses a bare -- without running main', async () => {
    const { err } = captureOutput()
    const main = vi.fn()
    await runMainAsync(main, META, ['--', '--dry-run'])
    expect(main).not.toHaveBeenCalled()
    expect(err.join('')).toContain('a bare `--` in the command line')
    expect(process.exitCode).toBe(1)
  })

  it('runs main for an ordinary argv and takes its exit code', async () => {
    captureOutput()
    const main = vi.fn(() => 3)
    await runMainAsync(main, META, ['--dry-run'])
    expect(main).toHaveBeenCalledOnce()
    expect(process.exitCode).toBe(3)
  })

  it('defaults to exit 0 when main returns nothing', async () => {
    captureOutput()
    await runMainAsync(() => {}, META, [])
    expect(process.exitCode).toBe(0)
  })

  it('keeps an exit code main assigned itself', async () => {
    captureOutput()
    await runMainAsync(
      () => {
        process.exitCode = 2
      },
      META,
      [],
    )
    expect(process.exitCode).toBe(2)
  })

  it('reports a throw as a message and exits non-zero', async () => {
    const { err } = captureOutput()
    await runMainAsync(
      () => {
        throw new Error('main blew up')
      },
      META,
      [],
    )
    expect(err.join('')).toBe('main blew up\n')
    expect(process.exitCode).toBe(1)
  })
})

describe('entry scripts', () => {
  const entries = [
    'scripts/check.mts',
    'scripts/lint.mts',
    'scripts/update.mts',
    'scripts/release/bump.mts',
    'scripts/release/promote.mts',
  ]

  // Bare `node <entry>.mts` needs native type stripping, which landed in
  // Node 22.6 (`process.features.typescript` reports 'strip' or 'transform'
  // there and is undefined before it). These entries are maintainer tooling
  // that targets the repo's pinned dev Node; the older CI matrix lanes cover
  // the built product, not this tooling, so the spawn assertions skip where
  // the runtime cannot execute .mts at all.
  // The experimental flag is the capability being probed; undefined is false.
  // eslint-disable-next-line n/no-unsupported-features/node-builtins
  const canRunMts = Boolean(process.features.typescript)

  it.skipIf(!canRunMts).each(entries)(
    '%s answers --describe without touching the tree',
    entryPath => {
      const before = spawnSync('git', ['status', '--porcelain'], {
        cwd: rootPath,
        encoding: 'utf8',
      }).stdout
      const result = spawnSync(process.execPath, [entryPath, '--describe'], {
        cwd: rootPath,
        encoding: 'utf8',
      })
      const after = spawnSync('git', ['status', '--porcelain'], {
        cwd: rootPath,
        encoding: 'utf8',
      }).stdout
      // Surface the spawned stderr on failure so an environmental break
      // (missing runtime capability, bad PATH) explains itself.
      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout.trim().length, result.stderr).toBeGreaterThan(0)
      expect(result.stdout.trim().split('\n')).toHaveLength(1)
      expect(after).toBe(before)
    },
  )

  it.each(entries)('%s declares a describe line in its meta', entryPath => {
    const source = readFileSync(path.join(rootPath, entryPath), 'utf8')
    expect(source).toContain('SCRIPT_META')
    expect(source).toContain('runMain(main, SCRIPT_META)')
    expect(source).toContain('isMainModule(import.meta.url)')
  })
})
