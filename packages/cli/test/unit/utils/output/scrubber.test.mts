import { describe, expect, it } from 'vitest'
import { Writable } from 'node:stream'

import {
  SENTINEL_BEGIN,
  SENTINEL_END,
} from '../../../../src/utils/output/mode.mts'
import {
  classifyLine,
  createScrubber,
} from '../../../../src/utils/output/scrubber.mts'

import type { ScrubberAdapter } from '../../../../src/utils/output/scrubber.mts'

class BufferedSink extends Writable {
  chunks: string[] = []
  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    cb: (err?: Error | null) => void,
  ): void {
    this.chunks.push(
      typeof chunk === 'string' ? chunk : chunk.toString('utf8'),
    )
    cb()
  }
  get contents(): string {
    return this.chunks.join('')
  }
}

function pipeThroughScrubber(
  input: string,
  opts?: { adapter?: ScrubberAdapter },
): Promise<{ stdout: string; stderr: string }> {
  const stdout = new BufferedSink()
  const stderr = new BufferedSink()
  const scrubber = createScrubber({
    adapter: opts?.adapter,
    stdout,
    stderr,
  })
  return new Promise((resolve, reject) => {
    scrubber.on('error', reject)
    scrubber.on('finish', () => {
      resolve({ stdout: stdout.contents, stderr: stderr.contents })
    })
    scrubber.end(input)
  })
}

describe('classifyLine', () => {
  it('classifies whitespace-only lines as drop', () => {
    expect(classifyLine('', undefined)).toBe('drop')
    expect(classifyLine('   ', undefined)).toBe('drop')
    expect(classifyLine('\t', undefined)).toBe('drop')
  })

  it('classifies single-line JSON object as payload', () => {
    expect(classifyLine('{"foo":"bar"}', undefined)).toBe('payload')
    expect(classifyLine('  {"x":1}  ', undefined)).toBe('payload')
  })

  it('classifies single-line JSON array as payload', () => {
    expect(classifyLine('[1,2,3]', undefined)).toBe('payload')
    expect(classifyLine('[]', undefined)).toBe('payload')
  })

  it('classifies standalone JSON primitives as payload', () => {
    // Widened detection: any JSON.parse-valid line is payload.
    expect(classifyLine('42', undefined)).toBe('payload')
    expect(classifyLine('-3.14', undefined)).toBe('payload')
    expect(classifyLine('"hello"', undefined)).toBe('payload')
    expect(classifyLine('true', undefined)).toBe('payload')
    expect(classifyLine('false', undefined)).toBe('payload')
    expect(classifyLine('null', undefined)).toBe('payload')
  })

  it('classifies invalid JSON-shaped lines as noise', () => {
    expect(classifyLine('{incomplete', undefined)).toBe('noise')
    expect(classifyLine('{ "x": }', undefined)).toBe('noise')
  })

  it('classifies bracketed log prefixes as noise', () => {
    expect(classifyLine('[INFO] starting', undefined)).toBe('noise')
    expect(classifyLine('[warn] deprecated', undefined)).toBe('noise')
    expect(classifyLine('[ERROR] broke', undefined)).toBe('noise')
  })

  it('classifies npm chatter as noise', () => {
    expect(classifyLine('npm notice package tarball', undefined)).toBe(
      'noise',
    )
    expect(classifyLine('npm warn deprecated', undefined)).toBe('noise')
    expect(classifyLine('npm err! missing script', undefined)).toBe('noise')
  })

  it('classifies lowercase log prefixes as noise (rust/cargo style)', () => {
    expect(classifyLine('warning: unused variable', undefined)).toBe(
      'noise',
    )
    expect(classifyLine('error: expected ;', undefined)).toBe('noise')
    expect(classifyLine('note: defined here', undefined)).toBe('noise')
    expect(classifyLine('help: try adding a type', undefined)).toBe('noise')
  })

  it('classifies cargo status verbs as noise', () => {
    expect(classifyLine('    Compiling serde v1.0.0', undefined)).toBe(
      'noise',
    )
    expect(classifyLine('    Finished dev [unoptimized]', undefined)).toBe(
      'noise',
    )
    expect(classifyLine('  Downloading crates ...', undefined)).toBe('noise')
    expect(classifyLine('   Running `cargo build`', undefined)).toBe('noise')
  })

  it('classifies Homebrew/Rust arrows as noise', () => {
    expect(classifyLine('==> Installing foo', undefined)).toBe('noise')
    expect(classifyLine('--> compiler note', undefined)).toBe('noise')
  })

  it('classifies ISO 8601 timestamps as noise', () => {
    expect(classifyLine('2026-04-21T13:45:00 starting', undefined)).toBe(
      'noise',
    )
    expect(classifyLine('2026-04-21 13:45:00 did thing', undefined)).toBe(
      'noise',
    )
  })

  it('classifies progress glyphs as noise', () => {
    expect(classifyLine('✓ done', undefined)).toBe('noise')
    expect(classifyLine('⠋ fetching', undefined)).toBe('noise')
    expect(classifyLine('► step 1', undefined)).toBe('noise')
  })

  it('classifies free text as noise (safe default)', () => {
    expect(classifyLine('Hello world', undefined)).toBe('noise')
    expect(classifyLine('Installing packages...', undefined)).toBe('noise')
  })

  it('honors adapter override for payload', () => {
    const adapter: ScrubberAdapter = {
      classify: line => (line === 'custom payload' ? 'payload' : undefined),
      name: 'test',
    }
    expect(classifyLine('custom payload', adapter)).toBe('payload')
  })

  it('honors adapter override for drop', () => {
    const adapter: ScrubberAdapter = {
      classify: line => (line.startsWith('DROP:') ? 'drop' : undefined),
      name: 'test',
    }
    expect(classifyLine('DROP: this line', adapter)).toBe('drop')
  })
})

describe('createScrubber — outside block', () => {
  it('routes NDJSON lines to stdout', async () => {
    const { stderr, stdout } = await pipeThroughScrubber(
      '{"a":1}\n{"b":2}\n',
    )
    expect(stdout).toBe('{"a":1}\n{"b":2}\n')
    expect(stderr).toBe('')
  })

  it('routes noise to stderr', async () => {
    const { stderr, stdout } = await pipeThroughScrubber(
      'Fetching packages...\n[INFO] starting\n',
    )
    expect(stdout).toBe('')
    expect(stderr).toContain('Fetching packages')
    expect(stderr).toContain('[INFO] starting')
  })

  it('strips ANSI escapes before classification', async () => {
    const ansiJson = '\x1b[32m{"ok":true}\x1b[0m\n'
    const { stdout } = await pipeThroughScrubber(ansiJson)
    expect(stdout.trim()).toBe('{"ok":true}')
  })

  it('strips cursor-move and OSC sequences from progress bars', async () => {
    // Progress bar with a CSI cursor-up + clear-line sequence.
    const input = '\x1b[1A\x1b[2K{"done":true}\n'
    const { stdout } = await pipeThroughScrubber(input)
    expect(stdout.trim()).toBe('{"done":true}')
  })

  it('strips BOM at the start of input', async () => {
    const bomJson = '﻿{"ok":true}\n'
    const { stdout } = await pipeThroughScrubber(bomJson)
    expect(stdout.trim()).toBe('{"ok":true}')
  })

  it('strips trailing \\r from CRLF input', async () => {
    const crlfInput = '{"crlf":true}\r\n[INFO] done\r\n'
    const { stderr, stdout } = await pipeThroughScrubber(crlfInput)
    expect(stdout).toBe('{"crlf":true}\n')
    // \r should NOT leak into the routed output.
    expect(stdout.includes('\r')).toBe(false)
    expect(stderr.includes('\r')).toBe(false)
  })

  it('renders only the final segment of a \\r-overwriting line', async () => {
    // Progress bar that rewrites the same line before advancing.
    // After \r-rendering the line is ": final".
    const input =
      'Downloading 10%\rDownloading 50%\rDownloading 90%\r{"done":true}\n'
    const { stdout } = await pipeThroughScrubber(input)
    expect(stdout).toBe('{"done":true}\n')
  })

  it('warns when buffer exceeds soft cap but continues scrubbing', async () => {
    const stdout = new BufferedSink()
    const stderr = new BufferedSink()
    const scrubber = createScrubber({
      maxBufferChars: 64,
      stderr,
      stdout,
    })
    // Feed chunks totaling more than the cap without a newline for a
    // while, then flush with actual content.
    scrubber.write('x'.repeat(100))
    scrubber.write('\n{"after":true}\n')
    await new Promise<void>(resolve => {
      scrubber.on('finish', resolve)
      scrubber.end()
    })
    expect(stderr.contents).toContain('exceeded soft buffer cap')
    expect(stdout.contents).toBe('{"after":true}\n')
  })

  it('drops empty lines rather than routing them', async () => {
    const { stderr, stdout } = await pipeThroughScrubber('\n\n{"a":1}\n\n')
    expect(stdout).toBe('{"a":1}\n')
    expect(stderr).toBe('')
  })

  it('flushes tail line without trailing newline', async () => {
    const { stdout } = await pipeThroughScrubber('{"tail":1}')
    expect(stdout.trim()).toBe('{"tail":1}')
  })

  it('handles partial lines across chunks', async () => {
    const stdout = new BufferedSink()
    const stderr = new BufferedSink()
    const scrubber = createScrubber({ stderr, stdout })
    scrubber.write('{"par')
    scrubber.write('tial":')
    scrubber.write('true}\n')
    scrubber.write('{"second":1}\n')
    await new Promise<void>(resolve => {
      scrubber.on('finish', resolve)
      scrubber.end()
    })
    expect(stdout.contents).toBe('{"partial":true}\n{"second":1}\n')
  })
})

describe('createScrubber — sentinel block state machine', () => {
  it('extracts single-line payload between sentinels', async () => {
    const input =
      'before\n' +
      `${SENTINEL_BEGIN}\n` +
      '{"inside":true}\n' +
      `${SENTINEL_END}\n` +
      'after\n'
    const { stderr, stdout } = await pipeThroughScrubber(input)
    expect(stdout).toBe('{"inside":true}\n')
    expect(stderr).toContain('before')
    expect(stderr).toContain('after')
  })

  it('extracts multi-line payload verbatim (pretty-printed JSON)', async () => {
    const pretty = '{\n  "a": 1,\n  "b": [1, 2, 3]\n}'
    const input =
      'noise before\n' +
      `${SENTINEL_BEGIN}\n` +
      `${pretty}\n` +
      `${SENTINEL_END}\n` +
      'noise after\n'
    const { stderr, stdout } = await pipeThroughScrubber(input)
    // Payload comes out verbatim with newlines intact.
    expect(stdout).toBe(`${pretty}\n`)
    // Critically: the payload itself contains `{` and `}` and
    // newlines, but the state machine forwards everything between
    // sentinels without reclassifying.
    expect(JSON.parse(stdout.trim())).toEqual({ a: 1, b: [1, 2, 3] })
    expect(stderr).toContain('noise before')
    expect(stderr).toContain('noise after')
  })

  it('extracts multi-line markdown payload', async () => {
    const md = '# Report\n\n- item 1\n- item 2\n'
    const input = `${SENTINEL_BEGIN}\n${md}${SENTINEL_END}\ntrailing chatter\n`
    const { stderr, stdout } = await pipeThroughScrubber(input)
    expect(stdout).toBe(md)
    expect(stderr).toContain('trailing chatter')
  })

  it('forwards EVERY line inside a block verbatim, even ones that look like noise', async () => {
    // Inside a block we must not re-classify — the payload is the
    // payload, even if a line inside resembles a log prefix.
    const input =
      `${SENTINEL_BEGIN}\n` +
      '[INFO] this line is PART OF THE PAYLOAD\n' +
      `${SENTINEL_END}\n`
    const { stderr, stdout } = await pipeThroughScrubber(input)
    expect(stdout).toBe('[INFO] this line is PART OF THE PAYLOAD\n')
    expect(stderr).toBe('')
  })

  it('warns on unclosed block at stream end', async () => {
    const input = `noise\n${SENTINEL_BEGIN}\n{"cut":true}\n`
    const { stderr, stdout } = await pipeThroughScrubber(input)
    // The partial payload was forwarded to stdout as it arrived.
    expect(stdout).toBe('{"cut":true}\n')
    // Stream-end warning on stderr.
    expect(stderr).toContain('unclosed payload block')
  })

  it('handles back-to-back blocks', async () => {
    const input =
      `${SENTINEL_BEGIN}\n` +
      '{"first":1}\n' +
      `${SENTINEL_END}\n` +
      `${SENTINEL_BEGIN}\n` +
      '{"second":2}\n' +
      `${SENTINEL_END}\n`
    const { stdout } = await pipeThroughScrubber(input)
    expect(stdout).toBe('{"first":1}\n{"second":2}\n')
  })

  it('strips ANSI from sentinel line before matching', async () => {
    // A sentinel line wrapped in ANSI color should still be recognized.
    const input =
      `\x1b[2m${SENTINEL_BEGIN}\x1b[0m\n` +
      '{"x":1}\n' +
      `\x1b[2m${SENTINEL_END}\x1b[0m\n`
    const { stdout } = await pipeThroughScrubber(input)
    expect(stdout).toBe('{"x":1}\n')
  })
})

describe('createScrubber — adapter integration', () => {
  it('applies adapter verdict outside blocks', async () => {
    const adapter: ScrubberAdapter = {
      classify: line =>
        line.startsWith('Created ') ? 'drop' : undefined,
      name: 'synp',
    }
    const { stderr, stdout } = await pipeThroughScrubber(
      'Created package-lock.json\n{"payload":true}\n',
      { adapter },
    )
    expect(stdout.trim()).toBe('{"payload":true}')
    expect(stderr).not.toContain('Created')
  })

  it('does NOT apply adapter inside a sentinel block', async () => {
    // Inside a payload block, adapter verdicts are ignored — the
    // whole point of the block is "this is payload, don't classify".
    const adapter: ScrubberAdapter = {
      classify: () => 'drop',
      name: 'aggressive',
    }
    const input =
      `${SENTINEL_BEGIN}\n` +
      'this would be dropped by the adapter\n' +
      `${SENTINEL_END}\n`
    const { stdout } = await pipeThroughAdapter(input, adapter)
    expect(stdout).toBe('this would be dropped by the adapter\n')
  })
})

async function pipeThroughAdapter(
  input: string,
  adapter: ScrubberAdapter,
): Promise<{ stdout: string; stderr: string }> {
  return pipeThroughScrubber(input, { adapter })
}
