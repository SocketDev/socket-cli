/*
 * @file Code-as-law for the fleet domain denylist
 *   (.claude/hooks/fleet/_shared/denied-domains.mts — the single source every
 *   enforcement point imports). Two gates:
 *
 *   1. TREE — no tracked file may carry a denied host or a denied filename
 *      IOC: not a workflow, not an allowlist, not a config, script, doc,
 *      lockfile, or .npmrc. Exempt, narrowly: the denylist module itself, the
 *      edit-time guard, this check, their basename-matched tests, CHANGELOGs
 *      (via isChangelogPath — prose that records a fix, never loaded as
 *      config), a per-entry exemptPathRe (the taze patch carries its vetoed
 *      host in redirected-code context), and a markdown file under docs/ that
 *      cites IOCs AS IOCs and says so with the explicit
 *      IOC_CITATION_MARKER comment.
 *   2. EGRESS — a denied domain covered by any egress grant is red REGARDLESS
 *      of gate 1's exemptions: gh-aw `allowDomains` in compiled *.lock.yml
 *      files and the fleet .config/fleet/egress-allowlist.json are parsed and
 *      matched wildcard-aware, so `*.go2cloud.org` granting
 *      nostop.go2cloud.org is caught even though the literal never appears.
 *      Workflow sources and egress configs also get no marker exemption on
 *      the literal scan — an allowlist is never an advisory doc.
 *
 *   Self-contained over `git ls-files`, so it cascades and runs identically
 *   in every member. Exit codes: 0 — no denied reference and no denied grant;
 *   1 — a violation.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import type { DeniedDomain } from '../../../.claude/hooks/fleet/_shared/denied-domains.mts'
import {
  describeDeniedEntry,
  findDeniedDomainsInText,
  findDeniedFilenamesInText,
  findDeniedGrants,
  IOC_CITATION_MARKER,
} from '../../../.claude/hooks/fleet/_shared/denied-domains.mts'
import { isChangelogPath } from '../_shared/changelog-path.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

// Paths where a denied literal may legitimately appear: the denylist module
// (live + template copies), the edit-time guard, this check, and their
// basename-matched tests. Everything else is a violation.
// oxlint-disable-next-line socket/require-regex-comment -- documented above
const EXEMPT_RE =
  /(?:^|\/)(?:\.claude\/hooks\/fleet\/_shared\/denied-domains\.mts|\.claude\/hooks\/fleet\/denied-domain-reference-guard\/(?:README\.md|index\.mts)|denied-domain-reference-guard\.test\.mts|denied-domains-are-absent\.test\.mts|denied-domains\.test\.mts|scripts\/fleet\/check\/denied-domains-are-absent\.mts)$/

// Egress-granting surfaces: gh-aw workflow sources + compiled locks and the
// fleet local-agent egress allowlist. Gate 2 parses their grants; gate 1's
// marker exemption never applies to them.
// oxlint-disable-next-line socket/require-regex-comment -- documented above
const EGRESS_SURFACE_RE =
  /(?:^|\/)(?:\.github\/workflows\/[^/]+|\.config\/fleet\/egress-allowlist\.json$)/

// A markdown doc under docs/ at any nesting — the only surface the
// IOC-citation marker can exempt.
// oxlint-disable-next-line socket/require-regex-comment -- documented above
const DOCS_MD_RE = /(?:^|\/)docs\/.+\.md$/

/**
 * True when `file` is an egress-granting surface — a workflow source, a
 * compiled gh-aw lock, or the fleet egress allowlist.
 */
export function isEgressSurface(file: string): boolean {
  return EGRESS_SURFACE_RE.test(file) || file.endsWith('.lock.yml')
}

/**
 * True when `file` + `content` qualify for the IOC-citation exemption: a
 * markdown doc under docs/ carrying the explicit marker, and NOT an egress
 * surface.
 */
export function isIocCitationDoc(file: string, content: string): boolean {
  return (
    !isEgressSurface(file) &&
    DOCS_MD_RE.test(file) &&
    content.includes(IOC_CITATION_MARKER)
  )
}

/**
 * Every `allowDomains` array embedded in a gh-aw compiled lock or the fleet
 * egress allowlist JSON, unioned. Same JSON-blob shape the
 * egress-allowlist-is-gh-aw-subset check reads; duplicated here because that
 * check runs top-level statements on import.
 */
export function collectAllowDomains(text: string): string[] {
  const hosts: string[] = []
  // Each `"allowDomains": [ ... ]` array body, non-greedy to the first `]`.
  // oxlint-disable-next-line socket/require-regex-comment -- documented above
  const re = /"allowDomains"\s*:\s*\[([^\]]*)\]/gu
  let m: RegExpExecArray | null = re.exec(text)
  while (m) {
    const body = m[1]!
    // A JSON double-quoted string: non-`"\` runs or backslash-escaped pairs.
    // oxlint-disable-next-line socket/require-regex-comment -- documented above
    const strRe = /"((?:[^"\\]|\\.)*)"/gu
    let s: RegExpExecArray | null = strRe.exec(body)
    while (s) {
      hosts.push(s[1]!)
      s = strRe.exec(body)
    }
    m = re.exec(text)
  }
  return hosts
}

/**
 * Findings for one tracked file, or none. Exported for tests (pure over the
 * injected content).
 */
export function scanFile(file: string, content: string): string[] {
  const findings: string[] = []
  if (EXEMPT_RE.test(file) || isChangelogPath(file)) {
    return findings
  }
  const egress = isEgressSurface(file)
  if (!egress && isIocCitationDoc(file, content)) {
    return findings
  }
  const exemptEntry = egress
    ? undefined
    : (entry: DeniedDomain) => entry.exemptPathRe?.test(file) === true
  for (const hit of findDeniedDomainsInText(content, exemptEntry)) {
    const surface = egress
      ? 'references a fleet-DENIED domain on an EGRESS surface'
      : 'references a fleet-DENIED domain'
    findings.push(
      `${file}:${hit.line}: ${surface}.\n` +
        `  ${describeDeniedEntry(hit.entry)}\n` +
        '  Fix: remove the reference. To cite it as an IOC, move the text ' +
        `into a markdown doc under docs/ carrying the marker comment ` +
        `\`<!-- ${IOC_CITATION_MARKER} -->\`; an egress surface is never ` +
        'exempt.',
    )
  }
  for (const hit of findDeniedFilenamesInText(content)) {
    findings.push(
      `${file}:${hit.line}: references the fleet-DENIED filename IOC ` +
        `\`${hit.entry.name}\` — denied ${hit.entry.dateAdded}: ` +
        `${hit.entry.reason}\n  Source: ${hit.entry.source}\n` +
        '  Fix: remove the reference, or cite it in a marked IOC doc under ' +
        'docs/.',
    )
  }
  if (egress) {
    for (const hit of findDeniedGrants(collectAllowDomains(content))) {
      findings.push(
        `${file}: egress grant \`${hit.grant}\` covers a fleet-DENIED ` +
          'domain.\n' +
          `  ${describeDeniedEntry(hit.entry)}\n` +
          '  Fix: remove the grant. A denied domain in allowDomains or a ' +
          'firewall config is red regardless of how it got there.',
      )
    }
  }
  return findings
}

export function trackedFiles(cwd: string): string[] {
  const result = spawnSync('git', ['ls-files', '-z'], { cwd, stdio: 'pipe' })
  if (result.status !== 0) {
    return []
  }
  return String(result.stdout ?? '')
    .split('\0')
    .filter(Boolean)
}

export function main(): void {
  // Implicit working directory: like taze-is-single-registry, this check
  // reads repo-relative paths from wherever the check runner invoked it — the
  // repo root in every runner; the e2e tests spawn it from a fixture dir.
  const cwd = '.'
  const findings: string[] = []
  const files = trackedFiles(cwd)
  for (let i = 0, { length } = files; i < length; i += 1) {
    const file = files[i]!
    if (!existsSync(path.join(cwd, file))) {
      continue
    }
    let content: string
    try {
      content = readFileSync(path.join(cwd, file), 'utf8')
    } catch {
      // Unreadable — deleted mid-scan or a submodule stub; nothing to scan.
      continue
    }
    findings.push(...scanFile(file, content))
  }

  if (findings.length > 0) {
    for (let i = 0, { length } = findings; i < length; i += 1) {
      logger.error(`✗ ${findings[i]!}`)
    }
    logger.error('')
    logger.error(
      `${findings.length} denied-domain violation${findings.length === 1 ? '' : 's'}. ` +
        'The denylist lives in .claude/hooks/fleet/_shared/denied-domains.mts.',
    )
    process.exitCode = 1
    return
  }
  logger.log(
    'denied domains are absent: no tracked file references one, no egress ' +
      'grant covers one.',
  )
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'checks no tracked file or egress grant carries a denied domain or IOC filename',
  help: 'Usage: node scripts/fleet/check/denied-domains-are-absent.mts',
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
