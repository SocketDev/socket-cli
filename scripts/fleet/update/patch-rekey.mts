/**
 * @file Auto re-key of stranded pnpm patches for the update engine. When a
 *   soak-cleared bump moves a patched dep's pin OLD → NEW, the
 *   `patchedDependencies` key stays on OLD and the next `pnpm install` dies
 *   with ERR_PNPM_UNUSED_PATCH. The historical gate stopped loud and told a
 *   human to re-key by hand. This module ports the patch AUTOMATICALLY. The
 *   sequence works around a chicken-and-egg: `pnpm patch <name>@<NEW>` can only
 *   patch a version that is INSTALLED, but at re-key time the pin has moved to
 *   NEW while node_modules still holds OLD, and a plain install to materialize
 *   NEW dies on the very ERR_PNPM_UNUSED_PATCH we are fixing. So the flow is:
 *   snapshot the OLD key + OLD patch file, REMOVE the stale key from
 *   pnpm-workspace.yaml, `pnpm install` to materialize NEW, `pnpm patch
 *   <name>@<NEW>` for the edit dir, the fleet's AI-fix machinery re-applies the
 *   OLD patch's SEMANTIC intent to the possibly-refactored new code, a
 *   deterministic verifier confirms the intent landed, then `pnpm patch-commit`
 *   writes patches/<name>@<NEW>.patch and re-adds the key at NEW. Patches are
 *   frequently security- or correctness-critical, so the AI port routes at the
 *   HIGH tier via the shared AI_TIER ladder and the port is verified before
 *   commit — a wrong security patch is worse than a loud stop. Safety: any
 *   failure in the remove→install→patch→port→commit window RESTORES the OLD
 *   key, OLD patch file, and lockfile to their exact prior bytes and deletes
 *   any NEW patch file, so the repo is left byte-identical to before the
 *   attempt, then the caller falls back to the loud manual-instruction failure.
 *   SKIP_AI_FIX=1 short-circuits to the loud fallback with ZERO mutations — the
 *   key is never removed. The deterministic parts here are pure and
 *   unit-tested; every spawn / fs seam is injected so the orchestrator is
 *   testable without spawning pnpm or a model.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { runClaudeFix } from '../ai-lint-fix/claude.mts'
import { TIER_EFFORT, TIER_MODEL } from '../ai-lint-fix/rule-guidance.mts'

import type { StalePatchKey } from './patched-deps.mts'

/**
 * A resolved re-key target: a stale patch keyed to `oldVersion` whose dep is
 * now pinned to a single `newVersion`, with the old and new patch file paths.
 */
export interface PatchReKeyPlan {
  readonly name: string
  readonly newPatchPath: string
  readonly newVersion: string
  readonly oldPatchPath: string
  readonly oldVersion: string
}

/**
 * Result of splitting a stale-key set into auto-re-keyable plans and the ones
 * that cannot be auto-targeted because the dep resolved to more than one new
 * version.
 */
export interface PatchReKeyPlanSet {
  readonly ambiguous: readonly StalePatchKey[]
  readonly plans: readonly PatchReKeyPlan[]
}

/**
 * Context handed to the injected AI-port seam. Carries the new edit dir plus
 * the OLD patch text so the port can re-apply its intent to the new files.
 */
export interface PatchPortContext {
  readonly name: string
  readonly newVersion: string
  readonly oldPatchText: string
  readonly oldVersion: string
  readonly tempDir: string
}

/**
 * Outcome of a single AI port: whether the ported edit is a verified
 * semantically-equivalent patch, with a human-readable reason on failure.
 */
export interface PatchPortResult {
  readonly ok: boolean
  readonly summary?: string | undefined
}

/**
 * The parsed additions/removals of a patch — the literal `+`/`-` hunk-body
 * lines, headers excluded.
 */
export interface PatchIntent {
  readonly additions: readonly string[]
  readonly removals: readonly string[]
}

/**
 * Verdict of the deterministic port verifier: which intended additions are
 * still missing from the ported files and which intended removals still linger.
 */
export interface PortVerdict {
  readonly lingeringRemovals: readonly string[]
  readonly missingAdditions: readonly string[]
  readonly ok: boolean
}

/**
 * One re-key that did not converge, named for the loud fallback report.
 */
export interface PatchReKeyFailure {
  readonly name: string
  readonly reason: string
}

/**
 * Full outcome of an auto-re-key pass over a stale-key set.
 */
export interface PatchReKeyOutcome {
  readonly failed: readonly PatchReKeyFailure[]
  readonly ok: boolean
  readonly rekeyed: readonly PatchReKeyPlan[]
  readonly skipped: boolean
}

/**
 * The injected seams a re-key pass drives — every pnpm spawn, the repo-relative
 * fs read/write/remove trio, the AI-port call, and the post-commit staleness
 * re-detection. Injected so the orchestrator is unit-testable without spawning
 * pnpm or a model. `readFile` / `writeFile` / `removeFile` take repo-relative
 * paths (`pnpm-workspace.yaml`, `pnpm-lock.yaml`, `patches/<name>@<v>.patch`).
 */
export interface PatchReKeyDeps {
  readonly detectStaleAfter: () => readonly StalePatchKey[]
  readonly log?: ((message: string) => void) | undefined
  readonly portPatch: (context: PatchPortContext) => Promise<PatchPortResult>
  readonly readFile: (relPath: string) => string
  readonly removeFile: (relPath: string) => void
  readonly runPnpmInstall: () => Promise<{ ok: boolean; output: string }>
  readonly runPnpmPatch: (
    spec: string,
  ) => Promise<{ ok: boolean; output: string; tempDir: string | undefined }>
  readonly runPnpmPatchCommit: (
    tempDir: string,
  ) => Promise<{ ok: boolean; output: string }>
  readonly skipAi: boolean
  readonly writeFile: (relPath: string, content: string) => void
}

/**
 * The repo-relative files a re-key attempt may mutate, snapshotted before the
 * first write so a failure can restore them to their exact prior bytes.
 */
interface ReKeySnapshot {
  readonly lockfile: string | undefined
  readonly oldPatch: string
  readonly workspace: string
}

// Repo-relative paths the orchestrator reads/writes through the fs seams.
const WORKSPACE_YAML_REL = 'pnpm-workspace.yaml'
const LOCKFILE_REL = 'pnpm-lock.yaml'

/**
 * The `<name>@<version>` key pnpm records in `patchedDependencies`. Pure.
 */
export function pnpmPatchKey(name: string, version: string): string {
  return `${name}@${version}`
}

/**
 * The patch file path pnpm writes for a package version: scoped names have
 * their `/` rewritten to `__`, matching the committed convention
 * (`@polka/url` → `patches/@polka__url@<v>.patch`). Pure.
 */
export function pnpmPatchFilename(name: string, version: string): string {
  return `patches/${name.replaceAll('/', '__')}@${version}.patch`
}

/**
 * Extract the `patchedDependencies` entry KEY from a YAML line, quoted or bare
 * (`  '@scope/name@1.2.3': patches/…` → `@scope/name@1.2.3`;
 * `  name@1.2.3: patches/…` → `name@1.2.3`). Returns undefined for blank,
 * comment, or non-entry lines. Pure.
 */
function parseEntryKey(line: string): string | undefined {
  const trimmed = line.trimStart()
  if (trimmed === '' || trimmed.startsWith('#')) {
    return undefined
  }
  const quote = trimmed[0]
  if (quote === "'" || quote === '"') {
    const end = trimmed.indexOf(quote, 1)
    if (end === -1) {
      return undefined
    }
    if (
      !trimmed
        .slice(end + 1)
        .trimStart()
        .startsWith(':')
    ) {
      return undefined
    }
    return trimmed.slice(1, end)
  }
  const colon = trimmed.indexOf(':')
  if (colon === -1) {
    return undefined
  }
  return trimmed.slice(0, colon).trim()
}

/**
 * Remove a single `patchedDependencies` entry line, scoped to that block so a
 * coincidentally-matching `overrides:` key is never touched. All other bytes —
 * comments, quoting, layout — survive untouched. Returns the rewritten text and
 * whether the key was found. Pure.
 */
export function removePatchKeyFromWorkspace(
  text: string,
  patchKey: string,
): { removed: boolean; text: string } {
  const header = 'patchedDependencies:'
  const lines = text.split('\n')
  const out: string[] = []
  let inBlock = false
  let removed = false
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (line.trimEnd() === header) {
      inBlock = true
      out.push(line)
      continue
    }
    // A column-0 key ends the block; blank lines and indented comments do not.
    if (inBlock && line !== '' && /^\S/.test(line)) {
      inBlock = false
    }
    if (inBlock && !removed && parseEntryKey(line) === patchKey) {
      removed = true
      continue
    }
    out.push(line)
  }
  return { removed, text: out.join('\n') }
}

/**
 * Split stale patch keys into auto-re-keyable plans and ambiguous ones. A key
 * is auto-re-keyable when its dep resolves to EXACTLY one new version other
 * than the keyed one; a dep pinned to several differing versions cannot be
 * auto-targeted, so it stays a loud manual case. Pure.
 */
export function planPatchReKeys(
  stale: readonly StalePatchKey[],
): PatchReKeyPlanSet {
  const plans: PatchReKeyPlan[] = []
  const ambiguous: StalePatchKey[] = []
  for (let i = 0, { length } = stale; i < length; i += 1) {
    const key = stale[i]!
    const targets: string[] = []
    for (let j = 0, jl = key.pinnedVersions.length; j < jl; j += 1) {
      const pin = key.pinnedVersions[j]!
      if (pin !== key.patchVersion && !targets.includes(pin)) {
        targets.push(pin)
      }
    }
    const newVersion = targets.length === 1 ? targets[0] : undefined
    if (newVersion === undefined) {
      ambiguous.push(key)
      continue
    }
    plans.push({
      name: key.name,
      newPatchPath: pnpmPatchFilename(key.name, newVersion),
      newVersion,
      oldPatchPath: key.patchFile,
      oldVersion: key.patchVersion,
    })
  }
  return { ambiguous, plans }
}

/**
 * Extract the temp edit dir `pnpm patch` prints. pnpm names it on the
 * `patch-commit` hint line, quoted or bare, and again on the
 * "edit the following folder" line. Returns undefined when neither is found.
 * Pure.
 */
export function parsePnpmPatchTempDir(output: string): string | undefined {
  // The commit-hint line carries the canonical path after `patch-commit`,
  // optionally wrapped in single or double quotes; capture up to the closing
  // quote or end of line.
  const commitMatch = /patch-commit\s+["']?([^"'\n]+?)["']?\s*$/m.exec(output)
  if (commitMatch?.[1]) {
    return commitMatch[1].trim()
  }
  // Fallback: the folder-announcement line names the same path when the commit
  // hint is reformatted or absent.
  const folderMatch = /edit the following folder:\s*([^\n]+?)\s*$/m.exec(output)
  if (folderMatch?.[1]) {
    return folderMatch[1].trim()
  }
  return undefined
}

/**
 * The repo-relative files a unified-diff patch modifies, read from its
 * `+++ b/<path>` headers. Skips the `/dev/null` deletion marker and dedupes.
 * Pure.
 */
export function parsePatchTargetPaths(patchText: string): string[] {
  const paths: string[] = []
  const lines = patchText.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (!line.startsWith('+++ ')) {
      continue
    }
    let target = line.slice(4).trim()
    // Some diff tools append a tab-delimited timestamp to the header path.
    const tab = target.indexOf('\t')
    if (tab !== -1) {
      target = target.slice(0, tab).trim()
    }
    if (target.startsWith('b/')) {
      target = target.slice(2)
    }
    if (target !== '' && target !== '/dev/null' && !paths.includes(target)) {
      paths.push(target)
    }
  }
  return paths
}

/**
 * Parse a patch into its literal added/removed hunk-body lines, excluding the
 * `+++`/`---` file headers. Pure.
 */
export function parsePatchIntent(patchText: string): PatchIntent {
  const additions: string[] = []
  const removals: string[] = []
  const lines = patchText.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (line.startsWith('+++') || line.startsWith('---')) {
      continue
    }
    if (line.startsWith('+')) {
      additions.push(line.slice(1))
    } else if (line.startsWith('-')) {
      removals.push(line.slice(1))
    }
  }
  return { additions, removals }
}

/**
 * Whitespace-normalize a code line so formatting drift between the old diff and
 * the ported file does not defeat a substring match. Pure.
 */
function normalizeCode(line: string): string {
  // Collapse every run of whitespace, including newlines, to a single space.
  return line.trim().replace(/\s+/g, ' ')
}

/**
 * True when a hunk line carries enough code to be a meaningful intent signal —
 * skips blank lines, brace-only noise, and comment-only lines the port may
 * legitimately reword. Pure.
 */
function isSignificantCode(line: string): boolean {
  const trimmed = line.trim()
  if (trimmed.length < 6) {
    return false
  }
  // Requires at least one word character so pure-punctuation lines drop out.
  if (!/[A-Za-z0-9]/.test(trimmed)) {
    return false
  }
  return (
    !trimmed.startsWith('//') &&
    !trimmed.startsWith('/*') &&
    !trimmed.startsWith('*')
  )
}

/**
 * Deterministically verify a port carried the OLD patch's intent into the new
 * files: every significant ADDITION must be present in the ported text and
 * every significant REMOVAL that was not re-added must be gone. This is the
 * safety gate that catches a no-op or wrong port before `pnpm patch-commit`
 * writes it. Pure.
 */
export function verifyPortIntent(
  oldPatchText: string,
  newFiles: ReadonlyMap<string, string>,
): PortVerdict {
  const intent = parsePatchIntent(oldPatchText)
  const haystackParts: string[] = []
  for (const text of newFiles.values()) {
    haystackParts.push(normalizeCode(text))
  }
  const haystack = haystackParts.join('\n')

  const additionSet = new Set<string>()
  for (let i = 0, { length } = intent.additions; i < length; i += 1) {
    const addition = intent.additions[i]!
    if (isSignificantCode(addition)) {
      additionSet.add(normalizeCode(addition))
    }
  }
  const missingAdditions: string[] = []
  for (const addition of additionSet) {
    if (!haystack.includes(addition)) {
      missingAdditions.push(addition)
    }
  }

  const lingeringRemovals: string[] = []
  const seenRemoval = new Set<string>()
  for (let i = 0, { length } = intent.removals; i < length; i += 1) {
    const removal = intent.removals[i]!
    if (!isSignificantCode(removal)) {
      continue
    }
    const normalized = normalizeCode(removal)
    // A remove-then-readd line is not an elimination — the port keeps it.
    if (additionSet.has(normalized) || seenRemoval.has(normalized)) {
      continue
    }
    seenRemoval.add(normalized)
    if (haystack.includes(normalized)) {
      lingeringRemovals.push(normalized)
    }
  }

  return {
    lingeringRemovals,
    missingAdditions,
    ok: missingAdditions.length === 0 && lingeringRemovals.length === 0,
  }
}

/**
 * Build the high-effort AI-port prompt: re-apply the OLD patch's semantic
 * intent to the new version's files, which may be refactored so the diff's
 * literal context no longer matches. Pure.
 */
export function buildPatchPortPrompt(context: PatchPortContext): string {
  const targets = parsePatchTargetPaths(context.oldPatchText)
  const targetList =
    targets.length > 0 ? targets.join('\n') : '(read the patch headers below)'
  return `You are porting a pnpm patch to a new package version.

Package: ${context.name}
Old version: ${context.oldVersion}
New version: ${context.newVersion}
Working directory: the new version's files are materialized in this cwd.

Files the old patch modified:
${targetList}

The OLD patch below was written against ${context.oldVersion}. The new version's
code may be REFACTORED — surrounding context lines will differ, so applying the
diff literally will fail. Do NOT reproduce the diff verbatim. Instead:

1. Read the OLD patch to understand WHAT it changes semantically — what code it
   removes, what it adds, and WHY.
2. Read the corresponding file(s) in the cwd, which hold the NEW version's code.
3. Edit those file(s) so the SAME semantic change is applied to the new code,
   adapting to the refactored surroundings. Preserve every behavioral effect of
   the original patch. Patches are often security- or correctness-critical: if
   the target code changed so fundamentally that the intent cannot be safely
   re-applied, make NO edit and stop — a wrong patch is worse than none.
4. Do not add, remove, or reword anything beyond re-applying the patch intent.

<old-patch>
${context.oldPatchText}
</old-patch>`
}

/**
 * Read the ported target files from the temp edit dir. Missing files are
 * skipped — the verifier treats an absent intended change as unmet.
 */
export function readPortedFiles(
  tempDir: string,
  relPaths: readonly string[],
): Map<string, string> {
  const files = new Map<string, string>()
  for (let i = 0, { length } = relPaths; i < length; i += 1) {
    const rel = relPaths[i]!
    try {
      files.set(rel, readFileSync(path.join(tempDir, rel), 'utf8'))
    } catch {
      // Absent target file: leave it out; verifyPortIntent then reports the
      // intended change as missing and the port fails safe.
    }
  }
  return files
}

/**
 * The real AI-port seam: spawn the fleet's edit-only agent at the HIGH tier to
 * re-apply the patch intent to the new files, then deterministically verify the
 * intent landed before allowing a commit. Routes at opus/high via the shared
 * AI_TIER ladder because patches are frequently security- or
 * correctness-critical — not a haiku job.
 */
export async function runPatchPort(
  context: PatchPortContext,
): Promise<PatchPortResult> {
  const prompt = buildPatchPortPrompt(context)
  // Opus/high: security- and correctness-critical port over possibly-refactored
  // code. Reuses ai-lint-fix's runClaudeFix wrapper (AI_PROFILE.edit lockdown +
  // spawnAiAgent retry) with the canonical high-tier { model, effort } pair.
  const { exitCode, stderr } = await runClaudeFix(
    prompt,
    context.tempDir,
    TIER_MODEL['opus'],
    TIER_EFFORT['opus'],
  )
  if (exitCode !== 0) {
    return {
      ok: false,
      summary: `AI patch-port exited ${exitCode}: ${stderr.slice(0, 200)}`,
    }
  }
  const targets = parsePatchTargetPaths(context.oldPatchText)
  const ported = readPortedFiles(context.tempDir, targets)
  const verdict = verifyPortIntent(context.oldPatchText, ported)
  if (verdict.ok) {
    return { ok: true }
  }
  const bits: string[] = []
  if (verdict.missingAdditions.length > 0) {
    bits.push(`${verdict.missingAdditions.length} intended addition(s) missing`)
  }
  if (verdict.lingeringRemovals.length > 0) {
    bits.push(`${verdict.lingeringRemovals.length} removal(s) still present`)
  }
  return { ok: false, summary: `port verification failed: ${bits.join('; ')}` }
}

/**
 * Restore every file a re-key attempt may have mutated back to its snapshot
 * bytes and delete the NEW patch file if `pnpm patch-commit` wrote one, leaving
 * the repo byte-identical to before the attempt.
 */
function restoreSnapshot(
  snapshot: ReKeySnapshot,
  plan: PatchReKeyPlan,
  deps: PatchReKeyDeps,
): void {
  deps.writeFile(WORKSPACE_YAML_REL, snapshot.workspace)
  if (snapshot.lockfile !== undefined) {
    deps.writeFile(LOCKFILE_REL, snapshot.lockfile)
  }
  deps.writeFile(plan.oldPatchPath, snapshot.oldPatch)
  if (plan.newPatchPath !== plan.oldPatchPath) {
    deps.removeFile(plan.newPatchPath)
  }
}

/**
 * Run one plan's remove → install → patch → port → commit → validate sequence.
 * Snapshots the OLD key, OLD patch, and lockfile before the first write; on ANY
 * failure restores them exactly and reports the reason, so the patch is never
 * dropped and the tree is left byte-identical to before the attempt.
 */
async function attemptReKeyPlan(
  plan: PatchReKeyPlan,
  deps: PatchReKeyDeps,
  log: (message: string) => void,
): Promise<{ ok: boolean; reason?: string | undefined }> {
  const oldKey = pnpmPatchKey(plan.name, plan.oldVersion)
  // Snapshot everything a re-key may mutate BEFORE the first write.
  let oldPatch: string
  try {
    oldPatch = deps.readFile(plan.oldPatchPath)
  } catch {
    return {
      ok: false,
      reason: `could not read the old patch ${plan.oldPatchPath}`,
    }
  }
  const workspace = deps.readFile(WORKSPACE_YAML_REL)
  let lockfile: string | undefined
  try {
    lockfile = deps.readFile(LOCKFILE_REL)
  } catch {
    lockfile = undefined
  }
  const snapshot: ReKeySnapshot = { lockfile, oldPatch, workspace }

  // Step 2: remove the stale key so the materializing install below does not
  // die on the very ERR_PNPM_UNUSED_PATCH we are fixing.
  const { removed, text } = removePatchKeyFromWorkspace(workspace, oldKey)
  if (!removed) {
    return {
      ok: false,
      reason: `stale key '${oldKey}' not found in ${WORKSPACE_YAML_REL}`,
    }
  }
  deps.writeFile(WORKSPACE_YAML_REL, text)
  log(
    `update: removed stale key '${oldKey}'; installing to materialize ${plan.name}@${plan.newVersion}…`,
  )

  // Step 3: materialize NEW into node_modules (no patch applies — key is gone).
  const install = await deps.runPnpmInstall()
  if (!install.ok) {
    restoreSnapshot(snapshot, plan, deps)
    return {
      ok: false,
      reason: '`pnpm install` to materialize the new version failed',
    }
  }

  // Step 4: pnpm patch NEW — resolves now that NEW is installed.
  const patchResult = await deps.runPnpmPatch(
    pnpmPatchKey(plan.name, plan.newVersion),
  )
  if (!patchResult.ok || patchResult.tempDir === undefined) {
    restoreSnapshot(snapshot, plan, deps)
    return {
      ok: false,
      reason: `\`pnpm patch ${plan.name}@${plan.newVersion}\` did not materialize an edit dir`,
    }
  }

  // Step 5: AI port + deterministic verify (inside the injected portPatch).
  const port = await deps.portPatch({
    name: plan.name,
    newVersion: plan.newVersion,
    oldPatchText: oldPatch,
    oldVersion: plan.oldVersion,
    tempDir: patchResult.tempDir,
  })
  if (!port.ok) {
    restoreSnapshot(snapshot, plan, deps)
    return {
      ok: false,
      reason:
        port.summary ??
        'AI port did not produce a verified semantically-equivalent patch',
    }
  }

  // Step 6: patch-commit writes patches/<name>@<NEW>.patch and re-adds the key.
  const commit = await deps.runPnpmPatchCommit(patchResult.tempDir)
  if (!commit.ok) {
    restoreSnapshot(snapshot, plan, deps)
    return { ok: false, reason: '`pnpm patch-commit` failed' }
  }

  // Validate: the key must no longer read as stale. A silent-no-op commit that
  // left it mismatched is a failure — restore and fall back loud.
  const stillStale = deps.detectStaleAfter().some(k => k.name === plan.name)
  if (stillStale) {
    restoreSnapshot(snapshot, plan, deps)
    return { ok: false, reason: 'patch key still stale after patch-commit' }
  }
  return { ok: true }
}

/**
 * Attempt to auto-re-key every stale patch. For each plan drives the injected
 * seams through remove-key → install → `pnpm patch` → AI port → verify →
 * `pnpm patch-commit`, restoring the tree byte-identically on any failure so a
 * patch is never dropped and no half-ported patch is left behind. Honors
 * SKIP_AI_FIX by short-circuiting with ZERO mutations so CI and non-interactive
 * runs fall straight back to the loud manual gate. A final staleness re-detect
 * is the source of truth for the returned outcome.
 */
export async function reKeyStalePatches(
  stale: readonly StalePatchKey[],
  deps: PatchReKeyDeps,
): Promise<PatchReKeyOutcome> {
  const log = deps.log ?? ((): void => {})
  const { ambiguous, plans } = planPatchReKeys(stale)

  if (deps.skipAi) {
    const failed = stale.map(key => ({
      name: key.name,
      reason: 'SKIP_AI_FIX=1 disables the AI re-key; manual re-key required',
    }))
    return { failed, ok: false, rekeyed: [], skipped: true }
  }

  const rekeyed: PatchReKeyPlan[] = []
  const failed: PatchReKeyFailure[] = []

  for (let i = 0, { length } = ambiguous; i < length; i += 1) {
    const key = ambiguous[i]!
    failed.push({
      name: key.name,
      reason: `resolves to multiple new versions (${key.pinnedVersions.join(', ')}); cannot auto-select a re-key target`,
    })
  }

  for (let i = 0, { length } = plans; i < length; i += 1) {
    const plan = plans[i]!
    log(
      `update: auto-re-keying '${plan.name}' ${plan.oldVersion} → ${plan.newVersion}…`,
    )
    // Serial by necessity: each plan installs + patches the same tree, so
    // parallel pnpm patch/install runs would race it.
    const result = await attemptReKeyPlan(plan, deps, log)
    if (result.ok) {
      log(`update: re-keyed '${plan.name}' → ${plan.newPatchPath}`)
      rekeyed.push(plan)
    } else {
      failed.push({
        name: plan.name,
        reason: result.reason ?? 'auto re-key failed',
      })
    }
  }

  // Source of truth: after every attempt, no key may remain stale. A key that
  // survives — a silent-no-op commit, a still-mismatched pin — is a failure
  // even if its steps reported ok.
  const remaining = deps.detectStaleAfter()
  for (let i = 0, { length } = remaining; i < length; i += 1) {
    const key = remaining[i]!
    if (!failed.some(f => f.name === key.name)) {
      failed.push({
        name: key.name,
        reason: 'still stale after the re-key attempt',
      })
    }
  }

  return { failed, ok: failed.length === 0, rekeyed, skipped: false }
}
