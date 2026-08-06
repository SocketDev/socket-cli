#!/usr/bin/env node
/*
 * @file Put one `x-wh-gate://fill?phrase=…` payload on the clipboard — the
 *   whole body of the click-to-copy handler, so each OS contributes only a
 *   URL-scheme registration that runs `node <this script> <url>`.
 *
 *   Everything portable lives here on purpose. The macOS applet was doing three
 *   jobs in AppleScript (prefix check, decode, clipboard), none of which port,
 *   and a Linux `.desktop` or a Windows registry shim would have had to reimplement
 *   all three. Parsing and decoding are plain JS; only the clipboard command is
 *   per-platform, and that is one table below.
 *
 *   `decodeURIComponent` is the exact inverse of the `encodeURIComponent` that
 *   `gateFillUrl` builds the URL with, so the pair round-trips a phrase byte for
 *   byte. The earlier python `unquote_plus` decoded a BARE `+` to a space;
 *   `encodeURIComponent` never emits one (a literal `+` becomes `%2B`), so that
 *   was a tolerated asymmetry rather than a bug, but pairing the halves removes
 *   the question. python is also absent from every non-macOS default image the
 *   fleet targets, which the inline one-liner assumed.
 *
 *   COPY, NEVER SUBMIT. A URL handler is invokable by ANY local process, so
 *   `open x-wh-gate://fill?phrase=…` from an agent is indistinguishable from a
 *   human click. Writing the clipboard cannot submit even in principle: it is
 *   inert until a human pastes AND confirms. That is why this script has no
 *   keystroke path and no newline in its output — a trailing newline on the
 *   clipboard would make the operator's paste submit the instant it landed.
 *
 *   The URL arrives as `argv[1]`, never interpolated into a shell string, so a
 *   phrase carrying quotes, `$(…)`, backticks, or pipes reaches this process as
 *   one opaque argument.
 *
 *   Usage: node scripts/fleet/gate-fill-decode.mts '<x-wh-gate://fill?phrase=…>'
 *          node scripts/fleet/gate-fill-decode.mts --print '<url>'   (stdout, no clipboard)
 */

import process from 'node:process'

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { isMainModule } from './_shared/is-main-module.mts'
import { runMain } from './_shared/run-main.mts'
import { FILL_ACTION, GATE_URL_SCHEME } from './_shared/terminal-link.mts'

import type { ScriptMeta } from './_shared/run-main.mts'

/**
 * The clipboard writer per platform, as `[binary, ...args]`. The phrase goes in
 * on stdin so it never becomes an argv entry a process list could leak.
 *
 * Linux ships two: Wayland's `wl-copy` is tried first because a Wayland session
 * usually has no X11 clipboard for `xclip` to reach, while `xclip` still works
 * under XWayland when it is present.
 */
export const CLIPBOARD_COMMANDS: Readonly<
  Record<string, ReadonlyArray<readonly string[]>>
> = {
  darwin: [['pbcopy']],
  linux: [
    ['wl-copy'],
    ['xclip', '-selection', 'clipboard'],
    ['xsel', '--clipboard', '--input'],
  ],
  win32: [['clip.exe']],
}

/**
 * The prefix a fill URL must start with.
 */
export function gateFillPrefix(): string {
  return `${GATE_URL_SCHEME}://${FILL_ACTION}?phrase=`
}

/**
 * The decoded phrase from a full fill URL, or undefined when the URL is not a
 * fill URL, carries no payload, or is malformed percent-encoding.
 *
 * `decodeURIComponent` throws `URIError` on a stray `%` or a truncated `%A`,
 * which is a bad URL rather than a bad phrase — answering undefined lets the
 * caller copy nothing instead of surfacing a stack trace at a click.
 */
export function decodeGateFillPhrase(
  url: string | undefined,
): string | undefined {
  if (url === undefined) {
    return undefined
  }
  const prefix = gateFillPrefix()
  // A bare payload is accepted too, so the pure decode stays testable without
  // rebuilding a URL, and so a shim can pass either shape.
  const encoded = url.startsWith(prefix) ? url.slice(prefix.length) : url
  if (encoded.length === 0 || encoded.includes('://')) {
    return undefined
  }
  let decoded: string
  try {
    decoded = decodeURIComponent(encoded)
  } catch {
    return undefined
  }
  return decoded.length > 0 ? decoded : undefined
}

/**
 * Write `phrase` to the OS clipboard. True when a writer accepted it.
 *
 * Linux gets several candidates because which one exists depends on the session
 * type; the first that runs wins. An unknown platform answers false rather than
 * guessing at a binary.
 */
export function copyToClipboard(
  phrase: string,
  platform: string = process.platform,
): boolean {
  const candidates = CLIPBOARD_COMMANDS[platform] ?? []
  for (let i = 0, { length } = candidates; i < length; i += 1) {
    const [binary, ...args] = candidates[i]!
    try {
      const result = spawnSync(binary!, args, {
        input: phrase,
        stdio: ['pipe', 'ignore', 'ignore'],
      })
      if (result.status === 0) {
        return true
      }
    } catch {
      // Binary absent on this box; try the next candidate.
    }
  }
  return false
}

export function main(argv: readonly string[] = process.argv.slice(2)): number {
  const printOnly = argv[0] === '--print'
  const phrase = decodeGateFillPhrase(printOnly ? argv[1] : argv[0])
  if (phrase === undefined) {
    return 1
  }
  if (printOnly) {
    // No trailing newline: see the @file header.
    process.stdout.write(phrase)
    return 0
  }
  return copyToClipboard(phrase) ? 0 : 1
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'put an x-wh-gate://fill phrase on the clipboard for the click-to-copy handler',
  help: `Usage: node scripts/fleet/gate-fill-decode.mts '<x-wh-gate://fill?phrase=…>'
       node scripts/fleet/gate-fill-decode.mts --print '<url>'

Decodes the phrase and writes it to the OS clipboard (pbcopy / wl-copy / xclip /
xsel / clip.exe). --print writes it to stdout instead, with no trailing newline,
so a paste cannot submit itself. Exits 1 on a malformed payload or when no
clipboard writer is available, copying nothing.`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
