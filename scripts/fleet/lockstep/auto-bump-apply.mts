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

export interface ApplyConfig {
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
 * returns undefined when ancestry is unknowable, shallow clone — unknown
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

// The `[submodule "<name>"]` block name whose `path =` matches submodulePath,
// read structurally via `git config -f .gitmodules`. Returns undefined when no
// block declares the path. Exported for tests.
export function gitmodulesBlockName(
  repoRoot: string,
  submodulePath: string,
): string | undefined {
  const out = gitmodulesRead(repoRoot, undefined)
  if (out === undefined) {
    return undefined
  }
  // Windows git emits \r\n. The `u` flag doesn't change what this pattern
  // matches — it opts into strict escape parsing (malformed escapes are
  // early SyntaxErrors instead of silent literals), the regex convention
  // this codebase uses throughout.
  const lines = out.split(/\r?\n/u)
  for (let i = 0, { length } = lines; i < length; i += 1) {
    // `git config --get-regexp` prints `submodule.<name>.path <value>` per
    // block: group 1 captures the block name, group 2 the path value.
    const m = /^submodule\.(.+)\.path (.+)$/.exec(lines[i]!.trim())
    if (m && m[2] === submodulePath) {
      return m[1]
    }
  }
  return undefined
}

// Read one key (or, with undefined, every `submodule.*.path` mapping) from
// .gitmodules via `git config -f`. Returns undefined when the key is absent —
// `git config --get` exits 1 for a missing key, which is not an error here.
// Exported for tests.
export function gitmodulesRead(
  repoRoot: string,
  key: string | undefined,
): string | undefined {
  const args = key
    ? ['config', '-f', path.join(repoRoot, '.gitmodules'), '--get', key]
    : [
        'config',
        '-f',
        path.join(repoRoot, '.gitmodules'),
        '--get-regexp',
        String.raw`^submodule\..*\.path$`,
      ]
  const result = spawnSync('git', ['-C', repoRoot, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    stdioString: true,
  })
  if (result.error || result.status !== 0) {
    return undefined
  }
  return String(result.stdout).trim()
}

// Locate the version-pin row + its submodule path in the manifest. Returns
// undefined for either when the id is unknown or its upstream has no submodule
// — the apply path turns those into a skipped, not thrown, result so a stale id
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

// Rewrite ONE version-pin row's `pinned_tag` in the manifest JSON, preserving
// the file's existing 2-space formatting + trailing newline. The pin SHA is NOT
// written here — SHA-DRY: `.gitmodules` `ref =` is the single source of truth,
// written authoritatively by `gen/gitmodules-hash.mts --set`. So this ALWAYS
// DELETES a legacy `pinned_sha`, migrating a legacy row to the derived model on
// its next bump. A `pinnedTag` of `undefined` DELETES the row's pinned_tag (SHA
// pins carry no release label).
export function writePinnedFields(
  manifestPath: string,
  id: string,
  config: { pinnedTag: string | undefined },
): void {
  const { pinnedTag } = { __proto__: null, ...config } as {
    pinnedTag: string | undefined
  }
  const raw = readFileSync(manifestPath, 'utf8')
  const trailingNewline = raw.endsWith('\n')
  const parsed: unknown = JSON.parse(raw)
  const manifest = parsed as Manifest
  for (let i = 0, rows = manifest.rows, { length } = rows; i < length; i += 1) {
    const row = rows[i]!
    if (row.kind === 'version-pin' && row.id === id) {
      delete row.pinned_sha
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
export function applyBump(config: ApplyConfig): ApplyResult {
  const cfg = { __proto__: null, ...config } as ApplyConfig
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

  // Migrate the row to the derived model: drop any stored pinned_sha and set
  // the pinned_tag. The pin SHA itself is written to `.gitmodules` below (the
  // single source of truth).
  writePinnedFields(manifestPath, id, {
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

  // A tag bump moves the block's `branch =` too — the single-branch fetch
  // config must name the fetched tag, or the next materialization fetches a
  // stale ref. `git config -f` keeps the rewrite structured. SHA bumps track
  // the default branch, which the existing value already names.
  if (targetTag) {
    const blockName = gitmodulesBlockName(repoRoot, submodulePath)
    if (
      blockName &&
      gitmodulesRead(repoRoot, `submodule.${blockName}.branch`) !== undefined
    ) {
      runGit(repoRoot, [
        'config',
        '-f',
        path.join(repoRoot, '.gitmodules'),
        `submodule.${blockName}.branch`,
        targetTag,
      ])
    }
  }

  const upstreamAlias = found.upstreamAlias
  // Tag bumps read `bump <upstream> to <tag>`; HEAD bumps read
  // `bump <upstream> to <short-sha> (<commit-date>)`.
  const commitTarget = targetTag
    ? targetTag
    : `${pinnedSha.slice(0, 12)} (${runGit(submoduleDir, ['show', '-s', '--format=%cs', pinnedSha]).trim()})`
  // A fleet upstream pin carries no gitlink (`no-upstream-gitlink-guard`) —
  // the submodule path is ignored/untracked, and `git commit -o <path>` on it
  // errors. Include the path leg only when a gitlink actually exists.
  const gitlink = runGit(repoRoot, [
    'ls-files',
    '-s',
    '--',
    submodulePath,
  ]).trim()
  runGit(repoRoot, [
    'commit',
    ...(gitlink ? ['-o', submodulePath] : []),
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
