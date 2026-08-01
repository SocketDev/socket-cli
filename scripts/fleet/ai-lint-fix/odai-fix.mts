/**
 * @file Keyless code-repair for the ai-lint-fix residue. When no keyed AI
 *   client resolves, the SIMPLEST lint rules — the haiku-bucket, the seven
 *   mechanical rewrites RULE_MODEL_TIER marks `haiku` — can still be fixed
 *   on-device by routing odai's `patch` task to a reasoning-heavy LOCAL backend
 *   (llama-server), never the summary-class model the bridge admits:
 *   code-repair stays bench-gated to a real engine. Every richer rule keeps
 *   needing a keyed reasoning model and is left for a keyed run. Fail-open at
 *   every step: no odai bin, no local backend (odai exits 69), a reply that
 *   isn't a diff, or a diff that won't apply cleanly — all skip and leave the
 *   findings for the next keyed pass. The orchestrator re-runs lint after and
 *   rejects any batch that made things worse, so a small model can never
 *   degrade the tree; a proposed diff is applied only after `git apply --check`
 *   confirms it lands.
 */

import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { isSpawnError } from '@socketsecurity/lib-stable/process/spawn/errors'

import { resolveOdaiBin } from '../_shared/odai.mts'
import { RULE_GUIDANCE, RULE_MODEL_TIER } from './rule-guidance.mts'

// The reasoning-heavy LOCAL backend the keyless code-repair routes to. A
// summary-class on-device model is never used for a patch — that is the
// bench-gate the odai bridge encodes. No llama-server listening means odai
// exits 69 (no backend), which reads here as a clean skip.
const ODAI_LINT_BACKEND = 'llama-server'
// odai's clean-skip exit — sysexits EX_UNAVAILABLE, mirroring _shared/odai.mts.
const ODAI_SKIP_EXIT = 69
// A local patch on a 7B backend is slower than a summary; give it room but keep
// it bounded so a wedged engine never stalls the fix run.
const ODAI_PATCH_TIMEOUT_MS = 120_000

/**
 * The haiku-bucket: the rules RULE_MODEL_TIER marks `haiku` — mechanical
 * single-token / identifier / namespace rewrites. The only rules the keyless
 * code-repair path attempts; richer rules need a keyed client.
 */
export const HAIKU_BUCKET_RULES: ReadonlySet<string> = new Set(
  Object.keys(RULE_MODEL_TIER).filter(r => RULE_MODEL_TIER[r] === 'haiku'),
)

/**
 * One keyless-fix attempt's outcome. `skipped` covers every environment gap —
 * no bin, no backend, no bucket rule in the batch — and is never an error;
 * `failed` is a real model/apply failure the caller may log. Both leave the
 * file untouched.
 */
export type OdaiFixOutcome =
  | { readonly outcome: 'fixed' }
  | { readonly outcome: 'skipped'; readonly reason: string }
  | { readonly outcome: 'failed'; readonly reason: string }

/**
 * Narrow a file's rule ids to the haiku-bucket subset, de-duplicated. Pure —
 * the caller uses it to decide whether a file has any keyless-fixable finding
 * before spending an odai spawn.
 */
export function bucketRulesFor(ruleIds: readonly string[]): string[] {
  const seen = new Set<string>()
  for (let i = 0, { length } = ruleIds; i < length; i += 1) {
    const id = ruleIds[i]!
    if (HAIKU_BUCKET_RULES.has(id)) {
      seen.add(id)
    }
  }
  return [...seen]
}

/**
 * Build the single-shot `--instruction` for odai's patch task from the
 * haiku-bucket rules that fired in a file: each rule's canonical guidance, one
 * per block. Pure. Empty when no bucket rule is present (the caller skips).
 */
export function buildOdaiInstruction(bucketRules: readonly string[]): string {
  if (bucketRules.length === 0) {
    return ''
  }
  const blocks = bucketRules.map(id => {
    const guidance = RULE_GUIDANCE[id] ?? ''
    return `Fix every violation of ${id} in this file.\n${guidance}`
  })
  return (
    'Apply these lint fixes to the file, changing nothing else. Return a ' +
    'unified diff.\n\n' +
    blocks.join('\n\n')
  )
}

/**
 * Apply a unified diff to the working tree, but only after `git apply --check`
 * confirms it lands cleanly — a small model's diff that doesn't match the file
 * is rejected rather than force-applied. Returns whether the patch was applied.
 * Never throws.
 */
export async function applyPatch(patch: string, cwd: string): Promise<boolean> {
  if (!patch.trim()) {
    return false
  }
  let tmpDir: string | undefined
  try {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'odai-lint-patch-'))
    const patchPath = path.join(tmpDir, 'fix.diff')
    await writeFile(patchPath, patch.endsWith('\n') ? patch : `${patch}\n`)
    const check = await spawn('git', ['apply', '--check', patchPath], {
      cwd,
      stdioString: true,
    }).catch((e: unknown) => ({ code: isSpawnError(e) ? 1 : 1, stderr: '' }))
    if (check.code !== 0) {
      return false
    }
    const applied = await spawn('git', ['apply', patchPath], {
      cwd,
      stdioString: true,
    }).catch(() => ({ code: 1 }))
    return applied.code === 0
  } catch {
    return false
  } finally {
    if (tmpDir) {
      await safeDelete(tmpDir).catch(() => undefined)
    }
  }
}

/**
 * Keyless-fix a single file's haiku-bucket findings via odai's `patch` task on
 * the local reasoning backend. Spawns `odai patch` with the combined rule
 * guidance, parses the diff, and applies it only if `git apply --check` passes.
 * Returns `skipped` on every environment gap (no bin, exit 69, no bucket rule),
 * `failed` on a real model/parse/apply failure, `fixed` when the diff landed.
 * Never throws.
 */
export async function runOdaiLintFix(
  filePath: string,
  ruleIds: readonly string[],
  cwd: string,
): Promise<OdaiFixOutcome> {
  const bin = resolveOdaiBin()
  if (!bin) {
    return { outcome: 'skipped', reason: 'no odai bin resolved' }
  }
  const bucketRules = bucketRulesFor(ruleIds)
  if (bucketRules.length === 0) {
    return { outcome: 'skipped', reason: 'no haiku-bucket rule in this file' }
  }
  const instruction = buildOdaiInstruction(bucketRules)
  let code: number
  let stdout: string
  try {
    const r = await spawn(
      bin,
      [
        'patch',
        '--input',
        filePath,
        '--instruction',
        instruction,
        '--backend',
        ODAI_LINT_BACKEND,
        '--timeout',
        String(ODAI_PATCH_TIMEOUT_MS),
      ],
      { cwd, stdioString: true, timeout: ODAI_PATCH_TIMEOUT_MS + 30_000 },
    )
    code = r.code
    stdout = typeof r.stdout === 'string' ? r.stdout : ''
  } catch (e) {
    if (isSpawnError(e) && typeof e.code === 'string') {
      return { outcome: 'skipped', reason: `odai bin not runnable: ${e.code}` }
    }
    return { outcome: 'failed', reason: errorMessage(e) }
  }
  if (code === ODAI_SKIP_EXIT) {
    return {
      outcome: 'skipped',
      reason: `no local ${ODAI_LINT_BACKEND} backend available`,
    }
  }
  if (code !== 0) {
    return { outcome: 'failed', reason: `odai patch exited ${code}` }
  }
  let patch: unknown
  try {
    patch = (JSON.parse(stdout) as { patch?: unknown | undefined }).patch
  } catch {
    return { outcome: 'failed', reason: 'odai patch printed unparseable JSON' }
  }
  if (typeof patch !== 'string') {
    return { outcome: 'failed', reason: 'odai patch reply has no diff' }
  }
  const applied = await applyPatch(patch, cwd)
  return applied
    ? { outcome: 'fixed' }
    : { outcome: 'failed', reason: 'proposed diff did not apply cleanly' }
}
