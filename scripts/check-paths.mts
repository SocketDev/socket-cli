#!/usr/bin/env node
/**
 * @fileoverview Path-hygiene gate.
 *
 * Mantra: 1 path, 1 reference. A path is constructed exactly once;
 * everywhere else references the constructed value.
 *
 * Whole-repo scan complementing the per-edit `.claude/hooks/path-guard`
 * hook. The hook stops new violations from landing; this gate finds
 * the existing ones and blocks merges that introduce more.
 *
 * Rules enforced:
 *
 *   A — Multi-stage path constructed inline. A `path.join(...)` call
 *       (or template literal) in a `.mts`/`.cts` file outside a
 *       `paths.mts` that stitches together two or more "stage"
 *       segments (Final, Release, Stripped, Compressed, Optimized,
 *       Synced, wasm, downloaded), or one stage plus a build-root
 *       (`build`/`out`) plus a mode (`dev`/`prod`/`shared`). The
 *       construction belongs in the package's `paths.mts` (or a
 *       build-infra helper); every consumer imports the computed
 *       value.
 *
 *   B — Cross-package path traversal. A `path.join(*, '..', '<sibling
 *       package>', 'build', ...)` reaches into a sibling's build
 *       output without going through its `exports`. The sibling owns
 *       its layout; consumers declare a workspace dep and import the
 *       sibling's `paths.mts`.
 *
 *   C — Hand-built workflow path. A `.github/workflows/*.yml` step
 *       constructs `build/${...}/out/<stage>/...` inline outside a
 *       canonical "Compute paths" step. Workflows can carry path
 *       strings, but the strings are constructed once and exposed via
 *       step outputs / job env that downstream steps reference.
 *
 *   D — Comment-encoded paths. Comments (in code or YAML) that re-state
 *       a fully-qualified multi-stage path. Comments may describe the
 *       structure ("Final dir" or "build/<mode>/...") but should not
 *       encode a complete path string that a tool would parse — the
 *       canonical construction IS the documentation.
 *
 *   F — Same path constructed in multiple places. The same shape of
 *       multi-stage `path.join(...)` (or workflow `build/${...}/...`
 *       string template) appearing in two or more files. Construct
 *       once and import; references of the constructed value are
 *       unlimited.
 *
 *   G — Hand-built paths in Makefiles, Dockerfiles, and shell scripts.
 *       Same shape as A, applied to executable artifacts that don't
 *       run TypeScript. Each canonical construction must carry a
 *       comment naming the source-of-truth `paths.mts` so the script
 *       can't drift from TS without a flagged change.
 *
 * Allowlist: `.github/paths-allowlist.yml`. Each entry needs a
 * `reason` so the list stays audit-able. Patterns are deliberately
 * narrow — entries should be specific, not blanket.
 *
 * Usage:
 *   node scripts/check-paths.mts             # default: report + fail
 *   node scripts/check-paths.mts --explain   # long-form explanation
 *   node scripts/check-paths.mts --json      # machine-readable
 *   node scripts/check-paths.mts --quiet     # silent on clean
 *
 * Exit codes:
 *   0 — clean (no findings, or every finding is allowlisted)
 *   1 — findings present
 *   2 — gate itself crashed
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { fileURLToPath } from 'node:url'

import { parseArgs } from 'node:util'

// Plain stderr/stdout output — no @socketsecurity/lib dependency so
// the gate is self-contained and works in socket-lib itself (which
// would otherwise import itself).
const logger = {
  log: (msg: string) => process.stdout.write(msg + '\n'),
  error: (msg: string) => process.stderr.write(msg + '\n'),
  step: (msg: string) => process.stdout.write(`→ ${msg}\n`),
  success: (msg: string) => process.stdout.write(`✔ ${msg}\n`),
  substep: (msg: string) => process.stdout.write(`  ${msg}\n`),
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const REPO_ROOT = path.resolve(__dirname, '..')

// Stage segments (Rule A core). Spreading any two of these via
// `path.join` is a finding outside `paths.mts`.
const STAGE_SEGMENTS = new Set([
  'Final',
  'Release',
  'Stripped',
  'Compressed',
  'Optimized',
  'Synced',
  'wasm',
  'downloaded',
])

const BUILD_ROOT_SEGMENTS = new Set(['build', 'out'])
const MODE_SEGMENTS = new Set(['dev', 'prod', 'shared'])

// Sibling fleet packages (Rule B). Union of all packages across the
// Socket fleet — the gate is byte-identical via sync-scaffolding, so
// listing every fleet package keeps Rule B firing in any repo. When
// a new package joins the workspace, add it here and propagate via
// `node scripts/sync-scaffolding.mjs --all --fix` from
// socket-repo-template.
const KNOWN_SIBLING_PACKAGES = new Set([
  // socket-btm
  'binflate',
  'binject',
  'binpress',
  'bin-infra',
  'build-infra',
  'codet5-models-builder',
  'curl-builder',
  'iocraft-builder',
  'ink-builder',
  'libpq-builder',
  'lief-builder',
  'minilm-builder',
  'models',
  'napi-go',
  'node-smol-builder',
  'onnxruntime-builder',
  'opentui-builder',
  'stubs-builder',
  'ultraviolet-builder',
  'yoga-layout-builder',
  // socket-cli
  'cli',
  'package-builder',
  // socket-tui
  'core',
  'react',
  'renderer',
  'ultraviolet',
  'yoga',
  // socket-registry / ultrathink
  'acorn',
  'npm',
])

// File-path patterns that legitimately enumerate path segments.
const EXEMPT_FILE_PATTERNS: RegExp[] = [
  // Any paths.mts is the canonical constructor.
  /(^|\/)paths\.(mts|cts|js)$/,
  // Build-infra owns shared helpers that enumerate stages.
  /packages\/build-infra\/lib\/paths\.mts$/,
  /packages\/build-infra\/lib\/constants\.mts$/,
  // Path-scanning gates that intentionally enumerate.
  /scripts\/check-paths\.mts$/,
  /scripts\/check-consistency\.mts$/,
  /\.claude\/hooks\/path-guard\//,
  // Allowlist + config files.
  /\.github\/paths-allowlist\.yml$/,
]

type Finding = {
  rule: 'A' | 'B' | 'C' | 'D' | 'F' | 'G'
  file: string
  line: number
  snippet: string
  message: string
  fix: string
}

const findings: Finding[] = []

const args = parseArgs({
  options: {
    explain: { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
    quiet: { type: 'boolean', default: false },
  },
  strict: false,
})

const isExempt = (filePath: string): boolean =>
  EXEMPT_FILE_PATTERNS.some(re => re.test(filePath))

// ──────────────────────────────────────────────────────────────────
// Allowlist loading
// ──────────────────────────────────────────────────────────────────

type AllowlistEntry = {
  file?: string
  pattern?: string
  rule?: string
  line?: number
  reason: string
}

const loadAllowlist = (): AllowlistEntry[] => {
  const allowlistPath = path.join(REPO_ROOT, '.github', 'paths-allowlist.yml')
  if (!existsSync(allowlistPath)) {
    return []
  }
  const text = readFileSync(allowlistPath, 'utf8')
  // Tiny YAML parser — only the shape we need: list of entries with
  // `file`, `pattern`, `rule`, `line`, `reason` scalar fields.
  // Avoids a yaml dep for a gate that has to be self-contained.
  const entries: AllowlistEntry[] = []
  let current: Partial<AllowlistEntry> | null = null
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (!line.trim() || line.trim().startsWith('#')) {
      continue
    }
    if (line.startsWith('- ')) {
      if (current && current.reason) {
        entries.push(current as AllowlistEntry)
      }
      current = {}
      const rest = line.slice(2).trim()
      if (rest) {
        const m = rest.match(/^(\w+):\s*(.*)$/)
        if (m) {
          ;(current as any)[m[1]!] = unquote(m[2]!)
        }
      }
    } else if (current) {
      const m = line.match(/^\s+(\w+):\s*(.*)$/)
      if (m) {
        const key = m[1]!
        const value = unquote(m[2]!)
        ;(current as any)[key] =
          key === 'line' ? Number(value) : value
      }
    }
  }
  if (current && current.reason) {
    entries.push(current as AllowlistEntry)
  }
  return entries
}

const unquote = (s: string): string => {
  const t = s.trim()
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1)
  }
  return t
}

const ALLOWLIST = loadAllowlist()

const isAllowlisted = (finding: Finding): boolean =>
  ALLOWLIST.some(entry => {
    if (entry.rule && entry.rule !== finding.rule) {
      return false
    }
    if (entry.file && !finding.file.includes(entry.file)) {
      return false
    }
    if (entry.pattern && !finding.snippet.includes(entry.pattern)) {
      return false
    }
    if (
      entry.line !== undefined &&
      Math.abs(entry.line - finding.line) > 2
    ) {
      return false
    }
    return true
  })

// ──────────────────────────────────────────────────────────────────
// File walking
// ──────────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'build',
  'dist',
  'out',
  'target',
  '.cache',
  'upstream',
])

const walk = function* (
  dir: string,
  filter: (relPath: string) => boolean,
): Generator<string> {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) {
      continue
    }
    const full = path.join(dir, e.name)
    const rel = path.relative(REPO_ROOT, full)
    if (e.isDirectory()) {
      yield* walk(full, filter)
    } else if (e.isFile() && filter(rel)) {
      yield rel
    }
  }
}

// ──────────────────────────────────────────────────────────────────
// Rule A + B: code scan (.mts / .cts)
// ──────────────────────────────────────────────────────────────────

const PATH_JOIN_RE = /\bpath\.join\s*\(\s*([^()]*(?:\([^()]*\)[^()]*)*)\)/g
const STRING_LITERAL_RE = /(['"])((?:\\.|(?!\1)[^\\])*)\1/g

const extractStringLiterals = (args: string): string[] => {
  const literals: string[] = []
  let match: RegExpExecArray | null
  while ((match = STRING_LITERAL_RE.exec(args)) !== null) {
    if (match[2] !== undefined) {
      literals.push(match[2])
    }
  }
  return literals
}

const scanCodeFile = (relPath: string): void => {
  const full = path.join(REPO_ROOT, relPath)
  let content: string
  try {
    content = readFileSync(full, 'utf8')
  } catch {
    return
  }
  const lines = content.split('\n')
  // Build a line-offset map so we can map regex offsets back to line
  // numbers cheaply.
  const lineOffsets: number[] = [0]
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') {
      lineOffsets.push(i + 1)
    }
  }
  const offsetToLine = (offset: number): number => {
    let lo = 0
    let hi = lineOffsets.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1
      if (lineOffsets[mid]! <= offset) {
        lo = mid
      } else {
        hi = mid - 1
      }
    }
    return lo + 1
  }

  let match: RegExpExecArray | null
  PATH_JOIN_RE.lastIndex = 0
  while ((match = PATH_JOIN_RE.exec(content)) !== null) {
    const callOffset = match.index
    const argList = match[1] ?? ''
    const literals = extractStringLiterals(argList)
    const stages = literals.filter(l => STAGE_SEGMENTS.has(l))
    const buildRoots = literals.filter(l => BUILD_ROOT_SEGMENTS.has(l))
    const modes = literals.filter(l => MODE_SEGMENTS.has(l))

    // Rule A: 2+ stages OR (1 stage + 1 build-root + 1 mode).
    const triggersA =
      stages.length >= 2 ||
      (stages.length >= 1 && buildRoots.length >= 1 && modes.length >= 1)
    if (triggersA) {
      const line = offsetToLine(callOffset)
      const snippet = (lines[line - 1] ?? '').trim()
      findings.push({
        rule: 'A',
        file: relPath,
        line,
        snippet,
        message:
          'Multi-stage path constructed inline (outside paths.mts).',
        fix: 'Construct in the owning paths.mts (or use getFinalBinaryPath / getDownloadedDir from build-infra/lib/paths). Import the computed value here.',
      })
    }

    // Rule B: '..' followed by a known sibling package + build context.
    let sawDotDot = false
    for (const lit of literals) {
      if (lit === '..') {
        sawDotDot = true
        continue
      }
      if (sawDotDot && KNOWN_SIBLING_PACKAGES.has(lit)) {
        const hasBuildContext = literals.some(
          l => BUILD_ROOT_SEGMENTS.has(l) || STAGE_SEGMENTS.has(l),
        )
        if (hasBuildContext) {
          const line = offsetToLine(callOffset)
          const snippet = (lines[line - 1] ?? '').trim()
          findings.push({
            rule: 'B',
            file: relPath,
            line,
            snippet,
            message: `Cross-package traversal into '${lit}' build output.`,
            fix: `Add '${lit}: workspace:*' as a dep, declare an exports entry on '${lit}' (e.g. './scripts/paths' → './scripts/paths.mts'), and import the path from there.`,
          })
        }
      }
    }
  }
}

// ──────────────────────────────────────────────────────────────────
// Rule C + D: workflow YAML scan
// ──────────────────────────────────────────────────────────────────

const WORKFLOW_PATH_RE =
  /build\/\$\{[^}]+\}\/[^"'`\s]*\/out\/(?:Final|Release|Stripped|Compressed|Optimized|Synced)/g
const WORKFLOW_GH_EXPR_PATH_RE =
  /build\/\$\{\{\s*[^}]+\}\}\/[^"'`\s]*\/out\/(?:Final|Release|Stripped|Compressed|Optimized|Synced)/g

const isInsideComputePathsBlock = (
  lines: string[],
  lineIdx: number,
): boolean => {
  // Walk backwards up to 60 lines looking for the start of the
  // current step. If that step is a "Compute paths" step, the line
  // is exempt.
  for (let i = lineIdx; i >= Math.max(0, lineIdx - 60); i--) {
    const l = lines[i] ?? ''
    if (/^\s*-\s*name:/i.test(l)) {
      // Step boundary — check if THIS step is a Compute paths step.
      // The step body may include `id: paths` even if the name is
      // something else (e.g. `id: stub-paths`), so look at the next
      // ~20 lines for either marker.
      for (let j = i; j < Math.min(lines.length, i + 20); j++) {
        const m = lines[j] ?? ''
        if (
          /^\s*-\s*name:\s*Compute\s+[\w-]+\s+paths/i.test(m) ||
          /^\s*id:\s*[\w-]*paths\s*$/i.test(m)
        ) {
          return true
        }
        if (j > i && /^\s*-\s*name:/i.test(m)) {
          // Hit the next step — current step is NOT Compute paths.
          return false
        }
      }
      return false
    }
  }
  return false
}

const scanWorkflowFile = (relPath: string): void => {
  const full = path.join(REPO_ROOT, relPath)
  let content: string
  try {
    content = readFileSync(full, 'utf8')
  } catch {
    return
  }
  const lines = content.split('\n')

  // First pass: collect every hand-built path occurrence outside a
  // "Compute paths" step. Per the mantra, a single reference is fine
  // — what's banned is reconstructing the same path 2+ times.
  type PathHit = {
    line: number
    snippet: string
    pathStr: string
  }
  const occurrences = new Map<string, PathHit[]>()

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (/^\s*#/.test(line)) {
      // Skip comment lines from C scan; they're under D below.
      continue
    }
    if (isInsideComputePathsBlock(lines, i)) {
      // Inside the canonical construction step — exempt.
      continue
    }
    WORKFLOW_PATH_RE.lastIndex = 0
    WORKFLOW_GH_EXPR_PATH_RE.lastIndex = 0
    const matches: string[] = []
    let m: RegExpExecArray | null
    while ((m = WORKFLOW_PATH_RE.exec(line)) !== null) {
      matches.push(m[0])
    }
    while ((m = WORKFLOW_GH_EXPR_PATH_RE.exec(line)) !== null) {
      matches.push(m[0])
    }
    for (const pathStr of matches) {
      const list = occurrences.get(pathStr) ?? []
      list.push({ line: i + 1, snippet: line.trim(), pathStr })
      occurrences.set(pathStr, list)
    }
  }

  // Flag every occurrence of a shape that appears 2+ times.
  for (const [pathStr, hits] of occurrences) {
    if (hits.length < 2) {
      continue
    }
    for (const hit of hits) {
      findings.push({
        rule: 'C',
        file: relPath,
        line: hit.line,
        snippet: hit.snippet,
        message: `Workflow constructs the same path ${hits.length} times: ${pathStr}`,
        fix: 'Add a "Compute <pkg> paths" step (id: paths) early in the job that computes this path ONCE and exposes it via $GITHUB_OUTPUT. Reference as ${{ steps.paths.outputs.<name> }} in subsequent steps. References of the constructed value are unlimited; reconstructing is the violation.',
      })
    }
  }

  // Rule D: comments encoding a fully-qualified multi-stage path
  // (separate scan since it has different semantics).
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (!/^\s*#/.test(line)) {
      continue
    }
    const literalShape =
      /build\/(?:dev|prod|shared)\/[a-z0-9-]+\/(?:wasm\/)?out\/(?:Final|Release|Stripped|Compressed|Optimized|Synced)/i
    if (literalShape.test(line)) {
      findings.push({
        rule: 'D',
        file: relPath,
        line: i + 1,
        snippet: line.trim(),
        message: 'Comment encodes a fully-qualified path string.',
        fix: 'Cite the canonical paths.mts (e.g. "see packages/<pkg>/scripts/paths.mts:getBuildPaths()") instead of duplicating the path string. Comments may describe structure with placeholders ("<mode>/<arch>") but should not be a parsable path.',
      })
    }
  }
}

// ──────────────────────────────────────────────────────────────────
// Rule G: Makefile / Dockerfile / shell scan
// ──────────────────────────────────────────────────────────────────

const SCRIPT_HAND_BUILT_RE =
  /build\/\$?\{?(?:BUILD_MODE|MODE|prod|dev)\}?\/[\w${}.-]*\/out\/(?:Final|Release|Stripped|Compressed|Optimized|Synced)/g

const scanScriptFile = (relPath: string): void => {
  const full = path.join(REPO_ROOT, relPath)
  let content: string
  try {
    content = readFileSync(full, 'utf8')
  } catch {
    return
  }
  const lines = content.split('\n')
  const isDockerfile =
    /Dockerfile/i.test(relPath) || /\.glibc$|\.musl$/.test(relPath)

  // First pass: collect every multi-stage path occurrence in this file,
  // scoped per Dockerfile stage (each `FROM ... AS ...` starts a new
  // scope where ENV/ARG don't propagate).
  type Hit = { line: number; text: string; pathStr: string; stage: number }
  const hits: Hit[] = []
  let stage = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (/^\s*#/.test(line)) {
      // Skip comments — documentation, not construction.
      continue
    }
    if (isDockerfile && /^FROM\s+/i.test(line)) {
      stage += 1
      continue
    }
    SCRIPT_HAND_BUILT_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = SCRIPT_HAND_BUILT_RE.exec(line)) !== null) {
      hits.push({
        line: i + 1,
        text: line.trim(),
        pathStr: m[0],
        stage,
      })
    }
  }

  // Group by (stage, pathStr) — only flag when a path is built 2+
  // times within the SAME Dockerfile stage (or anywhere in non-
  // Dockerfile scripts, where stages don't apply).
  const grouped = new Map<string, Hit[]>()
  for (const h of hits) {
    const key = `${h.stage}::${h.pathStr}`
    const list = grouped.get(key) ?? []
    list.push(h)
    grouped.set(key, list)
  }
  for (const [, list] of grouped) {
    if (list.length < 2) {
      continue
    }
    for (const hit of list) {
      findings.push({
        rule: 'G',
        file: relPath,
        line: hit.line,
        snippet: hit.text,
        message: `Hand-built multi-stage path constructed ${list.length} times in this file: ${hit.pathStr}`,
        fix: 'Assign to a variable / ENV once near the top of the script / Dockerfile stage, with a comment naming the canonical paths.mts. Reference the variable everywhere downstream. References of a single construction are unlimited; reconstructing the same path is the violation.',
      })
    }
  }
}

// ──────────────────────────────────────────────────────────────────
// Rule F: cross-file path repetition
// ──────────────────────────────────────────────────────────────────

const checkRuleF = (): void => {
  // A path is "constructed" each time we see a new path.join with a
  // matching shape. Group findings of Rule A by their snippet shape;
  // when the same shape appears in 2+ files, demote them to Rule F so
  // the message is more accurate.
  const byShape = new Map<string, Finding[]>()
  for (const f of findings) {
    if (f.rule !== 'A') {
      continue
    }
    // Normalize: strip whitespace, identifiers, surrounding context;
    // keep just the literal path-segment shape.
    const literalsRe = /'[^']*'|"[^"]*"/g
    const literals = (f.snippet.match(literalsRe) ?? []).join(',')
    if (!literals) {
      continue
    }
    const list = byShape.get(literals) ?? []
    list.push(f)
    byShape.set(literals, list)
  }
  for (const [shape, list] of byShape) {
    if (list.length < 2) {
      continue
    }
    // Promote each Rule-A finding in this group to Rule F so the
    // message tells the reader the issue is cross-file repetition,
    // not just a single hand-build.
    for (const f of list) {
      f.rule = 'F'
      f.message = `Same path shape constructed in ${list.length} places: ${shape.slice(0, 100)}`
      f.fix =
        'Construct this path ONCE in a paths.mts (or build-infra helper) and import the computed value. References of the computed variable are unlimited; re-constructing the same shape twice is the violation.'
    }
  }
}

// ──────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────

const main = (): number => {
  // Scan code files (Rule A + B).
  for (const rel of walk(
    REPO_ROOT,
    p => p.endsWith('.mts') || p.endsWith('.cts'),
  )) {
    if (isExempt(rel)) {
      continue
    }
    scanCodeFile(rel)
  }
  // Scan workflows (Rule C + D).
  const workflowDir = path.join(REPO_ROOT, '.github', 'workflows')
  if (existsSync(workflowDir)) {
    for (const rel of walk(workflowDir, p => p.endsWith('.yml'))) {
      if (isExempt(rel)) {
        continue
      }
      scanWorkflowFile(rel)
    }
  }
  // Scan scripts/Makefiles/Dockerfiles (Rule G).
  for (const rel of walk(REPO_ROOT, p => {
    const base = path.basename(p)
    return (
      base === 'Makefile' ||
      base.endsWith('.mk') ||
      base.endsWith('.Dockerfile') ||
      base === 'Dockerfile' ||
      base.endsWith('.glibc') ||
      base.endsWith('.musl') ||
      (base.endsWith('.sh') && !p.includes('test/'))
    )
  })) {
    if (isExempt(rel)) {
      continue
    }
    scanScriptFile(rel)
  }
  // Promote cross-file Rule-A repeats to Rule F.
  checkRuleF()

  // Filter against allowlist.
  const blocking = findings.filter(f => !isAllowlisted(f))

  if (args.values.json) {
    process.stdout.write(
      JSON.stringify(
        { findings: blocking, allowlisted: findings.length - blocking.length },
        null,
        2,
      ) + '\n',
    )
    return blocking.length === 0 ? 0 : 1
  }

  if (blocking.length === 0) {
    if (!args.values.quiet) {
      logger.success('Path-hygiene check passed (1 path, 1 reference)')
      if (findings.length > 0) {
        logger.substep(`${findings.length} finding(s) allowlisted`)
      }
    }
    return 0
  }

  logger.error(
    `Path-hygiene check FAILED — ${blocking.length} finding(s)`,
  )
  logger.log('')
  logger.log('Mantra: 1 path, 1 reference')
  logger.log('')
  for (const f of blocking) {
    logger.log(`  [${f.rule}] ${f.file}:${f.line}`)
    logger.log(`      ${f.snippet}`)
    logger.log(`      → ${f.message}`)
    if (args.values.explain) {
      logger.log(`      Fix: ${f.fix}`)
    }
    logger.log('')
  }
  if (!args.values.explain) {
    logger.log('Run with --explain to see fix suggestions per finding.')
    logger.log(
      'Add intentional exceptions to .github/paths-allowlist.yml with a `reason` field.',
    )
  }
  return 1
}

try {
  process.exitCode = main()
} catch (e) {
  logger.error(`Path-hygiene gate crashed: ${e}`)
  process.exitCode = 2
}
