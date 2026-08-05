/*
 * @file The bait detector for `honeypot-echo-guard` — everything that decides
 *   whether a body carries honeypot content.
 *
 *   Three fingerprints are matched. A marker literal is a string that only
 *   appears inside a machine-addressed bait block. A bare-token body is a
 *   message whose entire content is one hex run, which is the exact reply the
 *   bait asks for. A twelve-hex token is a finding only once the corroboration
 *   tests agree it is not a legitimate commit citation.
 *
 *   Every body is matched twice, against the raw text and against a
 *   `normalizeForScan` copy, so padding a token with invisible characters does
 *   not slip it past the patterns.
 */

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { normalizeForScan } from '../_shared/evasion-normalize.mts'
import { findHoneypotTokens } from '../_shared/untrusted/honeypot-token.mts'
import {
  gitCanResolveObjects,
  isKnownGitCommit,
  tokenSeenInTranscript,
} from './token-corroboration.mts'

// This guard's own source + tests spell the marker strings it detects, so a
// message that names this directory is documentation about the guard rather
// than a honeypot echo. Marker findings stand down for such a payload; the
// token findings do not.
const SELF_DIR_RE = /\/honeypot-echo-guard\//

interface MarkerPattern {
  readonly label: string
  readonly re: RegExp
}

// Literals that only appear in a machine-addressed bait block. Written as
// patterns with `\s+` between words so a reflowed copy still matches.
const MARKER_PATTERNS: readonly MarkerPattern[] = [
  {
    label: 'honeypot marker literal',
    re: /agentscan-honeypot/i,
  },
  {
    label: 'machine-addressed comment marker',
    re: /message_for_llms/i,
  },
  {
    label: 'machine-addressed notice header',
    re: /\bnotice\s+for\s+automated\s+agents\b/i,
  },
]

// A body whose entire trimmed content is one run of 8-32 hex characters — the
// exact reply the bait asks for.
const BARE_TOKEN_BODY_RE = /^[0-9a-f]{8,32}$/i

/**
 * One reason an outbound body is being blocked.
 */
export interface HoneypotEmission {
  readonly label: string
  readonly detail: string
}

/**
 * Options for {@link findHoneypotEmissions}.
 */
export interface HoneypotScanOptions {
  // True → skip the marker-literal findings. Set when the payload names this
  // guard's own directory, so a message describing the guard is not a finding.
  readonly allowMarkerLiterals?: boolean | undefined
  // This session's transcript path — corroborates a twelve-hex token that does
  // not resolve to a local commit (see tokenSeenInTranscript).
  readonly transcriptPath?: string | undefined
}

/**
 * True when `text` names this guard's own directory.
 */
export function mentionsThisGuard(text: string): boolean {
  return SELF_DIR_RE.test(normalizePath(text))
}

/**
 * Every reason `body` must not be posted. Scans the raw text and a
 * `normalizeForScan` copy, so an invisible-character-padded token is still
 * caught. Empty when the body is safe to send.
 */
export function findHoneypotEmissions(
  body: string,
  repoDir: string,
  options?: HoneypotScanOptions | undefined,
): HoneypotEmission[] {
  const opts = { __proto__: null, ...options } as HoneypotScanOptions
  const variants = [body, normalizeForScan(body)]
  const out: HoneypotEmission[] = []
  const seen = new Set<string>()
  const add = (label: string, detail: string): void => {
    const key = `${label}:${detail}`
    if (!seen.has(key)) {
      seen.add(key)
      out.push({ detail, label })
    }
  }

  if (opts.allowMarkerLiterals !== true) {
    for (let i = 0, { length } = MARKER_PATTERNS; i < length; i += 1) {
      const marker = MARKER_PATTERNS[i]!
      const hit = variants.find(v => marker.re.test(v))
      if (hit !== undefined) {
        add(marker.label, marker.re.exec(hit)?.[0] ?? marker.label)
      }
    }
  }

  for (let i = 0, { length } = variants; i < length; i += 1) {
    const trimmed = variants[i]!.trim()
    if (BARE_TOKEN_BODY_RE.test(trimmed)) {
      add('body is a bare token and nothing else', trimmed)
      break
    }
  }

  const canResolveGit = gitCanResolveObjects(repoDir)
  const tokens = findHoneypotTokens(body)
  for (let i = 0, { length } = tokens; i < length; i += 1) {
    const token = tokens[i]!
    if (canResolveGit && isKnownGitCommit(repoDir, token)) {
      continue
    }
    if (tokenSeenInTranscript(opts.transcriptPath, token)) {
      add('twelve-hex token that is not a commit in this repo', token)
    }
  }

  return out
}
