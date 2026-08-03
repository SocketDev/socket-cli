/*
 * @file The cascade chmods a live fleet mirror read-only (0444/0555) so a
 *   stray edit fails at the filesystem level instead of silently drifting
 *   from its template source (`scripts/fleet/_shared/mirror-lock.mts`). A
 *   sanctioned writer that (re)writes a mirror must lift the lock first —
 *   `writeThroughMirrorLock` / `withMirrorLockLifted(Sync)` — because a plain
 *   `writeFileSync` / `copyFileSync` opens the DESTINATION for write and
 *   EACCESes before it ever runs. This shipped: `applyStableAliasReconcile`
 *   (`scripts/fleet/lib/stable-alias.mts`) wrote a member's fleet-catalog
 *   mirror via a bare `writeFileSync(file, text)` — the module had never
 *   imported the lock at all — and took the whole `pnpm run fix --all` run
 *   down with a bare EACCES the first time a `-stable` alias desynced. Fixed
 *   in commit 3a231c998 by routing the write through `writeThroughMirrorLock`.
 *
 *   Detection strategy, and why it isn't destination matching: a rule that
 *   inspects the write CALL's destination argument (a literal path, or an
 *   identifier bound to a known mirror-path constant) was tried first and
 *   measured against the tree: `scripts/fleet/**` alone carries ~87 bare
 *   `writeFileSync`/`copyFileSync` call sites, and their destination
 *   expressions are almost all local variables (`file`, `filePath`, `dest`,
 *   `manifestPath`, `shimPath`, `outPath`, …) — the same names legitimate
 *   non-mirror writers use for temp files, generated docs, downloaded
 *   artifacts. Exactly one ALL-CAPS constant recurs, `PNPM_WORKSPACE_YAML`,
 *   and it resolves to the repo's OWN `pnpm-workspace.yaml` — a per-repo
 *   merge output, never chmod-locked. Static destination matching lands at
 *   roughly 2-of-87 recall with a real false-positive tax, so it doesn't ship.
 *
 *   What ships instead: no destination analysis at all. Inside a module that
 *   already coordinates a cascade-locked write (it imports something from
 *   `_shared/mirror-lock.mts`), EVERY bare `writeFileSync` / `writeFile` /
 *   `copyFileSync` / `cp` / `cpSync` call is the violation, full stop — a
 *   module that already knows the lock exists has no legitimate reason to
 *   bypass it for ANY write. Enforcement is scoped via `.config/fleet/
 *   oxlintrc.json`'s `overrides[].files` glob, not this rule's code: the glob
 *   lists the modules that import `_shared/mirror-lock.mts` today (mechanical
 *   derivation — grep the import, not a hand-maintained guess), currently 12
 *   files. `mirror-lock.mts` itself is exempted BY PATH below (it IS the
 *   primitive every one of those imports resolves to).
 *
 *   Residual gap, named plainly: this does NOT catch a brand-new module that
 *   writes a fleet mirror WITHOUT ever importing the lock — exactly the shape
 *   of the original `applyStableAliasReconcile` bug, which had zero mirror-lock
 *   awareness before 3a231c998. Closing that gap needs the module added to the
 *   override glob first (same as any other lint-rule scope). The glob is a
 *   ratchet, not a permanent carve-out: it should WIDEN as more of
 *   `scripts/fleet/**` migrates through the lock, ending at the whole tier once
 *   bare writes there are gone.
 *
 *   A genuine non-mirror write inside a scoped file (e.g. a lock-lifted
 *   callback that already called `liftMirrorLockSync` itself, so the
 *   underlying `copyFileSync`/`cpSync` is correct) opts out with the fleet's
 *   standard `oxlint-disable-next-line socket/prefer-mirror-lock-write --
 *   <reason>` — this rule carries no bypass-comment logic of its own.
 */

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import type { AstNode, RuleContext } from '../../lib/rule-types.mts'

// The primitive's own home — the one file allowed to call these functions
// bare, since it IS what every other caller routes through.
const MIRROR_LOCK_FILE_SUFFIX = '_shared/mirror-lock.mts'

// The four shapes named in the incident + its siblings: a data write
// (writeFileSync/writeFile) or a file-to-file copy (copyFileSync/cp/cpSync)
// aimed at a destination that opens the target for write.
const FS_WRITE_NAMES = new Set([
  'copyFileSync',
  'cp',
  'cpSync',
  'writeFile',
  'writeFileSync',
])

// True for `writeFileSync(...)` (bare identifier) or `fs.writeFileSync(...)` /
// `fs.promises.writeFile(...)` (a non-computed member access) — the object
// side is intentionally unchecked: the fleet has one write surface for each of
// these names, and a scoped file matched by the override glob has no
// legitimate bare-write callee that ISN'T one of these.
function fsWriteName(node: AstNode): string | undefined {
  const callee = node.callee
  if (!callee) {
    return undefined
  }
  if (callee.type === 'Identifier' && FS_WRITE_NAMES.has(callee.name)) {
    return callee.name
  }
  if (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.property?.type === 'Identifier' &&
    FS_WRITE_NAMES.has(callee.property.name)
  ) {
    return callee.property.name
  }
  return undefined
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Inside a module that already imports the mirror-lock primitive, a bare writeFileSync/writeFile/copyFileSync/cp/cpSync bypasses the cascade lock and EACCESes on a locked mirror. Use writeThroughMirrorLock.',
      category: 'Possible Errors',
      recommended: true,
    },
    fixable: undefined,
    messages: {
      bareMirrorWrite:
        'Bare `{{name}}` call in a mirror-lock-aware module — a cascade-locked mirror is chmod 0444/0555, so this EACCESes the moment the target is locked. Use `writeThroughMirrorLock` (or `withMirrorLockLifted(Sync)`) from `scripts/fleet/_shared/mirror-lock.mts` instead. If this destination is genuinely not a mirror, add `oxlint-disable-next-line socket/prefer-mirror-lock-write -- <reason>`.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    const filename = normalizePath(
      context.filename ?? context.getFilename?.() ?? '',
    )
    // mirror-lock.mts IS the primitive — every wrapper here bottoms out in its
    // own bare writeFileSync/chmod calls.
    if (filename.endsWith(MIRROR_LOCK_FILE_SUFFIX)) {
      return {}
    }

    return {
      CallExpression(node: AstNode) {
        const name = fsWriteName(node)
        if (!name) {
          return
        }
        context.report({
          node,
          messageId: 'bareMirrorWrite',
          data: { name },
        })
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
