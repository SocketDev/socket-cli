/**
 * @file Release-tag resolution for the fleet github-release.yml workflow.
 *   The workflow's first decision: which tag is being released. A tag push
 *   resolves it from the pushed ref; a manual dispatch must name it via the
 *   `tag` input; a dispatch without one refuses LOUD — cutting with an empty
 *   tag would skip past every downstream gate. The resolved tag feeds the
 *   registry-liveness gate as TAG, so wrong resolution here silently bypasses
 *   the publish-before-release order rule.
 *   Branch shape, unchanged from the inline `run:` block this was extracted
 *   from and pinned byte-for-byte by the wheelhouse unit suite:
 *
 *   - push event → the ref name, verbatim. PINNED as-is: a non-tag ref that
 *     reaches the step is forwarded untouched, the tags-only trigger filter is
 *     what keeps branches out.
 *   - any other event with a non-empty tag input → that input, verbatim. PINNED
 *     as-is: the input is not shape-checked and is appended to GITHUB_OUTPUT
 *     exactly like the old `echo`, multiline included — dispatchers already
 *     hold write on the repo.
 *   - otherwise → refuse with the Fix-bearing message and exit 1. Dependency-free
 *     on purpose: github-release.yml runs it on the runner's system Node BEFORE
 *     any install exists, so only `node:` builtins are used — same constraint
 *     as scripts/fleet/registry-liveness-gate.mjs. The pure decision function
 *     is exported for the wheelhouse unit suite; the thin CLI shell at the
 *     bottom reads EVENT_NAME/INPUT_TAG/REF_NAME from the env, appends
 *     `tag=<tag>` to GITHUB_OUTPUT, and exits non-zero on refusal. Missing env
 *     vars fail loud like the old block's `set -u` did — message text differs
 *     from bash's "unbound variable", semantics pinned. Usage: EVENT_NAME=push
 *     REF_NAME=v1.2.3 GITHUB_OUTPUT=out node
 *     scripts/fleet/resolve-release-tag.mjs
 */

import { appendFileSync, realpathSync } from 'node:fs'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

function unboundError(name) {
  return new Error(
    `× ${name} is not set — the resolve-tag step needs it, like the inline block's set -u did.\n` +
      '  Fix: run via github-release.yml, which exports it from the event context.',
  )
}

/**
 * The tag the release names, from the event context. Push events win with the
 * ref name; any other event needs a non-empty tag input; neither is the loud
 * refusal. Throws on an undefined context field the branch actually reads —
 * the `set -u` of the inline predecessor.
 */
export function resolveReleaseTag({ eventName, inputTag, refName }) {
  if (eventName === undefined) {
    throw unboundError('EVENT_NAME')
  }
  if (eventName === 'push') {
    if (refName === undefined) {
      throw unboundError('REF_NAME')
    }
    return { ok: true, tag: refName }
  }
  if (inputTag === undefined) {
    throw unboundError('INPUT_TAG')
  }
  if (inputTag !== '') {
    return { ok: true, tag: inputTag }
  }
  return {
    errorLines: [
      '× a manual dispatch needs the tag input (tag pushes resolve it from the ref).',
      '  Fix: re-dispatch with tag: v<version> (the tag must already be pushed).',
    ],
    ok: false,
  }
}

/**
 * The whole step: resolve from the env, append `tag=<tag>` to GITHUB_OUTPUT,
 * return the process exit code. Injectable env + append + logger keep it
 * drivable end-to-end by the unit suite without touching the real filesystem.
 */
export function runResolve({
  appendImpl = appendFileSync,
  env = process.env,
  logError = console.error,
} = {}) {
  let resolution
  try {
    resolution = resolveReleaseTag({
      eventName: env.EVENT_NAME,
      inputTag: env.INPUT_TAG,
      refName: env.REF_NAME,
    })
  } catch (error) {
    // Zero-dep on purpose — the lib errorMessage helper is not on disk when
    // this runs, so surface the plain message.
    logError(String(error?.message ?? error))
    return 1
  }
  if (!resolution.ok) {
    for (let i = 0, { length } = resolution.errorLines; i < length; i += 1) {
      logError(resolution.errorLines[i])
    }
    return 1
  }
  const outputPath = env.GITHUB_OUTPUT
  if (!outputPath) {
    // The old `>> "${GITHUB_OUTPUT}"` died under set -u when unset and on
    // "No such file or directory" when empty; both map to the same loud exit.
    logError(String(unboundError('GITHUB_OUTPUT').message))
    return 1
  }
  appendImpl(outputPath, `tag=${resolution.tag}\n`)
  return 0
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
  process.exitCode = runResolve()
}
