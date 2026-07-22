# Upstream reference submodules

An **upstream reference submodule** vendors a third-party source tree at a pinned
commit so its bytes are reviewable in-repo — a supply-chain provenance anchor for
an action or tool the fleet inlines rather than consumes as a live dependency.
It lives at the top level under `upstream/<name>`, fetched shallow, single-branch,
and (where only a slice is referenced) sparse.

## `.gitmodules` is the sole record — never a gitlink

`upstream/` is **always git-ignored** (the fleet-wide `**/upstream/` rule) and is
**never re-included** with a `!` negation. The reference is recorded **only** in
`.gitmodules`; its working tree is a local, ignored materialization fetched on
demand. A tracked **gitlink** (a `160000` index entry recording the submodule's
commit in the superproject) is **forbidden** — the `ref = <40hex>` field already
IS the pinned commit of record, so the gitlink would be a redundant second copy
of the same SHA.

```ini
# actions-checkout-v6.0.2 sha256:<64hex>
[submodule "upstream/actions-checkout"]
  path = upstream/actions-checkout
  url = https://github.com/actions/checkout.git
  branch = releases/v6
  ref = de0fac2e4500dabe0009e67214ff5f5447ce83dd
  shallow = true
```

- `branch = <ref>` pins the ref the reference tracks; `shallow = true`
  keeps the fetch to that ref's tip depth. Together they are "shallow
  single-branch." A `sparse-checkout = <subpath>` field limits the materialized
  tree to the slice actually referenced.
- **Pin the latest RELEASE TAG, not a moving branch (fleet policy).** `branch`
  must be a release tag (`v0.4.5`, `1.2.3`, a monorepo `@scope/pkg@1.2.3`) — a
  tag is immutable, so the pin can't drift, and it advances deliberately with a
  fixture/proof. Attempt the newest release tag when adding or bumping. Only
  when the upstream publishes **no releases at all** may you track a branch
  (`main`) — and then the block MUST carry a `# no-release-tag: <reason>`
  annotation. Enforced by `upstream-submodules-are-release-tagged`.
- `ref = <40hex>` is the exact commit of record, and the `# <name>-<version>
  sha256:<64hex>` header is the codeload-archive content hash of that ref. Both
  are provisioned together by `scripts/fleet/gen-gitmodules-hash.mts --set
  <name|path> <ref> --label <name>-<version>` — never hand-edit `ref` alone
  (`uses-sha-verify-guard` blocks it, because the archive hash can't be recomputed
  at edit time).
- There is **no gitlink**: `git ls-files --stage upstream/` must show no `160000`
  entry. On a fresh checkout the reference is materialized on demand (it is not a
  `git submodule update` target, since nothing is tracked to update).

## Adding one

No `git submodule add` (it stages a gitlink) and no `.gitignore` re-include —
`upstream/` stays fully ignored. Declare the block in `.gitmodules`, pin it, then
materialize the local ignored clone:

```sh
git config -f .gitmodules submodule.upstream/<name>.path upstream/<name>
git config -f .gitmodules submodule.upstream/<name>.url <url>
git config -f .gitmodules submodule.upstream/<name>.branch <branch>
git config -f .gitmodules submodule.upstream/<name>.shallow true
git config -f .gitmodules submodule.upstream/<name>.sparse-checkout <subpath>   # optional slice
git config -f .gitmodules submodule.upstream/<name>.verify none                 # or a verify command
node scripts/fleet/gen-gitmodules-hash.mts --set upstream/<name> <ref> --label <name>-<version>
node scripts/fleet/git-partial-submodule.mts clone upstream/<name>             # materialize (no gitlink)
```

If a tool ever creates a gitlink (a stray `git submodule add`), drop it with
`git update-index --force-remove upstream/<name>` — that removes the `160000`
index entry while leaving `.gitmodules` intact. `no-upstream-gitlink-guard`
blocks the staging that would create one in the first place.

## Enforcement

- `no-upstream-gitlink-guard` (PreToolUse) blocks any Bash `git add` /
  `git submodule add` / `git update-index --add` that would stage a path under
  `upstream/` — the gitlink can never be committed. Bypass:
  `Allow upstream-gitlink bypass`.
- `scripts/fleet/check/upstream-gitlinks-are-absent.mts` (belt) fails the
  `check --all` gate if a `160000` gitlink is ever tracked at the top level
  `upstream/`.
- `scripts/fleet/check/ignored-files-are-untracked.mts` (superset belt) fails the
  gate if ANY tracked path is matched by `.gitignore` — catching a NESTED
  `**/upstream/<name>` gitlink (which the top-level gate above does not scope to),
  plus vendored/build/cache junk. `git ls-files -ci --exclude-standard` is the
  detector; a hand-authored file under an ignored tree stays tracked via a `!`
  re-include outside the fleet-canonical block.
- `scripts/fleet/check/upstream-submodules-are-shallow-single-branch.mts` fails
  when an `upstream/<name>` block lacks `shallow = true` or `branch = <ref>`.
- `scripts/fleet/check/upstream-submodules-are-release-tagged.mts` fails when an
  `upstream/<name>` block's `branch` is a moving branch (e.g. `main`,
  `releases/v6`) rather than a release tag, unless it carries a
  `# no-release-tag: <reason>` annotation (upstream has no releases).
- `gitmodules-comment-guard` requires the `# <name>-<version>` header, and
  `uses-sha-verify-guard` requires the `sha256:` hash and a resolving `ref`.
