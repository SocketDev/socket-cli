/**
 * Payload emission for socket-cli commands.
 *
 * Under machine-output mode (--json, --markdown, or --quiet) the
 * payload is emitted as three log calls — SENTINEL_BEGIN on its own
 * line, the payload body, SENTINEL_END on its own line. This block
 * structure lets the scrubber extract multi-line payloads (pretty-
 * printed JSON, Markdown reports) unambiguously: once it sees BEGIN,
 * every subsequent line is payload verbatim until END.
 *
 * In human mode, the payload writes via logger.log with no wrapping.
 *
 * Use emitPayload() / emitJsonPayload() at the end of output-*
 * functions instead of calling logger.log(JSON.stringify(...))
 * directly.
 */

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import {
  isMachineOutputMode,
  SENTINEL_BEGIN,
  SENTINEL_END,
} from './mode.mts'

import type { MachineModeFlags } from './mode.mts'

const logger = getDefaultLogger()

export interface EmitPayloadOptions {
  flags: MachineModeFlags
}

export function emitPayload(
  payload: string,
  options: EmitPayloadOptions,
): void {
  // logger.log appends its own \n, so strip ONE trailing newline from
  // the payload to avoid a doubled \n. Applied in both modes so the
  // output is consistent regardless of mode.
  const normalized = payload.endsWith('\n') ? payload.slice(0, -1) : payload
  if (isMachineOutputMode(options.flags)) {
    logger.log(SENTINEL_BEGIN)
    logger.log(normalized)
    logger.log(SENTINEL_END)
  } else {
    logger.log(normalized)
  }
}

export function emitJsonPayload(
  value: unknown,
  options: EmitPayloadOptions,
): void {
  // JSON.stringify(undefined) returns undefined, which logs as the
  // literal string "undefined" — serialize as null instead so we
  // always emit syntactically valid JSON.
  const serialized = JSON.stringify(value) ?? 'null'
  emitPayload(serialized, options)
}
