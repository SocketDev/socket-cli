# Upstream reference submodules

An **upstream reference submodule** vendors a third-party source tree at a pinned
commit so its bytes are reviewable in-repo — a supply-chain provenance anchor for
an action or tool the fleet inlines rather than consumes as a live dependency.
It lives at the top level under `upstream/<name>`, fetched shallow, single-branch,
and (where only a slice is referenced) sparse.

## `upstream/<name>` at the repo root is the ONLY submodule home

No submodule ever lives anywhere else — not `packages/<pkg>/upstream/<name>`,
not a test-fixtures tree, not a bespoke `submodules/` directory. One home
makes a reference's role unmistakable — the path itself says "this is
upstream code we pin" — keeps the ignore + gitlink rules a single path
test, and lets conformance runners, port maps, and the cascade all resolve
references the same way. An upstream test suite (test262, WPT, a spec
suite) is still an upstream reference: it lands at `upstream/<name>` with a
`sparse-checkout` narrowing it to the exercised subtree, and the
`.gitmodules` header comment records what consumes it. Enforced by
`scripts/fleet/check/submodules-are-rooted-in-upstream.mts`; pre-law nests
ride its script-owned `submoduleRoots.grandfathered` ratchet
(`--update-baseline`) until migrated.

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

<details>
<summary><b>Field by field</b>: `branch` + `shallow`, the release-tag pin policy, how `ref` and the sha256 header are provisioned together, and why no gitlink exists</summary>

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
  are provisioned together by `scripts/fleet/gen/gitmodules-hash.mts --set
<name|path> <ref> --label <name>-<version>` — never hand-edit `ref` alone
  (`uses-sha-verify-guard` blocks it, because the archive hash can't be recomputed
  at edit time).
- There is **no gitlink**: `git ls-files --stage upstream/` must show no `160000`
  entry. On a fresh checkout the reference is materialized on demand. It is not a
  `git submodule init` / `git submodule update` target — both take a PATHSPEC and
  resolve it against the index, so with no gitlink they fail with
  `pathspec 'upstream/<name>' did not match any file(s) known to git`. Use
  `git-partial-submodule.mts clone`, which reads the `ref` pin from `.gitmodules`
  and clones + detaches directly. See "Materializing one" below.

</details>

## Ported actions: the port map + the lock-step rule

The composites under `.github/actions/fleet/*` are the fleet's inlined ports of
third-party GitHub Actions — checkout's inline git-fetch, the app-token minter,
the gh-CLI release, the GPG signing pair, the pnpm and Go toolchain installs.
Each port's provenance is code, not prose, in two records:

- **`scripts/fleet/vendor-actions.mts`** vendors every ported-from upstream —
  any `<owner>/<repo>`, not just `actions/*` — as an `upstream/<owner>-<repo>`
  reference block, pinned at the newest stable release that has **soaked** for
  `SOAK_DAYS`, the same window npm deps get. Its vendored set is derived from
  the `uses:` surface plus the port map below, so declaring a port IS what
  provisions its pin. `--check` exits 1 when any pin is behind its latest
  soaked release.
- **`scripts/fleet/_shared/action-port-map.mts`** is the composite → upstream
  **port map**: a TOTAL record with one entry per composite. A ported composite
  declares its upstream slug and `portedAt` — the upstream release tag the port
  was last reviewed against; a Socket-original declares `[]`. A new composite
  with no entry fails the gate, so nothing lands silently unpinned.

The **lock-step rule**: `portedAt` must equal the pinned tag in `.gitmodules`.
Re-pinning an upstream without re-reviewing the composite against the upstream
diff reds `action-ports-are-lock-stepped` until `portedAt` advances with the
review — an upstream release can never go silently stale, and a pin bump can
never outrun its port. Cadence: the weekly update's check-updates gate and
deterministic chain run `vendor-actions.mts --check`, so a newly soaked
upstream release surfaces as an actionable advisory — re-pin, re-review, bump
`portedAt` — in the weekly PR.

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
node scripts/fleet/gen/gitmodules-hash.mts --set upstream/<name> <ref> --label <name>-<version>
node scripts/fleet/git-partial-submodule.mts clone upstream/<name>             # materialize (no gitlink)
```

`git-partial-submodule.mts clone` is the only materializer that works here. It
resolves the commit from the `.gitmodules` `ref` field, clones the url directly,
applies the `sparse-checkout` slice, and detaches at the pin — no index entry is
read or written. It runs `git submodule init` only for paths that DO carry a
gitlink, so a mixed repo (a real tracked submodule plus gitlink-less upstream
references) materializes both in one pass.

`git-partial-submodule.mts add` refuses an `upstream/<name>` path outright: it
ends in `git submodule add`, which stages the forbidden gitlink. Use the
`git config -f .gitmodules` sequence above instead.

## Materializing one

On a fresh checkout, or after a pin bump:

```sh
node scripts/fleet/git-partial-submodule.mts clone upstream/<name>
```

If the tree already exists and only needs to move to a new pin, fetch and detach
in the reference's own git dir:

```sh
git -C upstream/<name> fetch --depth 1 origin <ref>
git -C upstream/<name> checkout --detach <ref>
```

Both commands are sanctioned. A submodule's git-dir resolves under the
superproject's `.git/modules/`, and `primary-checkout-branch-guard` classifies
that as neither the primary checkout nor a linked worktree, so the detach is not
blocked.

If a tool ever creates a gitlink (a stray `git submodule add`), drop it with
`git update-index --force-remove upstream/<name>` — that removes the `160000`
index entry while leaving `.gitmodules` intact. `no-upstream-gitlink-guard`
blocks the staging that would create one in the first place.

## Enforcement

<details>
<summary><b>Gate roster</b>: no-upstream-gitlink-guard, upstream-gitlinks-are-absent, ignored-files-are-untracked, shallow-single-branch, release-tagged, gitmodules-comment-guard, uses-sha-verify-guard, action-ports-are-lock-stepped, and vendor-actions --check</summary>

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
- `scripts/fleet/check/action-ports-are-lock-stepped.mts` fails when a
  `.github/actions/fleet/*` composite has no port-map entry, a declared port
  lacks its release-tagged + sha256-stamped reference block, or `portedAt`
  differs from the pinned tag — the lock-step gate described above.
- `scripts/fleet/vendor-actions.mts --check` fails when a vendored reference
  pin is behind its latest soaked upstream release. Network-bound, so it runs
  on the weekly-update cadence, the gate and the deterministic chain, not in
  the offline `check --all` gate.

</details>
