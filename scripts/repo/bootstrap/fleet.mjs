#!/usr/bin/env node
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import crypto, { randomUUID } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import path, { dirname, resolve, sep } from 'node:path'
import process$1 from 'node:process'
import { format } from 'node:util'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import https from 'node:https'

var __commonJSMin = (cb, mod) => () => (
  mod || (cb((mod = { exports: {} }).exports, mod), (cb = null)),
  mod.exports
)
var __require = /* #__PURE__ */ (() => createRequire(import.meta.url))()

const POINTER_TEXT =
  'The authoritative engineering rules for this repository are in `./AGENTS.md` (`./CLAUDE.md` imports the same file). Read and follow them.\n'
const POINTER_BODY = '# Engineering rules\n\n' + POINTER_TEXT
const CURSOR_MDC =
  '---\ndescription: Socket fleet engineering rules (canonical source is ./AGENTS.md)\nglobs:\nalwaysApply: true\n---\n\n' +
  POINTER_BODY +
  '\n@AGENTS.md\n'
const CLAUDE_MD = POINTER_BODY + '\n@AGENTS.md\n'
const KIRO_MD =
  '---\ntitle: Socket fleet engineering rules\ninclusion: always\n---\n\n' +
  POINTER_TEXT
function renderAdapterCopy(adapter, source) {
  let content = source
  for (const replacement of adapter.replacements ?? [])
    content = content.replaceAll(replacement.from, () => replacement.to)
  return content
}
const ADAPTER_SRC_DIR = import.meta.dirname
const OPENCODE_GUARDS_SRC = path.join(ADAPTER_SRC_DIR, 'fleet-guards.mts')
const ADAPTERS = [
  {
    content: CLAUDE_MD,
    dest: 'CLAUDE.md',
    kind: 'file',
  },
  {
    dest: '.clinerules/socket.md',
    kind: 'symlink',
  },
  {
    content: CURSOR_MDC,
    dest: '.cursor/rules/socket.mdc',
    kind: 'file',
  },
  {
    dest: '.github/copilot-instructions.md',
    kind: 'symlink',
  },
  ...['server', 'tool'].map(name => ({
    __proto__: null,
    dest: `.opencode/_shared/opencode/${name}.mts`,
    kind: 'copy',
    sourceRel: `scripts/fleet/gen/_shared/opencode/${name}.mts`,
    src: path.join(ADAPTER_SRC_DIR, '../_shared/opencode', `${name}.mts`),
  })),
  {
    content: KIRO_MD,
    dest: '.kiro/steering/socket.md',
    kind: 'file',
  },
  {
    dest: '.opencode/plugins/fleet-guards.ts',
    kind: 'copy',
    replacements: [
      {
        from: "from '../../paths/util.mts'",
        to: "from '../../scripts/fleet/paths/util.mts'",
      },
      {
        from: "from '../../cli/terminal-link.mts'",
        to: "from '../../scripts/fleet/cli/terminal-link.mts'",
      },
      {
        from: "from '../../cross-cli/util.mts'",
        to: "from '../../scripts/fleet/cross-cli/util.mts'",
      },
    ],
    sourceRel: 'scripts/fleet/gen/harness-adapters/fleet-guards.mts',
    src: OPENCODE_GUARDS_SRC,
  },
  {
    dest: '.windsurf/rules/socket.md',
    kind: 'symlink',
  },
]

const LEGACY_RULE_FILE = 'CLAUDE.md'
const RULE_FILE = 'AGENTS.md'
function ruleStat(file) {
  return lstatSync(file, { throwIfNoEntry: false })
}
function isRulePointer(body) {
  const oldBody = POINTER_BODY.slice(21)
  return [POINTER_BODY, oldBody].some(
    pointer =>
      body.trim() === pointer.trim() ||
      body.trim() === (pointer + '\n@AGENTS.md\n').trim(),
  )
}
function isGeneratedRuleBody(body) {
  const normalized = body.replaceAll('\r\n', '\n')
  if (isRulePointer(normalized)) return true
  const oldBody = POINTER_BODY.slice(21)
  if (
    ![
      '# Engineering rules\n\nThe authoritative engineering rules for this repository are in `./AGENTS.md` (`./CLAUDE.md` imports the same file). Read and follow them.\n',
      oldBody,
    ].some(pointer => normalized.trimStart().startsWith(pointer.trimEnd()))
  )
    return false
  const lines = normalized.split(/\r?\n/)
  const markers = lines.filter(line =>
    /^\s*<!--\s*(?:(?:BEGIN|END)\s+)?<?\/?\s*fleet\b/i.test(line),
  )
  const starts = lines.flatMap((line, index) => {
    const match =
      /^\s*<!--\s*(?:BEGIN\s+)?<(fleet(?:-canonical)?)>\s*-->\s*$/i.exec(line)
    return match ? [[index, match[1].toLowerCase()]] : []
  })
  const ends = lines.flatMap((line, index) => {
    const match =
      /^\s*<!--\s*(?:END\s+)?<\/(fleet(?:-canonical)?)>\s*-->\s*$/i.exec(line)
    return match ? [[index, match[1].toLowerCase()]] : []
  })
  if (markers.length === 0) return false
  if (
    markers.length !== 2 ||
    starts.length !== 1 ||
    ends.length !== 1 ||
    starts[0][0] >= ends[0][0] ||
    starts[0][1] !== ends[0][1]
  )
    throw new Error(
      'Cannot classify engineering rules. Where: generated rule pointer. Saw: ambiguous fleet markers; wanted: one complete fleet block. Fix: restore authored AGENTS.md before continuing.',
    )
  return isRulePointer(
    [...lines.slice(0, starts[0][0]), ...lines.slice(ends[0][0] + 1)].join(
      '\n',
    ),
  )
}
function committedRuleBody(dest, revision) {
  const entry = execFileSync(
    'git',
    ['ls-tree', revision, '--', LEGACY_RULE_FILE],
    {
      cwd: dest,
      encoding: 'utf8',
    },
  )
  const match = /^(100644|100755) blob ([a-f0-9]+)\tCLAUDE\.md\n$/.exec(entry)
  if (!match) return
  return execFileSync('git', ['cat-file', 'blob', match[2]], {
    cwd: dest,
    encoding: 'utf8',
  })
}
function recoverRuleAuthority(dest) {
  if (committedRuleBody(dest, 'HEAD') === void 0)
    throw new Error(
      `Cannot recover engineering rules in ${dest}: HEAD:CLAUDE.md is not a regular tracked file. Restore authored AGENTS.md before continuing.`,
    )
  const revisions = execFileSync(
    'git',
    ['rev-list', '--first-parent', '--max-count=32', 'HEAD'],
    {
      cwd: dest,
      encoding: 'utf8',
    },
  )
    .trim()
    .split(/\r?\n/)
  for (let i = 0, { length } = revisions; i < length; i += 1) {
    const revision = revisions[i]
    const body = committedRuleBody(dest, revision)
    if (body?.trim() && !isGeneratedRuleBody(body)) return body
  }
  throw new Error(
    `Cannot recover engineering rules in ${dest}: the latest 32 first-parent commits contain no authored CLAUDE.md. Restore authored AGENTS.md before continuing.`,
  )
}
function migrateRuleFile(dest, options) {
  const { preservedPaths } = {
    __proto__: null,
    ...options,
  }
  if (preservedPaths?.has('CLAUDE.md') || preservedPaths?.has('AGENTS.md'))
    return false
  return migrateUnpreservedRuleFile(dest)
}
function migrateUnpreservedRuleFile(dest) {
  const legacy = path.join(dest, LEGACY_RULE_FILE)
  const current = path.join(dest, RULE_FILE)
  const currentStat = ruleStat(current)
  if (currentStat?.isSymbolicLink()) {
    const target = readlinkSync(current)
    if (target !== 'CLAUDE.md' && target !== './CLAUDE.md')
      throw new Error(
        `Cannot migrate engineering rules at ${current}: unexpected symlink target. Restore a regular AGENTS.md before continuing.`,
      )
  } else if (currentStat) {
    if (!currentStat.isFile())
      throw new Error(
        `Cannot migrate engineering rules at ${current}: expected a regular file. Restore authored AGENTS.md before continuing.`,
      )
    if (!isGeneratedRuleBody(readFileSync(current, 'utf8'))) return false
  }
  const legacyStat = ruleStat(legacy)
  if (!legacyStat && !currentStat) return false
  if (!legacyStat?.isFile())
    throw new Error(
      `Cannot migrate engineering rules at ${legacy}: expected a regular authored file. Restore authored AGENTS.md before continuing.`,
    )
  const body = readFileSync(legacy, 'utf8')
  if (!isGeneratedRuleBody(body)) {
    if (!body.trim())
      throw new Error(
        `Cannot migrate engineering rules at ${legacy}: the file is empty. Restore authored AGENTS.md before continuing.`,
      )
    renameSync(legacy, current)
    return true
  }
  const recovered = recoverRuleAuthority(dest)
  const temporary = current + '.' + crypto.randomUUID() + '.tmp'
  writeFileSync(temporary, recovered, { flag: 'wx' })
  try {
    renameSync(temporary, current)
  } finally {
    if (ruleStat(temporary)) unlinkSync(temporary)
  }
  return true
}

function updateGitignoreOwners(stack, marker) {
  const name = marker[2].replace(/-canonical$/, '')
  if (marker[1] === '/') {
    if (stack.pop() !== name)
      throw new TypeError(
        'Invalid .gitignore: unmatched ownership marker. Balance its ownership markers.',
      )
    return
  }
  const isChild = name === 'fleet-allowlist' || name === 'fleet-pack'
  if (stack.length && (!isChild || stack.at(-1) !== 'fleet'))
    throw new TypeError(
      'Invalid .gitignore: nested ownership region. Balance its ownership markers.',
    )
  stack.push(name)
}
function gitignoreOwner(stack, defaultOwner) {
  const name = stack.at(-1)
  if (name === 'fleet-pack') return 'pack'
  if (name === 'fleet-allowlist') return 'fleetAllowlist'
  if (name === 'repo') return 'repo'
  return name === 'fleet' ? 'fleet' : defaultOwner
}
function parseGitignoreSections(source, options) {
  const config = {
    __proto__: null,
    ...options,
  }
  const sections = {
    __proto__: null,
    fleet: [],
    fleetAllowlist: [],
    pack: [],
    repo: [],
    denyByDefault: false,
  }
  const stack = []
  const lines = source.split(/\r?\n/)
  const hasFleetRegion = lines.some(line =>
    /^# <\/?fleet(?:-canonical)?>$/.test(line),
  )
  const hasRepoRegion = lines.some(line =>
    /^# <\/?repo(?:-canonical)?>$/.test(line),
  )
  const defaultOwner =
    config.unmarkedOwner ??
    (hasFleetRegion || !hasRepoRegion ? 'repo' : 'fleet')
  for (let index = 0, { length } = lines; index < length; index += 1) {
    const line = lines[index]
    const marker =
      /^# <(\/?)(fleet(?:-canonical)?|fleet-allowlist|fleet-pack|repo(?:-canonical)?)>$/.exec(
        line,
      )
    if (marker) {
      updateGitignoreOwners(stack, marker)
      continue
    }
    const owner = gitignoreOwner(stack, defaultOwner)
    if (line === '*' && (owner === 'fleet' || owner === 'repo'))
      sections.denyByDefault = true
    else sections[owner].push(line)
  }
  if (stack.length)
    throw new TypeError(
      'Invalid .gitignore: unclosed ownership region. Balance its ownership markers.',
    )
  if (sections.denyByDefault) {
    sections.fleet = sections.fleet.filter(line => line !== '!*/')
    sections.repo = sections.repo.filter(line => line !== '!*/')
  }
  sections.fleet = trimGitignoreLines(sections.fleet)
  sections.fleetAllowlist = trimGitignoreLines(sections.fleetAllowlist)
  sections.pack = trimGitignoreLines(sections.pack)
  sections.repo = trimGitignoreLines(sections.repo)
  return sections
}
function trimGitignoreLines(lines) {
  const result = [...lines]
  while (result[0]?.trim() === '') result.shift()
  while (result.at(-1)?.trim() === '') result.pop()
  return result
}
function closeGitignorePackDirectories(allowed, pack) {
  const roots = pack
    .filter(
      line =>
        line &&
        !line.startsWith('!') &&
        !line.startsWith('#') &&
        !line.includes('?') &&
        !line.includes('[') &&
        !line.includes(']'),
    )
    .map(line => {
      const entry = line
        .replace(/^\//, '')
        .replace(/\/\*$/, '')
        .replace(/\/$/, '')
      const fleet = entry.indexOf('/fleet/')
      return fleet < 0 ? entry : entry.slice(0, fleet + 6)
    })
  const result = []
  const seen = /* @__PURE__ */ new Set()
  for (const line of allowed) {
    if (!seen.has(line)) {
      result.push(line)
      seen.add(line)
    }
    if (!line.startsWith('!/') || !line.endsWith('/')) continue
    const directory = line.slice(2, -1)
    if (
      !roots.some(
        root => directory === root || directory.startsWith(`${root}/`),
      )
    )
      continue
    const closure = `/${directory}/*`
    if (!seen.has(closure)) {
      result.push(closure)
      seen.add(closure)
    }
  }
  return result
}
function composeGitignore(config) {
  const options = {
    __proto__: null,
    ...config,
  }
  const current = parseGitignoreSections(options.target)
  const fleetBlockSections =
    options.fleetBlock === void 0
      ? void 0
      : parseGitignoreSections(options.fleetBlock, { unmarkedOwner: 'fleet' })
  const repoBlockSections =
    options.repoBlock === void 0
      ? void 0
      : parseGitignoreSections(options.repoBlock, { unmarkedOwner: 'repo' })
  const fleet =
    fleetBlockSections === void 0 ? current.fleet : fleetBlockSections.fleet
  const allowed =
    options.fleetAllowlist === void 0
      ? current.fleetAllowlist
      : parseGitignoreSections(options.fleetAllowlist).fleetAllowlist
  const pack =
    options.packBlock === void 0
      ? current.pack
      : parseGitignoreSections(options.packBlock).pack
  const repo =
    repoBlockSections === void 0 ? current.repo : repoBlockSections.repo
  return [
    ...((options.denyByDefault ??
    (options.target.trim() === ''
      ? (fleetBlockSections?.denyByDefault ?? current.denyByDefault)
      : current.denyByDefault))
      ? ['*', '!*/']
      : []),
    ...trimGitignoreLines(fleet),
    ...(pack.length
      ? ['# <fleet-pack>', ...trimGitignoreLines(pack), '# </fleet-pack>']
      : []),
    '# <repo>',
    ...trimGitignoreLines(repo),
    '# </repo>',
    ...(allowed.length
      ? [
          '# <fleet-allowlist>',
          ...closeGitignorePackDirectories(allowed, pack),
          '# </fleet-allowlist>',
        ]
      : []),
    '',
  ].join('\n')
}

function sharedScriptsRepoCommitCascadeManifestFleetFilesJsonPath(root) {
  return path.join(
    root,
    'scripts',
    'repo',
    'commit-cascade',
    'manifest',
    'fleet-files.json',
  )
}
function sharedSystem32TarExePath(root) {
  return path.join(root, 'System32', 'tar.exe')
}
function sharedTemplateBasePath(root) {
  return path.join(root, 'template', 'base', 'universal')
}

const HYBRID_BUNDLE_PATHS = /* @__PURE__ */ new Set([
  '.gitattributes',
  '.gitignore',
  'AGENTS.md',
])
/**
 * Normalize bundle-manifest paths to their portable `/` wire format.
 */
function normalizeBundlePath(filePath) {
  return filePath.replaceAll('\\', '/')
}
function tarExecutable(platform, systemRoot) {
  return platform === 'win32'
    ? sharedSystem32TarExePath(systemRoot ?? 'C:\\Windows')
    : 'tar'
}
/**
 * Build extraction arguments for the platform-selected tar executable.
 */
function tarExtractArgs(config) {
  const cfg = {
    __proto__: null,
    ...config,
  }
  return ['-xzf', cfg.archive, '-C', cfg.destination]
}
function errorMessage(e) {
  if (e instanceof Error) return e.message
  return String(e)
}
/**
 * Compute the SHA-256 hex digest of a Buffer — used for both files (byte-
 * identical verification) and fleet-block segments.
 */
function computeSha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex')
}
/**
 * The open marker line for a given comment style — canonical short-tag
 * bare-tag form, matching the grammar used by fleet-markers.mts on the
 * producer side. Inlined here so this file stays dep-0 — it cannot import
 * the wheelhouse's fleet-markers module.
 */
function beginMarker(style) {
  if (style === 'html') return '<!-- <fleet> -->'
  if (style === 'slash') return '// <fleet>'
  return '# <fleet>'
}
/**
 * The close marker line for a given comment style — canonical short-tag
 * bare-tag form.
 */
function endMarker(style) {
  if (style === 'html') return '<!-- </fleet> -->'
  if (style === 'slash') return '// </fleet>'
  return '# </fleet>'
}
/**
 * The open marker for the fetcher-owned `<fleet-pack>` gitignore region — the
 * manifest-derived untrack entries live here, OUTSIDE the cascade's `<fleet>`
 * region, so the cascade's block rewrite can never discard them (the defect
 * that re-tracked every hydrated payload file on the next cascade). Hash form
 * only: the region exists solely in `.gitignore`.
 */
function packBeginMarker() {
  return '# <fleet-pack>'
}
/**
 * The close marker for the fetcher-owned `<fleet-pack>` gitignore region.
 */
function packEndMarker() {
  return '# </fleet-pack>'
}
/**
 * Replace the nested fleet-pack inventory and preserve repo overrides.
 */
function splicePackBlock(config) {
  return composeGitignore({
    target: config.target,
    packBlock: config.packBlock,
  })
}
/**
 * Every balanced fleet block in `lines`, in document order. Each open marker
 * pairs with the NEXT close marker after it, and the scan resumes past that
 * close — so a file carrying several stacked blocks reports one span per block
 * rather than one span swallowing them all. An unclosed trailing open marker
 * yields no span: an unbalanced file is left for a human, never half-rewritten.
 */
function findFleetBlockSpans(lines, commentStyle) {
  const begin = beginMarker(commentStyle)
  const end = endMarker(commentStyle)
  const spans = []
  for (let i = 0, { length } = lines; i < length; i += 1) {
    if (lines[i] !== begin) continue
    let close = -1
    for (let j = i + 1; j < length; j += 1)
      if (lines[j] === end) {
        close = j
        break
      }
    if (close === -1) break
    spans.push({
      end: close,
      start: i,
    })
    i = close
  }
  return spans
}
/**
 * Splice the canonical fleet block into `target`. If `target` already contains
 * the open/close markers, the content between them (markers inclusive) is
 * replaced. A file carrying SEVERAL stacked blocks collapses to one: the first
 * is replaced with `fleetBlock` and every later one is deleted, so a member
 * whose file grew a second managed region ends up with one region instead of a
 * growing stack. Content outside the matched blocks is preserved
 * byte-for-byte, except that removing a block sandwiched between blank lines
 * drops one of them rather than leaving a doubled blank.
 * If markers are absent:
 *
 * - `html` style (CLAUDE.md, README): insert before the first level-2 heading
 *   (`## `) with i > 0, or append at end.
 * - Other styles: append with a leading blank line separator.
 */
function spliceFleetBlock(config) {
  const { commentStyle, fleetBlock, target } = {
    __proto__: null,
    ...config,
  }
  const lines = target.split('\n')
  const spans = findFleetBlockSpans(lines, commentStyle)
  const anchor = spans[0]
  if (anchor !== void 0) {
    const out = [...lines.slice(0, anchor.start), fleetBlock]
    let cursor = anchor.end + 1
    for (let i = 1, { length } = spans; i < length; i += 1) {
      const span = spans[i]
      const between = lines.slice(cursor, span.start)
      if (between.at(-1) === '' && lines[span.end + 1] === '') between.pop()
      out.push(...between)
      cursor = span.end + 1
    }
    out.push(...lines.slice(cursor))
    return out.join('\n')
  }
  if (commentStyle === 'html') {
    let insertIdx = lines.length
    for (const [i, line] of lines.entries())
      if (i > 0 && line.startsWith('## ')) {
        insertIdx = i
        break
      }
    const before = lines.slice(0, insertIdx)
    const after = lines.slice(insertIdx)
    return [...before, fleetBlock, '', ...after].join('\n')
  }
  return `${target.replace(/\n+$/, '')}\n\n${fleetBlock}\n`
}
function run(cmd, args) {
  execFileSync(cmd, args, {
    stdio: process$1.argv.includes('--json')
      ? ['inherit', 2, 'inherit']
      : 'inherit',
  })
}
function segmentFileName(relativePath) {
  return `${relativePath.replace(/^\./, 'dot-')}.fleetblock`
}
function readManifest(manifestPath) {
  return JSON.parse(readFileSync(manifestPath, 'utf8'))
}
/**
 * Verify every file in `manifest.files` against its expected SHA-256 digest.
 * Returns a list of problem descriptions — empty means all verified. A single
 * mismatch must abort the whole install (fail closed).
 */
function verifyBundleFiles(filesDir, manifest) {
  const problems = []
  for (const [rel, expected] of Object.entries(manifest.files)) {
    const abs = path.join(filesDir, rel)
    if (!existsSync(abs)) {
      problems.push(`missing from bundle: ${rel}`)
      continue
    }
    const actual = computeSha256(readFileSync(abs))
    if (actual !== expected)
      problems.push(`sha256 mismatch: ${rel} (got ${actual}, want ${expected})`)
  }
  return problems
}
/**
 * Verify every generic block segment and the specialized Claude settings
 * segment against its expected SHA-256. A mismatch is just as fatal as a file
 * mismatch — the merge result would silently differ from producer intent.
 */
function verifySegments(segmentsDir, manifest) {
  const segments = manifest.segments
  const problems = []
  for (const entry of segments ?? []) {
    const destName = segmentFileName(entry.path)
    const abs = path.join(segmentsDir, destName)
    if (!existsSync(abs)) {
      problems.push(`missing segment: ${entry.path}`)
      continue
    }
    const actual = computeSha256(readFileSync(abs))
    if (actual !== entry.sha256)
      problems.push(
        `sha256 mismatch for segment ${entry.path} (got ${actual}, want ${entry.sha256})`,
      )
  }
  const settingsSegment = manifest.settingsSegment
  if (settingsSegment !== void 0) {
    const abs = path.join(segmentsDir, segmentFileName(settingsSegment.path))
    if (!existsSync(abs))
      problems.push(`missing settings segment: ${settingsSegment.path}`)
    else {
      const actual = computeSha256(readFileSync(abs))
      if (actual !== settingsSegment.sha256)
        problems.push(
          `sha256 mismatch for settings segment ${settingsSegment.path} (got ${actual}, want ${settingsSegment.sha256})`,
        )
    }
  }
  return problems
}

const SETTINGS_CANDIDATES = [
  '.config/repo/socket-wheelhouse.json',
  '.config/socket-wheelhouse.json',
  '.socket-wheelhouse.json',
]
function resolveSettingsPath(dest) {
  for (let i = 0, { length } = SETTINGS_CANDIDATES; i < length; i += 1) {
    const p = path.join(dest, SETTINGS_CANDIDATES[i])
    if (existsSync(p)) return p
  }
}
const APPLIED_MARKER = '.cache/fleet/socket-wheelhouse/bundle-applied'
const APPLIED_FILES_MARKER = '.cache/fleet/socket-wheelhouse/applied-files'
const APPLIED_MANIFEST_MARKER =
  '.cache/fleet/socket-wheelhouse/applied-manifest.json'
function readAppliedManifest(dest) {
  try {
    const parsed = JSON.parse(
      readFileSync(path.join(dest, APPLIED_MANIFEST_MARKER), 'utf8'),
    )
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      !Object.entries(parsed).every(([file, digest]) => {
        const normalizedFile = normalizeBundlePath(file)
        return (
          file === normalizedFile &&
          normalizedFile.length > 0 &&
          !normalizedFile.startsWith('/') &&
          !/^[A-Za-z]:\//.test(normalizedFile) &&
          !normalizedFile.split('/').includes('..') &&
          typeof digest === 'string' &&
          /^[0-9a-f]{64}$/.test(digest)
        )
      })
    )
      return
    return parsed
  } catch {
    return
  }
}
/**
 * The member's build shape — `build.from` / `build.type` in its wheelhouse
 * settings file. Drives the manifest's shape-scoped file groups: a group is
 * placed only for shapes that ship it. Undefined fields on an absent or
 * malformed config read as "shape unknown", which the filter treats as
 * ship-everything so a config problem can never withhold payload.
 */
function readBuildShape(dest) {
  const p = resolveSettingsPath(dest)
  if (!p)
    return {
      from: void 0,
      type: void 0,
    }
  try {
    const json = JSON.parse(readFileSync(p, 'utf8'))
    return {
      from: json.build?.from,
      type: json.build?.type,
    }
  } catch {
    return {
      from: void 0,
      type: void 0,
    }
  }
}
/**
 * The member's declared capabilities — the `capabilities` map in its
 * wheelhouse settings file (an empty or ABSENT map declares NONE, matching
 * the cascade-side gate). Drives the manifest's capability-scoped hook
 * groups: a `@capability`-tagged hook is placed only when the member
 * declares the capability.
 */
function readDeclaredCapabilities(dest) {
  const p = resolveSettingsPath(dest)
  if (!p) return
  try {
    const json = JSON.parse(readFileSync(p, 'utf8'))
    return Object.keys(json.capabilities ?? {})
  } catch {
    return
  }
}
function readAppliedRef(dest) {
  const p = path.join(dest, APPLIED_MARKER)
  return existsSync(p) ? readFileSync(p, 'utf8').trim() : void 0
}
/**
 * The file list the LAST applied bundle owned, or undefined when no record
 * exists. Feeds pruneStaleFleetFiles — see APPLIED_FILES_MARKER.
 */
function readAppliedFiles(dest) {
  const p = path.join(dest, APPLIED_FILES_MARKER)
  if (!existsSync(p)) return
  return readFileSync(p, 'utf8')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
}
/**
 * Record the manifest file list the apply just placed, replacing the previous
 * record. Written after a successful apply only, beside the applied-ref
 * marker.
 */
function writeAppliedFiles(dest, files) {
  const p = path.join(dest, APPLIED_FILES_MARKER)
  mkdirSync(path.dirname(p), { recursive: true })
  const normalized = files.map(normalizeBundlePath).toSorted()
  writeFileSync(p, `${normalized.join('\n')}\n`)
}
function writeAppliedManifest(dest, manifest) {
  const p = path.join(dest, APPLIED_MANIFEST_MARKER)
  mkdirSync(path.dirname(p), { recursive: true })
  const normalized = Object.fromEntries(
    Object.entries(manifest)
      .map(([file, digest]) => [normalizeBundlePath(file), digest])
      .toSorted(([left], [right]) => left.localeCompare(right)),
  )
  writeFileSync(p, `${JSON.stringify(normalized)}\n`)
}
function writeAppliedRef(dest, ref) {
  const p = path.join(dest, APPLIED_MARKER)
  mkdirSync(path.dirname(p), { recursive: true })
  writeFileSync(p, `${ref}\n`)
}

function isWorkspaceRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function migrateWorkspaceSettings(dest, yaml) {
  const lines = yaml.split('\n')
  const kept = []
  const patterns = []
  let migrating = false
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (/^(confirmModulesPurge|managePackageManagerVersions):/.test(line)) {
      if (!/^[\w]+:\s*(true|false)\s*(?:#.*)?$/.test(line))
        throw new Error(
          `Unsupported workspace setting in ${dest}: expected a boolean. Fix pnpm-workspace.yaml.`,
        )
      continue
    }
    if (!/^catalogDriftIgnore:/.test(line)) {
      kept.push(line)
      continue
    }
    if (migrating || !/^catalogDriftIgnore:\s*(?:#.*)?$/.test(line))
      throw new Error(
        `Invalid drift exemptions in ${dest}: expected one block list. Fix pnpm-workspace.yaml.`,
      )
    migrating = true
    while (index + 1 < lines.length) {
      const entry = lines[index + 1]
      if (entry && !/^\s|^#/.test(entry)) break
      index += 1
      if (!entry.trim() || entry.trim().startsWith('#')) {
        kept.push(entry)
        continue
      }
      const match =
        /^\s+-\s+(?:'([^']+)'|"([^"\\]+)"|([^\s'"#\[\]{}&,]+))\s*(?:#.*)?$/.exec(
          entry,
        )
      if (!match)
        throw new Error(
          `Invalid drift exemption in ${dest}: expected a string list item. Fix pnpm-workspace.yaml.`,
        )
      patterns.push(match[1] ?? match[2] ?? match[3])
    }
  }
  if (migrating) {
    const configPath = path.join(dest, SETTINGS_CANDIDATES[0])
    const config = JSON.parse(readFileSync(configPath, 'utf8'))
    if (
      !isWorkspaceRecord(config) ||
      (config['workspace'] !== void 0 &&
        !isWorkspaceRecord(config['workspace']))
    )
      throw new Error(
        `Invalid workspace metadata at ${configPath}: expected objects. Fix the config before migration.`,
      )
    const workspace = config['workspace'] ?? {}
    const existing =
      workspace['catalogDriftIgnore'] === void 0
        ? []
        : workspace['catalogDriftIgnore']
    if (
      !Array.isArray(existing) ||
      !existing.every(value => typeof value === 'string')
    )
      throw new Error(
        `Invalid drift exemptions at ${configPath}: expected a string array. Fix workspace['catalogDriftIgnore'].`,
      )
    workspace['catalogDriftIgnore'] = [
      .../* @__PURE__ */ new Set([...existing, ...patterns]),
    ]
    config['workspace'] = workspace
    writeFileSync(configPath, `${JSON.stringify(config, void 0, 2)}\n`)
  }
  return kept.join('\n')
}

const COL0_KEY_RE = /^[A-Za-z][\w-]*:/
/**
 * Splice off a block's trailing separator run — the comment/blank lines at the
 * END of `blockLines` when the very last line is a comment. That run sits
 * directly above the NEXT top-level key, so it is that key's preamble, not
 * documentation of this block's last entry. Mutates `blockLines`; returns the
 * spliced run (empty when the block ends with content or blank lines only —
 * bare trailing blanks stay put as inter-block spacing).
 */
function spliceYamlSeparatorRun(blockLines) {
  const last = blockLines[blockLines.length - 1]
  if (blockLines.length < 2 || !last.trim().startsWith('#')) return []
  let start = blockLines.length
  while (start > 1) {
    const trimmed = blockLines[start - 1].trim()
    if (trimmed !== '' && !trimmed.startsWith('#')) break
    start -= 1
  }
  return blockLines.splice(start)
}
/**
 * Parse a YAML string into an ordered list of top-level key blocks. Each
 * block's `lines` run from the key line up to (not including) the next
 * column-0 key line or EOF — except a trailing comment run directly above the
 * next key, which attaches to that FOLLOWING block as its `head`: it is a
 * separator headed for the next key (the `overrides:` preamble in a member's
 * pnpm-workspace.yaml), and leaving it as body tail makes the entry-scoped
 * merge strand it mid-block when consumer-only entries append after it.
 * Comment lines before the first key become the first block's head.
 */
function parseYamlKeyBlocks(yaml) {
  const lines = yaml.split('\n')
  const blocks = []
  let preamble = []
  let current
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]
    if (COL0_KEY_RE.test(line)) {
      let head
      if (current !== void 0) {
        head = spliceYamlSeparatorRun(current.lines)
        blocks.push(current)
      } else {
        head = preamble
        preamble = []
      }
      const colonIdx = line.indexOf(':')
      current = {
        head,
        key: line.slice(0, colonIdx),
        lines: [line],
      }
    } else if (current !== void 0) current.lines.push(line)
    else preamble.push(line)
  }
  if (current !== void 0) blocks.push(current)
  return blocks
}
const MAP_ENTRY_RE = /^(\s+)(?:(['"])(.*?)\2|([^'"\n]+?)):(?:\s|$)/
const LIST_ITEM_RE = /^(\s+)-\s+(.*)$/
/**
 * Split a top-level key block's BODY lines into entry chunks. A chunk starts
 * at a map-entry or list-item line at the block's entry indent; comment and
 * blank lines BEFORE an entry attach to it as documentation for the entry
 * that immediately follows; deeper-indented lines are continuations. Comments
 * and blanks after the last entry come back as `trailing`, unattached, since
 * they document nothing that a merge can key on. Returns `undefined` when the
 * body has no recognizable entries — a scalar block, nothing nested to merge.
 */
function parseYamlEntryChunks(bodyLines) {
  const chunks = []
  let pending = []
  let current
  let entryIndent
  for (let i = 0, { length } = bodyLines; i < length; i += 1) {
    const line = bodyLines[i]
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) {
      pending.push(line)
      continue
    }
    const map = MAP_ENTRY_RE.exec(line)
    const item = map ? void 0 : LIST_ITEM_RE.exec(line)
    const indent = map ? map[1].length : item ? item[1].length : void 0
    if (
      indent !== void 0 &&
      (entryIndent === void 0 || indent === entryIndent)
    ) {
      entryIndent ??= indent
      if (current !== void 0) chunks.push(current)
      current = {
        id: map ? `k:${(map[3] ?? map[4]).trim()}` : `i:${item[2].trim()}`,
        lines: [...pending, line],
      }
      pending = []
      continue
    }
    if (current === void 0) return
    current.lines.push(...pending, line)
    pending = []
  }
  if (current !== void 0) chunks.push(current)
  else if (pending.length > 0) return
  return chunks.length > 0
    ? {
        chunks,
        trailing: pending,
      }
    : void 0
}
/**
 * Merge one fleet-managed top-level key block ENTRY-SCOPED — the workspace
 * analog of the Claude-settings splice that keeps repo hook registrations
 * inside the fleet-owned `hooks` key. Fleet-shipped entries (present in the
 * bundle block) take the bundle's text, comments included; member-local
 * entries that appear only in the consumer block survive in their original
 * order after the fleet set. Scalar-shaped workspace settings have no
 * nested entries, so the bundle block replaces wholesale. Trailing blank lines
 * follow the consumer block so inter-block spacing is preserved. The merged
 * block's head (the separator run above its key) is the BUNDLE's when the
 * bundle ships one — canonical text, and it retires a stale consumer copy —
 * falling back to the consumer's so local spacing and comments survive when
 * the bundle has none.
 */
function mergeYamlKeyBlock(bundleBlock, consumerBlock) {
  const stripTrailingBlanks = lines => {
    const out = [...lines]
    while (out.length > 0 && out[out.length - 1].trim() === '') out.pop()
    return out
  }
  const head =
    bundleBlock.head.length > 0 ? bundleBlock.head : consumerBlock.head
  const trailingBlankCount =
    consumerBlock.lines.length - stripTrailingBlanks(consumerBlock.lines).length
  const bundleBody = stripTrailingBlanks(bundleBlock.lines).slice(1)
  const consumerBody = stripTrailingBlanks(consumerBlock.lines).slice(1)
  const bundleParsed = parseYamlEntryChunks(bundleBody)
  const consumerParsed = parseYamlEntryChunks(consumerBody)
  if (bundleParsed === void 0 || consumerParsed === void 0)
    return {
      head,
      key: bundleBlock.key,
      lines: [
        ...stripTrailingBlanks(bundleBlock.lines),
        ...Array.from({ length: trailingBlankCount }, () => ''),
      ],
    }
  const bundleChunks = bundleParsed.chunks
  const consumerChunks = consumerParsed.chunks
  const bundleIds = new Set(bundleChunks.map(c => c.id))
  const merged = [bundleBlock.lines[0]]
  for (let i = 0, { length } = bundleChunks; i < length; i += 1)
    merged.push(...bundleChunks[i].lines)
  for (let i = 0, { length } = consumerChunks; i < length; i += 1) {
    const chunk = consumerChunks[i]
    if (!bundleIds.has(chunk.id)) merged.push(...chunk.lines)
  }
  merged.push(...bundleParsed.trailing)
  for (let i = 0; i < trailingBlankCount; i += 1) merged.push('')
  return {
    head,
    key: bundleBlock.key,
    lines: merged,
  }
}
/**
 * Merge the fleet-managed workspace sections from `bundleFleetSections` into
 * `consumerYaml`, scoped to the keys listed in `fleetKeys` — and, within each
 * fleet key, scoped to the ENTRIES the bundle ships (mergeYamlKeyBlock):
 * member-local nested entries (repo-specific `catalog:`/`overrides:` pins,
 * soak-exclude items, …) survive a refresh instead of being wholesale-dropped.
 * Non-fleet keys (including `packages:`) are preserved byte-exact. Throws on
 * ambiguous input.
 */
function mergeWorkspaceYaml(config) {
  const { bundleFleetSections, consumerYaml, fleetKeys } = {
    __proto__: null,
    ...config,
  }
  const consumerBlocks = parseYamlKeyBlocks(consumerYaml)
  const bundleBlocks = parseYamlKeyBlocks(bundleFleetSections)
  const fleetKeySet = new Set(fleetKeys)
  const consumerKeyCounts = /* @__PURE__ */ new Map()
  for (const block of consumerBlocks)
    if (fleetKeySet.has(block.key))
      consumerKeyCounts.set(
        block.key,
        (consumerKeyCounts.get(block.key) ?? 0) + 1,
      )
  for (const [key, count] of consumerKeyCounts)
    if (count > 1)
      throw new Error(
        `mergeWorkspaceYaml: fleet key "${key}" appears ${count} times at column 0 in consumerYaml — cannot merge safely`,
      )
  const bundleMap = /* @__PURE__ */ new Map()
  for (const block of bundleBlocks) bundleMap.set(block.key, block)
  const resultBlocks = []
  const handledFleetKeys = /* @__PURE__ */ new Set()
  for (const block of consumerBlocks)
    if (fleetKeySet.has(block.key)) {
      const bundleBlock = bundleMap.get(block.key)
      if (bundleBlock !== void 0)
        resultBlocks.push(mergeYamlKeyBlock(bundleBlock, block))
      else resultBlocks.push(block)
      handledFleetKeys.add(block.key)
    } else resultBlocks.push(block)
  for (const key of fleetKeys)
    if (!handledFleetKeys.has(key)) {
      const bundleBlock = bundleMap.get(key)
      if (bundleBlock !== void 0) resultBlocks.push(bundleBlock)
    }
  for (let i = 1; i < resultBlocks.length; i += 1) {
    if (resultBlocks[i].head.length === 0) continue
    const { lines } = resultBlocks[i - 1]
    while (lines.length > 1 && lines[lines.length - 1].trim() === '')
      lines.pop()
  }
  return `${resultBlocks
    .map(b => [...b.head, ...b.lines].join('\n'))
    .join('\n')
    .replace(/\n+$/, '')}\n`
}

function packageNameFromSpec(spec) {
  const normalized = spec.startsWith('/') ? spec.slice(1) : spec
  const separator = normalized.lastIndexOf('@')
  return separator > 0 ? normalized.slice(0, separator) : normalized
}
function dependencyGraphRequires(root, dependency) {
  const packageFile = path.join(root, 'package.json')
  if (existsSync(packageFile)) {
    const manifest = JSON.parse(readFileSync(packageFile, 'utf8'))
    if (manifest && typeof manifest === 'object' && !Array.isArray(manifest))
      for (const field of [
        'dependencies',
        'devDependencies',
        'optionalDependencies',
        'peerDependencies',
      ]) {
        const entries = manifest[field]
        if (!entries || typeof entries !== 'object' || Array.isArray(entries))
          continue
        if (Object.hasOwn(entries, dependency)) return true
        for (const spec of Object.values(entries))
          if (typeof spec === 'string' && spec.startsWith(`npm:${dependency}@`))
            return true
      }
  }
  const lockFile = path.join(root, 'pnpm-lock.yaml')
  if (!existsSync(lockFile)) return false
  return parseYamlKeyBlocks(readFileSync(lockFile, 'utf8'))
    .filter(block => block.key === 'packages')
    .some(packages => {
      return (
        parseYamlEntryChunks(
          packages.lines.slice(1).filter(line => line !== '---'),
        )?.chunks.some(chunk => {
          const spec = chunk.id.slice(2)
          return (
            spec.startsWith(`${dependency}@`) ||
            spec.startsWith(`/${dependency}@`) ||
            spec.startsWith(`/${dependency}/`)
          )
        }) ?? false
      )
    })
}
function patchEntries(yaml) {
  const blocks = parseYamlKeyBlocks(yaml)
  const block = blocks.find(entry => entry.key === 'patchedDependencies')
  return {
    blocks,
    block,
    entries: block ? parseYamlEntryChunks(block.lines.slice(1)) : void 0,
  }
}
function filterPatchEntries(yaml, keep) {
  const { blocks, block, entries } = patchEntries(yaml)
  if (!block || !entries) return yaml
  const kept = entries.chunks.filter(chunk =>
    keep(packageNameFromSpec(chunk.id.slice(2))),
  )
  if (kept.length === entries.chunks.length) return yaml
  block.lines = [
    block.lines[0],
    ...kept.flatMap(chunk => chunk.lines),
    ...entries.trailing,
  ]
  return blocks
    .filter(entry => entry !== block || kept.length > 0)
    .flatMap(entry => [...entry.head, ...entry.lines])
    .join('\n')
}
function prepareWorkspacePatchMerge(config) {
  const entries = patchEntries(config.bundleFleetSections).entries
  const fleetNames = new Set(
    entries?.chunks.map(chunk => packageNameFromSpec(chunk.id.slice(2))),
  )
  const inactive = /* @__PURE__ */ new Set()
  for (const group of config.groups ?? [])
    if (
      group.dependency &&
      !dependencyGraphRequires(config.root, group.dependency)
    )
      inactive.add(group.dependency)
  return {
    bundleFleetSections: filterPatchEntries(
      config.bundleFleetSections,
      name => !inactive.has(name),
    ),
    consumerYaml: filterPatchEntries(
      config.consumerYaml,
      name => !fleetNames.has(name) && !inactive.has(name),
    ),
  }
}

function githubReleaseEnabled(config) {
  return config?.release?.github !== false
}

function isPlainObject$3(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === null || prototype === Object.prototype
}
function hasCodeql(raw) {
  const github = raw['github']
  return isPlainObject$3(github) && github['codeql'] === true
}
function markerCompilesRust(value) {
  const build = value['build']
  if (
    typeof build === 'object' &&
    build !== null &&
    !Array.isArray(build) &&
    'type' in build &&
    build.type === 'rust'
  )
    return true
  const capabilities = value['capabilities']
  if (
    typeof capabilities !== 'object' ||
    capabilities === null ||
    Array.isArray(capabilities)
  )
    return false
  const cargoPaths = 'cargo' in capabilities ? capabilities.cargo : void 0
  return Array.isArray(cargoPaths) && cargoPaths.length > 0
}
function hasNonEmptyPrebakes(raw) {
  const docker = raw['docker']
  if (!isPlainObject$3(docker)) return false
  const prebakes = docker['prebakes']
  if (!isPlainObject$3(prebakes)) return false
  const list = prebakes['prebakes']
  return Array.isArray(list) && list.length > 0
}
function hasNapiPlatforms(raw) {
  const napi = raw['napi']
  if (!isPlainObject$3(napi)) return false
  const platforms = napi['platforms']
  return Array.isArray(platforms) && platforms.length > 0
}
function buildsAsGithubAction(raw) {
  const build = raw['build']
  if (!isPlainObject$3(build)) return false
  return build['from'] === 'github-action'
}
function publishesToGhcr(raw) {
  const ghcr = raw['ghcr']
  return isPlainObject$3(ghcr)
}
/**
 * True when the repo bundles VENDORED dependencies, so it needs the fleet
 * rolldown plugin family (guarded define, engine-gate folding, factory
 * collision). Config data rather than a marker file: the family DELIVERS the
 * plugin the old marker pointed at, so a prune of that one copy made the whole
 * family undeliverable forever, and every build importing it broke.
 */
function bundlesVendoredDeps(raw) {
  const build = raw['build']
  return isPlainObject$3(build) && build['bundlesVendoredDeps'] === true
}
function publishesCrates(raw) {
  return publishesRegistry(raw, 'crates-registry')
}
function publishesNpm(raw) {
  const release = raw['release']
  if (isPlainObject$3(release)) {
    const packages = release['publishedPackages']
    if (Array.isArray(packages) && packages.length === 0) return false
  }
  return publishesRegistry(raw, 'npm-registry')
}
function publishesRegistry(raw, registry) {
  const channels = [raw['build']]
  const secondaries = raw['secondaries']
  if (Array.isArray(secondaries)) channels.push(...secondaries)
  return channels.some(
    channel => isPlainObject$3(channel) && channel['from'] === registry,
  )
}
/**
 * True when the config-data trigger `flag` holds for the raw socket-wheelhouse
 * marker. THE authority for the CONDITIONAL_FILES `configFlag` triggers — the
 * check and its tests both route through this, so a new flag is one predicate
 * plus one arm, never a second derivation that can drift.
 */
function configFlagHolds(flag, raw) {
  switch (flag) {
    case 'bundlesVendoredDeps':
      return bundlesVendoredDeps(raw)
    case 'hasCodeql':
      return hasCodeql(raw)
    case 'hasGithubRelease':
      return githubReleaseEnabled(raw)
    case 'hasCratesRegistry':
      return publishesCrates(raw)
    case 'hasNpmRegistry':
      return publishesNpm(raw)
    case 'hasGhcr':
      return publishesToGhcr(raw)
    case 'hasNapi':
      return hasNapiPlatforms(raw)
    case 'hasPrebakes':
      return hasNonEmptyPrebakes(raw)
    case 'hasRust':
      return markerCompilesRust(raw)
    case 'isGithubAction':
      return buildsAsGithubAction(raw)
    default:
      return false
  }
}

function readConditionalSettings(dest) {
  const settings = resolveSettingsPath(dest)
  if (settings === void 0) return {}
  try {
    const value = JSON.parse(readFileSync(settings, 'utf8'))
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value
      : {}
  } catch {
    return {}
  }
}
function conditionalMarkerHolds(dest, marker) {
  const markerPath = path.join(dest, marker)
  if (!existsSync(markerPath)) return false
  if (marker !== 'test') return true
  try {
    return readdirSync(markerPath).some(entry => entry !== 'fleet')
  } catch {
    return true
  }
}
function conditionalManifestGroupHolds(group, raw, dest) {
  if (group.dependency !== void 0)
    return dependencyGraphRequires(dest, group.dependency)
  if (group.marker !== void 0) return conditionalMarkerHolds(dest, group.marker)
  if (group.configFlag !== void 0) return configFlagHolds(group.configFlag, raw)
  if (group.capability !== void 0) {
    const capabilities = raw['capabilities']
    return (
      capabilities !== null &&
      typeof capabilities === 'object' &&
      Object.hasOwn(capabilities, group.capability)
    )
  }
  const build = raw['build']
  return (
    group.buildType !== void 0 &&
    build !== null &&
    typeof build === 'object' &&
    build['type'] === group.buildType
  )
}
function filterManifestForConditions(manifest, dest) {
  if (!manifest.conditionalScopedFiles?.length) return manifest
  const raw = readConditionalSettings(dest)
  const excluded = /* @__PURE__ */ new Set()
  for (const group of manifest.conditionalScopedFiles)
    if (!conditionalManifestGroupHolds(group, raw, dest))
      for (const file of group.files) excluded.add(normalizeBundlePath(file))
  const files = {}
  for (const [file, hash] of Object.entries(manifest.files))
    if (!excluded.has(normalizeBundlePath(file))) files[file] = hash
  return {
    ...manifest,
    files,
  }
}

const ALWAYS_TRACKED_GITHUB_PREFIXES = [
  '.github/actions/fleet/_shared/',
  '.github/actions/fleet/cache-pnpm-store/',
  '.github/actions/fleet/checkout/',
  '.github/actions/fleet/debug/',
  '.github/actions/fleet/expose-actions-runtime/',
  '.github/actions/fleet/github-ci-fix-app-token/',
  '.github/actions/fleet/github-payload-app-token/',
  '.github/actions/fleet/github-pr-branch-app-token/',
  '.github/actions/fleet/github-status-check/',
  '.github/actions/fleet/install/',
  '.github/actions/fleet/setup-and-install/',
  '.github/actions/fleet/setup/',
  '.github/dependabot.yml',
  '.github/workflows/',
]
function normalizePath$1(pathLike) {
  return pathLike.replaceAll('\\', '/')
}
/**
 * Non-GitHub surfaces a member must keep tracked. The unifying rule for BOTH
 * lists: anything a consumer reads BEFORE our fetch runs has to be in the
 * commit. pnpm reads `.npmrc` and resolves `patchedDependencies` at install
 * time, which on a thin member happens after hydration but on a FRESH clone
 * can precede it; git resolves `core.hooksPath` from the working tree on
 * every operation; `tsc -p` and editors read tsconfig/.editorconfig at rest;
 * the dep-0 bootstrap runs from a fresh clone. Same rule, different consumers.
 *
 * These cannot live in ALWAYS_TRACKED_GITHUB_PREFIXES: that predicate is
 * `.github/`-scoped by construction, so a `.npmrc` entry there would never
 * be reached.
 */
const ALWAYS_TRACKED_PREFIXES = [
  '.claude/output-styles/fleet.md',
  '.config/fleet/.prettierignore',
  '.config/fleet/oxlintrc.json',
  '.config/fleet/tsconfig.check.json',
  '.config/repo/external-tools.json',
  '.config/repo/socket-wheelhouse-schema.json',
  '.editorconfig',
  '.git-hooks/',
  '.npmrc',
  'assets/fleet/badge-follow-bluesky.svg',
  'assets/fleet/badge-follow-x.svg',
  'assets/fleet/important.LICENSE',
  'assets/fleet/important.svg',
  'assets/fleet/socket-combomark-dark.svg',
  'assets/fleet/socket-combomark-light.svg',
  'patches/fleet/@polka__url@1.0.0-next.29.patch',
  'patches/fleet/brace-expansion@5.0.12.patch',
  'patches/fleet/minimatch@10.2.6.patch',
  'patches/fleet/run-local-ci@0.18.1.patch',
  'patches/fleet/vitest@5.0.0.patch',
  'patches/fleet/vitest@5.0.3.patch',
  'scripts/fleet/npm/scan/receipt.mts',
  'scripts/fleet/npm/scan/staged.mts',
  'scripts/fleet/registry/npm/scan/ndjson.mts',
  'scripts/fleet/registry/npm/scan/run.mts',
  'scripts/fleet/registry/npm/staged.mts',
  'scripts/fleet/setup/bootstrap/zero-dep-packages.mjs',
  'scripts/fleet/setup/lib/check/sfw.mjs',
  'scripts/fleet/setup/lib/error-message.mjs',
  'scripts/fleet/setup/lib/install-tool.mjs',
  'scripts/fleet/setup/lib/read-package-integrity.mjs',
  'scripts/fleet/setup/lib/read-pinned-version.mjs',
  'scripts/repo/bootstrap/',
]
/**
 * True when `relPath` is any always-tracked surface, GitHub or not. This is
 * what an untrack set should consult; the GitHub-only predicate below stays
 * exported for callers that mean the CI surface specifically.
 */
function isAlwaysTrackedSurface(relPath) {
  const p = normalizePath$1(relPath)
  for (let i = 0, { length } = ALWAYS_TRACKED_PREFIXES; i < length; i += 1) {
    const prefix = ALWAYS_TRACKED_PREFIXES[i]
    if (prefix.endsWith('/') ? p.startsWith(prefix) : p === prefix) return true
  }
  return isAlwaysTrackedGitHubSurface(p)
}
/**
 * True when `relPath`, repo-relative, either separator, is part of the GitHub
 * CI surface a member must keep git-tracked even when thin — a workflow file,
 * dependabot.yml, or a `.github/actions/fleet/**` dir bundle.json marks
 * `tracked: true` (the bootstrap-critical closure a job needs through the
 * fleet-pack download+install). Everything else under `.github/actions/
 * fleet/**` resolves at step-execution time from the workspace, so the pack
 * delivers it mid-job and it stays untracked.
 */
function isAlwaysTrackedGitHubSurface(relPath) {
  const p = normalizePath$1(relPath)
  for (
    let i = 0, { length } = ALWAYS_TRACKED_GITHUB_PREFIXES;
    i < length;
    i += 1
  ) {
    const prefix = ALWAYS_TRACKED_GITHUB_PREFIXES[i]
    if (p.startsWith(prefix) || `${p}/` === prefix) return true
  }
  return false
}

/**
 * The hybrid (segment + settingsSegment) path set fleetPackOwnedPaths excludes
 * from its wholly-fleet list.
 */
function computeHybridPaths(manifest) {
  const hybridPaths = new Set(
    (manifest.segments ?? []).map(entry => normalizeBundlePath(entry.path)),
  )
  if (manifest.settingsSegment !== void 0)
    hybridPaths.add(normalizeBundlePath(manifest.settingsSegment.path))
  return hybridPaths
}

function fleetTrackedAllowlist(manifest, current, aliases) {
  const hybrid = computeHybridPaths(manifest)
  const candidates = [
    ...Object.keys(manifest.files),
    ...hybrid,
    ...current
      .filter(line => line.startsWith('!/') && !line.endsWith('/'))
      .map(line => {
        const entry = line.slice(2)
        return (
          manifest.movedPaths?.find(move => move.from === entry)?.to ?? entry
        )
      }),
  ].map(normalizeBundlePath)
  const removed = manifest.removedPaths ?? []
  const allowed = [
    ...new Set(
      candidates.filter(
        entry =>
          (isAlwaysTrackedSurface(entry) || hybrid.has(entry)) &&
          !aliases.includes(entry) &&
          !removed.some(
            removedPath =>
              entry === removedPath || entry.startsWith(`${removedPath}/`),
          ),
      ),
    ),
  ].toSorted()
  const entries = /* @__PURE__ */ new Set()
  for (const entry of allowed) {
    const parts = normalizeBundlePath(entry).split('/')
    for (let index = 1; index < parts.length; index += 1)
      entries.add(`!/${parts.slice(0, index).join('/')}/`)
    entries.add(`!/${entry}`)
  }
  return ['# <fleet-allowlist>', ...entries, '# </fleet-allowlist>'].join('\n')
}
function assertFleetTrackedPathsVisible(dest, allowlist) {
  if (!existsSync(path.join(dest, '.git'))) return
  const files = allowlist
    .split('\n')
    .filter(line => line.startsWith('!/') && !line.endsWith('/'))
    .map(line => line.slice(2))
  if (files.length === 0) return
  let ignored
  try {
    ignored = execFileSync(
      'git',
      ['check-ignore', '--no-index', '--stdin', '-z'],
      {
        cwd: dest,
        encoding: 'utf8',
        input: `${files.join('\0')}\0`,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )
  } catch (error) {
    if (
      error !== null &&
      typeof error === 'object' &&
      'status' in error &&
      error.status === 1
    )
      return
    throw error
  }
  const conflicts = ignored.split('\0').filter(Boolean)
  if (conflicts.length)
    throw new Error(
      `Tracked fleet paths remain ignored. Where: ${dest}/.gitignore. Saw: ${conflicts.join(', ')}; wanted manifest-owned tracked paths visible to Git. Fix: use git check-ignore --no-index -v on these paths and remove or narrow the conflicting repo ignore rule; preserve the fleet allowlist.`,
    )
}

/**
 * @file Dep-0 I/O shim for the fleet bundle fetcher. `fleet.mjs` — the built
 *   bootstrap fetcher — runs on a BARE clone with NO node_modules, before the
 *   published `@socketsecurity/lib-stable` exists, so it cannot import the lib
 *   logger or lib safeDelete. This module supplies node:-builtin-only stand-ins
 *   that rolldown inlines into the single-file bundle: a logger whose `log`
 *   writes to STDOUT (preserving the `--json` machine-readable contract) and
 *   whose `error` writes to STDERR, plus a fail-open recursive delete. The two
 *   lint carve-outs the dep-0 constraint forces (`socket/prefer-safe-delete`,
 *   `socket/no-console-prefer-logger`) live ONLY here, so every other src/
 *   module stays carve-out-free.
 */
/**
 * Return the shared dep-0 logger. Mirrors the lib `getDefaultLogger()` factory
 * shape so call sites read identically (`const logger = getDep0Logger()`).
 */
function getDep0Logger() {
  return dep0Logger
}
/**
 * Whether `candidate` sits strictly INSIDE `root` - a descendant, never `root`
 * itself and never above it.
 *
 * The prune walk builds its target with `path.join(dest, rel)` where `rel`
 * comes from a state file on disk. `path.join(dest, '.')` is `dest`, and
 * `path.join(dest, '..')` is its parent, so a single stray line in that record
 * turns a per-file prune into a recursive delete of the checkout or of the
 * directory holding it. Comparing resolved paths is the only check a caller
 * cannot get wrong.
 */
function isInsidePath(root, candidate) {
  const resolvedRoot = resolve(root)
  const resolvedCandidate = resolve(candidate)
  if (resolvedCandidate === resolvedRoot) return false
  return resolvedCandidate.startsWith(`${resolvedRoot}${sep}`)
}
/**
 * Fail-open recursive delete, CONTAINED to `root`. The dep-0 fetcher cannot
 * import the lib `safeDeleteSync`, so it wraps node's `rmSync` with the same
 * force + recursive fail-open semantics: a missing path is a no-op, never a
 * throw.
 *
 * `root` is required and not optional on purpose. This deletes recursively with
 * force, so the one thing every caller must state is the boundary it may not
 * cross. A target outside `root` throws instead of deleting: the alternative is
 * a warning nobody reads about a tree that is already gone.
 *
 * A read-only target gets ONE retry after a chmod +w. The installer locks the
 * files it places (0444/0555), and Windows refuses to unlink a read-only file -
 * POSIX does not, it checks the parent directory, which the lock never touches.
 */
function rm(targetPath, root) {
  if (!isInsidePath(root, targetPath))
    throw new Error(
      `refusing to delete outside the install root.\n  Where: ${resolve(targetPath)}\n  Saw:   a target that is not a descendant of ${resolve(root)}\n  Fix:   this is a bug in the caller - a prune entry resolved to the root or above it. Report the manifest or applied-files line that produced it.`,
    )
  rmForce(targetPath)
}
/**
 * The unguarded force delete, for a path this module minted itself.
 */
function rmForce(targetPath) {
  try {
    rmSync(targetPath, {
      force: true,
      recursive: true,
    })
  } catch (e) {
    const code = errorCode$1(e)
    if (code !== 'EACCES' && code !== 'EPERM') throw e
    chmodSync(targetPath, (statSync(targetPath).mode & 511) | 128)
    rmSync(targetPath, {
      force: true,
      recursive: true,
    })
  }
}
/**
 * The `errno` string of a thrown filesystem error (`EACCES`, `EPERM`, …), or
 * undefined for anything that is not one. Dep-0: no lib `isErrnoException`.
 */
function errorCode$1(e) {
  if (e instanceof Error) {
    const { code } = e
    return code
  }
}
const dep0Logger = {
  error(...args) {
    console.error(...args)
  },
  log(...args) {
    if (process$1.argv.includes('--json')) {
      process$1.stderr.write(`${format(...args)}\n`)
      return
    }
    console.log(...args)
  },
}

var require_runtime = /* @__PURE__ */ __commonJSMin(exports => {
  Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
  /**
   * @file Runtime environment detection constants. All checks use only
   *   `typeof`-safe global probes so this module is safe to import in browser,
   *   Node.js, Deno, Bun, and bundled contexts alike.
   */
  /**
   * True when running inside a Node.js process. Detected via
   * `process.versions.node` — present in Node, absent in browsers and Deno/Bun
   * which expose a different `process.versions` shape (or no `process` at all).
   */
  const IS_NODE =
    typeof process !== 'undefined' &&
    typeof process.versions !== 'undefined' &&
    typeof process.versions.node === 'string'
  /**
   * True when running in a browser context (window + document both defined).
   * Note: Chrome extensions have `window` in popup contexts but not in service
   * workers — check `IS_SERVICE_WORKER` for that case.
   */
  const IS_BROWSER =
    typeof globalThis !== 'undefined' &&
    'window' in globalThis &&
    typeof globalThis.window !== 'undefined' &&
    'document' in globalThis &&
    typeof globalThis.document !== 'undefined'
  /**
   * True when running inside a Web Worker / Chrome MV3 service worker. `self`
   * is defined without `window` in worker contexts.
   */
  const IS_WORKER =
    'self' in globalThis &&
    typeof globalThis.self !== 'undefined' &&
    !('window' in globalThis) &&
    !('document' in globalThis)
  exports.IS_BROWSER = IS_BROWSER
  exports.IS_NODE = IS_NODE
  exports.IS_WORKER = IS_WORKER
})

var require_os = /* @__PURE__ */ __commonJSMin(exports => {
  Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
  const nodeOs = require_runtime().IS_NODE
    ? /*@__PURE__*/ __require('os')
    : void 0
  function getNodeOs() {
    return nodeOs
  }
  const OsArch = nodeOs?.arch
  const OsHomedir = nodeOs?.homedir
  const OsPlatform = nodeOs?.platform
  const OsTmpdir = nodeOs?.tmpdir
  exports.OsArch = OsArch
  exports.OsHomedir = OsHomedir
  exports.OsPlatform = OsPlatform
  exports.OsTmpdir = OsTmpdir
  exports.getNodeOs = getNodeOs
})

var require_fs = /* @__PURE__ */ __commonJSMin(exports => {
  Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
  const nodeFs = require_runtime().IS_NODE
    ? /*@__PURE__*/ __require('fs')
    : void 0
  function getNodeFs() {
    return nodeFs
  }
  const FsAccessSync = nodeFs?.accessSync
  const FsExistsSync = nodeFs?.existsSync
  const FsMkdirSync = nodeFs?.mkdirSync
  const FsReadFileSync = nodeFs?.readFileSync
  const FsRealpathSync = nodeFs?.realpathSync
  const FsStatSync = nodeFs?.statSync
  const FsWriteFileSync = nodeFs?.writeFileSync
  exports.FsAccessSync = FsAccessSync
  exports.FsExistsSync = FsExistsSync
  exports.FsMkdirSync = FsMkdirSync
  exports.FsReadFileSync = FsReadFileSync
  exports.FsRealpathSync = FsRealpathSync
  exports.FsStatSync = FsStatSync
  exports.FsWriteFileSync = FsWriteFileSync
  exports.getNodeFs = getNodeFs
})

var require_platform = /* @__PURE__ */ __commonJSMin(exports => {
  Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
  const require_node_os = require_os()
  const require_node_fs = require_fs()
  /**
   * @file Platform detection and OS-specific constants.
   */
  let memoizedArch
  /**
   * Get the current CPU architecture (memoized), e.g. `x64`, `arm64`.
   */
  function getArch() {
    if (memoizedArch === void 0)
      memoizedArch = require_node_os.getNodeOs().arch()
    return memoizedArch
  }
  const MUSL_LINKERS = [
    '/lib/ld-musl-x86_64.so.1',
    '/lib/ld-musl-aarch64.so.1',
    '/usr/lib/ld-musl-x86_64.so.1',
    '/usr/lib/ld-musl-aarch64.so.1',
  ]
  let memoizedLibc
  let memoizedLibcProbed = false
  /**
   * Get the host libc variant (memoized): `'musl'` on Alpine-and-similar,
   * `'glibc'` on other Linux, `undefined` off-Linux. Detected by probing for
   * the musl dynamic linker. The single source of truth for libc detection —
   * tool-specific resolvers (`getPythonArch`, `getJreArch`) call this rather
   * than re-probing.
   */
  function getLibc() {
    if (!memoizedLibcProbed) {
      memoizedLibcProbed = true
      /* c8 ignore start - Linux-only filesystem probe. */
      if (getOs() !== 'linux') memoizedLibc = void 0
      else {
        memoizedLibc = 'glibc'
        for (let i = 0, { length } = MUSL_LINKERS; i < length; i += 1)
          if (require_node_fs.getNodeFs().existsSync(MUSL_LINKERS[i])) {
            memoizedLibc = 'musl'
            break
          }
      }
    }
    return memoizedLibc
  }
  let memoizedOs
  /**
   * Get the current OS (memoized), e.g. `darwin`, `linux`, `win32` — the raw
   * `process.platform` value.
   */
  function getOs() {
    if (memoizedOs === void 0)
      memoizedOs = require_node_os.getNodeOs().platform()
    return memoizedOs
  }
  let memoizedTarget
  /**
   * Get the current host **target** in the pnpm `pack-app` vocabulary
   * (memoized): `<os>-<arch>[-<libc>]`, e.g. `darwin-arm64`, `linux-x64`,
   * `win32-x64`, `linux-x64-musl`. Raw Node `process.platform`/`process.arch`
   * joined with `-`, plus a `-musl` suffix on Alpine. This is the Socket-wide
   * naming for non-python / non-JRE tools (matches pnpm's release assets,
   * `pnpm-<os>-<arch>[-<libc>].{tar.gz,zip}`). Tool-specific resolvers that
   * need a different vocabulary own their own helper — see `getPythonArch` for
   * python-build-standalone and `getJreArch` for Adoptium.
   */
  function getTarget() {
    if (memoizedTarget === void 0) {
      const libcSuffix = getLibc() === 'musl' ? '-musl' : ''
      memoizedTarget = `${getOs()}-${getArch()}${libcSuffix}`
    }
    return memoizedTarget
  }
  const DARWIN = getOs() === 'darwin'
  const WIN32 = getOs() === 'win32'
  /**
   * Returns whether the current platform is macOS. Callable predicate backed
   * by the module-load memo, so tests can mock the module.
   *
   * @returns `true` on darwin, `false` otherwise
   */
  function isDarwin() {
    return DARWIN
  }
  /**
   * Returns whether the current platform is POSIX (anything but Windows).
   * Callable predicate backed by the module-load memo, so tests can mock the
   * module.
   *
   * @returns `true` on darwin/linux, `false` on win32
   */
  function isPosix() {
    return !WIN32
  }
  /**
   * Returns whether the current platform is Windows. Callable predicate backed
   * by the module-load memo, so tests can mock the module.
   *
   * @returns `true` on win32, `false` otherwise
   */
  function isWin32() {
    return WIN32
  }
  /**
   * True when this process was launched as a Chrome or Chromium native
   * messaging host. Chrome passes the extension origin URL
   * (`chrome-extension://<id>/`) as `process.argv[2]`; no other invocation
   * shape produces that prefix.
   */
  const NATIVE_MESSAGING_HOST =
    typeof process !== 'undefined' &&
    typeof process.argv[2] === 'string' &&
    process.argv[2].startsWith('chrome-extension://')
  const S_IXUSR = 64
  const S_IXGRP = 8
  const S_IXOTH = 1
  exports.NATIVE_MESSAGING_HOST = NATIVE_MESSAGING_HOST
  exports.S_IXGRP = S_IXGRP
  exports.S_IXOTH = S_IXOTH
  exports.S_IXUSR = S_IXUSR
  exports.getArch = getArch
  exports.getLibc = getLibc
  exports.getOs = getOs
  exports.getTarget = getTarget
  exports.isDarwin = isDarwin
  exports.isPosix = isPosix
  exports.isWin32 = isWin32
})

var require_module = /* @__PURE__ */ __commonJSMin(exports => {
  Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
  const require_constants_runtime = require_runtime()
  let module$1 = __require('module')
  /**
   * @file Accessors for `node:module` that work across runtimes. Ambient
   *   `require` is bound in CommonJS but unbound in ESM and inside
   *   ahead-of-time-compiled package modules (e.g. Perry), where reading it
   *   throws. And Perry's `require('module')` value omits `isBuiltin`. So
   *   instead of the ambient `require('module')` lazy-loader,
   *   `isBuiltin`/`createRequire` are imported as named values from the bare
   *   `module` specifier — which resolves on Node and Perry, and which browser
   *   bundlers can stub via resolve.fallback (a `node:` prefix would throw
   *   UnhandledSchemeError there). `require` is DIRECTORY-SPECIFIC:
   *   `createRequire(base)` resolves relative specifiers (`./x`, `../y`) from
   *   `base`'s directory. For builtins and bare packages that's irrelevant
   *   since they resolve the same anywhere, so the cached `getRequire` /
   *   `requireBuiltin` bind to THIS file. A RELATIVE specifier must resolve
   *   from the CALLER's directory, so use `requireFrom` with the caller's
   *   `import.meta.url` — binding such a load to this file would resolve it
   *   against `src/node/` instead. Bundled, every module collapses to one base
   *   and either works; unbundled (e.g. AOT-compiled from source), each module
   *   sits at its own nested path and the base matters.
   */
  let cachedModule
  let cachedRequire
  /**
   * Bind a working `require`. Ambient `require` exists in CommonJS; in ESM and
   * ahead-of-time-compiled package modules it is unbound (reading it throws or
   * yields undefined), so fall back to `createRequire`. Returns undefined off
   * Node and in browsers, where neither is available.
   *
   * `fromUrl` sets the resolution base — pass a caller's `import.meta.url` to
   * resolve that caller's RELATIVE specifiers. When omitted, the base is this
   * file, which is correct only for builtins / bare packages (dir-independent).
   * With `fromUrl` the ambient `require` is skipped: it is bound to THIS file,
   * so it would resolve a relative specifier from the wrong directory.
   */
  function bindRequire(fromUrl) {
    if (!require_constants_runtime.IS_NODE) return
    if (!fromUrl && typeof __require === 'function') return __require
    if (typeof module$1.createRequire === 'function')
      try {
        return (0, module$1.createRequire)(
          fromUrl ?? __require('url').pathToFileURL(__filename).href,
        )
      } catch {
        return
      }
  }
  /**
   * Returns `node:module` loaded through the bound `require`, or undefined off
   * Node. Cached across calls.
   */
  function getNodeModule() {
    return (cachedModule ??= requireBuiltin('module'))
  }
  /**
   * Returns a working `require` bound to THIS file, binding one on first call
   * (see bindRequire). Cached across calls; undefined off Node / in browsers.
   *
   * For builtins and bare packages only — the resolution base is this file, so
   * a relative specifier would resolve from `src/node/`. Use `requireFrom` for
   * relative loads.
   */
  function getRequire() {
    if (cachedRequire === void 0) cachedRequire = bindRequire()
    return cachedRequire
  }
  /**
   * Is `name` a Node built-in module? Resolved from the statically-imported
   * `isBuiltin`, so it works on Node and on ahead-of-time-compiled binaries
   * (Perry), where ambient `require('module')` would lack `isBuiltin`. Returns
   * false in browsers, where the bare `module` import is stubbed away.
   *
   * Single source of truth for "is this a Node builtin?" probes across
   * socket-lib (used by the smol-binding loaders to gate their `node:smol-*`
   * loads).
   */
  function isNodeBuiltin(name) {
    if (
      !require_constants_runtime.IS_NODE ||
      typeof module$1.isBuiltin !== 'function'
    )
      return false
    return (0, module$1.isBuiltin)(name)
  }
  /**
   * Load a built-in module by _computed_ specifier through the bound `require`
   * (see getRequire). The specifier is a parameter — never a literal at the
   * call site — so browser bundlers neither walk nor bundle it. Returns
   * undefined where no `require` can be bound.
   *
   * Builtins / bare packages only (dir-independent); for a relative specifier
   * use `requireFrom`. Used by `getNodeModule` for `node:module`, and by the
   * smol-binding loaders for the optional `node:smol-*` native bindings (gated
   * behind `isNodeBuiltin`, true only on socket-btm's smol Node binary).
   */
  function requireBuiltin(specifier) {
    const req = getRequire()
    if (req) return req(specifier)
  }
  /**
   * Load a module by specifier from a CALLER-supplied base (its
   * `import.meta.url`). Use this for RELATIVE specifiers (`./x`, `../y`), whose
   * resolution depends on the caller's directory — `requireBuiltin` binds to
   * this file and would resolve them from `src/node/`. Not cached: the binding
   * is per-caller. Returns undefined where no `require` can be bound.
   */
  function requireFrom(fromUrl, specifier) {
    const req = bindRequire(fromUrl)
    if (req) return req(specifier)
  }
  exports.bindRequire = bindRequire
  exports.getNodeModule = getNodeModule
  exports.getRequire = getRequire
  exports.isNodeBuiltin = isNodeBuiltin
  exports.requireBuiltin = requireBuiltin
  exports.requireFrom = requireFrom
})

var require_detect = /* @__PURE__ */ __commonJSMin(exports => {
  Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
  const require_node_module = require_module()
  /**
   * @file Smol detection + lazy-loader for `node:smol-util`. Two
   *   responsibilities:
   *
   *   1. `isSmol()` — memoized boolean detector for socket-btm's smol Node binary.
   *      Mirrors `isSeaBinary()` from `src/sea.ts`. Probes via
   *      `node:module.isBuiltin('node:smol-util')` since only the smol binary
   *      registers any `node:smol-*` builtins.
   *   2. `getSmolUtil()` — lazy-loader for the `node:smol-util` binding, which
   *      provides native `uncurryThis` and `applyBind` (single V8 dispatch via
   *      `args.Data()` + `v8::Function::Call`, skipping the BoundFunction
   *      adapter
   *
   *   - `Function.prototype.call` trampoline that the JS form
   *     `bind.bind(call)(fn)` hits twice per invocation). ~2x faster on hot
   *     uncurried-call sites. `getSmolUtil()` returns `undefined` on stock
   *     Node
   *   - non-Node runtimes. Result is cached across calls; the lazy-loader follows
   *     the same shape as `src/node/fs.ts` etc.
   *
   * @see https://github.com/SocketDev/socket-btm — socket-btm builds
   *   the smol binary that exposes the `node:smol-util` binding.
   */
  /**
   * Cached smol-binary detection result.
   */
  let isSmolCache
  /**
   * Cached `node:smol-util` binding. `null` = probed and unavailable;
   * `undefined` = not yet probed. JS truthiness collapses both to "no binding"
   * at the call site.
   */
  let smolUtilCache
  let smolUtilProbed = false
  /**
   * Returns `node:smol-util` when running on the smol Node binary, otherwise
   * `undefined`. Result is cached across calls.
   */
  function getSmolUtil() {
    if (!smolUtilProbed) {
      smolUtilProbed = true
      /* c8 ignore start - smol Node binary only. */
      if (require_node_module.isNodeBuiltin('node:smol-util'))
        smolUtilCache = require_node_module.requireBuiltin('node:smol-util')
    }
    return smolUtilCache
  }
  /**
   * Detect if the current process is running on socket-btm's smol Node binary.
   * Memoized on first call.
   *
   * Defensive across runtimes: returns `false` on stock Node, browsers (no
   * `node:module`), Deno and Bun, whose module resolution differs, and worker
   * threads, each of which has its own builtin table.
   *
   * @example
   *   ;```ts
   *   import { isSmol } from '@socketsecurity/lib/exe/smol/detect'
   *
   *   if (isSmol()) {
   *     // running on the smol binary; native fast paths available
   *   }
   *   ```
   */
  function isSmol() {
    if (isSmolCache === void 0)
      isSmolCache = require_node_module.isNodeBuiltin('node:smol-util')
    return isSmolCache
  }
  exports.getSmolUtil = getSmolUtil
  exports.isSmol = isSmol
})

var require_uncurry = /* @__PURE__ */ __commonJSMin(exports => {
  Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
  /**
   * @file `uncurryThis` and the cluster of helpers built atop it. Mirrors
   *   Node.js's internal/per_context/primordials.js. Every other primordials
   *   leaf depends on `uncurryThis` to expose prototype-method primordials, so
   *   this file must be import-safe before any of them. Smol fast paths
   *   (`node:smol-util`) replace the JS forms when running on socket-btm's smol
   *   Node binary; stock Node and other runtimes fall back to the standard
   *   `bind.bind(call)` shape. **IMPORTANT**: do not destructure on
   *   `globalThis` or `Reflect` here. tsgo has a bug that mis-transpiles
   *   destructured exports. See:
   *   https://github.com/SocketDev/socket-packageurl-js/issues/3.
   */
  const smolUtil = require_detect().getSmolUtil()
  const { apply, bind, call } = Function.prototype
  const uncurryThis = smolUtil?.uncurryThis ?? bind.bind(call)
  const applyBind = smolUtil?.applyBind ?? bind.bind(apply)
  const applyBoundForSafe = applyBind
  const applySafe =
    smolUtil?.applySafe ??
    (fn => {
      const apply2 = applyBoundForSafe(fn)
      return (self, args) => {
        try {
          return apply2(self, args)
        } catch {
          return
        }
      }
    })
  const bindCallFallback = (fn, thisArg, ...presetArgs) =>
    Function.prototype.bind.apply(fn, [thisArg, ...presetArgs])
  const bindCall = smolUtil?.bindCall ?? bindCallFallback
  const weakRefSafe =
    smolUtil?.weakRefSafe ??
    (target => {
      try {
        return new WeakRef(target)
      } catch {
        return
      }
    })
  exports.applyBind = applyBind
  exports.applySafe = applySafe
  exports.bindCall = bindCall
  exports.uncurryThis = uncurryThis
  exports.weakRefSafe = weakRefSafe
})

var require_primordial = /* @__PURE__ */ __commonJSMin(exports => {
  Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
  const require_node_module = require_module()
  /**
   * @file Lazy-loader for socket-btm's `node:smol-primordial` binding.
   *   `node:smol-primordial` provides V8 Fast API typed implementations of
   *   Math.* and Number.is* primordials, registered with `CFunction::Make()` so
   *   TurboFan inlines them directly into JIT- compiled JS callers. Bypasses
   *   the FunctionCallbackInfo trampoline entirely — ~30-50% gain on hot loops
   *   where V8 doesn't already auto-inline. Returns `undefined` on stock Node +
   *   non-Node runtimes. Result is cached across calls.
   *
   * @internal — used by `src/primordials.ts` to resolve smol-aware
   *   Math.* / Number.is* fast paths. Most callers should use the
   *   standard `primordials` exports, which already route through this
   *   when smol is present.
   *
   * @see https://v8.dev/blog/v8-release-99 — V8 Fast API Calls overview
   */
  let smolPrimordial
  let smolPrimordialProbed = false
  /**
   * Returns `node:smol-primordial` when running on the smol Node binary,
   * otherwise `undefined`. Result is cached across calls.
   */
  function getSmolPrimordial() {
    if (!smolPrimordialProbed) {
      smolPrimordialProbed = true
      /* c8 ignore start - smol Node binary only. */
      if (require_node_module.isNodeBuiltin('node:smol-primordial'))
        smolPrimordial = require_node_module.requireBuiltin(
          'node:smol-primordial',
        )
    }
    return smolPrimordial
  }
  exports.getSmolPrimordial = getSmolPrimordial
})

var require_string = /* @__PURE__ */ __commonJSMin(exports => {
  Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
  const require_primordials_uncurry = require_uncurry()
  /**
   * @file Safe references to `String` static methods and prototype methods.
   *   `StringPrototypeCharCodeAt` prefers the smol Fast API binding for ASCII
   *   inputs, which reduces to a single byte load, and translates the `-1` Fast
   *   API sentinel back to `NaN` to preserve spec parity. Two-byte strings fall
   *   back to the uncurried `String.prototype.charCodeAt`.
   *
   *   ## Fast API surface — and why it's small
   *
   *   Mirrors the design rationale from socket-btm's `primordial_binding.cc`
   *   (lines 41-72). The smol Fast API exposes exactly one string op
   *   (`stringCharCodeAt`) because that's the one shape where the C++
   *   trampoline genuinely beats V8's existing hot path: a single ASCII byte
   *   load, no encoding dispatch, no HandleScope, returns a primitive. String
   *   **searches** (`startsWith` / `endsWith` / `includes` / `indexOf` /
   *   `lastIndexOf`) are intentionally NOT exposed. V8's existing hot path
   *   dispatches on encoding and runs native SIMD memcmp — a Fast API binding
   *   would add overhead without winning. Same for `Map.has` / `Set.has` /
   *   `Array.includes`. Fast API also has a hard constraint: a fast-path
   *   function cannot return a new V8 object — only primitives,
   *   Local<Value/Object/Array>, or FastOneByteString. That rules out anything
   *   that produces a new string (`slice`, `substring`, `toUpperCase`,
   *   `concat`, `repeat`, `padStart`/`padEnd`, formatted-number) from ever
   *   being a Fast API win on the return path. Net: the current surface is
   *   approximately the ceiling. Adding more Fast API string ops without a
   *   flamegraph showing the cost is a regression risk, not a perf win. See
   *   `socket-btm/packages/node-smol-builder/additions/source-patched/`
   *   `src/socketsecurity/primordial/primordial_binding.cc:41-72` for the
   *   canonical design statement.
   */
  const smolPrimordial = require_primordial().getSmolPrimordial()
  const StringCtor = String
  const StringFromCharCode = String.fromCharCode
  const StringFromCodePoint = String.fromCodePoint
  const StringRaw = String.raw
  const StringPrototypeAt = require_primordials_uncurry.uncurryThis(
    String.prototype.at,
  )
  const StringPrototypeCharAt = require_primordials_uncurry.uncurryThis(
    String.prototype.charAt,
  )
  const smolCharCodeAt = smolPrimordial?.stringCharCodeAt
  /* c8 ignore start - the smol Fast API binding ships only on socket-btm's smol Node binary, so this body cannot run under the stock-Node runner */
  function smolStringCharCodeAt(s, i) {
    const code = smolCharCodeAt(s, i)
    return code === -1 ? NaN : code
  }
  /* c8 ignore stop */
  const StringPrototypeCharCodeAt = smolCharCodeAt
    ? smolStringCharCodeAt
    : require_primordials_uncurry.uncurryThis(String.prototype.charCodeAt)
  const StringPrototypeCodePointAt = require_primordials_uncurry.uncurryThis(
    String.prototype.codePointAt,
  )
  const StringPrototypeConcat = require_primordials_uncurry.uncurryThis(
    String.prototype.concat,
  )
  const StringPrototypeEndsWith = require_primordials_uncurry.uncurryThis(
    String.prototype.endsWith,
  )
  const StringPrototypeIncludes = require_primordials_uncurry.uncurryThis(
    String.prototype.includes,
  )
  const StringPrototypeIndexOf = require_primordials_uncurry.uncurryThis(
    String.prototype.indexOf,
  )
  const StringPrototypeIsWellFormed =
    smolPrimordial?.stringIsWellFormed ??
    require_primordials_uncurry.uncurryThis(String.prototype.isWellFormed)
  const StringPrototypeLastIndexOf = require_primordials_uncurry.uncurryThis(
    String.prototype.lastIndexOf,
  )
  const StringPrototypeLocaleCompare = require_primordials_uncurry.uncurryThis(
    String.prototype.localeCompare,
  )
  const StringPrototypeMatch = require_primordials_uncurry.uncurryThis(
    String.prototype.match,
  )
  const StringPrototypeMatchAll = require_primordials_uncurry.uncurryThis(
    String.prototype.matchAll,
  )
  const StringPrototypeNormalize = require_primordials_uncurry.uncurryThis(
    String.prototype.normalize,
  )
  const StringPrototypePadEnd = require_primordials_uncurry.uncurryThis(
    String.prototype.padEnd,
  )
  const StringPrototypePadStart = require_primordials_uncurry.uncurryThis(
    String.prototype.padStart,
  )
  const StringPrototypeRepeat = require_primordials_uncurry.uncurryThis(
    String.prototype.repeat,
  )
  const StringPrototypeReplace = require_primordials_uncurry.uncurryThis(
    String.prototype.replace,
  )
  const StringPrototypeReplaceAll = require_primordials_uncurry.uncurryThis(
    String.prototype.replaceAll,
  )
  const StringPrototypeSearch = require_primordials_uncurry.uncurryThis(
    String.prototype.search,
  )
  const StringPrototypeSlice = require_primordials_uncurry.uncurryThis(
    String.prototype.slice,
  )
  const StringPrototypeSplit = require_primordials_uncurry.uncurryThis(
    String.prototype.split,
  )
  const StringPrototypeStartsWith = require_primordials_uncurry.uncurryThis(
    String.prototype.startsWith,
  )
  const StringPrototypeSubstring = require_primordials_uncurry.uncurryThis(
    String.prototype.substring,
  )
  const StringPrototypeToLocaleLowerCase =
    require_primordials_uncurry.uncurryThis(String.prototype.toLocaleLowerCase)
  const StringPrototypeToLocaleUpperCase =
    require_primordials_uncurry.uncurryThis(String.prototype.toLocaleUpperCase)
  const StringPrototypeToLowerCase = require_primordials_uncurry.uncurryThis(
    String.prototype.toLowerCase,
  )
  const StringPrototypeToString = require_primordials_uncurry.uncurryThis(
    String.prototype.toString,
  )
  const StringPrototypeToUpperCase = require_primordials_uncurry.uncurryThis(
    String.prototype.toUpperCase,
  )
  const StringPrototypeToWellFormed = require_primordials_uncurry.uncurryThis(
    String.prototype.toWellFormed,
  )
  const StringPrototypeTrim = require_primordials_uncurry.uncurryThis(
    String.prototype.trim,
  )
  const StringPrototypeTrimEnd = require_primordials_uncurry.uncurryThis(
    String.prototype.trimEnd,
  )
  const StringPrototypeTrimStart = require_primordials_uncurry.uncurryThis(
    String.prototype.trimStart,
  )
  const StringPrototypeValueOf = require_primordials_uncurry.uncurryThis(
    String.prototype.valueOf,
  )
  exports.StringCtor = StringCtor
  exports.StringFromCharCode = StringFromCharCode
  exports.StringFromCodePoint = StringFromCodePoint
  exports.StringPrototypeAt = StringPrototypeAt
  exports.StringPrototypeCharAt = StringPrototypeCharAt
  exports.StringPrototypeCharCodeAt = StringPrototypeCharCodeAt
  exports.StringPrototypeCodePointAt = StringPrototypeCodePointAt
  exports.StringPrototypeConcat = StringPrototypeConcat
  exports.StringPrototypeEndsWith = StringPrototypeEndsWith
  exports.StringPrototypeIncludes = StringPrototypeIncludes
  exports.StringPrototypeIndexOf = StringPrototypeIndexOf
  exports.StringPrototypeIsWellFormed = StringPrototypeIsWellFormed
  exports.StringPrototypeLastIndexOf = StringPrototypeLastIndexOf
  exports.StringPrototypeLocaleCompare = StringPrototypeLocaleCompare
  exports.StringPrototypeMatch = StringPrototypeMatch
  exports.StringPrototypeMatchAll = StringPrototypeMatchAll
  exports.StringPrototypeNormalize = StringPrototypeNormalize
  exports.StringPrototypePadEnd = StringPrototypePadEnd
  exports.StringPrototypePadStart = StringPrototypePadStart
  exports.StringPrototypeRepeat = StringPrototypeRepeat
  exports.StringPrototypeReplace = StringPrototypeReplace
  exports.StringPrototypeReplaceAll = StringPrototypeReplaceAll
  exports.StringPrototypeSearch = StringPrototypeSearch
  exports.StringPrototypeSlice = StringPrototypeSlice
  exports.StringPrototypeSplit = StringPrototypeSplit
  exports.StringPrototypeStartsWith = StringPrototypeStartsWith
  exports.StringPrototypeSubstring = StringPrototypeSubstring
  exports.StringPrototypeToLocaleLowerCase = StringPrototypeToLocaleLowerCase
  exports.StringPrototypeToLocaleUpperCase = StringPrototypeToLocaleUpperCase
  exports.StringPrototypeToLowerCase = StringPrototypeToLowerCase
  exports.StringPrototypeToString = StringPrototypeToString
  exports.StringPrototypeToUpperCase = StringPrototypeToUpperCase
  exports.StringPrototypeToWellFormed = StringPrototypeToWellFormed
  exports.StringPrototypeTrim = StringPrototypeTrim
  exports.StringPrototypeTrimEnd = StringPrototypeTrimEnd
  exports.StringPrototypeTrimStart = StringPrototypeTrimStart
  exports.StringPrototypeValueOf = StringPrototypeValueOf
  exports.StringRaw = StringRaw
  exports.smolStringCharCodeAt = smolStringCharCodeAt
})

var require_url = /* @__PURE__ */ __commonJSMin(exports => {
  Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
  const require_constants_runtime = require_runtime()
  let cachedUrl
  /**
   * @unused No internal or Socket consumers; exercised only by its unit tests.
   */
  function getNodeUrl() {
    if (!require_constants_runtime.IS_NODE) return
    return (cachedUrl ??= /*@__PURE__*/ __require('url'))
  }
  exports.getNodeUrl = getNodeUrl
})

var require_buffer = /* @__PURE__ */ __commonJSMin(exports => {
  Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
  const require_primordials_uncurry = require_uncurry()
  /**
   * @file Safe references to Node's `Buffer` global. `Buffer` is a Node-only
   *   global; in browsers and in Deno without a compatibility shim the captured
   *   references are `undefined`. Cross- env consumers must null-check before
   *   calling.
   */
  const BufferCtor = globalThis.Buffer
  const BufferAlloc = BufferCtor?.alloc
  const BufferAllocUnsafe = BufferCtor?.allocUnsafe
  const BufferAllocUnsafeSlow = BufferCtor?.allocUnsafeSlow
  const BufferByteLength = BufferCtor?.byteLength
  const BufferConcat = BufferCtor?.concat
  const BufferFrom = BufferCtor?.from
  const BufferIsBuffer = BufferCtor?.isBuffer
  const BufferIsEncoding = BufferCtor?.isEncoding
  /* c8 ignore start */
  const BufferPrototypeSlice = BufferCtor
    ? require_primordials_uncurry.uncurryThis(BufferCtor.prototype.slice)
    : void 0
  const BufferPrototypeToString = BufferCtor
    ? require_primordials_uncurry.uncurryThis(BufferCtor.prototype.toString)
    : void 0
  /* c8 ignore stop */
  exports.BufferAlloc = BufferAlloc
  exports.BufferAllocUnsafe = BufferAllocUnsafe
  exports.BufferAllocUnsafeSlow = BufferAllocUnsafeSlow
  exports.BufferByteLength = BufferByteLength
  exports.BufferConcat = BufferConcat
  exports.BufferCtor = BufferCtor
  exports.BufferFrom = BufferFrom
  exports.BufferIsBuffer = BufferIsBuffer
  exports.BufferIsEncoding = BufferIsEncoding
  exports.BufferPrototypeSlice = BufferPrototypeSlice
  exports.BufferPrototypeToString = BufferPrototypeToString
})

var require_encoding = /* @__PURE__ */ __commonJSMin(exports => {
  Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
  /**
   * @file Character encoding and character code constants. Exports the default
   *   UTF-8 encoding name and numeric char codes for common ASCII characters
   *   used by path and parsing utilities.
   */
  const UTF8 = 'utf8'
  const CHAR_BACKWARD_SLASH = 92
  const CHAR_COLON = 58
  const CHAR_FORWARD_SLASH = 47
  const CHAR_LOWERCASE_A = 97
  const CHAR_LOWERCASE_Z = 122
  const CHAR_UPPERCASE_A = 65
  const CHAR_UPPERCASE_Z = 90
  exports.CHAR_BACKWARD_SLASH = CHAR_BACKWARD_SLASH
  exports.CHAR_COLON = CHAR_COLON
  exports.CHAR_FORWARD_SLASH = CHAR_FORWARD_SLASH
  exports.CHAR_LOWERCASE_A = CHAR_LOWERCASE_A
  exports.CHAR_LOWERCASE_Z = CHAR_LOWERCASE_Z
  exports.CHAR_UPPERCASE_A = CHAR_UPPERCASE_A
  exports.CHAR_UPPERCASE_Z = CHAR_UPPERCASE_Z
  exports.UTF8 = UTF8
})

var require_shared = /* @__PURE__ */ __commonJSMin(exports => {
  Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
  const require_constants_platform = require_platform()
  const require_primordials_string = require_string()
  const require_node_url = require_url()
  const require_primordials_buffer = require_buffer()
  const require_constants_encoding = require_encoding()
  /**
   * @file Shared internals for the `paths/` module — the leaf-level primitives
   *   every other path leaf depends on. Kept as a single file so `normalize`,
   *   `predicates`, `conversion`, and `resolve` can layer above it without
   *   circular imports.
   *
   *   - char-code constants + shared regexps
   *   - `pathLikeToString` — `string | Buffer | URL` → `string`
   *   - `normalizePath` and its `msysDriveToNative` / `foldPathForCompare`
   *     helpers — they live at the leaf because `conversion` and `resolve` call
   *     `normalizePath` and `predicates` calls `foldPathForCompare`. Hosting
   *     them one layer up made `paths/normalize` import its own importers, and
   *     the built CJS barrel then snapshotted those re-exports as `undefined`.
   *     Nothing here may import a sibling `paths/*` leaf. That is the invariant
   *     `scripts/repo/check/reexports-have-no-import-cycles.mts` enforces.
   */
  const DRIVE_LETTER_REGEXP = /^[A-Za-z]:$/
  const msysDriveRegExp = /^\/([a-zA-Z])($|\/)/
  const nodeModulesPathRegExp = /(?:[/\\]|^)node_modules(?:$|[/\\])/
  const slashRegExp = /[/\\]/
  function appendNormalizedPathSegment(state, segment, prefix) {
    if (segment.length === 0 || segment === '.') return
    if (segment === '..') collapsePathParent(state, prefix)
    else {
      state.collapsed += (state.collapsed.length === 0 ? '' : '/') + segment
      state.segmentCount += 1
    }
  }
  function collapsePathParent(state, prefix) {
    if (state.segmentCount > 0) {
      const lastSeparatorIndex = state.collapsed.lastIndexOf('/')
      if (lastSeparatorIndex === -1) {
        state.collapsed = ''
        state.segmentCount = 0
        if (state.leadingDotDots > 0 && !prefix) {
          state.collapsed = '..'
          state.leadingDotDots = 1
        }
      } else {
        const lastSegmentStart = lastSeparatorIndex + 1
        if (state.collapsed.slice(lastSegmentStart) === '..') {
          state.collapsed = `${state.collapsed}/..`
          state.leadingDotDots += 1
        } else {
          state.collapsed = state.collapsed.slice(0, lastSeparatorIndex)
          state.segmentCount -= 1
        }
      }
    } else if (!prefix) {
      state.collapsed =
        state.collapsed + (state.collapsed.length === 0 ? '' : '/') + '..'
      state.leadingDotDots += 1
    }
  }
  /**
   * Normalize a path for equality comparison — forward slashes, no trailing
   * separator, lowercased on Windows.
   *
   * @example
   *   ;```typescript
   *   foldPathForCompare('C:\\Program Files\\') // 'c:/program files'
   *   ```
   */
  function foldPathForCompare(pathLike) {
    let normalized = normalizePath(pathLike)
    if (normalized.length > 1 && normalized.endsWith('/'))
      normalized = normalized.slice(0, -1)
    return require_constants_platform.isWin32()
      ? normalized.toLowerCase()
      : normalized
  }
  function hasUncPathPrefix(filepath) {
    const first = require_primordials_string.StringPrototypeCharCodeAt(
      filepath,
      0,
    )
    return (
      filepath.length > 2 &&
      isPathSeparatorCode(first) &&
      require_primordials_string.StringPrototypeCharCodeAt(filepath, 1) ===
        first &&
      require_primordials_string.StringPrototypeCharCodeAt(filepath, 2) !==
        first
    )
  }
  function hasUncPathShare(filepath) {
    const serverEnd = indexOfPathSeparator(
      filepath,
      skipPathSeparators(filepath, 2),
    )
    return (
      serverEnd > 2 && skipPathSeparators(filepath, serverEnd) < filepath.length
    )
  }
  /**
   * Find the next path separator at or after an index.
   *
   * Scans char codes for `/` (47) and `\` (92) — the same two characters
   * `slashRegExp` matches — and allocates nothing. Reaching the same answer
   * through `search` costs a substring, an options bag, and a regex match per
   * lookup, which a segment walk pays once per segment.
   *
   * @example
   *   ;```typescript
   *   indexOfPathSeparator('a/b', 0) // 1
   *   indexOfPathSeparator('a/b', 2) // -1
   *   indexOfPathSeparator('a\\b', 0) // 1
   *   ```
   *
   * @param {string} filepath - The path to scan.
   * @param {number} fromIndex - The index to start scanning at.
   *
   * @returns {number} The index of the first separator at or after `fromIndex`,
   *   or -1 when there is none.
   */
  function indexOfPathSeparator(filepath, fromIndex) {
    const { length } = filepath
    for (let i = fromIndex; i < length; i += 1) {
      const code = require_primordials_string.StringPrototypeCharCodeAt(
        filepath,
        i,
      )
      if (code === 47 || code === 92) return i
    }
    return -1
  }
  function isPathSeparatorCode(code) {
    return code === 47 || code === 92
  }
  function msysDriveToNative(normalized) {
    /* c8 ignore start - Windows-only branch. */
    if (require_constants_platform.isWin32())
      return normalized.replace(
        msysDriveRegExp,
        (_, letter, sep) => `${letter.toUpperCase()}:${sep || '/'}`,
      )
    /* c8 ignore stop */
    return normalized
  }
  function normalizedPathPrefix(filepath) {
    const namespaceKind = require_primordials_string.StringPrototypeCharCodeAt(
      filepath,
      2,
    )
    if (
      filepath.length > 4 &&
      require_primordials_string.StringPrototypeCharCodeAt(filepath, 3) ===
        92 &&
      (namespaceKind === 63 || namespaceKind === 46) &&
      require_primordials_string.StringPrototypeCharCodeAt(filepath, 0) ===
        92 &&
      require_primordials_string.StringPrototypeCharCodeAt(filepath, 1) === 92
    )
      return {
        __proto__: null,
        prefix: '//',
        start: 2,
      }
    if (hasUncPathPrefix(filepath) && hasUncPathShare(filepath))
      return {
        __proto__: null,
        prefix: '//',
        start: 2,
      }
    const start = skipPathSeparators(filepath, 0)
    return {
      __proto__: null,
      prefix: start ? '/' : '',
      start,
    }
  }
  /**
   * Normalize a path by converting backslashes to forward slashes and
   * collapsing segments.
   *
   * - Converts all backslashes (`\`) to forward slashes (`/`)
   * - Collapses repeated slashes
   * - Resolves `.` and `..` segments
   * - Preserves UNC path prefixes (`//server/share`)
   * - Preserves Windows namespace prefixes (`//./`, `//?/`)
   * - Returns `.` for empty or collapsed paths
   * - On Windows: MSYS drive letters `/c/path` become `C:/path`
   *
   * @example
   *   ;```typescript
   *   normalizePath('foo/bar//baz') // 'foo/bar/baz'
   *   normalizePath('foo/./bar') // 'foo/bar'
   *   normalizePath('foo/bar/../baz') // 'foo/baz'
   *   normalizePath('C:\\Users\\u\\file.txt') // 'C:/Users/u/file.txt'
   *   normalizePath('\\\\server\\share\\file') // '//server/share/file'
   *   normalizePath('') // '.'
   *   ```
   *
   * @param {string | Buffer | URL} pathLike - The path to normalize.
   *
   * @returns {string} The normalized path
   *
   * @security
   * **WARNING**: This function resolves `..` patterns as part of normalization, which means
   * paths like `/../etc/passwd` become `/etc/passwd`. When processing untrusted user input
   * (HTTP requests, file uploads, URL parameters), you MUST validate for path traversal
   * attacks BEFORE calling this function.
   */
  function normalizePath(pathLike) {
    const filepath = pathLikeToString(pathLike)
    const { length } = filepath
    if (length === 0) return '.'
    if (length === 1)
      return require_primordials_string.StringPrototypeCharCodeAt(
        filepath,
        0,
      ) === 92
        ? '/'
        : filepath
    const initial = normalizedPathPrefix(filepath)
    const { prefix } = initial
    let { start } = initial
    let nextIndex = indexOfPathSeparator(filepath, start)
    if (nextIndex === -1)
      return normalizeSinglePathSegment(filepath.slice(start), prefix)
    const state = {
      collapsed: '',
      segmentCount: 0,
      leadingDotDots: 0,
    }
    while (nextIndex !== -1) {
      appendNormalizedPathSegment(
        state,
        filepath.slice(start, nextIndex),
        prefix,
      )
      start = skipPathSeparators(filepath, nextIndex + 1)
      nextIndex = indexOfPathSeparator(filepath, start)
    }
    appendNormalizedPathSegment(state, filepath.slice(start), prefix)
    const { collapsed } = state
    if (collapsed.length === 0) return prefix || '.'
    if (
      DRIVE_LETTER_REGEXP.test(collapsed) &&
      isPathSeparatorCode(
        require_primordials_string.StringPrototypeCharCodeAt(filepath, 2),
      )
    )
      return msysDriveToNative(`${prefix}${collapsed}/`)
    return msysDriveToNative(prefix + collapsed)
  }
  function normalizeSinglePathSegment(segment, prefix) {
    if (segment === '.' || segment.length === 0) return prefix || '.'
    if (segment === '..')
      return prefix
        ? require_primordials_string.StringPrototypeSlice(prefix, 0, -1) || '/'
        : '..'
    return msysDriveToNative(prefix + segment)
  }
  /**
   * Convert a path-like value to a string.
   *
   * Converts various path-like types (string, Buffer, URL) into a normalized
   * string representation. Handles different input formats and provides
   * consistent string output for path operations.
   *
   * @example
   *   ;```typescript
   *   pathLikeToString('/home/user') // '/home/user'
   *   pathLikeToString(Buffer.from('/tmp/file')) // '/tmp/file'
   *   pathLikeToString(new URL('file:///home/user')) // '/home/user'
   *   pathLikeToString(null) // ''
   *   ```
   *
   * @param {string | Buffer | URL | null | undefined} pathLike - The value to
   *   convert.
   *
   * @returns {string} The string representation, or empty string for
   *   null/undefined.
   */
  function pathLikeToString(pathLike) {
    if (pathLike === null || pathLike === void 0) return ''
    if (typeof pathLike === 'string') return pathLike
    if (require_primordials_buffer.BufferIsBuffer(pathLike))
      return pathLike.toString('utf8')
    const url = require_node_url.getNodeUrl()
    if (pathLike instanceof URL)
      try {
        return url.fileURLToPath(pathLike)
      } catch {
        const pathname = pathLike.pathname
        const decodedPathname = decodeURIComponent(pathname)
        /* c8 ignore start - Windows-only URL drive-letter handling. */
        if (
          require_constants_platform.isWin32() &&
          require_primordials_string.StringPrototypeStartsWith(
            decodedPathname,
            '/',
          )
        ) {
          const letter =
            require_primordials_string.StringPrototypeCharCodeAt(
              decodedPathname,
              1,
            ) | 32
          if (
            !(
              decodedPathname.length >= 3 &&
              letter >= 97 &&
              letter <= 122 &&
              require_primordials_string.StringPrototypeCharAt(
                decodedPathname,
                2,
              ) === ':'
            )
          )
            return decodedPathname
        }
        /* c8 ignore stop */
        return decodedPathname
      }
    return String(pathLike)
  }
  function skipPathSeparators(filepath, start) {
    while (
      isPathSeparatorCode(
        require_primordials_string.StringPrototypeCharCodeAt(filepath, start),
      )
    )
      start += 1
    return start
  }
  exports.CHAR_BACKWARD_SLASH = require_constants_encoding.CHAR_BACKWARD_SLASH
  exports.CHAR_COLON = require_constants_encoding.CHAR_COLON
  exports.CHAR_FORWARD_SLASH = require_constants_encoding.CHAR_FORWARD_SLASH
  exports.CHAR_LOWERCASE_A = require_constants_encoding.CHAR_LOWERCASE_A
  exports.CHAR_LOWERCASE_Z = require_constants_encoding.CHAR_LOWERCASE_Z
  exports.CHAR_UPPERCASE_A = require_constants_encoding.CHAR_UPPERCASE_A
  exports.CHAR_UPPERCASE_Z = require_constants_encoding.CHAR_UPPERCASE_Z
  exports.appendNormalizedPathSegment = appendNormalizedPathSegment
  exports.collapsePathParent = collapsePathParent
  exports.foldPathForCompare = foldPathForCompare
  exports.hasUncPathPrefix = hasUncPathPrefix
  exports.hasUncPathShare = hasUncPathShare
  exports.indexOfPathSeparator = indexOfPathSeparator
  exports.isPathSeparatorCode = isPathSeparatorCode
  exports.msysDriveRegExp = msysDriveRegExp
  exports.msysDriveToNative = msysDriveToNative
  exports.nodeModulesPathRegExp = nodeModulesPathRegExp
  exports.normalizePath = normalizePath
  exports.normalizeSinglePathSegment = normalizeSinglePathSegment
  exports.normalizedPathPrefix = normalizedPathPrefix
  exports.pathLikeToString = pathLikeToString
  exports.skipPathSeparators = skipPathSeparators
  exports.slashRegExp = slashRegExp
})

var require_conversion = /* @__PURE__ */ __commonJSMin(exports => {
  Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
  const require_constants_platform = require_platform()
  const require_primordials_string = require_string()
  const require_paths_shared = require_shared()
  /**
   * @file Path conversion utilities — MSYS↔native bridging and string-shape
   *   helpers. Split out of `paths/normalize.ts` for size hygiene.
   *
   *   - `fromUnixPath` / `toUnixPath` — MSYS↔native conversion
   *   - `splitPath` — segment-array view of a path
   *   - `trimLeadingDotSlash` — strip a single `./` / `.\` prefix
   */
  /**
   * Convert Unix-style POSIX paths to native Windows paths.
   *
   * This is the inverse of {@link toUnixPath}. On Windows, MSYS-style paths use
   * `/c/` notation for drive letters and forward slashes, which PowerShell and
   * cmd.exe cannot resolve. This function converts them to native Windows
   * format with backslashes and proper drive letters.
   *
   * @example
   *   ;```typescript
   *   fromUnixPath('/c/projects/app/file.txt') // 'C:\\projects\\app\\file.txt' on Windows
   *   fromUnixPath('/tmp/build/output') // '/tmp/build/output'
   *   ```
   *
   * @param {string | Buffer | URL} pathLike - The MSYS/Unix-style path to
   *   convert.
   *
   * @returns {string} Native Windows path or normalized Unix path
   */
  function fromUnixPath(pathLike) {
    const normalized = require_paths_shared.normalizePath(pathLike)
    /* c8 ignore start */
    if (require_constants_platform.isWin32())
      return normalized.replace(/\//g, '\\')
    /* c8 ignore stop */
    return normalized
  }
  /**
   * Split a path into an array of segments.
   *
   * Divides a path into individual components by splitting on both
   * forward-slash and backslash path separators.
   *
   * @example
   *   ;```typescript
   *   splitPath('/workspace/example/file.txt') // ['', 'workspace', 'example', 'file.txt']
   *   splitPath('C:\\Users\\John') // ['C:', 'Users', 'John']
   *   splitPath('') // []
   *   ```
   *
   * @param {string | Buffer | URL} pathLike - The path to split.
   *
   * @returns {string[]} Array of path segments, or empty array for empty paths
   */
  function splitPath(pathLike) {
    const filepath = require_paths_shared.pathLikeToString(pathLike)
    if (filepath === '') return []
    return filepath.split(require_paths_shared.slashRegExp)
  }
  /**
   * Convert Windows paths to MSYS/Unix-style POSIX paths for Git Bash tools.
   *
   * Git for Windows and MSYS2 tools expect POSIX-style paths with forward
   * slashes and Unix drive letter notation (`/c/` instead of `C:\`).
   *
   * This is the inverse of {@link fromUnixPath}.
   *
   * @example
   *   ;```typescript
   *   toUnixPath('C:\\path\\to\\file.txt') // '/c/path/to/file.txt' on Windows
   *   toUnixPath('/workspace/example/file') // '/workspace/example/file'
   *   ```
   *
   * @param {string | Buffer | URL} pathLike - The path to convert.
   *
   * @returns {string} Unix-style POSIX path
   */
  function toUnixPath(pathLike) {
    const normalized = require_paths_shared.normalizePath(pathLike)
    /* c8 ignore start */
    if (require_constants_platform.isWin32())
      return normalized.replace(
        /^([A-Z]):/i,
        (_, letter) => `/${letter.toLowerCase()}`,
      )
    /* c8 ignore stop */
    return normalized
  }
  /**
   * Remove a leading `./` or `.\` prefix from a path.
   *
   * Only removes a single leading `./` or `.\`. Does not touch `../` prefixes.
   *
   * @example
   *   ;```typescript
   *   trimLeadingDotSlash('./src/index.js') // 'src/index.js'
   *   trimLeadingDotSlash('../lib/util.js') // '../lib/util.js'
   *   trimLeadingDotSlash('/absolute/path') // '/absolute/path'
   *   ```
   *
   * @param {string | Buffer | URL} pathLike - The path to process.
   *
   * @returns {string} The path without leading `./` / `.\`, or unchanged
   */
  function trimLeadingDotSlash(pathLike) {
    const filepath = require_paths_shared.pathLikeToString(pathLike)
    if (
      require_primordials_string.StringPrototypeStartsWith(filepath, './') ||
      require_primordials_string.StringPrototypeStartsWith(filepath, '.\\')
    )
      return filepath.slice(2)
    return filepath
  }
  exports.fromUnixPath = fromUnixPath
  exports.splitPath = splitPath
  exports.toUnixPath = toUnixPath
  exports.trimLeadingDotSlash = trimLeadingDotSlash
})

var require_regexp = /* @__PURE__ */ __commonJSMin(exports => {
  Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
  const require_primordials_uncurry = require_uncurry()
  /**
   * @file Safe references to `RegExp` and its prototype methods.
   *   `RegExp.escape` is ES2025; the primordial is typed `Function | undefined`
   *   so older runtimes still load. The Symbol-keyed `[Symbol.match]` /
   *   `[Symbol.replace]` slots are exposed alongside the named methods because
   *   some callers use them via dynamic dispatch (e.g. `String.prototype.match`
   *   invokes `RegExp.prototype[Symbol.match]` internally).
   */
  const RegExpCtor = RegExp
  const RegExpEscape = RegExp.escape
  const RegExpPrototypeExec = require_primordials_uncurry.uncurryThis(
    RegExp.prototype.exec,
  )
  const RegExpPrototypeTest = require_primordials_uncurry.uncurryThis(
    RegExp.prototype.test,
  )
  const RegExpPrototypeSymbolMatch = require_primordials_uncurry.uncurryThis(
    RegExp.prototype[Symbol.match],
  )
  const RegExpPrototypeSymbolReplace = require_primordials_uncurry.uncurryThis(
    RegExp.prototype[Symbol.replace],
  )
  exports.RegExpCtor = RegExpCtor
  exports.RegExpEscape = RegExpEscape
  exports.RegExpPrototypeExec = RegExpPrototypeExec
  exports.RegExpPrototypeSymbolMatch = RegExpPrototypeSymbolMatch
  exports.RegExpPrototypeSymbolReplace = RegExpPrototypeSymbolReplace
  exports.RegExpPrototypeTest = RegExpPrototypeTest
})

var require_predicates$2 = /* @__PURE__ */ __commonJSMin(exports => {
  Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
  const require_constants_platform = require_platform()
  const require_primordials_string = require_string()
  require_encoding()
  const require_paths_shared = require_shared()
  const require_primordials_regexp = require_regexp()
  /**
   * @file Path predicates — `is*` checks for path shape and kind. Split out of
   *   `paths/normalize.ts` for file-size hygiene. Pure boolean predicates over
   *   paths and character codes.
   *
   *   - `isAbsolute`, `isRelative` — root-anchoring shape
   *   - `isPath` — file-path vs package-spec vs URL discriminator
   *   - `isNodeModules`, `isUnixPath` — content-pattern checks
   *   - `isPathSeparator`, `isWindowsDeviceRoot` — char-code primitives
   *   - `isPathWithinRoot` — realpath containment check
   */
  /**
   * Check if a path is absolute.
   *
   * Handles both POSIX (`/...`) and Windows (drive-letter, UNC, device)
   * absolute path shapes.
   *
   * @example
   *   ;```typescript
   *   isAbsolute('/home/user') // true
   *   isAbsolute('C:\\Windows') // true on Windows
   *   isAbsolute('../relative') // false
   *   ```
   *
   * @param {string | Buffer | URL} pathLike - The path to check.
   *
   * @returns {boolean} `true` if absolute, `false` otherwise
   */
  function isAbsolute(pathLike) {
    const filepath = require_paths_shared.pathLikeToString(pathLike)
    const { length } = filepath
    if (length === 0) return false
    const code = require_primordials_string.StringPrototypeCharCodeAt(
      filepath,
      0,
    )
    if (code === 47) return true
    if (code === 92) return true
    /* c8 ignore start - Windows drive-letter detection. */
    if (require_constants_platform.isWin32() && length > 2) {
      if (
        isWindowsDeviceRoot(code) &&
        require_primordials_string.StringPrototypeCharCodeAt(filepath, 1) ===
          58 &&
        isPathSeparator(
          require_primordials_string.StringPrototypeCharCodeAt(filepath, 2),
        )
      )
        return true
    }
    /* c8 ignore stop */
    return false
  }
  /**
   * Check if a path contains a `node_modules` directory segment.
   *
   * Matches `node_modules` only as a complete path segment.
   *
   * @example
   *   ;```typescript
   *   isNodeModules('/project/node_modules/package') // true
   *   isNodeModules('/src/my_node_modules_backup') // false
   *   ```
   *
   * @param {string | Buffer | URL} pathLike - The path to check.
   *
   * @returns {boolean} `true` if the path contains `node_modules`
   */
  function isNodeModules(pathLike) {
    const filepath = require_paths_shared.pathLikeToString(pathLike)
    return require_primordials_regexp.RegExpPrototypeTest(
      require_paths_shared.nodeModulesPathRegExp,
      filepath,
    )
  }
  /**
   * Check if a value is a valid absolute or relative file path.
   *
   * Distinguishes between file paths and other string formats like package
   * names, URLs, or bare module specifiers.
   *
   * @example
   *   ;```typescript
   *   isPath('/absolute/path') // true
   *   isPath('./relative/path') // true
   *   isPath('@scope/name/subpath') // true
   *   isPath('lodash') // false
   *   isPath('http://example.com') // false
   *   ```
   *
   * @param {string | Buffer | URL} pathLike - The value to check.
   *
   * @returns {boolean} `true` if the value is a valid file path
   */
  function isPath(pathLike) {
    const filepath = require_paths_shared.pathLikeToString(pathLike)
    if (typeof filepath !== 'string' || filepath.length === 0) return false
    if (/^[a-z][a-z0-9+.-]+:/i.test(filepath)) return false
    if (filepath === '.' || filepath === '..') return true
    if (isAbsolute(filepath)) return true
    if (filepath.includes('/') || filepath.includes('\\')) {
      if (
        require_primordials_string.StringPrototypeStartsWith(filepath, '@') &&
        !require_primordials_string.StringPrototypeStartsWith(filepath, '@/')
      ) {
        const parts = filepath.split('/')
        if (parts.length <= 2 && !parts[1]?.includes('\\')) return false
      }
      return true
    }
    return false
  }
  /**
   * Check if a character code is a path separator (`/` or `\`).
   *
   * @example
   *   ;```typescript
   *   isPathSeparator(47) // true — '/'
   *   isPathSeparator(92) // true — '\'
   *   isPathSeparator(65) // false — 'A'
   *   ```
   *
   * @param {number} code - The character code to check.
   *
   * @returns {boolean} `true` if separator
   */
  function isPathSeparator(code) {
    return code === 47 || code === 92
  }
  /**
   * Report whether a path sits at or under a root. Both sides must already be
   * realpath'd.
   *
   * @example
   *   ;```typescript
   *   isPathWithinRoot('/repo/bin/git', '/repo') // true
   *   isPathWithinRoot('/usr/bin/git', '/repo') // false
   *   ```
   */
  function isPathWithinRoot(candidate, root) {
    const left = require_paths_shared.foldPathForCompare(candidate)
    const right = require_paths_shared.foldPathForCompare(root)
    return left === right || left.startsWith(`${right}/`)
  }
  /**
   * Check if a path is relative (i.e., not absolute).
   *
   * Empty strings are treated as relative.
   *
   * @example
   *   ;```typescript
   *   isRelative('./src/index.js') // true
   *   isRelative('src/file.js') // true
   *   isRelative('/home/user') // false
   *   ```
   *
   * @param {string | Buffer | URL} pathLike - The path to check.
   *
   * @returns {boolean} `true` if the path is relative
   */
  function isRelative(pathLike) {
    const filepath = require_paths_shared.pathLikeToString(pathLike)
    /* c8 ignore start */
    if (typeof filepath !== 'string') return false
    /* c8 ignore stop */
    if (filepath.length === 0) return true
    return !isAbsolute(filepath)
  }
  /**
   * Check if a value is wrapped in path separators on BOTH ends — the
   * `/wrapped/` sigil some list formats use to mark a substring (not exact)
   * entry. Either separator direction counts on either end, so a stray
   * backslash-wrapped entry is still read as the sigil rather than silently
   * treated as an exact path.
   *
   * @example
   *   ;```typescript
   *   isSeparatorWrapped('/rendering-chromium-to-png/') // true
   *   isSeparatorWrapped('\\rendering-chromium-to-png\\') // true
   *   isSeparatorWrapped('scripts/fleet/acquire.mts') // false
   *   isSeparatorWrapped('//') // false
   *   ```
   *
   * @param {string | Buffer | URL} pathLike - The value to check.
   *
   * @returns {boolean} `true` if both ends are path separators with content
   *   between.
   */
  function isSeparatorWrapped(pathLike) {
    const filepath = require_paths_shared.pathLikeToString(pathLike)
    const { length } = filepath
    if (length < 3) return false
    return (
      isPathSeparator(
        require_primordials_string.StringPrototypeCharCodeAt(filepath, 0),
      ) &&
      isPathSeparator(
        require_primordials_string.StringPrototypeCharCodeAt(
          filepath,
          length - 1,
        ),
      )
    )
  }
  /**
   * Check if a path uses MSYS/Git Bash Unix-style drive letter notation.
   *
   * Detects paths in the format `/c/...` where a single letter after the
   * leading slash represents a Windows drive letter.
   *
   * @example
   *   ;```typescript
   *   isUnixPath('/c/tools/bin') // true
   *   isUnixPath('/tmp/build') // false
   *   isUnixPath('C:/Windows') // false
   *   ```
   *
   * @param {string | Buffer | URL} pathLike - The path to check.
   *
   * @returns {boolean} `true` if the path uses MSYS drive letter notation
   */
  function isUnixPath(pathLike) {
    const filepath = require_paths_shared.pathLikeToString(pathLike)
    return (
      typeof filepath === 'string' &&
      require_primordials_regexp.RegExpPrototypeTest(
        require_paths_shared.msysDriveRegExp,
        filepath,
      )
    )
  }
  /**
   * Check if a character code is a Windows device root letter (A-Z / a-z).
   *
   * @example
   *   ;```typescript
   *   isWindowsDeviceRoot(67) // true  — 'C'
   *   isWindowsDeviceRoot(99) // true  — 'c'
   *   isWindowsDeviceRoot(58) // false — ':'
   *   ```
   *
   * @param {number} code - The character code to check.
   *
   * @returns {boolean} `true` if valid drive-letter code
   */
  /* c8 ignore start - Only called from Windows-only branches. */
  function isWindowsDeviceRoot(code) {
    return (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
  }
  /* c8 ignore stop */
  /**
   * The forward-slash substring form of a separator-wrapped entry, or
   * undefined when the value is not wrapped. The inner segment's backslashes
   * become forward slashes so the needle matches against normalized paths.
   *
   * @example
   *   ;```typescript
   *   separatorWrappedSubstring('/rendering-chromium-to-png/') // '/rendering-chromium-to-png/'
   *   separatorWrappedSubstring('\\rendering-chromium-to-png\\') // '/rendering-chromium-to-png/'
   *   separatorWrappedSubstring('scripts/fleet/acquire.mts') // undefined
   *   ```
   *
   * @param {string | Buffer | URL} pathLike - The value to convert.
   *
   * @returns {string | undefined} The `/inner/` substring form, or undefined
   */
  function separatorWrappedSubstring(pathLike) {
    if (!isSeparatorWrapped(pathLike)) return
    const filepath = require_paths_shared.pathLikeToString(pathLike)
    return `/${require_paths_shared.normalizePath(require_primordials_string.StringPrototypeSlice(filepath, 1, -1))}/`
  }
  exports.isAbsolute = isAbsolute
  exports.isNodeModules = isNodeModules
  exports.isPath = isPath
  exports.isPathSeparator = isPathSeparator
  exports.isPathWithinRoot = isPathWithinRoot
  exports.isRelative = isRelative
  exports.isSeparatorWrapped = isSeparatorWrapped
  exports.isUnixPath = isUnixPath
  exports.isWindowsDeviceRoot = isWindowsDeviceRoot
  exports.separatorWrappedSubstring = separatorWrappedSubstring
})

var require_resolve = /* @__PURE__ */ __commonJSMin(exports => {
  Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
  const require_constants_platform = require_platform()
  const require_primordials_string = require_string()
  require_encoding()
  const require_paths_shared = require_shared()
  const require_paths_predicates = require_predicates$2()
  /**
   * @file Path resolution utilities — `resolve`, `relative`, `relativeResolve`.
   *   Split out of `paths/normalize.ts` for size hygiene.
   *
   *   - `resolve` — Node-style `path.resolve()` over absolute-path semantics
   *   - `relative` — relative path from one absolute to another
   *   - `relativeResolve` — `relative` + `normalizePath` convenience wrapper
   */
  function findCommonPathPrefix(actualFrom, actualTo) {
    const length =
      actualFrom.length < actualTo.length
        ? actualFrom.length - 1
        : actualTo.length - 1
    let lastCommonSep = -1
    let i = 0
    for (; i < length; i += 1) {
      let fromCode = require_primordials_string.StringPrototypeCharCodeAt(
        actualFrom,
        1 + i,
      )
      let toCode = require_primordials_string.StringPrototypeCharCodeAt(
        actualTo,
        1 + i,
      )
      /* c8 ignore start - Windows-only case folding. */
      if (require_constants_platform.isWin32()) {
        if (fromCode >= 65 && fromCode <= 90) fromCode += 32
        if (toCode >= 65 && toCode <= 90) toCode += 32
      }
      /* c8 ignore stop */
      if (fromCode !== toCode) break
      if (
        require_paths_predicates.isPathSeparator(
          require_primordials_string.StringPrototypeCharCodeAt(
            actualFrom,
            1 + i,
          ),
        )
      )
        lastCommonSep = i
    }
    return {
      __proto__: null,
      length,
      index: i,
      lastCommonSep,
    }
  }
  /**
   * Calculate the relative path from one path to another.
   *
   * Both inputs are resolved to absolute paths first, then compared to find the
   * longest common base, and finally a relative path is constructed using `../`
   * for parent-directory traversal.
   *
   * Windows file systems are case-insensitive; the comparison reflects that.
   *
   * @example
   *   ;```typescript
   *   relative('/foo/bar', '/foo/baz') // '../baz'
   *   relative('/foo/bar/baz', '/foo') // '../..'
   *   relative('/foo', '/foo/bar') // 'bar'
   *   relative('/foo/bar', '/foo/bar') // ''
   *   ```
   *
   * @param {string} from - Source path.
   * @param {string} to - Destination path.
   *
   * @returns {string} Relative path from `from` to `to`, or empty string if
   *   equal.
   */
  function relative(from, to) {
    if (from === to) return ''
    const actualFrom = resolve$1(from)
    const actualTo = resolve$1(to)
    if (actualFrom === actualTo) return ''
    /* c8 ignore start - Windows-only case-insensitive comparison. */
    if (require_constants_platform.isWin32()) {
      if (actualFrom.toLowerCase() === actualTo.toLowerCase()) return ''
    }
    /* c8 ignore stop */
    const fromStart = 1
    const fromLen = actualFrom.length - fromStart
    const toStart = 1
    const toLen = actualTo.length - toStart
    const common = findCommonPathPrefix(actualFrom, actualTo)
    const { length, index: i } = common
    let { lastCommonSep } = common
    /* c8 ignore start */
    if (i === length) {
      if (toLen > length) {
        const toCode = require_primordials_string.StringPrototypeCharCodeAt(
          actualTo,
          toStart + i,
        )
        if (require_paths_predicates.isPathSeparator(toCode))
          return actualTo.slice(toStart + i + 1)
        if (i === 0) return actualTo.slice(toStart + i)
      } else if (fromLen > length) {
        const fromCode = require_primordials_string.StringPrototypeCharCodeAt(
          actualFrom,
          fromStart + i,
        )
        if (require_paths_predicates.isPathSeparator(fromCode))
          lastCommonSep = i
        else if (i === 0) lastCommonSep = 0
      }
    }
    return (
      relativePathParentSegments(actualFrom, fromStart + lastCommonSep + 1) +
      actualTo.slice(toStart + lastCommonSep)
    )
  }
  function relativePathParentSegments(actualFrom, start) {
    const fromEnd = actualFrom.length
    let out = ''
    for (let i = start; i <= fromEnd; i += 1) {
      const code = require_primordials_string.StringPrototypeCharCodeAt(
        actualFrom,
        i,
      )
      if (i === fromEnd || require_paths_predicates.isPathSeparator(code))
        out += out.length === 0 ? '..' : '/..'
    }
    return out
  }
  /**
   * Get the normalized relative path from one path to another.
   *
   * Computes the relative path using `relative()` then runs the result through
   * `normalizePath()`. An empty string, meaning the same path, is preserved
   * verbatim rather than collapsed to `.`.
   *
   * @example
   *   ;```typescript
   *   relativeResolve('/foo/bar', '/foo/baz') // '../baz'
   *   relativeResolve('/foo/bar', '/foo/bar') // ''
   *   relativeResolve('/foo/./bar', '/foo/baz') // '../baz'
   *   ```
   *
   * @param {string} from - Source path.
   * @param {string} to - Destination path.
   *
   * @returns {string} Normalized relative path, or empty string if equal
   */
  function relativeResolve(from, to) {
    const rel = relative(from, to)
    if (rel === '') return ''
    return require_paths_shared.normalizePath(rel)
  }
  /**
   * Resolve an absolute path from path segments.
   *
   * Mimics Node.js `path.resolve()`: processes segments right-to-left, stops at
   * the first absolute segment, and prepends the cwd if no absolute segment is
   * found. The final path is normalized.
   *
   * @example
   *   ;```typescript
   *   resolve('foo', 'bar', 'baz') // '/cwd/foo/bar/baz'
   *   resolve('/foo', 'bar', 'baz') // '/foo/bar/baz'
   *   resolve('foo', '/bar', 'baz') // '/bar/baz'
   *   resolve() // '/cwd'
   *   ```
   *
   * @param {...string} segments - Path segments to resolve.
   *
   * @returns {string} The resolved absolute path
   */
  function resolve$1(...segments) {
    let resolvedPath = ''
    let resolvedAbsolute = false
    for (let i = segments.length - 1; i >= 0 && !resolvedAbsolute; i -= 1) {
      const segment = segments[i]
      /* c8 ignore start */
      if (typeof segment !== 'string' || segment.length === 0) continue
      resolvedPath =
        segment + (resolvedPath.length === 0 ? '' : `/${resolvedPath}`)
      resolvedAbsolute = require_paths_predicates.isAbsolute(segment)
    }
    if (!resolvedAbsolute)
      resolvedPath =
        /* @__PURE__ */ __require('node:process').cwd() +
        (resolvedPath.length === 0 ? '' : `/${resolvedPath}`)
    /* c8 ignore stop */
    return require_paths_shared.normalizePath(resolvedPath)
  }
  exports.findCommonPathPrefix = findCommonPathPrefix
  exports.relative = relative
  exports.relativePathParentSegments = relativePathParentSegments
  exports.relativeResolve = relativeResolve
  exports.resolve = resolve$1
})

var require_normalize = /* @__PURE__ */ __commonJSMin(exports => {
  Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
  const require_paths_shared = require_shared()
  const require_paths_conversion = require_conversion()
  const require_paths_predicates = require_predicates$2()
  const require_paths_resolve = require_resolve()
  exports.foldPathForCompare = require_paths_shared.foldPathForCompare
  exports.fromUnixPath = require_paths_conversion.fromUnixPath
  exports.isAbsolute = require_paths_predicates.isAbsolute
  exports.isNodeModules = require_paths_predicates.isNodeModules
  exports.isPath = require_paths_predicates.isPath
  exports.isPathSeparator = require_paths_predicates.isPathSeparator
  exports.isRelative = require_paths_predicates.isRelative
  exports.isSeparatorWrapped = require_paths_predicates.isSeparatorWrapped
  exports.isUnixPath = require_paths_predicates.isUnixPath
  exports.isWindowsDeviceRoot = require_paths_predicates.isWindowsDeviceRoot
  exports.msysDriveToNative = require_paths_shared.msysDriveToNative
  exports.normalizePath = require_paths_shared.normalizePath
  exports.pathLikeToString = require_paths_shared.pathLikeToString
  exports.relative = require_paths_resolve.relative
  exports.relativeResolve = require_paths_resolve.relativeResolve
  exports.resolve = require_paths_resolve.resolve
  exports.separatorWrappedSubstring =
    require_paths_predicates.separatorWrappedSubstring
  exports.splitPath = require_paths_conversion.splitPath
  exports.toUnixPath = require_paths_conversion.toUnixPath
  exports.trimLeadingDotSlash = require_paths_conversion.trimLeadingDotSlash
})

var import_normalize = require_normalize()
const FLEET_CANONICAL_END_SENTINEL = ['#fleet', 'canonical', 'end'].join('-')
const FLEET_CANONICAL_SPLICE_FILES = [
  '.config/fleet/oxlintrc.json',
  '.config/fleet/.prettierignore',
  '.npmrc',
]
/**
 * True when `relPath`, repo-relative, either separator, is a designated
 * segment file — the path gate every splice call site checks first.
 */
function isFleetCanonicalSpliceFile(relPath) {
  return FLEET_CANONICAL_SPLICE_FILES.includes(
    (0, import_normalize.normalizePath)(relPath),
  )
}
/**
 * Index just past the first end-sentinel token, including the closing quote
 * when the sentinel is a JSON string element. Returns -1 when the sentinel is
 * absent. The FIRST occurrence is the boundary — a tail that mentions the
 * sentinel text again never moves it.
 */
function fleetCanonicalEndBoundary(content) {
  const idx = content.indexOf(FLEET_CANONICAL_END_SENTINEL)
  if (idx === -1) return -1
  let boundary = idx + FLEET_CANONICAL_END_SENTINEL.length
  if (content.charCodeAt(boundary) === 34) boundary += 1
  return boundary
}
/**
 * True when `content` carries the end sentinel, i.e. placement must be
 * sentinel-scoped rather than a whole-file copy. Content is the SECOND gate:
 * call sites gate on `isFleetCanonicalSpliceFile` first — a non-designated
 * file is always a plain byte copy no matter what its content mentions.
 */
function hasFleetCanonicalEndSentinel(content) {
  return content.includes(FLEET_CANONICAL_END_SENTINEL)
}
const REPO_REGION_BEGIN_TOKEN = '<repo>'
const REPO_REGION_END_TOKEN = '</repo>'
/**
 * True when `tail` (the bytes after a file's end-sentinel boundary) already
 * carries a `<repo>` wrapper — the seeded, host-owned carve-out
 * `.claude/hooks/fleet/_shared/fleet-markers.mts` defines. A tail with no
 * wrapper at all is either a not-yet-seeded target or a segment file that
 * never uses the wrapper at all, e.g. `.prettierignore`, in which case there
 * is nothing to seed.
 */
function tailHasRepoRegion(tail) {
  return tail.includes(REPO_REGION_BEGIN_TOKEN)
}
/**
 * The seed fragment a source tail carries for a not-yet-migrated target:
 * everything from the start of `sourceTail`, right after the sentinel,
 * through the end of its `</repo>` marker, closing quote included when
 * present. Returns `''` when `sourceTail` has no `</repo>` to anchor on —
 * defensive; callers only reach here after confirming `sourceTail` has a
 * `<repo>` begin marker.
 */
function repoSeedFragment(sourceTail) {
  const idx = sourceTail.indexOf(REPO_REGION_END_TOKEN)
  if (idx === -1) return ''
  let end = idx + 7
  if (sourceTail.charCodeAt(end) === 34) end += 1
  return sourceTail.slice(0, end)
}
/**
 * Compute the placement result for a designated segment file: the canonical
 * source's bytes through its end sentinel, followed by the target's bytes
 * after its own end sentinel — the repo-local tail, preserved byte-for-byte.
 * A target with no tail round-trips to exactly the source bytes. When either
 * side lacks the end sentinel the source wins whole — the plain mirror-copy
 * behavior, which also seeds a first placement.
 *
 * When the source seeds a `<repo>` wrapper right after the sentinel but the
 * target's own tail has none at all, graft the source's seed onto the FRONT
 * of the target's tail — the empty, "written but not yet populated" carve-out
 * a target that predates the seed, or was cascaded before this seeding
 * existed, never got. A target whose tail already carries a `<repo>` marker
 * anywhere keeps that tail completely untouched, whatever else it holds.
 */
function spliceFleetCanonicalContent(source, target) {
  const sourceBoundary = fleetCanonicalEndBoundary(source)
  if (sourceBoundary === -1) return source
  const targetBoundary = fleetCanonicalEndBoundary(target)
  if (targetBoundary === -1) return source
  const sourceTail = source.slice(sourceBoundary)
  const targetTail = target.slice(targetBoundary)
  const seed =
    tailHasRepoRegion(sourceTail) && !tailHasRepoRegion(targetTail)
      ? repoSeedFragment(sourceTail)
      : ''
  return source.slice(0, sourceBoundary) + seed + targetTail
}

const logger$3 = getDep0Logger()
function normalizeManifestEntryPath(entry) {
  return normalizeBundlePath(entry.path)
}
/**
 * Drop the manifest's shape-scoped files that the member's build shape does
 * not ship, so every downstream consumer (placement, prune, ignore refresh,
 * applied-files record) sees one consistent, member-effective file set. The
 * matcher mirrors releaseChecksumFiles in commit-cascade/repo-shape.mts;
 * the group DATA is stamped by make-publish-bundle from that one source.
 * Fail-open: no stamped groups, or an unknown shape (absent/malformed member
 * config), returns the manifest untouched — a config problem must never
 * withhold payload.
 */
/**
 * Drop the manifest's capability-scoped hook payloads the member does not
 * declare, so a `@capability cargo` hook never lands in a repo with no cargo
 * capability — the pack-side twin of the cascade's dirMirrorSkipPredicate
 * capability gate. Fails OPEN on an unknown capabilities read (absent or
 * malformed settings file): a config problem must never withhold payload.
 * The prune sees the same filtered set, so a wrongly placed copy heals on
 * the next fetch.
 */
function filterManifestForCapabilities(manifest, capabilities) {
  const groups = manifest.capabilityScopedFiles
  if (!groups?.length || capabilities === void 0) return manifest
  const declared = new Set(capabilities)
  const excluded = /* @__PURE__ */ new Set()
  for (let i = 0, { length } = groups; i < length; i += 1) {
    const group = groups[i]
    if (declared.has(group.capability)) continue
    for (let j = 0, { length: flen } = group.files; j < flen; j += 1)
      excluded.add(normalizeBundlePath(group.files[j]))
  }
  if (!excluded.size) return manifest
  const files = {}
  for (const { 0: rel, 1: hash } of Object.entries(manifest.files))
    if (!excluded.has(normalizeBundlePath(rel))) files[rel] = hash
  return {
    ...manifest,
    files,
  }
}
function filterManifestForShape(manifest, shape) {
  const groups = manifest.shapeScopedFiles
  if (!groups?.length || shape.from === void 0) return manifest
  const excluded = /* @__PURE__ */ new Set()
  for (let i = 0, { length } = groups; i < length; i += 1) {
    const group = groups[i]
    if (
      !group.ship.some(
        cond =>
          cond.from === shape.from &&
          (cond.types === void 0 ||
            (shape.type !== void 0 && cond.types.includes(shape.type))),
      )
    )
      for (let j = 0, { length: flen } = group.files; j < flen; j += 1)
        excluded.add(normalizeBundlePath(group.files[j]))
  }
  if (!excluded.size) return manifest
  const files = {}
  for (const { 0: rel, 1: hash } of Object.entries(manifest.files))
    if (!excluded.has(normalizeBundlePath(rel))) files[rel] = hash
  return {
    ...manifest,
    files,
  }
}
/**
 * Compute the gitignore entries for thin mode — the wholly-fleet files that the
 * download/fetch action supplies, so they need not be git-tracked. Hybrid paths
 * (manifest.segments — AGENTS.md, pnpm-workspace.yaml, …) are merged per repo
 * and stay tracked, so they're excluded. The DESIGNATED sentinel-splice files
 * are hybrids too — they carry a member tail below the fleet-canonical end
 * sentinel that only the member's git history preserves; untracking one turns
 * the next fresh clone into a tail wipe.
 *
 * The GitHub CI surface (`isAlwaysTrackedGitHubSurface` —
 * `.github/workflows/**` and `.github/actions/fleet/**`) is HARD-excluded too:
 * GitHub reads a workflow's cron and a `uses: ./.github/actions/...` composite
 * from the committed default-branch tree BEFORE any fetch step runs, so
 * untracking one breaks CI outright. The bundle still ships them; they reach
 * members in the cascade COMMIT, tracked.
 *
 * EVERY entry is EXPLICIT — one line per bundle file, never a blanket
 * `…/fleet/` dir entry. A dir blanket also swallows any future non-bundle
 * file that lands beside the payload, hiding it from git entirely; the
 * explicit list ignores exactly what the bundle supplies and nothing else.
 * The sync-prune is manifest-scoped too — see pruneStaleFleetFiles.
 */
function fleetPackOwnedPaths(manifest) {
  const hybridPaths = computeHybridPaths(manifest)
  const repoOwnedPaths = new Set(
    (manifest.repoOwnedFiles ?? []).map(normalizeBundlePath),
  )
  const entries = /* @__PURE__ */ new Set()
  const files = Object.keys(manifest.files)
  for (let i = 0, { length } = files; i < length; i += 1) {
    const p = normalizeBundlePath(files[i])
    if (
      hybridPaths.has(p) ||
      repoOwnedPaths.has(p) ||
      isFleetCanonicalSpliceFile(p) ||
      isAlwaysTrackedSurface(p)
    )
      continue
    entries.add(p)
  }
  return [...entries].toSorted()
}
/**
 * The lines currently inside a target's fleet-marked gitignore block, or an
 * empty array when the target has no block. Used to carry the cascade's rules
 * through the thin-mode splice instead of replacing them.
 */
function extractFleetBlockLines(target) {
  const begin = beginMarker('hash')
  const end = endMarker('hash')
  const beginAt = target.indexOf(begin)
  if (beginAt === -1) return []
  const bodyStart = beginAt + begin.length
  if (target.indexOf(end, bodyStart) === -1) return []
  return parseGitignoreSections(target).fleet.filter(line => line.trim() !== '')
}
/**
 * Harness surfaces the fleet generates from tracked authority files.
 *
 * Each is a projection of a Claude-side source: `AGENTS.md` and the rule dirs
 * point at AGENTS.md, `opencode.json` / `.codex/` project `.mcp.json`, and
 * `.agents/skills/` flattens `.claude/skills/` for the hosts that discover
 * skills one level deep. Regenerating them is cheap; tracking them means every
 * member carries a copy that drifts and conflicts.
 *
 * Thin conversion ignores and untracks these generated surfaces. AGENTS.md
 * remains tracked as the authoritative repository rules.
 */
const HARNESS_ALIAS_PATHS = [
  '.agents/',
  '.clinerules/',
  '.codex/',
  '.cursor/',
  '.kiro/',
  '.opencode/',
  '.windsurf/',
  'CLAUDE.md',
  'opencode.json',
]
function isLegacyFleetRegionUntrackEntry(line) {
  if (HARNESS_ALIAS_PATHS.includes(line)) return true
  return (
    line !== '' &&
    !line.startsWith('#') &&
    !line.startsWith('!') &&
    !line.startsWith('/') &&
    !line.includes('*') &&
    !line.endsWith('/') &&
    line.includes('/')
  )
}
/**
 * The header an OLDER fetcher wrote above its untrack list, before the region
 * gained `<fleet-pack>` markers.
 */
const LEGACY_PACK_HEADER_RE = /^#[\s\u2500-]*fleet-pack thin untrack list\b/
/**
 * Strip a pre-marker untrack block: its header plus the run of path lines under
 * it, up to the next comment or end of file.
 *
 * Without markers there is nothing for {@link splicePackBlock} to replace, so
 * such a block is never regenerated and never pruned. Its entries then outlive
 * their reason: measured on ultrathink, a 2498-line legacy block still ignored
 * `.config/repo/vitest.config.mts` long after that file was reclassified from
 * bundle payload to a cascaded conditional-group file, so the member could not
 * track it and CI's fresh clone had no copy at all. Removing the whole run is
 * safe because the block is wholly tool-written — every line is an exact path,
 * so a hand-authored glob or directory ignore never lives inside it — and
 * anything the CURRENT manifest still ships is re-emitted into the managed
 * region on the same hydrate.
 */
function stripLegacyPackBlock(target) {
  const lines = target.split(/\r?\n/)
  const headerIdx = lines.findIndex(line => LEGACY_PACK_HEADER_RE.test(line))
  if (headerIdx === -1) return target
  let endIdx = headerIdx + 1
  for (let i = headerIdx + 1, { length } = lines; i < length; i += 1) {
    if (lines[i].startsWith('#')) break
    endIdx = i + 1
  }
  return [...lines.slice(0, headerIdx), ...lines.slice(endIdx)].join('\n')
}
/**
 * Strip the old refresh's per-file untrack entries from INSIDE the `<fleet>`
 * region — they live in the fetcher-owned `<fleet-pack>` region now. The
 * cascade's own rules in the region are preserved untouched; a file with no
 * fleet region is returned unchanged. One-time migration shape: once a member
 * has been cleaned (or its cascade rewrote the block), this is a no-op.
 */
function stripLegacyUntrackEntriesFromFleetBlock(target) {
  const begin = beginMarker('hash')
  const end = endMarker('hash')
  const lines = target.split(/\r?\n/)
  const startIdx = lines.findIndex(l => l === begin)
  const endIdx = lines.findIndex(l => l === end)
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return target
  const body = lines
    .slice(startIdx + 1, endIdx)
    .filter(l => !isLegacyFleetRegionUntrackEntry(l))
  return [
    ...lines.slice(0, startIdx + 1),
    ...body,
    ...lines.slice(endIdx),
  ].join('\n')
}
/**
 * Refresh exact tracked fleet paths using the active ownership classification.
 */
function refreshFleetPackIgnores(config) {
  const { dest, manifest } = {
    __proto__: null,
    ...config,
  }
  const sortedRoots = fleetPackOwnedPaths(manifest)
  const gitignorePath = path.join(dest, '.gitignore')
  const existing = existsSync(gitignorePath)
    ? readFileSync(gitignorePath, 'utf8')
    : ''
  const migrated = stripLegacyPackBlock(
    existing.includes(packBeginMarker())
      ? existing
      : stripLegacyUntrackEntriesFromFleetBlock(existing),
  )
  const packBlock = [
    packBeginMarker(),
    '# Fleet-pack untrack set — managed by scripts/repo/bootstrap/fleet.mjs.',
    '# REGENERATED from the publish-bundle manifest on every hydrate; stale',
    '# entries are pruned. Hand-added ignores belong OUTSIDE these markers.',
    ...HARNESS_ALIAS_PATHS,
    ...sortedRoots,
    packEndMarker(),
  ].join('\n')
  const sections = parseGitignoreSections(migrated)
  const fleetAllowlist = fleetTrackedAllowlist(
    manifest,
    sections.fleetAllowlist,
    HARNESS_ALIAS_PATHS,
  )
  const updated = composeGitignore({
    packBlock,
    target: migrated,
    fleetAllowlist,
  })
  writeFileSync(gitignorePath, updated)
  assertFleetTrackedPathsVisible(dest, fleetAllowlist)
}
function readFleetTrackedPaths(dest) {
  try {
    return new Set(
      execFileSync('git', ['ls-files', '--cached', '-z'], {
        cwd: dest,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
        .split('\0')
        .filter(Boolean)
        .map(normalizeBundlePath),
    )
  } catch (error) {
    throw new Error(
      `install-fleet: cannot read the tracked-path inventory for ${dest}; automatic hydration stopped before writing files: ${errorMessage(error)}. Fix the Git checkout, then retry.`,
      { cause: error },
    )
  }
}
function refreshFleetPackCheckoutExcludes(config) {
  const cfg = {
    __proto__: null,
    ...config,
  }
  let excludePath
  try {
    const gitPath = execFileSync(
      'git',
      ['rev-parse', '--git-path', 'info/exclude'],
      {
        cwd: cfg.dest,
        encoding: 'utf8',
      },
    ).trim()
    excludePath = path.resolve(cfg.dest, gitPath)
  } catch {
    return
  }
  const existing = existsSync(excludePath)
    ? readFileSync(excludePath, 'utf8')
    : ''
  const begin = packBeginMarker()
  const end = packEndMarker()
  const start = existing.indexOf(begin)
  const finish = start === -1 ? -1 : existing.indexOf(end, start + begin.length)
  const withoutManaged =
    start === -1
      ? existing.trimEnd()
      : `${existing.slice(0, start).trimEnd()}\n${finish === -1 ? '' : existing.slice(finish + end.length).trimStart()}`.trimEnd()
  const block = [
    begin,
    ...HARNESS_ALIAS_PATHS,
    ...fleetPackOwnedPaths(cfg.manifest),
    end,
  ].join('\n')
  mkdirSync(path.dirname(excludePath), { recursive: true })
  writeFileSync(
    excludePath,
    `${withoutManaged ? `${withoutManaged}\n` : ''}${block}\n`,
  )
}
/**
 * Apply thin mode: refresh the gitignore block (refreshFleetPackIgnores), then
 * untrack those paths from git so the fetch action repopulates them going
 * forward. The `git rm --cached` is the CONVERSION step and is destructive —
 * it drops files from the index — so it stays behind an explicit `--thin` and
 * is never inferred from repo state. socket-vscode is the case that forces the
 * distinction: a repo can carry still-tracked payload files, so inferring
 * conversion from runtime hydration state would silently delete them from its
 * index on the next ordinary hydrate.
 */
function untrackFleetPackPaths(config) {
  const cfg = {
    __proto__: null,
    ...config,
  }
  const { dest, manifest } = cfg
  refreshFleetPackIgnores(cfg)
  const rmTargets = [...HARNESS_ALIAS_PATHS, ...fleetPackOwnedPaths(manifest)]
  if (rmTargets.length > 0)
    try {
      execFileSync(
        'git',
        ['rm', '-r', '--cached', '--ignore-unmatch', ...rmTargets],
        {
          cwd: dest,
          stdio: 'inherit',
        },
      )
    } catch (e) {
      logger$3.log(
        `install-fleet: --thin: git rm --cached failed (non-fatal) — ${errorMessage(e)}`,
      )
    }
}

function effectiveMemberManifest(manifest, dest) {
  return filterManifestForCapabilities(
    filterManifestForShape(
      filterManifestForConditions(manifest, dest),
      readBuildShape(dest),
    ),
    readDeclaredCapabilities(dest),
  )
}

/**
 * True when argv carries a bare `--`.
 *
 * `pnpm run <script> -- --flag` forwards the `--` to the script, and the argv
 * parser truncates there — every flag after it is DISCARDED, not collected as a
 * positional. The script then runs with default behaviour while the caller
 * believes they passed flags. That is merely confusing for a read-only script
 * and dangerous for a destructive one: `prune:branch-backups -- <flag>`
 * drops the trailing flag and performs a live run against every repo.
 *
 * Checked against `process.argv` because by the time parsing finishes the
 * dropped flags are unrecoverable — the parsed result cannot tell you what was
 * lost.
 */
function hasBareDoubleDash(argv) {
  return argv.includes('--')
}
/**
 * The message shown when argv carries a bare `--`. Names the script so the
 * corrected command can be pasted directly.
 */
function bareDoubleDashMessage(scriptName) {
  return `a bare \`--\` in the command line
  Where: the argv for ${scriptName}.\n  Saw:   flags after \`--\`. The argv parser truncates there, so those flags were NOT applied and the script ran with its defaults.
  Fix:   drop the \`--\`, e.g. \`pnpm run ${scriptName} --json\`.`
}
/**
 * The help request found on argv, if any: `--describe` wins over `-h`/`--help`
 * when both are present (the narrower ask costs one line; printing both forms
 * for a mixed argv helps no caller). Pure — exported for tests.
 */
function helpRequest(argv) {
  if (argv.includes('--describe')) return 'describe'
  if (argv.includes('-h') || argv.includes('--help')) return 'help'
}
/**
 * True when argv carries `--json` on its own — orthogonal to `helpRequest`,
 * which only reads `--describe`/`-h`/`--help`. A script's own `main()` calls
 * this to switch its RESULT output to structured JSON without re-parsing
 * argv itself; `--describe --json` (either order) is answered entirely by
 * the runner before `main()` runs and never reaches this predicate. Pure —
 * exported for tests and entry scripts.
 */
function isJsonRequested(argv) {
  return argv.includes('--json')
}
/**
 * The text a help request prints: the one-liner alone for `--describe`, or
 * the one-liner + blank line + usage body for `--help`. Pure — exported for
 * tests.
 */
function helpText(kind, meta) {
  return kind === 'describe'
    ? meta.describe
    : `${meta.describe}\n\n${meta.help}`
}
function describeManifestText(meta, config) {
  const { name, version } = {
    __proto__: null,
    ...config,
  }
  return JSON.stringify(
    {
      $schema:
        'https://raw.githubusercontent.com/SocketDev/socket-wheelhouse/main/schemas/cli-describe.schema.json',
      name,
      version,
      description: meta.describe,
    },
    void 0,
    2,
  )
}

function renderScriptResult(result) {
  if (
    !Number.isInteger(result.exitCode) ||
    result.exitCode < 0 ||
    result.exitCode > 255
  )
    throw new Error(
      'Script result requires an integer exit code between 0 and 255.',
    )
  return JSON.stringify({
    ok: result.exitCode === 0,
    exitCode: result.exitCode,
    ...(result.data === void 0 ? {} : { data: result.data }),
    ...(result.error === void 0 ? {} : { error: result.error }),
  })
}
var ScriptExit = class extends Error {
  exitCode
  constructor(exitCode) {
    if (!Number.isInteger(exitCode) || exitCode < 1 || exitCode > 255)
      throw new Error(
        'Script abort requires an integer exit code between 1 and 255.',
      )
    super(
      `Script stopped with exit code ${exitCode}. Review the preceding diagnostic and retry.`,
    )
    this.name = 'ScriptExit'
    this.exitCode = exitCode
  }
}

function errorMessage$1(error) {
  if (error instanceof Error) return error.message
  return String(error)
}
function scriptVersion() {
  try {
    const value = JSON.parse(readFileSync('package.json', 'utf8'))
    if (
      value !== null &&
      typeof value === 'object' &&
      'version' in value &&
      typeof value.version === 'string'
    )
      return value.version
  } catch {}
  return '0.0.0'
}
function writeLine(text) {
  process.stdout.write(`${text}\n`)
}
function runMainMinimal(main, meta) {
  runMainMinimalAsync(main, meta)
}
async function runMainMinimalAsync(main, meta) {
  const argv = process.argv.slice(2)
  const json = isJsonRequested(argv)
  const request = helpRequest(argv)
  const name = process.argv[1]?.split('/').pop() ?? 'script'
  if (request) {
    writeLine(
      request === 'describe' && json
        ? describeManifestText(meta, {
            name,
            version: scriptVersion(),
          })
        : helpText(request, meta),
    )
    process.exitCode = 0
    return
  }
  try {
    if (hasBareDoubleDash(argv)) throw new Error(bareDoubleDashMessage(name))
    if (json && !meta.json)
      throw new Error('This script has not declared JSON execution support.')
    await invokeMinimalMain(main, meta)
  } catch (error) {
    const message = errorMessage$1(error)
    const exitCode = error instanceof ScriptExit ? error.exitCode : 1
    process.exitCode = exitCode
    if (json)
      writeLine(
        renderScriptResult({
          exitCode,
          error: message,
        }),
      )
    else process.stderr.write(`${message}\n`)
  }
}
async function invokeMinimalMain(main, meta) {
  const json = isJsonRequested(process.argv.slice(2))
  const result = await main()
  const code =
    typeof result === 'object' && result !== null ? result.exitCode : result
  if (typeof code === 'number') process.exitCode = code
  else if (!process.exitCode) process.exitCode = 0
  if (json && meta.json === 'result')
    writeLine(
      renderScriptResult({
        ...(typeof result === 'object' && result !== null ? result : {}),
        exitCode: Number(process.exitCode ?? 0),
      }),
    )
  else if (!json && typeof result === 'object' && result?.error)
    process.stderr.write(`${result.error}\n`)
}

const NAMED_REFS = new Map(
  JSON.parse(
    '[["AElig","Æ"],["AElig;","Æ"],["AMP","&"],["AMP;","&"],["Aacute","Á"],["Aacute;","Á"],["Abreve;","Ă"],["Acirc","Â"],["Acirc;","Â"],["Acy;","А"],["Afr;","𝔄"],["Agrave","À"],["Agrave;","À"],["Alpha;","Α"],["Amacr;","Ā"],["And;","⩓"],["Aogon;","Ą"],["Aopf;","𝔸"],["ApplyFunction;","⁡"],["Aring","Å"],["Aring;","Å"],["Ascr;","𝒜"],["Assign;","≔"],["Atilde","Ã"],["Atilde;","Ã"],["Auml","Ä"],["Auml;","Ä"],["Backslash;","∖"],["Barv;","⫧"],["Barwed;","⌆"],["Bcy;","Б"],["Because;","∵"],["Bernoullis;","ℬ"],["Beta;","Β"],["Bfr;","𝔅"],["Bopf;","𝔹"],["Breve;","˘"],["Bscr;","ℬ"],["Bumpeq;","≎"],["CHcy;","Ч"],["COPY","©"],["COPY;","©"],["Cacute;","Ć"],["Cap;","⋒"],["CapitalDifferentialD;","ⅅ"],["Cayleys;","ℭ"],["Ccaron;","Č"],["Ccedil","Ç"],["Ccedil;","Ç"],["Ccirc;","Ĉ"],["Cconint;","∰"],["Cdot;","Ċ"],["Cedilla;","¸"],["CenterDot;","·"],["Cfr;","ℭ"],["Chi;","Χ"],["CircleDot;","⊙"],["CircleMinus;","⊖"],["CirclePlus;","⊕"],["CircleTimes;","⊗"],["ClockwiseContourIntegral;","∲"],["CloseCurlyDoubleQuote;","”"],["CloseCurlyQuote;","’"],["Colon;","∷"],["Colone;","⩴"],["Congruent;","≡"],["Conint;","∯"],["ContourIntegral;","∮"],["Copf;","ℂ"],["Coproduct;","∐"],["CounterClockwiseContourIntegral;","∳"],["Cross;","⨯"],["Cscr;","𝒞"],["Cup;","⋓"],["CupCap;","≍"],["DD;","ⅅ"],["DDotrahd;","⤑"],["DJcy;","Ђ"],["DScy;","Ѕ"],["DZcy;","Џ"],["Dagger;","‡"],["Darr;","↡"],["Dashv;","⫤"],["Dcaron;","Ď"],["Dcy;","Д"],["Del;","∇"],["Delta;","Δ"],["Dfr;","𝔇"],["DiacriticalAcute;","´"],["DiacriticalDot;","˙"],["DiacriticalDoubleAcute;","˝"],["DiacriticalGrave;","`"],["DiacriticalTilde;","˜"],["Diamond;","⋄"],["DifferentialD;","ⅆ"],["Dopf;","𝔻"],["Dot;","¨"],["DotDot;","⃜"],["DotEqual;","≐"],["DoubleContourIntegral;","∯"],["DoubleDot;","¨"],["DoubleDownArrow;","⇓"],["DoubleLeftArrow;","⇐"],["DoubleLeftRightArrow;","⇔"],["DoubleLeftTee;","⫤"],["DoubleLongLeftArrow;","⟸"],["DoubleLongLeftRightArrow;","⟺"],["DoubleLongRightArrow;","⟹"],["DoubleRightArrow;","⇒"],["DoubleRightTee;","⊨"],["DoubleUpArrow;","⇑"],["DoubleUpDownArrow;","⇕"],["DoubleVerticalBar;","∥"],["DownArrow;","↓"],["DownArrowBar;","⤓"],["DownArrowUpArrow;","⇵"],["DownBreve;","̑"],["DownLeftRightVector;","⥐"],["DownLeftTeeVector;","⥞"],["DownLeftVector;","↽"],["DownLeftVectorBar;","⥖"],["DownRightTeeVector;","⥟"],["DownRightVector;","⇁"],["DownRightVectorBar;","⥗"],["DownTee;","⊤"],["DownTeeArrow;","↧"],["Downarrow;","⇓"],["Dscr;","𝒟"],["Dstrok;","Đ"],["ENG;","Ŋ"],["ETH","Ð"],["ETH;","Ð"],["Eacute","É"],["Eacute;","É"],["Ecaron;","Ě"],["Ecirc","Ê"],["Ecirc;","Ê"],["Ecy;","Э"],["Edot;","Ė"],["Efr;","𝔈"],["Egrave","È"],["Egrave;","È"],["Element;","∈"],["Emacr;","Ē"],["EmptySmallSquare;","◻"],["EmptyVerySmallSquare;","▫"],["Eogon;","Ę"],["Eopf;","𝔼"],["Epsilon;","Ε"],["Equal;","⩵"],["EqualTilde;","≂"],["Equilibrium;","⇌"],["Escr;","ℰ"],["Esim;","⩳"],["Eta;","Η"],["Euml","Ë"],["Euml;","Ë"],["Exists;","∃"],["ExponentialE;","ⅇ"],["Fcy;","Ф"],["Ffr;","𝔉"],["FilledSmallSquare;","◼"],["FilledVerySmallSquare;","▪"],["Fopf;","𝔽"],["ForAll;","∀"],["Fouriertrf;","ℱ"],["Fscr;","ℱ"],["GJcy;","Ѓ"],["GT",">"],["GT;",">"],["Gamma;","Γ"],["Gammad;","Ϝ"],["Gbreve;","Ğ"],["Gcedil;","Ģ"],["Gcirc;","Ĝ"],["Gcy;","Г"],["Gdot;","Ġ"],["Gfr;","𝔊"],["Gg;","⋙"],["Gopf;","𝔾"],["GreaterEqual;","≥"],["GreaterEqualLess;","⋛"],["GreaterFullEqual;","≧"],["GreaterGreater;","⪢"],["GreaterLess;","≷"],["GreaterSlantEqual;","⩾"],["GreaterTilde;","≳"],["Gscr;","𝒢"],["Gt;","≫"],["HARDcy;","Ъ"],["Hacek;","ˇ"],["Hat;","^"],["Hcirc;","Ĥ"],["Hfr;","ℌ"],["HilbertSpace;","ℋ"],["Hopf;","ℍ"],["HorizontalLine;","─"],["Hscr;","ℋ"],["Hstrok;","Ħ"],["HumpDownHump;","≎"],["HumpEqual;","≏"],["IEcy;","Е"],["IJlig;","Ĳ"],["IOcy;","Ё"],["Iacute","Í"],["Iacute;","Í"],["Icirc","Î"],["Icirc;","Î"],["Icy;","И"],["Idot;","İ"],["Ifr;","ℑ"],["Igrave","Ì"],["Igrave;","Ì"],["Im;","ℑ"],["Imacr;","Ī"],["ImaginaryI;","ⅈ"],["Implies;","⇒"],["Int;","∬"],["Integral;","∫"],["Intersection;","⋂"],["InvisibleComma;","⁣"],["InvisibleTimes;","⁢"],["Iogon;","Į"],["Iopf;","𝕀"],["Iota;","Ι"],["Iscr;","ℐ"],["Itilde;","Ĩ"],["Iukcy;","І"],["Iuml","Ï"],["Iuml;","Ï"],["Jcirc;","Ĵ"],["Jcy;","Й"],["Jfr;","𝔍"],["Jopf;","𝕁"],["Jscr;","𝒥"],["Jsercy;","Ј"],["Jukcy;","Є"],["KHcy;","Х"],["KJcy;","Ќ"],["Kappa;","Κ"],["Kcedil;","Ķ"],["Kcy;","К"],["Kfr;","𝔎"],["Kopf;","𝕂"],["Kscr;","𝒦"],["LJcy;","Љ"],["LT","<"],["LT;","<"],["Lacute;","Ĺ"],["Lambda;","Λ"],["Lang;","⟪"],["Laplacetrf;","ℒ"],["Larr;","↞"],["Lcaron;","Ľ"],["Lcedil;","Ļ"],["Lcy;","Л"],["LeftAngleBracket;","⟨"],["LeftArrow;","←"],["LeftArrowBar;","⇤"],["LeftArrowRightArrow;","⇆"],["LeftCeiling;","⌈"],["LeftDoubleBracket;","⟦"],["LeftDownTeeVector;","⥡"],["LeftDownVector;","⇃"],["LeftDownVectorBar;","⥙"],["LeftFloor;","⌊"],["LeftRightArrow;","↔"],["LeftRightVector;","⥎"],["LeftTee;","⊣"],["LeftTeeArrow;","↤"],["LeftTeeVector;","⥚"],["LeftTriangle;","⊲"],["LeftTriangleBar;","⧏"],["LeftTriangleEqual;","⊴"],["LeftUpDownVector;","⥑"],["LeftUpTeeVector;","⥠"],["LeftUpVector;","↿"],["LeftUpVectorBar;","⥘"],["LeftVector;","↼"],["LeftVectorBar;","⥒"],["Leftarrow;","⇐"],["Leftrightarrow;","⇔"],["LessEqualGreater;","⋚"],["LessFullEqual;","≦"],["LessGreater;","≶"],["LessLess;","⪡"],["LessSlantEqual;","⩽"],["LessTilde;","≲"],["Lfr;","𝔏"],["Ll;","⋘"],["Lleftarrow;","⇚"],["Lmidot;","Ŀ"],["LongLeftArrow;","⟵"],["LongLeftRightArrow;","⟷"],["LongRightArrow;","⟶"],["Longleftarrow;","⟸"],["Longleftrightarrow;","⟺"],["Longrightarrow;","⟹"],["Lopf;","𝕃"],["LowerLeftArrow;","↙"],["LowerRightArrow;","↘"],["Lscr;","ℒ"],["Lsh;","↰"],["Lstrok;","Ł"],["Lt;","≪"],["Map;","⤅"],["Mcy;","М"],["MediumSpace;"," "],["Mellintrf;","ℳ"],["Mfr;","𝔐"],["MinusPlus;","∓"],["Mopf;","𝕄"],["Mscr;","ℳ"],["Mu;","Μ"],["NJcy;","Њ"],["Nacute;","Ń"],["Ncaron;","Ň"],["Ncedil;","Ņ"],["Ncy;","Н"],["NegativeMediumSpace;","​"],["NegativeThickSpace;","​"],["NegativeThinSpace;","​"],["NegativeVeryThinSpace;","​"],["NestedGreaterGreater;","≫"],["NestedLessLess;","≪"],["NewLine;","\\n"],["Nfr;","𝔑"],["NoBreak;","⁠"],["NonBreakingSpace;","\xA0"],["Nopf;","ℕ"],["Not;","⫬"],["NotCongruent;","≢"],["NotCupCap;","≭"],["NotDoubleVerticalBar;","∦"],["NotElement;","∉"],["NotEqual;","≠"],["NotEqualTilde;","≂̸"],["NotExists;","∄"],["NotGreater;","≯"],["NotGreaterEqual;","≱"],["NotGreaterFullEqual;","≧̸"],["NotGreaterGreater;","≫̸"],["NotGreaterLess;","≹"],["NotGreaterSlantEqual;","⩾̸"],["NotGreaterTilde;","≵"],["NotHumpDownHump;","≎̸"],["NotHumpEqual;","≏̸"],["NotLeftTriangle;","⋪"],["NotLeftTriangleBar;","⧏̸"],["NotLeftTriangleEqual;","⋬"],["NotLess;","≮"],["NotLessEqual;","≰"],["NotLessGreater;","≸"],["NotLessLess;","≪̸"],["NotLessSlantEqual;","⩽̸"],["NotLessTilde;","≴"],["NotNestedGreaterGreater;","⪢̸"],["NotNestedLessLess;","⪡̸"],["NotPrecedes;","⊀"],["NotPrecedesEqual;","⪯̸"],["NotPrecedesSlantEqual;","⋠"],["NotReverseElement;","∌"],["NotRightTriangle;","⋫"],["NotRightTriangleBar;","⧐̸"],["NotRightTriangleEqual;","⋭"],["NotSquareSubset;","⊏̸"],["NotSquareSubsetEqual;","⋢"],["NotSquareSuperset;","⊐̸"],["NotSquareSupersetEqual;","⋣"],["NotSubset;","⊂⃒"],["NotSubsetEqual;","⊈"],["NotSucceeds;","⊁"],["NotSucceedsEqual;","⪰̸"],["NotSucceedsSlantEqual;","⋡"],["NotSucceedsTilde;","≿̸"],["NotSuperset;","⊃⃒"],["NotSupersetEqual;","⊉"],["NotTilde;","≁"],["NotTildeEqual;","≄"],["NotTildeFullEqual;","≇"],["NotTildeTilde;","≉"],["NotVerticalBar;","∤"],["Nscr;","𝒩"],["Ntilde","Ñ"],["Ntilde;","Ñ"],["Nu;","Ν"],["OElig;","Œ"],["Oacute","Ó"],["Oacute;","Ó"],["Ocirc","Ô"],["Ocirc;","Ô"],["Ocy;","О"],["Odblac;","Ő"],["Ofr;","𝔒"],["Ograve","Ò"],["Ograve;","Ò"],["Omacr;","Ō"],["Omega;","Ω"],["Omicron;","Ο"],["Oopf;","𝕆"],["OpenCurlyDoubleQuote;","“"],["OpenCurlyQuote;","‘"],["Or;","⩔"],["Oscr;","𝒪"],["Oslash","Ø"],["Oslash;","Ø"],["Otilde","Õ"],["Otilde;","Õ"],["Otimes;","⨷"],["Ouml","Ö"],["Ouml;","Ö"],["OverBar;","‾"],["OverBrace;","⏞"],["OverBracket;","⎴"],["OverParenthesis;","⏜"],["PartialD;","∂"],["Pcy;","П"],["Pfr;","𝔓"],["Phi;","Φ"],["Pi;","Π"],["PlusMinus;","±"],["Poincareplane;","ℌ"],["Popf;","ℙ"],["Pr;","⪻"],["Precedes;","≺"],["PrecedesEqual;","⪯"],["PrecedesSlantEqual;","≼"],["PrecedesTilde;","≾"],["Prime;","″"],["Product;","∏"],["Proportion;","∷"],["Proportional;","∝"],["Pscr;","𝒫"],["Psi;","Ψ"],["QUOT","\\""],["QUOT;","\\""],["Qfr;","𝔔"],["Qopf;","ℚ"],["Qscr;","𝒬"],["RBarr;","⤐"],["REG","®"],["REG;","®"],["Racute;","Ŕ"],["Rang;","⟫"],["Rarr;","↠"],["Rarrtl;","⤖"],["Rcaron;","Ř"],["Rcedil;","Ŗ"],["Rcy;","Р"],["Re;","ℜ"],["ReverseElement;","∋"],["ReverseEquilibrium;","⇋"],["ReverseUpEquilibrium;","⥯"],["Rfr;","ℜ"],["Rho;","Ρ"],["RightAngleBracket;","⟩"],["RightArrow;","→"],["RightArrowBar;","⇥"],["RightArrowLeftArrow;","⇄"],["RightCeiling;","⌉"],["RightDoubleBracket;","⟧"],["RightDownTeeVector;","⥝"],["RightDownVector;","⇂"],["RightDownVectorBar;","⥕"],["RightFloor;","⌋"],["RightTee;","⊢"],["RightTeeArrow;","↦"],["RightTeeVector;","⥛"],["RightTriangle;","⊳"],["RightTriangleBar;","⧐"],["RightTriangleEqual;","⊵"],["RightUpDownVector;","⥏"],["RightUpTeeVector;","⥜"],["RightUpVector;","↾"],["RightUpVectorBar;","⥔"],["RightVector;","⇀"],["RightVectorBar;","⥓"],["Rightarrow;","⇒"],["Ropf;","ℝ"],["RoundImplies;","⥰"],["Rrightarrow;","⇛"],["Rscr;","ℛ"],["Rsh;","↱"],["RuleDelayed;","⧴"],["SHCHcy;","Щ"],["SHcy;","Ш"],["SOFTcy;","Ь"],["Sacute;","Ś"],["Sc;","⪼"],["Scaron;","Š"],["Scedil;","Ş"],["Scirc;","Ŝ"],["Scy;","С"],["Sfr;","𝔖"],["ShortDownArrow;","↓"],["ShortLeftArrow;","←"],["ShortRightArrow;","→"],["ShortUpArrow;","↑"],["Sigma;","Σ"],["SmallCircle;","∘"],["Sopf;","𝕊"],["Sqrt;","√"],["Square;","□"],["SquareIntersection;","⊓"],["SquareSubset;","⊏"],["SquareSubsetEqual;","⊑"],["SquareSuperset;","⊐"],["SquareSupersetEqual;","⊒"],["SquareUnion;","⊔"],["Sscr;","𝒮"],["Star;","⋆"],["Sub;","⋐"],["Subset;","⋐"],["SubsetEqual;","⊆"],["Succeeds;","≻"],["SucceedsEqual;","⪰"],["SucceedsSlantEqual;","≽"],["SucceedsTilde;","≿"],["SuchThat;","∋"],["Sum;","∑"],["Sup;","⋑"],["Superset;","⊃"],["SupersetEqual;","⊇"],["Supset;","⋑"],["THORN","Þ"],["THORN;","Þ"],["TRADE;","™"],["TSHcy;","Ћ"],["TScy;","Ц"],["Tab;","\\t"],["Tau;","Τ"],["Tcaron;","Ť"],["Tcedil;","Ţ"],["Tcy;","Т"],["Tfr;","𝔗"],["Therefore;","∴"],["Theta;","Θ"],["ThickSpace;","  "],["ThinSpace;"," "],["Tilde;","∼"],["TildeEqual;","≃"],["TildeFullEqual;","≅"],["TildeTilde;","≈"],["Topf;","𝕋"],["TripleDot;","⃛"],["Tscr;","𝒯"],["Tstrok;","Ŧ"],["Uacute","Ú"],["Uacute;","Ú"],["Uarr;","↟"],["Uarrocir;","⥉"],["Ubrcy;","Ў"],["Ubreve;","Ŭ"],["Ucirc","Û"],["Ucirc;","Û"],["Ucy;","У"],["Udblac;","Ű"],["Ufr;","𝔘"],["Ugrave","Ù"],["Ugrave;","Ù"],["Umacr;","Ū"],["UnderBar;","_"],["UnderBrace;","⏟"],["UnderBracket;","⎵"],["UnderParenthesis;","⏝"],["Union;","⋃"],["UnionPlus;","⊎"],["Uogon;","Ų"],["Uopf;","𝕌"],["UpArrow;","↑"],["UpArrowBar;","⤒"],["UpArrowDownArrow;","⇅"],["UpDownArrow;","↕"],["UpEquilibrium;","⥮"],["UpTee;","⊥"],["UpTeeArrow;","↥"],["Uparrow;","⇑"],["Updownarrow;","⇕"],["UpperLeftArrow;","↖"],["UpperRightArrow;","↗"],["Upsi;","ϒ"],["Upsilon;","Υ"],["Uring;","Ů"],["Uscr;","𝒰"],["Utilde;","Ũ"],["Uuml","Ü"],["Uuml;","Ü"],["VDash;","⊫"],["Vbar;","⫫"],["Vcy;","В"],["Vdash;","⊩"],["Vdashl;","⫦"],["Vee;","⋁"],["Verbar;","‖"],["Vert;","‖"],["VerticalBar;","∣"],["VerticalLine;","|"],["VerticalSeparator;","❘"],["VerticalTilde;","≀"],["VeryThinSpace;"," "],["Vfr;","𝔙"],["Vopf;","𝕍"],["Vscr;","𝒱"],["Vvdash;","⊪"],["Wcirc;","Ŵ"],["Wedge;","⋀"],["Wfr;","𝔚"],["Wopf;","𝕎"],["Wscr;","𝒲"],["Xfr;","𝔛"],["Xi;","Ξ"],["Xopf;","𝕏"],["Xscr;","𝒳"],["YAcy;","Я"],["YIcy;","Ї"],["YUcy;","Ю"],["Yacute","Ý"],["Yacute;","Ý"],["Ycirc;","Ŷ"],["Ycy;","Ы"],["Yfr;","𝔜"],["Yopf;","𝕐"],["Yscr;","𝒴"],["Yuml;","Ÿ"],["ZHcy;","Ж"],["Zacute;","Ź"],["Zcaron;","Ž"],["Zcy;","З"],["Zdot;","Ż"],["ZeroWidthSpace;","​"],["Zeta;","Ζ"],["Zfr;","ℨ"],["Zopf;","ℤ"],["Zscr;","𝒵"],["aacute","á"],["aacute;","á"],["abreve;","ă"],["ac;","∾"],["acE;","∾̳"],["acd;","∿"],["acirc","â"],["acirc;","â"],["acute","´"],["acute;","´"],["acy;","а"],["aelig","æ"],["aelig;","æ"],["af;","⁡"],["afr;","𝔞"],["agrave","à"],["agrave;","à"],["alefsym;","ℵ"],["aleph;","ℵ"],["alpha;","α"],["amacr;","ā"],["amalg;","⨿"],["amp","&"],["amp;","&"],["and;","∧"],["andand;","⩕"],["andd;","⩜"],["andslope;","⩘"],["andv;","⩚"],["ang;","∠"],["ange;","⦤"],["angle;","∠"],["angmsd;","∡"],["angmsdaa;","⦨"],["angmsdab;","⦩"],["angmsdac;","⦪"],["angmsdad;","⦫"],["angmsdae;","⦬"],["angmsdaf;","⦭"],["angmsdag;","⦮"],["angmsdah;","⦯"],["angrt;","∟"],["angrtvb;","⊾"],["angrtvbd;","⦝"],["angsph;","∢"],["angst;","Å"],["angzarr;","⍼"],["aogon;","ą"],["aopf;","𝕒"],["ap;","≈"],["apE;","⩰"],["apacir;","⩯"],["ape;","≊"],["apid;","≋"],["apos;","\'"],["approx;","≈"],["approxeq;","≊"],["aring","å"],["aring;","å"],["ascr;","𝒶"],["ast;","*"],["asymp;","≈"],["asympeq;","≍"],["atilde","ã"],["atilde;","ã"],["auml","ä"],["auml;","ä"],["awconint;","∳"],["awint;","⨑"],["bNot;","⫭"],["backcong;","≌"],["backepsilon;","϶"],["backprime;","‵"],["backsim;","∽"],["backsimeq;","⋍"],["barvee;","⊽"],["barwed;","⌅"],["barwedge;","⌅"],["bbrk;","⎵"],["bbrktbrk;","⎶"],["bcong;","≌"],["bcy;","б"],["bdquo;","„"],["becaus;","∵"],["because;","∵"],["bemptyv;","⦰"],["bepsi;","϶"],["bernou;","ℬ"],["beta;","β"],["beth;","ℶ"],["between;","≬"],["bfr;","𝔟"],["bigcap;","⋂"],["bigcirc;","◯"],["bigcup;","⋃"],["bigodot;","⨀"],["bigoplus;","⨁"],["bigotimes;","⨂"],["bigsqcup;","⨆"],["bigstar;","★"],["bigtriangledown;","▽"],["bigtriangleup;","△"],["biguplus;","⨄"],["bigvee;","⋁"],["bigwedge;","⋀"],["bkarow;","⤍"],["blacklozenge;","⧫"],["blacksquare;","▪"],["blacktriangle;","▴"],["blacktriangledown;","▾"],["blacktriangleleft;","◂"],["blacktriangleright;","▸"],["blank;","␣"],["blk12;","▒"],["blk14;","░"],["blk34;","▓"],["block;","█"],["bne;","=⃥"],["bnequiv;","≡⃥"],["bnot;","⌐"],["bopf;","𝕓"],["bot;","⊥"],["bottom;","⊥"],["bowtie;","⋈"],["boxDL;","╗"],["boxDR;","╔"],["boxDl;","╖"],["boxDr;","╓"],["boxH;","═"],["boxHD;","╦"],["boxHU;","╩"],["boxHd;","╤"],["boxHu;","╧"],["boxUL;","╝"],["boxUR;","╚"],["boxUl;","╜"],["boxUr;","╙"],["boxV;","║"],["boxVH;","╬"],["boxVL;","╣"],["boxVR;","╠"],["boxVh;","╫"],["boxVl;","╢"],["boxVr;","╟"],["boxbox;","⧉"],["boxdL;","╕"],["boxdR;","╒"],["boxdl;","┐"],["boxdr;","┌"],["boxh;","─"],["boxhD;","╥"],["boxhU;","╨"],["boxhd;","┬"],["boxhu;","┴"],["boxminus;","⊟"],["boxplus;","⊞"],["boxtimes;","⊠"],["boxuL;","╛"],["boxuR;","╘"],["boxul;","┘"],["boxur;","└"],["boxv;","│"],["boxvH;","╪"],["boxvL;","╡"],["boxvR;","╞"],["boxvh;","┼"],["boxvl;","┤"],["boxvr;","├"],["bprime;","‵"],["breve;","˘"],["brvbar","¦"],["brvbar;","¦"],["bscr;","𝒷"],["bsemi;","⁏"],["bsim;","∽"],["bsime;","⋍"],["bsol;","\\\\"],["bsolb;","⧅"],["bsolhsub;","⟈"],["bull;","•"],["bullet;","•"],["bump;","≎"],["bumpE;","⪮"],["bumpe;","≏"],["bumpeq;","≏"],["cacute;","ć"],["cap;","∩"],["capand;","⩄"],["capbrcup;","⩉"],["capcap;","⩋"],["capcup;","⩇"],["capdot;","⩀"],["caps;","∩︀"],["caret;","⁁"],["caron;","ˇ"],["ccaps;","⩍"],["ccaron;","č"],["ccedil","ç"],["ccedil;","ç"],["ccirc;","ĉ"],["ccups;","⩌"],["ccupssm;","⩐"],["cdot;","ċ"],["cedil","¸"],["cedil;","¸"],["cemptyv;","⦲"],["cent","¢"],["cent;","¢"],["centerdot;","·"],["cfr;","𝔠"],["chcy;","ч"],["check;","✓"],["checkmark;","✓"],["chi;","χ"],["cir;","○"],["cirE;","⧃"],["circ;","ˆ"],["circeq;","≗"],["circlearrowleft;","↺"],["circlearrowright;","↻"],["circledR;","®"],["circledS;","Ⓢ"],["circledast;","⊛"],["circledcirc;","⊚"],["circleddash;","⊝"],["cire;","≗"],["cirfnint;","⨐"],["cirmid;","⫯"],["cirscir;","⧂"],["clubs;","♣"],["clubsuit;","♣"],["colon;",":"],["colone;","≔"],["coloneq;","≔"],["comma;",","],["commat;","@"],["comp;","∁"],["compfn;","∘"],["complement;","∁"],["complexes;","ℂ"],["cong;","≅"],["congdot;","⩭"],["conint;","∮"],["copf;","𝕔"],["coprod;","∐"],["copy","©"],["copy;","©"],["copysr;","℗"],["crarr;","↵"],["cross;","✗"],["cscr;","𝒸"],["csub;","⫏"],["csube;","⫑"],["csup;","⫐"],["csupe;","⫒"],["ctdot;","⋯"],["cudarrl;","⤸"],["cudarrr;","⤵"],["cuepr;","⋞"],["cuesc;","⋟"],["cularr;","↶"],["cularrp;","⤽"],["cup;","∪"],["cupbrcap;","⩈"],["cupcap;","⩆"],["cupcup;","⩊"],["cupdot;","⊍"],["cupor;","⩅"],["cups;","∪︀"],["curarr;","↷"],["curarrm;","⤼"],["curlyeqprec;","⋞"],["curlyeqsucc;","⋟"],["curlyvee;","⋎"],["curlywedge;","⋏"],["curren","¤"],["curren;","¤"],["curvearrowleft;","↶"],["curvearrowright;","↷"],["cuvee;","⋎"],["cuwed;","⋏"],["cwconint;","∲"],["cwint;","∱"],["cylcty;","⌭"],["dArr;","⇓"],["dHar;","⥥"],["dagger;","†"],["daleth;","ℸ"],["darr;","↓"],["dash;","‐"],["dashv;","⊣"],["dbkarow;","⤏"],["dblac;","˝"],["dcaron;","ď"],["dcy;","д"],["dd;","ⅆ"],["ddagger;","‡"],["ddarr;","⇊"],["ddotseq;","⩷"],["deg","°"],["deg;","°"],["delta;","δ"],["demptyv;","⦱"],["dfisht;","⥿"],["dfr;","𝔡"],["dharl;","⇃"],["dharr;","⇂"],["diam;","⋄"],["diamond;","⋄"],["diamondsuit;","♦"],["diams;","♦"],["die;","¨"],["digamma;","ϝ"],["disin;","⋲"],["div;","÷"],["divide","÷"],["divide;","÷"],["divideontimes;","⋇"],["divonx;","⋇"],["djcy;","ђ"],["dlcorn;","⌞"],["dlcrop;","⌍"],["dollar;","$"],["dopf;","𝕕"],["dot;","˙"],["doteq;","≐"],["doteqdot;","≑"],["dotminus;","∸"],["dotplus;","∔"],["dotsquare;","⊡"],["doublebarwedge;","⌆"],["downarrow;","↓"],["downdownarrows;","⇊"],["downharpoonleft;","⇃"],["downharpoonright;","⇂"],["drbkarow;","⤐"],["drcorn;","⌟"],["drcrop;","⌌"],["dscr;","𝒹"],["dscy;","ѕ"],["dsol;","⧶"],["dstrok;","đ"],["dtdot;","⋱"],["dtri;","▿"],["dtrif;","▾"],["duarr;","⇵"],["duhar;","⥯"],["dwangle;","⦦"],["dzcy;","џ"],["dzigrarr;","⟿"],["eDDot;","⩷"],["eDot;","≑"],["eacute","é"],["eacute;","é"],["easter;","⩮"],["ecaron;","ě"],["ecir;","≖"],["ecirc","ê"],["ecirc;","ê"],["ecolon;","≕"],["ecy;","э"],["edot;","ė"],["ee;","ⅇ"],["efDot;","≒"],["efr;","𝔢"],["eg;","⪚"],["egrave","è"],["egrave;","è"],["egs;","⪖"],["egsdot;","⪘"],["el;","⪙"],["elinters;","⏧"],["ell;","ℓ"],["els;","⪕"],["elsdot;","⪗"],["emacr;","ē"],["empty;","∅"],["emptyset;","∅"],["emptyv;","∅"],["emsp13;"," "],["emsp14;"," "],["emsp;"," "],["eng;","ŋ"],["ensp;"," "],["eogon;","ę"],["eopf;","𝕖"],["epar;","⋕"],["eparsl;","⧣"],["eplus;","⩱"],["epsi;","ε"],["epsilon;","ε"],["epsiv;","ϵ"],["eqcirc;","≖"],["eqcolon;","≕"],["eqsim;","≂"],["eqslantgtr;","⪖"],["eqslantless;","⪕"],["equals;","="],["equest;","≟"],["equiv;","≡"],["equivDD;","⩸"],["eqvparsl;","⧥"],["erDot;","≓"],["erarr;","⥱"],["escr;","ℯ"],["esdot;","≐"],["esim;","≂"],["eta;","η"],["eth","ð"],["eth;","ð"],["euml","ë"],["euml;","ë"],["euro;","€"],["excl;","!"],["exist;","∃"],["expectation;","ℰ"],["exponentiale;","ⅇ"],["fallingdotseq;","≒"],["fcy;","ф"],["female;","♀"],["ffilig;","ﬃ"],["fflig;","ﬀ"],["ffllig;","ﬄ"],["ffr;","𝔣"],["filig;","ﬁ"],["fjlig;","fj"],["flat;","♭"],["fllig;","ﬂ"],["fltns;","▱"],["fnof;","ƒ"],["fopf;","𝕗"],["forall;","∀"],["fork;","⋔"],["forkv;","⫙"],["fpartint;","⨍"],["frac12","½"],["frac12;","½"],["frac13;","⅓"],["frac14","¼"],["frac14;","¼"],["frac15;","⅕"],["frac16;","⅙"],["frac18;","⅛"],["frac23;","⅔"],["frac25;","⅖"],["frac34","¾"],["frac34;","¾"],["frac35;","⅗"],["frac38;","⅜"],["frac45;","⅘"],["frac56;","⅚"],["frac58;","⅝"],["frac78;","⅞"],["frasl;","⁄"],["frown;","⌢"],["fscr;","𝒻"],["gE;","≧"],["gEl;","⪌"],["gacute;","ǵ"],["gamma;","γ"],["gammad;","ϝ"],["gap;","⪆"],["gbreve;","ğ"],["gcirc;","ĝ"],["gcy;","г"],["gdot;","ġ"],["ge;","≥"],["gel;","⋛"],["geq;","≥"],["geqq;","≧"],["geqslant;","⩾"],["ges;","⩾"],["gescc;","⪩"],["gesdot;","⪀"],["gesdoto;","⪂"],["gesdotol;","⪄"],["gesl;","⋛︀"],["gesles;","⪔"],["gfr;","𝔤"],["gg;","≫"],["ggg;","⋙"],["gimel;","ℷ"],["gjcy;","ѓ"],["gl;","≷"],["glE;","⪒"],["gla;","⪥"],["glj;","⪤"],["gnE;","≩"],["gnap;","⪊"],["gnapprox;","⪊"],["gne;","⪈"],["gneq;","⪈"],["gneqq;","≩"],["gnsim;","⋧"],["gopf;","𝕘"],["grave;","`"],["gscr;","ℊ"],["gsim;","≳"],["gsime;","⪎"],["gsiml;","⪐"],["gt",">"],["gt;",">"],["gtcc;","⪧"],["gtcir;","⩺"],["gtdot;","⋗"],["gtlPar;","⦕"],["gtquest;","⩼"],["gtrapprox;","⪆"],["gtrarr;","⥸"],["gtrdot;","⋗"],["gtreqless;","⋛"],["gtreqqless;","⪌"],["gtrless;","≷"],["gtrsim;","≳"],["gvertneqq;","≩︀"],["gvnE;","≩︀"],["hArr;","⇔"],["hairsp;"," "],["half;","½"],["hamilt;","ℋ"],["hardcy;","ъ"],["harr;","↔"],["harrcir;","⥈"],["harrw;","↭"],["hbar;","ℏ"],["hcirc;","ĥ"],["hearts;","♥"],["heartsuit;","♥"],["hellip;","…"],["hercon;","⊹"],["hfr;","𝔥"],["hksearow;","⤥"],["hkswarow;","⤦"],["hoarr;","⇿"],["homtht;","∻"],["hookleftarrow;","↩"],["hookrightarrow;","↪"],["hopf;","𝕙"],["horbar;","―"],["hscr;","𝒽"],["hslash;","ℏ"],["hstrok;","ħ"],["hybull;","⁃"],["hyphen;","‐"],["iacute","í"],["iacute;","í"],["ic;","⁣"],["icirc","î"],["icirc;","î"],["icy;","и"],["iecy;","е"],["iexcl","¡"],["iexcl;","¡"],["iff;","⇔"],["ifr;","𝔦"],["igrave","ì"],["igrave;","ì"],["ii;","ⅈ"],["iiiint;","⨌"],["iiint;","∭"],["iinfin;","⧜"],["iiota;","℩"],["ijlig;","ĳ"],["imacr;","ī"],["image;","ℑ"],["imagline;","ℐ"],["imagpart;","ℑ"],["imath;","ı"],["imof;","⊷"],["imped;","Ƶ"],["in;","∈"],["incare;","℅"],["infin;","∞"],["infintie;","⧝"],["inodot;","ı"],["int;","∫"],["intcal;","⊺"],["integers;","ℤ"],["intercal;","⊺"],["intlarhk;","⨗"],["intprod;","⨼"],["iocy;","ё"],["iogon;","į"],["iopf;","𝕚"],["iota;","ι"],["iprod;","⨼"],["iquest","¿"],["iquest;","¿"],["iscr;","𝒾"],["isin;","∈"],["isinE;","⋹"],["isindot;","⋵"],["isins;","⋴"],["isinsv;","⋳"],["isinv;","∈"],["it;","⁢"],["itilde;","ĩ"],["iukcy;","і"],["iuml","ï"],["iuml;","ï"],["jcirc;","ĵ"],["jcy;","й"],["jfr;","𝔧"],["jmath;","ȷ"],["jopf;","𝕛"],["jscr;","𝒿"],["jsercy;","ј"],["jukcy;","є"],["kappa;","κ"],["kappav;","ϰ"],["kcedil;","ķ"],["kcy;","к"],["kfr;","𝔨"],["kgreen;","ĸ"],["khcy;","х"],["kjcy;","ќ"],["kopf;","𝕜"],["kscr;","𝓀"],["lAarr;","⇚"],["lArr;","⇐"],["lAtail;","⤛"],["lBarr;","⤎"],["lE;","≦"],["lEg;","⪋"],["lHar;","⥢"],["lacute;","ĺ"],["laemptyv;","⦴"],["lagran;","ℒ"],["lambda;","λ"],["lang;","⟨"],["langd;","⦑"],["langle;","⟨"],["lap;","⪅"],["laquo","«"],["laquo;","«"],["larr;","←"],["larrb;","⇤"],["larrbfs;","⤟"],["larrfs;","⤝"],["larrhk;","↩"],["larrlp;","↫"],["larrpl;","⤹"],["larrsim;","⥳"],["larrtl;","↢"],["lat;","⪫"],["latail;","⤙"],["late;","⪭"],["lates;","⪭︀"],["lbarr;","⤌"],["lbbrk;","❲"],["lbrace;","{"],["lbrack;","["],["lbrke;","⦋"],["lbrksld;","⦏"],["lbrkslu;","⦍"],["lcaron;","ľ"],["lcedil;","ļ"],["lceil;","⌈"],["lcub;","{"],["lcy;","л"],["ldca;","⤶"],["ldquo;","“"],["ldquor;","„"],["ldrdhar;","⥧"],["ldrushar;","⥋"],["ldsh;","↲"],["le;","≤"],["leftarrow;","←"],["leftarrowtail;","↢"],["leftharpoondown;","↽"],["leftharpoonup;","↼"],["leftleftarrows;","⇇"],["leftrightarrow;","↔"],["leftrightarrows;","⇆"],["leftrightharpoons;","⇋"],["leftrightsquigarrow;","↭"],["leftthreetimes;","⋋"],["leg;","⋚"],["leq;","≤"],["leqq;","≦"],["leqslant;","⩽"],["les;","⩽"],["lescc;","⪨"],["lesdot;","⩿"],["lesdoto;","⪁"],["lesdotor;","⪃"],["lesg;","⋚︀"],["lesges;","⪓"],["lessapprox;","⪅"],["lessdot;","⋖"],["lesseqgtr;","⋚"],["lesseqqgtr;","⪋"],["lessgtr;","≶"],["lesssim;","≲"],["lfisht;","⥼"],["lfloor;","⌊"],["lfr;","𝔩"],["lg;","≶"],["lgE;","⪑"],["lhard;","↽"],["lharu;","↼"],["lharul;","⥪"],["lhblk;","▄"],["ljcy;","љ"],["ll;","≪"],["llarr;","⇇"],["llcorner;","⌞"],["llhard;","⥫"],["lltri;","◺"],["lmidot;","ŀ"],["lmoust;","⎰"],["lmoustache;","⎰"],["lnE;","≨"],["lnap;","⪉"],["lnapprox;","⪉"],["lne;","⪇"],["lneq;","⪇"],["lneqq;","≨"],["lnsim;","⋦"],["loang;","⟬"],["loarr;","⇽"],["lobrk;","⟦"],["longleftarrow;","⟵"],["longleftrightarrow;","⟷"],["longmapsto;","⟼"],["longrightarrow;","⟶"],["looparrowleft;","↫"],["looparrowright;","↬"],["lopar;","⦅"],["lopf;","𝕝"],["loplus;","⨭"],["lotimes;","⨴"],["lowast;","∗"],["lowbar;","_"],["loz;","◊"],["lozenge;","◊"],["lozf;","⧫"],["lpar;","("],["lparlt;","⦓"],["lrarr;","⇆"],["lrcorner;","⌟"],["lrhar;","⇋"],["lrhard;","⥭"],["lrm;","‎"],["lrtri;","⊿"],["lsaquo;","‹"],["lscr;","𝓁"],["lsh;","↰"],["lsim;","≲"],["lsime;","⪍"],["lsimg;","⪏"],["lsqb;","["],["lsquo;","‘"],["lsquor;","‚"],["lstrok;","ł"],["lt","<"],["lt;","<"],["ltcc;","⪦"],["ltcir;","⩹"],["ltdot;","⋖"],["lthree;","⋋"],["ltimes;","⋉"],["ltlarr;","⥶"],["ltquest;","⩻"],["ltrPar;","⦖"],["ltri;","◃"],["ltrie;","⊴"],["ltrif;","◂"],["lurdshar;","⥊"],["luruhar;","⥦"],["lvertneqq;","≨︀"],["lvnE;","≨︀"],["mDDot;","∺"],["macr","¯"],["macr;","¯"],["male;","♂"],["malt;","✠"],["maltese;","✠"],["map;","↦"],["mapsto;","↦"],["mapstodown;","↧"],["mapstoleft;","↤"],["mapstoup;","↥"],["marker;","▮"],["mcomma;","⨩"],["mcy;","м"],["mdash;","—"],["measuredangle;","∡"],["mfr;","𝔪"],["mho;","℧"],["micro","µ"],["micro;","µ"],["mid;","∣"],["midast;","*"],["midcir;","⫰"],["middot","·"],["middot;","·"],["minus;","−"],["minusb;","⊟"],["minusd;","∸"],["minusdu;","⨪"],["mlcp;","⫛"],["mldr;","…"],["mnplus;","∓"],["models;","⊧"],["mopf;","𝕞"],["mp;","∓"],["mscr;","𝓂"],["mstpos;","∾"],["mu;","μ"],["multimap;","⊸"],["mumap;","⊸"],["nGg;","⋙̸"],["nGt;","≫⃒"],["nGtv;","≫̸"],["nLeftarrow;","⇍"],["nLeftrightarrow;","⇎"],["nLl;","⋘̸"],["nLt;","≪⃒"],["nLtv;","≪̸"],["nRightarrow;","⇏"],["nVDash;","⊯"],["nVdash;","⊮"],["nabla;","∇"],["nacute;","ń"],["nang;","∠⃒"],["nap;","≉"],["napE;","⩰̸"],["napid;","≋̸"],["napos;","ŉ"],["napprox;","≉"],["natur;","♮"],["natural;","♮"],["naturals;","ℕ"],["nbsp","\xA0"],["nbsp;","\xA0"],["nbump;","≎̸"],["nbumpe;","≏̸"],["ncap;","⩃"],["ncaron;","ň"],["ncedil;","ņ"],["ncong;","≇"],["ncongdot;","⩭̸"],["ncup;","⩂"],["ncy;","н"],["ndash;","–"],["ne;","≠"],["neArr;","⇗"],["nearhk;","⤤"],["nearr;","↗"],["nearrow;","↗"],["nedot;","≐̸"],["nequiv;","≢"],["nesear;","⤨"],["nesim;","≂̸"],["nexist;","∄"],["nexists;","∄"],["nfr;","𝔫"],["ngE;","≧̸"],["nge;","≱"],["ngeq;","≱"],["ngeqq;","≧̸"],["ngeqslant;","⩾̸"],["nges;","⩾̸"],["ngsim;","≵"],["ngt;","≯"],["ngtr;","≯"],["nhArr;","⇎"],["nharr;","↮"],["nhpar;","⫲"],["ni;","∋"],["nis;","⋼"],["nisd;","⋺"],["niv;","∋"],["njcy;","њ"],["nlArr;","⇍"],["nlE;","≦̸"],["nlarr;","↚"],["nldr;","‥"],["nle;","≰"],["nleftarrow;","↚"],["nleftrightarrow;","↮"],["nleq;","≰"],["nleqq;","≦̸"],["nleqslant;","⩽̸"],["nles;","⩽̸"],["nless;","≮"],["nlsim;","≴"],["nlt;","≮"],["nltri;","⋪"],["nltrie;","⋬"],["nmid;","∤"],["nopf;","𝕟"],["not","¬"],["not;","¬"],["notin;","∉"],["notinE;","⋹̸"],["notindot;","⋵̸"],["notinva;","∉"],["notinvb;","⋷"],["notinvc;","⋶"],["notni;","∌"],["notniva;","∌"],["notnivb;","⋾"],["notnivc;","⋽"],["npar;","∦"],["nparallel;","∦"],["nparsl;","⫽⃥"],["npart;","∂̸"],["npolint;","⨔"],["npr;","⊀"],["nprcue;","⋠"],["npre;","⪯̸"],["nprec;","⊀"],["npreceq;","⪯̸"],["nrArr;","⇏"],["nrarr;","↛"],["nrarrc;","⤳̸"],["nrarrw;","↝̸"],["nrightarrow;","↛"],["nrtri;","⋫"],["nrtrie;","⋭"],["nsc;","⊁"],["nsccue;","⋡"],["nsce;","⪰̸"],["nscr;","𝓃"],["nshortmid;","∤"],["nshortparallel;","∦"],["nsim;","≁"],["nsime;","≄"],["nsimeq;","≄"],["nsmid;","∤"],["nspar;","∦"],["nsqsube;","⋢"],["nsqsupe;","⋣"],["nsub;","⊄"],["nsubE;","⫅̸"],["nsube;","⊈"],["nsubset;","⊂⃒"],["nsubseteq;","⊈"],["nsubseteqq;","⫅̸"],["nsucc;","⊁"],["nsucceq;","⪰̸"],["nsup;","⊅"],["nsupE;","⫆̸"],["nsupe;","⊉"],["nsupset;","⊃⃒"],["nsupseteq;","⊉"],["nsupseteqq;","⫆̸"],["ntgl;","≹"],["ntilde","ñ"],["ntilde;","ñ"],["ntlg;","≸"],["ntriangleleft;","⋪"],["ntrianglelefteq;","⋬"],["ntriangleright;","⋫"],["ntrianglerighteq;","⋭"],["nu;","ν"],["num;","#"],["numero;","№"],["numsp;"," "],["nvDash;","⊭"],["nvHarr;","⤄"],["nvap;","≍⃒"],["nvdash;","⊬"],["nvge;","≥⃒"],["nvgt;",">⃒"],["nvinfin;","⧞"],["nvlArr;","⤂"],["nvle;","≤⃒"],["nvlt;","<⃒"],["nvltrie;","⊴⃒"],["nvrArr;","⤃"],["nvrtrie;","⊵⃒"],["nvsim;","∼⃒"],["nwArr;","⇖"],["nwarhk;","⤣"],["nwarr;","↖"],["nwarrow;","↖"],["nwnear;","⤧"],["oS;","Ⓢ"],["oacute","ó"],["oacute;","ó"],["oast;","⊛"],["ocir;","⊚"],["ocirc","ô"],["ocirc;","ô"],["ocy;","о"],["odash;","⊝"],["odblac;","ő"],["odiv;","⨸"],["odot;","⊙"],["odsold;","⦼"],["oelig;","œ"],["ofcir;","⦿"],["ofr;","𝔬"],["ogon;","˛"],["ograve","ò"],["ograve;","ò"],["ogt;","⧁"],["ohbar;","⦵"],["ohm;","Ω"],["oint;","∮"],["olarr;","↺"],["olcir;","⦾"],["olcross;","⦻"],["oline;","‾"],["olt;","⧀"],["omacr;","ō"],["omega;","ω"],["omicron;","ο"],["omid;","⦶"],["ominus;","⊖"],["oopf;","𝕠"],["opar;","⦷"],["operp;","⦹"],["oplus;","⊕"],["or;","∨"],["orarr;","↻"],["ord;","⩝"],["order;","ℴ"],["orderof;","ℴ"],["ordf","ª"],["ordf;","ª"],["ordm","º"],["ordm;","º"],["origof;","⊶"],["oror;","⩖"],["orslope;","⩗"],["orv;","⩛"],["oscr;","ℴ"],["oslash","ø"],["oslash;","ø"],["osol;","⊘"],["otilde","õ"],["otilde;","õ"],["otimes;","⊗"],["otimesas;","⨶"],["ouml","ö"],["ouml;","ö"],["ovbar;","⌽"],["par;","∥"],["para","¶"],["para;","¶"],["parallel;","∥"],["parsim;","⫳"],["parsl;","⫽"],["part;","∂"],["pcy;","п"],["percnt;","%"],["period;","."],["permil;","‰"],["perp;","⊥"],["pertenk;","‱"],["pfr;","𝔭"],["phi;","φ"],["phiv;","ϕ"],["phmmat;","ℳ"],["phone;","☎"],["pi;","π"],["pitchfork;","⋔"],["piv;","ϖ"],["planck;","ℏ"],["planckh;","ℎ"],["plankv;","ℏ"],["plus;","+"],["plusacir;","⨣"],["plusb;","⊞"],["pluscir;","⨢"],["plusdo;","∔"],["plusdu;","⨥"],["pluse;","⩲"],["plusmn","±"],["plusmn;","±"],["plussim;","⨦"],["plustwo;","⨧"],["pm;","±"],["pointint;","⨕"],["popf;","𝕡"],["pound","£"],["pound;","£"],["pr;","≺"],["prE;","⪳"],["prap;","⪷"],["prcue;","≼"],["pre;","⪯"],["prec;","≺"],["precapprox;","⪷"],["preccurlyeq;","≼"],["preceq;","⪯"],["precnapprox;","⪹"],["precneqq;","⪵"],["precnsim;","⋨"],["precsim;","≾"],["prime;","′"],["primes;","ℙ"],["prnE;","⪵"],["prnap;","⪹"],["prnsim;","⋨"],["prod;","∏"],["profalar;","⌮"],["profline;","⌒"],["profsurf;","⌓"],["prop;","∝"],["propto;","∝"],["prsim;","≾"],["prurel;","⊰"],["pscr;","𝓅"],["psi;","ψ"],["puncsp;"," "],["qfr;","𝔮"],["qint;","⨌"],["qopf;","𝕢"],["qprime;","⁗"],["qscr;","𝓆"],["quaternions;","ℍ"],["quatint;","⨖"],["quest;","?"],["questeq;","≟"],["quot","\\""],["quot;","\\""],["rAarr;","⇛"],["rArr;","⇒"],["rAtail;","⤜"],["rBarr;","⤏"],["rHar;","⥤"],["race;","∽̱"],["racute;","ŕ"],["radic;","√"],["raemptyv;","⦳"],["rang;","⟩"],["rangd;","⦒"],["range;","⦥"],["rangle;","⟩"],["raquo","»"],["raquo;","»"],["rarr;","→"],["rarrap;","⥵"],["rarrb;","⇥"],["rarrbfs;","⤠"],["rarrc;","⤳"],["rarrfs;","⤞"],["rarrhk;","↪"],["rarrlp;","↬"],["rarrpl;","⥅"],["rarrsim;","⥴"],["rarrtl;","↣"],["rarrw;","↝"],["ratail;","⤚"],["ratio;","∶"],["rationals;","ℚ"],["rbarr;","⤍"],["rbbrk;","❳"],["rbrace;","}"],["rbrack;","]"],["rbrke;","⦌"],["rbrksld;","⦎"],["rbrkslu;","⦐"],["rcaron;","ř"],["rcedil;","ŗ"],["rceil;","⌉"],["rcub;","}"],["rcy;","р"],["rdca;","⤷"],["rdldhar;","⥩"],["rdquo;","”"],["rdquor;","”"],["rdsh;","↳"],["real;","ℜ"],["realine;","ℛ"],["realpart;","ℜ"],["reals;","ℝ"],["rect;","▭"],["reg","®"],["reg;","®"],["rfisht;","⥽"],["rfloor;","⌋"],["rfr;","𝔯"],["rhard;","⇁"],["rharu;","⇀"],["rharul;","⥬"],["rho;","ρ"],["rhov;","ϱ"],["rightarrow;","→"],["rightarrowtail;","↣"],["rightharpoondown;","⇁"],["rightharpoonup;","⇀"],["rightleftarrows;","⇄"],["rightleftharpoons;","⇌"],["rightrightarrows;","⇉"],["rightsquigarrow;","↝"],["rightthreetimes;","⋌"],["ring;","˚"],["risingdotseq;","≓"],["rlarr;","⇄"],["rlhar;","⇌"],["rlm;","‏"],["rmoust;","⎱"],["rmoustache;","⎱"],["rnmid;","⫮"],["roang;","⟭"],["roarr;","⇾"],["robrk;","⟧"],["ropar;","⦆"],["ropf;","𝕣"],["roplus;","⨮"],["rotimes;","⨵"],["rpar;",")"],["rpargt;","⦔"],["rppolint;","⨒"],["rrarr;","⇉"],["rsaquo;","›"],["rscr;","𝓇"],["rsh;","↱"],["rsqb;","]"],["rsquo;","’"],["rsquor;","’"],["rthree;","⋌"],["rtimes;","⋊"],["rtri;","▹"],["rtrie;","⊵"],["rtrif;","▸"],["rtriltri;","⧎"],["ruluhar;","⥨"],["rx;","℞"],["sacute;","ś"],["sbquo;","‚"],["sc;","≻"],["scE;","⪴"],["scap;","⪸"],["scaron;","š"],["sccue;","≽"],["sce;","⪰"],["scedil;","ş"],["scirc;","ŝ"],["scnE;","⪶"],["scnap;","⪺"],["scnsim;","⋩"],["scpolint;","⨓"],["scsim;","≿"],["scy;","с"],["sdot;","⋅"],["sdotb;","⊡"],["sdote;","⩦"],["seArr;","⇘"],["searhk;","⤥"],["searr;","↘"],["searrow;","↘"],["sect","§"],["sect;","§"],["semi;",";"],["seswar;","⤩"],["setminus;","∖"],["setmn;","∖"],["sext;","✶"],["sfr;","𝔰"],["sfrown;","⌢"],["sharp;","♯"],["shchcy;","щ"],["shcy;","ш"],["shortmid;","∣"],["shortparallel;","∥"],["shy","­"],["shy;","­"],["sigma;","σ"],["sigmaf;","ς"],["sigmav;","ς"],["sim;","∼"],["simdot;","⩪"],["sime;","≃"],["simeq;","≃"],["simg;","⪞"],["simgE;","⪠"],["siml;","⪝"],["simlE;","⪟"],["simne;","≆"],["simplus;","⨤"],["simrarr;","⥲"],["slarr;","←"],["smallsetminus;","∖"],["smashp;","⨳"],["smeparsl;","⧤"],["smid;","∣"],["smile;","⌣"],["smt;","⪪"],["smte;","⪬"],["smtes;","⪬︀"],["softcy;","ь"],["sol;","/"],["solb;","⧄"],["solbar;","⌿"],["sopf;","𝕤"],["spades;","♠"],["spadesuit;","♠"],["spar;","∥"],["sqcap;","⊓"],["sqcaps;","⊓︀"],["sqcup;","⊔"],["sqcups;","⊔︀"],["sqsub;","⊏"],["sqsube;","⊑"],["sqsubset;","⊏"],["sqsubseteq;","⊑"],["sqsup;","⊐"],["sqsupe;","⊒"],["sqsupset;","⊐"],["sqsupseteq;","⊒"],["squ;","□"],["square;","□"],["squarf;","▪"],["squf;","▪"],["srarr;","→"],["sscr;","𝓈"],["ssetmn;","∖"],["ssmile;","⌣"],["sstarf;","⋆"],["star;","☆"],["starf;","★"],["straightepsilon;","ϵ"],["straightphi;","ϕ"],["strns;","¯"],["sub;","⊂"],["subE;","⫅"],["subdot;","⪽"],["sube;","⊆"],["subedot;","⫃"],["submult;","⫁"],["subnE;","⫋"],["subne;","⊊"],["subplus;","⪿"],["subrarr;","⥹"],["subset;","⊂"],["subseteq;","⊆"],["subseteqq;","⫅"],["subsetneq;","⊊"],["subsetneqq;","⫋"],["subsim;","⫇"],["subsub;","⫕"],["subsup;","⫓"],["succ;","≻"],["succapprox;","⪸"],["succcurlyeq;","≽"],["succeq;","⪰"],["succnapprox;","⪺"],["succneqq;","⪶"],["succnsim;","⋩"],["succsim;","≿"],["sum;","∑"],["sung;","♪"],["sup1","¹"],["sup1;","¹"],["sup2","²"],["sup2;","²"],["sup3","³"],["sup3;","³"],["sup;","⊃"],["supE;","⫆"],["supdot;","⪾"],["supdsub;","⫘"],["supe;","⊇"],["supedot;","⫄"],["suphsol;","⟉"],["suphsub;","⫗"],["suplarr;","⥻"],["supmult;","⫂"],["supnE;","⫌"],["supne;","⊋"],["supplus;","⫀"],["supset;","⊃"],["supseteq;","⊇"],["supseteqq;","⫆"],["supsetneq;","⊋"],["supsetneqq;","⫌"],["supsim;","⫈"],["supsub;","⫔"],["supsup;","⫖"],["swArr;","⇙"],["swarhk;","⤦"],["swarr;","↙"],["swarrow;","↙"],["swnwar;","⤪"],["szlig","ß"],["szlig;","ß"],["target;","⌖"],["tau;","τ"],["tbrk;","⎴"],["tcaron;","ť"],["tcedil;","ţ"],["tcy;","т"],["tdot;","⃛"],["telrec;","⌕"],["tfr;","𝔱"],["there4;","∴"],["therefore;","∴"],["theta;","θ"],["thetasym;","ϑ"],["thetav;","ϑ"],["thickapprox;","≈"],["thicksim;","∼"],["thinsp;"," "],["thkap;","≈"],["thksim;","∼"],["thorn","þ"],["thorn;","þ"],["tilde;","˜"],["times","×"],["times;","×"],["timesb;","⊠"],["timesbar;","⨱"],["timesd;","⨰"],["tint;","∭"],["toea;","⤨"],["top;","⊤"],["topbot;","⌶"],["topcir;","⫱"],["topf;","𝕥"],["topfork;","⫚"],["tosa;","⤩"],["tprime;","‴"],["trade;","™"],["triangle;","▵"],["triangledown;","▿"],["triangleleft;","◃"],["trianglelefteq;","⊴"],["triangleq;","≜"],["triangleright;","▹"],["trianglerighteq;","⊵"],["tridot;","◬"],["trie;","≜"],["triminus;","⨺"],["triplus;","⨹"],["trisb;","⧍"],["tritime;","⨻"],["trpezium;","⏢"],["tscr;","𝓉"],["tscy;","ц"],["tshcy;","ћ"],["tstrok;","ŧ"],["twixt;","≬"],["twoheadleftarrow;","↞"],["twoheadrightarrow;","↠"],["uArr;","⇑"],["uHar;","⥣"],["uacute","ú"],["uacute;","ú"],["uarr;","↑"],["ubrcy;","ў"],["ubreve;","ŭ"],["ucirc","û"],["ucirc;","û"],["ucy;","у"],["udarr;","⇅"],["udblac;","ű"],["udhar;","⥮"],["ufisht;","⥾"],["ufr;","𝔲"],["ugrave","ù"],["ugrave;","ù"],["uharl;","↿"],["uharr;","↾"],["uhblk;","▀"],["ulcorn;","⌜"],["ulcorner;","⌜"],["ulcrop;","⌏"],["ultri;","◸"],["umacr;","ū"],["uml","¨"],["uml;","¨"],["uogon;","ų"],["uopf;","𝕦"],["uparrow;","↑"],["updownarrow;","↕"],["upharpoonleft;","↿"],["upharpoonright;","↾"],["uplus;","⊎"],["upsi;","υ"],["upsih;","ϒ"],["upsilon;","υ"],["upuparrows;","⇈"],["urcorn;","⌝"],["urcorner;","⌝"],["urcrop;","⌎"],["uring;","ů"],["urtri;","◹"],["uscr;","𝓊"],["utdot;","⋰"],["utilde;","ũ"],["utri;","▵"],["utrif;","▴"],["uuarr;","⇈"],["uuml","ü"],["uuml;","ü"],["uwangle;","⦧"],["vArr;","⇕"],["vBar;","⫨"],["vBarv;","⫩"],["vDash;","⊨"],["vangrt;","⦜"],["varepsilon;","ϵ"],["varkappa;","ϰ"],["varnothing;","∅"],["varphi;","ϕ"],["varpi;","ϖ"],["varpropto;","∝"],["varr;","↕"],["varrho;","ϱ"],["varsigma;","ς"],["varsubsetneq;","⊊︀"],["varsubsetneqq;","⫋︀"],["varsupsetneq;","⊋︀"],["varsupsetneqq;","⫌︀"],["vartheta;","ϑ"],["vartriangleleft;","⊲"],["vartriangleright;","⊳"],["vcy;","в"],["vdash;","⊢"],["vee;","∨"],["veebar;","⊻"],["veeeq;","≚"],["vellip;","⋮"],["verbar;","|"],["vert;","|"],["vfr;","𝔳"],["vltri;","⊲"],["vnsub;","⊂⃒"],["vnsup;","⊃⃒"],["vopf;","𝕧"],["vprop;","∝"],["vrtri;","⊳"],["vscr;","𝓋"],["vsubnE;","⫋︀"],["vsubne;","⊊︀"],["vsupnE;","⫌︀"],["vsupne;","⊋︀"],["vzigzag;","⦚"],["wcirc;","ŵ"],["wedbar;","⩟"],["wedge;","∧"],["wedgeq;","≙"],["weierp;","℘"],["wfr;","𝔴"],["wopf;","𝕨"],["wp;","℘"],["wr;","≀"],["wreath;","≀"],["wscr;","𝓌"],["xcap;","⋂"],["xcirc;","◯"],["xcup;","⋃"],["xdtri;","▽"],["xfr;","𝔵"],["xhArr;","⟺"],["xharr;","⟷"],["xi;","ξ"],["xlArr;","⟸"],["xlarr;","⟵"],["xmap;","⟼"],["xnis;","⋻"],["xodot;","⨀"],["xopf;","𝕩"],["xoplus;","⨁"],["xotime;","⨂"],["xrArr;","⟹"],["xrarr;","⟶"],["xscr;","𝓍"],["xsqcup;","⨆"],["xuplus;","⨄"],["xutri;","△"],["xvee;","⋁"],["xwedge;","⋀"],["yacute","ý"],["yacute;","ý"],["yacy;","я"],["ycirc;","ŷ"],["ycy;","ы"],["yen","¥"],["yen;","¥"],["yfr;","𝔶"],["yicy;","ї"],["yopf;","𝕪"],["yscr;","𝓎"],["yucy;","ю"],["yuml","ÿ"],["yuml;","ÿ"],["zacute;","ź"],["zcaron;","ž"],["zcy;","з"],["zdot;","ż"],["zeetrf;","ℨ"],["zeta;","ζ"],["zfr;","𝔷"],["zhcy;","ж"],["zigrarr;","⇝"],["zopf;","𝕫"],["zscr;","𝓏"],["zwj;","‍"],["zwnj;","‌"]]',
  ),
)
/**
 * WHATWG HTML tokenizer (single pass) — `.` main engine.
 *
 * Implements the tokenization stage of
 * https://html.spec.whatwg.org/#tokenization Verified against the vendored
 * html5lib-tests tokenizer suite (test/main/tokenizer.test.ts). Tree
 * construction (the other half of a browser-faithful parser) drives the
 * content-model state from outside via `setState()` — exactly as the spec's
 * tree-construction stage does.
 *
 * Parse errors are intentionally not surfaced as tokens: a sanitizer cares
 * about the token _stream_ the browser would build, not error reporting.
 * Character tokens are emitted per run; the conformance harness coalesces
 * before comparing.
 *
 * NOT YET IMPLEMENTED (rare; tracked by the harness ratchet): script-data
 * escaped / double-escaped states. Everything else (incl. RCDATA/RAWTEXT/
 * PLAINTEXT/CDATA, full comment + DOCTYPE machinery, named/numeric character
 * references) is here.
 */
const S = {
  Data: 0,
  RCDATA: 1,
  RAWTEXT: 2,
  ScriptData: 3,
  PLAINTEXT: 4,
  TagOpen: 5,
  EndTagOpen: 6,
  TagName: 7,
  RCDATALt: 8,
  RCDATAEndTagOpen: 9,
  RCDATAEndTagName: 10,
  RAWTEXTLt: 11,
  RAWTEXTEndTagOpen: 12,
  RAWTEXTEndTagName: 13,
  ScriptLt: 14,
  ScriptEndTagOpen: 15,
  ScriptEndTagName: 16,
  BeforeAttrName: 17,
  AttrName: 18,
  AfterAttrName: 19,
  BeforeAttrValue: 20,
  AttrValueDq: 21,
  AttrValueSq: 22,
  AttrValueUq: 23,
  AfterAttrValueQuoted: 24,
  SelfClosing: 25,
  BogusComment: 26,
  MarkupDeclOpen: 27,
  CommentStart: 28,
  CommentStartDash: 29,
  Comment: 30,
  CommentEndDash: 31,
  CommentEnd: 32,
  CommentEndBang: 33,
  Doctype: 34,
  BeforeDoctypeName: 35,
  DoctypeName: 36,
  AfterDoctypeName: 37,
  AfterDoctypePublicKw: 38,
  BeforeDoctypePublicId: 39,
  DoctypePublicIdDq: 40,
  DoctypePublicIdSq: 41,
  AfterDoctypePublicId: 42,
  BetweenDoctypePublicSystem: 43,
  AfterDoctypeSystemKw: 44,
  BeforeDoctypeSystemId: 45,
  DoctypeSystemIdDq: 46,
  DoctypeSystemIdSq: 47,
  AfterDoctypeSystemId: 48,
  BogusDoctype: 49,
  CdataSection: 50,
  CdataSectionBracket: 51,
  CdataSectionEnd: 52,
  CharRef: 53,
  NamedCharRef: 54,
  AmbiguousAmp: 55,
  NumericCharRef: 56,
  HexStart: 57,
  DecStart: 58,
  HexRef: 59,
  DecRef: 60,
  NumericEnd: 61,
  ScriptEscapeStart: 62,
  ScriptEscapeStartDash: 63,
  ScriptEscaped: 64,
  ScriptEscapedDash: 65,
  ScriptEscapedDashDash: 66,
  ScriptEscapedLt: 67,
  ScriptEscapedEndTagOpen: 68,
  ScriptEscapedEndTagName: 69,
  ScriptDoubleEscapeStart: 70,
  ScriptDoubleEscaped: 71,
  ScriptDoubleEscapedDash: 72,
  ScriptDoubleEscapedDashDash: 73,
  ScriptDoubleEscapedLt: 74,
  ScriptDoubleEscapeEnd: 75,
}
const REPLACEMENT = '�'
const C1 = {
  128: 8364,
  130: 8218,
  131: 402,
  132: 8222,
  133: 8230,
  134: 8224,
  135: 8225,
  136: 710,
  137: 8240,
  138: 352,
  139: 8249,
  140: 338,
  142: 381,
  145: 8216,
  146: 8217,
  147: 8220,
  148: 8221,
  149: 8226,
  150: 8211,
  151: 8212,
  152: 732,
  153: 8482,
  154: 353,
  155: 8250,
  156: 339,
  158: 382,
  159: 376,
}
const isWs = c => c === 9 || c === 10 || c === 12 || c === 32 || c === 13
const isAsciiAlpha = c => (c >= 65 && c <= 90) || (c >= 97 && c <= 122)
const isAsciiAlnum = c => isAsciiAlpha(c) || (c >= 48 && c <= 57)
const isHexDigit = c =>
  (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102)
const toLowerCh = c => (c >= 65 && c <= 90 ? c + 32 : c)
const ASCII_UPPER_G = /[A-Z]/g
const foldAsciiUpper = s => {
  for (let i = 0; i < s.length; i++)
    if (s.charCodeAt(i) >= 128)
      return s.replace(ASCII_UPPER_G, m =>
        String.fromCharCode(m.charCodeAt(0) | 32),
      )
  return s.toLowerCase()
}
const INTERN_NAMES = [
  'a',
  'abbr',
  'accept',
  'action',
  'address',
  'align',
  'allow',
  'allowfullscreen',
  'alt',
  'annotation-xml',
  'area',
  'aria-controls',
  'aria-current',
  'aria-describedby',
  'aria-expanded',
  'aria-hidden',
  'aria-label',
  'aria-labelledby',
  'aria-live',
  'article',
  'aside',
  'audio',
  'autocomplete',
  'autofocus',
  'autoplay',
  'b',
  'base',
  'bdi',
  'bdo',
  'bgcolor',
  'big',
  'blockquote',
  'body',
  'border',
  'br',
  'button',
  'canvas',
  'caption',
  'cellpadding',
  'cellspacing',
  'center',
  'charset',
  'checked',
  'circle',
  'cite',
  'class',
  'clippath',
  'code',
  'col',
  'colgroup',
  'color',
  'cols',
  'colspan',
  'content',
  'contenteditable',
  'controls',
  'coords',
  'crossorigin',
  'cx',
  'cy',
  'd',
  'data',
  'datalist',
  'datetime',
  'dd',
  'decoding',
  'definitionurl',
  'defs',
  'del',
  'desc',
  'details',
  'dfn',
  'dialog',
  'dir',
  'disabled',
  'div',
  'dl',
  'download',
  'draggable',
  'dt',
  'ellipse',
  'em',
  'embed',
  'encoding',
  'enctype',
  'face',
  'fieldset',
  'figcaption',
  'figure',
  'fill',
  'filter',
  'font',
  'footer',
  'for',
  'foreignobject',
  'form',
  'frame',
  'frameborder',
  'frameset',
  'g',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'head',
  'header',
  'headers',
  'height',
  'hgroup',
  'hidden',
  'hr',
  'href',
  'hreflang',
  'html',
  'http-equiv',
  'i',
  'id',
  'iframe',
  'image',
  'img',
  'input',
  'ins',
  'integrity',
  'is',
  'ismap',
  'kbd',
  'label',
  'lang',
  'legend',
  'li',
  'line',
  'lineargradient',
  'link',
  'listing',
  'loading',
  'loop',
  'main',
  'malignmark',
  'map',
  'mark',
  'marquee',
  'mask',
  'math',
  'max',
  'maxlength',
  'media',
  'menu',
  'meta',
  'meter',
  'method',
  'mglyph',
  'mi',
  'min',
  'minlength',
  'mn',
  'mo',
  'ms',
  'mtext',
  'multiple',
  'muted',
  'name',
  'nav',
  'nobr',
  'noembed',
  'noframes',
  'nonce',
  'noscript',
  'object',
  'ol',
  'onclick',
  'onerror',
  'onfocus',
  'onload',
  'onmouseover',
  'open',
  'optgroup',
  'option',
  'output',
  'p',
  'param',
  'part',
  'path',
  'pattern',
  'picture',
  'ping',
  'placeholder',
  'plaintext',
  'points',
  'polygon',
  'polyline',
  'poster',
  'pre',
  'preload',
  'progress',
  'q',
  'r',
  'radialgradient',
  'rb',
  'readonly',
  'rect',
  'referrerpolicy',
  'rel',
  'required',
  'reversed',
  'role',
  'rows',
  'rowspan',
  'rp',
  'rt',
  'rtc',
  'ruby',
  'rx',
  'ry',
  's',
  'samp',
  'sandbox',
  'scope',
  'script',
  'search',
  'section',
  'select',
  'selected',
  'shape',
  'size',
  'sizes',
  'slot',
  'small',
  'source',
  'span',
  'spellcheck',
  'src',
  'srcset',
  'start',
  'step',
  'stop',
  'strike',
  'stroke',
  'strong',
  'style',
  'sub',
  'summary',
  'sup',
  'svg',
  'symbol',
  'tabindex',
  'table',
  'target',
  'tbody',
  'td',
  'template',
  'text',
  'textarea',
  'tfoot',
  'th',
  'thead',
  'time',
  'title',
  'tr',
  'track',
  'transform',
  'translate',
  'tspan',
  'tt',
  'type',
  'u',
  'ul',
  'use',
  'usemap',
  'valign',
  'value',
  'var',
  'video',
  'viewbox',
  'wbr',
  'width',
  'wrap',
  'x',
  'x1',
  'x2',
  'xmlns',
  'xmp',
  'y',
  'y1',
  'y2',
]
const INTERN_MASK = 1023
const FNV = 16777619
const INTERN_TABLE = /* @__PURE__ */ (() => {
  const t = new Array(1024).fill('')
  for (const name of INTERN_NAMES) {
    let h = -2128831035
    for (let k = 0; k < name.length; k++)
      h = Math.imul(h ^ name.charCodeAt(k), FNV)
    let slot = h & INTERN_MASK
    while (t[slot] !== '') slot = (slot + 1) & INTERN_MASK
    t[slot] = name
  }
  return t
})()
/**
 * Canonical interned name for input[start, start+n) (ASCII-case-folded when
 * `up`), or undefined if it is not a known name. `h` = FNV-1a over the folded
 * code units.
 */
function internRun(input, start, n, h, up) {
  let slot = h & INTERN_MASK
  for (;;) {
    const cand = INTERN_TABLE[slot]
    if (cand.length === 0) return void 0
    if (cand.length === n) {
      let k = 0
      if (!up) {
        for (; k < n; k++)
          if (input.charCodeAt(start + k) !== cand.charCodeAt(k)) break
      } else
        for (; k < n; k++) {
          let cc = input.charCodeAt(start + k)
          if (cc >= 65 && cc <= 90) cc |= 32
          if (cc !== cand.charCodeAt(k)) break
        }
      if (k === n) return cand
    }
    slot = (slot + 1) & INTERN_MASK
  }
}
const REF_MASK = 8191
const [REF_KEYS, REF_VALS] = /* @__PURE__ */ (() => {
  const keys = new Array(8192).fill('')
  const vals = new Array(8192).fill('')
  for (const [name, value] of NAMED_REFS) {
    if (name.charCodeAt(name.length - 1) !== 59) continue
    let h = -2128831035
    for (let k = 0; k < name.length; k++)
      h = Math.imul(h ^ name.charCodeAt(k), FNV)
    let slot = h & REF_MASK
    while (keys[slot] !== '') slot = (slot + 1) & REF_MASK
    keys[slot] = name
    vals[slot] = value
  }
  return [keys, vals]
})()
const ENTITY_TRIE = /* @__PURE__ */ (() => {
  const root = { next: /* @__PURE__ */ new Map() }
  for (const [name, value] of NAMED_REFS) {
    let node = root
    for (let i = 0; i < name.length; i++) {
      const cc = name.charCodeAt(i)
      let child = node.next.get(cc)
      if (child === void 0) {
        child = { next: /* @__PURE__ */ new Map() }
        node.next.set(cc, child)
      }
      node = child
    }
    node.v = value
  }
  return root
})()
const NO_ATTRS = Object.freeze([])
const STATE_FROM_CONTENT = {
  data: S.Data,
  rcdata: S.RCDATA,
  rawtext: S.RAWTEXT,
  scriptData: S.ScriptData,
  plaintext: S.PLAINTEXT,
  cdata: S.CdataSection,
}
/**
 * Attribute count past which duplicate detection switches from a scan to a Set.
 */
const ATTR_SET_MIN = 16
/**
 * WHATWG input-stream preprocessing for one run: CR and CRLF become LF. Jumps
 * between CRs with native `indexOf` (runs are short and numerous in a CRLF
 * document, where a regex replace per run costs more than the work).
 */
function normalizeCR(s) {
  let i = s.indexOf('\r')
  if (i === -1) return s
  let out = '',
    last = 0
  do {
    out += s.slice(last, i) + '\n'
    last = s.charCodeAt(i + 1) === 10 ? i + 2 : i + 1
    i = s.indexOf('\r', last)
  } while (i !== -1)
  return out + s.slice(last)
}
/**
 * States that append raw input chars one at a time (not as a normalized bulk
 * run) and don't treat CR as whitespace: DOCTYPE public/system ids, CDATA, and
 * the script-data escaped / double-escaped family. A CR there triggers
 * normalizeRest.
 */
const CR_COPY_STATES = /* @__PURE__ */ new Uint8Array(76)
for (const st of [40, 41, 46, 47, 50, 64, 65, 66, 70, 71, 72, 73, 75])
  CR_COPY_STATES[st] = 1
var Tokenizer = class {
  constructor(input, opts) {
    this.i = 0
    this.returnState = S.Data
    this.e0 = null
    this.e1 = null
    this.e2 = null
    this.done = false
    this.foreignFlag = false
    this.tagName = ''
    this.tagIsEnd = false
    this.tagSelfClosing = false
    this.attrs = []
    this.nAttrs = 0
    this.attrSeen = null
    this.attrName = ''
    this.attrValue = ''
    this.comment = ''
    this.dn = null
    this.dpub = null
    this.dsys = null
    this.dquirks = false
    this.tempBuf = ''
    this.charBuf = ''
    this.charRefCode = 0
    this.rtag = {
      type: 'startTag',
      name: '',
      attrs: [],
      selfClosing: false,
    }
    this.rchar = {
      type: 'character',
      data: '',
    }
    this.input = input
    this.len = input.length
    this.hasCR = input.indexOf('\r') !== -1
    this.state = STATE_FROM_CONTENT[opts.state ?? 'data']
    this.lastStartTag = opts.lastStartTag ?? ''
  }
  /**
   * Pull one token. Returns null at end of input. The tree builder calls this
   * in a loop, switching the content-model state (`setContentState`) between
   * pulls — exactly the tokenizer↔tree-construction coupling the WHATWG spec
   * requires.
   */
  nextToken() {
    if (this.e0 === null && !this.done) this.run()
    const t = this.e0
    this.e0 = this.e1
    this.e1 = this.e2
    this.e2 = null
    return t
  }
  /**
   * Run to completion, returning the whole token stream (used by conformance).
   * Clones each token because `rtag`/`rchar` are reused across `nextToken()`
   * calls and this retains the full stream. (The tree builder consumes one at a
   * time, so it doesn't need this.)
   */
  tokenize() {
    const tokens = []
    let t
    while ((t = this.nextToken()) !== null)
      if (t.type === 'startTag' || t.type === 'endTag')
        tokens.push({
          type: t.type,
          name: t.name,
          attrs: t.attrs,
          selfClosing: t.selfClosing,
        })
      else if (t.type === 'character')
        tokens.push({
          type: 'character',
          data: t.data,
        })
      else tokens.push(t)
    return tokens
  }
  /**
   * Tree builder hook: switch the content-model state (RAWTEXT/RCDATA/script…).
   */
  setContentState(state) {
    this.state = STATE_FROM_CONTENT[state]
  }
  /**
   * Tree builder hook: set the appropriate end-tag name for raw-text matching.
   */
  setLastStartTag(name) {
    this.lastStartTag = name
  }
  /**
   * Tree builder hook: in foreign content `<![CDATA[` is a real CDATA section,
   * not a bogus comment. The tree builder keeps this in sync with the adjusted
   * current node's namespace.
   */
  setForeignContent(v) {
    this.foreignFlag = v
  }
  /**
   * `input.slice(i, j)`, with CR/CRLF normalized to LF while raw CRs remain.
   * Bulk runs never end between a CR and its LF (no run stops at LF).
   */
  take(i, j) {
    const run = this.input.slice(i, j)
    return this.hasCR ? normalizeCR(run) : run
  }
  /**
   * Replace the unconsumed input with its CR-normalized form (positions restart
   * at 0; nothing holds an absolute position across run() iterations).
   */
  normalizeRest() {
    const rest = normalizeCR(this.input.slice(this.i))
    this.input = rest
    this.len = rest.length
    this.i = 0
    this.hasCR = false
  }
  emitChar(s) {
    this.charBuf += s
  }
  /**
   * Queue a token. At most two are ever live at once (text run + following
   * tag).
   */
  push(t) {
    if (this.e0 === null) this.e0 = t
    else this.e1 = t
  }
  flushChars() {
    if (this.charBuf) {
      this.rchar.data = this.charBuf
      this.push(this.rchar)
      this.charBuf = ''
    }
  }
  emit(t) {
    this.flushChars()
    this.push(t)
  }
  startTag() {
    this.tagName = ''
    this.tagIsEnd = false
    this.tagSelfClosing = false
    this.nAttrs = 0
    this.attrSeen = null
  }
  startEndTag() {
    this.startTag()
    this.tagIsEnd = true
  }
  addAttr() {
    const name = this.attrName
    if (name) {
      const attrs = this.attrs,
        n = this.nAttrs
      let dup = false
      if (n < ATTR_SET_MIN) {
        for (let k = 0; k < n; k++)
          if (attrs[k][0] === name) {
            dup = true
            break
          }
      } else {
        let seen = this.attrSeen
        if (seen === null) {
          seen = this.attrSeen = /* @__PURE__ */ new Set()
          for (let k = 0; k < n; k++) seen.add(attrs[k][0])
        }
        dup = seen.has(name)
        if (!dup) seen.add(name)
      }
      if (!dup) {
        attrs[n] = [name, this.attrValue]
        this.nAttrs = n + 1
      }
    }
    this.attrName = ''
    this.attrValue = ''
  }
  /**
   * Data-state `<` at `p`, with the TagOpen / EndTagOpen decisions inlined for
   * the overwhelmingly common `<name` and `</name` shapes (same transitions as
   * those states: start the tag and reconsume the letter in TagName). Anything
   * else enters TagOpen exactly as before.
   */
  tagOpenAt(p) {
    const input = this.input,
      len = this.len
    const n1 = p + 1 < len ? input.charCodeAt(p + 1) : -1
    if (isAsciiAlpha(n1)) {
      this.startTag()
      this.i = p + 1
      this.state = S.TagName
      return
    }
    if (n1 === 47 && p + 2 < len && isAsciiAlpha(input.charCodeAt(p + 2))) {
      this.startEndTag()
      this.i = p + 2
      this.state = S.TagName
      return
    }
    this.i = p + 1
    this.state = S.TagOpen
  }
  /**
   * Closing quote consumed; `p` is the next position. Inlines the
   * AfterAttrValueQuoted transitions for the common next chars (whitespace,
   * '>', '/'); anything else (incl. EOF) enters that state exactly as before.
   */
  afterQuotedValue(p) {
    const n = p < this.len ? this.input.charCodeAt(p) : -1
    if (n === 32 || n === 10 || n === 9 || n === 12 || n === 13) {
      this.i = p + 1
      this.state = S.BeforeAttrName
    } else if (n === 62) {
      this.i = p + 1
      this.state = S.Data
      this.emitTag()
    } else if (n === 47) {
      this.i = p + 1
      this.state = S.SelfClosing
    } else {
      this.i = p
      this.state = S.AfterAttrValueQuoted
    }
  }
  emitTag() {
    this.addAttr()
    if (!this.tagIsEnd) this.lastStartTag = this.tagName
    const k = this.rtag
    k.type = this.tagIsEnd ? 'endTag' : 'startTag'
    k.name = this.tagName
    k.attrs =
      this.nAttrs === 0
        ? this.tagIsEnd
          ? NO_ATTRS
          : []
        : this.attrs.slice(0, this.nAttrs)
    k.selfClosing = this.tagSelfClosing
    this.emit(k)
  }
  appropriateEndTag() {
    return this.tagIsEnd && this.tagName === this.lastStartTag
  }
  finish() {
    this.done = true
    this.flushChars()
    const eof = { type: 'eof' }
    if (this.e1 !== null) this.e2 = eof
    else this.push(eof)
  }
  run() {
    let input = this.input,
      len = this.len
    for (;;) {
      if (this.e0 !== null) return
      const eof = this.i >= len
      const c = eof ? -1 : input.charCodeAt(this.i)
      if (c === 13 && CR_COPY_STATES[this.state] === 1) {
        this.normalizeRest()
        input = this.input
        len = this.len
        continue
      }
      switch (this.state) {
        case 0:
          if (eof) {
            this.finish()
            return
          }
          if (c !== 38 && c !== 60 && c !== 0) {
            const input = this.input,
              len = this.len
            let j = this.i + 1
            while (j < len) {
              const cc = input.charCodeAt(j)
              if (cc === 38 || cc === 60 || cc === 0) break
              j++
            }
            this.charBuf += this.take(this.i, j)
            this.i = j
            if (j < len && input.charCodeAt(j) === 60) this.tagOpenAt(j)
            continue
          }
          if (c === 60) {
            this.tagOpenAt(this.i)
            continue
          }
          this.i++
          if (c === 38) {
            this.returnState = S.Data
            this.state = S.CharRef
          } else this.emitChar(this.input[this.i - 1])
          continue
        case 1:
          if (eof) {
            this.finish()
            return
          }
          if (c !== 38 && c !== 60 && c !== 0) {
            const input = this.input,
              len = this.len
            let j = this.i + 1
            while (j < len) {
              const cc = input.charCodeAt(j)
              if (cc === 38 || cc === 60 || cc === 0) break
              j++
            }
            this.charBuf += this.take(this.i, j)
            this.i = j
            continue
          }
          this.i++
          if (c === 38) {
            this.returnState = S.RCDATA
            this.state = S.CharRef
          } else if (c === 60) this.state = S.RCDATALt
          else this.emitChar(REPLACEMENT)
          continue
        case 2:
          if (eof) {
            this.finish()
            return
          }
          if (c !== 60 && c !== 0) {
            const input = this.input,
              len = this.len
            let j = this.i + 1
            while (j < len) {
              const cc = input.charCodeAt(j)
              if (cc === 60 || cc === 0) break
              j++
            }
            this.charBuf += this.take(this.i, j)
            this.i = j
            continue
          }
          this.i++
          if (c === 60) this.state = S.RAWTEXTLt
          else this.emitChar(REPLACEMENT)
          continue
        case 3:
          if (eof) {
            this.finish()
            return
          }
          if (c !== 60 && c !== 0) {
            const input = this.input,
              len = this.len
            let j = this.i + 1
            while (j < len) {
              const cc = input.charCodeAt(j)
              if (cc === 60 || cc === 0) break
              j++
            }
            this.charBuf += this.take(this.i, j)
            this.i = j
            continue
          }
          this.i++
          if (c === 60) this.state = S.ScriptLt
          else this.emitChar(REPLACEMENT)
          continue
        case 4:
          if (eof) {
            this.finish()
            return
          }
          if (c !== 0) {
            const input = this.input,
              len = this.len
            let j = this.i + 1
            while (j < len) {
              if (input.charCodeAt(j) === 0) break
              j++
            }
            this.charBuf += this.take(this.i, j)
            this.i = j
            continue
          }
          this.i++
          this.emitChar(REPLACEMENT)
          continue
        case 5:
          if (eof) {
            this.emitChar('<')
            this.finish()
            return
          }
          if (c === 33) {
            this.i++
            this.state = S.MarkupDeclOpen
          } else if (c === 47) {
            this.i++
            this.state = S.EndTagOpen
          } else if (isAsciiAlpha(c)) {
            this.startTag()
            this.state = S.TagName
          } else if (c === 63) {
            this.comment = ''
            this.state = S.BogusComment
          } else {
            this.emitChar('<')
            this.state = S.Data
          }
          continue
        case 6:
          if (eof) {
            this.emitChar('<')
            this.emitChar('/')
            this.finish()
            return
          }
          /* v8 ignore next -- `</letter` never reaches EndTagOpen: tagOpenAt starts the tag inline */
          if (isAsciiAlpha(c)) {
            this.startEndTag()
            this.state = S.TagName
          } else if (c === 62) {
            this.i++
            this.state = S.Data
          } else {
            this.comment = ''
            this.state = S.BogusComment
          }
          continue
        case 7:
          if (eof) {
            this.finish()
            return
          }
          if (!isWs(c) && c !== 47 && c !== 62 && c !== 0) {
            const input = this.input,
              len = this.len
            let j = this.i + 1,
              up = c >= 65 && c <= 90
            let h = Math.imul(2166136261 ^ (up ? c | 32 : c), FNV)
            while (j < len) {
              const cc = input.charCodeAt(j)
              if (
                cc === 9 ||
                cc === 10 ||
                cc === 12 ||
                cc === 32 ||
                cc === 13 ||
                cc === 47 ||
                cc === 62 ||
                cc === 0
              )
                break
              if (cc >= 65 && cc <= 90) {
                up = true
                h = Math.imul(h ^ (cc | 32), FNV)
              } else h = Math.imul(h ^ cc, FNV)
              j++
            }
            const k =
              this.tagName === ''
                ? internRun(input, this.i, j - this.i, h, up)
                : void 0
            if (k !== void 0) this.tagName = k
            else {
              const run = input.slice(this.i, j)
              this.tagName += up ? foldAsciiUpper(run) : run
            }
            this.i = j
            if (j < len) {
              const t = input.charCodeAt(j)
              if (t === 62) {
                this.i = j + 1
                this.state = S.Data
                this.emitTag()
              } else if (
                t === 32 ||
                t === 10 ||
                t === 9 ||
                t === 12 ||
                t === 13
              ) {
                this.i = j + 1
                this.state = S.BeforeAttrName
              }
            }
            continue
          }
          this.i++
          if (isWs(c)) this.state = S.BeforeAttrName
          else if (c === 47) this.state = S.SelfClosing
          else if (c === 62) {
            this.state = S.Data
            this.emitTag()
          } else this.tagName += REPLACEMENT
          continue
        case 8:
          if (!eof && c === 47) {
            this.i++
            this.tempBuf = ''
            this.state = S.RCDATAEndTagOpen
          } else {
            this.emitChar('<')
            this.state = S.RCDATA
          }
          continue
        case 9:
          if (!eof && isAsciiAlpha(c)) {
            this.startEndTag()
            this.state = S.RCDATAEndTagName
          } else {
            this.emitChar('</')
            this.state = S.RCDATA
          }
          continue
        case 10:
          this.endTagNameState(c, eof, S.RCDATA)
          continue
        case 11:
          if (!eof && c === 47) {
            this.i++
            this.tempBuf = ''
            this.state = S.RAWTEXTEndTagOpen
          } else {
            this.emitChar('<')
            this.state = S.RAWTEXT
          }
          continue
        case 12:
          if (!eof && isAsciiAlpha(c)) {
            this.startEndTag()
            this.state = S.RAWTEXTEndTagName
          } else {
            this.emitChar('</')
            this.state = S.RAWTEXT
          }
          continue
        case 13:
          this.endTagNameState(c, eof, S.RAWTEXT)
          continue
        case 14:
          if (!eof && c === 47) {
            this.i++
            this.tempBuf = ''
            this.state = S.ScriptEndTagOpen
            continue
          }
          if (!eof && c === 33) {
            this.i++
            this.emitChar('<!')
            this.state = S.ScriptEscapeStart
            continue
          }
          this.emitChar('<')
          this.state = S.ScriptData
          continue
        case 15:
          if (!eof && isAsciiAlpha(c)) {
            this.startEndTag()
            this.state = S.ScriptEndTagName
          } else {
            this.emitChar('</')
            this.state = S.ScriptData
          }
          continue
        case 16:
          this.endTagNameState(c, eof, S.ScriptData)
          continue
        case 62:
          if (!eof && c === 45) {
            this.i++
            this.emitChar('-')
            this.state = S.ScriptEscapeStartDash
            continue
          }
          this.state = S.ScriptData
          continue
        case 63:
          if (!eof && c === 45) {
            this.i++
            this.emitChar('-')
            this.state = S.ScriptEscapedDashDash
            continue
          }
          this.state = S.ScriptData
          continue
        case 64:
          if (eof) {
            this.finish()
            return
          }
          this.i++
          if (c === 45) {
            this.emitChar('-')
            this.state = S.ScriptEscapedDash
          } else if (c === 60) this.state = S.ScriptEscapedLt
          else this.emitChar(c === 0 ? REPLACEMENT : this.input[this.i - 1])
          continue
        case 65:
          if (eof) {
            this.finish()
            return
          }
          this.i++
          if (c === 45) {
            this.emitChar('-')
            this.state = S.ScriptEscapedDashDash
          } else if (c === 60) this.state = S.ScriptEscapedLt
          else {
            this.emitChar(c === 0 ? REPLACEMENT : this.input[this.i - 1])
            this.state = S.ScriptEscaped
          }
          continue
        case 66:
          if (eof) {
            this.finish()
            return
          }
          this.i++
          if (c === 45) this.emitChar('-')
          else if (c === 60) this.state = S.ScriptEscapedLt
          else if (c === 62) {
            this.emitChar('>')
            this.state = S.ScriptData
          } else {
            this.emitChar(c === 0 ? REPLACEMENT : this.input[this.i - 1])
            this.state = S.ScriptEscaped
          }
          continue
        case 67:
          if (!eof && c === 47) {
            this.i++
            this.tempBuf = ''
            this.state = S.ScriptEscapedEndTagOpen
            continue
          }
          if (!eof && isAsciiAlpha(c)) {
            this.tempBuf = ''
            this.emitChar('<')
            this.state = S.ScriptDoubleEscapeStart
            continue
          }
          this.emitChar('<')
          this.state = S.ScriptEscaped
          continue
        case 68:
          if (!eof && isAsciiAlpha(c)) {
            this.startEndTag()
            this.state = S.ScriptEscapedEndTagName
            continue
          }
          this.emitChar('</')
          this.state = S.ScriptEscaped
          continue
        case 69:
          this.endTagNameState(c, eof, S.ScriptEscaped)
          continue
        case 70:
          if (!eof && (isWs(c) || c === 47 || c === 62)) {
            this.i++
            this.emitChar(this.input[this.i - 1])
            this.state =
              this.tempBuf === 'script'
                ? S.ScriptDoubleEscaped
                : S.ScriptEscaped
            continue
          }
          if (!eof && isAsciiAlpha(c)) {
            this.i++
            this.tempBuf += String.fromCharCode(toLowerCh(c))
            this.emitChar(this.input[this.i - 1])
            continue
          }
          this.state = S.ScriptEscaped
          continue
        case 71:
          if (eof) {
            this.finish()
            return
          }
          this.i++
          if (c === 45) {
            this.emitChar('-')
            this.state = S.ScriptDoubleEscapedDash
          } else if (c === 60) {
            this.emitChar('<')
            this.state = S.ScriptDoubleEscapedLt
          } else this.emitChar(c === 0 ? REPLACEMENT : this.input[this.i - 1])
          continue
        case 72:
          if (eof) {
            this.finish()
            return
          }
          this.i++
          if (c === 45) {
            this.emitChar('-')
            this.state = S.ScriptDoubleEscapedDashDash
          } else if (c === 60) {
            this.emitChar('<')
            this.state = S.ScriptDoubleEscapedLt
          } else {
            this.emitChar(c === 0 ? REPLACEMENT : this.input[this.i - 1])
            this.state = S.ScriptDoubleEscaped
          }
          continue
        case 73:
          if (eof) {
            this.finish()
            return
          }
          this.i++
          if (c === 45) this.emitChar('-')
          else if (c === 60) {
            this.emitChar('<')
            this.state = S.ScriptDoubleEscapedLt
          } else if (c === 62) {
            this.emitChar('>')
            this.state = S.ScriptData
          } else {
            this.emitChar(c === 0 ? REPLACEMENT : this.input[this.i - 1])
            this.state = S.ScriptDoubleEscaped
          }
          continue
        case 74:
          if (!eof && c === 47) {
            this.i++
            this.tempBuf = ''
            this.emitChar('/')
            this.state = S.ScriptDoubleEscapeEnd
            continue
          }
          this.state = S.ScriptDoubleEscaped
          continue
        case 75:
          if (!eof && (isWs(c) || c === 47 || c === 62)) {
            this.i++
            this.emitChar(this.input[this.i - 1])
            this.state =
              this.tempBuf === 'script'
                ? S.ScriptEscaped
                : S.ScriptDoubleEscaped
            continue
          }
          if (!eof && isAsciiAlpha(c)) {
            this.i++
            this.tempBuf += String.fromCharCode(toLowerCh(c))
            this.emitChar(this.input[this.i - 1])
            continue
          }
          this.state = S.ScriptDoubleEscaped
          continue
        case 17:
          if (eof || c === 47 || c === 62) {
            this.state = S.AfterAttrName
            continue
          }
          if (isWs(c)) {
            const input = this.input,
              len = this.len
            let j = this.i + 1
            while (j < len) {
              const cc = input.charCodeAt(j)
              if (cc !== 9 && cc !== 10 && cc !== 12 && cc !== 32 && cc !== 13)
                break
              j++
            }
            this.i = j
            continue
          }
          this.addAttr()
          if (c === 61) {
            this.i++
            this.attrName = '='
            this.state = S.AttrName
            continue
          }
          this.state = S.AttrName
          continue
        case 18:
          if (eof || isWs(c) || c === 47 || c === 62) {
            this.state = S.AfterAttrName
            continue
          }
          if (c !== 61 && c !== 0) {
            const input = this.input,
              len = this.len
            let j = this.i + 1,
              up = c >= 65 && c <= 90
            let h = Math.imul(2166136261 ^ (up ? c | 32 : c), FNV)
            while (j < len) {
              const cc = input.charCodeAt(j)
              if (
                cc === 9 ||
                cc === 10 ||
                cc === 12 ||
                cc === 32 ||
                cc === 13 ||
                cc === 47 ||
                cc === 62 ||
                cc === 61 ||
                cc === 0
              )
                break
              if (cc >= 65 && cc <= 90) {
                up = true
                h = Math.imul(h ^ (cc | 32), FNV)
              } else h = Math.imul(h ^ cc, FNV)
              j++
            }
            const k =
              this.attrName === ''
                ? internRun(input, this.i, j - this.i, h, up)
                : void 0
            if (k !== void 0) this.attrName = k
            else {
              const run = input.slice(this.i, j)
              this.attrName += up ? foldAsciiUpper(run) : run
            }
            this.i = j
            if (j + 1 < len && input.charCodeAt(j) === 61) {
              const q = input.charCodeAt(j + 1)
              if (q === 34) {
                this.i = j + 2
                this.state = S.AttrValueDq
              } else if (q === 39) {
                this.i = j + 2
                this.state = S.AttrValueSq
              }
            }
            continue
          }
          this.i++
          if (c === 61) {
            const nc = this.i < this.len ? this.input.charCodeAt(this.i) : -1
            if (nc === 34) {
              this.i++
              this.state = S.AttrValueDq
            } else if (nc === 39) {
              this.i++
              this.state = S.AttrValueSq
            } else this.state = S.BeforeAttrValue
          } else this.attrName += REPLACEMENT
          continue
        case 19:
          if (eof) {
            this.finish()
            return
          }
          if (isWs(c)) {
            this.i++
            continue
          }
          if (c === 47) {
            this.i++
            this.state = S.SelfClosing
            continue
          }
          if (c === 61) {
            this.i++
            this.state = S.BeforeAttrValue
            continue
          }
          if (c === 62) {
            this.i++
            this.state = S.Data
            this.emitTag()
            continue
          }
          this.addAttr()
          this.state = S.AttrName
          continue
        case 20:
          if (!eof && isWs(c)) {
            this.i++
            continue
          }
          if (!eof && c === 34) {
            this.i++
            this.state = S.AttrValueDq
          } else if (!eof && c === 39) {
            this.i++
            this.state = S.AttrValueSq
          } else if (!eof && c === 62) {
            this.i++
            this.state = S.Data
            this.emitTag()
          } else {
            this.state = S.AttrValueUq
            continue
          }
          continue
        case 21:
          if (eof) {
            this.finish()
            return
          }
          if (c !== 34 && c !== 38 && c !== 0) {
            const input = this.input,
              len = this.len
            let j = this.i + 1
            while (j < len) {
              const cc = input.charCodeAt(j)
              if (cc === 34 || cc === 38 || cc === 0) break
              j++
            }
            this.attrValue += this.take(this.i, j)
            this.i = j
            if (j < len && input.charCodeAt(j) === 34)
              this.afterQuotedValue(j + 1)
            continue
          }
          if (c === 34) {
            this.afterQuotedValue(this.i + 1)
            continue
          }
          this.i++
          if (c === 38) {
            this.returnState = S.AttrValueDq
            this.state = S.CharRef
          } else this.attrValue += REPLACEMENT
          continue
        case 22:
          if (eof) {
            this.finish()
            return
          }
          if (c !== 39 && c !== 38 && c !== 0) {
            const input = this.input,
              len = this.len
            let j = this.i + 1
            while (j < len) {
              const cc = input.charCodeAt(j)
              if (cc === 39 || cc === 38 || cc === 0) break
              j++
            }
            this.attrValue += this.take(this.i, j)
            this.i = j
            if (j < len && input.charCodeAt(j) === 39)
              this.afterQuotedValue(j + 1)
            continue
          }
          if (c === 39) {
            this.afterQuotedValue(this.i + 1)
            continue
          }
          this.i++
          if (c === 38) {
            this.returnState = S.AttrValueSq
            this.state = S.CharRef
          } else this.attrValue += REPLACEMENT
          continue
        case 23:
          if (eof) {
            this.finish()
            return
          }
          if (!isWs(c) && c !== 38 && c !== 62 && c !== 0) {
            const input = this.input,
              len = this.len
            let j = this.i + 1
            while (j < len) {
              const cc = input.charCodeAt(j)
              if (
                cc === 9 ||
                cc === 10 ||
                cc === 12 ||
                cc === 32 ||
                cc === 13 ||
                cc === 38 ||
                cc === 62 ||
                cc === 0
              )
                break
              j++
            }
            this.attrValue += this.take(this.i, j)
            this.i = j
            continue
          }
          this.i++
          if (isWs(c)) this.state = S.BeforeAttrName
          else if (c === 38) {
            this.returnState = S.AttrValueUq
            this.state = S.CharRef
          } else if (c === 62) {
            this.state = S.Data
            this.emitTag()
          } else this.attrValue += REPLACEMENT
          continue
        case 24:
          if (eof) {
            this.finish()
            return
          }
          /* v8 ignore start -- ws / '/' / '>' after a closing quote are handled inline by afterQuotedValue */
          if (isWs(c)) {
            this.i++
            this.state = S.BeforeAttrName
          } else if (c === 47) {
            this.i++
            this.state = S.SelfClosing
          } else if (c === 62) {
            this.i++
            this.state = S.Data
            this.emitTag()
          } else {
            this.state = S.BeforeAttrName
            continue
          }
          continue
        /* v8 ignore stop */
        case 25:
          if (eof) {
            this.finish()
            return
          }
          if (c === 62) {
            this.i++
            this.tagSelfClosing = true
            this.state = S.Data
            this.emitTag()
            continue
          }
          this.state = S.BeforeAttrName
          continue
        case 26:
          if (eof) {
            this.emit({
              type: 'comment',
              data: this.comment,
            })
            this.finish()
            return
          }
          if (c !== 62 && c !== 0) {
            const input = this.input,
              len = this.len
            let j = this.i + 1
            while (j < len) {
              const cc = input.charCodeAt(j)
              if (cc === 62 || cc === 0) break
              j++
            }
            this.comment += this.take(this.i, j)
            this.i = j
            continue
          }
          this.i++
          if (c === 62) {
            this.emit({
              type: 'comment',
              data: this.comment,
            })
            this.state = S.Data
          } else this.comment += REPLACEMENT
          continue
        case 27:
          if (this.input.startsWith('--', this.i)) {
            this.i += 2
            this.comment = ''
            this.state = S.CommentStart
          } else if (/^doctype/i.test(this.input.substr(this.i, 7))) {
            this.i += 7
            this.state = S.Doctype
          } else if (this.input.startsWith('[CDATA[', this.i)) {
            this.i += 7
            if (this.foreignFlag) this.state = S.CdataSection
            else {
              this.comment = '[CDATA['
              this.state = S.BogusComment
            }
          } else {
            this.comment = ''
            this.state = S.BogusComment
          }
          continue
        case 28:
          if (!eof && c === 45) {
            this.i++
            this.state = S.CommentStartDash
          } else if (!eof && c === 62) {
            this.i++
            this.emit({
              type: 'comment',
              data: this.comment,
            })
            this.state = S.Data
          } else {
            this.state = S.Comment
            continue
          }
          continue
        case 29:
          if (eof) {
            this.emit({
              type: 'comment',
              data: this.comment,
            })
            this.finish()
            return
          }
          if (c === 45) {
            this.i++
            this.state = S.CommentEnd
            continue
          }
          if (c === 62) {
            this.i++
            this.emit({
              type: 'comment',
              data: this.comment,
            })
            this.state = S.Data
            continue
          }
          this.comment += '-'
          this.state = S.Comment
          continue
        case 30:
          if (eof) {
            this.emit({
              type: 'comment',
              data: this.comment,
            })
            this.finish()
            return
          }
          if (c !== 45 && c !== 0) {
            const input = this.input,
              len = this.len
            let j = this.i + 1
            while (j < len) {
              const cc = input.charCodeAt(j)
              if (cc === 45 || cc === 0) break
              j++
            }
            this.comment += this.take(this.i, j)
            this.i = j
            continue
          }
          this.i++
          if (c === 45) this.state = S.CommentEndDash
          else this.comment += REPLACEMENT
          continue
        case 31:
          if (eof) {
            this.emit({
              type: 'comment',
              data: this.comment,
            })
            this.finish()
            return
          }
          if (c === 45) {
            this.i++
            this.state = S.CommentEnd
            continue
          }
          this.comment += '-'
          this.state = S.Comment
          continue
        case 32:
          if (eof) {
            this.emit({
              type: 'comment',
              data: this.comment,
            })
            this.finish()
            return
          }
          if (c === 62) {
            this.i++
            this.emit({
              type: 'comment',
              data: this.comment,
            })
            this.state = S.Data
            continue
          }
          if (c === 33) {
            this.i++
            this.state = S.CommentEndBang
            continue
          }
          if (c === 45) {
            this.i++
            this.comment += '-'
            continue
          }
          this.comment += '--'
          this.state = S.Comment
          continue
        case 33:
          if (eof) {
            this.emit({
              type: 'comment',
              data: this.comment,
            })
            this.finish()
            return
          }
          if (c === 45) {
            this.i++
            this.comment += '--!'
            this.state = S.CommentEndDash
            continue
          }
          if (c === 62) {
            this.i++
            this.emit({
              type: 'comment',
              data: this.comment,
            })
            this.state = S.Data
            continue
          }
          this.comment += '--!'
          this.state = S.Comment
          continue
        case 34:
          if (eof) {
            this.emitDoctype(true)
            this.finish()
            return
          }
          if (isWs(c)) {
            this.i++
            this.state = S.BeforeDoctypeName
          } else {
            this.state = S.BeforeDoctypeName
            continue
          }
          continue
        case 35:
          if (eof) {
            this.dn = null
            this.dquirks = true
            this.emitDoctype(true)
            this.finish()
            return
          }
          if (isWs(c)) {
            this.i++
            continue
          }
          this.i++
          if (c === 62) {
            this.dn = null
            this.dquirks = true
            this.emitDoctype(true)
            this.state = S.Data
            continue
          }
          this.dn = c === 0 ? REPLACEMENT : String.fromCharCode(toLowerCh(c))
          this.dpub = this.dsys = null
          this.dquirks = false
          this.state = S.DoctypeName
          continue
        case 36:
          if (eof) {
            this.dquirks = true
            this.emitDoctype(true)
            this.finish()
            return
          }
          this.i++
          if (isWs(c)) this.state = S.AfterDoctypeName
          else if (c === 62) {
            this.state = S.Data
            this.emitDoctype(false)
          } else
            this.dn += c === 0 ? REPLACEMENT : String.fromCharCode(toLowerCh(c))
          continue
        case 37:
          if (eof) {
            this.dquirks = true
            this.emitDoctype(true)
            this.finish()
            return
          }
          if (isWs(c)) {
            this.i++
            continue
          }
          if (c === 62) {
            this.i++
            this.state = S.Data
            this.emitDoctype(false)
            continue
          }
          if (/^public/i.test(this.input.substr(this.i, 6))) {
            this.i += 6
            this.state = S.AfterDoctypePublicKw
          } else if (/^system/i.test(this.input.substr(this.i, 6))) {
            this.i += 6
            this.state = S.AfterDoctypeSystemKw
          } else {
            this.dquirks = true
            this.state = S.BogusDoctype
          }
          continue
        case 38:
        case 39:
          if (eof) {
            this.dquirks = true
            this.emitDoctype(true)
            this.finish()
            return
          }
          if (isWs(c)) {
            this.i++
            if (this.state === S.AfterDoctypePublicKw)
              this.state = S.BeforeDoctypePublicId
            continue
          }
          this.i++
          if (c === 34) {
            this.dpub = ''
            this.state = S.DoctypePublicIdDq
          } else if (c === 39) {
            this.dpub = ''
            this.state = S.DoctypePublicIdSq
          } else if (c === 62) {
            this.dquirks = true
            this.state = S.Data
            this.emitDoctype(true)
          } else {
            this.dquirks = true
            this.state = S.BogusDoctype
          }
          continue
        case 40:
        case 41: {
          const q = this.state === S.DoctypePublicIdDq ? 34 : 39
          if (eof) {
            this.dquirks = true
            this.emitDoctype(true)
            this.finish()
            return
          }
          this.i++
          if (c === q) this.state = S.AfterDoctypePublicId
          else if (c === 62) {
            this.dquirks = true
            this.state = S.Data
            this.emitDoctype(true)
          } else
            this.dpub =
              this.dpub + (c === 0 ? REPLACEMENT : this.input[this.i - 1])
          continue
        }
        case 42:
        case 43:
          if (eof) {
            this.dquirks = true
            this.emitDoctype(true)
            this.finish()
            return
          }
          if (isWs(c)) {
            this.i++
            if (this.state === S.AfterDoctypePublicId)
              this.state = S.BetweenDoctypePublicSystem
            continue
          }
          this.i++
          if (c === 62) {
            this.state = S.Data
            this.emitDoctype(false)
          } else if (c === 34) {
            this.dsys = ''
            this.state = S.DoctypeSystemIdDq
          } else if (c === 39) {
            this.dsys = ''
            this.state = S.DoctypeSystemIdSq
          } else {
            this.dquirks = true
            this.state = S.BogusDoctype
          }
          continue
        case 44:
        case 45:
          if (eof) {
            this.dquirks = true
            this.emitDoctype(true)
            this.finish()
            return
          }
          if (isWs(c)) {
            this.i++
            if (this.state === S.AfterDoctypeSystemKw)
              this.state = S.BeforeDoctypeSystemId
            continue
          }
          this.i++
          if (c === 34) {
            this.dsys = ''
            this.state = S.DoctypeSystemIdDq
          } else if (c === 39) {
            this.dsys = ''
            this.state = S.DoctypeSystemIdSq
          } else if (c === 62) {
            this.dquirks = true
            this.state = S.Data
            this.emitDoctype(true)
          } else {
            this.dquirks = true
            this.state = S.BogusDoctype
          }
          continue
        case 46:
        case 47: {
          const q = this.state === S.DoctypeSystemIdDq ? 34 : 39
          if (eof) {
            this.dquirks = true
            this.emitDoctype(true)
            this.finish()
            return
          }
          this.i++
          if (c === q) this.state = S.AfterDoctypeSystemId
          else if (c === 62) {
            this.dquirks = true
            this.state = S.Data
            this.emitDoctype(true)
          } else
            this.dsys =
              this.dsys + (c === 0 ? REPLACEMENT : this.input[this.i - 1])
          continue
        }
        case 48:
          if (eof) {
            this.dquirks = true
            this.emitDoctype(true)
            this.finish()
            return
          }
          if (isWs(c)) {
            this.i++
            continue
          }
          this.i++
          if (c === 62) {
            this.state = S.Data
            this.emitDoctype(false)
          } else this.state = S.BogusDoctype
          continue
        case 49:
          if (eof) {
            this.emitDoctype(this.dquirks)
            this.finish()
            return
          }
          this.i++
          if (c === 62) {
            this.state = S.Data
            this.emitDoctype(this.dquirks)
          }
          continue
        case 50:
          if (eof) {
            this.finish()
            return
          }
          this.i++
          if (c === 93) this.state = S.CdataSectionBracket
          else this.emitChar(this.input[this.i - 1])
          continue
        case 51:
          if (!eof && c === 93) {
            this.i++
            this.state = S.CdataSectionEnd
          } else {
            this.emitChar(']')
            this.state = S.CdataSection
            continue
          }
          continue
        case 52:
          if (!eof && c === 93) {
            this.i++
            this.emitChar(']')
            continue
          }
          if (!eof && c === 62) {
            this.i++
            this.state = S.Data
            continue
          }
          this.emitChar(']]')
          this.state = S.CdataSection
          continue
        case 53:
          this.tempBuf = '&'
          if (!eof && isAsciiAlnum(c)) {
            this.state = S.NamedCharRef
            continue
          }
          if (!eof && c === 35) {
            let j = this.i + 1,
              code = 0,
              hex = false
            if (j < this.len) {
              const x = input.charCodeAt(j)
              if (x === 120 || x === 88) {
                hex = true
                j++
              }
            }
            const d0 = j
            if (hex)
              for (; j < len; j++) {
                const d = input.charCodeAt(j)
                if (d >= 48 && d <= 57) code = code * 16 + (d - 48)
                else if ((d | 32) >= 97 && (d | 32) <= 102)
                  code = code * 16 + ((d | 32) - 97 + 10)
                else break
              }
            else
              for (; j < len; j++) {
                const d = input.charCodeAt(j)
                if (d >= 48 && d <= 57) code = code * 10 + (d - 48)
                else break
              }
            if (j > d0) {
              if (j < len && input.charCodeAt(j) === 59) j++
              this.i = j
              this.charRefCode = code
              this.state = S.NumericEnd
              continue
            }
            this.i++
            this.tempBuf += '#'
            this.state = S.NumericCharRef
            continue
          }
          this.flushTempToCharRefTarget()
          this.state = this.returnState
          continue
        case 54:
          this.namedCharRefState()
          continue
        case 55:
          if (!eof && isAsciiAlnum(c)) {
            this.i++
            this.appendCharRef(this.input[this.i - 1])
            continue
          }
          this.state = this.returnState
          continue
        case 56:
          this.charRefCode = 0
          if (!eof && (c === 120 || c === 88)) {
            this.i++
            this.tempBuf += this.input[this.i - 1]
            this.state = S.HexStart
          } else this.state = S.DecStart
          continue
        case 57:
          /* v8 ignore next */
          if (!eof && isHexDigit(c)) {
            this.state = S.HexRef
            continue
          }
          this.flushTempToCharRefTarget()
          this.state = this.returnState
          continue
        case 58:
          /* v8 ignore next */
          if (!eof && c >= 48 && c <= 57) {
            this.state = S.DecRef
            continue
          }
          this.flushTempToCharRefTarget()
          this.state = this.returnState
          continue
        /* v8 ignore start -- unreachable: see HexStart */
        case 59:
          if (!eof && isHexDigit(c)) {
            this.i++
            const d = c <= 57 ? c - 48 : toLowerCh(c) - 97 + 10
            this.charRefCode = this.charRefCode * 16 + d
            continue
          }
          if (!eof && c === 59) this.i++
          this.state = S.NumericEnd
          continue
        case 60:
          if (!eof && c >= 48 && c <= 57) {
            this.i++
            this.charRefCode = this.charRefCode * 10 + (c - 48)
            continue
          }
          if (!eof && c === 59) this.i++
          this.state = S.NumericEnd
          continue
        /* v8 ignore stop */
        case 61: {
          let code = this.charRefCode
          if (code === 0 || code > 1114111 || (code >= 55296 && code <= 57343))
            code = 65533
          else if (C1[code] !== void 0) code = C1[code]
          this.appendCharRef(String.fromCodePoint(code))
          this.state = this.returnState
          continue
        }
        /* v8 ignore next 2 -- unreachable: every state id 0..75 has a case above */
        default:
          this.finish()
          return
      }
    }
  }
  endTagNameState(c, eof, rawState) {
    if (!eof) {
      if (isWs(c) && this.appropriateEndTag()) {
        this.i++
        this.state = S.BeforeAttrName
        return true
      }
      if (c === 47 && this.appropriateEndTag()) {
        this.i++
        this.state = S.SelfClosing
        return true
      }
      if (c === 62 && this.appropriateEndTag()) {
        this.i++
        this.state = S.Data
        this.emitTag()
        return true
      }
      if (isAsciiAlpha(c)) {
        this.i++
        this.tagName += String.fromCharCode(toLowerCh(c))
        this.tempBuf += this.input[this.i - 1]
        return true
      }
    }
    this.emitChar('</' + this.tempBuf)
    this.state = rawState
    return true
  }
  emitDoctype(forceQuirks) {
    this.emit({
      type: 'doctype',
      name: this.dn,
      publicId: this.dpub,
      systemId: this.dsys,
      forceQuirks,
    })
    this.dn = this.dpub = this.dsys = null
    this.dquirks = false
  }
  appendCharRef(s) {
    if (
      this.returnState === S.AttrValueDq ||
      this.returnState === S.AttrValueSq ||
      this.returnState === S.AttrValueUq
    )
      this.attrValue += s
    else this.emitChar(s)
  }
  flushTempToCharRefTarget() {
    this.appendCharRef(this.tempBuf)
  }
  inAttr() {
    return (
      this.returnState === S.AttrValueDq ||
      this.returnState === S.AttrValueSq ||
      this.returnState === S.AttrValueUq
    )
  }
  namedCharRefState() {
    const input = this.input,
      len = this.len,
      start = this.i
    {
      let j = start,
        h = -2128831035
      const lim = Math.min(len, start + 32)
      while (j < lim) {
        const cc = input.charCodeAt(j)
        if (!isAsciiAlnum(cc)) break
        h = Math.imul(h ^ cc, FNV)
        j++
      }
      if (j < len && input.charCodeAt(j) === 59) {
        h = Math.imul(h ^ 59, FNV)
        const n = j + 1 - start
        for (let slot = h & REF_MASK; ; slot = (slot + 1) & REF_MASK) {
          const key = REF_KEYS[slot]
          if (key.length === 0) break
          if (key.length === n) {
            let k = 0
            while (k < n && input.charCodeAt(start + k) === key.charCodeAt(k))
              k++
            if (k === n) {
              this.appendCharRef(REF_VALS[slot])
              this.i = j + 1
              this.state = this.returnState
              return true
            }
          }
        }
      }
    }
    let matchLen = 0,
      matchValue = ''
    let node = ENTITY_TRIE
    for (let k = 0; k < 32 && start + k < len; k++) {
      const cc = input.charCodeAt(start + k)
      if (!isAsciiAlnum(cc) && cc !== 59) break
      const child = node.next.get(cc)
      if (child === void 0) break
      node = child
      if (child.v !== void 0) {
        matchValue = child.v
        matchLen = k + 1
      }
      /* v8 ignore next -- a ';' child means run+';' is a key, which the fast path above already resolved */
      if (cc === 59) break
    }
    if (matchLen > 0) {
      const endsWithSemi = input.charCodeAt(start + matchLen - 1) === 59
      const nextCh =
        start + matchLen < len ? input.charCodeAt(start + matchLen) : -1
      if (
        this.inAttr() &&
        !endsWithSemi &&
        (nextCh === 61 || isAsciiAlnum(nextCh))
      ) {
        this.appendCharRef('&' + input.slice(start, start + matchLen))
        this.i += matchLen
        this.state = this.returnState
        return true
      }
      this.appendCharRef(matchValue)
      this.i += matchLen
      this.state = this.returnState
      return true
    }
    this.appendCharRef('&')
    this.state = S.AmbiguousAmp
    return true
  }
}
/**
 * WHATWG HTML tree construction — `.` main engine.
 *
 * Consumes the `Tokenizer` token stream (pull-based, driving its content-model
 * state) and builds a DOM-like tree per
 * https://html.spec.whatwg.org/#tree-construction. Verified against the
 * vendored html5lib-tests tree-construction `.dat` suite
 * (test/main/tree-construction.test.ts), ratcheted.
 *
 * Coverage is built up incrementally (climbing the ratchet): the common
 * document modes (initial → in head → in body → text → after body), generic
 * element insertion, implied end tags, RAWTEXT/RCDATA/script text, and
 * active-formatting reconstruction are here. Table/select/template modes, full
 * foreign content, and the adoption agency algorithm are layered in over
 * subsequent passes (tracked by the ratchet baseline).
 */
const VOID = /* @__PURE__ */ new Set([
  'area',
  'base',
  'basefont',
  'bgsound',
  'br',
  'col',
  'embed',
  'frame',
  'hr',
  'img',
  'input',
  'keygen',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
])
const RAWTEXT = /* @__PURE__ */ new Set([
  'style',
  'xmp',
  'iframe',
  'noembed',
  'noframes',
])
/**
 * How far back `pushAfe`'s Noah's Ark scan looks (DoS bound, see pushAfe).
 */
const NOAHS_ARK_SCAN_MAX = 128
const HEAD_TAGS = /* @__PURE__ */ new Set([
  'base',
  'basefont',
  'bgsound',
  'link',
  'meta',
  'title',
  'noframes',
  'style',
  'script',
  'template',
  'head',
  'noscript',
])
const IMPLIED_END = /* @__PURE__ */ new Set([
  'dd',
  'dt',
  'li',
  'optgroup',
  'option',
  'p',
  'rb',
  'rp',
  'rt',
  'rtc',
])
const HEADINGS = /* @__PURE__ */ new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
const FORMATTING = /* @__PURE__ */ new Set([
  'a',
  'b',
  'big',
  'code',
  'em',
  'font',
  'i',
  'nobr',
  's',
  'small',
  'strike',
  'strong',
  'tt',
  'u',
])
const CLOSE_BLOCK = /* @__PURE__ */ new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'button',
  'center',
  'details',
  'dialog',
  'dir',
  'div',
  'dl',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'header',
  'hgroup',
  'listing',
  'main',
  'menu',
  'nav',
  'ol',
  'pre',
  'section',
  'summary',
  'ul',
])
const START_BLOCK = /* @__PURE__ */ new Set([
  'p',
  'div',
  'section',
  'article',
  'aside',
  'blockquote',
  'center',
  'details',
  'dialog',
  'dir',
  'dl',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'header',
  'hgroup',
  'main',
  'menu',
  'nav',
  'ol',
  'ul',
  'summary',
  'address',
  'pre',
  'listing',
])
const SPECIAL = /* @__PURE__ */ new Set([
  'address',
  'applet',
  'area',
  'article',
  'aside',
  'base',
  'basefont',
  'bgsound',
  'blockquote',
  'body',
  'br',
  'button',
  'caption',
  'center',
  'col',
  'colgroup',
  'dd',
  'details',
  'dir',
  'div',
  'dl',
  'dt',
  'embed',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'frame',
  'frameset',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'head',
  'header',
  'hgroup',
  'hr',
  'html',
  'iframe',
  'img',
  'input',
  'li',
  'link',
  'listing',
  'main',
  'marquee',
  'menu',
  'meta',
  'nav',
  'noembed',
  'noframes',
  'noscript',
  'object',
  'ol',
  'p',
  'param',
  'plaintext',
  'pre',
  'script',
  'section',
  'select',
  'source',
  'style',
  'summary',
  'table',
  'tbody',
  'td',
  'template',
  'textarea',
  'tfoot',
  'th',
  'thead',
  'title',
  'tr',
  'ul',
  'wbr',
  'xmp',
])
const TABLE_CONTEXT = /* @__PURE__ */ new Set([
  'table',
  'tbody',
  'tfoot',
  'thead',
  'tr',
])
const TABLE_ROOT_CTX = /* @__PURE__ */ new Set(['table', 'template', 'html'])
const TABLE_BODY_CTX = /* @__PURE__ */ new Set([
  'tbody',
  'tfoot',
  'thead',
  'template',
  'html',
])
const TABLE_ROW_CTX = /* @__PURE__ */ new Set(['tr', 'template', 'html'])
const CELL_OR_CAPTION_START = /* @__PURE__ */ new Set([
  'caption',
  'col',
  'colgroup',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
])
const INTABLE_IGNORED_END = /* @__PURE__ */ new Set([
  'body',
  'caption',
  'col',
  'colgroup',
  'html',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
])
const INCAPTION_IGNORED_END = /* @__PURE__ */ new Set([
  'body',
  'col',
  'colgroup',
  'html',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
])
const INTABLEBODY_SCOPE_START = /* @__PURE__ */ new Set([
  'caption',
  'col',
  'colgroup',
  'tbody',
  'tfoot',
  'thead',
])
const INTABLEBODY_IGNORED_END = /* @__PURE__ */ new Set([
  'body',
  'caption',
  'col',
  'colgroup',
  'html',
  'td',
  'th',
  'tr',
])
const INROW_SCOPE_START = /* @__PURE__ */ new Set([
  'caption',
  'col',
  'colgroup',
  'tbody',
  'tfoot',
  'thead',
  'tr',
])
const INROW_IGNORED_END = /* @__PURE__ */ new Set([
  'body',
  'caption',
  'col',
  'colgroup',
  'html',
  'td',
  'th',
])
const INCELL_IGNORED_END = /* @__PURE__ */ new Set([
  'body',
  'caption',
  'col',
  'colgroup',
  'html',
])
const INCELL_TABLE_END = /* @__PURE__ */ new Set([
  'table',
  'tbody',
  'tfoot',
  'thead',
  'tr',
])
const FOREIGN_BREAKOUT = /* @__PURE__ */ new Set([
  'b',
  'big',
  'blockquote',
  'body',
  'br',
  'center',
  'code',
  'dd',
  'div',
  'dl',
  'dt',
  'em',
  'embed',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'head',
  'hr',
  'i',
  'img',
  'li',
  'listing',
  'menu',
  'meta',
  'nobr',
  'ol',
  'p',
  'pre',
  'ruby',
  's',
  'small',
  'span',
  'strong',
  'strike',
  'sub',
  'sup',
  'table',
  'tt',
  'u',
  'ul',
  'var',
])
const SVG_TAG_NAMES = new Map(
  Object.entries({
    altglyph: 'altGlyph',
    altglyphdef: 'altGlyphDef',
    altglyphitem: 'altGlyphItem',
    animatecolor: 'animateColor',
    animatemotion: 'animateMotion',
    animatetransform: 'animateTransform',
    clippath: 'clipPath',
    feblend: 'feBlend',
    fecolormatrix: 'feColorMatrix',
    fecomponenttransfer: 'feComponentTransfer',
    fecomposite: 'feComposite',
    feconvolvematrix: 'feConvolveMatrix',
    fediffuselighting: 'feDiffuseLighting',
    fedisplacementmap: 'feDisplacementMap',
    fedistantlight: 'feDistantLight',
    fedropshadow: 'feDropShadow',
    feflood: 'feFlood',
    fefunca: 'feFuncA',
    fefuncb: 'feFuncB',
    fefuncg: 'feFuncG',
    fefuncr: 'feFuncR',
    fegaussianblur: 'feGaussianBlur',
    feimage: 'feImage',
    femerge: 'feMerge',
    femergenode: 'feMergeNode',
    femorphology: 'feMorphology',
    feoffset: 'feOffset',
    fepointlight: 'fePointLight',
    fespecularlighting: 'feSpecularLighting',
    fespotlight: 'feSpotLight',
    fetile: 'feTile',
    feturbulence: 'feTurbulence',
    foreignobject: 'foreignObject',
    glyphref: 'glyphRef',
    lineargradient: 'linearGradient',
    radialgradient: 'radialGradient',
    textpath: 'textPath',
  }),
)
const SVG_ATTR = new Map(
  Object.entries({
    attributename: 'attributeName',
    attributetype: 'attributeType',
    basefrequency: 'baseFrequency',
    baseprofile: 'baseProfile',
    calcmode: 'calcMode',
    clippathunits: 'clipPathUnits',
    diffuseconstant: 'diffuseConstant',
    edgemode: 'edgeMode',
    filterunits: 'filterUnits',
    glyphref: 'glyphRef',
    gradienttransform: 'gradientTransform',
    gradientunits: 'gradientUnits',
    kernelmatrix: 'kernelMatrix',
    kernelunitlength: 'kernelUnitLength',
    keypoints: 'keyPoints',
    keysplines: 'keySplines',
    keytimes: 'keyTimes',
    lengthadjust: 'lengthAdjust',
    limitingconeangle: 'limitingConeAngle',
    markerheight: 'markerHeight',
    markerunits: 'markerUnits',
    markerwidth: 'markerWidth',
    maskcontentunits: 'maskContentUnits',
    maskunits: 'maskUnits',
    numoctaves: 'numOctaves',
    pathlength: 'pathLength',
    patterncontentunits: 'patternContentUnits',
    patterntransform: 'patternTransform',
    patternunits: 'patternUnits',
    pointsatx: 'pointsAtX',
    pointsaty: 'pointsAtY',
    pointsatz: 'pointsAtZ',
    preservealpha: 'preserveAlpha',
    preserveaspectratio: 'preserveAspectRatio',
    primitiveunits: 'primitiveUnits',
    refx: 'refX',
    refy: 'refY',
    repeatcount: 'repeatCount',
    repeatdur: 'repeatDur',
    requiredextensions: 'requiredExtensions',
    requiredfeatures: 'requiredFeatures',
    specularconstant: 'specularConstant',
    specularexponent: 'specularExponent',
    spreadmethod: 'spreadMethod',
    startoffset: 'startOffset',
    stddeviation: 'stdDeviation',
    stitchtiles: 'stitchTiles',
    surfacescale: 'surfaceScale',
    systemlanguage: 'systemLanguage',
    tablevalues: 'tableValues',
    targetx: 'targetX',
    targety: 'targetY',
    textlength: 'textLength',
    viewbox: 'viewBox',
    viewtarget: 'viewTarget',
    xchannelselector: 'xChannelSelector',
    ychannelselector: 'yChannelSelector',
    zoomandpan: 'zoomAndPan',
  }),
)
const FOREIGN_ATTR = new Map(
  Object.entries({
    'xlink:actuate': 'xlink actuate',
    'xlink:arcrole': 'xlink arcrole',
    'xlink:href': 'xlink href',
    'xlink:role': 'xlink role',
    'xlink:show': 'xlink show',
    'xlink:title': 'xlink title',
    'xlink:type': 'xlink type',
    'xml:lang': 'xml lang',
    'xml:space': 'xml space',
    'xmlns:xlink': 'xmlns xlink',
  }),
)
const IB_START_CAT = /* @__PURE__ */ (() => {
  const m = /* @__PURE__ */ new Map()
  const add = (names, cat) => {
    for (const x of names) if (!m.has(x)) m.set(x, cat)
  }
  add(['html'], 1)
  add(
    [...HEAD_TAGS].filter(x => x !== 'head' && x !== 'noscript'),
    2,
  )
  add(['body'], 3)
  add(['frameset'], 4)
  add(START_BLOCK, 5)
  add(HEADINGS, 6)
  add(['li', 'dd', 'dt'], 7)
  add(FORMATTING, 8)
  add(['hr'], 9)
  add(['param', 'source', 'track'], 10)
  add(['form'], 11)
  add(['br', ...VOID], 12)
  add(RAWTEXT, 13)
  add(['textarea'], 14)
  add(['plaintext'], 15)
  add(['button'], 16)
  add(['table'], 17)
  add(['select'], 18)
  add(['optgroup', 'option'], 19)
  add(
    [
      'caption',
      'col',
      'colgroup',
      'tbody',
      'td',
      'tfoot',
      'th',
      'thead',
      'tr',
      'frame',
      'head',
    ],
    20,
  )
  add(['image'], 21)
  add(['rb', 'rtc'], 22)
  add(['rp', 'rt'], 23)
  add(['svg'], 24)
  add(['math'], 25)
  add(['applet', 'marquee', 'object'], 26)
  return m
})()
/**
 * Index of `x` in `arr`, where `x` occurs at most once (tree nodes in a
 * children array, elements on the open stack / active-formatting list). Checks
 * the last 16 slots back-to-front first (where the parser's lookups almost
 * always hit), then falls back to indexOf for the rest: V8's indexOf is a SIMD
 * scan (~0.15 ns/elem) while Array.prototype.lastIndexOf is a generic builtin
 * (~1 ns/elem), so a plain lastIndexOf made full "absent" scans ~7x slower on
 * deep stacks.
 */
function lastIdx(arr, x) {
  const n = arr.length,
    stop = n > 16 ? n - 16 : 0
  for (let i = n - 1; i >= stop; i--) if (arr[i] === x) return i
  return stop === 0 ? -1 : arr.indexOf(x)
}
/**
 * Open-stack depth above which scope scans consult the lazy name counts.
 */
const DEEP_STACK = 128
function isAllWs(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c !== 32 && c !== 9 && c !== 10 && c !== 12) return false
  }
  return true
}
/**
 * Elements whose presence on the open stack blocks streaming (see
 * streamBlockers).
 */
function isStreamBlocker(name) {
  return name === 'table' || name === 'template' || name === 'form'
}
var TreeBuilder = class {
  constructor(html) {
    this.document = {
      type: 'document',
      children: [],
    }
    this.open = []
    this.afe = []
    this.mode = 'initial'
    this.originalMode = 'initial'
    this.head = null
    this.framesetOk = true
    this.fosterParenting = false
    this.sawForeign = false
    this.templateModes = []
    this.ignoreNextLF = false
    this.formElement = null
    this.pendingTableText = ''
    this.bodyEl = null
    this.onPop = null
    this.streamWatch = null
    this.streamEvery = 1
    this.popCount = 0
    this.streamBlockers = 0
    this.pendingTableNonWs = false
    this.pOpen = 0
    this.nameCount = null
    this.inScopeNames = /* @__PURE__ */ new Set([
      'applet',
      'caption',
      'html',
      'table',
      'td',
      'th',
      'marquee',
      'object',
      'template',
    ])
    this.tk = new Tokenizer(html, { state: 'data' })
  }
  /**
   * The stack of open elements (read-only view for the streaming hook).
   */
  get openElements() {
    return this.open
  }
  /**
   * The <body> element, once inserted.
   */
  get body() {
    return this.bodyEl
  }
  /**
   * True when every future tree change to an entered (non-formatting) open
   * element is an append at its end (see `onPop`): body can no longer be
   * replaced by <frameset>, and no table (content is foster-parented in FRONT
   * of it), template (redirects insertion) or form (`</form>` can remove it
   * mid-stack) is open.
   */
  streamSafe() {
    return !this.framesetOk && this.streamBlockers === 0
  }
  /**
   * Whether streaming may enter `el` as a container (see `onPop`): not an HTML
   * formatting element, whose subtree the adoption agency can rearrange later.
   */
  streamEnterable(el) {
    return el.namespace !== 'html' || !FORMATTING.has(el.name)
  }
  /**
   * Parse to completion and return the document tree.
   */
  parse() {
    let t
    let lastTop
    while ((t = this.tk.nextToken()) !== null) {
      this.process(t)
      if (this.sawForeign) {
        const acn = this.open[this.open.length - 1]
        if (acn !== lastTop) {
          lastTop = acn
          this.tk.setForeignContent(acn !== void 0 && acn.namespace !== 'html')
        }
      }
    }
    return this.document
  }
  current() {
    return this.open.length ? this.open[this.open.length - 1] : this.document
  }
  append(parent, node) {
    node.parent = parent
    const k = parent.children
    if (k.length === 0) parent.children = [node]
    else k.push(node)
  }
  /**
   * The "appropriate place for inserting a node" — implements foster parenting:
   * when enabled and the current node is a table context, content is inserted
   * before the table rather than inside it (what the browser does).
   */
  appropriatePlace() {
    const cur = this.current()
    if (
      this.fosterParenting &&
      cur.type === 'element' &&
      TABLE_CONTEXT.has(cur.name)
    ) {
      let lastTable = null,
        lastTableIdx = -1
      for (let i = this.open.length - 1; i >= 0; i--)
        if (this.open[i].name === 'table') {
          lastTable = this.open[i]
          lastTableIdx = i
          break
        }
      /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
      if (!lastTable)
        return {
          parent: this.open[0] ?? this.document,
          before: null,
        }
      /* v8 ignore stop */
      if (lastTable.parent)
        return {
          parent: lastTable.parent,
          before: lastTable,
        }
      /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
      return {
        parent: this.open[lastTableIdx - 1],
        before: null,
      }
    }
    return {
      parent: cur,
      before: null,
    }
  }
  insertAt(place, node) {
    node.parent = place.parent
    if (place.before) {
      const idx = lastIdx(place.parent.children, place.before)
      /* v8 ignore start -- defensive fallback for an impossible state (ref always found / current is an element / stack non-empty) */
      place.parent.children.splice(
        idx < 0 ? place.parent.children.length : idx,
        0,
        node,
      )
    } else place.parent.children.push(node)
  }
  insertElement(token, ns = 'html') {
    const el = {
      type: 'element',
      name: token.name,
      namespace: ns,
      attrs: token.attrs,
      children: [],
      parent: null,
    }
    if (this.fosterParenting) this.insertAt(this.appropriatePlace(), el)
    else {
      const parent = this.current()
      el.parent = parent
      const k = parent.children
      if (k.length === 0) parent.children = [el]
      else k.push(el)
    }
    this.pushEl(el)
    if (ns === 'html' && el.name === 'p') this.pOpen++
    return el
  }
  /**
   * Pop the open-stack top, keeping `pOpen` exact. All `this.open.pop()` sites
   * route here so a popped `<p>` decrements the counter.
   */
  popEl() {
    const el = this.open.pop()
    if (el !== void 0) {
      if (el.name === 'p' && el.namespace === 'html') this.pOpen--
      const nc = this.nameCount
      if (nc !== null) nc.set(el.name, nc.get(el.name) - 1)
      if (isStreamBlocker(el.name)) this.streamBlockers--
      if (
        this.onPop !== null &&
        (el === this.streamWatch || ++this.popCount >= this.streamEvery)
      ) {
        this.popCount = 0
        this.onPop(el)
      }
    }
    return el
  }
  /**
   * Remove open[i] (a mid-stack removal), keeping pOpen / nameCount exact.
   */
  removeOpenAt(i) {
    const el = this.open[i]
    this.open.splice(i, 1)
    if (isStreamBlocker(el.name)) this.streamBlockers--
    if (el.name === 'p' && el.namespace === 'html') this.pOpen--
    const nc = this.nameCount
    if (nc !== null) nc.set(el.name, nc.get(el.name) - 1)
  }
  countUp(name) {
    const nc = this.nameCount
    if (nc !== null) nc.set(name, (nc.get(name) ?? 0) + 1)
  }
  pushEl(el) {
    this.open.push(el)
    if (isStreamBlocker(el.name)) this.streamBlockers++
    if (this.nameCount !== null) this.countUp(el.name)
  }
  /**
   * Index of `el` on the open stack, or -1. On a deep stack an element whose
   * NAME is not open at all is answered from the counts without scanning (e.g.
   * an already-closed <a> still in the active-formatting list — `<a><p></a>`
   * repeated under deep nesting was O(depth) per tag).
   */
  openIdx(el) {
    const open = this.open,
      n = open.length,
      stop = n > 16 ? n - 16 : 0
    for (let i = n - 1; i >= stop; i--) if (open[i] === el) return i
    if (stop === 0 || !this.mayBeOpen(el.name)) return -1
    return open.indexOf(el)
  }
  /**
   * False only when NO open element is named `name` (so a name scan must fail).
   */
  mayBeOpen(name) {
    if (this.open.length <= DEEP_STACK) return true
    let nc = this.nameCount
    if (nc === null) {
      nc = this.nameCount = /* @__PURE__ */ new Map()
      for (let i = 0; i < this.open.length; i++) {
        const k = this.open[i].name
        nc.set(k, (nc.get(k) ?? 0) + 1)
      }
    }
    return nc.get(name) > 0
  }
  insertText(data) {
    if (!this.fosterParenting) {
      const parent = this.current()
      const siblings = parent.children
      const n = siblings.length
      if (n === 0) {
        parent.children = [
          {
            type: 'text',
            value: data,
            parent,
          },
        ]
        return
      }
      const prev = siblings[n - 1]
      if (prev.type === 'text') {
        prev.value += data
        return
      }
      siblings.push({
        type: 'text',
        value: data,
        parent,
      })
      return
    }
    const place = this.appropriatePlace()
    const siblings = place.parent.children
    const refIdx = place.before
      ? lastIdx(siblings, place.before)
      : siblings.length
    const prev = siblings[refIdx - 1]
    if (prev && prev.type === 'text') {
      prev.value += data
      return
    }
    const node = {
      type: 'text',
      value: data,
      parent: place.parent,
    }
    siblings.splice(refIdx, 0, node)
  }
  insertComment(data, parent = this.current()) {
    this.append(parent, {
      type: 'comment',
      value: data,
      parent: null,
    })
  }
  popUntil(name) {
    while (this.open.length) if (this.popEl().name === name) break
  }
  /**
   * A "scope" boundary element: the HTML markers PLUS the foreign integration
   * points (MathML mi/mo/mn/ms/mtext/annotation-xml, SVG
   * foreignObject/desc/title). Omitting the foreign ones made scope checks see
   * through e.g. <mi> to an outer <p>, mis-closing it. Checked by namespace so
   * an HTML <title> isn't a marker.
   */
  isScopeMarker(el) {
    if (el.namespace === 'html') return this.inScopeNames.has(el.name)
    if (el.namespace === 'mathml')
      return (
        el.name === 'mi' ||
        el.name === 'mo' ||
        el.name === 'mn' ||
        el.name === 'ms' ||
        el.name === 'mtext' ||
        el.name === 'annotation-xml'
      )
    return (
      el.name === 'foreignObject' || el.name === 'desc' || el.name === 'title'
    )
  }
  hasInScope(target) {
    if (!this.mayBeOpen(target)) return false
    for (let i = this.open.length - 1; i >= 0; i--) {
      const el = this.open[i]
      if (el.name === target && el.namespace === 'html') return true
      if (this.isScopeMarker(el)) return false
    }
    /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
    return false
    /* v8 ignore stop */
  }
  generateImpliedEndTags(except) {
    while (this.open.length) {
      const c = this.open[this.open.length - 1]
      if (c.name !== except && IMPLIED_END.has(c.name)) this.popEl()
      else break
    }
  }
  /**
   * "in button scope" — like in-scope, but `button` is also a boundary.
   */
  hasInButtonScope(target) {
    if (target === 'p' && this.pOpen === 0) return false
    for (let i = this.open.length - 1; i >= 0; i--) {
      const el = this.open[i]
      if (el.name === target && el.namespace === 'html') return true
      if (
        (el.name === 'button' && el.namespace === 'html') ||
        this.isScopeMarker(el)
      )
        return false
    }
    /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
    return false
    /* v8 ignore stop */
  }
  closePElement() {
    if (this.hasInButtonScope('p')) {
      this.generateImpliedEndTags('p')
      this.popUntil('p')
    }
  }
  /**
   * Add a formatting element to the active-formatting list, applying the spec's
   * "Noah's Ark" clause: if three elements with the same tag name, namespace
   * and attributes already follow the last marker, drop the EARLIEST such one
   * first.
   *
   * DoS bound (deliberate spec deviation): the scan looks back at most
   * NOAHS_ARK_SCAN_MAX entries. Unbounded, N distinct unclosed formatting
   * elements (`<b id=1><b id=2>…`) cost O(N²): ~2 s for 250 KB. Real documents
   * never have that many open formatting elements; past the bound only which
   * duplicate formatting clones survive can differ, never what the sanitizer
   * lets through.
   */
  pushAfe(el) {
    let count = 0,
      earliest = -1
    const stop = Math.max(0, this.afe.length - NOAHS_ARK_SCAN_MAX)
    for (let i = this.afe.length - 1; i >= stop; i--) {
      const e = this.afe[i]
      if (e === 'marker') break
      if (
        e.name === el.name &&
        e.namespace === el.namespace &&
        sameAttrs(e.attrs, el.attrs)
      ) {
        count++
        earliest = i
      }
    }
    if (count >= 3) this.afe.splice(earliest, 1)
    this.afe.push(el)
  }
  reconstructFormatting() {
    if (this.afe.length === 0) return
    let last = this.afe[this.afe.length - 1]
    if (last === 'marker' || this.openIdx(last) !== -1) return
    let i = this.afe.length - 1
    while (i > 0) {
      const e = this.afe[i - 1]
      if (e === 'marker' || this.openIdx(e) !== -1) break
      i--
    }
    for (; i < this.afe.length; i++) {
      const entry = this.afe[i]
      const el = {
        type: 'element',
        name: entry.name,
        namespace: 'html',
        attrs: entry.attrs.slice(),
        children: [],
        parent: null,
      }
      this.append(this.current(), el)
      this.pushEl(el)
      this.afe[i] = el
    }
  }
  process(t) {
    if (this.ignoreNextLF) {
      this.ignoreNextLF = false
      if (t.type === 'character' && t.data.charCodeAt(0) === 10) {
        if (t.data.length === 1) return
        t = {
          type: 'character',
          data: t.data.slice(1),
        }
      }
    }
    const top =
      this.open.length !== 0 ? this.open[this.open.length - 1] : void 0
    if (top !== void 0 && top.namespace !== 'html' && this.useForeignRules(t))
      this.foreignContent(t)
    else this.dispatchMode(t)
  }
  dispatchMode(t) {
    switch (this.mode) {
      case 'initial':
        return this.mInitial(t)
      case 'beforeHtml':
        return this.mBeforeHtml(t)
      case 'beforeHead':
        return this.mBeforeHead(t)
      case 'inHead':
        return this.mInHead(t)
      case 'afterHead':
        return this.mAfterHead(t)
      case 'inBody':
        return this.mInBody(t)
      case 'text':
        return this.mText(t)
      case 'afterBody':
        return this.mAfterBody(t)
      case 'afterAfterBody':
        return this.mAfterAfterBody(t)
      case 'inTable':
        return this.mInTable(t)
      case 'inTableText':
        return this.mInTableText(t)
      case 'inCaption':
        return this.mInCaption(t)
      case 'inColumnGroup':
        return this.mInColumnGroup(t)
      case 'inTableBody':
        return this.mInTableBody(t)
      case 'inRow':
        return this.mInRow(t)
      case 'inCell':
        return this.mInCell(t)
      case 'inSelect':
        return this.mInSelect(t)
      case 'inSelectInTable':
        return this.mInSelectInTable(t)
      case 'inTemplate':
        return this.mInTemplate(t)
      case 'inHeadNoscript':
        return this.mInHeadNoscript(t)
      case 'inFrameset':
        return this.mInFrameset(t)
      case 'afterFrameset':
        return this.mAfterFrameset(t)
      case 'afterAfterFrameset':
        return this.mAfterAfterFrameset(t)
    }
  }
  isMathmlTextIP(el) {
    return (
      el.namespace === 'mathml' &&
      (el.name === 'mi' ||
        el.name === 'mo' ||
        el.name === 'mn' ||
        el.name === 'ms' ||
        el.name === 'mtext')
    )
  }
  isHtmlIP(el) {
    if (el.namespace === 'mathml' && el.name === 'annotation-xml') {
      const v = el.attrs.find(a => a[0] === 'encoding')?.[1].toLowerCase()
      return v === 'text/html' || v === 'application/xhtml+xml'
    }
    return (
      el.namespace === 'svg' &&
      (el.name === 'foreignObject' || el.name === 'desc' || el.name === 'title')
    )
  }
  useForeignRules(t) {
    if (this.open.length === 0 || t.type === 'eof') return false
    const acn = this.open[this.open.length - 1]
    if (acn.namespace === 'html') return false
    if (this.isMathmlTextIP(acn)) {
      if (t.type === 'character') return false
      if (
        t.type === 'startTag' &&
        t.name !== 'mglyph' &&
        t.name !== 'malignmark'
      )
        return false
    }
    if (
      acn.namespace === 'mathml' &&
      acn.name === 'annotation-xml' &&
      t.type === 'startTag' &&
      t.name === 'svg'
    )
      return false
    if (this.isHtmlIP(acn) && (t.type === 'startTag' || t.type === 'character'))
      return false
    return true
  }
  adjustForeignAttrs(attrs, ns) {
    const seen = /* @__PURE__ */ new Set()
    const out = []
    for (const [name, value] of attrs) {
      let adj = name
      if (ns === 'mathml' && name === 'definitionurl') adj = 'definitionURL'
      else if (ns === 'svg' && SVG_ATTR.has(name)) adj = SVG_ATTR.get(name)
      if (FOREIGN_ATTR.has(adj)) adj = FOREIGN_ATTR.get(adj)
      if (!seen.has(adj)) {
        seen.add(adj)
        out.push([adj, value])
      }
    }
    return out
  }
  insertForeign(t, ns) {
    this.sawForeign = true
    let name = t.name
    if (ns === 'svg' && SVG_TAG_NAMES.has(name)) name = SVG_TAG_NAMES.get(name)
    const el = {
      type: 'element',
      name,
      namespace: ns,
      attrs: this.adjustForeignAttrs(t.attrs, ns),
      children: [],
      parent: null,
    }
    this.insertAt(this.appropriatePlace(), el)
    this.pushEl(el)
    if (t.selfClosing) this.popEl()
  }
  foreignContent(t) {
    if (t.type === 'character') {
      this.insertText(t.data)
      if (this.framesetOk && !isAllWs(t.data)) this.framesetOk = false
      return
    }
    if (t.type === 'comment') {
      this.insertComment(t.data)
      return
    }
    /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
    if (t.type === 'doctype') return
    /* v8 ignore stop */
    if (t.type === 'startTag') {
      const n = t.name
      if (
        FOREIGN_BREAKOUT.has(n) ||
        (n === 'font' &&
          t.attrs.some(([k]) => k === 'color' || k === 'face' || k === 'size'))
      ) {
        while (this.open.length) {
          const cur = this.open[this.open.length - 1]
          if (
            cur.namespace === 'html' ||
            this.isMathmlTextIP(cur) ||
            this.isHtmlIP(cur)
          )
            break
          this.popEl()
        }
        this.dispatchMode(t)
        return
      }
      this.insertForeign(t, this.open[this.open.length - 1].namespace)
      return
    }
    if (t.type === 'endTag') {
      const camel = SVG_TAG_NAMES.get(t.name)
      if (
        !this.mayBeOpen(t.name) &&
        (camel === void 0 || !this.mayBeOpen(camel))
      ) {
        this.dispatchMode(t)
        return
      }
      for (let i = this.open.length - 1; i >= 0; i--) {
        const node = this.open[i]
        if (
          node.name === t.name ||
          (node.name.length === t.name.length &&
            node.name.toLowerCase() === t.name)
        ) {
          while (this.open.length > i) this.popEl()
          return
        }
        if (node.namespace === 'html') {
          this.dispatchMode(t)
          return
        }
      }
    }
  }
  mInitial(t) {
    if (t.type === 'character' && isAllWs(t.data)) return
    if (t.type === 'comment') {
      this.insertComment(t.data, this.document)
      return
    }
    if (t.type === 'doctype') {
      this.append(this.document, {
        type: 'doctype',
        name: t.name ?? '',
        publicId: t.publicId ?? '',
        systemId: t.systemId ?? '',
        parent: null,
      })
      this.mode = 'beforeHtml'
      return
    }
    this.mode = 'beforeHtml'
    this.process(t)
  }
  mBeforeHtml(t) {
    if (t.type === 'doctype') return
    if (t.type === 'comment') {
      this.insertComment(t.data, this.document)
      return
    }
    if (t.type === 'character' && isAllWs(t.data)) return
    if (t.type === 'startTag' && t.name === 'html') {
      this.insertElement(t)
      this.mode = 'beforeHead'
      return
    }
    this.insertElement({
      type: 'startTag',
      name: 'html',
      attrs: [],
      selfClosing: false,
    })
    this.mode = 'beforeHead'
    this.process(t)
  }
  mBeforeHead(t) {
    if (t.type === 'character' && isAllWs(t.data)) return
    if (t.type === 'comment') {
      this.insertComment(t.data)
      return
    }
    /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
    if (t.type === 'doctype') return
    /* v8 ignore stop */
    /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
    if (t.type === 'startTag' && t.name === 'html') return this.mInBody(t)
    /* v8 ignore stop */
    if (t.type === 'startTag' && t.name === 'head') {
      this.head = this.insertElement(t)
      this.mode = 'inHead'
      return
    }
    if (
      t.type === 'endTag' &&
      t.name !== 'head' &&
      t.name !== 'body' &&
      t.name !== 'html' &&
      t.name !== 'br'
    )
      return
    this.head = this.insertElement({
      type: 'startTag',
      name: 'head',
      attrs: [],
      selfClosing: false,
    })
    this.mode = 'inHead'
    this.process(t)
  }
  mInHead(t) {
    if (t.type === 'character') {
      let i = 0
      const d = t.data
      while (i < d.length) {
        const c = d.charCodeAt(i)
        if (c === 9 || c === 10 || c === 12 || c === 13 || c === 32) i++
        else break
      }
      if (i > 0) this.insertText(d.slice(0, i))
      if (i === d.length) return
      t = {
        type: 'character',
        data: d.slice(i),
      }
    }
    if (t.type === 'comment') {
      this.insertComment(t.data)
      return
    }
    /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
    if (t.type === 'doctype') return
    /* v8 ignore stop */
    if (t.type === 'startTag' && t.name === 'template') {
      this.insertElement(t)
      this.afe.push('marker')
      this.framesetOk = false
      this.templateModes.push('inTemplate')
      this.mode = 'inTemplate'
      return
    }
    if (t.type === 'endTag' && t.name === 'template') {
      if (!this.hasInScope('template')) return
      this.generateImpliedEndTags()
      this.popUntil('template')
      this.clearAfeToMarker()
      this.templateModes.pop()
      this.resetInsertionMode()
      return
    }
    if (t.type === 'startTag') {
      if (t.name === 'html') return this.mInBody(t)
      if (VOID.has(t.name) && HEAD_TAGS.has(t.name)) {
        this.insertElement(t)
        this.popEl()
        return
      }
      if (t.name === 'title') {
        this.insertElement(t)
        this.tk.setContentState('rcdata')
        this.tk.setLastStartTag('title')
        this.originalMode = this.mode
        this.mode = 'text'
        return
      }
      if (t.name === 'noscript') {
        this.insertElement(t)
        this.mode = 'inHeadNoscript'
        return
      }
      if (t.name === 'noframes' || t.name === 'style' || t.name === 'script') {
        this.insertElement(t)
        this.tk.setContentState(t.name === 'script' ? 'scriptData' : 'rawtext')
        this.tk.setLastStartTag(t.name)
        this.originalMode = this.mode
        this.mode = 'text'
        return
      }
      if (t.name === 'head') return
    }
    if (t.type === 'endTag' && t.name === 'head') {
      this.popEl()
      this.mode = 'afterHead'
      return
    }
    if (
      t.type === 'endTag' &&
      (t.name === 'body' || t.name === 'html' || t.name === 'br')
    ) {
    } else if (t.type === 'endTag') return
    this.popEl()
    this.mode = 'afterHead'
    this.process(t)
  }
  /**
   * "in head noscript" (scripting disabled): a small set of metadata tags +
   * whitespace/comments are handled in-head; </noscript> closes; anything else
   * pops the noscript and reprocesses in "in head".
   */
  mInHeadNoscript(t) {
    if (t.type === 'doctype') return
    if (t.type === 'startTag' && t.name === 'html') return this.mInBody(t)
    if (t.type === 'endTag' && t.name === 'noscript') {
      this.popEl()
      this.mode = 'inHead'
      return
    }
    if (t.type === 'character' && isAllWs(t.data)) return this.mInHead(t)
    if (t.type === 'comment') return this.mInHead(t)
    if (
      t.type === 'startTag' &&
      (t.name === 'basefont' ||
        t.name === 'bgsound' ||
        t.name === 'link' ||
        t.name === 'meta' ||
        t.name === 'noframes' ||
        t.name === 'style')
    )
      return this.mInHead(t)
    if (t.type === 'startTag' && (t.name === 'head' || t.name === 'noscript'))
      return
    this.popEl()
    this.mode = 'inHead'
    return this.process(t)
  }
  mAfterHead(t) {
    if (t.type === 'character' && isAllWs(t.data)) {
      this.insertText(t.data)
      return
    }
    if (t.type === 'comment') {
      this.insertComment(t.data)
      return
    }
    /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
    if (t.type === 'doctype') return
    /* v8 ignore stop */
    if (t.type === 'startTag' && t.name === 'html') return this.mInBody(t)
    if (t.type === 'startTag' && t.name === 'body') {
      this.bodyEl = this.insertElement(t)
      this.framesetOk = false
      this.mode = 'inBody'
      return
    }
    if (t.type === 'startTag' && t.name === 'frameset') {
      this.insertElement(t)
      this.mode = 'inFrameset'
      return
    }
    if (t.type === 'startTag' && HEAD_TAGS.has(t.name)) {
      if (this.head) this.pushEl(this.head)
      this.mInHead(t)
      if (this.head) {
        const idx = this.openIdx(this.head)
        if (idx >= 0) this.removeOpenAt(idx)
      }
      return
    }
    if (t.type === 'endTag') {
      if (t.name === 'template') return this.mInHead(t)
      if (t.name !== 'body' && t.name !== 'html' && t.name !== 'br') return
    }
    this.bodyEl = this.insertElement({
      type: 'startTag',
      name: 'body',
      attrs: [],
      selfClosing: false,
    })
    this.mode = 'inBody'
    this.process(t)
  }
  mInBody(t) {
    if (t.type === 'character') {
      this.reconstructFormatting()
      this.insertText(t.data)
      if (this.framesetOk && !isAllWs(t.data)) this.framesetOk = false
      return
    }
    if (t.type === 'comment') {
      this.insertComment(t.data)
      return
    }
    if (t.type === 'doctype') return
    if (t.type === 'startTag') return this.inBodyStart(t)
    if (t.type === 'endTag') return this.inBodyEnd(t)
  }
  inBodyStart(t) {
    const n = t.name
    const cat = IB_START_CAT.get(n) ?? 0
    if (cat === 0) {
      this.reconstructFormatting()
      this.insertElement(t)
      return
    }
    if (cat === 1) {
      const html = this.open[0]
      if (html) {
        for (const [k, v] of t.attrs)
          if (!html.attrs.some(a => a[0] === k)) html.attrs.push([k, v])
      }
      return
    }
    if (cat === 2) {
      this.mInHead(t)
      return
    }
    if (cat === 3) return
    if (cat === 4) {
      const body = this.open[1]
      if (
        !this.framesetOk ||
        !body ||
        body.name !== 'body' ||
        body.namespace !== 'html'
      )
        return
      this.removeFromParent(body)
      while (this.open.length > 1) this.popEl()
      this.insertElement(t)
      this.mode = 'inFrameset'
      return
    }
    if (cat === 5) {
      this.closePElement()
      this.insertElement(t)
      if (n === 'pre' || n === 'listing') {
        this.ignoreNextLF = true
        this.framesetOk = false
      }
      return
    }
    if (cat === 6) {
      this.closePElement()
      /* v8 ignore start -- defensive fallback for an impossible state (ref always found / current is an element / stack non-empty) */
      if (
        HEADINGS.has(
          this.current().type === 'element' ? this.current().name : '',
        )
      )
        this.popEl()
      /* v8 ignore stop */
      this.insertElement(t)
      return
    }
    if (cat === 7) {
      this.framesetOk = false
      for (let i = this.open.length - 1; i >= 0; i--) {
        const el = this.open[i]
        if (
          (n === 'li' && el.name === 'li') ||
          (n !== 'li' && (el.name === 'dd' || el.name === 'dt'))
        ) {
          this.generateImpliedEndTags(el.name)
          this.popUntil(el.name)
          break
        }
        if (
          SPECIAL.has(el.name) &&
          el.name !== 'address' &&
          el.name !== 'div' &&
          el.name !== 'p'
        )
          break
      }
      this.closePElement()
      this.insertElement(t)
      return
    }
    if (cat === 8) {
      if (n === 'a')
        for (let i = this.afe.length - 1; i >= 0; i--) {
          const e = this.afe[i]
          if (e === 'marker') break
          if (e.name === 'a') {
            this.adoptionAgency('a')
            break
          }
        }
      else if (n === 'nobr') {
        this.reconstructFormatting()
        if (this.hasInScope('nobr')) this.adoptionAgency('nobr')
      }
      this.reconstructFormatting()
      const el = this.insertElement(t)
      this.pushAfe(el)
      return
    }
    if (cat === 9) {
      this.closePElement()
      this.insertElement(t)
      this.popEl()
      this.framesetOk = false
      return
    }
    if (cat === 10) {
      this.insertElement(t)
      this.popEl()
      return
    }
    if (cat === 11) {
      const hasTemplate =
        this.mayBeOpen('template') && this.open.some(e => e.name === 'template')
      if (this.formElement && !hasTemplate) return
      if (this.hasInButtonScope('p')) this.closePElement()
      const f = this.insertElement(t)
      if (!hasTemplate) this.formElement = f
      return
    }
    if (cat === 12) {
      this.reconstructFormatting()
      this.insertElement(t)
      this.popEl()
      if (n === 'input') {
        if (
          !t.attrs.some(
            ([k, v]) => k === 'type' && v.toLowerCase() === 'hidden',
          )
        )
          this.framesetOk = false
      } else this.framesetOk = false
      return
    }
    if (cat === 13) {
      if (n === 'xmp') {
        this.closePElement()
        this.reconstructFormatting()
      }
      if (n === 'xmp' || n === 'iframe') this.framesetOk = false
      this.insertElement(t)
      this.tk.setContentState('rawtext')
      this.tk.setLastStartTag(n)
      this.originalMode = this.mode
      this.mode = 'text'
      return
    }
    if (cat === 14) {
      this.insertElement(t)
      this.ignoreNextLF = true
      this.tk.setContentState('rcdata')
      this.tk.setLastStartTag(n)
      this.framesetOk = false
      this.originalMode = this.mode
      this.mode = 'text'
      return
    }
    if (cat === 15) {
      this.closePElement()
      this.insertElement(t)
      this.tk.setContentState('plaintext')
      return
    }
    if (cat === 16) {
      if (this.hasInScope('button')) {
        this.generateImpliedEndTags()
        this.popUntil('button')
      }
      this.reconstructFormatting()
      this.insertElement(t)
      this.framesetOk = false
      return
    }
    if (cat === 17) {
      this.closePElement()
      this.insertElement(t)
      this.framesetOk = false
      this.mode = 'inTable'
      return
    }
    if (cat === 18) {
      this.reconstructFormatting()
      this.insertElement(t)
      this.framesetOk = false
      this.mode =
        this.mode === 'inTable' ||
        this.mode === 'inCaption' ||
        this.mode === 'inTableBody' ||
        this.mode === 'inRow' ||
        this.mode === 'inCell'
          ? 'inSelectInTable'
          : 'inSelect'
      return
    }
    if (cat === 19) {
      if (this.current().type === 'element' && this.current().name === 'option')
        this.popEl()
      this.reconstructFormatting()
      this.insertElement(t)
      return
    }
    if (cat === 20) return
    if (cat === 21) {
      this.insertElement({
        ...t,
        name: 'img',
      })
      this.popEl()
      this.framesetOk = false
      return
    }
    if (cat === 22) {
      if (this.hasInScope('ruby')) this.generateImpliedEndTags()
      this.insertElement(t)
      return
    }
    if (cat === 23) {
      if (this.hasInScope('ruby')) this.generateImpliedEndTags('rtc')
      this.insertElement(t)
      return
    }
    if (cat === 24) {
      this.reconstructFormatting()
      this.insertForeign(t, 'svg')
      return
    }
    if (cat === 25) {
      this.reconstructFormatting()
      this.insertForeign(t, 'mathml')
      return
    }
    if (cat === 26) {
      this.reconstructFormatting()
      this.insertElement(t)
      this.afe.push('marker')
      this.framesetOk = false
      return
    }
  }
  inBodyEnd(t) {
    const n = t.name
    if (n === 'body' || n === 'html') {
      if (this.hasInScope('body')) {
        this.mode = 'afterBody'
        if (n === 'html') this.process(t)
      }
      return
    }
    if (n === 'p') {
      if (!this.hasInButtonScope('p'))
        this.insertElement({
          type: 'startTag',
          name: 'p',
          attrs: [],
          selfClosing: false,
        })
      this.closePElement()
      return
    }
    if (HEADINGS.has(n)) {
      if (
        !this.mayBeOpen('h1') &&
        !this.mayBeOpen('h2') &&
        !this.mayBeOpen('h3') &&
        !this.mayBeOpen('h4') &&
        !this.mayBeOpen('h5') &&
        !this.mayBeOpen('h6')
      )
        return
      let inScope = false
      for (let i = this.open.length - 1; i >= 0; i--) {
        const nm = this.open[i].name
        if (HEADINGS.has(nm)) {
          inScope = true
          break
        }
        if (this.inScopeNames.has(nm)) break
      }
      if (!inScope) return
      this.generateImpliedEndTags()
      while (this.open.length) {
        const el = this.popEl()
        if (HEADINGS.has(el.name)) break
      }
      return
    }
    if (n === 'form') {
      if (
        this.mayBeOpen('template') &&
        this.open.some(e => e.name === 'template')
      ) {
        if (!this.hasInScope('form')) return
        this.generateImpliedEndTags()
        this.popUntil('form')
        return
      }
      const node = this.formElement
      this.formElement = null
      if (!node || !this.hasElementInScope(node)) return
      this.generateImpliedEndTags()
      const i = this.open.indexOf(node)
      if (i >= 0) this.removeOpenAt(i)
      return
    }
    if (CLOSE_BLOCK.has(n)) {
      if (!this.hasInScope(n)) return
      this.generateImpliedEndTags()
      this.popUntil(n)
      return
    }
    if (n === 'applet' || n === 'marquee' || n === 'object') {
      if (!this.hasInScope(n)) return
      this.generateImpliedEndTags()
      this.popUntil(n)
      this.clearAfeToMarker()
      return
    }
    if (FORMATTING.has(n)) {
      this.adoptionAgency(n)
      return
    }
    this.inBodyEndGeneric(n)
  }
  inBodyEndGeneric(n) {
    if (!this.mayBeOpen(n)) return
    for (let i = this.open.length - 1; i >= 0; i--) {
      const el = this.open[i]
      if (el.name === n) {
        this.generateImpliedEndTags(n)
        while (this.open.length > i) this.popEl()
        return
      }
      if (SPECIAL.has(el.name)) return
    }
  }
  cloneElement(el) {
    return {
      type: 'element',
      name: el.name,
      namespace: el.namespace,
      attrs: el.attrs.map(a => [a[0], a[1]]),
      children: [],
      parent: null,
    }
  }
  removeFromParent(node) {
    const p = node.parent
    if (p) {
      const i = lastIdx(p.children, node)
      if (i >= 0) p.children.splice(i, 1)
      node.parent = null
    }
  }
  /**
   * Insert `node` under `target`, foster-parenting (before the last table) when
   * target is a table context — the adoption agency's "appropriate place".
   */
  fosterInsert(target, node) {
    if (TABLE_CONTEXT.has(target.name)) {
      let lt = null,
        lti = -1
      for (let k = this.open.length - 1; k >= 0; k--)
        if (this.open[k].name === 'table') {
          lt = this.open[k]
          lti = k
          break
        }
      if (lt && lt.parent) {
        const j = lastIdx(lt.parent.children, lt)
        /* v8 ignore start -- defensive fallback for an impossible state (ref always found / current is an element / stack non-empty) */
        lt.parent.children.splice(
          j < 0 ? lt.parent.children.length : j,
          0,
          node,
        )
        /* v8 ignore stop */
        node.parent = lt.parent
        return
      }
      /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
      if (lt) {
        this.append(this.open[lti - 1], node)
        return
      }
    }
    this.append(target, node)
  }
  hasElementInScope(target) {
    for (let i = this.open.length - 1; i >= 0; i--) {
      const el = this.open[i]
      if (el === target) return true
      if (this.isScopeMarker(el)) return false
    }
    /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
    return false
    /* v8 ignore stop */
  }
  /**
   * The WHATWG adoption agency algorithm — reparents misnested formatting
   * elements (e.g. `<a>1<p>2</p>3</a>`) exactly the way the browser does. This
   * is the single most intricate part of tree construction and a real mXSS
   * surface. (Foster parenting for the table case is a later refinement —
   * marked below.)
   */
  adoptionAgency(tag) {
    const cur = this.open[this.open.length - 1]
    /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
    if (cur && cur.name === tag && lastIdx(this.afe, cur) === -1) {
      this.popEl()
      return
    }
    /* v8 ignore stop */
    for (let outer = 0; outer < 8; outer++) {
      let fmtIdx = -1
      for (let i = this.afe.length - 1; i >= 0; i--) {
        const e = this.afe[i]
        if (e === 'marker') break
        if (e.name === tag) {
          fmtIdx = i
          break
        }
      }
      if (fmtIdx === -1) {
        this.inBodyEndGeneric(tag)
        return
      }
      const fmtEl = this.afe[fmtIdx]
      const openIdx = this.openIdx(fmtEl)
      if (openIdx === -1) {
        this.afe.splice(fmtIdx, 1)
        return
      }
      if (!this.hasElementInScope(fmtEl)) return
      let furthestBlock = null
      let furthestIdx = -1
      for (let i = openIdx + 1; i < this.open.length; i++)
        if (SPECIAL.has(this.open[i].name)) {
          furthestBlock = this.open[i]
          furthestIdx = i
          break
        }
      if (!furthestBlock) {
        while (this.open.length > openIdx) this.popEl()
        this.afe.splice(fmtIdx, 1)
        return
      }
      const commonAncestor = this.open[openIdx - 1]
      let bookmark = fmtIdx
      let lastNode = furthestBlock
      let nodeIdx = furthestIdx
      for (let inner = 0; ;) {
        inner++
        nodeIdx--
        /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
        if (nodeIdx < 0) break
        /* v8 ignore stop */
        let node = this.open[nodeIdx]
        if (node === fmtEl) break
        let afeIdx = lastIdx(this.afe, node)
        if (inner > 3 && afeIdx !== -1) {
          this.afe.splice(afeIdx, 1)
          afeIdx = -1
        }
        if (afeIdx === -1) {
          this.removeOpenAt(nodeIdx)
          continue
        }
        const clone = this.cloneElement(node)
        this.afe[afeIdx] = clone
        this.open[nodeIdx] = clone
        node = clone
        if (lastNode === furthestBlock) bookmark = afeIdx + 1
        this.removeFromParent(lastNode)
        this.append(node, lastNode)
        lastNode = node
      }
      this.removeFromParent(lastNode)
      this.fosterInsert(commonAncestor, lastNode)
      const fmtClone = this.cloneElement(fmtEl)
      for (const child of furthestBlock.children) {
        child.parent = fmtClone
        fmtClone.children.push(child)
      }
      furthestBlock.children = []
      this.append(furthestBlock, fmtClone)
      const fAfe = lastIdx(this.afe, fmtEl)
      if (fAfe !== -1) {
        this.afe.splice(fAfe, 1)
        if (fAfe < bookmark) bookmark--
      }
      bookmark = Math.max(0, Math.min(bookmark, this.afe.length))
      this.afe.splice(bookmark, 0, fmtClone)
      const fOpen = this.openIdx(fmtEl)
      if (fOpen !== -1) this.removeOpenAt(fOpen)
      const fbOpen = this.openIdx(furthestBlock)
      this.open.splice(fbOpen + 1, 0, fmtClone)
      this.countUp(fmtClone.name)
    }
  }
  mText(t) {
    if (t.type === 'character') {
      this.insertText(t.data)
      return
    }
    if (t.type === 'endTag') {
      this.popEl()
      this.mode = this.originalMode
      return
    }
    this.popEl()
    this.mode = this.originalMode
    this.process(t)
  }
  mAfterBody(t) {
    if (t.type === 'character' && isAllWs(t.data)) return this.mInBody(t)
    /* v8 ignore start -- defensive fallback for an impossible state (ref always found / current is an element / stack non-empty) */
    if (t.type === 'comment') {
      this.insertComment(t.data, this.open[0] ?? this.document)
      return
    }
    /* v8 ignore stop */
    if (t.type === 'doctype') return
    if (t.type === 'startTag' && t.name === 'html') return this.mInBody(t)
    if (t.type === 'endTag' && t.name === 'html') {
      this.mode = 'afterAfterBody'
      return
    }
    this.mode = 'inBody'
    this.process(t)
  }
  mAfterAfterBody(t) {
    if (t.type === 'comment') {
      this.insertComment(t.data, this.document)
      return
    }
    /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
    if (t.type === 'doctype') return
    /* v8 ignore stop */
    if (t.type === 'character' && isAllWs(t.data)) return this.mInBody(t)
    if (t.type === 'startTag' && t.name === 'html') return this.mInBody(t)
    this.mode = 'inBody'
    this.process(t)
  }
  /**
   * Whitespace-only subset of a character run (frameset modes ignore non-ws).
   */
  framesetWs(data) {
    let ws = ''
    for (let i = 0; i < data.length; i++) {
      const c = data.charCodeAt(i)
      if (c === 9 || c === 10 || c === 12 || c === 13 || c === 32) ws += data[i]
    }
    return ws
  }
  mInFrameset(t) {
    if (t.type === 'character') {
      const ws = this.framesetWs(t.data)
      if (ws) this.insertText(ws)
      return
    }
    if (t.type === 'comment') {
      this.insertComment(t.data)
      return
    }
    if (t.type === 'doctype') return
    if (t.type === 'startTag') {
      const n = t.name
      if (n === 'html') return this.mInBody(t)
      if (n === 'frameset') {
        this.insertElement(t)
        return
      }
      if (n === 'frame') {
        this.insertElement(t)
        this.popEl()
        return
      }
      if (n === 'noframes') return this.mInHead(t)
      return
    }
    if (t.type === 'endTag' && t.name === 'frameset') {
      /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
      if (this.currentName() === 'html') return
      /* v8 ignore stop */
      this.popEl()
      if (this.currentName() !== 'frameset') this.mode = 'afterFrameset'
      return
    }
  }
  mAfterFrameset(t) {
    if (t.type === 'character') {
      const ws = this.framesetWs(t.data)
      if (ws) this.insertText(ws)
      return
    }
    if (t.type === 'comment') {
      this.insertComment(t.data)
      return
    }
    if (t.type === 'doctype') return
    if (t.type === 'startTag') {
      /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
      if (t.name === 'html') return this.mInBody(t)
      /* v8 ignore stop */
      if (t.name === 'noframes') return this.mInHead(t)
      return
    }
    if (t.type === 'endTag' && t.name === 'html') {
      this.mode = 'afterAfterFrameset'
      return
    }
  }
  mAfterAfterFrameset(t) {
    if (t.type === 'comment') {
      this.insertComment(t.data, this.document)
      return
    }
    if (t.type === 'character') {
      const ws = this.framesetWs(t.data)
      if (ws) this.insertText(ws)
      return
    }
    if (t.type === 'doctype') return
    if (t.type === 'startTag') {
      if (t.name === 'html') return this.mInBody(t)
      if (t.name === 'noframes') return this.mInHead(t)
      return
    }
  }
  currentName() {
    const c = this.current()
    /* v8 ignore start -- defensive fallback for an impossible state (ref always found / current is an element / stack non-empty) */
    return c.type === 'element' ? c.name : ''
    /* v8 ignore stop */
  }
  clearStackTo(ctx) {
    while (this.open.length && !ctx.has(this.open[this.open.length - 1].name))
      this.popEl()
  }
  clearAfeToMarker() {
    while (this.afe.length) if (this.afe.pop() === 'marker') break
  }
  hasInTableScope(target) {
    if (!this.mayBeOpen(target)) return false
    for (let i = this.open.length - 1; i >= 0; i--) {
      const n = this.open[i].name
      if (n === target) return true
      if (n === 'html' || n === 'table' || n === 'template') return false
    }
    /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
    return false
    /* v8 ignore stop */
  }
  hasInSelectScope(target) {
    for (let i = this.open.length - 1; i >= 0; i--) {
      const n = this.open[i].name
      if (n === target) return true
      /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
      if (n !== 'optgroup' && n !== 'option') return false
    }
    /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
    return false
    /* v8 ignore stop */
  }
  anyTableBodyInScope() {
    return (
      this.hasInTableScope('tbody') ||
      this.hasInTableScope('thead') ||
      this.hasInTableScope('tfoot')
    )
  }
  resetInsertionMode() {
    for (let i = this.open.length - 1; i >= 0; i--) {
      const n = this.open[i].name
      const last = i === 0
      if (n === 'select') {
        this.mode = 'inSelect'
        return
      }
      if ((n === 'td' || n === 'th') && !last) {
        this.mode = 'inCell'
        return
      }
      if (n === 'tr') {
        this.mode = 'inRow'
        return
      }
      if (n === 'tbody' || n === 'thead' || n === 'tfoot') {
        this.mode = 'inTableBody'
        return
      }
      if (n === 'caption') {
        this.mode = 'inCaption'
        return
      }
      if (n === 'colgroup') {
        this.mode = 'inColumnGroup'
        return
      }
      if (n === 'table') {
        this.mode = 'inTable'
        return
      }
      /* v8 ignore start -- defensive fallback for an impossible state (ref always found / current is an element / stack non-empty) */
      if (n === 'template') {
        this.mode =
          this.templateModes[this.templateModes.length - 1] ?? 'inBody'
        return
      }
      /* v8 ignore stop */
      if (n === 'head' || n === 'body') {
        this.mode = 'inBody'
        return
      }
      /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
      if (n === 'html') {
        this.mode = this.head ? 'afterHead' : 'beforeHead'
        return
      }
      /* v8 ignore stop */
      /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
      if (last) {
        this.mode = 'inBody'
        return
      }
    }
    /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
    this.mode = 'inBody'
    /* v8 ignore stop */
  }
  fosterInBody(t) {
    this.fosterParenting = true
    this.mInBody(t)
    this.fosterParenting = false
  }
  mInTable(t) {
    if (t.type === 'character') {
      this.pendingTableText = ''
      this.pendingTableNonWs = false
      this.originalMode = this.mode
      this.mode = 'inTableText'
      return this.process(t)
    }
    if (t.type === 'comment') {
      this.insertComment(t.data)
      return
    }
    if (t.type === 'doctype') return
    if (t.type === 'startTag') {
      const n = t.name
      if (n === 'caption') {
        this.clearStackTo(TABLE_ROOT_CTX)
        this.afe.push('marker')
        this.insertElement(t)
        this.mode = 'inCaption'
        return
      }
      if (n === 'colgroup') {
        this.clearStackTo(TABLE_ROOT_CTX)
        this.insertElement(t)
        this.mode = 'inColumnGroup'
        return
      }
      if (n === 'col') {
        this.clearStackTo(TABLE_ROOT_CTX)
        this.insertElement({
          type: 'startTag',
          name: 'colgroup',
          attrs: [],
          selfClosing: false,
        })
        this.mode = 'inColumnGroup'
        return this.process(t)
      }
      if (n === 'tbody' || n === 'tfoot' || n === 'thead') {
        this.clearStackTo(TABLE_ROOT_CTX)
        this.insertElement(t)
        this.mode = 'inTableBody'
        return
      }
      if (n === 'td' || n === 'th' || n === 'tr') {
        this.clearStackTo(TABLE_ROOT_CTX)
        this.insertElement({
          type: 'startTag',
          name: 'tbody',
          attrs: [],
          selfClosing: false,
        })
        this.mode = 'inTableBody'
        return this.process(t)
      }
      /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
      if (n === 'table') {
        if (!this.hasInTableScope('table')) return
        this.popUntil('table')
        this.resetInsertionMode()
        return this.process(t)
      }
      /* v8 ignore stop */
      if (n === 'style' || n === 'script' || n === 'template')
        return this.mInHead(t)
      if (
        n === 'input' &&
        t.attrs.some(([k, v]) => k === 'type' && v.toLowerCase() === 'hidden')
      ) {
        this.insertElement(t)
        this.popEl()
        return
      }
      if (n === 'form') {
        this.insertElement(t)
        this.popEl()
        return
      }
      return this.fosterInBody(t)
    }
    if (t.type === 'endTag') {
      const n = t.name
      /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
      if (n === 'table') {
        if (!this.hasInTableScope('table')) return
        this.popUntil('table')
        this.resetInsertionMode()
        return
      }
      /* v8 ignore stop */
      if (INTABLE_IGNORED_END.has(n)) return
      return this.fosterInBody(t)
    }
    if (t.type === 'eof') return this.mInBody(t)
  }
  mInTableText(t) {
    if (t.type === 'character') {
      this.pendingTableText += t.data
      if (!isAllWs(t.data)) this.pendingTableNonWs = true
      return
    }
    const text = this.pendingTableText,
      nonWs = this.pendingTableNonWs
    this.pendingTableText = ''
    this.pendingTableNonWs = false
    this.mode = this.originalMode
    if (text)
      if (nonWs) {
        this.fosterParenting = true
        this.insertText(text)
        this.fosterParenting = false
      } else this.insertText(text)
    return this.process(t)
  }
  mInCaption(t) {
    if (t.type === 'endTag' && t.name === 'caption') {
      /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
      if (!this.hasInTableScope('caption')) return
      /* v8 ignore stop */
      this.generateImpliedEndTags()
      this.popUntil('caption')
      this.clearAfeToMarker()
      this.mode = 'inTable'
      return
    }
    if (
      (t.type === 'startTag' && CELL_OR_CAPTION_START.has(t.name)) ||
      (t.type === 'endTag' && t.name === 'table')
    ) {
      /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
      if (!this.hasInTableScope('caption')) return
      /* v8 ignore stop */
      this.generateImpliedEndTags()
      this.popUntil('caption')
      this.clearAfeToMarker()
      this.mode = 'inTable'
      return this.process(t)
    }
    if (t.type === 'endTag' && INCAPTION_IGNORED_END.has(t.name)) return
    return this.mInBody(t)
  }
  mInColumnGroup(t) {
    if (t.type === 'character' && isAllWs(t.data)) {
      this.insertText(t.data)
      return
    }
    if (t.type === 'comment') {
      this.insertComment(t.data)
      return
    }
    if (t.type === 'doctype') return
    if (t.type === 'startTag' && t.name === 'html') return this.mInBody(t)
    if (t.type === 'startTag' && t.name === 'col') {
      this.insertElement(t)
      this.popEl()
      return
    }
    if ((t.type === 'startTag' || t.type === 'endTag') && t.name === 'template')
      return this.mInHead(t)
    if (t.type === 'endTag' && t.name === 'colgroup') {
      if (this.currentName() === 'colgroup') {
        this.popEl()
        this.mode = 'inTable'
      }
      return
    }
    if (t.type === 'endTag' && t.name === 'col') return
    if (t.type === 'eof') return this.mInBody(t)
    if (this.currentName() === 'colgroup') {
      this.popEl()
      this.mode = 'inTable'
      return this.process(t)
    }
  }
  mInTableBody(t) {
    if (t.type === 'startTag' && t.name === 'tr') {
      this.clearStackTo(TABLE_BODY_CTX)
      this.insertElement(t)
      this.mode = 'inRow'
      return
    }
    if (t.type === 'startTag' && (t.name === 'td' || t.name === 'th')) {
      this.clearStackTo(TABLE_BODY_CTX)
      this.insertElement({
        type: 'startTag',
        name: 'tr',
        attrs: [],
        selfClosing: false,
      })
      this.mode = 'inRow'
      return this.process(t)
    }
    if (t.type === 'startTag' && INTABLEBODY_SCOPE_START.has(t.name)) {
      /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
      if (!this.anyTableBodyInScope()) return
      /* v8 ignore stop */
      this.clearStackTo(TABLE_BODY_CTX)
      this.popEl()
      this.mode = 'inTable'
      return this.process(t)
    }
    if (
      t.type === 'endTag' &&
      (t.name === 'tbody' || t.name === 'tfoot' || t.name === 'thead')
    ) {
      if (!this.hasInTableScope(t.name)) return
      this.clearStackTo(TABLE_BODY_CTX)
      this.popEl()
      this.mode = 'inTable'
      return
    }
    if (t.type === 'endTag' && t.name === 'table') {
      /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
      if (!this.anyTableBodyInScope()) return
      /* v8 ignore stop */
      this.clearStackTo(TABLE_BODY_CTX)
      this.popEl()
      this.mode = 'inTable'
      return this.process(t)
    }
    if (t.type === 'endTag' && INTABLEBODY_IGNORED_END.has(t.name)) return
    return this.mInTable(t)
  }
  mInRow(t) {
    if (t.type === 'startTag' && (t.name === 'td' || t.name === 'th')) {
      this.clearStackTo(TABLE_ROW_CTX)
      this.insertElement(t)
      this.mode = 'inCell'
      this.afe.push('marker')
      return
    }
    /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
    if (t.type === 'endTag' && t.name === 'tr') {
      if (!this.hasInTableScope('tr')) return
      this.clearStackTo(TABLE_ROW_CTX)
      this.popEl()
      this.mode = 'inTableBody'
      return
    }
    /* v8 ignore stop */
    if (
      (t.type === 'startTag' && INROW_SCOPE_START.has(t.name)) ||
      (t.type === 'endTag' && t.name === 'table')
    ) {
      /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
      if (!this.hasInTableScope('tr')) return
      /* v8 ignore stop */
      this.clearStackTo(TABLE_ROW_CTX)
      this.popEl()
      this.mode = 'inTableBody'
      return this.process(t)
    }
    if (
      t.type === 'endTag' &&
      (t.name === 'tbody' || t.name === 'tfoot' || t.name === 'thead')
    ) {
      /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
      if (!this.hasInTableScope(t.name) || !this.hasInTableScope('tr')) return
      /* v8 ignore stop */
      this.clearStackTo(TABLE_ROW_CTX)
      this.popEl()
      this.mode = 'inTableBody'
      return this.process(t)
    }
    if (t.type === 'endTag' && INROW_IGNORED_END.has(t.name)) return
    return this.mInTable(t)
  }
  mInCell(t) {
    if (t.type === 'endTag' && (t.name === 'td' || t.name === 'th')) {
      if (!this.hasInTableScope(t.name)) return
      this.generateImpliedEndTags()
      this.popUntil(t.name)
      this.clearAfeToMarker()
      this.mode = 'inRow'
      return
    }
    if (t.type === 'startTag' && CELL_OR_CAPTION_START.has(t.name)) {
      /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
      if (!this.hasInTableScope('td') && !this.hasInTableScope('th')) return
      /* v8 ignore stop */
      this.closeCell()
      return this.process(t)
    }
    if (t.type === 'endTag' && INCELL_IGNORED_END.has(t.name)) return
    if (t.type === 'endTag' && INCELL_TABLE_END.has(t.name)) {
      if (!this.hasInTableScope(t.name)) return
      this.closeCell()
      return this.process(t)
    }
    return this.mInBody(t)
  }
  closeCell() {
    const which = this.hasInTableScope('td') ? 'td' : 'th'
    this.generateImpliedEndTags()
    this.popUntil(which)
    this.clearAfeToMarker()
    this.mode = 'inRow'
  }
  mInSelect(t) {
    if (t.type === 'character') {
      this.insertText(t.data)
      return
    }
    if (t.type === 'comment') {
      this.insertComment(t.data)
      return
    }
    if (t.type === 'doctype') return
    if (t.type === 'startTag') {
      const n = t.name
      if (n === 'html') return this.mInBody(t)
      if (n === 'option') {
        if (this.currentName() === 'option') this.popEl()
        this.insertElement(t)
        return
      }
      if (n === 'optgroup') {
        if (this.currentName() === 'option') this.popEl()
        if (this.currentName() === 'optgroup') this.popEl()
        this.insertElement(t)
        return
      }
      if (n === 'hr') {
        if (this.currentName() === 'option') this.popEl()
        if (this.currentName() === 'optgroup') this.popEl()
        this.insertElement(t)
        this.popEl()
        return
      }
      if (n === 'select') {
        if (this.hasInSelectScope('select')) {
          this.popUntil('select')
          this.resetInsertionMode()
        }
        return
      }
      /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
      if (n === 'input' || n === 'keygen' || n === 'textarea') {
        if (!this.hasInSelectScope('select')) return
        this.popUntil('select')
        this.resetInsertionMode()
        return this.process(t)
      }
      /* v8 ignore stop */
      if (n === 'script' || n === 'template') return this.mInHead(t)
      return this.mInBody(t)
    }
    if (t.type === 'endTag') {
      const n = t.name
      if (n === 'optgroup') {
        if (
          this.currentName() === 'option' &&
          this.open[this.open.length - 2]?.name === 'optgroup'
        )
          this.popEl()
        if (this.currentName() === 'optgroup') this.popEl()
        return
      }
      if (n === 'option') {
        if (this.currentName() === 'option') this.popEl()
        return
      }
      if (n === 'select') {
        if (!this.hasInSelectScope('select')) return
        this.popUntil('select')
        this.resetInsertionMode()
        return
      }
      if (n === 'template') return this.mInHead(t)
      return this.mInBody(t)
    }
    if (t.type === 'eof') return this.mInBody(t)
  }
  /**
   * "in select in table": a table-structure tag closes the whole select and is
   * reprocessed; everything else falls through to the normal select rules.
   */
  mInSelectInTable(t) {
    if (t.type === 'startTag' || t.type === 'endTag') {
      const n = t.name
      if (
        n === 'caption' ||
        n === 'table' ||
        n === 'tbody' ||
        n === 'tfoot' ||
        n === 'thead' ||
        n === 'tr' ||
        n === 'td' ||
        n === 'th'
      ) {
        if (t.type === 'endTag' && !this.hasInTableScope(n)) return
        this.popUntil('select')
        this.resetInsertionMode()
        return this.process(t)
      }
    }
    return this.mInSelect(t)
  }
  /**
   * "in template": route head-ish content to inHead, switch the current
   * template insertion mode for table-context tags, close on </template>/EOF.
   * Simplified vs. the spec but loop-free and safe (template content is dropped
   * by the sanitizer regardless of the exact subtree).
   */
  mInTemplate(t) {
    if (t.type === 'character' || t.type === 'comment' || t.type === 'doctype')
      return this.mInBody(t)
    if (t.type === 'eof') {
      /* v8 ignore start -- unreachable in document-only parsing: defensive / fragment-context guard */
      if (!this.hasInScope('template')) return
      /* v8 ignore stop */
      this.popUntil('template')
      this.clearAfeToMarker()
      this.templateModes.pop()
      this.resetInsertionMode()
      return this.process(t)
    }
    if (t.type === 'endTag') {
      if (t.name === 'template') return this.mInHead(t)
      return
    }
    const n = t.name
    if (HEAD_TAGS.has(n) || n === 'script') return this.mInHead(t)
    let m = 'inBody'
    if (
      n === 'caption' ||
      n === 'colgroup' ||
      n === 'tbody' ||
      n === 'tfoot' ||
      n === 'thead'
    )
      m = 'inTable'
    else if (n === 'col') m = 'inColumnGroup'
    else if (n === 'tr') m = 'inTableBody'
    else if (n === 'td' || n === 'th') m = 'inRow'
    this.templateModes[this.templateModes.length - 1] = m
    this.mode = m
    return this.process(t)
  }
}
/**
 * Order-independent attribute-set equality (for the adoption agency's Noah's
 * Ark).
 */
function sameAttrs(a, b) {
  if (a.length !== b.length) return false
  for (const [k, v] of a) {
    let found = false
    for (const [k2, v2] of b)
      if (k2 === k && v2 === v) {
        found = true
        break
      }
    if (!found) return false
  }
  return true
}
/**
 * `neosanitize/whatwg-parser`: the browser-faithful WHATWG parse tree, exposed.
 *
 * Same tokenizer and tree construction the main sanitizer runs on (100%
 * html5lib tokenizer conformance), without any policy or filtering. Read,
 * query, and re-serialize HTML the way a browser would build it. Zero deps, no
 * DOM.
 *
 * Import { parse, findAll, textContent, serialize } from
 * 'neosanitize/whatwg-parser';
 *
 * `parse()` builds a full document (implied `<html>/<head>/<body>`), like
 * `new DOMParser().parseFromString(html, 'text/html')`.
 */
/**
 * Parse HTML into the full WHATWG document tree a browser would build.
 */
function parse(html) {
  return new TreeBuilder(html).parse()
}
const matches = (el, m) => (typeof m === 'string' ? el.name === m : m(el))
/**
 * First descendant element matching a tag name or predicate, or `null`.
 */
function find(root, match) {
  const stack = []
  for (let k = root.children.length - 1; k >= 0; k--)
    stack.push(root.children[k])
  while (stack.length !== 0) {
    const n = stack.pop()
    if (n.type !== 'element') continue
    if (matches(n, match)) return n
    for (let k = n.children.length - 1; k >= 0; k--) stack.push(n.children[k])
  }
  return null
}

const OPEN_MARKER_RE =
  /^\s*(?:#+|<!--|\/\/)\s*(?:BEGIN\s+)?(<[A-Za-z][^>]*>)\s*(?:-->)?\s*$/i
const CLOSE_MARKER_RE =
  /^\s*(?:#+|<!--|\/\/)\s*(?:END\s+)?<\/\s*([A-Za-z][A-Za-z0-9-]*)\s*>\s*(?:-->)?\s*$/i
const EMPTY_ATTRS = Object.freeze({ __proto__: null })
/**
 * Parse a single HTML open tag (`<tag key="value" bool>`) with neosanitize and
 * return its lowercased name + attributes, or `undefined` if no tag is found.
 * Boolean attributes (no `="value"`) map to an empty string.
 */
function parseOpenTag(tagHtml) {
  const element = find(
    parse(tagHtml),
    el => el.name !== 'body' && el.name !== 'head' && el.name !== 'html',
  )
  if (!element) return
  const attributes = { __proto__: null }
  for (let i = 0, { length } = element.attrs; i < length; i += 1) {
    const pair = element.attrs[i]
    attributes[pair[0].toLowerCase()] = pair[1]
  }
  return {
    tag: element.name.toLowerCase(),
    attributes,
  }
}
/**
 * Scan every line for a BEGIN/END marker, returning them in document order.
 * Open-tag names + attributes come from the WHATWG parser; tags are lowercased.
 */
function scanMarkers(content) {
  const out = []
  const lines = content.split(/\r?\n/)
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]
    const open = OPEN_MARKER_RE.exec(line)
    if (open) {
      const parsed = parseOpenTag(open[1])
      if (parsed)
        out.push({
          kind: 'begin',
          tag: parsed.tag,
          attributes: parsed.attributes,
          line: i,
        })
      continue
    }
    const close = CLOSE_MARKER_RE.exec(line)
    if (close)
      out.push({
        kind: 'end',
        tag: close[1].toLowerCase(),
        attributes: EMPTY_ATTRS,
        line: i,
      })
  }
  return out
}

/**
 * @file Single home for fleet + repo canonical region detection / extraction.
 *   The `<fleet>` tag markers (parsed by `named-blocks.mts`) delimit a
 *   fleet-owned cutout in a repository-owned file; the `<repo>` tag marks a
 *   repository-owned cutout in a fleet-owned file. The manifest declares the
 *   outer owner. A document uses one marker family and may carry multiple
 *   disjoint cutouts of that family. Every accessor here is
 *   plural: `findFleetRegions` / `findRepoRegions` return every region found,
 *   in document order. `repoRegionBounds` stays as a singular convenience for
 *   the one caller (CLAUDE.md's repo-section auditor) that only ever expects
 *   one repo region in a file.
 *   Per-syntax delimiter, one tag vocabulary:
 *   markdown / hash-comment   <!-- <fleet> -->   # <fleet>
 *   JSON array element        <fleet>            (bare string, no comment
 *   wrapper — JSON has none)
 *   Emitters produce the short bare-tag form (`<fleet>` / `<repo>`); the
 *   parser ALSO recognizes the long-form tag names (`fleet-canonical` /
 *   `repo-canonical`) every existing fleet member still carries, plus the
 *   legacy `BEGIN`/`END` keyword form, so members migrate incrementally as
 *   their own cascade re-splices the region. Drop the long-form recognition
 *   (LEGACY_FLEET_CANONICAL_TAG / LEGACY_REPO_CANONICAL_TAG below) once every
 *   roster member's cascade has run at least once post-rename — audit with a
 *   fleet-wide grep for `<fleet-canonical>` / `<repo-canonical>`; zero hits
 *   clears it. Every fleet-region matcher / fixer reads its marker knowledge
 *   from here, so the grammar stays single-sourced.
 */
const FLEET_CANONICAL_TAG = 'fleet'
const LEGACY_FLEET_CANONICAL_TAG = 'fleet-canonical'
const REPO_CANONICAL_TAG = 'repo'
const LEGACY_REPO_CANONICAL_TAG = 'repo-canonical'
/**
 * The open marker for a tag + comment style — bare-tag form, e.g.
 * `<!-- <fleet> -->` / `# <fleet>` / `<fleet>` (json — a bare JSON array
 * element, no comment wrapper).
 */
function beginMarkerForTag(tag, style) {
  if (style === 'html') return `<!-- <${tag}> -->`
  if (style === 'slash') return `// <${tag}>`
  if (style === 'json') return `<${tag}>`
  return `# <${tag}>`
}
/**
 * The close marker for a tag + comment style — bare close tag, e.g.
 * `<!-- </fleet> -->` / `# </fleet>` / `</fleet>` (json).
 */
function endMarkerForTag(tag, style) {
  if (style === 'html') return `<!-- </${tag}> -->`
  if (style === 'slash') return `// </${tag}>`
  if (style === 'json') return `</${tag}>`
  return `# </${tag}>`
}
/**
 * True when `value` is EXACTLY a bare `<tag>` (or its legacy alias), no
 * comment wrapper — the JSON-array-element form, where the marker IS the
 * whole element and there is no comment syntax to strip. Whitespace-trimmed
 * so a pretty-printer's leading indent never defeats the match.
 */
function isBareBeginTag(value, tag, legacyTag) {
  const trimmed = value.trim()
  return trimmed === `<${tag}>` || trimmed === `<${legacyTag}>`
}
/**
 * The bare `</tag>` (or legacy alias) twin of `isBareBeginTag`.
 */
function isBareEndTag(value, tag, legacyTag) {
  const trimmed = value.trim()
  return trimmed === `</${tag}>` || trimmed === `</${legacyTag}>`
}
/**
 * True when a single line (or JSON array element) is a BEGIN marker for `tag`
 * OR its transitional `legacyTag` alias — either the comment-wrapped form
 * (`scanMarkers` anchors the match to the whole line, so a prose mention of
 * the marker name elsewhere on a line is never mistaken for a marker) or the
 * bare JSON-element form.
 */
function isMarkerBeginLineForTag(tag, legacyTag, line) {
  return (
    isBareBeginTag(line, tag, legacyTag) ||
    scanMarkers(line).some(
      m => m.kind === 'begin' && (m.tag === tag || m.tag === legacyTag),
    )
  )
}
/**
 * True when a single line (or JSON array element) is an END marker for `tag`
 * OR its transitional `legacyTag` alias — comment-wrapped or bare.
 */
function isMarkerEndLineForTag(tag, legacyTag, line) {
  return (
    isBareEndTag(line, tag, legacyTag) ||
    scanMarkers(line).some(
      m => m.kind === 'end' && (m.tag === tag || m.tag === legacyTag),
    )
  )
}
/**
 * The open marker for the repo-canonical wrapper, e.g.
 * `<!-- <repo> -->` / `# <repo>`.
 */
function repoBeginMarker(style) {
  return beginMarkerForTag(REPO_CANONICAL_TAG, style)
}
/**
 * The close marker for the repo-canonical wrapper, e.g.
 * `<!-- </repo> -->` / `# </repo>`.
 */
function repoEndMarker(style) {
  return endMarkerForTag(REPO_CANONICAL_TAG, style)
}
/**
 * Find every region for `tag` (or its legacy alias) in `items` — a file's
 * lines, or a JSON array's elements; both are just a sequence of strings to
 * scan. Regions pair sequentially: each BEGIN is matched with the next END
 * found after it, tolerating an unclosed final BEGIN (its region runs to the
 * end of `items`, rather than being reported as an error — a fresh, empty,
 * or mid-edit region is a normal state, not a malformed one). A BEGIN nested
 * inside an already-open region of the SAME tag before its END is swallowed
 * into the outer region's span rather than starting a second one — a
 * deliberately tolerant, non-crashing default for a hand-edited file.
 */
function findRegionsForTag(items, kind, tag, legacyTag) {
  const regions = []
  const { length } = items
  let i = 0
  while (i < length) {
    if (!isMarkerBeginLineForTag(tag, legacyTag, items[i])) {
      i += 1
      continue
    }
    const start = i
    let end = length
    for (let j = i + 1; j < length; j += 1)
      if (isMarkerEndLineForTag(tag, legacyTag, items[j])) {
        end = j
        break
      }
    regions.push({
      end,
      kind,
      start,
    })
    i = end + 1
  }
  return regions
}
/**
 * Every `<fleet>` region in `items`, in document order. A JSON config with
 * several arrays gives each its own region — a file with N canonical arrays
 * returns N regions here, not one.
 */
function findFleetRegions(items) {
  return findRegionsForTag(
    items,
    'fleet',
    FLEET_CANONICAL_TAG,
    LEGACY_FLEET_CANONICAL_TAG,
  )
}
/**
 * Every `<repo>` region in `items`, in document order. See `findFleetRegions`
 * for the pairing/tolerance rules — identical, just the repo tag.
 */
function findRepoRegions(items) {
  return findRegionsForTag(
    items,
    'repo',
    REPO_CANONICAL_TAG,
    LEGACY_REPO_CANONICAL_TAG,
  )
}

function spliceFleetOwnedCutouts(target, canonical) {
  const lines = target.split(/\r?\n/)
  const fleetRegions = findFleetRegions(lines)
  const repoRegions = findRepoRegions(lines)
  const repoLines = []
  if (fleetRegions.length > 0) {
    const fleetLines = /* @__PURE__ */ new Set()
    for (const region of fleetRegions)
      for (let index = region.start; index <= region.end; index += 1)
        fleetLines.add(index)
    for (let index = 0, { length } = lines; index < length; index += 1) {
      if (fleetLines.has(index)) continue
      if (
        repoRegions.some(
          region => index === region.start || index === region.end,
        )
      )
        continue
      repoLines.push(lines[index])
    }
  } else if (repoRegions.length > 0)
    for (const region of repoRegions)
      repoLines.push(...lines.slice(region.start + 1, region.end))
  else repoLines.push(...lines)
  const canonicalLines = canonical.split(/\r?\n/)
  const canonicalFleet = findFleetRegions(canonicalLines)
  const canonicalRepo = findRepoRegions(canonicalLines)
  const body = trimCutoutLines(
    canonicalFleet.length > 0
      ? canonicalLines.slice(canonicalFleet[0].start + 1, canonicalFleet[0].end)
      : canonicalRepo.length > 0
        ? canonicalLines.filter(
            (_, index) =>
              !canonicalRepo.some(
                region => index >= region.start && index <= region.end,
              ),
          )
        : canonicalLines,
  )
  const repo = trimCutoutLines(repoLines)
  return [
    ...body,
    repoBeginMarker('hash'),
    ...repo,
    repoEndMarker('hash'),
    '',
  ].join('\n')
}
function trimCutoutLines(lines) {
  const result = [...lines]
  while (result[0]?.trim() === '') result.shift()
  while (result.at(-1)?.trim() === '') result.pop()
  return result
}

/**
 * @file The prebuilt dispatch-launcher variant contract - ONE list of
 *   (platform, arch) → filename shared by the publish-bundle producer, which
 *   stages CI-built binaries under {@link LAUNCHER_VARIANTS_REL_DIR}, the
 *   dir-mirror skip list so a hydrated binary never reads as drift, and
 *   `build-snapshot-launcher.mts`, which copies a matching prebuilt instead of
 *   invoking `cc`. Names follow the same `<platform>-<arch>` convention pnpm
 *   uses for its own prebuilt binaries, on node's `process.platform` and
 *   `process.arch` tokens (darwin, linux, win32; x64, arm64). The fetcher
 *   matches those tokens at runtime to pick its launcher, so the spellings are
 *   a contract. Linux binaries link libc statically, so each architecture
 *   serves both glibc and musl. Windows ships x64 and arm64 binaries.
 *   darwin ships TWO THIN per-arch binaries rather than one fat universal. A
 *   fat build would have to be staged under both darwin names, since lookup is
 *   by (platform, arch), which writes the same 50 KB twice; the thin pair is
 *   43,600 bytes against 101,328. Apple clang ad-hoc linker-signs the thin
 *   arm64 output exactly as it does the fat one's arm64 slice, so the arm64
 *   mandatory-signature rule is still satisfied. The launcher is
 *   ABI-independent - it never links node - so a variant is keyed by OS and
 *   arch alone and survives every node version switch.
 */
const LAUNCHER_VARIANTS_REL_DIR = '.claude/hooks/fleet/_dist/launchers'
/**
 * The bundle filename for a (platform, arch) pair — `.exe` suffixed on
 * Windows, bare elsewhere. Arch names follow node's `process.arch` values.
 */
function launcherVariantFileName(platform, arch) {
  return `dispatch-launcher-${platform}-${arch}${platform === 'win32' ? '.exe' : ''}`
}
/**
 * Every variant the release bundle may carry. A platform+arch absent here
 * (for example, BSD) falls back to the host `cc` compile, and past that
 * to the compile-cache baseline — the fail-open ladder is unchanged.
 */
const LAUNCHER_VARIANTS = [
  {
    arch: 'arm64',
    fileName: launcherVariantFileName('darwin', 'arm64'),
    platform: 'darwin',
  },
  {
    arch: 'x64',
    fileName: launcherVariantFileName('darwin', 'x64'),
    platform: 'darwin',
  },
  {
    arch: 'arm64',
    fileName: launcherVariantFileName('linux', 'arm64'),
    platform: 'linux',
  },
  {
    arch: 'x64',
    fileName: launcherVariantFileName('linux', 'x64'),
    platform: 'linux',
  },
  {
    arch: 'arm64',
    fileName: launcherVariantFileName('win32', 'arm64'),
    platform: 'win32',
  },
  {
    arch: 'x64',
    fileName: launcherVariantFileName('win32', 'x64'),
    platform: 'win32',
  },
]

/**
 * @file Release-only generated artifacts excluded from every directory mirror.
 *   This leaf module stays independent from the cascade manifest so the dep-0
 *   bootstrap installer can share the same list without loading bundle.json.
 */
const RELEASE_ONLY_DIR_MIRROR_FILES = [
  '.claude/hooks/fleet/_dist/fleet-pack.generated.cjs',
  'scripts/fleet/constants/model-pricing.generated.mts',
  'scripts/fleet/constants/fleet-pack-version.generated.mts',
  '.claude/hooks/fleet/_dist/fleet-pack.excluded.generated.cjs',
  '.claude/hooks/fleet/_dist/fleet-pack.snapshot.generated.cjs',
  '.claude/hooks/fleet/_shared/dispatch-launcher',
  '.claude/hooks/fleet/_shared/dispatch-launcher.exe',
  '.claude/hooks/fleet/_shared/node.path',
  '.claude/hooks/fleet/_shared/snapshot-blob.path',
  '.claude/hooks/fleet/_shared/dispatch-table.generated.mts',
  '.claude/hooks/fleet/_shared/dispatch-table.snapshot.generated.mts',
  '.claude/hooks/fleet/_shared/dispatch-table.excluded.generated.mts',
  '.claude/hooks/fleet/_shared/dispatch-manifest.generated.json',
  '.claude/hooks/fleet/_shared/validators.generated.mts',
  'scripts/fleet/lib/ata-validators.generated.cjs',
  ...LAUNCHER_VARIANTS.map(
    variant => `${LAUNCHER_VARIANTS_REL_DIR}/${variant.fileName}`,
  ),
]

/**
 * @file Dep-free error predicates for fleet _shared modules that bundle into
 *   the dep-0 bootstrap fetcher (fleet.mjs). fleet.mjs runs on a BARE clone
 *   with no node_modules, so it cannot import @socketsecurity/lib-stable; the
 *   predicates here are node-builtin-only so rolldown inlines them into the
 *   single-file bundle. Regular fleet scripts (with node_modules) may import
 *   the lib's cross-realm-safe {@link isErrnoException} instead, but anything
 *   that rolls into fleet.mjs imports from here.
 */
/**
 * Duck-type errno-exception guard. A real `NodeJS.ErrnoException` always
 * carries a string `code` (EACCES, ENOENT, ...); this check is enough for the
 * branching the bundled modules do (an EACCES on a locked mirror, an ENOENT on
 * a missing file). The lib's predicate is cross-realm-safe via [[ErrorData]]
 * slot semantics; that strength is not needed in the bootstrap path, which
 * handles only same-realm errors it caught itself.
 */
function isErrnoException(e) {
  return typeof e === 'object' && e !== null && typeof e.code === 'string'
}

/**
 * @file Mirror-lock lift primitives. The cascade chmods live fleet mirrors
 *   read-only (0444/0555) so stray edits fail at the filesystem level; every
 *   sanctioned writer that rewrites a mirror (a re-cascade, a block splice, a
 *   dispatch-table regen) lifts the lock for the write and restores it after.
 *   fs.cp/copyFile/writeFile all open the DESTINATION for write, so a locked
 *   mirror EACCESes without the lift. One implementation here — the cascade's
 *   mirror-mode fixer and the member-side generators (build-hook-bundle,
 *   gen/hook-dispatch) all import it, so the lift semantics cannot drift.
 *   `lockFileReadonlySync` is the other half: the publish-bundle installer
 *   places files with a plain `copyFileSync`, so it applies the lock itself
 *   rather than inheriting it from a cascade that never runs on that path.
 */
/**
 * Lift the lock from ONE file with no re-lock — for generated outputs a child
 * process rewrites (rolldown writing _dist/fleet-pack.generated.cjs cannot lift
 * for itself). Generated outputs are regenerated freely and should never carry
 * the mirror lock; this clears one that an earlier cascade applied. Missing
 * file is a no-op.
 */
function liftMirrorLockSync(filePath) {
  let stat
  try {
    stat = statSync(filePath)
  } catch {
    return
  }
  const mode = stat.mode & 511
  if ((mode & 128) === 0) chmodSync(filePath, mode | 128)
}
/**
 * Lock ONE file read-only, preserving its executable bit: 0o555 when the file
 * already carries an exec bit so a git-hook shim stays runnable while
 * unwritable, 0o444 otherwise. Same mode choice the cascade's own
 * `mirrorFileMode` makes, expressed sync and with `node:fs` alone so rolldown
 * can inline it into the dep-0 publish-bundle installer.
 *
 * Best-effort on purpose: a missing file or a chmod the filesystem refuses
 * leaves the target as it is instead of throwing. The installer locks each
 * file right after placing it, and a tree where a few files stayed writable
 * is recoverable — a half-finished install that threw is not.
 */
function lockFileReadonlySync(filePath) {
  try {
    const { mode } = statSync(filePath)
    chmodSync(filePath, (mode & 73) === 0 ? 292 : 365)
  } catch {}
}
/**
 * Sync twin of withMirrorLockLifted for writeFileSync-based generators
 * (build-hook-bundle, gen/hook-dispatch, the workspace-yaml sweep).
 *
 * `options.retryWhen` covers the case a thrown EACCES cannot: a callback that
 * SPAWNS the writer. rolldown writes the pack from a child process, so a
 * re-lock mid-build comes back as a non-zero child status, never as an
 * exception here, and the throw-path retry below never fires. A caller that
 * spawns passes a predicate over its own result, and a true answer re-lifts
 * the lock and runs the callback once more.
 */
function withMirrorLockLiftedSync(filePath, fn, options) {
  const opts = {
    __proto__: null,
    ...options,
  }
  let stat
  try {
    stat = statSync(filePath)
  } catch {
    stat = void 0
  }
  const mode = stat ? stat.mode & 511 : void 0
  const locked = mode !== void 0 && (mode & 128) === 0
  if (locked) chmodSync(filePath, mode | 128)
  try {
    const result = fn()
    if (opts.retryWhen?.(result)) {
      liftMirrorLockSync(filePath)
      return fn()
    }
    return result
  } catch (e) {
    if (isErrnoException(e) && e.code === 'EACCES') {
      liftMirrorLockSync(filePath)
      return fn()
    }
    throw e
  } finally {
    if (locked && mode !== void 0) chmodSync(filePath, mode)
  }
}

function localTemplateManifests(filesDir, manifest, dest) {
  const groups = [...(manifest.conditionalScopedFiles ?? [])]
  for (const [file, value] of Object.entries(manifest.files)) {
    const entry = value
    if (
      entry &&
      typeof entry === 'object' &&
      entry.conditional &&
      entry.triggerKind
    )
      groups.push({
        [entry.triggerKind]: entry.conditional,
        files: [file],
        ...(entry.removeWhenInactive === true
          ? { removeWhenInactive: true }
          : {}),
      })
  }
  const conditionalRoot = path.join(path.dirname(filesDir), 'conditional')
  const generatedRoot = path.join(
    path.dirname(filesDir),
    '..',
    'generated',
    'universal',
  )
  const roots = existsSync(generatedRoot)
    ? [generatedRoot, filesDir]
    : [filesDir]
  if (existsSync(conditionalRoot))
    for (const name of readdirSync(conditionalRoot).toSorted().reverse()) {
      const root = path.join(conditionalRoot, name)
      if (statSync(root).isDirectory()) roots.push(root)
    }
  const repoName = readConditionalSettings(dest)['repoName']
  if (
    typeof repoName === 'string' &&
    repoName !== '.' &&
    repoName !== '..' &&
    path.basename(repoName) === repoName
  ) {
    const overrideRoot = path.join(filesDir, '..', '..', 'overrides', repoName)
    if (existsSync(overrideRoot)) roots.push(overrideRoot)
  }
  const sources = /* @__PURE__ */ new Map()
  for (const root of roots) {
    const expanded = expandManifestForLocalTemplate(root, manifest)
    const filtered = filterManifestForConditions(
      {
        ...expanded,
        conditionalScopedFiles: groups,
      },
      dest,
    )
    for (const [file, value] of Object.entries(filtered.files))
      sources.set(file, {
        root,
        value,
      })
  }
  return roots.map(root => ({
    filesDir: root,
    manifest: {
      ...manifest,
      files: Object.fromEntries(
        [...sources]
          .filter(([, source]) => source.root === root)
          .map(([file, source]) => [file, source.value]),
      ),
    },
  }))
}
const PACKAGE_MANAGER_DIRS = /* @__PURE__ */ new Set(['.venv', 'node_modules'])
/**
 * Every regular file beneath `dir`, as paths relative to `dir`, skipping any
 * package-manager directory. Bare-node walk: this module is dep-0 and must not
 * reach for a glob library.
 */
function walkFilesRelative(dir, prefix, out) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const entry = entries[i]
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      if (PACKAGE_MANAGER_DIRS.has(entry.name)) continue
      walkFilesRelative(path.join(dir, entry.name), rel, out)
    } else if (entry.isFile()) out.push(rel)
  }
}
/**
 * Every hybrid path the expansion must leave alone: what the manifest declares
 * as a segment, plus the static mirror in `helpers.mts`.
 *
 * The mirror is load-bearing rather than belt-and-braces. A manifest built for
 * a LOCAL template carries no `segments` at all - the segment list is written
 * by the publish-bundle producer - so a manifest-only check finds nothing to
 * skip on exactly the path where the clobber happens.
 */
function hybridBundlePaths(manifest) {
  const hybrids = computeHybridPaths(manifest)
  for (const rel of HYBRID_BUNDLE_PATHS) hybrids.add(normalizeBundlePath(rel))
  return hybrids
}
/**
 * Expand a manifest into one entry per FILE that `filesDir` actually carries.
 *
 * Four shapes need handling, and only the first is one `installFiles` already
 * deals with:
 *
 * - A file entry with a source: kept as-is.
 * - A DIRECTORY entry: expanded into every file beneath it, each inheriting the
 *   directory's flags. 39 of the manifest's entries are whole-tree mirror roots
 *   (`scripts/fleet`, `.claude/hooks/fleet`, `docs/fleet/agents.md`) and they
 *   are the bulk of the payload. Expanding rather than special-casing keeps the
 *   always-tracked skip, the canonical splice and the per-file read-only lock
 *   all applying, with no second placement path to drift from the first.
 * - An entry with NO source: dropped. The manifest describes every shape the
 *   fleet can deliver, including conditional entries seeded by other fixers
 *   (`.cargo/config.darwin-signing.toml` under `hasRust`); 94 of them have no
 *   template source here.
 * - A HYBRID entry: dropped. Its live copy is half member-owned - the cascade
 *   splices the fleet block in and the repo keeps its own cutouts - so the
 *   template holds only one of the two halves, and copying it over the live
 *   file silently drops the other. `.gitignore` is the costly case: its repo
 *   region carries the mirror-untrack block, so one `--from-template`
 *   materialize re-tracked 2,973 mirrors and left a tree that read as clean.
 *   The cascade's block splicer owns these files; a whole-file copy never
 *   does.
 */
function expandManifestForLocalTemplate(filesDir, manifest) {
  const files = Object.create(null)
  const hybrids = hybridBundlePaths(manifest)
  const rels = Object.keys(manifest.files)
  for (let i = 0, { length } = rels; i < length; i += 1) {
    const rel = rels[i]
    const entry = manifest.files[rel]
    if (hybrids.has(normalizeBundlePath(rel))) continue
    const source = path.join(filesDir, normalizeBundlePath(rel))
    let stat
    try {
      stat = statSync(source)
    } catch {
      continue
    }
    if (stat.isFile()) {
      files[rel] = entry
      continue
    }
    if (!stat.isDirectory()) continue
    const nested = []
    walkFilesRelative(source, '', nested)
    for (let j = 0, { length: nestedLength } = nested; j < nestedLength; j += 1)
      files[`${rel}/${nested[j]}`] = entry
  }
  return {
    ...manifest,
    files,
  }
}

const TEXT_SOURCE_EXTENSIONS = /* @__PURE__ */ new Set([
  '.cjs',
  '.cts',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.mts',
  '.ts',
  '.yaml',
  '.yml',
])
function isConditionalTemplateSource(source, templateDir) {
  const prefix = `${normalizeBundlePath(path.join(templateDir, 'base', 'conditional'))}/`
  return normalizeBundlePath(source).startsWith(prefix)
}
function rewriteTemplateLayerContent(
  srcAbs,
  relFile,
  dirEntry,
  content,
  templateDir,
) {
  if (!isConditionalTemplateSource(srcAbs, templateDir)) return content
  const depth = [
    ...dirEntry.split('/'),
    ...path.posix.dirname(relFile).split('/'),
  ].filter(segment => segment !== '' && segment !== '.').length
  const toRoot = '../'.repeat(depth)
  return content.replace(/(['"`])(?:\.\.\/)+universal\//g, `$1${toRoot}`)
}
function localTemplateFileContent(source, memberPath, templateDir) {
  if (!isConditionalTemplateSource(source, templateDir)) return void 0
  if (!TEXT_SOURCE_EXTENSIONS.has(path.extname(source))) return void 0
  const content = readFileSync(source, 'utf8')
  const rewritten = rewriteTemplateLayerContent(
    source,
    memberPath,
    '.',
    content,
    templateDir,
  )
  return rewritten === content ? void 0 : rewritten
}

/**
 * True when the publish-bundle installer should lock what it places.
 *
 * Unconditional, matching the cascade's mirror-mode fixer: a file is protected
 * the same way whether a cascade copied it or a bundle install placed it. The
 * former CASCADE_READONLY_MIRRORS opt-out is gone, since its only real effect
 * was leaving a checkout unlocked long after the run that set it.
 */
function readonlyBundleMirrorsEnabled() {
  return true
}
/**
 * Lift a read-only lock off a placement target before the installer overwrites
 * it. `copyFileSync`/`writeFileSync` open the DESTINATION for write, so without
 * this a second install over a locked tree EACCESes on its first file. A
 * missing target is the seed path, a no-op. When the chmod itself is refused
 * the target is deleted instead — on POSIX unlink needs only a writable PARENT,
 * which is why the lock is files-only and directories stay 0755.
 */
function ensureWritableTarget(target) {
  let mode
  try {
    mode = statSync(target).mode & 511
  } catch {
    return
  }
  if ((mode & 128) !== 0) return
  try {
    chmodSync(target, mode | 128)
  } catch {
    /* c8 ignore start - chmod on a file this process owns only fails under root or an OS immutable flag (macOS chflags uchg), so a portable unit test cannot reach this fallback. */
    rm(target, dirname(target))
  }
}
/**
 * Place one file, surviving another actor re-locking it mid-flight.
 *
 * `ensureWritableTarget` lifts the lock and the write follows, but those are
 * two syscalls with a gap between them. A cascade running in a second process
 * locks each mirror right after its own copy, so it can land in that gap and
 * the write EACCESes on a file that was writable when it was checked.
 *
 * Measured: a `pnpm i` hydration died on the first mirror it reached while a
 * cascade ran beside it, and `prepare` logged it as "reported a problem —
 * continuing", leaving the tree partly materialized with no failure anyone saw.
 *
 * One retry, because the race is a narrow window rather than a contended lock —
 * a second EACCES means the target is genuinely not writable, and that throws.
 */
function placeWithLockRetry(target, write) {
  ensureWritableTarget(target)
  try {
    write()
  } catch (e) {
    const code = e?.code
    if (code !== 'EACCES' && code !== 'EPERM') throw e
    ensureWritableTarget(target)
    write()
  }
}
/**
 * True when a just-placed file may carry the read-only lock. Three classes
 * never may:
 *
 * - `manifest.generatedPaths` — rolldown and the dispatch generators REWRITE
 *   these in the member and cannot lift a lock for themselves (the rule
 *   liftMirrorLockSync documents), so locking one breaks the next build.
 * - The DESIGNATED sentinel-splice files — hybrids whose member tail below the
 *   sentinel survives every refresh.
 * - Hybrid segment paths (AGENTS.md, pnpm-workspace.yaml, settings.json) — merged
 *   per repo by installSegments, which writes them straight.
 */
function isLockablePlacement(config) {
  const cfg = {
    __proto__: null,
    ...config,
  }
  const rel = normalizeBundlePath(cfg.relPath)
  return (
    !cfg.generatedPaths.has(rel) &&
    !cfg.hybridPaths.has(rel) &&
    !isFleetCanonicalSpliceFile(rel)
  )
}

function isOpenCodeRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function mergeOpenCodeMcpSettings(fleetText, repoText) {
  const fleet = JSON.parse(fleetText)
  const repo = JSON.parse(repoText)
  if (!isOpenCodeRecord(fleet) || !isOpenCodeRecord(repo))
    throw new Error(
      'Cannot merge opencode.json: expected configuration objects. Repair the file before installing the fleet pack.',
    )
  const fleetMcp = fleet['mcp'] === void 0 ? {} : fleet['mcp']
  const repoMcp = repo['mcp'] === void 0 ? {} : repo['mcp']
  if (!isOpenCodeRecord(fleetMcp) || !isOpenCodeRecord(repoMcp))
    throw new Error(
      'Cannot merge opencode.json mcp: expected server maps. Repair the file before installing the fleet pack.',
    )
  return `${JSON.stringify(
    {
      ...repo,
      mcp: {
        ...repoMcp,
        ...fleetMcp,
      },
    },
    void 0,
    2,
  )}\n`
}

const DISPATCH_EVENTS = ['PreToolUse', 'PostToolUse', 'SessionStart', 'Stop']
const INDEX_REL = '.claude/hooks/fleet/index.cjs'
const LAUNCHER_REL = '.claude/hooks/fleet/_shared/dispatch-launcher'
/**
 * The compile-cache baseline command for an event, the cascaded canonical.
 */
function baselineCommand(event) {
  return `node "$CLAUDE_PROJECT_DIR"/${INDEX_REL} ${event}`
}
/**
 * A dispatch command for `event` in either form, baseline or launcher. Used to
 * recognize an existing dispatch entry regardless of which path it's wired to,
 * so a rewrite is idempotent and replaces, never duplicates, the entry.
 */
function isDispatchCommand(command, event) {
  return (
    command === baselineCommand(event) || command === launcherCommand(event)
  )
}
/**
 * Is `command` the launcher (fast-path) form for `event`? The signal a host has
 * opted this dispatch slot into the per-machine snapshot launcher.
 */
function isLauncherCommand(command, event) {
  return command === launcherCommand(event)
}
/**
 * The launcher fast-path command for an event (POSIX execv, host-built).
 */
function launcherCommand(event) {
  return `"$CLAUDE_PROJECT_DIR"/${LAUNCHER_REL} ${event}`
}
/**
 * The set of dispatch events `settings` has wired to the LAUNCHER (fast-path)
 * form. Used to carry a host's launcher choice across a cascade merge that
 * would otherwise reset the fleet section to the baseline.
 */
function launcherWiredEvents(settings) {
  const wired = /* @__PURE__ */ new Set()
  const hooks = settings.hooks ?? {}
  for (let i = 0, { length } = DISPATCH_EVENTS; i < length; i += 1) {
    const event = DISPATCH_EVENTS[i]
    const matchers = hooks[event] ?? []
    for (let m = 0, ml = matchers.length; m < ml; m += 1) {
      const entries = matchers[m].hooks ?? []
      for (let j = 0, hl = entries.length; j < hl; j += 1) {
        const entry = entries[j]
        if (entry.command && isLauncherCommand(entry.command, event))
          wired.add(event)
      }
    }
  }
  return wired
}
/**
 * Rewrite every recognized dispatch command in `settings` to the form
 * `make(event)` produces. Returns the number of commands changed. Mutates in
 * place; the caller decides whether to persist. Passing `baselineCommand` as
 * `make` CANONICALIZES, both forms collapse to the baseline — the shape the
 * fleet-drift comparison needs so a launcher-wired host doesn't read as drift.
 */
function rewriteDispatchCommands(settings, make) {
  let changed = 0
  const hooks = settings.hooks ?? {}
  for (let i = 0, { length } = DISPATCH_EVENTS; i < length; i += 1) {
    const event = DISPATCH_EVENTS[i]
    const matchers = hooks[event] ?? []
    for (let m = 0, ml = matchers.length; m < ml; m += 1) {
      const entries = matchers[m].hooks ?? []
      for (let j = 0, hl = entries.length; j < hl; j += 1) {
        const entry = entries[j]
        if (
          entry.type === 'command' &&
          entry.command &&
          isDispatchCommand(entry.command, event)
        ) {
          const next = make(event)
          if (entry.command !== next) {
            entry.command = next
            changed += 1
          }
        }
      }
    }
  }
  return changed
}

const FLEET_SETTINGS_BEGIN = '// <fleet>'
const FLEET_SETTINGS_END = '// </fleet>'
function cloneJson(value) {
  return JSON.parse(JSON.stringify(value))
}
function fleetSettingsKeys(settings) {
  const keys = Object.keys(settings)
  const start = keys.indexOf(FLEET_SETTINGS_BEGIN)
  const end = keys.indexOf(FLEET_SETTINGS_END)
  if (start === -1 || end === -1 || end <= start)
    throw new Error(
      'Invalid Claude settings fleet section: settings.json has missing or misordered <fleet> markers; expected one opening marker before one closing marker; fix the marker keys in the canonical template.',
    )
  return keys.slice(start, end + 1)
}
function isLegacyFleetCommentEnv(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const entries = Object.entries(value)
  if (entries.length !== 1 || entries[0]?.[0] !== '//') return false
  const comments = entries[0][1]
  return (
    Array.isArray(comments) &&
    comments.some(
      comment =>
        typeof comment === 'string' &&
        comment.includes('CLAUDE_CODE_NO_FLICKER'),
    )
  )
}
function isRepoHookCommand(command) {
  return typeof command === 'string' && command.includes('/.claude/hooks/repo/')
}
function mergeClaudeSettings(config) {
  const { fleetSettings, repoSettings } = {
    __proto__: null,
    ...config,
  }
  const fleetKeys = fleetSettingsKeys(fleetSettings)
  const fleetKeySet = new Set(fleetKeys)
  const merged = {}
  for (const key of fleetKeys) merged[key] = cloneJson(fleetSettings[key])
  if (repoSettings !== void 0) {
    spliceRepoHookEntries(merged, repoSettings)
    const hostLauncherEvents = launcherWiredEvents(repoSettings)
    if (hostLauncherEvents.size > 0)
      rewriteDispatchCommands(merged, event =>
        hostLauncherEvents.has(event)
          ? launcherCommand(event)
          : baselineCommand(event),
      )
    for (const [key, value] of Object.entries(repoSettings)) {
      if (
        fleetKeySet.has(key) ||
        key === '// <fleet>' ||
        key === '// </fleet>' ||
        (key === 'env' && isLegacyFleetCommentEnv(value))
      )
        continue
      merged[key] = cloneJson(value)
    }
  }
  return merged
}
function spliceRepoHookEntries(destination, source) {
  const sourceHooks = source.hooks
  if (sourceHooks === void 0) return
  for (const [event, matcherEntries] of Object.entries(sourceHooks)) {
    if (!Array.isArray(matcherEntries)) continue
    for (const matcherEntry of matcherEntries) {
      if (!Array.isArray(matcherEntry.hooks)) continue
      for (const hook of matcherEntry.hooks)
        if (isRepoHookCommand(hook.command))
          spliceRepoHookEntry(destination, event, matcherEntry.matcher, hook)
    }
  }
}
function spliceRepoHookEntry(settings, event, matcher, hook) {
  if (!settings.hooks || typeof settings.hooks !== 'object') settings.hooks = {}
  const eventEntries = settings.hooks[event] ?? []
  const matcherValue = matcher ?? ''
  let destination = eventEntries.find(
    entry => (entry.matcher ?? '') === matcherValue,
  )
  if (destination === void 0) {
    destination = matcherValue
      ? {
          hooks: [],
          matcher: matcherValue,
        }
      : { hooks: [] }
    eventEntries.push(destination)
    settings.hooks[event] = eventEntries
  }
  if (!Array.isArray(destination.hooks)) destination.hooks = []
  const serialized = JSON.stringify(hook)
  if (destination.hooks.some(entry => JSON.stringify(entry) === serialized))
    return
  destination.hooks.push(cloneJson(hook))
}

function replaceWorkflowJob(content, rule) {
  const blocks = parseYamlKeyBlocks(content)
  const jobs = blocks.find(block => block.key === 'jobs')
  if (!jobs) throw new Error('Workflow migration requires a jobs mapping')
  const entries = parseYamlKeyBlocks(
    jobs.lines
      .slice(1)
      .map(line => line.slice(2))
      .join('\n'),
  )
  const job = entries.find(block => block.key === rule.id)
  const digest = job
    ? computeSha256(Buffer.from([...job.head, ...job.lines].join('\n')))
    : void 0
  const historicalRepairJob =
    rule.id === 'get-green' &&
    rule.replacementId === 'repair' &&
    rule.sha256 ===
      '6fb0cfaabcf917d4a9153b44c77a39792e5b77cf39919b8d9510bd2d0b9099d1' &&
    digest ===
      '87d453bba4002dc849e930b6ee629cb12f4eeeed5dc63431863a9aab1a88b057'
  if (!job || (digest !== rule.sha256 && !historicalRepairJob)) {
    if (
      /scripts\/fleet\/get-green\.mts|pnpm\s+(?:run\s+)?get-green\b/u.test(
        content,
      )
    )
      throw new Error(
        'Cannot migrate a customized repair job that invokes retired commands. Update its repair command before retrying; source retained.',
      )
    return content
  }
  if (
    !rule.replacement ||
    entries.some(entry => entry.key === rule.replacementId && entry !== job)
  )
    throw new Error(
      'Workflow replacement is missing or conflicts with an existing job; source retained',
    )
  jobs.lines = [
    'jobs:',
    ...entries
      .map(entry =>
        entry === job
          ? rule.replacement
          : [...entry.head, ...entry.lines].join('\n'),
      )
      .join('\n')
      .split('\n')
      .map(line => (line ? `  ${line}` : '')),
  ]
  return blocks
    .flatMap(block => [...block.head, ...block.lines])
    .join('\n')
    .replace(
      /^( {4}needs:[ \t]*\n)((?: {6}-[^\n]*(?:\n|$))+)/gmu,
      (source, prefix, items) => {
        const rewritten = items.replace(
          /^( {6}-[ \t]*)(['"]?)([\w-]+)\2([ \t]*)$/gmu,
          (line, head, quote, id, tail) =>
            id === rule.id
              ? head + quote + rule.replacementId + quote + tail
              : line,
        )
        if (rewritten.includes(rule.id))
          throw new Error(
            'Cannot migrate complex job dependencies; use plain job IDs before retrying',
          )
        return rewritten === items ? source : prefix + rewritten
      },
    )
    .replace(/^( {4}needs:[ \t]*)(.+)$/gmu, (line, prefix, value) => {
      const list = value.startsWith('[') && value.endsWith(']')
      const values = list
        ? value
            .slice(1, -1)
            .split(',')
            .map(item => item.trim())
        : [value.trim()]
      const rewritten = values.map(item =>
        item.replace(/^(['"])(.*)\1$/u, '$2') === rule.id
          ? rule.replacementId
          : item,
      )
      if (rewritten.every((item, index) => item === values[index])) {
        if (value.includes(rule.id))
          throw new Error(
            'Cannot migrate complex job dependencies; use a scalar or list of job IDs before retrying',
          )
        return line
      }
      return prefix + (list ? `[${rewritten.join(', ')}]` : rewritten[0])
    })
    .replace(/\$\{\{[\s\S]*?\}\}/gu, expression =>
      expression.replaceAll(
        `needs.${rule.id}.`,
        `needs.${rule.replacementId}.`,
      ),
    )
}

function workflowScalar(value) {
  const scalar = value.trim()
  if (/[\\#,]|''/u.test(scalar))
    throw new Error(
      'Cannot migrate escaped or commented workflow metadata; simplify the scalar before retrying',
    )
  if (/^[>|&*!{\[]/u.test(scalar))
    throw new Error(
      'Cannot migrate complex workflow metadata; use a scalar name before retrying',
    )
  const quote = scalar.charCodeAt(0)
  if (quote === 34 || quote === 39) {
    if (scalar.charCodeAt(scalar.length - 1) !== quote)
      throw new Error(
        'Cannot migrate workflow metadata with trailing syntax; retain both files and resolve the name',
      )
    return scalar.slice(1, -1)
  }
  return scalar
}
function rewriteMovedWorkflow(content, destination) {
  const stem = destination
    .slice(destination.lastIndexOf('/') + 1)
    .replace(/\.ya?ml$/u, '')
  const separator = stem.indexOf('-')
  if (separator < 1 && stem !== 'ci')
    throw new Error('Workflow destination needs a type-description filename')
  const current =
    stem === 'ci'
      ? 'ci'
      : `${stem.slice(0, separator)}: ${stem.slice(separator + 1).replaceAll('-', ' ')}`
  const blocks = parseYamlKeyBlocks(content)
  const names = blocks.filter(block => block.key === 'name')
  if (names.length !== 1)
    throw new Error('Workflow migration requires one top-level name')
  const previous = workflowScalar(names[0].lines[0].slice(5))
  for (const block of blocks) {
    if (block.key !== 'name' && block.key !== 'run-name') continue
    if (
      block.lines
        .slice(1)
        .some(line => line.trim() && !line.trim().startsWith('#'))
    )
      throw new Error('Workflow migration requires single-line name metadata')
    const value = workflowScalar(block.lines[0].slice(block.key.length + 1))
    const expression = block.key === 'run-name' ? value.indexOf('${{') : -1
    const suffix = expression < 0 ? '' : ` ${value.slice(expression)}`
    block.lines[0] = `${block.key}: ${JSON.stringify(current + suffix)}`
  }
  return {
    content: blocks
      .flatMap(block => [...block.head, ...block.lines])
      .join('\n'),
    name: {
      previous,
      current,
    },
  }
}
function rewriteWorkflowMoveReferences(content, names) {
  if (/^["']on["']:/mu.test(content) && content.includes('workflow_run'))
    throw new Error(
      'Cannot migrate quoted trigger metadata; use a block on key before retrying',
    )
  const blocks = parseYamlKeyBlocks(content)
  let changed = false
  for (const block of blocks) {
    if (block.key === 'jobs')
      block.lines = block.lines.map(line => {
        const match =
          /^(\s+uses:\s*)(["']?)(\.\/\.github\/workflows\/[^\s"']+)\2\s*$/u.exec(
            line,
          )
        if (!match) return line
        const replacement = names.find(
          name => `./${name.sourcePath}` === match[3],
        )
        if (!replacement?.destinationPath) return line
        changed = true
        return `${match[1]}${JSON.stringify(`./${replacement.destinationPath}`)}`
      })
    if (block.key !== 'on') continue
    if (
      block.lines[0].slice(3).trim() &&
      block.lines[0].includes('workflow_run')
    )
      throw new Error(
        'Cannot migrate inline workflow triggers; use block metadata before retrying',
      )
    let workflowRunIndent = -1
    let listIndent = -1
    block.lines = block.lines.map(line => {
      const indent = line.length - line.trimStart().length
      if (/^\s+workflow_run:\s*\S/u.test(line))
        throw new Error(
          'Cannot migrate inline workflow_run metadata; use a block before retrying',
        )
      if (/^\s+workflow_run:\s*$/u.test(line)) {
        workflowRunIndent = indent
        return line
      }
      if (line.trim() && indent <= workflowRunIndent) workflowRunIndent = -1
      if (workflowRunIndent < 0) return line
      const match = /^(\s+workflows:\s*)(.*)$/u.exec(line)
      if (match) {
        listIndent = indent
        const value = match[2].trim()
        if (!value) return line
        const list = value.startsWith('[') && value.endsWith(']')
        const values = list ? value.slice(1, -1).split(',') : [value]
        let matched = false
        const rewritten = values.map(item => {
          const scalar = workflowScalar(item)
          const replacement = names.find(name => name.previous === scalar)
          if (replacement) matched = true
          return JSON.stringify(replacement?.current ?? scalar)
        })
        if (!matched) return line
        changed = true
        return match[1] + (list ? `[${rewritten.join(', ')}]` : rewritten[0])
      }
      if (line.trim() && indent <= listIndent) listIndent = -1
      const item = listIndent >= 0 ? /^(\s+-\s+)(.*)$/u.exec(line) : void 0
      if (!item) return line
      const scalar = workflowScalar(item[2])
      const replacement = names.find(name => name.previous === scalar)
      if (replacement) changed = true
      return replacement ? item[1] + JSON.stringify(replacement.current) : line
    })
  }
  return changed
    ? blocks.flatMap(block => [...block.head, ...block.lines]).join('\n')
    : content
}

/**
 * @file Installer-side manifest SYNC-PRUNE: the three operations that make a
 *   bundle refresh a true sync (place + prune) rather than an additive smear —
 *   apply per-repo-owned file MOVES, delete manifest TOMBSTONES, and prune
 *   stale fleet files the previous manifest owned. All three are
 *   manifest-scoped (they read the manifest / applied-files record, never a
 *   directory walk) and carry the same producer-agnostic "shipped belt" so a
 *   bad manifest entry can never touch freshly placed payload. Split out of
 *   install.mts along the sync-prune boundary to hold that file under the line
 *   cap; install.mts re-exports these so its public surface (and fleet.mts's
 *   re-export of it) is unchanged. Dep-0, same invariant as install.mts (node:
 *   builtins only, never socket-lib).
 */
function resolveMovedPath(root, relative) {
  const candidate = path.resolve(root, relative)
  if (
    path.isAbsolute(relative) ||
    path.win32.isAbsolute(relative) ||
    !isInsidePath(root, candidate)
  )
    throw new Error(
      'Cannot migrate outside the repository. Wanted a contained relative file path. Correct movedPaths before retrying.',
    )
  return candidate
}
/**
 * Apply the manifest's per-repo-owned file MOVES (`movedPaths`) — the rename
 * half of relocating a file the fleet does NOT byte-mirror. A plain tombstone
 * would delete the member's only copy with nothing in the bundle to re-create
 * it (the file is repo-owned; the bundle never ships it), so the move renames
 * `from` → `to` when `to` is absent and removes identical duplicates. Workflow
 * metadata follows the destination name; job bodies remain repo-owned. Runs
 * BEFORE removeTombstonedPaths. Idempotent: a missing `from` is a no-op.
 * Belt: a move whose `from` the current manifest ships a file at/under is
 * skipped, so a bad producer entry can never displace freshly placed payload.
 * Returns the count of paths acted on (renamed or cleaned up).
 */
function applyMovedPaths(dest, manifest, options) {
  const movedPaths = manifest.movedPaths
  if (!movedPaths || movedPaths.length === 0) return 0
  const shipped = Object.keys(manifest.files).map(rel =>
    normalizeBundlePath(rel),
  )
  const plans = []
  const workflowNames = []
  for (let i = 0, { length } = movedPaths; i < length; i += 1) {
    const entry = movedPaths[i]
    const from = normalizeBundlePath(entry.from)
    const to = normalizeBundlePath(entry.to)
    if (
      !from ||
      !to ||
      shipped.some(f => f === from || f.startsWith(`${from}/`)) ||
      [...(options?.preservedPaths ?? [])].some(
        file =>
          file === from ||
          file.startsWith(`${from}/`) ||
          file === to ||
          file.startsWith(`${to}/`),
      )
    )
      continue
    const fromAbs = resolveMovedPath(dest, from)
    const toAbs = resolveMovedPath(dest, to)
    if (fromAbs === toAbs)
      throw new Error(
        'Cannot migrate a file onto itself. Correct movedPaths before retrying; the source was retained.',
      )
    if (
      plans.some(plan =>
        [plan.from, plan.to].some(
          filename =>
            filename === fromAbs ||
            (filename === toAbs &&
              !(
                plan.to === toAbs &&
                plan.workflow !== void 0 &&
                from.startsWith('.github/workflows/') &&
                to.startsWith('.github/workflows/')
              )),
        ),
      )
    )
      throw new Error(
        'Cannot migrate overlapping file moves. Correct movedPaths before retrying; all source files were retained.',
      )
    if (!existsSync(fromAbs)) continue
    for (const filename of [fromAbs, toAbs]) {
      let current = filename
      while (current !== path.resolve(dest)) {
        if (existsSync(current) && lstatSync(current).isSymbolicLink())
          throw new Error(
            'Cannot migrate through a symbolic link; both copies were retained',
          )
        const parent = path.dirname(current)
        if (parent === current)
          throw new Error('Cannot migrate outside the repository boundary')
        current = parent
      }
    }
    if (!lstatSync(fromAbs).isFile())
      throw new Error('Cannot migrate a non-file source; source was retained')
    const workflow =
      from.startsWith('.github/workflows/') &&
      to.startsWith('.github/workflows/')
        ? rewriteMovedWorkflow(
            entry.workflowJob
              ? replaceWorkflowJob(
                  readFileSync(fromAbs, 'utf8'),
                  entry.workflowJob,
                )
              : readFileSync(fromAbs, 'utf8'),
            to,
          )
        : void 0
    if (existsSync(toAbs) && !lstatSync(toAbs).isFile())
      throw new Error(
        'Cannot migrate onto a non-file destination; source was retained',
      )
    if (workflow)
      workflowNames.push({
        ...workflow.name,
        sourcePath: from,
        destinationPath: to,
      })
    plans.push({
      from: fromAbs,
      to: toAbs,
      exists: existsSync(toAbs),
      workflow,
    })
  }
  const updates = /* @__PURE__ */ new Map()
  for (const plan of plans) {
    if (!plan.workflow) {
      if (plan.exists && !readFileSync(plan.from).equals(readFileSync(plan.to)))
        throw new Error(
          'Cannot migrate different existing file contents; both copies were retained',
        )
      continue
    }
    const content = rewriteWorkflowMoveReferences(
      plan.workflow.content,
      workflowNames,
    )
    const previous = updates.get(plan.to)
    const destination = plan.exists
      ? rewriteWorkflowMoveReferences(
          rewriteMovedWorkflow(readFileSync(plan.to, 'utf8'), plan.to).content,
          workflowNames,
        )
      : void 0
    if (
      (previous !== void 0 && previous !== content) ||
      (destination !== void 0 && destination !== content)
    )
      throw new Error(
        'Cannot migrate conflicting files. Where: ' +
          plan.to +
          '. Saw different contents; wanted identical contents after workflow metadata normalization. Merge the files before retrying; every source was retained.',
      )
    updates.set(plan.to, content)
  }
  if (workflowNames.length) {
    const directory = path.join(dest, '.github/workflows')
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !/\.ya?ml$/u.test(entry.name)) continue
      const filename = path.join(directory, entry.name)
      const plan = plans.find(item => item.from === filename)
      if (!plan && plans.some(item => item.to === filename)) continue
      const content = plan?.workflow?.content ?? readFileSync(filename, 'utf8')
      const updated = rewriteWorkflowMoveReferences(content, workflowNames)
      if (plan?.workflow || updated !== content)
        updates.set(plan?.to ?? filename, updated)
    }
  }
  const movedWorkflowDestinations = new Set(
    plans.filter(plan => plan.workflow).map(plan => plan.to),
  )
  const plannedChangedPaths = /* @__PURE__ */ new Set()
  for (const plan of plans) {
    plannedChangedPaths.add(normalizeBundlePath(path.relative(dest, plan.from)))
    if (!plan.exists)
      plannedChangedPaths.add(normalizeBundlePath(path.relative(dest, plan.to)))
  }
  for (const filename of updates.keys())
    plannedChangedPaths.add(normalizeBundlePath(path.relative(dest, filename)))
  if (options?.allowChangedPaths?.([...plannedChangedPaths]) === false) return 0
  for (const plan of plans)
    if (existsSync(plan.to)) rm(plan.from, dest)
    else {
      mkdirSync(path.dirname(plan.to), { recursive: true })
      renameSync(plan.from, plan.to)
    }
  for (const [filename, content] of updates) {
    const mode = lstatSync(filename).mode & 4095
    const needsOwnerWrite = (mode & 128) === 0
    if (needsOwnerWrite) chmodSync(filename, mode | 128)
    try {
      writeFileSync(filename, content)
    } finally {
      if (needsOwnerWrite && !movedWorkflowDestinations.has(filename))
        chmodSync(filename, mode)
    }
  }
  for (const changedPath of plannedChangedPaths)
    options?.changedPaths?.add(changedPath)
  return plans.length
}
/**
 * Delete the manifest's TOMBSTONED paths (`removedPaths`) — files or whole
 * dirs a past bundle shipped that the wheelhouse has since moved/retired. The
 * applied-files prune below only covers a member whose record OWNED the old
 * path; a fresh clone or a member whose record began after the move keeps the
 * orphan forever (the v1.0.12 `.github/actions/fleet/lib` → `_shared` move did
 * exactly that fleet-wide). Manifest-scoped like the prune — never a directory
 * walk. Belt: a tombstone the current manifest ships a file at/under is
 * skipped, so a bad producer entry can never delete freshly placed payload.
 */
function removeTombstonedPaths(dest, manifest, options) {
  const removedPaths = manifest.removedPaths
  if (!removedPaths || removedPaths.length === 0) return 0
  const shipped = Object.keys(manifest.files).map(rel =>
    normalizeBundlePath(rel),
  )
  let removed = 0
  for (let i = 0, { length } = removedPaths; i < length; i += 1) {
    const rel = normalizeBundlePath(removedPaths[i])
    if (
      !rel ||
      shipped.some(f => f === rel || f.startsWith(`${rel}/`)) ||
      [...(options?.preservedPaths ?? [])].some(
        file => file === rel || file.startsWith(`${rel}/`),
      )
    )
      continue
    const abs = path.join(dest, rel)
    if (existsSync(abs)) {
      rm(abs, dest)
      removed += 1
    }
  }
  return removed
}
function pruneStaleFleetFiles(dest, manifest, previousFiles, options) {
  const opts = {
    __proto__: null,
    ...options,
  }
  const { archiveManifest } = opts
  const candidates = new Set(previousFiles)
  const repoOwnedPaths = new Set(
    (manifest.repoOwnedFiles ?? []).map(normalizeBundlePath),
  )
  for (const group of archiveManifest?.conditionalScopedFiles ?? [])
    for (const file of group.files) {
      const absolute = path.join(dest, normalizeBundlePath(file))
      if (
        !Object.hasOwn(manifest.files, file) &&
        existsSync(absolute) &&
        lstatSync(absolute).isFile() &&
        (group.removeWhenInactive === true ||
          computeSha256(readFileSync(absolute)) ===
            archiveManifest?.files[file])
      )
        candidates.add(file)
    }
  const kept = new Set(Object.keys(manifest.files).map(normalizeBundlePath))
  for (const segment of manifest.segments ?? [])
    kept.add(normalizeBundlePath(segment.path))
  if (manifest.settingsSegment !== void 0)
    kept.add(normalizeBundlePath(manifest.settingsSegment.path))
  let pruned = 0
  for (const file of candidates) {
    const rel = normalizeBundlePath(file)
    if (
      kept.has(rel) ||
      repoOwnedPaths.has(rel) ||
      [...(opts.preservedPaths ?? [])].some(
        file => file === rel || file.startsWith(`${rel}/`),
      )
    )
      continue
    const abs = path.join(dest, rel)
    if (existsSync(abs)) {
      rm(abs, dest)
      pruned += 1
    }
  }
  return pruned
}

const logger$2 = getDep0Logger()
/**
 * Whether the target already holds the exact bytes a placement would write.
 *
 * Size first, because a differing size settles it without reading either file.
 * WHY skip at all: this runs from the pnpm `prepare` lifecycle, so it fires on
 * EVERY `pnpm run <anything>`, and an unconditional copy rewrote all ~3.5k
 * mirrors each time. That churns every mtime and leaves a window where a
 * concurrent reader sees a half-rewritten tree — measured as spurious failures
 * in tests that shell out to `git status` while a second pnpm invocation was
 * mid-prepare.
 */
function hasIdenticalBytes(source, target) {
  if (!existsSync(target)) return false
  try {
    if (statSync(source).size !== statSync(target).size) return false
    return readFileSync(source).equals(readFileSync(target))
  } catch {
    return false
  }
}
/**
 * List files recursively under a directory, skipping package manager dirs.
 */
function listFilesRecursive(dir, prefix = '') {
  const files = []
  if (!existsSync(dir)) return files
  try {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.venv') continue
        files.push(...listFilesRecursive(path.join(dir, entry.name), rel))
      } else if (entry.isFile()) files.push(rel)
    }
  } catch {}
  return files
}
/**
 * Recursively copy a directory, skipping package manager directories.
 */
function copyDirectorySync(src, dest, options) {
  const opts = {
    __proto__: null,
    ...options,
  }
  mkdirSync(dest, { recursive: true })
  const entries = readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.venv') continue
      copyDirectorySync(srcPath, destPath, options)
    } else if (entry.isFile()) {
      copyFileSync(srcPath, destPath)
      opts.lock?.(destPath)
    }
  }
}
/**
 * Load mirror entries from bundle.json in the repo root, if it exists.
 * Returns empty array if not found or on parse error.
 */
function loadMirrorEntriesFromBundle(dest) {
  try {
    const bundlePath = path.join(
      dest,
      'scripts/repo/commit-cascade/manifest/bundle.json',
    )
    if (!existsSync(bundlePath)) return []
    const content = readFileSync(bundlePath, 'utf8')
    return JSON.parse(content).mirror ?? []
  } catch {
    return []
  }
}
/**
 * The lock callback a mirror replace uses, or undefined when locking is off.
 * Shared so both call sites cannot drift apart and leave a tree writable.
 */
function mirrorLockFor(dest, generatedPaths, hybridPaths) {
  if (!readonlyBundleMirrorsEnabled()) return
  return target => {
    const relPath = normalizeBundlePath(path.relative(dest, target))
    if (
      isLockablePlacement({
        generatedPaths,
        hybridPaths,
        relPath,
      })
    )
      lockFileReadonlySync(target)
  }
}
/**
 * Build the bootstrap mirror's skip predicate from the same effective manifest
 * that placed files. Paths filtered by a capability, condition, or build shape
 * remain live-only until the matching prune phase handles them. Entries with a
 * separate source root remain live until their own mirror places them.
 */
function mirrorSkipPredicate(manifest, effectiveManifest, mirrorEntries) {
  const declared = new Set(
    [
      ...Object.keys(manifest.files),
      ...Object.keys(effectiveManifest.files),
    ].map(normalizeBundlePath),
  )
  const separatelyMirrored = mirrorEntries
    .filter(entry => entry.sourceRoot !== void 0)
    .map(entry => normalizeBundlePath(entry.path))
  return relative => {
    const normalized = normalizeBundlePath(relative)
    if (declared.has(normalized)) return true
    for (const prefix of separatelyMirrored)
      if (normalized === prefix || normalized.startsWith(`${prefix}/`))
        return true
    return false
  }
}
/**
 * Stage a complete mirror, quarantine omitted live files, and atomically swap
 * the staged directory into place when drift is present.
 */
function ensureDirectoryMirrorsMatch(filesDir, dest, mirrorEntries, options) {
  const opts = {
    __proto__: null,
    ...options,
  }
  for (const entry of mirrorEntries) {
    if (entry.type !== 'dir') continue
    const sourcePath = path.join(filesDir, normalizeBundlePath(entry.path))
    const targetPath = path.join(dest, entry.path)
    if (!existsSync(targetPath)) continue
    const sourceFiles = new Set(
      listFilesRecursive(sourcePath).map(normalizeBundlePath),
    )
    const targetFiles = new Set(
      listFilesRecursive(targetPath).map(normalizeBundlePath),
    )
    const skip = opts.skip ?? (() => false)
    const comparableTargetFiles = new Set(
      [...targetFiles].filter(
        file =>
          !skip(`${entry.path}/${file}`) &&
          !RELEASE_ONLY_DIR_MIRROR_FILES.includes(`${entry.path}/${file}`),
      ),
    )
    if (
      sourceFiles.size > 0 &&
      comparableTargetFiles.size > 0 &&
      comparableTargetFiles.size / sourceFiles.size >
        (entry.maxShrinkRatio ?? 2)
    ) {
      const ratio = comparableTargetFiles.size / sourceFiles.size
      const declaration =
        entry.maxShrinkRatio === void 0
          ? 'no maxShrinkRatio declaration'
          : `maxShrinkRatio=${entry.maxShrinkRatio}`
      throw new Error(
        `install-fleet: refused to shrink directory mirror ${entry.path}. Saw ${sourceFiles.size} source file(s) for ${comparableTargetFiles.size} live file(s), a ${ratio.toFixed(2)}x shrink (${declaration}); wanted a declared ratio that covers the replacement. Fix: materialize the complete mirror source or declare the intentional ratio.`,
      )
    }
    let hasDrift = false
    for (const file of targetFiles)
      if (
        !sourceFiles.has(file) &&
        !skip(`${entry.path}/${file}`) &&
        !RELEASE_ONLY_DIR_MIRROR_FILES.includes(`${entry.path}/${file}`)
      ) {
        hasDrift = true
        break
      }
    if (hasDrift && sourceFiles.size > 0) {
      const swapRoot = path.join(dest, '.cache', 'repo', 'bootstrap-mirrors')
      const swapKey = normalizeBundlePath(entry.path).replaceAll('/', '__')
      const runKey = `${process$1.pid}.${randomUUID()}`
      const stagePath = path.join(swapRoot, `${swapKey}.${runKey}.incoming`)
      const oldPath = path.join(swapRoot, `${swapKey}.${runKey}.outgoing`)
      const quarantineRoot = path.join(
        dest,
        '.cache',
        'repo',
        'bootstrap-reaped',
        `${swapKey}.${runKey}`,
      )
      try {
        mkdirSync(stagePath, { recursive: true })
        copyDirectorySync(sourcePath, stagePath, opts)
        const preserved = [...targetFiles].filter(
          file =>
            skip(`${entry.path}/${file}`) ||
            RELEASE_ONLY_DIR_MIRROR_FILES.includes(`${entry.path}/${file}`),
        )
        for (const file of preserved) {
          const source = path.join(targetPath, file)
          const staged = path.join(stagePath, file)
          mkdirSync(path.dirname(staged), { recursive: true })
          if (existsSync(staged)) chmodSync(staged, 420)
          copyFileSync(source, staged)
          opts.lock?.(staged)
        }
        const quarantined = [...targetFiles].filter(
          file =>
            !sourceFiles.has(file) &&
            !skip(`${entry.path}/${file}`) &&
            !RELEASE_ONLY_DIR_MIRROR_FILES.includes(`${entry.path}/${file}`),
        )
        for (const file of quarantined) {
          const parked = path.join(quarantineRoot, file)
          mkdirSync(path.dirname(parked), { recursive: true })
          copyFileSync(path.join(targetPath, file), parked)
        }
        mkdirSync(path.dirname(targetPath), { recursive: true })
        let movedAside = false
        if (existsSync(targetPath)) {
          renameSync(targetPath, oldPath)
          movedAside = true
        }
        try {
          renameSync(stagePath, targetPath)
        } catch (e) {
          if (movedAside && existsSync(oldPath)) renameSync(oldPath, targetPath)
          throw e
        }
        if (existsSync(oldPath))
          rmSync(oldPath, {
            force: true,
            recursive: true,
          })
      } catch (e) {
        if (existsSync(stagePath))
          rmSync(stagePath, {
            force: true,
            recursive: true,
          })
        logger$2.log(
          `install-fleet: failed to sync directory mirror ${entry.path}: ${errorMessage(e)}`,
        )
      }
    }
  }
}
function isPreservedInstallPath(relative, options) {
  const opts = {
    __proto__: null,
    ...options,
  }
  const segments = normalizeBundlePath(relative).split('/')
  for (let index = 1; index <= segments.length; index += 1)
    if (opts.preservedPaths?.has(segments.slice(0, index).join('/')))
      return true
  return false
}
function installFiles(filesDir, dest, manifest, options) {
  const opts = {
    __proto__: null,
    ...options,
  }
  const refreshTracked = opts.refreshTracked === true
  const locking = readonlyBundleMirrorsEnabled()
  const generatedPaths = new Set(
    (manifest.generatedPaths ?? []).map(normalizeBundlePath),
  )
  const repoOwnedPaths = new Set(
    (manifest.repoOwnedFiles ?? []).map(normalizeBundlePath),
  )
  const hybridPaths = computeHybridPaths(manifest)
  const rels = Object.keys(manifest.files)
  let placed = 0
  let unchanged = 0
  let skippedAlwaysTracked = 0
  let skippedRepoOwned = 0
  const refreshedTracked = []
  for (let i = 0, { length } = rels; i < length; i += 1) {
    const rel = rels[i]
    const target = path.join(dest, rel)
    const stat = repoOwnedPaths.has(normalizeBundlePath(rel))
      ? lstatSync(target, { throwIfNoEntry: false })
      : void 0
    if (stat !== void 0) {
      if (stat.isFile() && (stat.mode & 128) === 0)
        chmodSync(target, (stat.mode & 511) | 128)
      skippedRepoOwned += 1
      continue
    }
    if (isPreservedInstallPath(rel, { preservedPaths: opts.preservedPaths })) {
      skippedAlwaysTracked += 1
      continue
    }
    const source = path.join(filesDir, rel)
    const rewritten =
      opts.templateDir === void 0
        ? void 0
        : localTemplateFileContent(source, rel, opts.templateDir)
    mkdirSync(path.dirname(target), { recursive: true })
    let spliced
    if (rel === 'opencode.json' && existsSync(target))
      spliced = mergeOpenCodeMcpSettings(
        rewritten ?? readFileSync(source, 'utf8'),
        readFileSync(target, 'utf8'),
      )
    if (isFleetCanonicalSpliceFile(rel) && existsSync(target)) {
      const sourceContent = rewritten ?? readFileSync(source, 'utf8')
      if (hasFleetCanonicalEndSentinel(sourceContent))
        spliced = spliceFleetCanonicalContent(
          sourceContent,
          readFileSync(target, 'utf8'),
        )
    }
    if (
      (isAlwaysTrackedSurface(rel) || rel === '.gitignore') &&
      existsSync(target)
    ) {
      if (!refreshTracked && spliced === void 0) {
        if (
          locking &&
          !repoOwnedPaths.has(normalizeBundlePath(rel)) &&
          isLockablePlacement({
            generatedPaths,
            hybridPaths,
            relPath: rel,
          })
        )
          lockFileReadonlySync(target)
        skippedAlwaysTracked += 1
        continue
      }
      if (refreshTracked) refreshedTracked.push(rel)
    }
    if (spliced !== void 0) {
      const content = spliced
      if (readFileSync(target, 'utf8') === content) {
        unchanged += 1
        continue
      }
      placeWithLockRetry(target, () => writeFileSync(target, content))
      placed += 1
      continue
    }
    if (
      rewritten === void 0
        ? hasIdenticalBytes(source, target)
        : existsSync(target) && readFileSync(target, 'utf8') === rewritten
    ) {
      unchanged += 1
      if (
        locking &&
        !repoOwnedPaths.has(normalizeBundlePath(rel)) &&
        isLockablePlacement({
          generatedPaths,
          hybridPaths,
          relPath: rel,
        })
      )
        lockFileReadonlySync(target)
      continue
    }
    placeWithLockRetry(target, () => {
      if (rewritten === void 0) copyFileSync(source, target)
      else writeFileSync(target, rewritten)
    })
    placed += 1
    if (
      locking &&
      !repoOwnedPaths.has(normalizeBundlePath(rel)) &&
      isLockablePlacement({
        generatedPaths,
        hybridPaths,
        relPath: rel,
      })
    )
      lockFileReadonlySync(target)
  }
  return {
    placed,
    skippedAlwaysTracked,
    skippedRepoOwned,
    refreshedTracked,
    unchanged,
  }
}
/**
 * Materialize the fleet mirrors in a PRODUCER checkout from its own
 * `template/base/universal`, rather than from a fetched bundle.
 *
 * The wheelhouse holds the canon locally, so it has no bundle to fetch and is
 * not a fleet-pack consumer. That is the only reason its mirrors stayed in
 * version control: nothing else could put them back. Producing the payload does
 * not require tracking the output, so this is the producer's belt.
 *
 * Why it must live in this dep-0 entry and not in the cascade: the cascade
 * cannot load without the payload it would be materializing.
 * `template/base/universal/scripts/fleet/land.mts` and its siblings import
 * the LIVE `.claude/hooks/fleet/_shared/**`, so a checkout whose mirrors are
 * absent dies at module resolution before any fixer runs. Same reason the
 * fetcher cannot ship inside the bundle it fetches.
 *
 * Returns undefined when `template/base/universal` is absent, which is every
 * consumer: the caller then knows this checkout is not a producer and fetches
 * instead.
 */
function materializeFromLocalTemplate(dest, manifest, options) {
  const filesDir = sharedTemplateBasePath(dest)
  if (!existsSync(filesDir)) return
  const preservedPaths = options?.preserveTracked
    ? new Set(
        execFileSync('git', ['ls-files', '--cached', '-z'], {
          cwd: dest,
          encoding: 'utf8',
        })
          .split('\0')
          .filter(Boolean)
          .map(normalizeBundlePath),
      )
    : options?.preservedPaths
  migrateRuleFile(dest, { preservedPaths })
  const localRepoOwnedFiles = Object.entries(manifest.files)
    .filter(([, entry]) => {
      if (entry === null || typeof entry !== 'object') return false
      const metadata = entry
      return metadata.owner === 'repo' && metadata.seedIfAbsent === true
    })
    .map(([rel]) => normalizeBundlePath(rel))
  const shaped = effectiveMemberManifest(
    {
      ...manifest,
      repoOwnedFiles: [
        ...(manifest.repoOwnedFiles ?? []),
        ...localRepoOwnedFiles,
      ],
    },
    dest,
  )
  const total = {
    placed: 0,
    unchanged: 0,
    skippedAlwaysTracked: 0,
    skippedRepoOwned: 0,
    refreshedTracked: [],
  }
  for (const source of localTemplateManifests(filesDir, shaped, dest)) {
    const result = installFiles(source.filesDir, dest, source.manifest, {
      ...options,
      preservedPaths,
      templateDir: path.join(dest, 'template'),
    })
    total.placed += result.placed
    total.unchanged += result.unchanged
    total.skippedAlwaysTracked += result.skippedAlwaysTracked
    total.skippedRepoOwned += result.skippedRepoOwned
    total.refreshedTracked.push(...result.refreshedTracked)
  }
  const mirrorEntries = loadMirrorEntriesFromBundle(dest)
  if (mirrorEntries.length > 0) {
    const skipMirrorPath = mirrorSkipPredicate(manifest, shaped, mirrorEntries)
    ensureDirectoryMirrorsMatch(filesDir, dest, mirrorEntries, {
      lock: mirrorLockFor(
        dest,
        new Set((manifest.generatedPaths ?? []).map(normalizeBundlePath)),
        computeHybridPaths(manifest),
      ),
      skip: relative =>
        skipMirrorPath(relative) ||
        isPreservedInstallPath(relative, { preservedPaths }) ||
        (options?.refreshTracked !== true && isAlwaysTrackedSurface(relative)),
    })
  }
  return total
}
/**
 * Untrack the bundle's GENERATED build outputs (`manifest.generatedPaths`) from
 * the git index after placement. The bundle SHIPS these files — placement
 * writes them to disk — while the fleet gitignore block ignores them and
 * `generated-outputs-are-untracked` forbids TRACKING them. A member that
 * historically committed one (fleet-pack.generated.cjs et al., before the
 * ignore existed) heals on the next refresh: the file stays on disk, but leaves
 * the index. Non-fatal by design — a non-git dest or an already-clean index is
 * a no-op (`--ignore-unmatch`).
 */
function untrackGeneratedOutputs(dest, generatedPaths) {
  if (!generatedPaths || generatedPaths.length === 0) return
  if (!existsSync(path.join(dest, '.git'))) return
  try {
    execFileSync(
      'git',
      [
        'rm',
        '--cached',
        '--quiet',
        '--ignore-unmatch',
        '--',
        ...generatedPaths,
      ],
      {
        cwd: dest,
        stdio: 'ignore',
      },
    )
  } catch (e) {
    logger$2.log(
      `install-fleet: untracking generated outputs failed (non-fatal) — ${errorMessage(e)}`,
    )
  }
}
/**
 * Apply each fleet-canonical segment: read the `.fleetblock` file, read the
 * consumer's existing file (or start with an empty string), splice the block
 * in, and write back.
 */
function installSegments(segmentsDir, dest, manifest, options) {
  const opts = {
    __proto__: null,
    ...options,
  }
  const segments = manifest.segments
  if (!segments || segments.length === 0) return
  migrateRuleFile(dest, opts)
  for (const entry of segments) {
    const destName = segmentFileName(entry.path)
    const blockPath = path.join(segmentsDir, destName)
    const fleetBlock = readFileSync(blockPath, 'utf8')
    const targetPath = path.join(dest, entry.path)
    const existing = existsSync(targetPath)
      ? readFileSync(targetPath, 'utf8')
      : ''
    const updated =
      entry.path === '.gitignore'
        ? composeGitignore({
            target: existing,
            fleetBlock,
          })
        : entry.path === '.gitattributes'
          ? spliceFleetOwnedCutouts(existing, fleetBlock)
          : spliceFleetBlock({
              commentStyle: entry.commentStyle,
              fleetBlock,
              target: existing,
            })
    mkdirSync(path.dirname(targetPath), { recursive: true })
    writeFileSync(targetPath, updated)
  }
}
/**
 * Merge the release's canonical Claude settings section into the consumer's
 * hybrid file. Fleet keys are replaced; repo-owned top-level settings and
 * `.claude/hooks/repo/` registrations survive. Malformed JSON fails closed.
 */
function installSettingsSegment(segmentsDir, dest, manifest) {
  const segment = manifest.settingsSegment
  if (segment === void 0) return 0
  const sourcePath = path.join(segmentsDir, segmentFileName(segment.path))
  if (!existsSync(sourcePath)) {
    logger$2.log(
      `install-fleet: Claude settings segment missing at ${sourcePath} — refusing to merge.`,
    )
    return 1
  }
  const targetPath = path.join(dest, segment.path)
  try {
    const fleetSettings = JSON.parse(readFileSync(sourcePath, 'utf8'))
    const repoSettings = existsSync(targetPath)
      ? JSON.parse(readFileSync(targetPath, 'utf8'))
      : void 0
    const merged = mergeClaudeSettings({
      fleetSettings,
      repoSettings,
    })
    mkdirSync(path.dirname(targetPath), { recursive: true })
    writeFileSync(targetPath, `${JSON.stringify(merged, void 0, 2)}\n`)
    return 0
  } catch (e) {
    logger$2.log(
      `install-fleet: Claude settings merge failed for ${targetPath}: ${errorMessage(e)}. Nothing written.`,
    )
    return 1
  }
}
/**
 * If the manifest includes a `workspaceSegment`, merge the fleet-managed
 * sections into the consumer's `pnpm-workspace.yaml`. Returns 0 on success,
 * 1 on any error (fail-closed).
 */
function installWorkspaceSegment(segmentsDir, dest, manifest) {
  const ws = manifest.workspaceSegment
  if (ws === void 0) return 0
  const fleetFile = path.join(segmentsDir, 'pnpm-workspace.yaml.fleet')
  if (!existsSync(fleetFile)) {
    logger$2.log(
      `install-fleet: workspace segment file missing at ${fleetFile} — skipping workspace merge`,
    )
    return 0
  }
  const bundleFleetSections = readFileSync(fleetFile, 'utf8')
  const targetPath = path.join(dest, 'pnpm-workspace.yaml')
  const consumerYaml = existsSync(targetPath)
    ? readFileSync(targetPath, 'utf8')
    : ''
  try {
    const merged = mergeWorkspaceYaml({
      ...prepareWorkspacePatchMerge({
        bundleFleetSections,
        consumerYaml: migrateWorkspaceSettings(dest, consumerYaml),
        root: dest,
        groups: manifest.conditionalScopedFiles,
      }),
      fleetKeys: ws.fleetKeys,
    })
    writeFileSync(targetPath, merged)
  } catch (e) {
    logger$2.log(
      `install-fleet: pnpm-workspace.yaml merge failed — ${errorMessage(e)}. Nothing written.`,
    )
    return 1
  }
  return 0
}
const SYNC_FLEET_SCRIPT = 'node scripts/repo/bootstrap/fleet.mjs'
const PREPARE_FETCH = 'node scripts/repo/bootstrap/prepare.mts'
/**
 * The PRODUCER belt: materialize the mirrors from this checkout's own
 * `template/base/universal` instead of fetching a bundle. The wheelhouse's
 * counterpart to PREPARE_FETCH, and it runs in the same slot for the same
 * reason — the git-hooks installer it precedes is itself one of the untracked
 * mirrors.
 */
const PREPARE_FROM_TEMPLATE =
  'node scripts/repo/bootstrap/fleet.mjs --from-template'
/**
 * Wire the consumer's package.json for thin distribution: a `sync-fleet` script
 * (manual full re-fetch) and the `prepare` BELT — the idempotent auto-fetch
 * prepended so a fresh clone / CI `pnpm install` repopulates the untracked
 * fleet payload BEFORE the (itself-untracked) install-git-hooks step + any
 * chained build runs. Idempotent: skips when both are already in place. No-ops
 * if package.json is absent. (Dep-0 file — raw JSON, not EditablePackageJson.)
 */
function wirePackageJson(dest) {
  const pkgPath = path.join(dest, 'package.json')
  if (!existsSync(pkgPath)) {
    logger$2.log(
      `install-fleet: --wire: no package.json at ${pkgPath} — skipping`,
    )
    return
  }
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  const scripts = pkg['scripts'] ?? {}
  let changed = false
  if (scripts['sync-fleet'] !== 'node scripts/repo/bootstrap/fleet.mjs') {
    scripts['sync-fleet'] = SYNC_FLEET_SCRIPT
    changed = true
  }
  const prepare = scripts['prepare']
  if (!prepare) {
    scripts['prepare'] = PREPARE_FETCH
    changed = true
  } else if (!prepare.startsWith('node scripts/repo/bootstrap/prepare.mts')) {
    scripts['prepare'] = `${PREPARE_FETCH} && ${prepare}`
    changed = true
  }
  if (!changed) return
  pkg['scripts'] = scripts
  writeFileSync(pkgPath, `${JSON.stringify(pkg, void 0, 2)}\n`)
}

const TLS_CODES = [
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
]
/**
 * Read the `code` off an unknown throwable. Pure, and tolerant: a rejected
 * promise can carry a string, an AggregateError, or nothing useful at all.
 */
function errorCode(error) {
  if (typeof error !== 'object' || error === null) return ''
  const code = error.code
  if (typeof code === 'string') return code
  const errors = error.errors
  if (Array.isArray(errors) && errors.length > 0) return errorCode(errors[0])
  return ''
}
/**
 * Classify a transport failure. Pure over the error, so every branch is
 * testable without a socket.
 */
function classifyNetworkError(error) {
  const code = errorCode(error)
  if (TLS_CODES.includes(code))
    return {
      code,
      kind: 'tls',
      retryable: false,
    }
  switch (code) {
    case 'ENOTFOUND':
      return {
        code,
        kind: 'dns',
        retryable: false,
      }
    case 'EAI_AGAIN':
      return {
        code,
        kind: 'dns',
        retryable: true,
      }
    case 'ECONNREFUSED':
      return {
        code,
        kind: 'refused',
        retryable: false,
      }
    case 'ETIMEDOUT':
    case 'ESOCKETTIMEDOUT':
    case 'UND_ERR_CONNECT_TIMEOUT':
      return {
        code,
        kind: 'timeout',
        retryable: true,
      }
    case 'ECONNRESET':
    case 'EPIPE':
      return {
        code,
        kind: 'reset',
        retryable: true,
      }
    default:
      return {
        code,
        kind: 'unknown',
        retryable: false,
      }
  }
}
/**
 * The action most likely to clear each failure kind. One line, imperative, and
 * specific enough to run.
 */
function fixFor(failure, host) {
  switch (failure.kind) {
    case 'dns':
      return failure.retryable
        ? 'run the same command again; the resolver was briefly unavailable.'
        : `confirm you are online and that ${host} resolves (\`nslookup ${host}\`). Behind a split-DNS VPN, connect it first.`
    case 'refused':
      return `something rejected the connection to ${host} rather than the registry refusing it — check an HTTP(S)_PROXY setting or a firewall rule.`
    case 'reset':
      return 'run the same command again; the connection dropped mid-transfer.'
    case 'timeout':
      return 'run the same command again; if it repeats, check whether a proxy is intercepting the connection.'
    case 'tls':
      return 'the certificate chain did not verify. Inside the sandbox, point NODE_EXTRA_CA_CERTS at the persistent sfw CA (`pnpm run setup:sfw-ca`); never disable TLS verification to get past this.'
    default:
      return 'run the same command again; if it repeats, report the code above with the URL.'
  }
}
/**
 * The fail-loud message for a fetch that could not complete: what broke, where,
 * what was seen against what was wanted, and the fix. Says outright whether a
 * retry is worth it, so nobody has to guess from an errno.
 */
function networkFailureMessage(config) {
  const cfg = {
    __proto__: null,
    ...config,
  }
  const failure = classifyNetworkError(cfg.error)
  let host = cfg.url
  try {
    host = new URL(cfg.url).host
  } catch {}
  const detail =
    cfg.error instanceof Error ? cfg.error.message : String(cfg.error)
  const saw = failure.code ? `${failure.code} — ${detail}` : detail
  return `${cfg.what} could not reach ${host}.\n  Where: ${cfg.url}\n  Saw:   ${saw}\n  Wanted: an HTTP response from ${host}\n  Retry: ${failure.retryable ? 'yes, this is transient' : 'no, the same attempt fails the same way'}\n  Fix:   ${fixFor(failure, host)}`
}

const OCI_MANIFEST_ACCEPT = [
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
].join(', ')

const GHCR_HOST = 'ghcr.io'
const MAX_REDIRECTS = 5
const REQUEST_TIMEOUT_MS = 3e4
const OCI_DIGEST_RE = /^sha256:[0-9a-f]{64}$/u
const REVISION_RE = /^[0-9a-f]{40}$/u
function isOciManifestReceipt(value) {
  if (typeof value !== 'object' || value === null) return false
  const receipt = value
  return (
    typeof receipt.configDigest === 'string' &&
    OCI_DIGEST_RE.test(receipt.configDigest) &&
    typeof receipt.created === 'string' &&
    Number.isFinite(Date.parse(receipt.created)) &&
    typeof receipt.manifestDigest === 'string' &&
    OCI_DIGEST_RE.test(receipt.manifestDigest) &&
    typeof receipt.revision === 'string' &&
    REVISION_RE.test(receipt.revision) &&
    Array.isArray(receipt.layerDigests) &&
    receipt.layerDigests.length > 0 &&
    receipt.layerDigests.every(
      digest => typeof digest === 'string' && OCI_DIGEST_RE.test(digest),
    )
  )
}
const CREATED_ANNOTATION = 'org.opencontainers.image.created'
const REVISION_ANNOTATION = 'org.opencontainers.image.revision'
function ociManifestReceipt(body, manifest) {
  const configDigest = manifest.config?.digest
  const created = manifest.annotations?.[CREATED_ANNOTATION]
  const revision = manifest.annotations?.[REVISION_ANNOTATION]
  const receipt = {
    configDigest,
    created,
    layerDigests: (manifest.layers ?? []).map(layer => layer.digest),
    manifestDigest: `sha256:${sha256Hex(body)}`,
    revision,
  }
  if (!isOciManifestReceipt(receipt))
    throw new Error(
      'GHCR green manifest has incomplete identity metadata.\n  Where: OCI config, annotations, and layers\n  Saw:   a missing digest, revision, or creation time\n  Fix:   publish the pack with the current fleet-pack producer.',
    )
  return receipt
}
function sameOciManifestReceipt(left, right) {
  return (
    left.configDigest === right.configDigest &&
    left.created === right.created &&
    left.manifestDigest === right.manifestDigest &&
    left.revision === right.revision &&
    left.layerDigests.length === right.layerDigests.length &&
    left.layerDigests.every(
      (digest, index) => digest === right.layerDigests[index],
    )
  )
}
/**
 * Read the first value of a possibly-array HTTP header.
 */
function firstHeader(value) {
  return Array.isArray(value) ? value[0] : value
}
/**
 * Dep-0 HTTPS GET returning raw bytes. Follows storage redirects (GHCR serves
 * blobs from a redirected backend), dropping the Authorization header on any
 * redirect so a pre-signed storage URL is never handed a stale bearer.
 */
function httpGet(url, options) {
  return httpGetWithRedirects(url, options?.headers ?? {}, 0)
}
function httpGetWithRedirects(url, headers, redirectCount) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, res => {
      const status = res.statusCode ?? 0
      const location = firstHeader(res.headers['location'])
      if (
        status >= 300 &&
        status < 400 &&
        location &&
        redirectCount < MAX_REDIRECTS
      ) {
        res.resume()
        const nextUrl = new URL(location, url).toString()
        const nextHeaders = Object.create(null)
        for (const key of Object.keys(headers))
          if (key.toLowerCase() !== 'authorization')
            nextHeaders[key] = headers[key]
        resolve(httpGetWithRedirects(nextUrl, nextHeaders, redirectCount + 1))
        return
      }
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => {
        resolve({
          body: Buffer.concat(chunks),
          headers: res.headers,
          status,
        })
      })
    })
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(
        Object.assign(
          /* @__PURE__ */ new Error(`timed out after ${REQUEST_TIMEOUT_MS}ms`),
          { code: 'ETIMEDOUT' },
        ),
      )
    })
    req.on('error', e => {
      reject(
        new Error(
          networkFailureMessage({
            error: e,
            url,
            what: 'install-fleet: fetching the fleet bundle',
          }),
          { cause: e },
        ),
      )
    })
  })
}
/**
 * Parse a `WWW-Authenticate: Bearer realm="...",service="...",scope="..."`
 * challenge into its realm/service/scope. Returns undefined for a non-Bearer or
 * realm-less header. Reimplements docker.mts parseWwwAuthenticate dep-0.
 */
function parseWwwAuthenticate(header) {
  const bearer = /^\s*Bearer\s+(.*)$/i.exec(header)
  if (!bearer) return
  const params = Object.create(null)
  for (const match of bearer[1].matchAll(/(\w+)="([^"]*)"/g))
    params[match[1]] = match[2]
  const realm = params['realm']
  if (!realm) return
  return {
    realm,
    scope: params['scope'],
    service: params['service'],
  }
}
/**
 * The GHCR anonymous pull-token URL for a repository.
 */
function ghcrTokenUrl(repo, registry) {
  return `https://${registry}/token?scope=repository:${repo}:pull&service=${registry}`
}
/**
 * Extract the bearer token from a token-endpoint JSON body (either `token` or
 * `access_token`). Returns undefined when neither is present / parseable.
 */
function tokenFromBody(body) {
  try {
    const json = JSON.parse(body.toString('utf8'))
    return json.token || json.access_token || void 0
  } catch {
    return
  }
}
/**
 * `Authorization: Basic` for GHCR's token endpoint, built from the workflow
 * token when one is in the environment.
 *
 * A PUBLIC package needs none of this - anonymous pull is the common path and
 * stays first. A package that is private, or newly published and not yet made
 * public, answers the anonymous request with 403 and no token, which reads as
 * "confirm the package is public" and is unactionable inside a job that already
 * holds a credential for the same repo. GHCR accepts the workflow token as the
 * password with any username.
 *
 * Returns undefined when no token is in the environment, so a local run keeps
 * its anonymous behavior. Never logged: the value only ever becomes a header.
 */
function ghcrBasicAuthHeader(env) {
  const token = env['GH_TOKEN'] || env['GITHUB_TOKEN']
  if (!token) return
  return `Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`
}
/**
 * Obtain a pull token. Hits the documented token endpoint first; on anything
 * but a usable token, falls back to the 401 WWW-Authenticate challenge form
 * (probe /v2/, follow the advertised realm), and finally retries the challenge
 * WITH the workflow token when the environment carries one. Fails loud when no
 * token can be obtained.
 */
async function getGhcrToken(repo, registry, httpFn = httpGet) {
  const primaryToken = await getAnonymousGhcrToken(repo, registry, { httpFn })
  if (primaryToken) return primaryToken
  const header = firstHeader(
    (await httpFn(`https://${registry}/v2/`)).headers['www-authenticate'],
  )
  const challenge = header ? parseWwwAuthenticate(header) : void 0
  if (!challenge)
    throw new Error(`Cannot obtain a GHCR anonymous pull token.
  Where: https://${registry}/token and /v2/ for repo ${repo}\n  Saw:   no token in the endpoint body and no parseable Bearer challenge
  Fix:   confirm the package is public and speaks the OCI token flow.`)
  const params = new URLSearchParams()
  if (challenge.service) params.set('service', challenge.service)
  params.set('scope', challenge.scope ?? `repository:${repo}:pull`)
  const res = await httpFn(`${challenge.realm}?${params.toString()}`, {
    headers: { accept: 'application/json' },
  })
  let token = tokenFromBody(res.body)
  if (!token) {
    const authorization = ghcrBasicAuthHeader(process$1.env)
    if (authorization)
      token = tokenFromBody(
        (
          await httpFn(`${challenge.realm}?${params.toString()}`, {
            headers: {
              accept: 'application/json',
              authorization,
            },
          })
        ).body,
      )
  }
  if (!token)
    throw new Error(`Cannot obtain a GHCR pull token.
  Where: ${challenge.realm} for repo ${repo}\n  Saw:   HTTP ${res.status} with no token in the body, anonymously or with the workflow token\n  Fix:   make the package public, or give the job a token with read:packages on it.`)
  return token
}
async function getAnonymousGhcrToken(repo, registry, options) {
  const response = await (options?.httpFn ?? httpGet)(
    ghcrTokenUrl(repo, registry),
    { headers: { accept: 'application/json' } },
  )
  return response.status >= 200 && response.status < 300
    ? tokenFromBody(response.body)
    : void 0
}
/**
 * GET one manifest by tag or digest. Resolves a multi-arch index to its first
 * sub-manifest so a concrete image manifest that carries the artifact layer is
 * always returned. Fails loud on a non-2xx.
 */
async function fetchOciManifest(repo, ref, token, registry, httpFn = httpGet) {
  return (
    await fetchOciManifestEnvelope(repo, ref, token, registry, { httpFn })
  ).manifest
}
async function fetchOciManifestEnvelope(repo, ref, token, registry, options) {
  const httpFn = options?.httpFn ?? httpGet
  const res = await httpFn(`https://${registry}/v2/${repo}/manifests/${ref}`, {
    headers: {
      accept: OCI_MANIFEST_ACCEPT,
      authorization: `Bearer ${token}`,
    },
  })
  if (res.status < 200 || res.status >= 300)
    throw new Error(`GHCR manifest fetch failed.
  Where: /v2/${repo}/manifests/${ref} on ${registry}\n  Saw:   HTTP ${res.status}\n  Fix:   confirm the tag exists and the package is public.`)
  const manifest = JSON.parse(res.body.toString('utf8'))
  if (
    (!manifest.layers || manifest.layers.length === 0) &&
    manifest.manifests &&
    manifest.manifests.length > 0
  ) {
    const sub = manifest.manifests[0].digest
    if (!sub)
      throw new Error(`GHCR manifest index had no sub-manifest digest.
  Where: /v2/${repo}/manifests/${ref} on ${registry}\n  Saw:   empty manifests[]
  Fix:   confirm the artifact publishes at least one manifest.`)
    return fetchOciManifestEnvelope(repo, sub, token, registry, { httpFn })
  }
  return {
    body: res.body,
    manifest,
  }
}
function pickFleetManifestLayer(manifest) {
  const layers = (manifest.layers ?? []).filter(
    layer =>
      layer.mediaType === 'application/vnd.socket.fleet-pack.manifest.v1+json',
  )
  const descriptor = layers[0]
  if (
    layers.length !== 1 ||
    !descriptor?.digest ||
    !OCI_DIGEST_RE.test(descriptor.digest)
  )
    throw new Error(
      'GHCR fleet manifest layer is invalid. Where: OCI artifact layers. Saw no unique digest-identified fleet manifest; wanted one JSON manifest layer. Fix: inspect the published artifact without overwriting its immutable tag.',
    )
  return descriptor
}
function pickBundleLayer(manifest) {
  const layers = manifest.layers ?? []
  if (layers.length === 0)
    throw new Error(
      'GHCR artifact manifest carried no layers.\n  Where: the fleet-pack OCI manifest\n  Saw:   layers[] empty\n  Fix:   confirm the publish step pushed the tarball as a layer.',
    )
  const byTitle = layers.find(layer =>
    (layer.annotations?.['org.opencontainers.image.title'] ?? '').endsWith(
      '.tar.gz',
    ),
  )
  const byMedia = layers.find(layer => {
    const mediaType = layer.mediaType ?? ''
    return mediaType.includes('gzip') || mediaType.includes('tar')
  })
  const chosen = byTitle ?? byMedia ?? layers[0]
  if (!chosen.digest)
    throw new Error(
      'GHCR artifact tarball layer carried no digest.\n  Where: the fleet-pack OCI manifest layer\n  Saw:   missing layer.digest\n  Fix:   confirm the publish step recorded the blob digest.',
    )
  return chosen
}
/**
 * GET a blob by digest, following the storage redirect that GHCR issues for
 * blobs. Fails loud on a non-2xx.
 */
async function fetchBlob(repo, digest, token, registry, httpFn = httpGet) {
  const res = await httpFn(`https://${registry}/v2/${repo}/blobs/${digest}`, {
    headers: {
      accept: 'application/octet-stream',
      authorization: `Bearer ${token}`,
    },
  })
  if (res.status < 200 || res.status >= 300)
    throw new Error(`GHCR blob fetch failed.
  Where: /v2/${repo}/blobs/${digest} on ${registry}\n  Saw:   HTTP ${res.status}\n  Fix:   confirm the blob was pushed and the package is public.`)
  return res.body
}
/**
 * The SHA-256 hex digest of a Buffer.
 */
function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex')
}
/**
 * Pull the fleet-pack tarball from GHCR and write it to `destDir`. Verifies
 * the blob's SHA-256 against the manifest layer digest before writing — a
 * mismatch aborts (fail closed). Returns the written tarball path.
 */
async function pullFleetBundleTarball(config) {
  const cfg = {
    __proto__: null,
    ...config,
  }
  const registry = cfg.registry ?? 'ghcr.io'
  const httpFn = cfg.httpFn ?? httpGet
  const token = await getGhcrToken(cfg.repo, registry, httpFn)
  const envelope = await fetchOciManifestEnvelope(
    cfg.repo,
    cfg.tag,
    token,
    registry,
    { httpFn },
  )
  if (
    cfg.expectedReceipt !== void 0 &&
    !sameOciManifestReceipt(
      cfg.expectedReceipt,
      ociManifestReceipt(envelope.body, envelope.manifest),
    )
  )
    throw new Error(`GHCR immutable fleet pack does not match the green receipt.
  Where: ${cfg.tag} and the green channel\n  Saw:   different OCI config, layer, revision, creation-time, or manifest digests
  Fix:   retry after publication completes; never apply mismatched bytes.`)
  const layer = pickBundleLayer(envelope.manifest)
  const blob = await fetchBlob(cfg.repo, layer.digest, token, registry, httpFn)
  const actual = `sha256:${sha256Hex(blob)}`
  if (actual !== layer.digest)
    throw new Error(`GHCR bundle blob failed SHA-256 verification.
  Where: /v2/${cfg.repo}/blobs/${layer.digest} on ${registry}\n  Saw:   ${actual}\n  Wanted: ${layer.digest}\n  Fix:   the blob is corrupt or was tampered with; re-pull or re-publish.`)
  const tarballPath = path.join(
    cfg.destDir,
    `socket-wheelhouse-fleet-${cfg.tag}.tar.gz`,
  )
  let manifestBlob
  if (cfg.manifestPath !== void 0) {
    const descriptor = pickFleetManifestLayer(envelope.manifest)
    manifestBlob = await fetchBlob(
      cfg.repo,
      descriptor.digest,
      token,
      registry,
      httpFn,
    )
    if (`sha256:${sha256Hex(manifestBlob)}` !== descriptor.digest)
      throw new Error(
        'GHCR fleet manifest failed SHA-256 verification. Where: OCI JSON manifest blob. Saw mismatched bytes; wanted the published layer digest. Fix: retry the verified download.',
      )
  }
  writeFileSync(tarballPath, blob)
  if (cfg.manifestPath !== void 0 && manifestBlob !== void 0)
    writeFileSync(cfg.manifestPath, manifestBlob)
  return tarballPath
}

const logger$1 = getDep0Logger()
const MANIFEST_NAME$1 = 'publish-bundle-manifest.json'
/**
 * Derive the GHCR fleet-pack package repo from the gh `owner/repo`. GHCR
 * package paths are lowercase: `SocketDev/socket-wheelhouse` →
 * `socketdev/socket-wheelhouse/fleet-pack`.
 */
function ghcrBundleRepo(repo) {
  return `${repo.toLowerCase()}/fleet-pack`
}
/**
 * Extract just the publish-bundle manifest from the bundle tarball root (the
 * tarball ships it beside files/ + segments/), so the GHCR path yields the same
 * on-disk `sourceManifest` file the gh-release path downloads separately.
 */
function extractManifestFromTarball(tarball, destDir) {
  run(tarExecutable(process$1.platform, process$1.env['SystemRoot']), [
    '-xzf',
    tarball,
    '-C',
    destDir,
    MANIFEST_NAME$1,
  ])
  return path.join(destDir, MANIFEST_NAME$1)
}
async function ghcrFetchBundle(config) {
  const cfg = {
    __proto__: null,
    ...config,
  }
  const manifest = path.join(cfg.tmp, MANIFEST_NAME$1)
  return {
    manifest,
    tarball: await pullFleetBundleTarball({
      destDir: cfg.tmp,
      manifestPath: manifest,
      repo: ghcrBundleRepo(cfg.repo),
      tag: cfg.ref,
      expectedReceipt: cfg.expectedReceipt,
    }),
  }
}
/**
 * Fetch the fleet bundle from GHCR.
 *
 * GHCR supplies the tarball and the separate verified JSON manifest layer.
 * The injected fetch function lets tests run without network access.
 */
async function fetchBundleSource(config) {
  const cfg = {
    __proto__: null,
    ...config,
  }
  const fetched = await (cfg.ghcrFetch ?? ghcrFetchBundle)({
    ref: cfg.ref,
    repo: cfg.repo,
    tmp: cfg.tmp,
    expectedReceipt: cfg.expectedReceipt,
  })
  logger$1.error(
    `install-fleet: fetched ${cfg.ref} from ghcr (${ghcrBundleRepo(cfg.repo)}).`,
  )
  return {
    ...fetched,
    source: 'ghcr',
  }
}

/**
 * @file Green fleet-pack resolution helpers.
 *   Extracted from fleet.mts to keep that file under the 500-line soft cap.
 *   Dep-0 (no socket-lib): pure logic plus the anonymous GHCR reads in
 *   ghcr-fetch.mts. None do filesystem writes.
 */
const GREEN_TAG = 'green'
async function resolveGreenPack(repo) {
  try {
    const ghcrRepo = ghcrBundleRepo(repo)
    const token = await getGhcrToken(ghcrRepo, GHCR_HOST)
    const envelope = await fetchOciManifestEnvelope(
      ghcrRepo,
      GREEN_TAG,
      token,
      GHCR_HOST,
    )
    const receipt = ociManifestReceipt(envelope.body, envelope.manifest)
    const revision = receipt.revision
    if (typeof revision !== 'string') return
    const ref = `fleet-pack-${revision}`
    return /^fleet-pack-[0-9a-f]{40}$/.test(ref)
      ? {
          receipt,
          ref,
        }
      : void 0
  } catch {
    return
  }
}

function completeRegion(content, begin, end) {
  const lines = content.split(/\r?\n/)
  const start = lines.indexOf(begin)
  const finish = start === -1 ? -1 : lines.indexOf(end, start + 1)
  if (start === -1 || finish === -1) return
  return lines.slice(start, finish + 1).join('\n')
}
function isManagedGitignoreResult(index, current) {
  const fleetBlock = completeRegion(current, '# <fleet>', '# </fleet>')
  const packBlock = completeRegion(current, packBeginMarker(), packEndMarker())
  if (fleetBlock === void 0 || packBlock === void 0) return false
  const withFleet = composeGitignore({
    fleetBlock,
    target: index,
  })
  return (
    composeGitignore({
      packBlock,
      target: withFleet,
    }) === current
  )
}
function readIndexFile(dest, relative) {
  return execFileSync('git', ['show', `:${relative}`], {
    cwd: dest,
    encoding: 'buffer',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}
function restoreIndexFile(dest, relative) {
  execFileSync('git', ['checkout-index', '--force', '--', relative], {
    cwd: dest,
    stdio: 'ignore',
  })
}
function repairTrackedHydration(dest, options) {
  if (!existsSync(path.join(dest, '.git'))) return []
  const appliedFiles = new Set(
    (readAppliedFiles(dest) ?? []).map(normalizeBundlePath),
  )
  const appliedManifest = readAppliedManifest(dest) ?? {}
  if (appliedFiles.size === 0 && Object.keys(appliedManifest).length === 0)
    return []
  const repaired = []
  for (const relative of readFleetTrackedPaths(dest)) {
    if (
      relative !== '.gitignore' &&
      !appliedFiles.has(relative) &&
      !Object.hasOwn(appliedManifest, relative)
    )
      continue
    const target = path.join(dest, relative)
    if (!existsSync(target)) {
      if (options?.restoreMissing === true && appliedFiles.has(relative)) {
        restoreIndexFile(dest, relative)
        repaired.push(relative)
      }
      continue
    }
    const current = readFileSync(target)
    const appliedDigest = appliedManifest[relative]
    const index = readIndexFile(dest, relative)
    const isAppliedPayload =
      appliedDigest !== void 0 && computeSha256(current) === appliedDigest
    const isManagedGitignoreOnly =
      relative === '.gitignore' &&
      isManagedGitignoreResult(index.toString('utf8'), current.toString('utf8'))
    if (
      !current.equals(index) &&
      (isAppliedPayload || isManagedGitignoreOnly)
    ) {
      restoreIndexFile(dest, relative)
      repaired.push(relative)
    }
  }
  return repaired
}

var require_object = /* @__PURE__ */ __commonJSMin(exports => {
  Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
  const require_primordials_uncurry = require_uncurry()
  /**
   * @file Safe references to `Object` static methods and prototype methods.
   *   Annex B legacy accessor methods (`__defineGetter__`, `__lookupGetter__`,
   *   etc.) are exposed alongside the canonical static methods —
   *   implementations exist in V8, SpiderMonkey, and JavaScriptCore even though
   *   the spec calls them "normative optional".
   */
  const ObjectCtor = Object
  const ObjectAssign = Object.assign
  const ObjectCreate = Object.create
  const ObjectDefineProperties = Object.defineProperties
  const ObjectDefineProperty = Object.defineProperty
  const ObjectEntries = Object.entries
  const ObjectFreeze = Object.freeze
  const ObjectFromEntries = Object.fromEntries
  const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor
  const ObjectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors
  const ObjectGetOwnPropertyNames = Object.getOwnPropertyNames
  const ObjectGetOwnPropertySymbols = Object.getOwnPropertySymbols
  const ObjectGetPrototypeOf = Object.getPrototypeOf
  const ObjectHasOwn = Object.hasOwn
  const ObjectIs = Object.is
  const ObjectIsExtensible = Object.isExtensible
  const ObjectIsFrozen = Object.isFrozen
  const ObjectIsSealed = Object.isSealed
  const ObjectKeys = Object.keys
  const ObjectPreventExtensions = Object.preventExtensions
  const ObjectSeal = Object.seal
  const ObjectSetPrototypeOf = Object.setPrototypeOf
  const ObjectValues = Object.values
  const ObjectPrototype = Object.prototype
  const ObjectPrototypeHasOwnProperty = require_primordials_uncurry.uncurryThis(
    Object.prototype.hasOwnProperty,
  )
  const ObjectPrototypeIsPrototypeOf = require_primordials_uncurry.uncurryThis(
    Object.prototype.isPrototypeOf,
  )
  const ObjectPrototypePropertyIsEnumerable =
    require_primordials_uncurry.uncurryThis(
      Object.prototype.propertyIsEnumerable,
    )
  const ObjectPrototypeToString = require_primordials_uncurry.uncurryThis(
    Object.prototype.toString,
  )
  const ObjectPrototypeValueOf = require_primordials_uncurry.uncurryThis(
    Object.prototype.valueOf,
  )
  const objectProto = Object.prototype
  const ObjectPrototypeDefineGetter = require_primordials_uncurry.uncurryThis(
    objectProto.__defineGetter__,
  )
  const ObjectPrototypeDefineSetter = require_primordials_uncurry.uncurryThis(
    objectProto.__defineSetter__,
  )
  const ObjectPrototypeLookupGetter = require_primordials_uncurry.uncurryThis(
    objectProto.__lookupGetter__,
  )
  const ObjectPrototypeLookupSetter = require_primordials_uncurry.uncurryThis(
    objectProto.__lookupSetter__,
  )
  exports.ObjectAssign = ObjectAssign
  exports.ObjectCreate = ObjectCreate
  exports.ObjectCtor = ObjectCtor
  exports.ObjectDefineProperties = ObjectDefineProperties
  exports.ObjectDefineProperty = ObjectDefineProperty
  exports.ObjectEntries = ObjectEntries
  exports.ObjectFreeze = ObjectFreeze
  exports.ObjectFromEntries = ObjectFromEntries
  exports.ObjectGetOwnPropertyDescriptor = ObjectGetOwnPropertyDescriptor
  exports.ObjectGetOwnPropertyDescriptors = ObjectGetOwnPropertyDescriptors
  exports.ObjectGetOwnPropertyNames = ObjectGetOwnPropertyNames
  exports.ObjectGetOwnPropertySymbols = ObjectGetOwnPropertySymbols
  exports.ObjectGetPrototypeOf = ObjectGetPrototypeOf
  exports.ObjectHasOwn = ObjectHasOwn
  exports.ObjectIs = ObjectIs
  exports.ObjectIsExtensible = ObjectIsExtensible
  exports.ObjectIsFrozen = ObjectIsFrozen
  exports.ObjectIsSealed = ObjectIsSealed
  exports.ObjectKeys = ObjectKeys
  exports.ObjectPreventExtensions = ObjectPreventExtensions
  exports.ObjectPrototype = ObjectPrototype
  exports.ObjectPrototypeDefineGetter = ObjectPrototypeDefineGetter
  exports.ObjectPrototypeDefineSetter = ObjectPrototypeDefineSetter
  exports.ObjectPrototypeHasOwnProperty = ObjectPrototypeHasOwnProperty
  exports.ObjectPrototypeIsPrototypeOf = ObjectPrototypeIsPrototypeOf
  exports.ObjectPrototypeLookupGetter = ObjectPrototypeLookupGetter
  exports.ObjectPrototypeLookupSetter = ObjectPrototypeLookupSetter
  exports.ObjectPrototypePropertyIsEnumerable =
    ObjectPrototypePropertyIsEnumerable
  exports.ObjectPrototypeToString = ObjectPrototypeToString
  exports.ObjectPrototypeValueOf = ObjectPrototypeValueOf
  exports.ObjectSeal = ObjectSeal
  exports.ObjectSetPrototypeOf = ObjectSetPrototypeOf
  exports.ObjectValues = ObjectValues
})

var require_json = /* @__PURE__ */ __commonJSMin(exports => {
  Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
  /**
   * @file Safe references to `JSON.parse` / `JSON.stringify`. Captured at module
   *   load so prototype-pollution attacks (e.g. monkey-patching `JSON.parse` to
   *   leak the parsed payload) can't redirect callers that route through these
   *   references.
   */
  const JSONParse = JSON.parse
  const JSONStringify = JSON.stringify
  exports.JSONParse = JSONParse
  exports.JSONStringify = JSONStringify
})

var require_error = /* @__PURE__ */ __commonJSMin(exports => {
  Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
  /**
   * @file Safe references to `Error` and its subclass constructors, plus V8's
   *   stack-trace API. `Error.isError` is ES2025; `captureStackTrace` /
   *   `prepareStackTrace` / `stackTraceLimit` are V8 extensions absent on
   *   JavaScriptCore and SpiderMonkey. Each is typed `Function | undefined` so
   *   non-V8 importers stay safe.
   */
  const ErrorCtor = Error
  const AggregateErrorCtor = AggregateError
  const EvalErrorCtor = EvalError
  const RangeErrorCtor = RangeError
  const ReferenceErrorCtor = ReferenceError
  const SyntaxErrorCtor = SyntaxError
  const TypeErrorCtor = TypeError
  const URIErrorCtor = URIError
  const ErrorIsError = Error.isError
  const ErrorCaptureStackTrace = Error.captureStackTrace
  const ErrorPrepareStackTrace = Error.prepareStackTrace
  const stackTraceLimitGetter = (() => {
    const getter = Error.__lookupGetter__?.('stackTraceLimit')
    /* c8 ignore start */
    if (typeof getter === 'function') return () => getter.call(Error)
    /* c8 ignore stop */
  })()
  function ErrorStackTraceLimit() {
    /* c8 ignore start - non-V8 fallback path unreachable under test */
    if (stackTraceLimitGetter) return stackTraceLimitGetter()
    return Error.stackTraceLimit
    /* c8 ignore stop */
  }
  exports.AggregateErrorCtor = AggregateErrorCtor
  exports.ErrorCaptureStackTrace = ErrorCaptureStackTrace
  exports.ErrorCtor = ErrorCtor
  exports.ErrorIsError = ErrorIsError
  exports.ErrorPrepareStackTrace = ErrorPrepareStackTrace
  exports.ErrorStackTraceLimit = ErrorStackTraceLimit
  exports.EvalErrorCtor = EvalErrorCtor
  exports.RangeErrorCtor = RangeErrorCtor
  exports.ReferenceErrorCtor = ReferenceErrorCtor
  exports.SyntaxErrorCtor = SyntaxErrorCtor
  exports.TypeErrorCtor = TypeErrorCtor
  exports.URIErrorCtor = URIErrorCtor
})

var require_number = /* @__PURE__ */ __commonJSMin(exports => {
  Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
  const require_primordials_uncurry = require_uncurry()
  /**
   * @file Safe references to `Number`, its constants, predicates, and parse
   *   helpers. Predicates prefer the smol fast-path (`node:smol-primordial`);
   *   static `parseFloat` / `parseInt` use the FastOneByteString-typed bindings
   *   for ASCII inputs and fall back to stock `Number.parse*` otherwise.
   */
  const smolPrimordial = require_primordial().getSmolPrimordial()
  const NumberCtor = Number
  const NumberEPSILON = Number.EPSILON
  const NumberMAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER
  const NumberMAX_VALUE = Number.MAX_VALUE
  const NumberMIN_SAFE_INTEGER = Number.MIN_SAFE_INTEGER
  const NumberMIN_VALUE = Number.MIN_VALUE
  const NumberNEGATIVE_INFINITY = Number.NEGATIVE_INFINITY
  const NumberPOSITIVE_INFINITY = Number.POSITIVE_INFINITY
  const NumberIsFinite = smolPrimordial?.numberIsFinite ?? Number.isFinite
  const NumberIsInteger = smolPrimordial?.numberIsInteger ?? Number.isInteger
  const NumberIsNaN = smolPrimordial?.numberIsNaN ?? Number.isNaN
  const NumberIsSafeInteger =
    smolPrimordial?.numberIsSafeInteger ?? Number.isSafeInteger
  const NumberParseFloat = smolPrimordial?.numberParseFloat ?? Number.parseFloat
  const smolParseInt10 = smolPrimordial?.numberParseInt10
  const stockParseInt = Number.parseInt
  /* c8 ignore start - the smol Fast API binding ships only on socket-btm's smol Node binary, so this body cannot run under the stock-Node runner */
  function smolNumberParseInt(s, radix) {
    return radix === void 0 || radix === 10
      ? smolParseInt10(s)
      : stockParseInt(s, radix)
  }
  /* c8 ignore stop */
  const NumberParseInt = smolParseInt10 ? smolNumberParseInt : stockParseInt
  const NumberPrototypeToExponential = require_primordials_uncurry.uncurryThis(
    Number.prototype.toExponential,
  )
  const NumberPrototypeToFixed = require_primordials_uncurry.uncurryThis(
    Number.prototype.toFixed,
  )
  const NumberPrototypeToPrecision = require_primordials_uncurry.uncurryThis(
    Number.prototype.toPrecision,
  )
  const NumberPrototypeToString = require_primordials_uncurry.uncurryThis(
    Number.prototype.toString,
  )
  const NumberPrototypeValueOf = require_primordials_uncurry.uncurryThis(
    Number.prototype.valueOf,
  )
  exports.NumberCtor = NumberCtor
  exports.NumberEPSILON = NumberEPSILON
  exports.NumberIsFinite = NumberIsFinite
  exports.NumberIsInteger = NumberIsInteger
  exports.NumberIsNaN = NumberIsNaN
  exports.NumberIsSafeInteger = NumberIsSafeInteger
  exports.NumberMAX_SAFE_INTEGER = NumberMAX_SAFE_INTEGER
  exports.NumberMAX_VALUE = NumberMAX_VALUE
  exports.NumberMIN_SAFE_INTEGER = NumberMIN_SAFE_INTEGER
  exports.NumberMIN_VALUE = NumberMIN_VALUE
  exports.NumberNEGATIVE_INFINITY = NumberNEGATIVE_INFINITY
  exports.NumberPOSITIVE_INFINITY = NumberPOSITIVE_INFINITY
  exports.NumberParseFloat = NumberParseFloat
  exports.NumberParseInt = NumberParseInt
  exports.NumberPrototypeToExponential = NumberPrototypeToExponential
  exports.NumberPrototypeToFixed = NumberPrototypeToFixed
  exports.NumberPrototypeToPrecision = NumberPrototypeToPrecision
  exports.NumberPrototypeToString = NumberPrototypeToString
  exports.NumberPrototypeValueOf = NumberPrototypeValueOf
  exports.smolNumberParseInt = smolNumberParseInt
})

var require_array$1 = /* @__PURE__ */ __commonJSMin(exports => {
  Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
  const require_primordials_uncurry = require_uncurry()
  /**
   * @file Safe references to `Array`, typed-array, `ArrayBuffer`, `DataView`,
   *   `Atomics`, and shared iterator-prototype primordials. `Array.fromAsync`
   *   and `Array.prototype.with` are ES2024 / ES2023; the primordial captures
   *   the live reference at module load so consumers never see a tampered
   *   global.
   */
  const smolPrimordial = require_primordial().getSmolPrimordial()
  const ArrayCtor = Array
  const ArrayBufferCtor = ArrayBuffer
  const DataViewCtor = DataView
  const Float32ArrayCtor = Float32Array
  const Float64ArrayCtor = Float64Array
  const Int8ArrayCtor = Int8Array
  const Int16ArrayCtor = Int16Array
  const Int32ArrayCtor = Int32Array
  const Uint8ArrayCtor = Uint8Array
  const Uint8ClampedArrayCtor = Uint8ClampedArray
  const Uint16ArrayCtor = Uint16Array
  const Uint32ArrayCtor = Uint32Array
  const ArrayFrom = Array.from
  const ArrayFromAsync = Array.fromAsync
  const ArrayIsArray = smolPrimordial?.arrayIsArray ?? Array.isArray
  const ArrayOf = Array.of
  const ArrayBufferIsView = ArrayBuffer.isView
  const AtomicsWait = Atomics.wait
  const ArrayPrototypeAt = require_primordials_uncurry.uncurryThis(
    Array.prototype.at,
  )
  const ArrayPrototypeConcat = require_primordials_uncurry.uncurryThis(
    Array.prototype.concat,
  )
  const ArrayPrototypeCopyWithin = require_primordials_uncurry.uncurryThis(
    Array.prototype.copyWithin,
  )
  const ArrayPrototypeEntries = require_primordials_uncurry.uncurryThis(
    Array.prototype.entries,
  )
  const ArrayPrototypeEvery = require_primordials_uncurry.uncurryThis(
    Array.prototype.every,
  )
  const ArrayPrototypeFill = require_primordials_uncurry.uncurryThis(
    Array.prototype.fill,
  )
  const ArrayPrototypeFilter = require_primordials_uncurry.uncurryThis(
    Array.prototype.filter,
  )
  const ArrayPrototypeFind = require_primordials_uncurry.uncurryThis(
    Array.prototype.find,
  )
  const ArrayPrototypeFindIndex = require_primordials_uncurry.uncurryThis(
    Array.prototype.findIndex,
  )
  const ArrayPrototypeFindLast = require_primordials_uncurry.uncurryThis(
    Array.prototype.findLast,
  )
  const ArrayPrototypeFindLastIndex = require_primordials_uncurry.uncurryThis(
    Array.prototype.findLastIndex,
  )
  const ArrayPrototypeFlat = require_primordials_uncurry.uncurryThis(
    Array.prototype.flat,
  )
  const ArrayPrototypeFlatMap = require_primordials_uncurry.uncurryThis(
    Array.prototype.flatMap,
  )
  const ArrayPrototypeForEach = require_primordials_uncurry.uncurryThis(
    Array.prototype.forEach,
  )
  const ArrayPrototypeIncludes = require_primordials_uncurry.uncurryThis(
    Array.prototype.includes,
  )
  const ArrayPrototypeIndexOf = require_primordials_uncurry.uncurryThis(
    Array.prototype.indexOf,
  )
  const ArrayPrototypeJoin = require_primordials_uncurry.uncurryThis(
    Array.prototype.join,
  )
  const ArrayPrototypeKeys = require_primordials_uncurry.uncurryThis(
    Array.prototype.keys,
  )
  const ArrayPrototypeLastIndexOf = require_primordials_uncurry.uncurryThis(
    Array.prototype.lastIndexOf,
  )
  const ArrayPrototypeMap = require_primordials_uncurry.uncurryThis(
    Array.prototype.map,
  )
  const ArrayPrototypePop = require_primordials_uncurry.uncurryThis(
    Array.prototype.pop,
  )
  const ArrayPrototypePush = require_primordials_uncurry.uncurryThis(
    Array.prototype.push,
  )
  const ArrayPrototypeReduce = require_primordials_uncurry.uncurryThis(
    Array.prototype.reduce,
  )
  const ArrayPrototypeReduceRight = require_primordials_uncurry.uncurryThis(
    Array.prototype.reduceRight,
  )
  const ArrayPrototypeReverse = require_primordials_uncurry.uncurryThis(
    Array.prototype.reverse,
  )
  const ArrayPrototypeShift = require_primordials_uncurry.uncurryThis(
    Array.prototype.shift,
  )
  const ArrayPrototypeSlice = require_primordials_uncurry.uncurryThis(
    Array.prototype.slice,
  )
  const ArrayPrototypeSome = require_primordials_uncurry.uncurryThis(
    Array.prototype.some,
  )
  const ArrayPrototypeSort = require_primordials_uncurry.uncurryThis(
    Array.prototype.sort,
  )
  const ArrayPrototypeSplice = require_primordials_uncurry.uncurryThis(
    Array.prototype.splice,
  )
  const ArrayPrototypeToLocaleString = require_primordials_uncurry.uncurryThis(
    Array.prototype.toLocaleString,
  )
  const ArrayPrototypeToReversed = require_primordials_uncurry.uncurryThis(
    Array.prototype.toReversed,
  )
  const ArrayPrototypeToSorted = require_primordials_uncurry.uncurryThis(
    Array.prototype.toSorted,
  )
  const ArrayPrototypeToSpliced = require_primordials_uncurry.uncurryThis(
    Array.prototype.toSpliced,
  )
  const ArrayPrototypeToString = require_primordials_uncurry.uncurryThis(
    Array.prototype.toString,
  )
  const ArrayPrototypeUnshift = require_primordials_uncurry.uncurryThis(
    Array.prototype.unshift,
  )
  const ArrayPrototypeValues = require_primordials_uncurry.uncurryThis(
    Array.prototype.values,
  )
  const ArrayPrototypeWith = require_primordials_uncurry.uncurryThis(
    Array.prototype.with,
  )
  const anyIterator = /* @__PURE__ */ new Map().keys()
  let iteratorLookup = Object.getPrototypeOf(anyIterator)
  while (iteratorLookup && typeof iteratorLookup.next !== 'function')
    /* c8 ignore next - Modern V8 puts Iterator.prototype one hop up the chain
	so the first check already finds .next; the walk-further branch fires
	only on hypothetical engines where the prototype layout differs. */
    iteratorLookup = Object.getPrototypeOf(iteratorLookup)
  const iteratorProto = iteratorLookup
  const IteratorPrototypeNext = require_primordials_uncurry.uncurryThis(
    iteratorProto.next,
  )
  /* c8 ignore start */
  const IteratorPrototypeReturn =
    typeof iteratorProto.return === 'function'
      ? require_primordials_uncurry.uncurryThis(iteratorProto.return)
      : void 0
  /* c8 ignore stop */
  exports.ArrayBufferCtor = ArrayBufferCtor
  exports.ArrayBufferIsView = ArrayBufferIsView
  exports.ArrayCtor = ArrayCtor
  exports.ArrayFrom = ArrayFrom
  exports.ArrayFromAsync = ArrayFromAsync
  exports.ArrayIsArray = ArrayIsArray
  exports.ArrayOf = ArrayOf
  exports.ArrayPrototypeAt = ArrayPrototypeAt
  exports.ArrayPrototypeConcat = ArrayPrototypeConcat
  exports.ArrayPrototypeCopyWithin = ArrayPrototypeCopyWithin
  exports.ArrayPrototypeEntries = ArrayPrototypeEntries
  exports.ArrayPrototypeEvery = ArrayPrototypeEvery
  exports.ArrayPrototypeFill = ArrayPrototypeFill
  exports.ArrayPrototypeFilter = ArrayPrototypeFilter
  exports.ArrayPrototypeFind = ArrayPrototypeFind
  exports.ArrayPrototypeFindIndex = ArrayPrototypeFindIndex
  exports.ArrayPrototypeFindLast = ArrayPrototypeFindLast
  exports.ArrayPrototypeFindLastIndex = ArrayPrototypeFindLastIndex
  exports.ArrayPrototypeFlat = ArrayPrototypeFlat
  exports.ArrayPrototypeFlatMap = ArrayPrototypeFlatMap
  exports.ArrayPrototypeForEach = ArrayPrototypeForEach
  exports.ArrayPrototypeIncludes = ArrayPrototypeIncludes
  exports.ArrayPrototypeIndexOf = ArrayPrototypeIndexOf
  exports.ArrayPrototypeJoin = ArrayPrototypeJoin
  exports.ArrayPrototypeKeys = ArrayPrototypeKeys
  exports.ArrayPrototypeLastIndexOf = ArrayPrototypeLastIndexOf
  exports.ArrayPrototypeMap = ArrayPrototypeMap
  exports.ArrayPrototypePop = ArrayPrototypePop
  exports.ArrayPrototypePush = ArrayPrototypePush
  exports.ArrayPrototypeReduce = ArrayPrototypeReduce
  exports.ArrayPrototypeReduceRight = ArrayPrototypeReduceRight
  exports.ArrayPrototypeReverse = ArrayPrototypeReverse
  exports.ArrayPrototypeShift = ArrayPrototypeShift
  exports.ArrayPrototypeSlice = ArrayPrototypeSlice
  exports.ArrayPrototypeSome = ArrayPrototypeSome
  exports.ArrayPrototypeSort = ArrayPrototypeSort
  exports.ArrayPrototypeSplice = ArrayPrototypeSplice
  exports.ArrayPrototypeToLocaleString = ArrayPrototypeToLocaleString
  exports.ArrayPrototypeToReversed = ArrayPrototypeToReversed
  exports.ArrayPrototypeToSorted = ArrayPrototypeToSorted
  exports.ArrayPrototypeToSpliced = ArrayPrototypeToSpliced
  exports.ArrayPrototypeToString = ArrayPrototypeToString
  exports.ArrayPrototypeUnshift = ArrayPrototypeUnshift
  exports.ArrayPrototypeValues = ArrayPrototypeValues
  exports.ArrayPrototypeWith = ArrayPrototypeWith
  exports.AtomicsWait = AtomicsWait
  exports.DataViewCtor = DataViewCtor
  exports.Float32ArrayCtor = Float32ArrayCtor
  exports.Float64ArrayCtor = Float64ArrayCtor
  exports.Int16ArrayCtor = Int16ArrayCtor
  exports.Int32ArrayCtor = Int32ArrayCtor
  exports.Int8ArrayCtor = Int8ArrayCtor
  exports.IteratorPrototypeNext = IteratorPrototypeNext
  exports.IteratorPrototypeReturn = IteratorPrototypeReturn
  exports.Uint16ArrayCtor = Uint16ArrayCtor
  exports.Uint32ArrayCtor = Uint32ArrayCtor
  exports.Uint8ArrayCtor = Uint8ArrayCtor
  exports.Uint8ClampedArrayCtor = Uint8ClampedArrayCtor
})

var require_math = /* @__PURE__ */ __commonJSMin(exports => {
  Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
  /**
   * @file Safe references to `Math` constants and methods. Methods prefer the
   *   smol fast-path (`node:smol-primordial`) when available — V8 Fast API
   *   typed implementations TurboFan inlines into JIT'd callers. Constants stay
   *   as the stock `Math.X` since they are pre-computed scalar values with no
   *   fast-path benefit.
   */
  const smolPrimordial = require_primordial().getSmolPrimordial()
  const MathE = Math.E
  const MathLN2 = Math.LN2
  const MathLN10 = Math.LN10
  const MathLOG2E = Math.LOG2E
  const MathLOG10E = Math.LOG10E
  const MathPI = Math.PI
  const MathSQRT1_2 = Math.SQRT1_2
  const MathSQRT2 = Math.SQRT2
  const MathAbs = smolPrimordial?.mathAbs ?? Math.abs
  const MathAcos = smolPrimordial?.mathAcos ?? Math.acos
  const MathAcosh = smolPrimordial?.mathAcosh ?? Math.acosh
  const MathAsin = smolPrimordial?.mathAsin ?? Math.asin
  const MathAsinh = smolPrimordial?.mathAsinh ?? Math.asinh
  const MathAtan = smolPrimordial?.mathAtan ?? Math.atan
  const MathAtan2 = smolPrimordial?.mathAtan2 ?? Math.atan2
  const MathAtanh = smolPrimordial?.mathAtanh ?? Math.atanh
  const MathCbrt = smolPrimordial?.mathCbrt ?? Math.cbrt
  const MathCeil = smolPrimordial?.mathCeil ?? Math.ceil
  const MathClz32 = smolPrimordial?.mathClz32 ?? Math.clz32
  const MathCos = smolPrimordial?.mathCos ?? Math.cos
  const MathCosh = smolPrimordial?.mathCosh ?? Math.cosh
  const MathExp = smolPrimordial?.mathExp ?? Math.exp
  const MathExpm1 = smolPrimordial?.mathExpm1 ?? Math.expm1
  const MathF16round = Math.f16round
  const MathFloor = smolPrimordial?.mathFloor ?? Math.floor
  const MathFround = smolPrimordial?.mathFround ?? Math.fround
  const MathHypot = smolPrimordial?.mathHypot ?? Math.hypot
  const MathImul = smolPrimordial?.mathImul ?? Math.imul
  const MathLog = smolPrimordial?.mathLog ?? Math.log
  const MathLog1p = smolPrimordial?.mathLog1p ?? Math.log1p
  const MathLog2 = smolPrimordial?.mathLog2 ?? Math.log2
  const MathLog10 = smolPrimordial?.mathLog10 ?? Math.log10
  const MathMax = Math.max
  const MathMin = Math.min
  const MathPow = smolPrimordial?.mathPow ?? Math.pow
  const MathRandom = Math.random
  const MathRound = smolPrimordial?.mathRound ?? Math.round
  const MathSign = smolPrimordial?.mathSign ?? Math.sign
  const MathSin = smolPrimordial?.mathSin ?? Math.sin
  const MathSinh = smolPrimordial?.mathSinh ?? Math.sinh
  const MathSqrt = smolPrimordial?.mathSqrt ?? Math.sqrt
  const MathTan = smolPrimordial?.mathTan ?? Math.tan
  const MathTanh = smolPrimordial?.mathTanh ?? Math.tanh
  const MathTrunc = smolPrimordial?.mathTrunc ?? Math.trunc
  exports.MathAbs = MathAbs
  exports.MathAcos = MathAcos
  exports.MathAcosh = MathAcosh
  exports.MathAsin = MathAsin
  exports.MathAsinh = MathAsinh
  exports.MathAtan = MathAtan
  exports.MathAtan2 = MathAtan2
  exports.MathAtanh = MathAtanh
  exports.MathCbrt = MathCbrt
  exports.MathCeil = MathCeil
  exports.MathClz32 = MathClz32
  exports.MathCos = MathCos
  exports.MathCosh = MathCosh
  exports.MathE = MathE
  exports.MathExp = MathExp
  exports.MathExpm1 = MathExpm1
  exports.MathF16round = MathF16round
  exports.MathFloor = MathFloor
  exports.MathFround = MathFround
  exports.MathHypot = MathHypot
  exports.MathImul = MathImul
  exports.MathLN10 = MathLN10
  exports.MathLN2 = MathLN2
  exports.MathLOG10E = MathLOG10E
  exports.MathLOG2E = MathLOG2E
  exports.MathLog = MathLog
  exports.MathLog10 = MathLog10
  exports.MathLog1p = MathLog1p
  exports.MathLog2 = MathLog2
  exports.MathMax = MathMax
  exports.MathMin = MathMin
  exports.MathPI = MathPI
  exports.MathPow = MathPow
  exports.MathRandom = MathRandom
  exports.MathRound = MathRound
  exports.MathSQRT1_2 = MathSQRT1_2
  exports.MathSQRT2 = MathSQRT2
  exports.MathSign = MathSign
  exports.MathSin = MathSin
  exports.MathSinh = MathSinh
  exports.MathSqrt = MathSqrt
  exports.MathTan = MathTan
  exports.MathTanh = MathTanh
  exports.MathTrunc = MathTrunc
})

var require_array = /* @__PURE__ */ __commonJSMin(exports => {
  Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
  const require_primordials_error = require_error()
  const require_primordials_number = require_number()
  const require_primordials_array = require_array$1()
  const require_primordials_math = require_math()
  /**
   * @file Shims for the ES2023 change-array-by-copy methods, both Node 20.
   *   Only the two the tree consumes are here: `toSorted` and `toReversed`.
   *   Both produce a DENSE result. Reading a hole yields undefined rather than
   *   propagating the hole, and `toSorted` places every undefined at the end
   *   regardless of the comparator, which is the part a `[...arr].sort(cmp)`
   *   rewrite gets right only by accident and a `filter(Boolean)` rewrite gets
   *   wrong outright.
   */
  const MAX_SAFE_LENGTH = 2 ** 53 - 1
  /**
   * The native `Array.prototype.toReversed`, or undefined below Node 20.
   */
  const arrayToReversedNative =
    typeof require_primordials_array.ArrayCtor.prototype.toReversed ===
    'function'
      ? arr => arr.toReversed()
      : void 0
  /**
   * `Array.prototype.toReversed` shim.
   *
   * Walks the source backwards by index rather than reversing in place, so the
   * input is never mutated and the output is dense.
   */
  function arrayToReversedShim(arr) {
    const length = toLength(arr.length)
    const out = new require_primordials_array.ArrayCtor(length)
    for (let i = 0; i < length; i += 1) out[i] = arr[length - i - 1]
    return out
  }
  const arrayToReversed = arrayToReversedNative ?? arrayToReversedShim
  /**
   * The native `Array.prototype.toSorted`, or undefined below Node 20.
   */
  const arrayToSortedNative =
    typeof require_primordials_array.ArrayCtor.prototype.toSorted === 'function'
      ? (arr, comparator) => arr.toSorted(comparator)
      : void 0
  /**
   * `Array.prototype.toSorted` shim.
   *
   * The comparator is validated BEFORE any element is read, so a bad comparator
   * throws on an empty array too. `sort` then supplies the rest of the
   * observable contract: a stable order, and undefined last whatever the
   * comparator says.
   */
  function arrayToSortedShim(arr, comparator) {
    if (comparator !== void 0 && typeof comparator !== 'function')
      throw new require_primordials_error.TypeErrorCtor(
        'The comparator must be a function or undefined',
      )
    const length = toLength(arr.length)
    const out = new require_primordials_array.ArrayCtor(length)
    for (let i = 0; i < length; i += 1) out[i] = arr[i]
    return require_primordials_array.ArrayPrototypeSort(out, comparator)
  }
  const arrayToSorted = arrayToSortedNative ?? arrayToSortedShim
  /**
   * The spec's ToLength: a length is clamped to a non-negative integer under
   * 2^53-1. Without it a `length` of -1 or NaN reaches `new Array(length)` and
   * throws a RangeError where the spec produces an empty array.
   */
  function toLength(value) {
    const n = require_primordials_number.NumberCtor(value)
    if (require_primordials_number.NumberIsNaN(n) || n <= 0) return 0
    return require_primordials_math.MathMin(
      require_primordials_math.MathFloor(n),
      MAX_SAFE_LENGTH,
    )
  }
  exports.arrayToReversed = arrayToReversed
  exports.arrayToReversedNative = arrayToReversedNative
  exports.arrayToReversedShim = arrayToReversedShim
  exports.arrayToSorted = arrayToSorted
  exports.arrayToSortedNative = arrayToSortedNative
  exports.arrayToSortedShim = arrayToSortedShim
  exports.toLength = toLength
})

var require_format = /* @__PURE__ */ __commonJSMin(exports => {
  Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
  const require_primordials_object = require_object()
  const require_primordials_json = require_json()
  const require_polyfills_array = require_array()
  /**
   * @file Shared utilities for JSON formatting preservation and manipulation.
   *   Provides functions for detecting and preserving indentation, line
   *   endings, and determining when JSON files should be saved based on content
   *   changes.
   */
  /**
   * Symbols used to store formatting metadata in JSON objects.
   */
  const INDENT_SYMBOL = Symbol.for('indent')
  const NEWLINE_SYMBOL = Symbol.for('newline')
  /**
   * Detect indentation from a JSON string. Space-based indentation returns a
   * count; mixed indentation returns the string.
   *
   * @example
   *   ;```ts
   *   detectIndent('{\n  "key": "value"\n}') // => 2
   *   detectIndent('{\n    "key": "value"\n}') // => 4
   *   detectIndent('{\n\t"key": "value"\n}') // => '\t'
   *   ```
   *
   * @param json - JSON string to analyze.
   *
   * @returns Number of spaces or indentation string, defaults to 2 if not
   *   detected.
   */
  function detectIndent(json) {
    const match = json.match(/^[{[][\r\n]+(\s+)/m)
    if (!match) return 2
    const indent = match[1]
    if (/^ +$/.test(indent)) return indent.length
    return indent
  }
  /**
   * Detect newline character(s) from a JSON string. Supports LF (\n) and CRLF
   * (\r\n) line endings.
   *
   * @example
   *   ;```ts
   *   detectNewline('{\n  "key": "value"\n}') // => '\n'
   *   detectNewline('{\r\n  "key": "value"\r\n}') // => '\r\n'
   *   ```
   *
   * @param json - JSON string to analyze.
   *
   * @returns Line ending string ('\n' or '\r\n'), defaults to '\n' if not
   *   detected.
   */
  function detectNewline(json) {
    const match = json.match(/\r?\n/)
    return match ? match[0] : '\n'
  }
  /**
   * Extract formatting metadata from a JSON string.
   *
   * @example
   *   ;```ts
   *   const formatting = extractFormatting('{\n  "key": "value"\n}')
   *   // => { indent: 2, newline: '\n' }
   *   ```
   *
   * @param json - JSON string to analyze.
   *
   * @returns Object containing indent and newline formatting
   */
  function extractFormatting(json) {
    return {
      indent: detectIndent(json),
      newline: detectNewline(json),
    }
  }
  /**
   * Get default formatting for JSON files.
   *
   * @example
   *   ;```typescript
   *   const fmt = getDefaultFormatting()
   *   // { indent: 2, newline: '\n' }
   *   ```
   *
   * @returns Default formatting (2 spaces, LF line endings)
   */
  function getDefaultFormatting() {
    return {
      indent: 2,
      newline: '\n',
    }
  }
  /**
   * Extract formatting from content object that has symbol-based metadata.
   *
   * @example
   *   ;```typescript
   *   const content = {
   *     [Symbol.for('indent')]: 4,
   *     [Symbol.for('newline')]: '\r\n',
   *   }
   *   getFormattingFromContent(content) // { indent: 4, newline: "\r\n" }
   *   ```
   *
   * @param content - Content object with Symbol.for('indent') and
   *   Symbol.for('newline')
   *
   * @returns Formatting metadata, or defaults if symbols not present
   */
  function getFormattingFromContent(content) {
    const indent = content[INDENT_SYMBOL]
    const newline = content[NEWLINE_SYMBOL]
    return {
      indent: indent === void 0 || indent === null ? 2 : indent,
      newline: newline === void 0 || newline === null ? '\n' : newline,
    }
  }
  /**
   * Determine if content should be saved based on changes and options. Compares
   * current content with original content and respects options like
   * ignoreWhitespace and sort.
   *
   * @example
   *   ;```ts
   *   const current = { key: 'new-value', [Symbol.for('indent')]: 2 }
   *   const original = { key: 'old-value', [Symbol.for('indent')]: 2 }
   *   shouldSave(current, original, '{\n  "key": "old-value"\n}\n')
   *   // => true
   *   ```
   *
   * @param currentContent - Current content object (may include formatting
   *   symbols)
   * @param originalContent - Original content for comparison (may include
   *   formatting symbols)
   * @param originalFileContent - Original file content as string (for whitespace
   *   comparison)
   * @param options - Options controlling save behavior.
   *
   * @returns True if content should be saved, false otherwise
   */
  function shouldSave(
    currentContent,
    originalContent,
    originalFileContent,
    options,
  ) {
    const {
      ignoreWhitespace = false,
      sort = false,
      sortFn,
    } = {
      __proto__: null,
      ...options,
    }
    const content = stripFormattingSymbols(currentContent)
    const sortedContent = sortFn
      ? sortFn(content)
      : sort
        ? sortKeys(content)
        : content
    const origContent = originalContent
      ? stripFormattingSymbols(originalContent)
      : {}
    if (ignoreWhitespace)
      return !__require('node:util').isDeepStrictEqual(
        sortedContent,
        origContent,
      )
    return (
      stringifyWithFormatting(
        sortedContent,
        getFormattingFromContent(currentContent),
      ).trim() !== originalFileContent.trim()
    )
  }
  /**
   * Sort object keys alphabetically. Creates a new object with sorted keys
   * (does not mutate input).
   *
   * @example
   *   ;```ts
   *   sortKeys({ z: 3, a: 1, m: 2 })
   *   // => { a: 1, m: 2, z: 3 }
   *   ```
   *
   * @param obj - Object to sort.
   *
   * @returns New object with alphabetically sorted keys
   */
  function sortKeys(obj) {
    const sorted = { __proto__: null }
    const keys = require_polyfills_array.arrayToSorted(
      require_primordials_object.ObjectKeys(obj),
    )
    for (let i = 0, { length } = keys; i < length; i += 1) {
      const key = keys[i]
      sorted[key] = obj[key]
    }
    return sorted
  }
  /**
   * Stringify JSON with specific formatting. Applies indentation and line
   * ending preferences.
   *
   * @example
   *   ;```ts
   *   stringifyWithFormatting({ key: 'value' }, { indent: 4, newline: '\r\n' })
   *   // => '{\r\n    "key": "value"\r\n}\r\n'
   *   ```
   *
   * @param content - Object to stringify.
   * @param formatting - Formatting preferences: indent and newline.
   *
   * @returns Formatted JSON string with trailing newline
   */
  function stringifyWithFormatting(content, formatting) {
    const { indent, newline } = formatting
    const format = indent === void 0 || indent === null ? '  ' : indent
    const eol = newline === void 0 || newline === null ? '\n' : newline
    return `${require_primordials_json.JSONStringify(content, void 0, format)}\n`.replace(
      /\n/g,
      () => eol,
    )
  }
  /**
   * Strip formatting symbols from content object. Removes Symbol.for('indent')
   * and Symbol.for('newline') from the object.
   *
   * @example
   *   ;```typescript
   *   const obj = { key: 'value', [Symbol.for('indent')]: 2 }
   *   stripFormattingSymbols(obj) // { key: "value" }
   *   ```
   *
   * @param content - Content object with potential symbol properties.
   *
   * @returns Object with symbols removed
   */
  function stripFormattingSymbols(content) {
    const {
      [INDENT_SYMBOL]: _indent,
      [NEWLINE_SYMBOL]: _newline,
      ...rest
    } = content
    return rest
  }
  exports.INDENT_SYMBOL = INDENT_SYMBOL
  exports.NEWLINE_SYMBOL = NEWLINE_SYMBOL
  exports.detectIndent = detectIndent
  exports.detectNewline = detectNewline
  exports.extractFormatting = extractFormatting
  exports.getDefaultFormatting = getDefaultFormatting
  exports.getFormattingFromContent = getFormattingFromContent
  exports.shouldSave = shouldSave
  exports.sortKeys = sortKeys
  exports.stringifyWithFormatting = stringifyWithFormatting
  exports.stripFormattingSymbols = stripFormattingSymbols
})

var import_format = require_format()
/**
 * @file Paths for the Codex setup step.
 */
const CODEX_SPEC_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'config.json',
)

/**
 * @file Render the Codex lifecycle hook config from config.json.
 */
function readCodexHooksSpec(options = {}) {
  const { specPath = CODEX_SPEC_PATH } = options
  return readCodexHooksSpecFile(specPath)
}
function readCodexHooksSpecFile(specPath) {
  let parsed
  try {
    parsed = JSON.parse(readFileSync(specPath, 'utf8'))
  } catch {
    throw new Error(
      `Invalid Codex hooks spec. Where: ${specPath}. Saw unparseable JSON; wanted a JSON object. Fix the file's syntax.`,
    )
  }
  if (parsed === null || typeof parsed !== 'object')
    throw new Error(
      `Invalid Codex hooks spec. Where: ${specPath}. Saw a non-object; wanted a JSON object. Fix the file's shape.`,
    )
  const record = parsed
  const command = record['command']
  const generatedDescription = record['generatedDescription']
  const timeoutSeconds = record['timeoutSeconds']
  const events = record['events']
  if (typeof command !== 'string' || command.length === 0)
    throw new Error(
      `Invalid Codex hooks spec. Where: ${specPath} command. Saw ${String(command)}; wanted a non-empty command. Fix the command field.`,
    )
  if (typeof generatedDescription !== 'string')
    throw new Error(
      `Invalid Codex hooks spec. Where: ${specPath} generatedDescription. Saw ${typeof generatedDescription}; wanted a string. Fix the generatedDescription field.`,
    )
  if (typeof timeoutSeconds !== 'number')
    throw new Error(
      `Invalid Codex hooks spec. Where: ${specPath} timeoutSeconds. Saw ${typeof timeoutSeconds}; wanted a number. Fix the timeoutSeconds field.`,
    )
  if (events === null || typeof events !== 'object')
    throw new Error(
      `Invalid Codex hooks spec. Where: ${specPath} events. Saw a non-object; wanted a map of event names. Fix the events field.`,
    )
  const entries = Object.entries(events)
  const resolved = /* @__PURE__ */ new Map()
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const { 0: name, 1: entry } = entries[i]
    if (entry === null || typeof entry !== 'object')
      throw new Error(
        `Invalid Codex hook event. Where: ${specPath} events.${name}. Saw a non-object; wanted an object. Fix the entry.`,
      )
    const matcher = entry['matcher']
    if (matcher !== void 0 && typeof matcher !== 'string')
      throw new Error(
        `Invalid Codex hook matcher. Where: ${specPath} events.${name}.matcher. Saw ${typeof matcher}; wanted a string. Fix the matcher field.`,
      )
    resolved.set(name, { matcher })
  }
  return {
    command,
    events: resolved,
    generatedDescription,
    timeoutSeconds,
  }
}
function renderCodexHooksConfig(options = {}) {
  const { spec = readCodexHooksSpec() } = options
  const events = [...spec.events]
  const hooks = /* @__PURE__ */ new Map()
  for (let i = 0, { length } = events; i < length; i += 1) {
    const { 0: name, 1: event } = events[i]
    const entry = {
      hooks: [
        {
          command: `${spec.command} ${name}`,
          timeout: spec.timeoutSeconds,
          type: 'command',
        },
      ],
    }
    hooks.set(
      name,
      event.matcher === void 0
        ? [entry]
        : [
            {
              matcher: event.matcher,
              ...entry,
            },
          ],
    )
  }
  return (0, import_format.stringifyWithFormatting)(
    {
      description: spec.generatedDescription,
      hooks: Object.fromEntries(hooks),
    },
    (0, import_format.getDefaultFormatting)(),
  )
}

var config_default = {
  description:
    'Codex CLI lifecycle hook wiring the fleet generates into .codex/hooks.json. Every event routes to the same cross-CLI runner, so the command and timeout are declared once. An event carrying a matcher applies to every tool.',
  target: '.codex/hooks.json',
  generatedDescription:
    'Fleet lifecycle guards generated from the canonical Claude hook registry.',
  command: 'node scripts/fleet/cross-cli/run.mts',
  timeoutSeconds: 10,
  events: {
    PostToolUse: { matcher: '.*' },
    PreToolUse: { matcher: '.*' },
    SessionStart: {},
    Stop: {},
    UserPromptSubmit: {},
  },
}

var require_predicates$1 = /* @__PURE__ */ __commonJSMin(exports => {
  Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
  /**
   * @file Array type-guard predicates. Currently just a re-export of native
   *   `Array.isArray` for consistency with the rest of the arrays surface —
   *   kept in its own leaf because it's runtime-trivial but conceptually a
   *   different concern from `chunk` / `unique` / `join`.
   */
  /**
   * Alias for native Array.isArray. Determines whether the passed value is an
   * array.
   *
   * This is a direct reference to the native `Array.isArray` method, providing
   * a type guard that narrows the type to an array type. Exported for
   * consistency with other array utilities in this module.
   *
   * @example
   *   ;```ts
   *   // Check if value is an array
   *   isArray([1, 2, 3])
   *   // Returns: true
   *
   *   isArray('not an array')
   *   // Returns: false
   *
   *   isArray(null)
   *   // Returns: false
   *
   *   // Type guard usage
   *   function processValue(value: unknown) {
   *     if (isArray(value)) {
   *       // TypeScript knows value is an array here
   *       console.log(value.length)
   *     }
   *   }
   *   ```
   *
   * @param value - The value to check.
   *
   * @returns `true` if the value is an array, `false` otherwise
   */
  const isArray = Array.isArray
  exports.isArray = isArray
})

var require_predicates = /* @__PURE__ */ __commonJSMin(exports => {
  Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
  const require_arrays_predicates = require_predicates$1()
  const require_primordials_object = require_object()
  /**
   * @file Object type guards: `hasKeys`, `hasOwn`, `isObject`, `isPlainObject`.
   *   All four narrow `unknown` to a typed shape and tolerate `null` /
   *   `undefined` without throwing.
   */
  /**
   * Check if an object has any enumerable own properties.
   *
   * Returns `true` if the object has at least one enumerable own property,
   * `false` otherwise. Also returns `false` for null/undefined.
   *
   * @example
   *   ;```ts
   *   hasKeys({ a: 1 }) // true
   *   hasKeys({}) // false
   *   hasKeys([]) // false
   *   hasKeys([1, 2]) // true
   *   hasKeys(null) // false
   *   hasKeys(undefined) // false
   *   hasKeys(Object.create({ inherited: true })) // false
   *   ```
   *
   * @param obj - The value to check.
   *
   * @returns `true` if obj has enumerable own properties, `false` otherwise
   */
  function hasKeys(obj) {
    if (obj === null || obj === void 0) return false
    for (const key in obj)
      if (require_primordials_object.ObjectHasOwn(obj, key)) return true
    return false
  }
  /**
   * Check if an object has an own property.
   *
   * Type-safe wrapper around `Object.hasOwn()` that returns `false` for
   * null/undefined instead of throwing. Only checks own properties, not
   * inherited ones from the prototype chain.
   *
   * @example
   *   ;```ts
   *   const obj = { name: 'Alice' }
   *   hasOwn(obj, 'name') // true
   *   hasOwn(obj, 'age') // false
   *   hasOwn(obj, 'toString') // false (inherited)
   *   hasOwn(null, 'name') // false
   *   ```
   *
   * @param obj - The value to check.
   * @param propKey - The property key to look for.
   *
   * @returns `true` if obj has the property as an own property, `false`
   *   otherwise.
   */
  function hasOwn(obj, propKey) {
    if (obj === null || obj === void 0) return false
    return require_primordials_object.ObjectHasOwn(obj, propKey)
  }
  /**
   * Check if a value is an object, arrays included.
   *
   * Returns `true` for any object type including arrays, dates, etc. Returns
   * `false` for primitives and `null`. Functions are not considered objects
   * here (typeof functions === 'function').
   *
   * @example
   *   ;```ts
   *   isObject({}) // true
   *   isObject([]) // true
   *   isObject(new Date()) // true
   *   isObject(() => {}) // false
   *   isObject(null) // false
   *   ```
   *
   * @param value - The value to check.
   *
   * @returns `true` for any object, arrays included; `false` otherwise
   */
  function isObject(value) {
    return value !== null && typeof value === 'object'
  }
  /**
   * Check if a value is a plain object, so neither an array nor a built-in.
   *
   * Returns `true` only for plain objects created with `{}` or
   * `Object.create(null)`. Returns `false` for arrays, built-in objects (Date,
   * RegExp, etc.), and primitives.
   *
   * @example
   *   ;```ts
   *   isPlainObject({}) // true
   *   isPlainObject({ a: 1 }) // true
   *   isPlainObject(Object.create(null)) // true
   *   isPlainObject([]) // false
   *   isPlainObject(new Date()) // false
   *   ```
   *
   * @param value - The value to check.
   *
   * @returns `true` if value is a plain object, `false` otherwise
   */
  function isPlainObject(value) {
    if (
      value === null ||
      typeof value !== 'object' ||
      require_arrays_predicates.isArray(value)
    )
      return false
    const proto = require_primordials_object.ObjectGetPrototypeOf(value)
    return (
      proto === null || proto === require_primordials_object.ObjectPrototype
    )
  }
  exports.hasKeys = hasKeys
  exports.hasOwn = hasOwn
  exports.isObject = isObject
  exports.isPlainObject = isPlainObject
})

var require_strings = /* @__PURE__ */ __commonJSMin(exports => {
  Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
  /**
   * @file Plain string comparison. The straight-ASCII three-way compare, no
   *   locale/numeric awareness — use `localeCompare` / `naturalCompare` from
   *   the sibling files when those matter.
   */
  /**
   * Simple string comparison.
   *
   * @example
   *   ;```typescript
   *   compareStr('a', 'b') // -1
   *   compareStr('b', 'a') // 1
   *   compareStr('a', 'a') // 0
   *   ```
   */
  function compareStr(a, b) {
    return a < b ? -1 : a > b ? 1 : 0
  }
  /**
   * Compare two strings by length, longest first.
   *
   * This is the order a matcher wants when one candidate is a prefix of
   * another: it makes the longer name win the span instead of the shorter one
   * claiming it first. A regex alternation built from an unsorted token list
   * matches `qodo-ai` inside `qodo-ai-bot`; sorted longest-first, it does not.
   *
   * @example
   *   ;```typescript
   *   arrayToSorted(['ab', 'abcd', 'abc'], compareStrLengthDesc)
   *   // ['abcd', 'abc', 'ab']
   *   ```
   */
  function compareStrLengthDesc(a, b) {
    return b.length - a.length
  }
  exports.compareStr = compareStr
  exports.compareStrLengthDesc = compareStrLengthDesc
})

var import_strings = require_strings()
var import_predicates = require_predicates()
const MCP_PROVIDERS = {
  linear: {
    connectOrder: 5,
    serverName: 'fleet-linear',
    url: 'https://mcp.linear.app/mcp',
    auth: 'oauth',
    setupUrl: 'https://linear.app',
    allowedAuthorizationHosts: ['linear.app', 'mcp.linear.app'],
    clients: {
      claude: { kind: 'oauth' },
      codex: { kind: 'oauth' },
      opencode: { kind: 'oauth' },
    },
  },
  notion: {
    connectOrder: 4,
    serverName: 'fleet-notion',
    url: 'https://mcp.notion.com/mcp',
    auth: 'oauth',
    setupUrl: 'https://mcp.notion.com',
    allowedAuthorizationHosts: ['app.notion.com', 'mcp.notion.com'],
    clients: {
      claude: { kind: 'oauth' },
      codex: { kind: 'oauth' },
      opencode: { kind: 'oauth' },
    },
  },
  readme: {
    connectOrder: 1,
    serverName: 'fleet-readme',
    url: 'https://docs.readme.com/mcp',
    auth: 'api-key',
    apiKeyEnv: 'README_API_KEY',
    setupUrl: 'https://dash.readme.com',
    allowedAuthorizationHosts: ['dash.readme.com'],
    clients: {
      claude: { kind: 'api-key-env' },
      codex: { kind: 'api-key-env' },
      opencode: { kind: 'api-key-env' },
    },
  },
  refero: {
    connectOrder: 3,
    serverName: 'fleet-refero',
    url: 'https://api.refero.design/mcp',
    auth: 'oauth',
    setupUrl: 'https://refero.design/mcp',
    allowedAuthorizationHosts: ['refero.design', 'api.refero.design'],
    clients: {
      claude: { kind: 'oauth' },
      codex: { kind: 'oauth' },
      opencode: { kind: 'oauth' },
    },
  },
  sanity: {
    connectOrder: 2,
    serverName: 'fleet-sanity',
    url: 'https://mcp.sanity.io',
    auth: 'oauth',
    setupUrl: 'https://www.sanity.io/manage',
    allowedAuthorizationHosts: ['mcp.sanity.io', 'sanity.io', 'www.sanity.io'],
    clients: {
      claude: { kind: 'oauth' },
      codex: { kind: 'oauth' },
      opencode: { kind: 'oauth' },
    },
  },
  slack: {
    connectOrder: 0,
    serverName: 'fleet-slack-hosted',
    url: 'https://mcp.slack.com/mcp',
    auth: 'oauth',
    localServerName: 'fleet-slack',
    setupUrl:
      'https://docs.slack.dev/ai/slack-mcp-server/connect-to-harnesses/',
    allowedAuthorizationHosts: ['slack.com'],
    clients: {
      claude: {
        kind: 'oauth',
        clientId: '1601185624273.8899143856786',
        callbackPort: 3118,
      },
      codex: {
        kind: 'registration-unavailable',
        reason: 'slack-client-registration-unverified',
      },
      opencode: {
        kind: 'registration-unavailable',
        reason: 'slack-client-registration-unverified',
      },
    },
  },
}
const MCP_PROVIDER_NAMES = Object.entries(MCP_PROVIDERS)
  .toSorted(([, left], [, right]) => left.connectOrder - right.connectOrder)
  .map(([name]) => name)
function findMcpProviderForServer(name) {
  const providerName = findMcpProviderNameForServer(name)
  return providerName === void 0 ? void 0 : MCP_PROVIDERS[providerName]
}
function findMcpProviderNameForServer(name) {
  return (
    MCP_PROVIDER_NAMES.find(
      provider => MCP_PROVIDERS[provider].serverName === name,
    ) ?? MCP_PROVIDER_NAMES.find(provider => provider === name)
  )
}
const CREDENTIAL_KEY_PATTERN =
  /(?:^|[-_])(?:api[-_]?key|auth(?:orization)?|bearer|credential|password|secret|token)(?:$|[-_])/i
const CREDENTIAL_VALUE_PATTERN = /\bbearer\s+[a-z\d._~+/=-]+/i
function assertMcpConfigHasNoCredentials(value, options = {}) {
  const { location = '.mcp.json' } = options
  if (typeof value === 'string') {
    if (CREDENTIAL_VALUE_PATTERN.test(value))
      throw new Error(
        `Committed MCP config contains a credential at ${location}`,
      )
    return
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1)
      assertMcpConfigHasNoCredentials(value[index], {
        location: `${location}[${index}]`,
      })
    return
  }
  if (!(0, import_predicates.isPlainObject)(value)) return
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.replace(/([a-z])([A-Z])/g, '$1-$2')
    if (CREDENTIAL_KEY_PATTERN.test(normalized))
      throw new Error(
        `Committed MCP config contains a credential field at ${location}.${key}`,
      )
    assertMcpConfigHasNoCredentials(child, { location: `${location}.${key}` })
  }
}
function parseMcpPublicOAuth(value) {
  if (value === void 0) return
  if (!(0, import_predicates.isPlainObject)(value))
    throw new TypeError('MCP OAuth metadata must be an object')
  const { clientId, callbackPort } = value
  if (clientId !== void 0 && (typeof clientId !== 'string' || !clientId))
    throw new TypeError(
      'MCP OAuth clientId must be a nonempty public identifier',
    )
  if (
    callbackPort !== void 0 &&
    (typeof callbackPort !== 'number' ||
      !Number.isInteger(callbackPort) ||
      callbackPort < 1 ||
      callbackPort > 65535)
  )
    throw new TypeError(
      'MCP OAuth callbackPort must be an integer from 1 to 65535',
    )
  if (
    Object.keys(value).some(key => key !== 'callbackPort' && key !== 'clientId')
  )
    throw new TypeError(
      'MCP OAuth metadata only supports clientId and callbackPort',
    )
  return {
    clientId,
    callbackPort,
  }
}
function parseMcpAuthorizationEnv(provider, headers) {
  const env = provider?.apiKeyEnv
  if (headers === void 0) return
  if (
    !env ||
    !(0, import_predicates.isPlainObject)(headers) ||
    Object.keys(headers).length !== 1 ||
    headers['Authorization'] !== `Bearer \${${env}}`
  )
    throw new TypeError(
      'MCP credential headers require the registered provider API key environment reference',
    )
  return env
}
function resolveMcpProviderEndpoint(name, url) {
  const provider = findMcpProviderForServer(name)
  const endpointProvider = Object.values(MCP_PROVIDERS).find(
    item => item.url === url,
  )
  if (endpointProvider && endpointProvider !== provider)
    throw new TypeError(
      `MCP provider URL requires its registered server name ${endpointProvider.serverName}`,
    )
  if (provider && url !== provider.url)
    throw new TypeError(
      `MCP provider ${name} requires its registered HTTPS URL`,
    )
  return provider
}
function parseMcpHttpAuthentication(name, server) {
  const provider = resolveMcpProviderEndpoint(name, server['url'])
  assertMcpUrlHasNoCredentials(server['url'])
  const bearerTokenEnv = parseMcpAuthorizationEnv(provider, server['headers'])
  assertMcpConfigHasNoCredentials(
    {
      ...server,
      headers: void 0,
    },
    { location: name },
  )
  const oauth = parseMcpPublicOAuth(server['oauth'])
  const registeredOAuth = provider?.clients.claude
  if (
    registeredOAuth?.kind === 'oauth' &&
    (oauth?.clientId !== registeredOAuth.clientId ||
      oauth?.callbackPort !== registeredOAuth.callbackPort)
  )
    throw new TypeError(
      `MCP provider ${name} requires its registered public OAuth metadata`,
    )
  if (provider?.auth === 'api-key' && oauth !== void 0)
    throw new TypeError(
      `MCP provider ${name} uses an API key environment reference`,
    )
  return {
    ...(bearerTokenEnv === void 0 ? {} : { bearerTokenEnv }),
    ...(oauth === void 0 ? {} : { oauth }),
  }
}
function assertMcpUrlHasNoCredentials(value) {
  if (typeof value !== 'string') throw new TypeError('MCP URL must be a string')
  const url = new URL(value)
  if (url.username || url.password || url.hash)
    throw new TypeError('MCP URL cannot contain credentials or a fragment')
  assertMcpConfigHasNoCredentials(Object.fromEntries(url.searchParams))
}

const OPENCODE_COMMAND_INDENT = ' '.repeat(6)
const OPENCODE_COMMAND_ITEM_INDENT = ' '.repeat(8)
function clientMcpServers(servers, client) {
  return Object.entries(sortRecord(servers)).filter(
    ([name]) =>
      findMcpProviderForServer(name)?.clients[client].kind !==
      'registration-unavailable',
  )
}
function codexMcpOAuth(name, server) {
  const support = findMcpProviderForServer(name)?.clients.codex
  if (support?.kind !== 'oauth') return server.oauth
  return support.clientId || support.callbackPort ? support : void 0
}
function compactOpenCodeCommandArrays(text, servers) {
  let result = text
  const items = Object.values(servers)
  for (let i = 0, { length } = items; i < length; i += 1) {
    const server = items[i]
    if (server.kind !== 'stdio') continue
    const command = [server.command, ...server.args]
    const compact = `${OPENCODE_COMMAND_INDENT}"command": [${command.map(value => JSON.stringify(value)).join(', ')}]`
    if (compact.length > 80) continue
    const expanded = [
      `${OPENCODE_COMMAND_INDENT}"command": [`,
      ...command.map(
        (value, index) =>
          `${OPENCODE_COMMAND_ITEM_INDENT}${JSON.stringify(value)}${index + 1 < command.length ? ',' : ''}`,
      ),
      `${OPENCODE_COMMAND_INDENT}]`,
    ].join('\n')
    result = result.replace(expanded, () => compact)
  }
  return result
}
function createOpenCodeMcpConfig(servers) {
  const entries = {}
  for (const [name, server] of clientMcpServers(servers, 'opencode'))
    entries[name] =
      server.kind === 'http'
        ? {
            type: 'remote',
            url: server.url,
            ...(server.oauth === void 0 ? {} : { oauth: server.oauth }),
            ...(server.bearerTokenEnv === void 0
              ? {}
              : {
                  headers: {
                    Authorization: `Bearer {env:${server.bearerTokenEnv}}`,
                  },
                  oauth: false,
                }),
          }
        : {
            command: [server.command, ...server.args],
            type: 'local',
          }
  return {
    $schema: 'https://opencode.ai/config.json',
    mcp: entries,
  }
}
function formatOpenCodeMcpConfig(config, servers) {
  return `${compactOpenCodeCommandArrays(JSON.stringify(config, void 0, 2), servers)}\n`
}
/**
 * Parse and validate the one committed MCP authority.
 */
function parseCanonicalMcpConfig(text) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Canonical .mcp.json must contain valid JSON')
  }
  if (
    !(0, import_predicates.isPlainObject)(parsed) ||
    !(0, import_predicates.isPlainObject)(parsed['mcpServers'])
  )
    throw new Error('Canonical .mcp.json must contain an mcpServers object')
  assertMcpConfigHasNoCredentials({
    ...parsed,
    mcpServers: void 0,
  })
  const servers = {}
  for (const [name, rawServer] of Object.entries(parsed['mcpServers'])) {
    if (!(0, import_predicates.isPlainObject)(rawServer))
      throw new Error(`MCP server ${name} must be an object`)
    if (rawServer['type'] === 'http') {
      const url = rawServer['url']
      if (typeof url !== 'string' || url.length === 0)
        throw new Error(`HTTP MCP server ${name} must have a URL`)
      servers[name] = {
        kind: 'http',
        url,
        ...parseMcpHttpAuthentication(name, rawServer),
      }
      continue
    }
    assertMcpConfigHasNoCredentials(rawServer, { location: name })
    const command = rawServer['command']
    if (typeof command !== 'string' || command.length === 0)
      throw new Error(`stdio MCP server ${name} must have a command`)
    servers[name] = {
      args: parseStringArray(rawServer['args'] ?? [], `${name}.args`),
      command,
      kind: 'stdio',
    }
  }
  return sortRecord(servers)
}
function parseStringArray(value, field) {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string'))
    throw new Error(`MCP server ${field} must be an array of strings`)
  return [...value]
}
/**
 * Render the trusted-project `.codex/config.toml` MCP section.
 */
function renderCodexMcpConfig(servers) {
  const lines = [
    '# Generated from ../.mcp.json by scripts/fleet/mcp/config.mts.',
    '# OAuth credentials stay in Codex user storage; do not add them here.',
  ]
  for (const [name, server] of clientMcpServers(servers, 'codex')) {
    const key = /^[\w-]+$/.test(name) ? name : tomlString(name)
    lines.push('', `[mcp_servers.${key}]`)
    if (server.kind === 'http') {
      lines.push(`url = ${tomlString(server.url)}`)
      if (server.bearerTokenEnv)
        lines.push(
          `bearer_token_env_var = ${tomlString(server.bearerTokenEnv)}`,
        )
      const oauth = codexMcpOAuth(name, server)
      if (oauth?.clientId || oauth?.callbackPort) {
        lines.push('', `[mcp_servers.${key}.oauth]`)
        if (oauth.clientId)
          lines.push(`client_id = ${tomlString(oauth.clientId)}`)
        if (oauth.callbackPort)
          lines.push(`callback_port = ${oauth.callbackPort}`)
      }
    } else {
      lines.push(`command = ${tomlString(server.command)}`)
      lines.push(...tomlStringArray(server.args))
    }
  }
  return `${lines.join('\n')}\n`
}
function renderOpenCodeMcpConfig(servers) {
  return formatOpenCodeMcpConfig(createOpenCodeMcpConfig(servers), servers)
}
function sortRecord(record) {
  return Object.fromEntries(
    Object.entries(record).toSorted(([left], [right]) =>
      (0, import_strings.compareStr)(left, right),
    ),
  )
}
function tomlString(value) {
  return JSON.stringify(value)
}
function tomlStringArray(values) {
  const compact = JSON.stringify(values)
  if (`args = ${compact}`.length <= 80) return [`args = ${compact}`]
  return ['args = [', ...values.map(value => `  ${tomlString(value)},`), ']']
}

const CODEX_MCP_CONFIG_REL = '.codex/config.toml'
const OPENCODE_MCP_ADAPTER_REL = 'opencode.json'

const INSTALLED_ADAPTER_PATHS = [
  ...ADAPTERS.map(adapter => adapter.dest),
  CODEX_MCP_CONFIG_REL,
  '.codex/hooks.json',
  OPENCODE_MCP_ADAPTER_REL,
]
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function projectMcpClientConfigs(dest, preservedPaths) {
  const authority = path.join(dest, '.mcp.json')
  if (!existsSync(authority)) return
  const servers = parseCanonicalMcpConfig(readFileSync(authority, 'utf8'))
  const codexPath = path.join(dest, CODEX_MCP_CONFIG_REL)
  if (
    !isPreservedInstallPath('.codex/config.toml', { preservedPaths }) &&
    (!existsSync(codexPath) ||
      readFileSync(codexPath, 'utf8').startsWith(
        '# Generated from ../.mcp.json by scripts/fleet/mcp/config.mts.',
      ))
  )
    writeIfChanged(codexPath, renderCodexMcpConfig(servers))
  const openCodePath = path.join(dest, OPENCODE_MCP_ADAPTER_REL)
  if (isPreservedInstallPath('opencode.json', { preservedPaths })) return
  const existing = existsSync(openCodePath)
    ? JSON.parse(readFileSync(openCodePath, 'utf8'))
    : {}
  if (!isPlainObject(existing))
    throw new TypeError(
      `Adapter projection failed. Where: ${openCodePath}. Saw: non-object JSON; wanted an OpenCode configuration object. Fix: repair the file and retry installation.`,
    )
  const generated = JSON.parse(renderOpenCodeMcpConfig(servers))
  if (!isPlainObject(generated))
    throw new TypeError('OpenCode MCP renderer returned invalid JSON.')
  writeIfChanged(
    openCodePath,
    `${JSON.stringify(
      {
        ...generated,
        ...existing,
        mcp: generated['mcp'],
      },
      void 0,
      2,
    )}\n`,
  )
}
function assertRegularDestination(file) {
  const entry = lstatSync(file, { throwIfNoEntry: false })
  if (entry && !entry.isFile())
    throw new TypeError(
      `Adapter projection failed. Where: ${file}. Saw: non-regular destination; wanted a regular file. Fix: remove the conflicting entry and retry installation.`,
    )
}
function writeIfChanged(file, content) {
  assertRegularDestination(file)
  if (existsSync(file) && readFileSync(file, 'utf8') === content) return
  mkdirSync(path.dirname(file), { recursive: true })
  withMirrorLockLiftedSync(file, () => writeFileSync(file, content, 'utf8'))
}
function writeRuleAlias(dest, relative) {
  const target = path.posix.relative(path.posix.dirname(relative), 'AGENTS.md')
  try {
    if (lstatSync(dest).isSymbolicLink() && readlinkSync(dest) === target)
      return
    rmSync(dest, { force: true })
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  mkdirSync(path.dirname(dest), { recursive: true })
  try {
    symlinkSync(target, dest)
  } catch (error) {
    const code = error?.code
    if (code !== 'ENOSYS' && code !== 'EPERM') throw error
    writeIfChanged(dest, POINTER_BODY)
  }
}
function projectInstalledAdapters(dest, options) {
  const opts = {
    __proto__: null,
    ...options,
  }
  const { preservedPaths } = opts
  migrateRuleFile(dest, opts)
  for (let i = 0, { length } = ADAPTERS; i < length; i += 1) {
    const adapter = ADAPTERS[i]
    if (
      adapter.kind === 'copy' &&
      !existsSync(path.join(dest, adapter.sourceRel))
    )
      throw new Error(
        `Adapter projection failed. Where: ${path.join(dest, adapter.sourceRel)}. Saw: canonical source missing; wanted extracted fleet source. Fix: verify the fleet pack and retry installation.`,
      )
  }
  const writes = ADAPTERS.filter(adapter => adapter.kind === 'file').map(
    adapter => [path.join(dest, adapter.dest), adapter.content],
  )
  writes.push([
    path.join(dest, '.codex', 'hooks.json'),
    renderCodexHooksConfig({
      spec: {
        ...config_default,
        events: new Map(Object.entries(config_default.events)),
      },
    }),
  ])
  for (const [file, content] of writes) {
    if (isPreservedInstallPath(path.relative(dest, file), { preservedPaths }))
      continue
    writeIfChanged(file, content)
  }
  for (let i = 0, { length } = ADAPTERS; i < length; i += 1) {
    const adapter = ADAPTERS[i]
    const destination = path.join(dest, adapter.dest)
    if (isPreservedInstallPath(adapter.dest, { preservedPaths })) continue
    if (adapter.kind === 'symlink') {
      writeRuleAlias(destination, adapter.dest)
      continue
    }
    if (adapter.kind !== 'copy') continue
    const source = path.join(dest, adapter.sourceRel)
    writeIfChanged(
      destination,
      renderAdapterCopy(adapter, readFileSync(source, 'utf8')),
    )
  }
  projectMcpClientConfigs(dest, preservedPaths)
  return INSTALLED_ADAPTER_PATHS
}

const SCRIPT_META = {
  describe:
    'Fetch, verify, and materialize the current green fleet tooling bundle.',
  help: 'Usage: pnpm run sync-fleet [--from-template] [--cached] [--json]',
  json: 'native',
}
const logger = getDep0Logger()
const DEFAULT_REPO = 'SocketDev/socket-wheelhouse'
const MANIFEST_NAME = 'publish-bundle-manifest.json'
function resolveRepoRoot(startDir) {
  let cur = startDir
  const { root } = path.parse(cur)
  while (cur && cur !== root) {
    if (existsSync(path.join(cur, 'package.json'))) return cur
    const parent = path.dirname(cur)
    if (parent === cur) break
    cur = parent
  }
  return path.resolve(startDir, '..', '..', '..')
}
const repoRoot = resolveRepoRoot(path.dirname(fileURLToPath(import.meta.url)))
function parseArgs(argv) {
  const opts = {
    __proto__: null,
    bundle: void 0,
    dest: repoRoot,
    dryRun: false,
    json: false,
    manifest: void 0,
    quiet: false,
    refresh: void 0,
    refreshTracked: false,
    preserveTracked: false,
    repairTracked: false,
    ref: '',
    repo: DEFAULT_REPO,
    fromTemplate: false,
    thin: false,
    wire: false,
  }
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const arg = argv[i]
    if (arg === void 0) break
    if (arg === '--dest') opts.dest = argv[++i] ?? repoRoot
    else if (arg === '--bundle') opts.bundle = argv[++i]
    else if (arg === '--dry-run') opts.dryRun = true
    else if (arg === '--json') opts.json = true
    else if (arg === '--from-template') opts.fromTemplate = true
    else if (arg === '--manifest') opts.manifest = argv[++i]
    else if (arg === '--quiet') opts.quiet = true
    else if (arg === '--cached') opts.refresh = false
    else if (arg === '--preserve-tracked') opts.preserveTracked = true
    else if (arg === '--repair-tracked') opts.repairTracked = true
    else if (arg === '--refresh-tracked') opts.refreshTracked = true
    else if (arg === '--ref') opts.ref = argv[++i] ?? ''
    else if (arg === '--repo') opts.repo = argv[++i] ?? DEFAULT_REPO
    else if (arg === '--thin') opts.thin = true
    else if (arg === '--wire') opts.wire = true
  }
  return opts
}
const ENSURE_CURRENT_LOCK = '.cache/fleet/socket-wheelhouse/ensure-current.lock'
const ENSURE_CURRENT_RECEIPT =
  '.cache/fleet/socket-wheelhouse/ensure-current.json'
const ENSURE_CURRENT_TTL_MS = 144e5
function readEnsureCurrentReceipt(dest) {
  try {
    const parsed = JSON.parse(
      readFileSync(path.join(dest, ENSURE_CURRENT_RECEIPT), 'utf8'),
    )
    return typeof parsed.checkedAt === 'number' &&
      typeof parsed.ref === 'string' &&
      isOciManifestReceipt(parsed.oci)
      ? {
          checkedAt: parsed.checkedAt,
          oci: parsed.oci,
          ref: parsed.ref,
        }
      : void 0
  } catch {
    return
  }
}
function isEnsureCurrentFresh(receipt, options) {
  const now = options?.now ?? Date.now()
  return (
    receipt !== void 0 &&
    receipt.checkedAt <= now &&
    now - receipt.checkedAt < ENSURE_CURRENT_TTL_MS
  )
}
function ensureCurrentLockOwnerPath(lock) {
  return path.join(lock, 'owner')
}
function createEnsureCurrentLock(lock, owner) {
  mkdirSync(lock)
  writeFileSync(ensureCurrentLockOwnerPath(lock), `${owner}\n`)
  return {
    owner,
    path: lock,
  }
}
function acquireEnsureCurrentLock(dest, options) {
  const lock = path.join(dest, ENSURE_CURRENT_LOCK)
  const now = options?.now ?? Date.now()
  const owner = options?.owner ?? randomUUID()
  mkdirSync(path.dirname(lock), { recursive: true })
  try {
    return createEnsureCurrentLock(lock, owner)
  } catch (error) {
    if (error.code === 'EEXIST')
      try {
        const ownerPath = ensureCurrentLockOwnerPath(lock)
        if (now - statSync(ownerPath).mtimeMs >= 6e5) {
          const retired = `${lock}.stale-${owner}`
          renameSync(lock, retired)
          try {
            return createEnsureCurrentLock(lock, owner)
          } finally {
            rmSync(retired, {
              force: true,
              recursive: true,
            })
          }
        }
      } catch {
        return
      }
    return
  }
}
function releaseEnsureCurrentLock(lock) {
  try {
    if (
      readFileSync(ensureCurrentLockOwnerPath(lock.path), 'utf8').trim() ===
      lock.owner
    )
      rmSync(lock.path, {
        force: true,
        recursive: true,
      })
  } catch {}
}
function refreshEnsureCurrentLock(lock) {
  try {
    const ownerPath = ensureCurrentLockOwnerPath(lock.path)
    if (readFileSync(ownerPath, 'utf8').trim() === lock.owner) {
      const now = /* @__PURE__ */ new Date()
      utimesSync(ownerPath, now, now)
    }
  } catch {}
}
function appliedPayloadIsComplete(dest, ref) {
  const files = readAppliedFiles(dest)
  const manifest = readAppliedManifest(dest)
  const manifestFiles = manifest === void 0 ? [] : Object.keys(manifest)
  return (
    readAppliedRef(dest) === ref &&
    files !== void 0 &&
    files.length > 0 &&
    manifest !== void 0 &&
    manifestFiles.length > 0 &&
    files.length === manifestFiles.length &&
    files.every((file, index) => file === manifestFiles[index]) &&
    Object.entries(manifest).every(([file, digest]) => {
      const target = path.join(dest, file)
      return (
        existsSync(target) && computeSha256(readFileSync(target)) === digest
      )
    })
  )
}
function waitForEnsureCurrent(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
function writeEnsureCurrentReceipt(dest, receipt) {
  const target = path.join(dest, ENSURE_CURRENT_RECEIPT)
  mkdirSync(path.dirname(target), { recursive: true })
  const temporary = `${target}.${String(process$1.pid)}.tmp`
  writeFileSync(temporary, `${JSON.stringify(receipt)}\n`)
  renameSync(temporary, target)
}
async function ensureCurrentFleet(config, dependencies) {
  const cfg = {
    __proto__: null,
    ...config,
  }
  const deps = {
    __proto__: null,
    ...dependencies,
  }
  const dest = path.resolve(cfg.dest ?? repoRoot)
  migrateRuleFile(dest, {
    preservedPaths: existsSync(path.join(dest, '.git'))
      ? readFleetTrackedPaths(dest)
      : void 0,
  })
  if (existsSync(sharedTemplateBasePath(dest))) return 0
  repairTrackedHydration(dest, { restoreMissing: cfg.repairTracked === true })
  const now = deps.now ?? Date.now
  const receipt = readEnsureCurrentReceipt(dest)
  if (
    cfg.refresh !== true &&
    receipt !== void 0 &&
    isEnsureCurrentFresh(receipt, { now: now() }) &&
    appliedPayloadIsComplete(dest, receipt.ref)
  )
    return 0
  const wait = deps.wait ?? waitForEnsureCurrent
  const lockAttempts = deps.lockAttempts ?? 300
  let lock
  for (let attempt = 0; attempt < lockAttempts; attempt += 1) {
    lock = acquireEnsureCurrentLock(dest, { now: now() })
    if (lock !== void 0) break
    const current = readEnsureCurrentReceipt(dest)
    if (
      current !== void 0 &&
      (cfg.refresh !== true ||
        current.checkedAt > (receipt?.checkedAt ?? -Infinity)) &&
      isEnsureCurrentFresh(current, { now: now() }) &&
      appliedPayloadIsComplete(dest, current.ref)
    )
      return 0
    await wait(100)
  }
  if (lock === void 0) {
    logger.error(
      'install-fleet: timed out waiting for another fleet-pack hydration. Retry the command.',
    )
    return 1
  }
  const acquiredLock = lock
  const heartbeat = setInterval(
    () => refreshEnsureCurrentLock(acquiredLock),
    3e4,
  )
  heartbeat.unref()
  try {
    const latestReceipt = readEnsureCurrentReceipt(dest)
    const resolution = await (deps.resolve ?? resolveGreenPack)(
      cfg.repo ?? DEFAULT_REPO,
    )
    if (resolution === void 0) {
      const appliedRef = readAppliedRef(dest)
      if (appliedRef !== void 0 && appliedPayloadIsComplete(dest, appliedRef)) {
        if (cfg.refresh === true)
          logger.error(
            `install-fleet: GHCR lookup failed; reusing verified local pack ${appliedRef}. The latest green pack was not confirmed.`,
          )
        return 0
      }
      logger.error(
        'install-fleet: no verified fleet pack is available locally or from GHCR. Run pnpm run sync-fleet when online.',
      )
      return 1
    }
    const { receipt: oci, ref } = resolution
    if (
      latestReceipt !== void 0 &&
      Date.parse(oci.created) < Date.parse(latestReceipt.oci.created)
    ) {
      logger.error(
        `install-fleet: refusing green-channel rollback from ${latestReceipt.ref} (${latestReceipt.oci.created}) to ${ref} (${oci.created}).`,
      )
      return 1
    }
    if (readAppliedRef(dest) !== ref || !appliedPayloadIsComplete(dest, ref)) {
      const result = await (deps.install ?? installFleet)({
        ...cfg,
        expectedReceipt: oci,
        ref,
      })
      if (result !== 0) return result
    }
    writeEnsureCurrentReceipt(dest, {
      checkedAt: now(),
      oci,
      ref,
    })
    return 0
  } finally {
    clearInterval(heartbeat)
    releaseEnsureCurrentLock(acquiredLock)
  }
}
/**
 * Download, verify, and apply the fleet bundle identified by `config.ref`.
 * Returns 0 on success, 1 on any error.
 */
function shouldDeferLegacyRuleSeed(dest, preservedPaths) {
  if (
    !preservedPaths?.has('CLAUDE.md') ||
    preservedPaths.has('AGENTS.md') ||
    lstatSync(path.join(dest, 'AGENTS.md'), { throwIfNoEntry: false })
  )
    return false
  const legacyPath = path.join(dest, LEGACY_RULE_FILE)
  if (!lstatSync(legacyPath, { throwIfNoEntry: false })?.isFile()) return false
  const body = readFileSync(legacyPath, 'utf8')
  return body.trim().length > 0 && !isGeneratedRuleBody(body)
}
async function installFleet(config) {
  const cfg = {
    __proto__: null,
    ...config,
  }
  const dest = path.resolve(cfg.dest ?? repoRoot)
  const bundlePath = cfg.bundle !== void 0 ? path.resolve(cfg.bundle) : void 0
  const manifestPath =
    cfg.manifest !== void 0 ? path.resolve(cfg.manifest) : void 0
  const ref = cfg.ref
  if (!ref && bundlePath === void 0) {
    logger.log(
      'install-fleet: no --ref. Pass an immutable fleet-pack-<sha> ref.',
    )
    return 1
  }
  const repo = cfg.repo ?? DEFAULT_REPO
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'fleet-install-'))
  try {
    let sourceTarball
    let sourceManifest
    if (bundlePath !== void 0) {
      sourceTarball = bundlePath
      sourceManifest =
        manifestPath ?? path.join(path.dirname(bundlePath), MANIFEST_NAME)
      if (!existsSync(sourceTarball)) {
        logger.log(`install-fleet: local bundle not found: ${sourceTarball}.`)
        return 1
      }
      if (!existsSync(sourceManifest)) {
        logger.log(
          `install-fleet: local manifest not found: ${sourceManifest}.`,
        )
        return 1
      }
      logger.log(`install-fleet: using local bundle ${sourceTarball}.`)
    } else
      try {
        const fetched = await fetchBundleSource({
          expectedReceipt: cfg.expectedReceipt,
          ref,
          repo,
          tmp,
        })
        sourceTarball = fetched.tarball
        sourceManifest = fetched.manifest
      } catch (e) {
        logger.log(
          `install-fleet: fetch failed for ${repo}@${ref}: ${errorMessage(e)}. Check the tag exists (GHCR package public or gh authenticated).`,
        )
        return 1
      }
    const manifest = readManifest(sourceManifest)
    const sourceRef = ref || `local-${manifest.version}`
    const extractDir = path.join(tmp, 'extracted')
    mkdirSync(extractDir, { recursive: true })
    run(
      tarExecutable(process$1.platform, process$1.env['SystemRoot']),
      tarExtractArgs({
        archive: sourceTarball,
        destination: extractDir,
        platform: process$1.platform,
      }),
    )
    const filesDir = path.join(extractDir, 'files')
    const segmentsDir = path.join(extractDir, 'segments')
    if (!existsSync(filesDir)) {
      logger.log(
        `install-fleet: bundle ${sourceRef} has no files/ directory — unexpected layout.`,
      )
      return 1
    }
    const problems = [
      ...verifyBundleFiles(filesDir, manifest),
      ...verifySegments(segmentsDir, manifest),
    ]
    if (problems.length > 0) {
      logger.log(
        `install-fleet: verification FAILED for ${sourceRef} (${problems.length} problem(s)); nothing written. First few:\n  ${problems.slice(0, 5).join('\n  ')}`,
      )
      return 1
    }
    const memberManifest = effectiveMemberManifest(manifest, dest)
    const fileCount = Object.keys(memberManifest.files).length
    const segmentCount =
      (memberManifest.segments?.length ?? 0) +
      (memberManifest.settingsSegment === void 0 ? 0 : 1)
    if (cfg.dryRun) {
      logger.log(
        `install-fleet: [dry-run] ${fileCount} file(s) + ${segmentCount} segment(s) verified for ${sourceRef} (template ${manifest.templateSha}). Would write into ${dest}.`,
      )
      return 0
    }
    const preserveTracked =
      cfg.expectedReceipt !== void 0 || cfg.preserveTracked === true
    const preservedPaths = preserveTracked
      ? readFleetTrackedPaths(dest)
      : void 0
    migrateRuleFile(dest, { preservedPaths })
    const deferLegacyRuleSeed = shouldDeferLegacyRuleSeed(dest, preservedPaths)
    function shouldInstallBundlePath(file) {
      const normalized = normalizeBundlePath(file)
      return (
        !preservedPaths?.has(normalized) &&
        !(deferLegacyRuleSeed && normalized === 'AGENTS.md')
      )
    }
    const runtimeManifest = preservedPaths
      ? {
          ...memberManifest,
          files: Object.fromEntries(
            Object.entries(memberManifest.files).filter(([file]) =>
              shouldInstallBundlePath(file),
            ),
          ),
          segments: memberManifest.segments?.filter(segment =>
            shouldInstallBundlePath(segment.path),
          ),
          settingsSegment:
            memberManifest.settingsSegment !== void 0 &&
            preservedPaths.has(
              normalizeBundlePath(memberManifest.settingsSegment.path),
            )
              ? void 0
              : memberManifest.settingsSegment,
          workspaceSegment: preservedPaths.has('pnpm-workspace.yaml')
            ? void 0
            : memberManifest.workspaceSegment,
        }
      : memberManifest
    const installResult = installFiles(filesDir, dest, runtimeManifest, {
      refreshTracked: cfg.refreshTracked === true,
      preservedPaths,
    })
    if (!preserveTracked) untrackGeneratedOutputs(dest, manifest.generatedPaths)
    const prunedCount = pruneStaleFleetFiles(
      dest,
      runtimeManifest,
      readAppliedFiles(dest),
      {
        archiveManifest: manifest,
        preservedPaths,
      },
    )
    const movedCount = applyMovedPaths(dest, manifest, { preservedPaths })
    const tombstonedCount = removeTombstonedPaths(dest, manifest, {
      preservedPaths,
    })
    const deliveredMovedFiles = {}
    for (const moved of manifest.movedPaths ?? []) {
      const to = normalizeBundlePath(moved.to)
      if (to && existsSync(path.join(dest, to)))
        deliveredMovedFiles[to] = 'moved'
    }
    const ignoreManifest = Object.keys(deliveredMovedFiles).length
      ? {
          ...memberManifest,
          files: {
            ...memberManifest.files,
            ...deliveredMovedFiles,
          },
        }
      : memberManifest
    installSegments(segmentsDir, dest, runtimeManifest, { preservedPaths })
    const settingsResult = installSettingsSegment(
      segmentsDir,
      dest,
      runtimeManifest,
    )
    if (settingsResult !== 0) return settingsResult
    const wsResult = installWorkspaceSegment(segmentsDir, dest, runtimeManifest)
    if (wsResult !== 0) return wsResult
    if (cfg.wire && !preservedPaths?.has('package.json')) wirePackageJson(dest)
    if (cfg.thin && !preserveTracked)
      untrackFleetPackPaths({
        dest,
        manifest: ignoreManifest,
      })
    else if (cfg.expectedReceipt !== void 0)
      refreshFleetPackCheckoutExcludes({
        dest,
        manifest: runtimeManifest,
      })
    try {
      if (!deferLegacyRuleSeed)
        projectInstalledAdapters(dest, { preservedPaths })
      if (!preserveTracked)
        untrackGeneratedOutputs(dest, INSTALLED_ADAPTER_PATHS)
    } catch (error) {
      logger.log(
        `install-fleet: adapter projection failed after verified extraction: ${errorMessage(error)}`,
      )
      return 1
    }
    const appliedFiles = fleetPackOwnedPaths(runtimeManifest)
    writeAppliedRef(dest, sourceRef)
    writeAppliedFiles(dest, appliedFiles)
    writeAppliedManifest(
      dest,
      Object.fromEntries(
        appliedFiles.map(file => [file, memberManifest.files[file]]),
      ),
    )
    const prunedTotal = prunedCount + tombstonedCount
    const movedNote = movedCount > 0 ? `, moved ${movedCount}` : ''
    const prunedNote =
      (prunedTotal > 0 ? `, pruned ${prunedTotal} stale` : '') + movedNote
    const skippedNote =
      installResult.skippedAlwaysTracked > 0
        ? ` ${installResult.skippedAlwaysTracked} always-tracked file(s) left to the cascade (run commit-cascade to refresh them).`
        : ''
    const repoOwnedNote =
      installResult.skippedRepoOwned > 0
        ? ` ${installResult.skippedRepoOwned} repo-owned file(s) preserved.`
        : ''
    const refreshedNote =
      installResult.refreshedTracked.length > 0
        ? ` Refreshed ${installResult.refreshedTracked.length} always-tracked file(s) from the bundle — commit these changes:\n` +
          installResult.refreshedTracked.map(rel => `  • ${rel}`).join('\n')
        : ''
    logger.log(
      `install-fleet: placed ${installResult.placed} (+${installResult.unchanged} already current) of ${fileCount} file(s) + ${segmentCount} segment(s)${prunedNote} from ${sourceRef} (template ${manifest.templateSha}) → ${dest}.${skippedNote}${repoOwnedNote}${refreshedNote}`,
    )
    return 0
  } finally {
    rm(tmp, os.tmpdir())
  }
}
function isMainModule() {
  const entry = process$1.argv[1]
  if (!entry) return false
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entry)
  } catch {
    return false
  }
}
/**
 * The `--from-template` verb: materialize this checkout's fleet mirrors from
 * its own `template/base/universal`, then report what was placed.
 *
 * Exit 1 when the checkout carries no `template/base/universal` — a consumer
 * ran the producer verb, a wiring mistake worth failing on rather than silently
 * no-opping into an unusable tree.
 */
function runFromTemplate(config) {
  const dest = path.resolve(config.dest ?? repoRoot)
  const manifestPath =
    sharedScriptsRepoCommitCascadeManifestFleetFilesJsonPath(dest)
  if (!existsSync(manifestPath)) {
    logger.error(
      `install-fleet: --from-template: no mirror manifest at ${manifestPath}.`,
    )
    return 1
  }
  const result = materializeFromLocalTemplate(
    dest,
    JSON.parse(readFileSync(manifestPath, 'utf8')),
    {
      refreshTracked: config.refreshTracked,
      preserveTracked: config.preserveTracked,
    },
  )
  if (result === void 0) {
    logger.error(
      'install-fleet: --from-template: no template/base/universal here — that verb is for the payload PRODUCER; a consumer fetches its bundle.',
    )
    return 1
  }
  if (!config.quiet)
    logger.log(
      `install-fleet: materialized ${result.placed} file(s) from template/base/universal (${result.unchanged} already current, ${result.skippedAlwaysTracked} always-tracked left alone, ${result.skippedRepoOwned} repo-owned preserved).`,
    )
  return 0
}
async function main(dependencies) {
  const parsed = parseArgs(process$1.argv.slice(2))
  const exitCode = parsed.fromTemplate
    ? runFromTemplate(parsed)
    : parsed.bundle !== void 0 || parsed.ref !== ''
      ? await installFleet(parsed)
      : await (dependencies?.ensureCurrent ?? ensureCurrentFleet)({
          ...parsed,
          refresh: parsed.refresh !== false,
        })
  if (parsed.json)
    process$1.stdout.write(`${renderScriptResult({ exitCode })}\n`)
  return exitCode
}
if (isMainModule()) runMainMinimal(main, SCRIPT_META)

export {
  GHCR_HOST,
  GREEN_TAG,
  HARNESS_ALIAS_PATHS,
  HYBRID_BUNDLE_PATHS,
  OCI_MANIFEST_ACCEPT as MANIFEST_ACCEPT,
  PREPARE_FETCH,
  PREPARE_FROM_TEMPLATE,
  SETTINGS_CANDIDATES,
  SYNC_FLEET_SCRIPT,
  acquireEnsureCurrentLock,
  applyMovedPaths,
  beginMarker,
  computeSha256,
  endMarker,
  ensureCurrentFleet,
  errorMessage,
  extractFleetBlockLines,
  extractManifestFromTarball,
  fetchBlob,
  fetchBundleSource,
  fetchOciManifest,
  fetchOciManifestEnvelope,
  filterManifestForCapabilities,
  filterManifestForShape,
  findFleetBlockSpans,
  firstHeader,
  fleetPackOwnedPaths,
  getAnonymousGhcrToken,
  getGhcrToken,
  ghcrBasicAuthHeader,
  ghcrBundleRepo,
  ghcrFetchBundle,
  ghcrTokenUrl,
  hasIdenticalBytes,
  httpGet,
  installFiles,
  installFleet,
  installSegments,
  installSettingsSegment,
  installWorkspaceSegment,
  isEnsureCurrentFresh,
  isMainModule,
  isOciManifestReceipt,
  isPreservedInstallPath,
  main,
  materializeFromLocalTemplate,
  mergeWorkspaceYaml,
  mergeYamlKeyBlock,
  migrateRuleFile,
  migrateWorkspaceSettings,
  normalizeBundlePath,
  normalizeManifestEntryPath,
  ociManifestReceipt,
  packBeginMarker,
  packEndMarker,
  parseArgs,
  parseWwwAuthenticate,
  parseYamlEntryChunks,
  parseYamlKeyBlocks,
  pickBundleLayer,
  pickFleetManifestLayer,
  pruneStaleFleetFiles,
  pullFleetBundleTarball,
  readAppliedFiles,
  readAppliedManifest,
  readAppliedRef,
  readBuildShape,
  readDeclaredCapabilities,
  readEnsureCurrentReceipt,
  readFleetTrackedPaths,
  readManifest,
  refreshFleetPackCheckoutExcludes,
  refreshFleetPackIgnores,
  removeTombstonedPaths,
  resolveGreenPack,
  resolveRepoRoot,
  resolveSettingsPath,
  run,
  runMainMinimal,
  sameOciManifestReceipt,
  segmentFileName,
  sha256Hex,
  shouldDeferLegacyRuleSeed,
  spliceFleetBlock,
  splicePackBlock,
  spliceYamlSeparatorRun,
  stripLegacyPackBlock,
  stripLegacyUntrackEntriesFromFleetBlock,
  tarExecutable,
  tarExtractArgs,
  tokenFromBody,
  untrackFleetPackPaths,
  untrackGeneratedOutputs,
  verifyBundleFiles,
  verifySegments,
  wirePackageJson,
  writeAppliedFiles,
  writeAppliedManifest,
  writeAppliedRef,
}
