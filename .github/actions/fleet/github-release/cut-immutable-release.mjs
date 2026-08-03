/**
 * @file Decision core for the fleet github-release composite action. ORDER
 *   RULE: the immutable 3-step (create --draft → upload assets → edit
 *   --draft=false; immutable-release-guard) ties to an ALREADY-PUSHED tag
 *   (release-tag-tied-guard) — the cut refuses when the tag is not on origin
 *   or a release for it already exists. Branch shape, unchanged from the
 *   inline `run:` block this was extracted from — the refusal messages are
 *   byte-identical on purpose: other tooling greps them, so they are pinned by
 *   the wheelhouse unit suite:
 *
 *   - tag not on origin → refuse; this action never creates tags.
 *   - a release for the tag already exists → refuse; releases are immutable,
 *     never re-cut an existing version.
 *   - notes precedence: notes-file, must exist > notes > "Release <tag>.".
 *   - every listed asset path must exist — a typo'd asset silently missing from a
 *     release is worse than a failed cut.
 *   - dry-run (anything but the string "false") prints the 3-step plan and
 *     mutates nothing. The gh CLI probes stay thin in action.yml (they need the
 *     runner's auth context) and hand their results in via TAG_ON_ORIGIN /
 *     RELEASE_EXISTS; the pure decision functions below take those probe
 *     results and are exported for the wheelhouse unit suite. The thin shell at
 *     the bottom reads the env and runs the 3 gh steps via spawnSync —
 *     inherited stdio, so gh output reaches the log exactly as the inline
 *     block's did. Dep-0 on purpose (node: builtins only, plain .mjs) and
 *     co-located inside the action, invoked via `node
 *     "${GITHUB_ACTION_PATH}/cut-immutable-release.mjs"`, so it travels with
 *     the action wherever the action is consumed — same shape as
 *     github-release-app-token's mint-app-installation-token.mjs.
 */

// oxlint-disable-next-line socket/prefer-async-spawn -- composite-action script runs on the raw runner before any install; node_modules is unavailable and the 3-step gh pipeline is naturally sync.
import { spawnSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const defaultFsLike = { existsSync }

function defaultExec(args) {
  const result = spawnSync('gh', args, { stdio: 'inherit' })
  if (typeof result.status === 'number') {
    return result.status
  }
  // Spawn failure — gh never ran. Map a missing gh to bash's
  // command-not-found status, anything else to a generic failure.
  return result.error?.code === 'ENOENT' ? 127 : 1
}

/**
 * The refusal the probe results demand, or undefined when the cut may
 * proceed. Order matches the inline block: the tag-on-origin refusal wins
 * over the release-exists refusal (the original never probed the release when
 * the tag was absent). An existing release refuses regardless of whether
 * GitHub would still allow edits — the probe is `gh release view`, which does
 * not distinguish mutability, and re-cutting an existing version is always a
 * mistake (verify-state-before-acting).
 */
export function refusalForProbes({
  releaseExists,
  repository,
  tag,
  tagOnOrigin,
}) {
  if (!tagOnOrigin) {
    return [
      `× tag "${tag}" is not on origin ${repository}.`,
      '  A release must tie to an already-pushed tag; this action never creates tags.',
      '  Fix: create + push the signed tag first, then re-run:',
      `    git tag -s ${tag} -m "release ${tag}" && git push origin ${tag}`,
    ].join('\n')
  }
  if (releaseExists) {
    return [
      `× a GitHub Release for "${tag}" already exists in ${repository}.`,
      '  Releases are immutable: never re-cut an existing version.',
      '  Fix: bump the version, push a new tag, and release that instead.',
    ].join('\n')
  }
  return undefined
}

/**
 * The release title — the tag when empty, the `${TITLE:-${TAG}}` the inline
 * block used.
 */
export function resolveTitle(title, tag) {
  return title || tag
}

/**
 * The gh notes flags per the precedence rule: notes-file wins over notes wins
 * over the minimal default. A named notes-file that does not exist is a
 * refusal, never a silent fall-through to notes.
 */
export function resolveNotesArgs(
  { notes, notesFile, tag },
  fsLike = defaultFsLike,
) {
  if (notesFile) {
    if (!fsLike.existsSync(notesFile)) {
      return {
        refusal: [
          `× notes-file "${notesFile}" does not exist.`,
          '  Fix: point notes-file at a real file, or pass notes instead.',
        ].join('\n'),
      }
    }
    return { notesArgs: ['--notes-file', notesFile] }
  }
  if (notes) {
    return { notesArgs: ['--notes', notes] }
  }
  return { notesArgs: ['--notes', `Release ${tag}.`] }
}

/**
 * The newline-separated assets input as a path list — lines trimmed, blanks
 * dropped. The inline block trimmed via `echo | xargs`, which also mangles
 * quotes/backslashes and collapses interior whitespace runs; trim() keeps the
 * path intact, so a filename xargs would have corrupted now validates against
 * its real name.
 */
export function parseAssetList(assets) {
  return assets
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '')
}

/**
 * The refusal for the first listed asset that does not exist, or undefined
 * when every asset is on disk. First-missing-wins, matching the inline
 * per-line loop.
 */
export function assetRefusal(assetPaths, fsLike = defaultFsLike) {
  for (const assetPath of assetPaths) {
    if (!fsLike.existsSync(assetPath)) {
      return [
        `× asset "${assetPath}" does not exist.`,
        '  Fix: build the asset before cutting the release, or drop it from assets.',
      ].join('\n')
    }
  }
  return undefined
}

/**
 * The dry-run plan lines — the exact `[dry-run]` output of the inline block,
 * including its bash `${arr[*]}` single-space joins.
 */
export function dryRunPlan({ assetPaths, notesArgs, tag, title }) {
  const lines = [
    `[dry-run] tag ${tag} is on origin and unreleased. Would run, in order:`,
    `  gh release create ${tag} --draft --title "${title}" ${notesArgs.join(' ')}`,
  ]
  if (assetPaths.length > 0) {
    lines.push(`  gh release upload ${tag} ${assetPaths.join(' ')} --clobber`)
  }
  lines.push(
    `  gh release edit ${tag} --draft=false`,
    'Pass dry-run: false to execute the 3-step immutable release.',
  )
  return lines
}

/**
 * The whole cut: refuse on the probe results, resolve notes + assets, then
 * either print the dry-run plan or run the immutable 3-step via gh. Returns
 * the process exit code. Injectable exec + fs + loggers keep it drivable
 * end-to-end by the unit suite with no gh on PATH.
 */
export function runCut({
  assets = process.env.ASSETS ?? '',
  dryRun = process.env.DRY_RUN ?? 'true',
  execImpl = defaultExec,
  fsLike = defaultFsLike,
  log = console.log,
  logError = console.error,
  notes = process.env.NOTES ?? '',
  notesFile = process.env.NOTES_FILE ?? '',
  releaseExists = process.env.RELEASE_EXISTS === 'true',
  repository = process.env.GITHUB_REPOSITORY ?? '',
  tag = process.env.TAG ?? '',
  tagOnOrigin = process.env.TAG_ON_ORIGIN === 'true',
  title = process.env.TITLE ?? '',
} = {}) {
  const probeRefusal = refusalForProbes({
    releaseExists,
    repository,
    tag,
    tagOnOrigin,
  })
  if (probeRefusal) {
    logError(probeRefusal)
    return 1
  }
  const resolvedTitle = resolveTitle(title, tag)
  const resolvedNotes = resolveNotesArgs({ notes, notesFile, tag }, fsLike)
  if (resolvedNotes.refusal) {
    logError(resolvedNotes.refusal)
    return 1
  }
  const assetPaths = parseAssetList(assets)
  const missingAsset = assetRefusal(assetPaths, fsLike)
  if (missingAsset) {
    logError(missingAsset)
    return 1
  }
  if (dryRun !== 'false') {
    const plan = dryRunPlan({
      assetPaths,
      notesArgs: resolvedNotes.notesArgs,
      tag,
      title: resolvedTitle,
    })
    for (const line of plan) {
      log(line)
    }
    return 0
  }
  // The immutable 3-step (immutable-release-guard): a draft assembles
  // everything privately; publishing (un-drafting) happens exactly once.
  // A failing gh step stops the cut and propagates its exit status, the way
  // the inline block's `set -e` did; gh's own error output already reached
  // the log via inherited stdio.
  log(`creating draft release ${tag}…`)
  const createStatus = execImpl([
    'release',
    'create',
    tag,
    '--draft',
    '--title',
    resolvedTitle,
    ...resolvedNotes.notesArgs,
  ])
  if (createStatus !== 0) {
    return createStatus
  }
  if (assetPaths.length > 0) {
    log(`uploading ${assetPaths.length} asset(s)…`)
    const uploadStatus = execImpl([
      'release',
      'upload',
      tag,
      ...assetPaths,
      '--clobber',
    ])
    if (uploadStatus !== 0) {
      return uploadStatus
    }
  }
  log('publishing (un-drafting)…')
  const editStatus = execImpl(['release', 'edit', tag, '--draft=false'])
  if (editStatus !== 0) {
    return editStatus
  }
  log(`Created release ${tag}.`)
  return 0
}

function main() {
  process.exitCode = runCut()
}

// Realpath both sides — the naive argv[1] comparison is symlink-fragile, the
// same pitfall scripts/fleet/_shared/is-main-module.mts documents; that
// helper is .mts and this script must stay importless-runnable on system
// Node, so the comparison is inlined.
function isEntrypoint(invokedPath) {
  if (!invokedPath) {
    return false
  }
  try {
    return (
      realpathSync(invokedPath) === realpathSync(fileURLToPath(import.meta.url))
    )
  } catch {
    return false
  }
}

if (isEntrypoint(process.argv[1])) {
  main()
}
