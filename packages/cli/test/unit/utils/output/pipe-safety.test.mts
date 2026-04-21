/**
 * Pipe-safety integration tests.
 *
 * Simulates the full machine-mode pipeline: a command emits a payload
 * via emitPayload() (block-sentinel-wrapped under --json), that
 * output + arbitrary child chatter is piped through the scrubber.
 * Asserts that what reaches stdout is exactly the payload — nothing
 * more, nothing less.
 *
 * This is what `socket <cmd> --json | jq` actually needs: no trailing
 * text, no ANSI, no prefix, valid JSON.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Readable, Writable } from 'node:stream'

const stdoutLines: string[] = []
const stderrLines: string[] = []

vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => ({
    log: (...args: unknown[]) => {
      stdoutLines.push(args.map(String).join(' '))
    },
    error: (...args: unknown[]) => {
      stderrLines.push(args.map(String).join(' '))
    },
  }),
}))

const { emitJsonPayload, emitPayload } = await import(
  '../../../../src/utils/output/emit-payload.mts'
)
const { createScrubber } = await import(
  '../../../../src/utils/output/scrubber.mts'
)

class Sink extends Writable {
  buffer = ''
  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    cb: (err?: Error | null) => void,
  ): void {
    this.buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    cb()
  }
}

/**
 * Take the captured stdoutLines (what emitPayload wrote) plus any
 * extra child-stdout chatter, concatenate as lines, pipe through the
 * scrubber, and return the scrubbed stdout / stderr.
 */
async function scrubCapturedOutput(
  childChatterBefore: string[] = [],
  childChatterAfter: string[] = [],
): Promise<{ stdout: string; stderr: string }> {
  const allLines = [
    ...childChatterBefore,
    ...stdoutLines,
    ...childChatterAfter,
  ]
  const combined = allLines.length ? allLines.join('\n') + '\n' : ''
  const stdout = new Sink()
  const stderr = new Sink()
  const scrubber = createScrubber({ stderr, stdout })
  await new Promise<void>((resolve, reject) => {
    scrubber.on('error', reject)
    scrubber.on('finish', () => resolve())
    Readable.from([combined]).pipe(scrubber)
  })
  return { stdout: stdout.buffer, stderr: stderr.buffer }
}

describe('pipe safety', () => {
  beforeEach(() => {
    stdoutLines.length = 0
    stderrLines.length = 0
  })

  it('--json single-line payload round-trips cleanly', async () => {
    emitJsonPayload(
      { status: 'ok', count: 42 },
      { flags: { json: true } },
    )

    const { stdout } = await scrubCapturedOutput()
    const parsed = JSON.parse(stdout.trim())
    expect(parsed).toEqual({ status: 'ok', count: 42 })
  })

  it('--json multi-line (pretty-printed) payload round-trips', async () => {
    // emitPayload accepts a pre-formatted multi-line string; the
    // sentinel block protects it from re-classification.
    const pretty = JSON.stringify(
      { a: 1, b: [1, 2, 3] },
      null,
      2,
    )
    emitPayload(pretty, { flags: { json: true } })

    const { stdout } = await scrubCapturedOutput()
    expect(JSON.parse(stdout.trim())).toEqual({ a: 1, b: [1, 2, 3] })
  })

  it('--markdown multi-line payload round-trips verbatim', async () => {
    const md = '# Report\n\n- item 1\n- item 2\n'
    emitPayload(md, { flags: { markdown: true } })

    const { stdout } = await scrubCapturedOutput()
    expect(stdout).toBe(md)
  })

  it('sentinel block survives interleaved child chatter', async () => {
    emitJsonPayload({ result: 'yes' }, { flags: { json: true } })

    const { stderr, stdout } = await scrubCapturedOutput(
      ['Fetching packages...', '[INFO] pre'],
      ['Install complete.', '[INFO] post'],
    )
    expect(JSON.parse(stdout.trim())).toEqual({ result: 'yes' })
    expect(stderr).toContain('Fetching packages')
    expect(stderr).toContain('Install complete')
  })

  it('human mode (no flags) does NOT wrap with sentinels', () => {
    emitPayload('plain text', { flags: {} })
    expect(stdoutLines).toEqual(['plain text'])
  })

  it('scrubber rescues clean JSON from noisy stream without sentinels', async () => {
    // Simulating a child process that emits raw JSON mixed with
    // chatter — no sentinels involved. The classifier handles it.
    const mixed =
      'npm notice pre-install\n' +
      '{"clean":true}\n' +
      '[INFO] post-install\n'
    const stdout = new Sink()
    const stderr = new Sink()
    const scrubber = createScrubber({ stderr, stdout })
    await new Promise<void>((resolve, reject) => {
      scrubber.on('error', reject)
      scrubber.on('finish', () => resolve())
      scrubber.end(mixed)
    })
    expect(JSON.parse(stdout.buffer.trim())).toEqual({ clean: true })
    expect(stderr.buffer).toContain('npm notice')
    expect(stderr.buffer).toContain('[INFO] post-install')
  })

  it('empty payload still produces valid JSON under --json', async () => {
    emitJsonPayload({}, { flags: { json: true } })
    const { stdout } = await scrubCapturedOutput()
    expect(JSON.parse(stdout.trim())).toEqual({})
  })

  it('NDJSON (multiple documents) passes through', async () => {
    // Some tools emit NDJSON without sentinels (yarn berry --json,
    // cargo --message-format=json). Each line is valid JSON on its
    // own; the classifier routes each to stdout.
    const ndjson =
      '{"event":"start"}\n{"event":"progress","pct":50}\n{"event":"done"}\n'
    const stdout = new Sink()
    const stderr = new Sink()
    const scrubber = createScrubber({ stderr, stdout })
    await new Promise<void>((resolve, reject) => {
      scrubber.on('error', reject)
      scrubber.on('finish', () => resolve())
      scrubber.end(ndjson)
    })
    expect(stdout.buffer).toBe(ndjson)
  })
})
