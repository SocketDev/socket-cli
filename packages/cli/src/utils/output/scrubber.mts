/**
 * Stdout scrubber for mixed child-process output under machine mode.
 *
 * Child processes we spawn — coana, sfw-wrapped package managers, synp,
 * zpm, cdxgen, and friends — produce streams that interleave payload
 * bytes with progress bars, status lines, ANSI escapes, and other
 * chatter. This Transform stream splits its input on newlines, cleans
 * each line, and routes it via a two-state machine:
 *
 *   Outside a payload block (default):
 *     1. If the line is exactly SENTINEL_BEGIN → enter payload block.
 *     2. If the adapter (if any) has a verdict → honor it.
 *     3. Empty line → drop.
 *     4. Known noise pattern → stderr.
 *     5. Valid JSON (tried via JSON.parse) → stdout.
 *     6. Otherwise → stderr (safe default; stdout stays payload-only).
 *
 *   Inside a payload block:
 *     1. If the line is exactly SENTINEL_END → exit payload block.
 *     2. Otherwise → stdout verbatim (preserves multi-line payloads
 *        like pretty-printed JSON or Markdown).
 *
 * SENTINEL_BEGIN / SENTINEL_END each start and end with a literal NUL
 * (U+0000) byte — see mode.mts. A NUL byte does not appear in JSON,
 * Markdown, or plain text our formatters emit, so a cooperating child
 * tool cannot accidentally produce a line that matches one.
 *
 * Every line has BOM, trailing \r, and every ANSI escape (SGR, CSI
 * cursor moves, OSC hyperlinks) stripped before classification.
 *
 * Tracing: set SOCKET_SCRUB_TRACE=1 to write per-line classification
 * decisions to process.stderr (a dedicated channel, not the configured
 * stderr sink — so trace output doesn't mingle with the routed noise
 * stream). Useful when debugging "why did my JSON lose a line?".
 *
 * Architecture note: inspired by jc (github.com/kellyjonbrazil/jc).
 * Each tool with known quirks gets a small adapter (utils/output/
 * adapters/) that plugs into the classifier — no heuristic engine, no
 * framework. Unlike jc, runs in real time on mixed streams rather than
 * post-hoc on a captured blob.
 */

import { Transform } from 'node:stream'

import { ansiRegex } from '@socketsecurity/lib/ansi'

import { SENTINEL_BEGIN, SENTINEL_END } from './mode.mts'

import type { TransformCallback } from 'node:stream'

/**
 * Memoized ansi regex. Built once at module load; re-used per line.
 * ansiRegex() from @socketsecurity/lib constructs a fresh regex on
 * every call, and cleanLine runs on every incoming line — so caching
 * here matters.
 */
const ANSI_RE = ansiRegex()

/**
 * Per-line regex for common chatter we always send to stderr.
 * Matches log-level prefixes, status markers, cargo/rust tool chatter,
 * ISO-8601 timestamps at start of line, and progress/spinner glyphs.
 * Lowercase variants included (cargo uses `warning:` / `error:`).
 */
const KNOWN_NOISE_RE = new RegExp(
  [
    '^\\s*(?:',
    // Bracketed log levels: [INFO], [WARN], [error], etc.
    '\\[(?:info|warn|warning|error|debug|trace)\\]',
    // npm's standard stderr prefixes.
    '|npm\\s+(?:notice|warn|err!?)',
    // Uppercase log prefixes.
    '|(?:WARNING|ERROR|INFO|DEBUG|TRACE|FATAL):',
    // Lowercase log prefixes (rust/cargo style).
    '|(?:warning|error|note|help):',
    // Homebrew / Rust / make-style arrows.
    '|==>|-->|\\*\\*\\*',
    // Cargo status verbs.
    '|(?:Compiling|Checking|Finished|Running|Downloading|Downloaded|Updating|Building|Fresh|Installing|Uninstalling|Packaging|Removing|Verifying|Preparing)\\s',
    // ISO 8601 timestamps.
    '|\\d{4}-\\d{2}-\\d{2}[T\\s]\\d{2}:\\d{2}:\\d{2}',
    // Progress/spinner/bullet glyphs followed by a space.
    '|[✓✔✗✘✖⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏◐◓◑◒→←↑↓·∙●○◉►▶◆◇■□▪▫]+\\s',
    ')',
  ].join(''),
  'i',
)

export interface ScrubberAdapter {
  /**
   * Short identifier used in trace output prefixes. Must not contain
   * whitespace. Purely informational.
   */
  name: string
  /**
   * Invoked before the default classifier while the scrubber is
   * outside a payload block. Return 'payload' to route to stdout,
   * 'drop' to discard, 'noise' to route to stderr, or undefined to
   * defer to the default classifier.
   */
  classify?(line: string): 'payload' | 'drop' | 'noise' | undefined
}

export interface ScrubberOptions {
  adapter?: ScrubberAdapter | undefined
  /**
   * Soft cap on internal buffer size, measured in UTF-16 code units
   * (string .length). When exceeded, a one-time warning is written to
   * the stderr sink. The scrubber continues to buffer — callers
   * concerned about memory must cap the upstream stream themselves.
   */
  maxBufferChars?: number | undefined
  /**
   * Sink for payload lines (default: process.stdout).
   */
  stdout?: NodeJS.WritableStream | undefined
  /**
   * Sink for chatter (default: process.stderr).
   */
  stderr?: NodeJS.WritableStream | undefined
}

/**
 * Clean a single line:
 *   1. Strip leading BOM.
 *   2. Strip a single trailing \r (CRLF line terminator artifact).
 *   3. If the remaining line still contains \r bytes (progress-bar
 *      same-line overwrite: "\rline1\rline2"), keep only the segment
 *      after the last \r — that's the final rendered state.
 *   4. Strip every ANSI escape (SGR, CSI cursor moves, OSC hyperlinks).
 */
function cleanLine(line: string): string {
  let cleaned = line
  if (cleaned.charCodeAt(0) === 0xfeff) {
    cleaned = cleaned.slice(1)
  }
  if (cleaned.endsWith('\r')) {
    cleaned = cleaned.slice(0, -1)
  }
  if (cleaned.includes('\r')) {
    // Overwrite semantics: render only the last segment.
    const lastCr = cleaned.lastIndexOf('\r')
    cleaned = cleaned.slice(lastCr + 1)
  }
  return cleaned.replace(ANSI_RE, '')
}

function isTraceEnabled(): boolean {
  return process.env['SOCKET_SCRUB_TRACE'] === '1'
}

/**
 * Trace writes go to process.stderr directly (not through the
 * scrubber's configured stderr sink) so trace lines don't interleave
 * with the routed noise stream. This matters when a caller pipes the
 * scrubber's stderr into a buffer for later inspection.
 */
function trace(
  adapterName: string | undefined,
  verdict: string,
  line: string,
): void {
  if (isTraceEnabled()) {
    const prefix = adapterName ? `${adapterName}:${verdict}` : verdict
    process.stderr.write(`[scrub ${prefix}] ${line}\n`)
  }
}

/**
 * Classify a cleaned line under the outside-block state.
 */
export function classifyLine(
  line: string,
  adapter: ScrubberAdapter | undefined,
): 'payload' | 'drop' | 'noise' {
  const adapterVerdict = adapter?.classify?.(line)
  if (adapterVerdict) {
    return adapterVerdict
  }
  const trimmed = line.trim()
  if (!trimmed) {
    return 'drop'
  }
  if (KNOWN_NOISE_RE.test(line)) {
    return 'noise'
  }
  // Widest JSON detection: anything JSON.parse accepts is payload.
  // Catches objects, arrays, standalone numbers, strings, booleans,
  // null — the full JSON grammar — without a shape check that misses
  // valid primitives.
  try {
    JSON.parse(trimmed)
    return 'payload'
  } catch {
    return 'noise'
  }
}

/**
 * Build a Transform stream that splits its input on newlines, cleans
 * each line, and routes via the outside/inside state machine. Feed
 * child-process stdout in; the stream emits nothing (writes happen
 * to the configured sinks). On stream end, any unterminated trailing
 * line is processed the same way.
 */
export function createScrubber(options: ScrubberOptions = {}): Transform {
  const {
    adapter,
    maxBufferChars = 100 * 1024 * 1024,
    stderr = process.stderr,
    stdout = process.stdout,
  } = options

  let buffer = ''
  let inside = false
  let overflowWarned = false

  function processOneLine(raw: string): void {
    const cleaned = cleanLine(raw)
    if (inside) {
      if (cleaned === SENTINEL_END) {
        inside = false
        trace(adapter?.name, 'sentinel-end', cleaned)
        return
      }
      stdout.write(`${cleaned}\n`)
      trace(adapter?.name, 'block-payload', cleaned)
      return
    }
    if (cleaned === SENTINEL_BEGIN) {
      inside = true
      trace(adapter?.name, 'sentinel-begin', cleaned)
      return
    }
    const verdict = classifyLine(cleaned, adapter)
    switch (verdict) {
      case 'payload': {
        stdout.write(`${cleaned}\n`)
        trace(adapter?.name, 'payload', cleaned)
        break
      }
      case 'drop': {
        trace(adapter?.name, 'drop', cleaned)
        break
      }
      case 'noise': {
        stderr.write(`${cleaned}\n`)
        trace(adapter?.name, 'noise', cleaned)
        break
      }
    }
  }

  function flushLines(rest: string): string {
    const lines = rest.split('\n')
    const tail = lines.pop() ?? ''
    for (const raw of lines) {
      processOneLine(raw)
    }
    return tail
  }

  return new Transform({
    transform(
      chunk: Buffer | string,
      _encoding: BufferEncoding,
      done: TransformCallback,
    ): void {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      buffer += text
      if (!overflowWarned && buffer.length > maxBufferChars) {
        overflowWarned = true
        stderr.write(
          '[socket scrubber] input exceeded soft buffer cap; ' +
            'scrubbing continues without fallback\n',
        )
      }
      buffer = flushLines(buffer)
      done()
    },
    flush(done: TransformCallback): void {
      if (buffer) {
        processOneLine(buffer)
        buffer = ''
      }
      // If the stream ended with an open block (begin without end),
      // warn so callers can spot a truncated/killed child process.
      if (inside) {
        stderr.write(
          '[socket scrubber] stream ended inside an unclosed payload block\n',
        )
        inside = false
      }
      trace(adapter?.name, 'flush', '')
      done()
    },
  })
}
