#!/usr/bin/env node
/*
 * @file Code-is-law coverage gate: every HARD rule (a 🚨-marked paragraph) in
 *   the fleet block of CLAUDE.md and in docs/agents.md/fleet/_.md must resolve
 *   to an EXECUTABLE enforcer — a hook, a `socket/`+`typescript/` lint rule, or
 *   a scripts/fleet/_.mts script — not merely to a prose detail page. This is
 *   the inverse of the two existing CLAUDE.md gates:
 *
 *   - claude-md-citations-resolve.mts asserts a CITED thing EXISTS (no dangling
 *     citation), but says nothing about a rule that cites nothing.
 *   - claude-md-rules-are-informative.mts asserts each `###` SECTION anchors to
 *     one of {hook cite, docs link, skill ref, advisory}, accepting a docs link
 *     ALONE as sufficient — so a hard 🚨 rule can anchor to only prose and
 *     pass. Neither fails when a declared discipline has no code behind it. The
 *     Code-is-law rule (CLAUDE.md) forbids exactly that "policy-on-paper"
 *     state; this gate makes it fail. Granularity is the 🚨 PARAGRAPH, not the
 *     `###` section: a multi-rule section (e.g. Tooling carries several 🚨)
 *     passes only when EVERY one of its hard rules resolves to an enforcer,
 *     which is what "enforce every rule" means. A 🚨 paragraph passes when its
 *     text cites at least one of:
 *
 *   1. a hook — `.claude/hooks/{fleet,repo}/<name>/` that exists on disk with an
 *      index.mts OR install.mts (installer hooks enforce off the host
 *      machine);
 *   2. a lint rule — backticked `socket/<rule>` (registered in the plugin) or
 *      `typescript/<rule>` (a key in .config/fleet/oxlintrc.json);
 *   3. a script — any `scripts/fleet/<path>.mts` that resolves on disk (a check/
 *      invariant OR build-step automation — both are executable law).
 *      Off-machine / human-judgment rules that genuinely cannot be coded carry
 *      an inline opt-out comment `<!-- enforcement: <category> — <reason> -->`
 *      with <category> in {human-review, off-machine, installer}; those pass
 *      and are listed in the report so the opt-out set stays visible and small.
 *      Gated surfaces (a finding fails the gate): the CLAUDE.md fleet block and
 *      docs/agents.md/fleet/*.md. Advisory surfaces (reported, never fail):
 *      docs/** outside fleet, README.md, hook READMEs, SKILL.md — prose there
 *      is not a structured rule surface, so a 🚨 with no enforcer is surfaced,
 *      not enforced. Exit codes: 0 — every gated 🚨 rule resolves to an
 *      executable enforcer (or a declared opt-out); 1 — at least one gated 🚨
 *      rule is policy-on-paper. Fail-open: no CLAUDE.md → success;
 *      plugin-absent repo → arm 2's socket/ half is skipped (matches
 *      claude-md-citations-resolve).
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  isFleetMarkerBeginLine,
  isFleetMarkerEndLine,
} from '../../../.claude/hooks/fleet/_shared/fleet-markers.mts'
import {
  collectFleetDocs,
  collectHookEnforcers,
  collectLintRules,
  collectScriptPaths,
} from '../lib/enforcer-inventory.mts'
import { REPO_ROOT } from '../paths.mts'
import { hasFleetHookSource } from '../_shared/fleet-source-present.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

// The hard-rule marker. Only 🚨 paragraphs are gated; soft norms (no 🚨) are
// not — they're already covered by the informativeness anchor check.
const SIREN = '🚨'

// Fleet-block delimiters (mirror claude-md-rules-are-informative.mts).

// A hook citation anywhere in a paragraph: `.claude/hooks/{fleet,repo}/<name>/`.
// Brace-grouped `{a,b,c}/` is expanded by expandNames (imported below via the
// shared inventory module, which re-exports the citation helpers).
const HOOK_CITATION_RE =
  /\.claude\/hooks\/(?:fleet|repo)\/([a-z][a-z0-9-]*|\{[^}]+\})\//g

// Lint-rule citation: backticked `socket/<rule>` or `typescript/<rule>`.
const LINT_CITATION_RE = /`(socket|typescript)\/([a-z][a-z0-9-]*)`/g

// Script citation: any scripts/{fleet,repo}/<path>.mts (a check/ invariant, the
// cascade automation, etc.). Captures the path under scripts/ — including the
// tier — so `scripts/repo/cascade-fleet.mts` → key `repo/cascade-fleet.mts`. A
// citation may carry a `socket-wheelhouse/` prefix (the wheelhouse-relative
// form); the capture starts at `fleet/` or `repo/` regardless.
const SCRIPT_CITATION_RE = /scripts\/((?:fleet|repo)\/[A-Za-z0-9/_-]+\.mts)/g

// A markdown link to a fleet detail surface — a `docs/agents.md/fleet/X.md`
// detail page or a `.claude/skills/**/SKILL.md` procedure (both are
// Documented-layer write-ups). CLAUDE.md is held under a 40 KB cap, so a 🚨
// paragraph states the rule + a one-line why and DEFERS the enforcer citation to
// its detail surface. A paragraph is therefore "enforced" when it OR a detail
// surface it links to cites a resolving enforcer. Also matches a bare backticked
// `.claude/skills/.../SKILL.md` reference (the `See X` form, not a `](...)` link).
// Breakdown: a leading delimiter — a backtick/quote OR a markdown `](` — then a
// capture of EITHER a `.claude/skills/**/SKILL.md` path OR a
// `docs/agents.md/fleet/*.md` path. The two alternatives are sorted (`.claude`
// before `docs`) per sort-regex-alternations.
const DETAIL_LINK_RE =
  /(?:[`'"]|\]\()((?:\.claude\/skills\/[A-Za-z0-9._/-]+\/SKILL\.md)|(?:docs\/agents\.md\/fleet\/[A-Za-z0-9._/-]+\.md))/g // socket-lint: allow uncommented-regex

// Opt-out: `<!-- enforcement: <category> — <reason> -->`. <category> is a single
// word from the allowed set; a separated <reason> must be present (category +
// reason shape, mirroring `max-file-lines: <category> — <reason>`). A bare
// category with no reason does NOT exempt.
const OPT_OUT_RE =
  /<!--\s*enforcement:\s*(human-review|installer|off-machine)\s*[—-]\s*\S.*?-->/i

export interface RuleParagraph {
  readonly file: string
  readonly line: number
  readonly text: string
  // Full text of the enclosing `###` section, for the detail-link fallback.
  readonly sectionText: string
}

export interface Finding {
  readonly file: string
  readonly line: number
  readonly excerpt: string
}

export interface OptOut {
  readonly file: string
  readonly line: number
  readonly category: string
}

export interface EnforcerInventory {
  // Hook names that resolve to a real dir with index.mts OR install.mts.
  readonly hookNames: ReadonlySet<string>
  // Registered socket/ rule names; empty in a plugin-absent repo.
  readonly socketRules: ReadonlySet<string>
  // typescript/<rule> keys present in the oxlint config.
  readonly tsRules: ReadonlySet<string>
  // scripts/fleet/<path>.mts paths that resolve on disk.
  readonly scriptPaths: ReadonlySet<string>
}

export interface AuditResult {
  readonly findings: Finding[]
  readonly optOuts: OptOut[]
  readonly checked: number
}

// Expand a brace citation name part: `{a,b,c}` → [a,b,c]; `foo` → [foo].
export function expandNames(raw: string): string[] {
  if (raw.startsWith('{') && raw.endsWith('}')) {
    return raw
      .slice(1, -1)
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
  }
  return [raw]
}

// A `### ` heading line; the section it opens runs until the next `### ` (or the
// fleet-block end). A section's trailing `Detail:`/`Full ruleset:` doc link
// applies to every 🚨 rule in it — the fleet's terse-CLAUDE.md convention puts
// one detail link per section, not per paragraph — so enforcement consults the
// whole enclosing section's links, while findings stay paragraph-granular.
const SECTION_HEADER_RE = /^###\s+\S/

export interface ParagraphScanConfig {
  // Restrict to the CLAUDE.md fleet block (BEGIN/END FLEET-CANONICAL). For docs
  // the whole body is in scope and each paragraph's "section" is delimited by
  // `###` headings.
  readonly fleetOnly: boolean
}

// Split a markdown body into 🚨 paragraphs. A paragraph is a maximal run of
// non-blank lines; only those containing the siren are returned. The reported
// line is the paragraph's first line (1-based). `sectionText` is the full text
// of the `###` section the paragraph sits in (for the detail-link fallback).
export function sirenParagraphs(
  file: string,
  body: string,
  config: ParagraphScanConfig,
): RuleParagraph[] {
  const { fleetOnly } = { __proto__: null, ...config } as typeof config
  const lines = body.split('\n')
  const out: RuleParagraph[] = []

  // CLAUDE.md (fleetOnly) is a thin bullet index: each 🚨 `- ` bullet IS a rule,
  // carrying its own enforcer citation / doc link on the line. The line is both
  // the rule text and its own sectionText (no enclosing `###` section anymore).
  if (fleetOnly) {
    let inFleet = false
    for (let i = 0, { length } = lines; i < length; i += 1) {
      const line = lines[i] ?? ''
      if (isFleetMarkerBeginLine(line)) {
        inFleet = true
        continue
      }
      if (isFleetMarkerEndLine(line)) {
        inFleet = false
        continue
      }
      if (inFleet && line.startsWith('- ') && line.includes(SIREN)) {
        out.push({ file, line: i + 1, text: line, sectionText: line })
      }
    }
    return out
  }

  // Docs (whole body): 🚨 paragraphs within `###` sections; sectionText is the
  // enclosing section, for the detail-link fallback.
  let sectionLines: string[] = []
  let pending: Array<{ line: number; text: string }> = []
  let para: string[] = []
  let paraStart = 0
  function endPara(): void {
    if (para.length) {
      const text = para.join('\n')
      if (text.includes(SIREN)) {
        pending.push({ line: paraStart + 1, text })
      }
    }
    para = []
  }
  function endSection(): void {
    endPara()
    const sectionText = sectionLines.join('\n')
    for (let j = 0, { length } = pending; j < length; j += 1) {
      const p = pending[j]!
      out.push({ file, line: p.line, text: p.text, sectionText })
    }
    pending = []
    sectionLines = []
  }
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i] ?? ''
    if (SECTION_HEADER_RE.test(line)) {
      endSection()
      sectionLines.push(line)
      continue
    }
    sectionLines.push(line)
    if (line.trim() === '') {
      endPara()
      continue
    }
    if (para.length === 0) {
      paraStart = i
    }
    para.push(line)
  }
  endSection()
  return out
}

// True when a block of text directly cites at least one resolving executable
// enforcer (hook with an entrypoint, registered socket/typescript lint rule, or
// a resolving scripts/{fleet,repo} path).
export function textCitesEnforcer(
  text: string,
  inv: EnforcerInventory,
): boolean {
  for (const m of text.matchAll(HOOK_CITATION_RE)) {
    for (const name of expandNames(m[1]!)) {
      if (inv.hookNames.has(name)) {
        return true
      }
    }
  }
  for (const m of text.matchAll(LINT_CITATION_RE)) {
    const ns = m[1]!
    const rule = m[2]!
    if (ns === 'socket') {
      // Plugin-absent repo: socketRules is empty → skip this arm (fail-open).
      if (inv.socketRules.size === 0 || inv.socketRules.has(rule)) {
        return true
      }
    } else if (inv.tsRules.has(rule)) {
      return true
    }
  }
  for (const m of text.matchAll(SCRIPT_CITATION_RE)) {
    if (inv.scriptPaths.has(m[1]!)) {
      return true
    }
  }
  return false
}

// The fleet detail surfaces a paragraph links to (repo-root-relative paths):
// docs/agents.md/fleet/*.md pages and .claude/skills/**/SKILL.md procedures.
export function linkedDetailDocs(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(DETAIL_LINK_RE)) {
    out.push(m[1]!)
  }
  return [...new Set(out)]
}

// True when a 🚨 paragraph is enforced: the paragraph OR its enclosing section
// directly cites a resolving enforcer, OR a fleet detail doc linked from the
// paragraph or section does. `readDoc` returns a linked doc's text (undefined if
// missing). The section + doc fallbacks are what let CLAUDE.md stay under its
// 40 KB cap — a rule states the why inline and defers the citation to the
// section's one detail link.
export function paragraphIsEnforced(
  sectionText: string,
  inv: EnforcerInventory,
  readDoc: (relPath: string) => string | undefined,
): boolean {
  if (textCitesEnforcer(sectionText, inv)) {
    return true
  }
  for (const relPath of linkedDetailDocs(sectionText)) {
    const docText = readDoc(relPath)
    if (docText !== undefined && textCitesEnforcer(docText, inv)) {
      return true
    }
  }
  return false
}

export function optOutCategory(text: string): string | undefined {
  const m = OPT_OUT_RE.exec(text)
  return m ? m[1]!.toLowerCase() : undefined
}

export interface AuditConfig {
  // Restrict to the CLAUDE.md fleet block (see ParagraphScanConfig).
  readonly fleetOnly: boolean
  // Resolve a linked fleet detail doc's text (repo-root-relative path →
  // contents), undefined when the file is missing.
  readonly readDoc: (relPath: string) => string | undefined
}

// Audit one file's 🚨 paragraphs against the inventory.
export function auditFile(
  file: string,
  body: string,
  inv: EnforcerInventory,
  config: AuditConfig,
): AuditResult {
  const { fleetOnly, readDoc } = {
    __proto__: null,
    ...config,
  } as typeof config
  const findings: Finding[] = []
  const optOuts: OptOut[] = []
  const paras = sirenParagraphs(file, body, { fleetOnly })
  for (let i = 0, { length } = paras; i < length; i += 1) {
    const p = paras[i]!
    const category = optOutCategory(p.text)
    if (category) {
      optOuts.push({ file: p.file, line: p.line, category })
      continue
    }
    if (!paragraphIsEnforced(p.sectionText, inv, readDoc)) {
      const firstLine = p.text.split('\n')[0] ?? ''
      findings.push({
        file: p.file,
        line: p.line,
        excerpt: firstLine.slice(0, 120),
      })
    }
  }
  return { findings, optOuts, checked: paras.length }
}

function loadInventory(repoRoot: string): EnforcerInventory {
  const hookNames = collectHookEnforcers(repoRoot)
  const { socketRules, tsRules } = collectLintRules(repoRoot)
  const scriptPaths = collectScriptPaths(repoRoot)
  return { hookNames, socketRules, tsRules, scriptPaths }
}

async function main(): Promise<void> {
  const claudeMdPath = path.join(REPO_ROOT, 'CLAUDE.md')
  if (!existsSync(claudeMdPath)) {
    logger.success('No CLAUDE.md to check.')
    return
  }
  // A bundle-only member has no per-hook / per-rule SOURCE dirs — the enforcer
  // inventory would come up empty and every hard rule would read as
  // enforcerless. Coverage is validated at the source repo.
  if (!hasFleetHookSource(REPO_ROOT)) {
    logger.success(
      'No fleet hook source in this repo (bundle-only) — enforcement coverage validated at the source repo.',
    )
    return
  }
  const inv = loadInventory(REPO_ROOT)

  // Resolve a repo-root-relative doc path to its text, once per path (the same
  // detail doc is linked from many rules). Returns undefined for a missing file.
  const docCache = new Map<string, string | undefined>()
  function readDoc(relPath: string): string | undefined {
    if (!docCache.has(relPath)) {
      const abs = path.join(REPO_ROOT, relPath)
      try {
        docCache.set(relPath, readFileSync(abs, 'utf8'))
      } catch {
        docCache.set(relPath, undefined)
      }
    }
    return docCache.get(relPath)
  }

  const findings: Finding[] = []
  const optOuts: OptOut[] = []
  let checked = 0

  // Gated surface 1: the CLAUDE.md fleet block.
  const claudeMd = readFileSync(claudeMdPath, 'utf8')
  const claudeResult = auditFile('CLAUDE.md', claudeMd, inv, {
    fleetOnly: true,
    readDoc,
  })
  findings.push(...claudeResult.findings)
  optOuts.push(...claudeResult.optOuts)
  checked += claudeResult.checked

  // Gated surface 2: docs/agents.md/fleet/*.md (fleet-canonical detail pages).
  for (const docPath of collectFleetDocs(REPO_ROOT)) {
    const rel = path.relative(REPO_ROOT, docPath)
    const result = auditFile(rel, readFileSync(docPath, 'utf8'), inv, {
      fleetOnly: false,
      readDoc,
    })
    findings.push(...result.findings)
    optOuts.push(...result.optOuts)
    checked += result.checked
  }

  if (optOuts.length) {
    logger.info(
      `code-is-law: ${optOuts.length} 🚨 rule(s) opted out of code enforcement (off-machine / human-review / installer):`,
    )
    for (let i = 0, { length } = optOuts; i < length; i += 1) {
      const o = optOuts[i]!
      logger.info(`  ${o.file}:${o.line} — ${o.category}`)
    }
  }

  if (findings.length) {
    logger.error(
      `code-is-law gap (${findings.length}): a 🚨 rule is documented but not enforced by code.`,
    )
    for (let i = 0, { length } = findings; i < length; i += 1) {
      const f = findings[i]!
      logger.error(`  ${f.file}:${f.line}`)
      logger.error(`    rule: ${f.excerpt}`)
    }
    logger.error(
      'What: a 🚨 (hard-discipline) rule cites no executable enforcer.',
    )
    logger.error(
      'Wanted: cite a resolving hook (`.claude/hooks/fleet/<name>/`), a lint rule (`socket/<rule>` or `typescript/<rule>`), or a script (`scripts/fleet/<name>.mts`).',
    )
    logger.error(
      'Fix: add the enforcer and cite it inline — or, if the rule is genuinely off-machine / human-judgment, mark it `<!-- enforcement: off-machine — <reason> -->`.',
    )
    process.exitCode = 1
    return
  }

  logger.success(
    `code-is-law: all ${checked} 🚨 rule(s) in the fleet block + docs/agents.md/fleet resolve to an executable enforcer.`,
  )
}

if (isMainModule(import.meta.url)) {
  main().catch((e: unknown) => {
    logger.error(
      `check-claude-md-rules-are-enforced failed: ${errorMessage(e)}`,
    )
    process.exitCode = 1
  })
}
