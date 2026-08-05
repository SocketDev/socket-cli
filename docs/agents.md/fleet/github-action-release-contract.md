# The github-action release contract

A member on the `github-action` publish channel ships **the repository itself at
a git tag**. There is no registry upload: the runner checks out the tag and
executes the committed `dist/` bundle. That makes two things load-bearing that
no other channel has to think about — the committed bundle, and the tags that
point at it.

## The committed bundle is the artifact

- **`dist/` is what runs, `src/` is not.** A `dist/` that lags `src/` ships a
  bundle silently missing the change. The tag looks right, the code is old.
- **Only a rebuild proves currency.** Rebuild `dist/` from a clean checkout and
  diff it against the committed copy; a non-empty diff means the committed
  bundle is not what the sources produce. This is what GitHub does for its own
  actions — `actions/setup-node` and `actions/checkout` both run
  `actions/reusable-workflows/.github/workflows/check-dist.yml`, which does
  `npm ci --ignore-scripts`, `npm run build`, then fails when
  `git diff --ignore-space-at-eol <dist-path>` is non-empty, uploading the
  expected `dist/` as an artifact so the author can see what they should have
  committed.
- **Git ancestry is a pre-filter, never a proof.** Comparing "last commit
  touching `dist/`" against "last commit touching `src/`" can prove STALENESS,
  and cannot prove currency. One commit touching both passes the ancestry test
  whether or not anyone rebuilt; so does a hand-edited `dist/`, and so does a
  `dist/` built from a stale working tree. `committed-dist-is-current.mts` is
  that cheap pre-filter, and its passing verdict is named
  `no-staleness-proven` for exactly this reason — it is not a currency claim.

## A floating alias tracks the newest release or does not exist

- **The frozen alias is the failure mode.** `v1` and `v1.3` are conventionally
  moved forward to each new release on their line. When the automation that
  moves them is removed but the tags are left behind, every workflow in the
  wild still pinning `@v1` is silently frozen on whatever release the alias last
  pointed at — permanently, and with no error anywhere.
- **Tag protection decides which fix is available, and it rules out deletion.**
  `fleet-tag-protection` matches `refs/tags/v*` on every member with a
  `deletion` rule and a `non_fast_forward` rule. So deleting an alias needs a
  ruleset exemption, while moving one to a DESCENDANT commit is a fast-forward
  ref update that the `non_fast_forward` rule does not bar. Lead with the
  forward move; it is the operation a member can actually perform.
- **Deleting the aliases is still the better end state, and it comes last.**
  Consumers pinning a commit SHA (with a `# vX.Y.Z` comment) or an immutable
  version tag beat any floating alias, and
  `github-action-aliases-are-not-frozen.mts` skips clean when a repo carries no
  aliases at all. Reaching that state means taking the exemption deliberately,
  once the repo is otherwise clean — not as the first move on a red gate.
- **A forward move needs no force.** GitHub's own mover
  (`actions/checkout`'s `update-main-version.yml`) is a `workflow_dispatch`
  running `git tag -f <major> <target>` then `git push origin <major> --force`,
  which doubles as a rollback tool. The `--force` is what a BACKWARD move needs;
  under tag protection it is also what a backward move gets rejected for, so
  rollback is the case that requires the exemption.

## Enforcement

| Invariant | Enforced by | Mode |
| --- | --- | --- |
| Committed `dist/` is byte-identical to a clean rebuild | `.github/workflows/check-dist.yml` | blocking on every push and pull request |
| Committed `dist/` not provably stale against `src/` | `scripts/fleet/check/committed-dist-is-current.mts` | report-only until the first channel member onboards |
| No floating alias left frozen behind its line's newest release | `scripts/fleet/check/github-action-aliases-are-not-frozen.mts` | report-only until the first channel member onboards |

The two checks gate on the roster: `publishesTo(roster, repoName,
'github-action')`. A repo on any other channel skips clean with a one-line
reason, never a silent no-op. Both carry an `ENFORCING` seam to flip once they
have run clean against a real channel member.

<details>
<summary><b>How check-dist.yml behaves</b> — why it triggers on <code>build.from</code> rather than <code>build.type</code>, why it compares with <code>git status --porcelain</code> instead of <code>git diff</code>, and why it wants a local rebuild step beside it</summary>

`check-dist.yml` is the authoritative gate and needs no seam — it either
reproduces the committed bundle or it does not. It reaches only the members
that have one, delivered by the `isGithubAction` CONDITIONAL_FILES trigger,
which keys on `build.from` rather than `build.type`. The type is the wrong
axis: `type: js` also covers every member publishing to npm, and those ship a
tarball the registry builds from, with no committed bundle to rebuild.

It compares with `git status --porcelain -- dist` rather than `git diff`. A
rebuild emitting a NEW bundle file leaves it untracked, and `git diff` reports
nothing for an untracked path — a new entrypoint would ship absent from the tag
while the gate stayed green. Porcelain reports modified and untracked alike and
still ignores gitignored paths.

Pair it with a local rebuild step, the way `actions/setup-node` pairs
`check-dist.yml` with a `pre-checkin` script running format, lint, build, and
test together. When `dist/` is a tracked artifact, rebuilding it belongs in the
commit ritual; CI is the backstop for when someone skips it.

</details>
