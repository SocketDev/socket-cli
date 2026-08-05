#!/usr/bin/env node
// Claude Code PreToolUse hook — denied-domain-reference-guard.
//
// Blocks an Edit/Write/MultiEdit that lands a fleet-DENIED domain or a denied
// filename IOC into any file. The denylist names hosts that are known
// malicious or owner-vetoed — including lookalikes that READ legitimate, like
// the fake-Corepack distribution site whose name a good-faith agent could
// "helpfully" allowlist or link. Blocking at edit time keeps the reference
// from ever landing; the commit-time twin
// (scripts/fleet/check/denied-domains-are-absent.mts) catches anything that
// arrives another way, and both import the SAME
// _shared/denied-domains.mts so the surfaces never drift (code is law, DRY).
//
// Allowed, narrowly:
//   - editing the denylist surfaces themselves — the _shared module, this
//     guard, the commit-time check, and their basename-matched tests.
//   - a CHANGELOG — change-description prose, never loaded as config.
//   - a markdown doc under docs/ whose about-to-land content carries the
//     explicit IOC-citation marker comment (citing an IOC as an IOC).
//   - a per-entry exemptPathRe target, like the taze single-registry patch.
//
// NEVER allowed, marker or not: an egress surface — a workflow source or
// compiled gh-aw lock, or .config/fleet/egress-allowlist.json. A denied
// domain in an allowlist is always a block.
//
// Bypass: `Allow denied-domain bypass` in a recent user turn.
//
// Exit codes: 0 — pass; 2 — block. Fails open on any hook error.

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import type { DeniedDomain } from '../_shared/denied-domains.mts'
import {
  findDeniedDomainsInText,
  findDeniedFilenamesInText,
  IOC_CITATION_MARKER,
} from '../_shared/denied-domains.mts'
import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'
import { verdictContinuation, verdictLine } from '../_shared/verdict.mts'

// The denylist's own surfaces — the only files that may carry the literals by
// construction. Mirrors the commit-time check's EXEMPT_RE.
// oxlint-disable-next-line socket/require-regex-comment -- documented above
const SELF_SURFACE_RE =
  /(?:^|\/)(?:\.claude\/hooks\/fleet\/_shared\/denied-domains\.mts|\.claude\/hooks\/fleet\/denied-domain-reference-guard\/(?:README\.md|index\.mts)|denied-domain-reference-guard\.test\.mts|denied-domains-are-absent\.test\.mts|denied-domains\.test\.mts|scripts\/fleet\/check\/denied-domains-are-absent\.mts)$/

// A CHANGELOG basename at any depth — prose that records a change, never
// loaded as active config.
// oxlint-disable-next-line socket/require-regex-comment -- documented above
const CHANGELOG_RE = /(?:^|\/)changelog(?:\.(?:markdown|md))?$/i

// Egress-granting surfaces — never exempt, marker or not.
// oxlint-disable-next-line socket/require-regex-comment -- documented above
const EGRESS_SURFACE_RE =
  /(?:^|\/)(?:\.github\/workflows\/[^/]+|\.config\/fleet\/egress-allowlist\.json$)/

// A markdown doc under docs/ — the only surface the IOC-citation marker can
// exempt.
// oxlint-disable-next-line socket/require-regex-comment -- documented above
const DOCS_MD_RE = /(?:^|\/)docs\/.+\.md$/

export const check = editGuard((filePath, content, _payload) => {
  if (!content) {
    return undefined
  }
  const file = normalizePath(filePath)
  if (SELF_SURFACE_RE.test(file) || CHANGELOG_RE.test(file)) {
    return undefined
  }
  const egress = EGRESS_SURFACE_RE.test(file) || file.endsWith('.lock.yml')
  if (
    !egress &&
    DOCS_MD_RE.test(file) &&
    content.includes(IOC_CITATION_MARKER)
  ) {
    return undefined
  }
  const exemptEntry = egress
    ? undefined
    : (entry: DeniedDomain) => entry.exemptPathRe?.test(file) === true
  const domainHits = findDeniedDomainsInText(content, exemptEntry)
  const filenameHits = findDeniedFilenamesInText(content)
  if (domainHits.length === 0 && filenameHits.length === 0) {
    return undefined
  }
  const surface = egress ? ' on an EGRESS surface (never exempt)' : ''
  const lines: string[] = [
    verdictLine(
      'block',
      'denied-domain-reference-guard',
      `blocked fleet-DENIED reference in ${filePath}${surface} — drop it, or cite as an IOC in a docs/*.md carrying \`<!-- ${IOC_CITATION_MARKER} -->\``,
    ),
  ]
  for (const hit of domainHits) {
    lines.push(
      verdictContinuation(
        `✗ \`${hit.entry.host}\` — ${hit.entry.reason} (${hit.entry.source})`,
      ),
    )
  }
  for (const hit of filenameHits) {
    lines.push(
      `   ✗ \`${hit.entry.name}\` — denied filename IOC: ${hit.entry.reason} (${hit.entry.source})`,
    )
  }
  return block(lines.join('\n'))
})

export const hook = defineHook({
  bypass: ['denied-domain'],
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  type: 'guard',
})

void runHook(hook, import.meta.url)
