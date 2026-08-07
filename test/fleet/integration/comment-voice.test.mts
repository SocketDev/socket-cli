/**
 * @file Integration tier for scripts/fleet/comment-voice.mts — `runCli()`
 *   with injected IO, crossing the module's real boundaries (fs for the file
 *   argument, a stream for the stdin fallback) without spawning a process.
 *   The subprocess round trip lives in the e2e tier; the pure rule logic in
 *   the unit tier.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { runCli } from '../../../scripts/fleet/comment-voice.mts'

const capture = () => {
  const lines: string[] = []
  return { lines, log: (l: string) => lines.push(l) }
}

describe('runCli', () => {
  it('--rules prints the decision tree and exits 0', async () => {
    const io = capture()
    expect(await runCli(['--rules'], io)).toBe(0)
    expect(io.lines.join('\n')).toContain('Reaction rule:')
  })

  it('reads stdin, reports violations, exits 1', async () => {
    const io = capture()
    const code = await runCli(['--thread'], {
      ...io,
      readStdin: async () => '👍 — keep it out of this RFC.',
    })
    expect(code).toBe(1)
    expect(io.lines.join('\n')).toContain('violation(s)')
    expect(io.lines.join('\n')).toContain('gatekeeping')
  })

  it('reads a file argument and passes a clean draft', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'comment-voice-'))
    const file = path.join(dir, 'draft.md')
    writeFileSync(file, '👍 - resolved at head.')
    const io = capture()
    expect(await runCli(['--thread', file], io)).toBe(0)
    expect(io.lines.at(-1)).toBe('clean')
  })

  it('falls back to reading process.stdin when no reader is injected', async () => {
    const { PassThrough } = await import('node:stream')
    const fake = new PassThrough()
    const orig = Object.getOwnPropertyDescriptor(process, 'stdin')
    Object.defineProperty(process, 'stdin', { value: fake, configurable: true })
    try {
      const io = capture()
      const pending = runCli(['--thread'], io)
      fake.write('👍 - resolved at head.')
      fake.end()
      expect(await pending).toBe(0)
      expect(io.lines.at(-1)).toBe('clean')
    } finally {
      if (orig) {
        Object.defineProperty(process, 'stdin', orig)
      }
    }
  })

  it('a clean draft gets a copy line before the verdict (pbcopy fallback)', async () => {
    const saved = process.env['NO_HYPERLINK']
    process.env['NO_HYPERLINK'] = '1'
    try {
      const io = capture()
      const code = await runCli(['--thread'], {
        ...io,
        readStdin: async () => '👍 - resolved at head.',
      })
      expect(code).toBe(0)
      expect(io.lines.at(-2)).toMatch(/^copy: pbcopy < .*draft\.md$/)
      expect(io.lines.at(-1)).toBe('clean')
    } finally {
      if (saved === undefined) {
        delete process.env['NO_HYPERLINK']
      } else {
        process.env['NO_HYPERLINK'] = saved
      }
    }
  })

  it('renders the click-to-copy link where hyperlinks are supported', async () => {
    const saved = process.env['FORCE_HYPERLINK']
    process.env['FORCE_HYPERLINK'] = '1'
    try {
      const io = capture()
      const code = await runCli(['--thread'], {
        ...io,
        readStdin: async () => '👍 - resolved at head.',
      })
      expect(code).toBe(0)
      expect(io.lines.at(-2)).toContain('x-socketsecurity--fleet://copy?text=')
    } finally {
      if (saved === undefined) {
        delete process.env['FORCE_HYPERLINK']
      } else {
        process.env['FORCE_HYPERLINK'] = saved
      }
    }
  })

  it('violations get no copy line', async () => {
    const io = capture()
    const code = await runCli(['--thread'], {
      ...io,
      readStdin: async () => '👍 — keep it out of this RFC.',
    })
    expect(code).toBe(1)
    expect(io.lines.join('\n')).not.toContain('copy:')
  })

  it('warnings alone still exit 0', async () => {
    const io = capture()
    const code = await runCli(['--thread'], {
      ...io,
      readStdin: async () => '👍 - one. Two here. Three here. Four here.',
    })
    expect(code).toBe(0)
    expect(io.lines.at(-1)).toBe('\nclean (warnings only)')
  })
})
