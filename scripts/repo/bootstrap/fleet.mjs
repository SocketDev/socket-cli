#!/usr/bin/env node
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'

//#region template/bootstrap/src/helpers.mts
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
 * The open marker line for a given comment style — canonical bare-tag form,
 * matching the grammar used by fleet-markers.mts on the producer side. Inlined
 * here so this file stays dep-0 — it cannot import the wheelhouse's
 * fleet-markers module.
 */
function beginMarker(style) {
  if (style === 'html') return '<!-- <fleet-canonical> -->'
  if (style === 'slash') return '// <fleet-canonical>'
  return '# <fleet-canonical>'
}
/**
 * The close marker line for a given comment style — canonical bare-tag form.
 */
function endMarker(style) {
  if (style === 'html') return '<!-- </fleet-canonical> -->'
  if (style === 'slash') return '// </fleet-canonical>'
  return '# </fleet-canonical>'
}
/**
 * Returns the BEGIN/END marker form for a style. spliceFleetBlock matches it
 * alongside the bare-tag form, so a file carrying either form is re-spliced in
 * one pass.
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
 * the open/close markers (bare-tag or legacy BEGIN/END form), the content
 * between them (markers inclusive) is replaced. If markers are absent:
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
  const legacy0 = legacyBeginMarker(commentStyle)
  const legacy1 = legacyEndMarker(commentStyle)
  const lines = target.split('\n')
  const startIdx = lines.findIndex(l => l === begin || l === legacy0)
  const endIdx = lines.findIndex(l => l === end || l === legacy1)
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
const COL0_KEY_RE = /^[A-Za-z][\w-]*:/
/**
 * Parse a YAML string into an ordered list of top-level key blocks. Each block
 * owns all lines from the key line up to (not including) the next column-0 key
 * line or EOF.
 */
function parseYamlKeyBlocks(yaml) {
  const lines = yaml.split('\n')
  const blocks = []
  let current
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]
    if (COL0_KEY_RE.test(line)) {
      if (current !== void 0) blocks.push(current)
      const colonIdx = line.indexOf(':')
      current = {
        key: line.slice(0, colonIdx),
        lines: [line],
      }
    } else if (current !== void 0) current.lines.push(line)
  }
  if (current !== void 0) blocks.push(current)
  return blocks
}
/**
 * Merge the fleet-managed workspace sections from `bundleFleetSections` into
 * `consumerYaml`, replacing only the keys listed in `fleetKeys`. Non-fleet keys
 * (including `packages:`) are preserved byte-exact. Throws on ambiguous input.
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
      if (bundleBlock !== void 0) resultBlocks.push(bundleBlock)
      else resultBlocks.push(block)
      handledFleetKeys.add(block.key)
    } else resultBlocks.push(block)
  for (const key of fleetKeys)
    if (!handledFleetKeys.has(key)) {
      const bundleBlock = bundleMap.get(key)
      if (bundleBlock !== void 0) resultBlocks.push(bundleBlock)
    }
  return `${resultBlocks
    .map(b => b.lines.join('\n'))
    .join('\n')
    .replace(/\n+$/, '')}\n`
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
function walkFiles(dir, base) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walkFiles(abs, base))
    else if (entry.isFile()) out.push(path.relative(base, abs))
  }
  return out
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
//#region template/bootstrap/src/install-thin-prune.mts
const PRUNE_SKIP_NAMES = /* @__PURE__ */ new Set([
  '._.DS_Store',
  '.DS_Store',
  'Thumbs.db',
])
/**
 * The hybrid (segment + settingsSegment) path set thinIgnoreEntries and
 * fleetDirRoots both exclude from their wholly-fleet walk.
 */
function computeHybridPaths(manifest) {
  const hybridPaths = new Set(
    (manifest.segments ?? []).map(entry => normalizeBundlePath(entry.path)),
  )
  if (manifest.settingsSegment !== void 0)
    hybridPaths.add(normalizeBundlePath(manifest.settingsSegment.path))
  return hybridPaths
}
/**
 * Walk one wholly-fleet DIR root and delete any on-disk file not in `kept`.
 * Normal-ignore files (PRUNE_SKIP_NAMES) are left alone — they are local, not
 * bundle payload. Returns the count of files deleted under this root.
 */
function pruneRootFiles(root, dest, kept) {
  const dirAbs = path.join(dest, root)
  if (!existsSync(dirAbs)) return 0
  let pruned = 0
  for (const rel of walkFiles(dirAbs, dest)) {
    if (PRUNE_SKIP_NAMES.has(path.basename(rel))) continue
    const key = normalizeBundlePath(rel)
    if (!kept.has(key)) {
      safeDeleteSync(path.join(dest, rel))
      pruned += 1
    }
  }
  return pruned
}

//#endregion
//#region template/base/scripts/fleet/_shared/hook-wiring.mts
const DISPATCH_EVENTS = ['PreToolUse', 'PostToolUse', 'SessionStart', 'Stop']
const INDEX_REL = '.claude/hooks/fleet/index.cjs'
const LAUNCHER_REL = '.claude/hooks/fleet/_dispatch/dispatch-launcher'
/**
 * The compile-cache baseline command for an event (the cascaded canonical).
 */
function baselineCommand(event) {
  return `node "$CLAUDE_PROJECT_DIR"/${INDEX_REL} ${event}`
}
/**
 * A dispatch command for `event` in either form (baseline or launcher). Used to
 * recognize an existing dispatch entry regardless of which path it's wired to,
 * so a rewrite is idempotent and replaces (never duplicates) the entry.
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
 * `make` CANONICALIZES (both forms collapse to the baseline) — the shape the
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
//#region template/bootstrap/src/settings.mts
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
//#region template/bootstrap/src/install.mts
const logger$3 = getDefaultLogger()
/**
 * Copy every verified byte-identical file from `filesDir` into `dest`,
 * creating parent directories as needed.
 */
function installFiles(filesDir, dest, manifest) {
  const rels = Object.keys(manifest.files)
  for (let i = 0, { length } = rels; i < length; i += 1) {
    const rel = rels[i]
    const target = path.join(dest, rel)
    mkdirSync(path.dirname(target), { recursive: true })
    copyFileSync(path.join(filesDir, rel), target)
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
    const fleetBlock = readFileSync(path.join(segmentsDir, destName), 'utf8')
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
    logger$3.log(
      `install-fleet: Claude settings segment missing at ${sourcePath} — refusing to merge.`,
    )
    return 1
  }
  const targetPath = path.join(dest, segment.path)
  try {
    const merged = mergeClaudeSettings({
      fleetSettings: JSON.parse(readFileSync(sourcePath, 'utf8')),
      repoSettings: existsSync(targetPath)
        ? JSON.parse(readFileSync(targetPath, 'utf8'))
        : void 0,
    })
    mkdirSync(path.dirname(targetPath), { recursive: true })
    writeFileSync(targetPath, `${JSON.stringify(merged, void 0, 2)}\n`)
    return 0
  } catch (e) {
    logger$3.log(
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
    logger$3.log(
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
    writeFileSync(
      targetPath,
      mergeWorkspaceYaml({
        bundleFleetSections,
        consumerYaml,
        fleetKeys: ws.fleetKeys,
      }),
    )
  } catch (e) {
    logger$3.log(
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
    logger$3.log(
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
 * and stay tracked, so they're excluded.
 *
 * EVERY entry is EXPLICIT — one line per bundle file, never a blanket
 * `…/fleet/` dir entry. A dir blanket also swallows any future non-bundle
 * file that lands beside the payload, hiding it from git entirely; the
 * explicit list ignores exactly what the bundle supplies and nothing else.
 * The dir-level collapse still exists for the sync-prune walk — see
 * fleetDirRoots().
 */
function thinIgnoreEntries(manifest) {
  const hybridPaths = computeHybridPaths(manifest)
  const entries = /* @__PURE__ */ new Set()
  const files = Object.keys(manifest.files)
  for (let i = 0, { length } = files; i < length; i += 1) {
    const p = normalizeBundlePath(files[i])
    if (hybridPaths.has(p)) continue
    entries.add(p)
  }
  return [...entries].toSorted()
}
/**
 * The wholly-fleet DIRECTORY roots — each `fleet/` tier a bundle file sits
 * under (`.claude/hooks/fleet/`, `.config/fleet/`, `scripts/fleet/`, …). The
 * sync-prune walks these so an on-disk file the current bundle dropped is
 * deleted. The `fleet/` convention guarantees each root holds only fleet
 * files (the member's own live beside it under `repo/`), so the walk can
 * never touch repo-owned content. The .gitignore block deliberately does NOT
 * use these — its entries are explicit per-file (thinIgnoreEntries).
 */
function fleetDirRoots(manifest) {
  const hybridPaths = computeHybridPaths(manifest)
  const roots = /* @__PURE__ */ new Set()
  const files = Object.keys(manifest.files)
  for (let i = 0, { length } = files; i < length; i += 1) {
    const p = normalizeBundlePath(files[i])
    if (hybridPaths.has(p)) continue
    const parts = p.split('/')
    const fleetIdx = parts.indexOf('fleet')
    if (fleetIdx >= 0) roots.add(`${parts.slice(0, fleetIdx + 1).join('/')}/`)
  }
  return [...roots].toSorted()
}
/**
 * Apply thin mode: write a fleet-managed `.gitignore` block listing the
 * wholly-fleet bundle paths (see thinIgnoreEntries) plus `.agents/`, then
 * untrack them from git so the fetch action repopulates them going forward.
 */
function applyThinMode(config) {
  const { dest, manifest } = {
    __proto__: null,
    ...config,
  }
  const sortedRoots = thinIgnoreEntries(manifest)
  const blockLines = ['.agents/', ...sortedRoots]
  const fleetBlock = [
    beginMarker('hash'),
    ...blockLines,
    endMarker('hash'),
  ].join('\n')
  const gitignorePath = path.join(dest, '.gitignore')
  writeFileSync(
    gitignorePath,
    spliceFleetBlock({
      commentStyle: 'hash',
      fleetBlock,
      target: existsSync(gitignorePath)
        ? readFileSync(gitignorePath, 'utf8')
        : '',
    }),
  )
  const rmTargets = ['.agents/', ...sortedRoots]
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
/**
 * Prune stale fleet files so a fetch is a true SYNC (place + prune), not just
 * an additive copy. After the bundle is placed, any on-disk file under a
 * wholly-fleet DIR root (the `…/fleet/` tiers thinIgnoreEntries collapses) that
 * the current bundle does NOT contain is deleted — so a fleet file a later
 * bundle no longer ships does not linger as cruft on a member. Only those
 * fleet-owned roots are walked; hybrid segments, carve-outs, and repo-owned
 * files live outside them and are never touched. Normal-ignore files (OS
 * noise — see pruneRootFiles) are left alone — they are local, not bundle
 * payload.
 */
function pruneStaleFleetFiles(dest, manifest) {
  const kept = new Set(Object.keys(manifest.files).map(normalizeBundlePath))
  for (const segment of manifest.segments ?? [])
    kept.add(normalizeBundlePath(segment.path))
  if (manifest.settingsSegment !== void 0)
    kept.add(normalizeBundlePath(manifest.settingsSegment.path))
  let pruned = 0
  const roots = fleetDirRoots(manifest)
  for (let r = 0, { length: rootCount } = roots; r < rootCount; r += 1)
    pruned += pruneRootFiles(roots[r], dest, kept)
  return pruned
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
const APPLIED_MARKER =
  'node_modules/.cache/fleet/socket-wheelhouse/bundle-applied'
const FLAT_APPLIED_MARKER =
  'node_modules/.cache/socket-wheelhouse/bundle-applied'
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
function writeAppliedRef(dest, ref) {
  const p = path.join(dest, APPLIED_MARKER)
  mkdirSync(path.dirname(p), { recursive: true })
  writeFileSync(p, `${ref}\n`)
  const legacy = path.join(dest, LEGACY_APPLIED_MARKER)
  if (existsSync(legacy)) safeDeleteSync(legacy)
  const flat = path.join(dest, FLAT_APPLIED_MARKER)
  if (existsSync(flat)) safeDeleteSync(flat)
}

//#endregion
//#region template/bootstrap/src/lockstep.mts
const FLEET_REF_RE = /^fleet-[0-9a-f]{7,}$/
const FULL_SHA_RE = /^[0-9a-f]{40}$/
const FUZZY_REF_RE = /[\^~*]|\b(?:canary|head|latest|lts|main|master|next)\b/i
/**
 * Validate a `bundle.ref` value at WRITE time. Rejects an empty, fuzzy, ranged,
 * or aliased ref — only an exact `fleet-<hex>` tag is legal. Returns the list
 * of problems (empty === valid).
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
      `\`bundle.ref\` must be an exact \`fleet-<hex>\` tag — no range/alias (\`^\` \`~\` \`*\` \`latest\` \`lts\` \`main\` …); got ${JSON.stringify(ref)}.`,
    )
  if (!FLEET_REF_RE.test(ref))
    errors.push(
      `\`bundle.ref\` must match ${String(FLEET_REF_RE)} (a \`fleet-<hex>\` release tag); got ${JSON.stringify(ref)}.`,
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
 * When `pinnedTemplateSha` is undefined (the ref's release can't be found) the
 * invariant cannot be confirmed, so the state is OUT-OF-SYNC — fail loud rather
 * than assume current.
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
const NOTICE_STORE_REL =
  'node_modules/.cache/fleet/socket-wheelhouse/update-notice.json'
const TWENTY_FOUR_HOURS_MS = 1440 * 60 * 1e3
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
 * last seen (a fresh release jumps the throttle).
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
//#region template/bootstrap/src/resolve.mts
/**
 * @file GitHub release resolution and lock-step assertion helpers.
 *   Extracted from fleet.mts to keep that file under the 500-line soft cap.
 *   All functions here shell out to `gh` (dep-0: no socket-lib) or are pure
 *   logic; none do filesystem writes.
 *   Lock-step note: assertLockStep enforces the cascadeSha === templateSha
 *   invariant but does not resolve refs itself — see resolveReleaseTemplateSha.
 */
const logger$2 = getDefaultLogger()
const MANIFEST_NAME$1 = 'release-bundle-manifest.json'
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
  logger$2.error(
    formatLockStepError({
      cascadeSha,
      pinnedTemplateSha: manifestTemplateSha,
      ref,
    }),
  )
  return false
}
/**
 * Resolve the NEWEST `fleet-*` release tag via `gh release list`. Returns the
 * latest tag, or undefined when none / offline. The list is newest-first.
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
      if (typeof row.tagName === 'string' && row.tagName.startsWith('fleet-'))
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
        MANIFEST_NAME$1,
        '--dir',
        tmp,
      ],
      { stdio: ['ignore', 'ignore', 'ignore'] },
    )
    const manifestPath = path.join(tmp, MANIFEST_NAME$1)
    if (!existsSync(manifestPath)) return
    const json = JSON.parse(readFileSync(manifestPath, 'utf8'))
    return typeof json.templateSha === 'string' ? json.templateSha : void 0
  } catch {
    return
  } finally {
    safeDeleteSync(tmp)
  }
}

//#endregion
//#region template/bootstrap/src/status.mts
/**
 * @file Status display helpers for `fleet:status` — the read-only status verb.
 *   Extracted from fleet.mts to keep that file under the 500-line soft cap.
 *   All functions here are pure display or throttle logic; none mutate the
 *   install state.
 *   Lock-step note: the sibling lockstep.mts module owns the lock-step state
 *   machine; this file only formats and renders it.
 */
const logger$1 = getDefaultLogger()
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
//#region template/bootstrap/src/fleet.mts
const logger = getDefaultLogger()
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
  const state = resolveLockStepState({
    config: lockStepConfig,
    newestRef,
    newestTemplateSha:
      newestRef === void 0
        ? void 0
        : newestRef === ref
          ? pinnedTemplateSha
          : resolveReleaseTemplateSha(newestRef, repo),
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
      'install-fleet: no --ref and no `bundle.ref` in .config/repo/socket-wheelhouse.json. Pass --ref fleet-<sha> or set bundle.ref.',
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
    } else {
      logger.log(`install-fleet: downloading ${ref} from ${repo}…`)
      try {
        run('gh', [
          'release',
          'download',
          ref,
          '--repo',
          repo,
          '--pattern',
          '*.tar.gz',
          '--pattern',
          MANIFEST_NAME,
          '--dir',
          tmp,
        ])
      } catch (e) {
        logger.log(
          `install-fleet: download failed for ${repo}@${ref}: ${errorMessage(e)}. Check the tag exists and gh is authenticated.`,
        )
        return 1
      }
      sourceManifest = path.join(tmp, MANIFEST_NAME)
      if (!existsSync(sourceManifest)) {
        logger.log(
          `install-fleet: release ${ref} has no ${MANIFEST_NAME} asset.`,
        )
        return 1
      }
      const tarball = readdirSync(tmp).find(f => f.endsWith('.tar.gz'))
      if (!tarball) {
        logger.log(`install-fleet: release ${ref} has no .tar.gz asset.`)
        return 1
      }
      sourceTarball = path.join(tmp, tarball)
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
    const prunedCount = pruneStaleFleetFiles(dest, manifest)
    installSegments(segmentsDir, dest, manifest)
    const settingsResult = installSettingsSegment(segmentsDir, dest, manifest)
    if (settingsResult !== 0) return settingsResult
    const wsResult = installWorkspaceSegment(segmentsDir, dest, manifest)
    if (wsResult !== 0) return wsResult
    if (cfg.wire) wirePackageJson(dest)
    if (cfg.thin)
      applyThinMode({
        dest,
        manifest,
      })
    writeAppliedRef(dest, sourceRef)
    const prunedNote = prunedCount > 0 ? `, pruned ${prunedCount} stale` : ''
    logger.log(
      `install-fleet: placed ${fileCount} file(s) + ${segmentCount} segment(s)${prunedNote} from ${sourceRef} (template ${manifest.templateSha}) → ${dest}.`,
    )
    return 0
  } finally {
    safeDeleteSync(tmp)
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
  ERR_LOCKSTEP_MISMATCH,
  FLEET_STATUS_SCRIPT,
  PREPARE_FETCH,
  SYNC_FLEET_SCRIPT,
  UPDATE_NOTIFIER_OPT_OUT_ENV,
  applyThinMode,
  assertLockStep,
  beginMarker,
  computeSha256,
  endMarker,
  errorMessage,
  fleetDirRoots,
  formatLockStepError,
  formatUpdateNotice,
  installFiles,
  installFleet,
  installSegments,
  installSettingsSegment,
  installWorkspaceSegment,
  isMainModule,
  legacyBeginMarker,
  legacyEndMarker,
  lockStepExitCode,
  maybeShowUpdateNotice,
  mergeWorkspaceYaml,
  normalizeBundlePath,
  normalizeManifestEntryPath,
  parseArgs,
  parseYamlKeyBlocks,
  printStatusReport,
  pruneStaleFleetFiles,
  readAppliedRef,
  readBundleConfig,
  readBundleRef,
  readManifest,
  readNoticeStore,
  resolveLockStepState,
  resolveNewestRef,
  resolveReleaseTemplateSha,
  resolveRepoRoot,
  resolveSettingsPath,
  run,
  runStatus,
  segmentFileName,
  shouldShowNotice,
  spliceFleetBlock,
  statusJson,
  tarExecutable,
  tarExtractArgs,
  thinIgnoreEntries,
  validateBundleBlock,
  validateCascadeSha,
  validateRef,
  verifyBundleFiles,
  verifySegments,
  walkFiles,
  wirePackageJson,
  writeAppliedRef,
  writeNoticeStore,
}
