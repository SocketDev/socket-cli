#!/usr/bin/env node
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import https from 'node:https'

//#region scripts/repo/gen/bootstrap/src/dep0-io.mts
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
 * Fail-open recursive delete. The dep-0 fetcher cannot import the lib
 * `safeDeleteSync`, so it wraps node's `rmSync` with the same force + recursive
 * fail-open semantics: a missing path is a no-op, never a throw.
 *
 * A read-only target gets ONE retry after a chmod +w. The installer locks the
 * files it places (0444/0555), and Windows refuses to unlink a read-only file —
 * POSIX does not, it checks the parent directory, which the lock never touches.
 */
function rm(targetPath) {
  try {
    rmSync(targetPath, {
      force: true,
      recursive: true,
    })
  } catch (e) {
    const code = errorCode(e)
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
function errorCode(e) {
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
    console.log(...args)
  },
}

//#endregion
//#region scripts/repo/gen/bootstrap/src/helpers.mts
/**
 * Normalize bundle-manifest paths to their portable `/` wire format.
 */
function normalizeBundlePath(filePath) {
  return filePath.replaceAll('\\', '/')
}
function tarExecutable(platform, systemRoot) {
  return platform === 'win32'
    ? path.join(systemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
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
 * Splice the fetcher-owned `<fleet-pack>` block into `target`. When the
 * markers exist the whole region (markers inclusive) is REPLACED — that is
 * what prunes a stale entry; the region is wholly fetcher-owned, so hand
 * ignores belong outside it. When absent, the block is appended at end of
 * file, after the cascade's `<fleet>` region and the member's `<repo>`
 * wrapper, so the fleet splice's repo-region adjacency is never broken.
 */
function splicePackBlock(config) {
  const { packBlock, target } = {
    __proto__: null,
    ...config,
  }
  const begin = packBeginMarker()
  const end = packEndMarker()
  const lines = target.split('\n')
  const startIdx = lines.findIndex(l => l === begin)
  const endIdx = lines.findIndex(l => l === end)
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = lines.slice(0, startIdx)
    const after = lines.slice(endIdx + 1)
    return [...before, packBlock, ...after].join('\n')
  }
  const trimmed = target.replace(/\n+$/, '')
  if (trimmed === '') return `${packBlock}\n`
  return `${trimmed}\n\n${packBlock}\n`
}
/**
 * The transitional long-form tag, bare form — every existing fleet member's
 * CLAUDE.md / .gitignore / .gitattributes still carries this pre-rename.
 * spliceFleetBlock matches it alongside the short-tag form, so a
 * not-yet-recascaded member is still found and re-spliced in one pass.
 */
function legacyTagBeginMarker(style) {
  if (style === 'html') return '<!-- <fleet-canonical> -->'
  if (style === 'slash') return '// <fleet-canonical>'
  return '# <fleet-canonical>'
}
function legacyTagEndMarker(style) {
  if (style === 'html') return '<!-- </fleet-canonical> -->'
  if (style === 'slash') return '// </fleet-canonical>'
  return '# </fleet-canonical>'
}
/**
 * Returns the BEGIN/END keyword marker form (long-form tag) for a style — an
 * older transition, predating the short-tag rename. spliceFleetBlock matches
 * it alongside the bare-tag forms, so a file carrying any of the three forms
 * is re-spliced in one pass.
 */
function legacyBeginMarker(style) {
  if (style === 'html') return '<!-- BEGIN <fleet-canonical> -->'
  if (style === 'slash') return '// BEGIN <fleet-canonical>'
  return '# BEGIN <fleet-canonical>'
}
function legacyEndMarker(style) {
  if (style === 'html') return '<!-- END </fleet-canonical> -->'
  if (style === 'slash') return '// END </fleet-canonical>'
  return '# END </fleet-canonical>'
}
/**
 * Splice the canonical fleet block into `target`. If `target` already contains
 * the open/close markers (short-tag bare, long-form tag bare, or legacy
 * BEGIN/END form), the content between them (markers inclusive) is replaced.
 * If markers are absent:
 * - `html` style (CLAUDE.md, README): insert before the first level-2 heading
 * (`## `) with i > 0, or append at end.
 * - other styles: append with a leading blank line separator.
 */
function spliceFleetBlock(config) {
  const { commentStyle, fleetBlock, target } = {
    __proto__: null,
    ...config,
  }
  const begin = beginMarker(commentStyle)
  const end = endMarker(commentStyle)
  const legacyTag0 = legacyTagBeginMarker(commentStyle)
  const legacyTag1 = legacyTagEndMarker(commentStyle)
  const legacy0 = legacyBeginMarker(commentStyle)
  const legacy1 = legacyEndMarker(commentStyle)
  const lines = target.split('\n')
  const startIdx = lines.findIndex(
    l => l === begin || l === legacyTag0 || l === legacy0,
  )
  const endIdx = lines.findIndex(
    l => l === end || l === legacyTag1 || l === legacy1,
  )
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = lines.slice(0, startIdx)
    const after = lines.slice(endIdx + 1)
    return [...before, fleetBlock, ...after].join('\n')
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
  execFileSync(cmd, args, { stdio: 'inherit' })
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

//#endregion
//#region scripts/repo/gen/bootstrap/src/applied-state.mts
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
const LEGACY_APPLIED_MARKER = '.config/fleet/.bundle-applied'
/**
 * Default bundle ref for a member — `bundle.ref` in its wheelhouse settings
 * file. Lets install-fleet (and the prepare/CI wires) omit an explicit --ref so
 * the pin lives in exactly one place. Returns undefined when absent/malformed.
 */
function readBundleRef(dest) {
  const p = resolveSettingsPath(dest)
  if (!p) return
  try {
    return JSON.parse(readFileSync(p, 'utf8')).bundle?.ref
  } catch {
    return
  }
}
/**
 * Read the member's full pinned `bundle` block (ref + cascadeSha) from the
 * wheelhouse settings file. The lock-step verify + the `fleet:status` verb need
 * BOTH halves — `readBundleRef` returns only the ref for the fetch default.
 * Returns both as undefined when the file is absent / malformed.
 */
function readBundleConfig(dest) {
  const p = resolveSettingsPath(dest)
  if (!p)
    return {
      ref: void 0,
      cascadeSha: void 0,
    }
  try {
    const json = JSON.parse(readFileSync(p, 'utf8'))
    return {
      cascadeSha: json.bundle?.cascadeSha,
      ref: json.bundle?.ref,
    }
  } catch {
    return {
      ref: void 0,
      cascadeSha: void 0,
    }
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
function writeAppliedRef(dest, ref) {
  const p = path.join(dest, APPLIED_MARKER)
  mkdirSync(path.dirname(p), { recursive: true })
  writeFileSync(p, `${ref}\n`)
  const legacy = path.join(dest, LEGACY_APPLIED_MARKER)
  if (existsSync(legacy)) rm(legacy)
}

//#endregion
//#region template/base/scripts/fleet/_shared/fleet-canonical-splice.mts
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
  return FLEET_CANONICAL_SPLICE_FILES.includes(relPath.replaceAll('\\', '/'))
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
  if (content.charAt(boundary) === '"') boundary += 1
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
  if (sourceTail.charAt(end) === '"') end += 1
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

//#endregion
//#region template/base/scripts/fleet/_shared/github-tracked-surface.mts
const ALWAYS_TRACKED_GITHUB_PREFIXES = [
  '.github/actions/fleet/',
  '.github/dependabot.yml',
  '.github/workflows/',
]
/**
 * Non-GitHub surfaces a member must keep tracked. The unifying rule for BOTH
 * lists: anything a consumer reads BEFORE our fetch runs has to be in the
 * commit. pnpm reads `.npmrc` and resolves `patchedDependencies` at install
 * time, which on a thin member happens after hydration but on a FRESH clone
 * can precede it; GitHub reads workflows and dependabot.yml from the
 * committed tree. Same rule, different consumers.
 *
 * These cannot live in ALWAYS_TRACKED_GITHUB_PREFIXES: that predicate is
 * `.github/`-scoped by construction, so a `.npmrc` entry there would never
 * be reached.
 */
const ALWAYS_TRACKED_PREFIXES = ['.npmrc', 'patches/']
/**
 * True when `relPath` is any always-tracked surface, GitHub or not. This is
 * what an untrack set should consult; the GitHub-only predicate below stays
 * exported for callers that mean the CI surface specifically.
 */
function isAlwaysTrackedSurface(relPath) {
  const p = relPath.replaceAll('\\', '/')
  for (let i = 0, { length } = ALWAYS_TRACKED_PREFIXES; i < length; i += 1)
    if (p.startsWith(ALWAYS_TRACKED_PREFIXES[i])) return true
  return isAlwaysTrackedGitHubSurface(p)
}
/**
 * True when `relPath`, repo-relative, either separator, is part of the GitHub
 * CI surface a member must keep git-tracked even when thin — a workflow file,
 * a fleet composite action, or dependabot.yml. GitHub reads all of them from
 * the committed tree before any fetch step runs.
 */
function isAlwaysTrackedGitHubSurface(relPath) {
  const p = relPath.replaceAll('\\', '/')
  for (
    let i = 0, { length } = ALWAYS_TRACKED_GITHUB_PREFIXES;
    i < length;
    i += 1
  )
    if (p.startsWith(ALWAYS_TRACKED_GITHUB_PREFIXES[i])) return true
  return false
}

//#endregion
//#region template/base/scripts/fleet/_shared/mirror-lock.mts
/**
 * @file Mirror-lock lift primitives. The cascade chmods live fleet mirrors
 *   read-only (0444/0555) so stray edits fail at the filesystem level; every
 *   sanctioned writer that rewrites a mirror (a re-cascade, a block splice, a
 *   dispatch-table regen) lifts the lock for the write and restores it after.
 *   fs.cp/copyFile/writeFile all open the DESTINATION for write, so a locked
 *   mirror EACCESes without the lift. One implementation here — the cascade's
 *   mirror-mode fixer and the member-side generators (build-hook-bundle,
 *   gen/hook-dispatch) all import it, so the lift semantics cannot drift.
 *   `lockFileReadonlySync` is the other half: the release-bundle installer
 *   places files with a plain `copyFileSync`, so it applies the lock itself
 *   rather than inheriting it from a cascade that never runs on that path.
 */
/**
 * Lock ONE file read-only, preserving its executable bit: 0o555 when the file
 * already carries an exec bit so a git-hook shim stays runnable while
 * unwritable, 0o444 otherwise. Same mode choice the cascade's own
 * `mirrorFileMode` makes, expressed sync and with `node:fs` alone so rolldown
 * can inline it into the dep-0 release-bundle installer.
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

//#endregion
//#region scripts/repo/gen/bootstrap/src/install-fleet-pack-prune.mts
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

//#endregion
//#region scripts/repo/gen/bootstrap/src/placement-lock.mts
/**
 * True when the release-bundle installer should lock what it places. Reads the
 * SAME `CASCADE_READONLY_MIRRORS` switch the cascade's mirror-mode fixer reads,
 * so one knob covers both delivery paths — a file is protected the same way
 * whether a cascade copied it or a bundle install placed it. ON by default;
 * only the exact value "0" opts out.
 */
function readonlyBundleMirrorsEnabled() {
  return process.env['CASCADE_READONLY_MIRRORS'] !== '0'
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
    rm(target)
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
 * - Hybrid segment paths (CLAUDE.md, pnpm-workspace.yaml, settings.json) — merged
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

//#endregion
//#region scripts/repo/gen/bootstrap/src/yaml-merge.mts
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
const MAP_ENTRY_RE = /^(\s+)(['"]?)([^'":\n]+)\2:/
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
        id: map ? `k:${map[3].trim()}` : `i:${item[2].trim()}`,
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
 * order after the fleet set. Scalar-shaped blocks (`saveExact: true`) have no
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

//#endregion
//#region template/base/scripts/fleet/_shared/hook-wiring.mts
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

//#endregion
//#region scripts/repo/gen/bootstrap/src/settings.mts
const FLEET_SETTINGS_BEGIN = '// <fleet-canonical>'
const FLEET_SETTINGS_END = '// </fleet-canonical>'
function cloneJson(value) {
  return JSON.parse(JSON.stringify(value))
}
function fleetSettingsKeys(settings) {
  const keys = Object.keys(settings)
  const start = keys.indexOf(FLEET_SETTINGS_BEGIN)
  const end = keys.indexOf(FLEET_SETTINGS_END)
  if (start === -1 || end === -1 || end <= start)
    throw new Error(
      'Invalid Claude settings fleet section: settings.json has missing or misordered <fleet-canonical> markers; expected one opening marker before one closing marker; fix the marker keys in the canonical template.',
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
        key === '// <fleet-canonical>' ||
        key === '// </fleet-canonical>' ||
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

//#endregion
//#region scripts/repo/gen/bootstrap/src/install-prune.mts
/**
 * @file Installer-side manifest SYNC-PRUNE: the three operations that make a
 *   bundle refresh a true sync (place + prune) rather than an additive smear —
 *   apply per-repo-owned file MOVES, delete manifest TOMBSTONES, and prune
 *   stale fleet files the previous manifest owned. All three are
 *   manifest-scoped (they read the manifest / applied-files record, never a
 *   directory walk) and carry the same producer-agnostic "shipped belt" so a
 *   bad manifest entry can never touch freshly placed payload. Split out of
 *   install.mts along the sync-prune seam to hold that file under the line cap;
 *   install.mts re-exports these so its public surface (and fleet.mts's
 *   re-export of it) is unchanged. Dep-0, same invariant as install.mts (node:
 *   builtins only, never socket-lib).
 */
/**
 * Apply the manifest's per-repo-owned file MOVES (`movedPaths`) — the rename
 * half of relocating a file the fleet does NOT byte-mirror. A plain tombstone
 * would delete the member's only copy with nothing in the bundle to re-create
 * it (the file is repo-owned; the bundle never ships it), so the move renames
 * `from` → `to` when `to` is absent — repo-owned content survives
 * byte-for-byte — and deletes a stale `from` leftover once `to` exists. Runs
 * BEFORE removeTombstonedPaths. Idempotent: a missing `from` is a no-op.
 * Belt: a move whose `from` the current manifest ships a file at/under is
 * skipped, so a bad producer entry can never displace freshly placed payload.
 * Returns the count of paths acted on (renamed or cleaned up).
 */
function applyMovedPaths(dest, manifest) {
  const movedPaths = manifest.movedPaths
  if (!movedPaths || movedPaths.length === 0) return 0
  const shipped = Object.keys(manifest.files).map(rel =>
    normalizeBundlePath(rel),
  )
  let moved = 0
  for (let i = 0, { length } = movedPaths; i < length; i += 1) {
    const entry = movedPaths[i]
    const from = normalizeBundlePath(entry.from)
    const to = normalizeBundlePath(entry.to)
    if (
      !from ||
      !to ||
      shipped.some(f => f === from || f.startsWith(`${from}/`))
    )
      continue
    const fromAbs = path.join(dest, from)
    if (!existsSync(fromAbs)) continue
    const toAbs = path.join(dest, to)
    if (existsSync(toAbs)) rm(fromAbs)
    else {
      mkdirSync(path.dirname(toAbs), { recursive: true })
      renameSync(fromAbs, toAbs)
    }
    moved += 1
  }
  return moved
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
function removeTombstonedPaths(dest, manifest) {
  const removedPaths = manifest.removedPaths
  if (!removedPaths || removedPaths.length === 0) return 0
  const shipped = Object.keys(manifest.files).map(rel =>
    normalizeBundlePath(rel),
  )
  let removed = 0
  for (let i = 0, { length } = removedPaths; i < length; i += 1) {
    const rel = normalizeBundlePath(removedPaths[i])
    if (!rel || shipped.some(f => f === rel || f.startsWith(`${rel}/`)))
      continue
    const abs = path.join(dest, rel)
    if (existsSync(abs)) {
      rm(abs)
      removed += 1
    }
  }
  return removed
}
/**
 * Prune stale fleet files so a fetch is a true SYNC (place + prune) — scoped
 * to what the bundle PREVIOUSLY owned. Only a file the last-applied manifest
 * shipped (the applied-files record, see readAppliedFiles) that the current
 * manifest no longer ships is deleted. The prune list comes from MANIFESTS,
 * never a directory walk, so repo-owned files that merely live beside the
 * fleet payload — per-repo EXPECTED variants like
 * `.config/fleet/tsconfig.check.json`, `.gitkeep` seeds, cascade-only
 * release-excluded scripts under `scripts/fleet/` — can never be collateral.
 * With no record (fresh clone, or the first refresh that introduces the
 * record) nothing is pruned; the record starts with this apply and the next
 * refresh prunes precisely.
 */
function pruneStaleFleetFiles(dest, manifest, previousFiles) {
  if (!previousFiles || previousFiles.length === 0) return 0
  const kept = new Set(Object.keys(manifest.files).map(normalizeBundlePath))
  for (const segment of manifest.segments ?? [])
    kept.add(normalizeBundlePath(segment.path))
  if (manifest.settingsSegment !== void 0)
    kept.add(normalizeBundlePath(manifest.settingsSegment.path))
  let pruned = 0
  for (let i = 0, { length } = previousFiles; i < length; i += 1) {
    const rel = normalizeBundlePath(previousFiles[i])
    if (kept.has(rel)) continue
    const abs = path.join(dest, rel)
    if (existsSync(abs)) {
      rm(abs)
      pruned += 1
    }
  }
  return pruned
}

//#endregion
//#region scripts/repo/gen/bootstrap/src/install.mts
const logger$4 = getDep0Logger()
/**
 * Place every verified bundle file from `filesDir` into `dest`, creating
 * parent directories as needed. Sentinel-scoped ONLY for the DESIGNATED
 * segment files (FLEET_CANONICAL_SPLICE_FILES): the bundle bytes replace
 * everything through the fleet-canonical end sentinel and the member tail
 * after it survives byte-for-byte — the repo-local oxlintrc ignorePatterns,
 * the derived .prettierignore lockstep-mirrors block. A whole-file copy here
 * wiped exactly those tails on every bootstrap-path refresh. Every other file
 * is a plain byte copy — the PATH gate is load-bearing: content-only gating
 * spliced ANY placed file merely mentioning the sentinel token, stitching
 * stale member tails onto fresh bundle heads (the v1.0.14 fetcher-chimera
 * incident). A designated file landing for the first time also byte-copies.
 */
function installFiles(filesDir, dest, manifest) {
  const locking = readonlyBundleMirrorsEnabled()
  const generatedPaths = new Set(
    (manifest.generatedPaths ?? []).map(normalizeBundlePath),
  )
  const hybridPaths = computeHybridPaths(manifest)
  const rels = Object.keys(manifest.files)
  for (let i = 0, { length } = rels; i < length; i += 1) {
    const rel = rels[i]
    const source = path.join(filesDir, rel)
    const target = path.join(dest, rel)
    if (isAlwaysTrackedSurface(rel) && existsSync(target)) continue
    mkdirSync(path.dirname(target), { recursive: true })
    let spliced
    if (isFleetCanonicalSpliceFile(rel) && existsSync(target)) {
      const sourceContent = readFileSync(source, 'utf8')
      if (hasFleetCanonicalEndSentinel(sourceContent))
        spliced = spliceFleetCanonicalContent(
          sourceContent,
          readFileSync(target, 'utf8'),
        )
    }
    ensureWritableTarget(target)
    if (spliced !== void 0) {
      writeFileSync(target, spliced)
      continue
    }
    copyFileSync(source, target)
    if (
      locking &&
      isLockablePlacement({
        generatedPaths,
        hybridPaths,
        relPath: rel,
      })
    )
      lockFileReadonlySync(target)
  }
}
/**
 * Untrack the bundle's GENERATED build outputs (`manifest.generatedPaths`)
 * from the git index after placement. The bundle SHIPS these files — placement
 * writes them to disk — while the fleet gitignore block ignores them and
 * `generated-outputs-are-untracked` forbids TRACKING them. A member that
 * historically committed one (fleet-pack.cjs et al., before the ignore existed)
 * heals on the next refresh: the file stays on disk, but leaves the index.
 * Non-fatal by design — a non-git dest or an already-clean index is a no-op
 * (`--ignore-unmatch`).
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
    logger$4.log(
      `install-fleet: untracking generated outputs failed (non-fatal) — ${errorMessage(e)}`,
    )
  }
}
/**
 * Apply each fleet-canonical segment: read the `.fleetblock` file, read the
 * consumer's existing file (or start with an empty string), splice the block
 * in, and write back.
 */
function installSegments(segmentsDir, dest, manifest) {
  const segments = manifest.segments
  if (!segments || segments.length === 0) return
  for (const entry of segments) {
    const destName = segmentFileName(entry.path)
    const blockPath = path.join(segmentsDir, destName)
    const fleetBlock = readFileSync(blockPath, 'utf8')
    const targetPath = path.join(dest, entry.path)
    const existing = existsSync(targetPath)
      ? readFileSync(targetPath, 'utf8')
      : ''
    const updated = spliceFleetBlock({
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
    logger$4.log(
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
    logger$4.log(
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
    logger$4.log(
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
      bundleFleetSections,
      consumerYaml,
      fleetKeys: ws.fleetKeys,
    })
    writeFileSync(targetPath, merged)
  } catch (e) {
    logger$4.log(
      `install-fleet: pnpm-workspace.yaml merge failed — ${errorMessage(e)}. Nothing written.`,
    )
    return 1
  }
  return 0
}
const SYNC_FLEET_SCRIPT = 'node scripts/repo/bootstrap/fleet.mjs'
const PREPARE_FETCH = 'node scripts/repo/bootstrap/prepare.mts'
const FLEET_STATUS_SCRIPT = 'node scripts/repo/bootstrap/fleet.mjs --status'
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
    logger$4.log(
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
  if (
    scripts['fleet:status'] !== 'node scripts/repo/bootstrap/fleet.mjs --status'
  ) {
    scripts['fleet:status'] = FLEET_STATUS_SCRIPT
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
function normalizeManifestEntryPath(entry) {
  return normalizeBundlePath(entry.path)
}
/**
 * Compute the gitignore entries for thin mode — the wholly-fleet files that the
 * download/fetch action supplies, so they need not be git-tracked. Hybrid paths
 * (manifest.segments — CLAUDE.md, pnpm-workspace.yaml, …) are merged per repo
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
  const entries = /* @__PURE__ */ new Set()
  const files = Object.keys(manifest.files)
  for (let i = 0, { length } = files; i < length; i += 1) {
    const p = normalizeBundlePath(files[i])
    if (
      hybridPaths.has(p) ||
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
  const endAt = target.indexOf(end, bodyStart)
  if (endAt === -1) return []
  return target
    .slice(bodyStart, endAt)
    .split('\n')
    .filter(line => line.trim() !== '')
}
function isLegacyFleetRegionUntrackEntry(line) {
  if (line === '.agents/') return true
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
 * Strip the old refresh's per-file untrack entries from INSIDE the `<fleet>`
 * region — they live in the fetcher-owned `<fleet-pack>` region now. The
 * cascade's own rules in the region are preserved untouched; a file with no
 * fleet region is returned unchanged. One-time migration shape: once a member
 * has been cleaned (or its cascade rewrote the block), this is a no-op.
 */
function stripLegacyUntrackEntriesFromFleetBlock(target) {
  const begin = beginMarker('hash')
  const end = endMarker('hash')
  const lines = target.split('\n')
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
 * Write the fetcher-owned `<fleet-pack>` `.gitignore` region: `.agents/` (the
 * regenerated agent mirror — dead weight in a thin consumer; the fetch
 * repopulates it) plus the wholly-fleet bundle untrack paths (see
 * fleetPackOwnedPaths). The region is REGENERATED from the manifest on every
 * run — replaced whole, so a stale entry from an earlier pack is pruned
 * instead of carried forward (the old append-only refresh accreted every
 * prior line forever). Hand-added ignores belong outside the markers and are
 * untouched, as is the cascade's `<fleet>` region — the two writers own
 * disjoint regions, so neither can discard the other's rules. The dep-0
 * bootstrap (`scripts/repo/bootstrap/`) is NOT listed: it ships via the
 * manual cascade, never the release bundle, so it never enters this untrack
 * set and stays tracked by default.
 *
 * This is the HALF that is safe to run unconditionally for a thin consumer. It
 * only edits `.gitignore`; it never touches the git index, so a member whose
 * payload is still tracked keeps every file it has committed (gitignore has no
 * effect on tracked paths). The index-mutating half lives in
 * untrackFleetPackPaths and stays behind an explicit `--thin`.
 */
function refreshFleetPackIgnores(config) {
  const { dest, manifest } = {
    __proto__: null,
    ...config,
  }
  const sortedRoots = fleetPackOwnedPaths(manifest)
  const gitignorePath = path.join(dest, '.gitignore')
  const migrated = stripLegacyUntrackEntriesFromFleetBlock(
    existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : '',
  )
  const packBlock = [
    packBeginMarker(),
    '# Fleet-pack untrack set — managed by scripts/repo/bootstrap/fleet.mjs.',
    '# REGENERATED from the release-bundle manifest on every hydrate; stale',
    '# entries are pruned. Hand-added ignores belong OUTSIDE these markers.',
    '.agents/',
    ...sortedRoots,
    packEndMarker(),
  ].join('\n')
  const updated = splicePackBlock({
    packBlock,
    target: migrated,
  })
  writeFileSync(gitignorePath, updated)
}
/**
 * Apply thin mode: refresh the gitignore block (refreshFleetPackIgnores), then
 * untrack those paths from git so the fetch action repopulates them going
 * forward. The `git rm --cached` is the CONVERSION step and is destructive —
 * it drops files from the index — so it stays behind an explicit `--thin` and
 * is never inferred from repo state. socket-vscode is the case that forces the
 * distinction: it carries a pinned `bundle.ref` AND 81 still-tracked payload
 * files, so inferring the untrack from the pin alone would silently delete
 * them from its index on the next ordinary hydrate.
 */
function untrackFleetPackPaths(config) {
  const cfg = {
    __proto__: null,
    ...config,
  }
  const { dest, manifest } = cfg
  refreshFleetPackIgnores(cfg)
  const rmTargets = ['.agents/', ...fleetPackOwnedPaths(manifest)]
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
      logger$4.log(
        `install-fleet: --thin: git rm --cached failed (non-fatal) — ${errorMessage(e)}`,
      )
    }
}

//#endregion
//#region scripts/repo/gen/bootstrap/src/lockstep.mts
const FLEET_REF_RE = /^fleet-pack-[0-9a-f]{7,40}$/
const FULL_SHA_RE = /^[0-9a-f]{40}$/
const FUZZY_REF_RE = /[\^~*]|\b(?:canary|head|latest|lts|main|master|next)\b/i
/**
 * Validate a `bundle.ref` value at WRITE time. Rejects an empty, fuzzy, ranged,
 * or aliased ref — only an exact `fleet-pack-<hex>` tag is legal. Returns the
 * list of problems (empty === valid).
 */
function validateRef(ref) {
  const errors = []
  if (typeof ref !== 'string' || ref.length === 0) {
    errors.push('`bundle.ref` must be a non-empty string.')
    return {
      ok: false,
      errors,
    }
  }
  if (FUZZY_REF_RE.test(ref))
    errors.push(
      `\`bundle.ref\` must be an exact \`fleet-pack-<hex>\` tag — no range/alias (\`^\` \`~\` \`*\` \`latest\` \`lts\` \`main\` …); got ${JSON.stringify(ref)}.`,
    )
  if (!FLEET_REF_RE.test(ref))
    errors.push(
      `\`bundle.ref\` must match ${String(FLEET_REF_RE)} (a \`fleet-pack-<hex>\` release tag); got ${JSON.stringify(ref)}.`,
    )
  return {
    ok: errors.length === 0,
    errors,
  }
}
/**
 * Validate a `bundle.cascadeSha` value at WRITE time. Rejects anything that is
 * not a bare 40-char lowercase hex SHA (no `v` prefix, no range, no alias).
 */
function validateCascadeSha(cascadeSha) {
  const errors = []
  if (typeof cascadeSha !== 'string' || cascadeSha.length === 0) {
    errors.push('`bundle.cascadeSha` must be a non-empty string.')
    return {
      ok: false,
      errors,
    }
  }
  if (!FULL_SHA_RE.test(cascadeSha))
    errors.push(
      `\`bundle.cascadeSha\` must be a bare full-length git SHA (40 lowercase hex chars); got ${JSON.stringify(cascadeSha)}.`,
    )
  return {
    ok: errors.length === 0,
    errors,
  }
}
/**
 * Validate a complete `bundle` block (both fields together). Used by the
 * write-time gate in the config reader + the cascade stamper.
 */
function validateBundleBlock(bundle) {
  if (typeof bundle !== 'object' || bundle === null || Array.isArray(bundle))
    return {
      ok: false,
      errors: ['`bundle` must be an object.'],
    }
  const b = bundle
  const refResult = validateRef(b.ref)
  const shaResult = validateCascadeSha(b.cascadeSha)
  const errors = [...refResult.errors, ...shaResult.errors]
  return {
    ok: errors.length === 0,
    errors,
  }
}
/**
 * Resolve the lock-step state from the PARSED inputs (never a substring scan).
 * Pure — no IO — so the three states + their exit codes unit-test offline.
 *
 * - CURRENT: inLockStep AND no newer release.
 * - UPDATE-AVAILABLE: inLockStep but a newer release exists.
 * - OUT-OF-SYNC: cascadeSha !== pinnedTemplateSha (broken invariant).
 *
 * When `pinnedTemplateSha` is undefined the ref's release could not be found,
 * so the invariant cannot be confirmed and the state is OUT-OF-SYNC — fail loud
 * rather than assume current.
 */
function resolveLockStepState(inputs) {
  const { config, newestRef, newestTemplateSha, pinnedTemplateSha } = inputs
  const inLockStep =
    pinnedTemplateSha !== void 0 && config.cascadeSha === pinnedTemplateSha
  const updateAvailable =
    inLockStep &&
    newestTemplateSha !== void 0 &&
    newestTemplateSha !== pinnedTemplateSha
  let state
  if (!inLockStep) state = 'out-of-sync'
  else if (updateAvailable) state = 'update-available'
  else state = 'current'
  return {
    config,
    inLockStep,
    newestRef,
    newestTemplateSha,
    pinnedTemplateSha,
    state,
    updateAvailable,
  }
}
/**
 * The terraform `-detailed-exitcode`-style exit code for a resolved state.
 * 0  CURRENT, or UPDATE-AVAILABLE without --exit-code.
 * 10 UPDATE-AVAILABLE WITH --exit-code (a clean "drift detected" signal).
 * 1  OUT-OF-SYNC — ALWAYS (broken invariant, fail loud regardless of flags).
 */
function lockStepExitCode(state, options) {
  const opts = {
    __proto__: null,
    ...options,
  }
  if (state.state === 'out-of-sync') return 1
  if (state.state === 'update-available') return opts?.exitCode ? 10 : 0
  return 0
}
const ERR_LOCKSTEP_MISMATCH = 'ERR_WHEELHOUSE_LOCKSTEP_MISMATCH'
/**
 * Build the pnpm-style lock-step mismatch error from the PARSED fields (never
 * stitched from substrings). Lines: code + What / Where / Wanted / Saw / Fix.
 * Prints BOTH the raw ref and the resolved release templateSha so the operator
 * can see which side drifted.
 */
function formatLockStepError(parts) {
  const { cascadeSha, pinnedTemplateSha, ref } = parts
  const sawTemplate =
    pinnedTemplateSha === void 0
      ? 'no release found at that ref'
      : `release templateSha ${pinnedTemplateSha}`
  return [
    `${ERR_LOCKSTEP_MISMATCH}  the pinned bundle is out of lock-step.`,
    `  What:   bundle out of lock-step — the pinned release and the cascaded template SHA disagree.`,
    `  Where:  .config/repo/socket-wheelhouse.json (bundle.ref + bundle.cascadeSha).`,
    `  Wanted: bundle.cascadeSha === templateSha of the release at bundle.ref.`,
    `  Saw:    ref = ${ref} (${sawTemplate}), cascadeSha = ${cascadeSha}.`,
    `  Fix:    re-cascade to the pin — \`node scripts/repo/sync-scaffolding/cli.mts --target . --fix\` — OR re-pin bundle.ref to the release whose templateSha is ${cascadeSha}.`,
  ].join('\n')
}
const NOTICE_STORE_REL = '.cache/fleet/socket-wheelhouse/update-notice.json'
const TWENTY_FOUR_HOURS_MS = 864e5
const UPDATE_NOTIFIER_OPT_OUT_ENV = 'WHEELHOUSE_NO_UPDATE_NOTIFIER'
function readNoticeStore(dest) {
  const p = path.join(dest, NOTICE_STORE_REL)
  if (!existsSync(p)) return
  try {
    const json = JSON.parse(readFileSync(p, 'utf8'))
    return {
      lastCheckMs: typeof json.lastCheckMs === 'number' ? json.lastCheckMs : 0,
      lastSeenRef:
        typeof json.lastSeenRef === 'string' ? json.lastSeenRef : void 0,
    }
  } catch {
    return
  }
}
function writeNoticeStore(dest, store) {
  const p = path.join(dest, NOTICE_STORE_REL)
  mkdirSync(path.dirname(p), { recursive: true })
  writeFileSync(
    p,
    `${JSON.stringify(
      {
        lastCheckMs: store.lastCheckMs,
        lastSeenRef: store.lastSeenRef,
      },
      void 0,
      2,
    )}\n`,
  )
}
/**
 * Decide whether the passive update notice should print. Pure so the throttle +
 * CI-suppress + opt-out unit-test offline. The notice fires only when: a newer
 * release exists, we are NOT in CI, NOT opted out, and either the store is
 * empty, ≥24h have passed since the last check, OR the newest ref changed since
 * last seen. A fresh release bypasses the 24h throttle immediately.
 */
function shouldShowNotice(inputs) {
  const { ci, newestRef, nowMs, optedOut, store, updateAvailable } = inputs
  if (!updateAvailable || ci || optedOut || newestRef === void 0) return false
  if (store === void 0) return true
  if (store.lastSeenRef !== newestRef) return true
  return nowMs - store.lastCheckMs >= TWENTY_FOUR_HOURS_MS
}
/**
 * Format the boxed passive notice. NAMES the re-cascade as the action (never a
 * bare re-fetch). Honors NO_COLOR by dropping the box-drawing emphasis to plain
 * ASCII when `color` is false.
 */
function formatUpdateNotice(config) {
  const { color, newestRef } = {
    __proto__: null,
    ...config,
  }
  const lines = [
    'A newer fleet scaffolding release is available.',
    `Re-cascade to ${newestRef}:`,
    'node scripts/repo/sync-scaffolding/cli.mts --target . --fix',
  ]
  if (!color) return lines.map(l => `  ${l}`).join('\n')
  const width = Math.max(...lines.map(l => l.length))
  const top = `╭${'─'.repeat(width + 2)}╮`
  const bottom = `╰${'─'.repeat(width + 2)}╯`
  return [top, ...lines.map(l => `│ ${l.padEnd(width)} │`), bottom].join('\n')
}

//#endregion
//#region scripts/repo/gen/bootstrap/src/resolve.mts
/**
 * @file GitHub release resolution and lock-step assertion helpers.
 *   Extracted from fleet.mts to keep that file under the 500-line soft cap.
 *   All functions here shell out to `gh` (dep-0: no socket-lib) or are pure
 *   logic; none do filesystem writes.
 *   Lock-step note: assertLockStep enforces the cascadeSha === templateSha
 *   invariant but does not resolve refs itself — see resolveReleaseTemplateSha.
 */
const logger$3 = getDep0Logger()
const MANIFEST_NAME$2 = 'release-bundle-manifest.json'
/**
 * Assert the lock-step invariant before applying a release: the member's pinned
 * `bundle.cascadeSha` MUST equal the release's `templateSha`.
 * `--frozen-lockfile` semantics — a hard fail (never apply a mismatched
 * release). Returns true when intact OR when the member declares no
 * `cascadeSha` (a non-lock-step member — the legacy ref-only pin still
 * fetches). Logs the parsed error + returns false on mismatch.
 */
function assertLockStep(config) {
  const { cascadeSha, manifestTemplateSha, ref } = {
    __proto__: null,
    ...config,
  }
  if (cascadeSha === void 0) return true
  if (cascadeSha === manifestTemplateSha) return true
  logger$3.error(
    formatLockStepError({
      cascadeSha,
      pinnedTemplateSha: manifestTemplateSha,
      ref,
    }),
  )
  return false
}
const ERR_BUNDLE_BEHIND_LOCAL = 'ERR_WHEELHOUSE_BUNDLE_BEHIND_LOCAL_TEMPLATE'
/**
 * True when a sibling wheelhouse checkout exists AND its HEAD is strictly
 * DESCENDED from the bundle's template SHA — the bundle is a frozen snapshot
 * of an older template, so unpacking it would roll the member backwards.
 *
 * `assertLockStep` only proves the bundle matches its own pin, which is a
 * self-consistency check. It cannot see that the pin itself went stale. On a
 * machine that also cascades from a local template, the two writers disagree
 * and whichever runs last wins: the cascade writes current content, then
 * `update`'s bundle pass restores the older snapshot over it. That reverted a
 * Socket catalog pin, dropped fleet rules out of CLAUDE.md, and reintroduced a
 * duplicated overrides block that broke `pnpm install` — each time reported as
 * a successful update.
 *
 * Returns false when there is no local wheelhouse (a thin member, or CI),
 * where the bundle IS the only source of truth and applying it is correct.
 * Any git failure also returns false: this guard refuses a provably stale
 * bundle, and never blocks on a question it could not answer.
 */
function isBundleBehindLocalTemplate(config) {
  const { dest, manifestTemplateSha } = {
    __proto__: null,
    ...config,
  }
  if (!manifestTemplateSha) return false
  const wheelhouse = path.join(dest, '..', 'socket-wheelhouse')
  if (!existsSync(path.join(wheelhouse, '.git'))) return false
  try {
    execFileSync(
      'git',
      ['merge-base', '--is-ancestor', manifestTemplateSha, 'HEAD'],
      {
        cwd: wheelhouse,
        stdio: 'ignore',
      },
    )
    return (
      execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: wheelhouse,
        encoding: 'utf8',
      }).trim() !== manifestTemplateSha
    )
  } catch {
    return false
  }
}
/**
 * Resolve the NEWEST `fleet-pack-<hex>` release tag via `gh release list`.
 * Returns the latest tag, or undefined when none / offline. The list is
 * newest-first.
 */
function resolveNewestRef(repo) {
  try {
    const out = execFileSync(
      'gh',
      [
        'release',
        'list',
        '--repo',
        repo,
        '--limit',
        '30',
        '--json',
        'tagName,createdAt',
      ],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    )
    const rows = JSON.parse(out)
    for (const row of rows)
      if (
        typeof row.tagName === 'string' &&
        /^fleet-pack-[0-9a-f]{7,40}$/.test(row.tagName)
      )
        return row.tagName
    return
  } catch {
    return
  }
}
/**
 * Resolve a release's `templateSha` from its manifest asset via gh. Dep-0:
 * shells `gh release download <ref> --pattern release-bundle-manifest.json` and
 * reads the stamped field. Returns undefined when the release / asset / field
 * is absent (offline, no such tag) — the caller decides whether that's fatal.
 */
function resolveReleaseTemplateSha(ref, repo) {
  if (!ref) return
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'fleet-status-'))
  try {
    execFileSync(
      'gh',
      [
        'release',
        'download',
        ref,
        '--repo',
        repo,
        '--pattern',
        MANIFEST_NAME$2,
        '--dir',
        tmp,
      ],
      { stdio: ['ignore', 'ignore', 'ignore'] },
    )
    const manifestPath = path.join(tmp, MANIFEST_NAME$2)
    if (!existsSync(manifestPath)) return
    const json = JSON.parse(readFileSync(manifestPath, 'utf8'))
    return typeof json.templateSha === 'string' ? json.templateSha : void 0
  } catch {
    return
  } finally {
    rm(tmp)
  }
}

//#endregion
//#region scripts/repo/gen/bootstrap/src/ghcr-fetch.mts
const GHCR_HOST = 'ghcr.io'
const MANIFEST_ACCEPT = [
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
].join(', ')
const MAX_REDIRECTS = 5
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
    https
      .get(url, { headers }, res => {
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
      .on('error', reject)
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
 * Obtain an anonymous pull token. Hits the documented token endpoint first; on
 * anything but a usable token, falls back to the 401 WWW-Authenticate challenge
 * form (probe /v2/, follow the advertised realm). Fails loud when no token can
 * be obtained.
 */
async function getGhcrToken(repo, registry, httpFn = httpGet) {
  const primary = await httpFn(ghcrTokenUrl(repo, registry), {
    headers: { accept: 'application/json' },
  })
  const primaryToken =
    primary.status >= 200 && primary.status < 300
      ? tokenFromBody(primary.body)
      : void 0
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
  const token = tokenFromBody(res.body)
  if (!token)
    throw new Error(`Cannot obtain a GHCR anonymous pull token.
  Where: ${challenge.realm} for repo ${repo}\n  Saw:   HTTP ${res.status} with no token in the body\n  Fix:   confirm the package is public and speaks the OCI token flow.`)
  return token
}
/**
 * GET one manifest by tag or digest. Resolves a multi-arch index to its first
 * sub-manifest so a concrete image manifest that carries the artifact layer is
 * always returned. Fails loud on a non-2xx.
 */
async function fetchOciManifest(repo, ref, token, registry, httpFn = httpGet) {
  const res = await httpFn(`https://${registry}/v2/${repo}/manifests/${ref}`, {
    headers: {
      accept: MANIFEST_ACCEPT,
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
    return fetchOciManifest(repo, sub, token, registry, httpFn)
  }
  return manifest
}
/**
 * Choose the tarball layer from an artifact manifest: prefer a layer whose
 * `org.opencontainers.image.title` ends in `.tar.gz`, then a gzip/tar media
 * type, else the sole layer. Throws when no usable layer exists.
 */
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
  const layer = pickBundleLayer(
    await fetchOciManifest(cfg.repo, cfg.tag, token, registry, httpFn),
  )
  const blob = await fetchBlob(cfg.repo, layer.digest, token, registry, httpFn)
  const actual = `sha256:${sha256Hex(blob)}`
  if (actual !== layer.digest)
    throw new Error(`GHCR bundle blob failed SHA-256 verification.
  Where: /v2/${cfg.repo}/blobs/${layer.digest} on ${registry}\n  Saw:   ${actual}\n  Wanted: ${layer.digest}\n  Fix:   the blob is corrupt or was tampered with; re-pull or re-publish.`)
  const tarballPath = path.join(
    cfg.destDir,
    `socket-wheelhouse-fleet-${cfg.tag}.tar.gz`,
  )
  writeFileSync(tarballPath, blob)
  return tarballPath
}

//#endregion
//#region scripts/repo/gen/bootstrap/src/bundle-source.mts
const logger$2 = getDep0Logger()
const MANIFEST_NAME$1 = 'release-bundle-manifest.json'
/**
 * Derive the GHCR fleet-pack package repo from the gh `owner/repo`. GHCR
 * package paths are lowercase: `SocketDev/socket-wheelhouse` →
 * `socketdev/socket-wheelhouse/fleet-pack`.
 */
function ghcrBundleRepo(repo) {
  return `${repo.toLowerCase()}/fleet-pack`
}
/**
 * Extract just the release-bundle manifest from the bundle tarball root (the
 * tarball ships it beside files/ + segments/), so the GHCR path yields the same
 * on-disk `sourceManifest` file the gh-release path downloads separately.
 */
function extractManifestFromTarball(tarball, destDir) {
  run(tarExecutable(process.platform, process.env['SystemRoot']), [
    '-xzf',
    tarball,
    '-C',
    destDir,
    MANIFEST_NAME$1,
  ])
  return path.join(destDir, MANIFEST_NAME$1)
}
/**
 * Default GHCR fetch: anonymous OCI pull of the fleet-pack tarball, then pull
 * the manifest out of it. Throws on any failure so the selector can fall back.
 */
async function ghcrFetchBundle(config) {
  const cfg = {
    __proto__: null,
    ...config,
  }
  const tarball = await pullFleetBundleTarball({
    destDir: cfg.tmp,
    repo: ghcrBundleRepo(cfg.repo),
    tag: cfg.ref,
  })
  return {
    manifest: extractManifestFromTarball(tarball, cfg.tmp),
    tarball,
  }
}
/**
 * Default GitHub-Release fetch (the fallback): `gh release download` of the
 * tarball + manifest assets. Throws with an actionable message when the release
 * lacks either asset.
 */
async function ghReleaseFetchBundle(config) {
  const cfg = {
    __proto__: null,
    ...config,
  }
  run('gh', [
    'release',
    'download',
    cfg.ref,
    '--repo',
    cfg.repo,
    '--pattern',
    '*.tar.gz',
    '--pattern',
    MANIFEST_NAME$1,
    '--dir',
    cfg.tmp,
  ])
  const manifest = path.join(cfg.tmp, MANIFEST_NAME$1)
  if (!existsSync(manifest))
    throw new Error(`release ${cfg.ref} has no ${MANIFEST_NAME$1} asset.`)
  const tarball = readdirSync(cfg.tmp).find(f => f.endsWith('.tar.gz'))
  if (!tarball) throw new Error(`release ${cfg.ref} has no .tar.gz asset.`)
  return {
    manifest,
    tarball: path.join(cfg.tmp, tarball),
  }
}
/**
 * Fetch the fleet bundle: GHCR primary, GitHub-Release fallback. Tries the
 * anonymous OCI pull first; on ANY failure logs the reason to STDERR and falls
 * back to `gh release download`. Returns the on-disk tarball + manifest paths
 * plus which source served them. The injectable `ghcrFetch` / `ghFetch` seams
 * let tests drive both paths without network.
 */
async function fetchBundleSource(config) {
  const cfg = {
    __proto__: null,
    ...config,
  }
  const ghcrFetch = cfg.ghcrFetch ?? ghcrFetchBundle
  const ghFetch = cfg.ghFetch ?? ghReleaseFetchBundle
  try {
    const fetched = await ghcrFetch({
      ref: cfg.ref,
      repo: cfg.repo,
      tmp: cfg.tmp,
    })
    logger$2.error(
      `install-fleet: fetched ${cfg.ref} from ghcr (${ghcrBundleRepo(cfg.repo)}).`,
    )
    return {
      ...fetched,
      source: 'ghcr',
    }
  } catch (e) {
    logger$2.error(
      `install-fleet: ghcr pull failed for ${cfg.ref} (${errorMessage(e)}); falling back to gh release download.`,
    )
  }
  const fetched = await ghFetch({
    ref: cfg.ref,
    repo: cfg.repo,
    tmp: cfg.tmp,
  })
  logger$2.error(
    `install-fleet: fetched ${cfg.ref} from gh release (${cfg.repo}).`,
  )
  return {
    ...fetched,
    source: 'gh-release',
  }
}

//#endregion
//#region scripts/repo/gen/bootstrap/src/status.mts
/**
 * @file Status display helpers for `fleet:status` — the read-only status verb.
 *   Extracted from fleet.mts to keep that file under the 500-line soft cap.
 *   All functions here are pure display or throttle logic; none mutate the
 *   install state.
 *   Lock-step note: the sibling lockstep.mts module owns the lock-step state
 *   machine; this file only formats and renders it.
 */
const logger$1 = getDep0Logger()
/**
 * Fire the passive update notice opportunistically (update-notifier style). The
 * caller already resolved a newer release exists; this throttles to once/24h
 * via the out-of-tree store, suppresses in CI, honors the opt-out env +
 * NO_COLOR, and NAMES the re-cascade. NEVER weakens the fetch-path verify or
 * the status hard-fail — it only silences the box. Returns true when a notice
 * was printed.
 */
function maybeShowUpdateNotice(config) {
  const { dest, newestRef, updateAvailable } = {
    __proto__: null,
    ...config,
  }
  const store = readNoticeStore(dest)
  if (
    !shouldShowNotice({
      ci: process.env['CI'] !== void 0 && process.env['CI'] !== '',
      newestRef,
      nowMs: Date.now(),
      optedOut: process.env['WHEELHOUSE_NO_UPDATE_NOTIFIER'] === '1',
      store,
      updateAvailable,
    }) ||
    newestRef === void 0
  )
    return false
  const color = process.env['NO_COLOR'] === void 0
  process.stderr.write(
    `${formatUpdateNotice({
      color,
      newestRef,
    })}\n`,
  )
  writeNoticeStore(dest, {
    lastCheckMs: Date.now(),
    lastSeenRef: newestRef,
  })
  return true
}
function printStatusReport(state, config) {
  const cfg = {
    __proto__: null,
    ...config,
  }
  const pinnedCell = `${state.config.ref} (${state.pinnedTemplateSha ?? '—'})`
  const landedCell = state.config.cascadeSha || '—'
  const newestCell =
    state.newestRef === void 0
      ? '—'
      : `${state.newestRef} (${state.newestTemplateSha ?? '—'})`
  if (state.state === 'current') {
    logger$1.log(`fleet:status: CURRENT — pinned ${pinnedCell}, in lock-step.`)
    return
  }
  if (!cfg.noHeader)
    logger$1.log('  Pinned                         | Landed       | Newest')
  const mismatchTag = state.state === 'out-of-sync' ? '  [MISMATCH]' : ''
  logger$1.log(`  ${pinnedCell} | ${landedCell} | ${newestCell}${mismatchTag}`)
  if (state.state === 'update-available' && state.newestRef !== void 0) {
    logger$1.log(`re-cascade to ${state.newestRef}`)
    return
  }
  logger$1.error(
    formatLockStepError({
      cascadeSha: state.config.cascadeSha,
      pinnedTemplateSha: state.pinnedTemplateSha,
      ref: state.config.ref,
    }),
  )
}
/**
 * Stable-keyed JSON shape for `fleet:status --json`. Keys never change between
 * states so a script can read them unconditionally.
 */
function statusJson(state) {
  return {
    cascadeSha: state.config.cascadeSha,
    inLockStep: state.inLockStep,
    newestRef: state.newestRef ?? null,
    newestTemplateSha: state.newestTemplateSha ?? null,
    pinnedRef: state.config.ref,
    pinnedTemplateSha: state.pinnedTemplateSha ?? null,
    state: state.state,
    updateAvailable: state.updateAvailable,
  }
}

//#endregion
//#region scripts/repo/gen/bootstrap/src/fleet.mts
const logger = getDep0Logger()
const DEFAULT_REPO = 'SocketDev/socket-wheelhouse'
const MANIFEST_NAME = 'release-bundle-manifest.json'
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
    exitCode: false,
    ifCurrent: false,
    json: false,
    manifest: void 0,
    noHeader: false,
    quiet: false,
    ref: '',
    repo: DEFAULT_REPO,
    status: false,
    thin: false,
    wire: false,
  }
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const arg = argv[i]
    if (arg === void 0) break
    if (arg === '--dest') opts.dest = argv[++i] ?? repoRoot
    else if (arg === '--bundle') opts.bundle = argv[++i]
    else if (arg === '--dry-run') opts.dryRun = true
    else if (arg === '--exit-code') opts.exitCode = true
    else if (arg === '--if-current') opts.ifCurrent = true
    else if (arg === '--json') opts.json = true
    else if (arg === '--manifest') opts.manifest = argv[++i]
    else if (arg === '--no-header') opts.noHeader = true
    else if (arg === '--quiet') opts.quiet = true
    else if (arg === '--ref') opts.ref = argv[++i] ?? ''
    else if (arg === '--repo') opts.repo = argv[++i] ?? DEFAULT_REPO
    else if (arg === '--status') opts.status = true
    else if (arg === '--thin') opts.thin = true
    else if (arg === '--wire') opts.wire = true
  }
  return opts
}
/**
 * Render the `fleet:status` report. Read-only — NEVER mutates. Resolves the
 * pinned release's templateSha + the newest release, builds the lock-step
 * state, prints the table / JSON / line, and returns the terraform-style exit
 * code (0 CURRENT, 0|10 UPDATE-AVAILABLE, 1 OUT-OF-SYNC).
 */
function runStatus(config) {
  const cfg = {
    __proto__: null,
    ...config,
  }
  const dest = path.resolve(cfg.dest ?? repoRoot)
  const repo = cfg.repo ?? DEFAULT_REPO
  const bundleConfig = readBundleConfig(dest)
  const ref = cfg.ref || bundleConfig.ref || ''
  if (!ref) {
    if (!cfg.quiet)
      logger.log(
        'fleet:status: no bundle.ref pinned in .config/repo/socket-wheelhouse.json — not a thin consumer.',
      )
    return 0
  }
  const lockStepConfig = {
    cascadeSha: bundleConfig.cascadeSha ?? '',
    ref,
  }
  const pinnedTemplateSha = resolveReleaseTemplateSha(ref, repo)
  const newestRef = resolveNewestRef(repo)
  const newestTemplateSha =
    newestRef === void 0
      ? void 0
      : newestRef === ref
        ? pinnedTemplateSha
        : resolveReleaseTemplateSha(newestRef, repo)
  const state = resolveLockStepState({
    config: lockStepConfig,
    newestRef,
    newestTemplateSha,
    pinnedTemplateSha,
  })
  if (cfg.json) {
    if (!cfg.quiet) logger.log(JSON.stringify(statusJson(state)))
  } else if (!cfg.quiet)
    printStatusReport(state, { noHeader: cfg.noHeader ?? false })
  return lockStepExitCode(state, { exitCode: cfg.exitCode ?? false })
}
/**
 * Download, verify, and apply the fleet bundle identified by `config.ref`.
 * Returns 0 on success, 1 on any error.
 */
async function installFleet(config) {
  const cfg = {
    __proto__: null,
    ...config,
  }
  const dest = path.resolve(cfg.dest ?? repoRoot)
  const bundlePath = cfg.bundle !== void 0 ? path.resolve(cfg.bundle) : void 0
  const manifestPath =
    cfg.manifest !== void 0 ? path.resolve(cfg.manifest) : void 0
  const ref = cfg.ref || readBundleRef(dest) || ''
  if (!ref && bundlePath === void 0) {
    if (cfg.ifCurrent) {
      logger.log(
        'install-fleet: no bundle.ref pinned — not a thin consumer, nothing to fetch.',
      )
      return 0
    }
    logger.log(
      'install-fleet: no --ref and no `bundle.ref` in .config/repo/socket-wheelhouse.json. Pass --ref fleet-pack-<sha> or set bundle.ref.',
    )
    return 1
  }
  if (cfg.ifCurrent && readAppliedRef(dest) === ref) {
    logger.log(`install-fleet: bundle ${ref} already applied — skipping fetch.`)
    return 0
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
      tarExecutable(process.platform, process.env['SystemRoot']),
      tarExtractArgs({
        archive: sourceTarball,
        destination: extractDir,
        platform: process.platform,
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
    if (bundlePath === void 0) {
      const cascadeSha = readBundleConfig(dest).cascadeSha
      if (
        !assertLockStep({
          cascadeSha,
          manifestTemplateSha: manifest.templateSha,
          ref: sourceRef,
        })
      ) {
        logger.error(
          `install-fleet: ${ERR_LOCKSTEP_MISMATCH} — refusing to apply ${sourceRef}; nothing written.`,
        )
        return 1
      }
      if (
        isBundleBehindLocalTemplate({
          dest,
          manifestTemplateSha: manifest.templateSha,
        })
      ) {
        logger.error(
          `install-fleet: ${ERR_BUNDLE_BEHIND_LOCAL} — ${sourceRef} carries template ${manifest.templateSha}, which the sibling socket-wheelhouse checkout has already moved past. Applying it would revert this repo to an older snapshot. Nothing written.\n  Fix: cascade from the local template instead —\n    node scripts/repo/sync-scaffolding/cli.mts --target ${dest} --fix\n  Or repin bundle.ref/cascadeSha in .config/repo/socket-wheelhouse.json to a release cut from the current template.`,
        )
        return 1
      }
    }
    const fileCount = Object.keys(manifest.files).length
    const segmentCount =
      (manifest.segments?.length ?? 0) +
      (manifest.settingsSegment === void 0 ? 0 : 1)
    if (cfg.dryRun) {
      logger.log(
        `install-fleet: [dry-run] ${fileCount} file(s) + ${segmentCount} segment(s) verified for ${sourceRef} (template ${manifest.templateSha}). Would write into ${dest}.`,
      )
      return 0
    }
    installFiles(filesDir, dest, manifest)
    untrackGeneratedOutputs(dest, manifest.generatedPaths)
    const prunedCount = pruneStaleFleetFiles(
      dest,
      manifest,
      readAppliedFiles(dest),
    )
    const movedCount = applyMovedPaths(dest, manifest)
    const tombstonedCount = removeTombstonedPaths(dest, manifest)
    installSegments(segmentsDir, dest, manifest)
    const settingsResult = installSettingsSegment(segmentsDir, dest, manifest)
    if (settingsResult !== 0) return settingsResult
    const wsResult = installWorkspaceSegment(segmentsDir, dest, manifest)
    if (wsResult !== 0) return wsResult
    if (cfg.wire) wirePackageJson(dest)
    if (cfg.thin)
      untrackFleetPackPaths({
        dest,
        manifest,
      })
    else if (readBundleRef(dest) !== void 0)
      refreshFleetPackIgnores({
        dest,
        manifest,
      })
    writeAppliedRef(dest, sourceRef)
    writeAppliedFiles(dest, Object.keys(manifest.files))
    const prunedTotal = prunedCount + tombstonedCount
    const movedNote = movedCount > 0 ? `, moved ${movedCount}` : ''
    const prunedNote =
      (prunedTotal > 0 ? `, pruned ${prunedTotal} stale` : '') + movedNote
    logger.log(
      `install-fleet: placed ${fileCount} file(s) + ${segmentCount} segment(s)${prunedNote} from ${sourceRef} (template ${manifest.templateSha}) → ${dest}.`,
    )
    return 0
  } finally {
    rm(tmp)
  }
}
function isMainModule() {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entry)
  } catch {
    return false
  }
}
if (isMainModule()) {
  const parsed = parseArgs(process.argv.slice(2))
  process.exitCode = parsed.status
    ? runStatus(parsed)
    : await installFleet(parsed)
}

//#endregion
export {
  ERR_BUNDLE_BEHIND_LOCAL,
  ERR_LOCKSTEP_MISMATCH,
  FLEET_STATUS_SCRIPT,
  GHCR_HOST,
  MANIFEST_ACCEPT,
  PREPARE_FETCH,
  SETTINGS_CANDIDATES,
  SYNC_FLEET_SCRIPT,
  UPDATE_NOTIFIER_OPT_OUT_ENV,
  applyMovedPaths,
  assertLockStep,
  beginMarker,
  computeSha256,
  endMarker,
  errorMessage,
  extractFleetBlockLines,
  extractManifestFromTarball,
  fetchBlob,
  fetchBundleSource,
  fetchOciManifest,
  firstHeader,
  fleetPackOwnedPaths,
  formatLockStepError,
  formatUpdateNotice,
  getGhcrToken,
  ghReleaseFetchBundle,
  ghcrBundleRepo,
  ghcrFetchBundle,
  ghcrTokenUrl,
  httpGet,
  installFiles,
  installFleet,
  installSegments,
  installSettingsSegment,
  installWorkspaceSegment,
  isBundleBehindLocalTemplate,
  isMainModule,
  legacyBeginMarker,
  legacyEndMarker,
  legacyTagBeginMarker,
  legacyTagEndMarker,
  lockStepExitCode,
  maybeShowUpdateNotice,
  mergeWorkspaceYaml,
  mergeYamlKeyBlock,
  normalizeBundlePath,
  normalizeManifestEntryPath,
  packBeginMarker,
  packEndMarker,
  parseArgs,
  parseWwwAuthenticate,
  parseYamlEntryChunks,
  parseYamlKeyBlocks,
  pickBundleLayer,
  printStatusReport,
  pruneStaleFleetFiles,
  pullFleetBundleTarball,
  readAppliedFiles,
  readAppliedRef,
  readBundleConfig,
  readBundleRef,
  readManifest,
  readNoticeStore,
  refreshFleetPackIgnores,
  removeTombstonedPaths,
  resolveLockStepState,
  resolveNewestRef,
  resolveReleaseTemplateSha,
  resolveRepoRoot,
  resolveSettingsPath,
  run,
  runStatus,
  segmentFileName,
  sha256Hex,
  shouldShowNotice,
  spliceFleetBlock,
  splicePackBlock,
  spliceYamlSeparatorRun,
  statusJson,
  stripLegacyUntrackEntriesFromFleetBlock,
  tarExecutable,
  tarExtractArgs,
  tokenFromBody,
  untrackFleetPackPaths,
  untrackGeneratedOutputs,
  validateBundleBlock,
  validateCascadeSha,
  validateRef,
  verifyBundleFiles,
  verifySegments,
  wirePackageJson,
  writeAppliedFiles,
  writeAppliedRef,
  writeNoticeStore,
}
