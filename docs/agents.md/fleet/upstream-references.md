# Upstream reference submodules

An **upstream reference submodule** vendors a third-party source tree at a pinned
commit so its bytes are reviewable in-repo — a supply-chain provenance anchor for
an action or tool the fleet inlines rather than consumes as a live dependency.
It lives at the top level under `upstream/<name>` and is fetched shallow,
single-branch.

## Shape

The `.gitmodules` block declares four things beyond `path`/`url`:

```ini
# actions-checkout-v6.0.2 sha256:<64hex>
[submodule "upstream/actions-checkout"]
  path = upstream/actions-checkout
  url = https://github.com/actions/checkout.git
  branch = releases/v6
  ref = de0fac2e4500dabe0009e67214ff5f5447ce83dd
  shallow = true
```

- `branch = <ref>` pins the single branch the reference tracks; `shallow = true`
  keeps `git submodule update` to that branch's tip depth instead of the full
  history. Together they are "shallow single-branch."
- `ref = <40hex>` is the exact commit of record, and the `# <name>-<version>
  sha256:<64hex>` header is the codeload-archive content hash of that ref. Both
  are provisioned together by `scripts/fleet/gen-gitmodules-hash.mts --set
  <name|path> <ref> --label <name>-<version>` — never hand-edit `ref` alone
  (`uses-sha-verify-guard` blocks it, because the archive hash can't be recomputed
  at edit time).
- The gitlink (the superproject's recorded commit) is pinned to the same `ref`.
  A branch tip ahead of the pinned release needs an explicit
  `git -C upstream/<name> fetch --depth 1 origin <ref>` before checkout.

## Adding one

```sh
# .gitignore re-include (outside the fleet-canonical block) so the fleet-wide
# `**/upstream/` ignore does not drop the gitlink:
#   !/upstream/
#   /upstream/*
#   !/upstream/<name>
git submodule add --depth 1 -b <branch> <url> upstream/<name>
git -C upstream/<name> fetch --depth 1 origin <ref>
git -C upstream/<name> checkout <ref>
git add upstream/<name>
git config -f .gitmodules submodule.upstream/<name>.shallow true
node scripts/fleet/gen-gitmodules-hash.mts --set upstream/<name> <ref> --label <name>-<version>
```

## Enforcement

- `scripts/fleet/check/upstream-submodules-are-shallow-single-branch.mts` fails
  the `check --all` gate when an `upstream/<name>` block lacks `shallow = true`
  or `branch = <ref>`.
- `submodules-are-sparse-or-annotated` treats a shallow single-branch block as
  optimized, so an upstream reference needs no `# full-checkout:` annotation. A
  nested `packages/<x>/upstream/<y>` conformance submodule is subtree-sparse'd
  instead, and stays that check's concern — this gate leaves it alone.
- `gitmodules-comment-guard` requires the `# <name>-<version>` header, and
  `uses-sha-verify-guard` requires the `sha256:` hash and a resolving `ref`.
