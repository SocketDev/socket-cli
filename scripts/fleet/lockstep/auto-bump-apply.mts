/**
 * `--apply` orchestration for auto-bump.mts: the deterministic git + edit +
 * commit mechanics for landing ONE already-resolved, already-approved bump.
 * Checkout the target tag/sha inside the row's submodule, resolve its commit
 * SHA, rewrite that version-pin row's `pinned_tag` + `pinned_sha` in
 * `lockstep.json`, regenerate the `.gitmodules` `# <name>-<version>
 * sha256:…` annotation via gen/gitmodules-hash.mts --set, and commit
 * `chore(deps): bump <upstream> to <tag>`. The skill still owns the per-row
 * test gate + the locked-row human approval (it only calls --apply for an
 * already-approved, validated row); the deterministic git + edit + commit
 * mechanics live here so they are tested, not re-typed per run.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { readManifest } from './manifest.mts'

import type { Manifest } from './types.mts'

export interface ApplyOptions {
  id: string
  manifestPath: string
  repoRoot: string
  /**
   * Stable tag to bump to. Exactly one of targetTag / targetSha must be set.
   */
  targetTag?: string | undefined
  /**
   * Default-branch commit SHA to bump to (the plan's HEAD leg for tagless /
   * already-past-tag track-latest rows). The row's `pinned_tag` is REMOVED —
   * a SHA pin has no release label.
   */
  targetSha?: string | undefined
}

export interface ApplyResult {
  committed: boolean
  gitmodulesLabel: string
  pinnedSha: string
  state:
    | 'bumped'
    | 'skipped-already-at-target'
    | 'skipped-no-row'
    | 'skipped-no-submodule'
    | 'skipped-target-behind-pin'
  submodulePath: string | undefined
  targetTag: string
}

/**
 * Date-heuristic backward detector — the belt behind classifyTarget for
 * shallow grafts, where `merge-base --is-ancestor` returns a definitive-
 * looking false instead of erroring. A target whose committer date is more
 * than a day older than the pin's is a suspected downgrade. Pure; epochs in
 * seconds. The one-day allowance absorbs rebase/cherry-pick timestamp skew
 * on genuinely-forward targets.
 */
export function isSuspectBackward(
  pinEpoch: number,
  targetEpoch: number,
): boolean {
  const daySeconds = 86_400
  return targetEpoch < pinEpoch - daySeconds
}

/**
 * Three-way target classification against the current pin. Pure — the
 * ancestry probe is injected so the unit is testable without a git fixture.
 * `isAncestor(a, b)` answers "is commit a an ancestor of commit b" and
 * returns undefined when ancestry is unknowable (shallow clone) — unknown
 * proceeds forward, matching the harness's drift-forwardness guarantee.
 */
export function classifyTarget(
  pinnedSha: string,
  targetCommitSha: string,
  isAncestor: (a: string, b: string) => boolean | undefined,
): 'already-at-target' | 'forward' | 'target-behind-pin' {
  if (targetCommitSha === pinnedSha) {
    return 'already-at-target'
  }
  if (isAncestor(targetCommitSha, pinnedSha) === true) {
    return 'target-behind-pin'
  }
  return 'forward'
}

// The `# <name>-<version>` label gen/gitmodules-hash.mts --set stamps above the
// submodule block: the submodule's basename + the target tag. Pure so the
// advisory prose and the apply write agree on one label.
export function gitmodulesLabelForTag(
  submodulePath: string,
  targetTag: string,
): string {
  return `${path.basename(submodulePath)}-${targetTag}`
}

function runGit(repoRoot: string, args: readonly string[]): string {
  const result = spawnSync('git', ['-C', repoRoot, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    stdioString: true,
  })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed (status ${result.status}): ${String(result.stderr).trim()}`,
    )
  }
  return String(result.stdout)
}

// Locate the version-pin row + its submodule path in the manifest. Returns
// undefined for either when the id is unknown or its upstream has no submodule
// — the apply path turns those into a skipped (not thrown) result so a stale id
// from a re-run plan is a no-op, not a crash.
function findVersionPinRow(
  manifest: Manifest,
  id: string,
): { submodulePath: string | undefined; upstreamAlias: string } | undefined {
  for (let i = 0, rows = manifest.rows, { length } = rows; i < length; i += 1) {
    const row = rows[i]!
    if (row.kind === 'version-pin' && row.id === id) {
      const upstream = manifest.upstreams?.[row.upstream]
      return {
        submodulePath: upstream?.submodule,
        upstreamAlias: row.upstream,
      }
    }
  }
  return undefined
}

// Rewrite ONE version-pin row's `pinned_tag` + `pinned_sha` in the manifest
// JSON, preserving the file's existing 2-space formatting + trailing newline.
// A pinnedTag of `undefined` DELETES the row's pinned_tag (SHA pins carry no
// release label).
export function writePinnedFields(
  manifestPath: string,
  id: string,
  config: { pinnedSha: string; pinnedTag: string | undefined },
): void {
  const { pinnedSha, pinnedTag } = { __proto__: null, ...config } as {
    pinnedSha: string
    pinnedTag: string | undefined
  }
  const raw = readFileSync(manifestPath, 'utf8')
  const trailingNewline = raw.endsWith('\n')
  const parsed: unknown = JSON.parse(raw)
  const manifest = parsed as Manifest
  for (let i = 0, rows = manifest.rows, { length } = rows; i < length; i += 1) {
    const row = rows[i]!
    if (row.kind === 'version-pin' && row.id === id) {
      row.pinned_sha = pinnedSha
      if (pinnedTag === undefined) {
        delete row.pinned_tag
      } else {
        row.pinned_tag = pinnedTag
      }
    }
  }
  const serialized = JSON.stringify(manifest, undefined, 2)
  writeFileSync(manifestPath, trailingNewline ? `${serialized}\n` : serialized)
}

// Land one resolved bump. Checkout the target tag in the submodule, resolve its
// commit SHA, rewrite the manifest row, regenerate the .gitmodules annotation,
// then commit. The caller (skill) is responsible for the test gate + locked-row
// approval BEFORE calling this — apply is the deterministic write half.
export function applyBump(config: ApplyOptions): ApplyResult {
  const cfg = { __proto__: null, ...config } as ApplyOptions
  const { id, manifestPath, repoRoot, targetSha, targetTag } = cfg
  if ((targetTag === undefined) === (targetSha === undefined)) {
    throw new Error(
      'applyBump: exactly one of targetTag / targetSha must be set',
    )
  }
  const targetLabel = targetTag ?? targetSha!.slice(0, 12)
  const manifest = readManifest(manifestPath)
  const found = findVersionPinRow(manifest, id)
  if (!found) {
    return {
      committed: false,
      gitmodulesLabel: '',
      pinnedSha: '',
      state: 'skipped-no-row',
      submodulePath: undefined,
      targetTag: targetLabel,
    }
  }
  const { submodulePath } = found
  if (!submodulePath) {
    return {
      committed: false,
      gitmodulesLabel: '',
      pinnedSha: '',
      state: 'skipped-no-submodule',
      submodulePath: undefined,
      targetTag: targetLabel,
    }
  }
  const submoduleDir = path.join(repoRoot, submodulePath)
  // Fetch then resolve the target commit — a shallow submodule may not have
  // the tag / SHA yet. SHA targets were fetched by the caller's default-branch
  // fetch; the extra fetch here is belt-and-suspenders for tag targets.
  runGit(submoduleDir, ['fetch', '--tags', '--quiet'])
  const targetCommit = targetTag
    ? runGit(submoduleDir, ['rev-parse', `${targetTag}^{commit}`]).trim()
    : targetSha!
  // Guard: never re-apply a no-op or move a pin BACKWARD (a monorepo sibling
  // tag or an already-past-tag pin would otherwise regress — babel/flow case).
  const currentPin = runGit(submoduleDir, ['rev-parse', 'HEAD']).trim()
  const verdict = classifyTarget(currentPin, targetCommit, (a, b) => {
    const probe = spawnSync(
      'git',
      ['-C', submoduleDir, 'merge-base', '--is-ancestor', a, b],
      { stdio: ['ignore', 'ignore', 'ignore'] },
    )
    if (probe.status === 0) {
      return true
    }
    if (probe.status === 1) {
      return false
    }
    // Shallow clone / unrelated histories — ancestry unknowable.
    return undefined
  })
  if (verdict !== 'forward') {
    return {
      committed: false,
      gitmodulesLabel: '',
      pinnedSha: currentPin,
      state:
        verdict === 'already-at-target'
          ? 'skipped-already-at-target'
          : 'skipped-target-behind-pin',
      submodulePath,
      targetTag: targetLabel,
    }
  }
  // Belt for shallow grafts: `merge-base --is-ancestor` on two disconnected
  // depth-1 tips exits 1 — a DEFINITIVE-looking "not an ancestor" — so a
  // genuinely-backward target can read as 'forward'. Committer dates survive
  // shallow fetches on each tip; a target meaningfully OLDER than the pin is
  // a suspected downgrade and needs a human, not an auto-apply.
  const pinEpoch = Number(
    runGit(submoduleDir, ['show', '-s', '--format=%ct', currentPin]).trim(),
  )
  const targetEpoch = Number(
    runGit(submoduleDir, ['show', '-s', '--format=%ct', targetCommit]).trim(),
  )
  if (
    Number.isFinite(pinEpoch) &&
    Number.isFinite(targetEpoch) &&
    isSuspectBackward(pinEpoch, targetEpoch)
  ) {
    return {
      committed: false,
      gitmodulesLabel: '',
      pinnedSha: currentPin,
      state: 'skipped-target-behind-pin',
      submodulePath,
      targetTag: targetLabel,
    }
  }
  runGit(submoduleDir, ['checkout', '--quiet', targetCommit])
  const pinnedSha = runGit(submoduleDir, ['rev-parse', 'HEAD']).trim()
  // Label: tags label as `<basename>-<tag>`; SHA pins label with the commit
  // DATE (`<basename>-YYYY.MM.DD`, from %cs — reproducible, no wall clock),
  // matching the fleet's existing date-style .gitmodules annotations.
  const gitmodulesLabel = targetTag
    ? gitmodulesLabelForTag(submodulePath, targetTag)
    : `${path.basename(submodulePath)}-${runGit(submoduleDir, [
        'show',
        '-s',
        '--format=%cs',
        pinnedSha,
      ])
        .trim()
        .replaceAll('-', '.')}`

  writePinnedFields(manifestPath, id, {
    pinnedSha,
    pinnedTag: targetTag,
  })

  // Regenerate the `# <name>-<version> sha256:…` annotation. gen/gitmodules-hash
  // --set bumps the block's ref AND recomputes the archive hash in one write —
  // the only annotation path uses-sha-verify-guard accepts.
  const gen = spawnSync(
    'node',
    [
      'scripts/fleet/gen/gitmodules-hash.mts',
      '--set',
      submodulePath,
      pinnedSha,
      '--label',
      gitmodulesLabel,
      path.join(repoRoot, '.gitmodules'),
    ],
    { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'], stdioString: true },
  )
  if (gen.error) {
    throw gen.error
  }
  if (gen.status !== 0) {
    throw new Error(
      `gen/gitmodules-hash --set failed (status ${gen.status}): ${String(gen.stderr).trim()}`,
    )
  }

  const upstreamAlias = found.upstreamAlias
  // Tag bumps read `bump <upstream> to <tag>`; HEAD bumps read
  // `bump <upstream> to <short-sha> (<commit-date>)`.
  const commitTarget = targetTag
    ? targetTag
    : `${pinnedSha.slice(0, 12)} (${runGit(submoduleDir, ['show', '-s', '--format=%cs', pinnedSha]).trim()})`
  runGit(repoRoot, [
    'commit',
    '-o',
    submodulePath,
    '-o',
    manifestPath,
    '-o',
    path.join(repoRoot, '.gitmodules'),
    '-m',
    `chore(deps): bump ${upstreamAlias} to ${commitTarget}`,
  ])

  return {
    committed: true,
    gitmodulesLabel,
    pinnedSha,
    state: 'bumped',
    submodulePath,
    targetTag: targetLabel,
  }
}
