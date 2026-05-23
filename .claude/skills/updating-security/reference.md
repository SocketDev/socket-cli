# updating-security Reference

## Default-branch resolution

```bash
BASE=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
if [ -z "$BASE" ]; then
  for candidate in main master; do
    if git show-ref --verify --quiet "refs/remotes/origin/$candidate"; then
      BASE="$candidate"
      break
    fi
  done
fi
BASE="${BASE:-main}"
```

## Alert discovery

```bash
# Resolve owner/repo from origin URL.
ORIGIN=$(git config remote.origin.url)
SLUG=$(echo "$ORIGIN" | sed -E 's@.*github.com[:/]([^/]+/[^/.]+)(\.git)?$@\1@')
echo "$SLUG"

# Pull open alerts (one page; 100 max — paginate if needed).
gh api "repos/$SLUG/dependabot/alerts?state=open&per_page=100" > /tmp/dependabot-alerts.json
jq '. | length' /tmp/dependabot-alerts.json
```

## Alert shape (the fields we use)

```json
{
  "number": 2,
  "state": "open",
  "dependency": {
    "package": { "ecosystem": "npm", "name": "brace-expansion" },
    "manifest_path": "pnpm-lock.yaml",
    "scope": "development",
    "relationship": "transitive"
  },
  "security_advisory": {
    "ghsa_id": "GHSA-jxxr-4gwj-5jf2",
    "severity": "medium",
    "summary": "Large numeric range defeats documented `max` DoS protection"
  },
  "security_vulnerability": {
    "package": { "name": "brace-expansion" },
    "vulnerable_version_range": ">= 5.0.0, < 5.0.6",
    "first_patched_version": { "identifier": "5.0.6" }
  },
  "html_url": "https://github.com/SocketDev/<repo>/security/dependabot/2"
}
```

Five fields drive classification: `dependency.relationship`,
`dependency.scope`, `security_vulnerability.first_patched_version`,
`security_advisory.ghsa_id`, and (for commits) `severity`.

## Per-alert action selection

```text
relationship == "direct" && first_patched_version != null
  → DIRECT-FIX:   `pnpm update <pkg>@^<patched>`

relationship == "transitive" && first_patched_version != null
  → OVERRIDE-FIX: add to pnpm.overrides in package.json

first_patched_version == null
  → DISMISS:      gh api .../alerts/N -X PATCH \
                    -f state=dismissed -f dismissed_reason=no_bandwidth \
                    -f dismissed_comment="<one-liner>"

soak gate hits the patched version
  → AWAITING-SOAK: skip; report in summary; do NOT modify
```

## Soak-gate interaction

The `minimum-release-age-guard` hook blocks adding deps published <7
days ago. Before running `pnpm install` after a `package.json` edit,
check the patched version's npm publish date:

```bash
PUB_DATE=$(npm view "<pkg>@<patched>" time."<patched>" 2>/dev/null)
NOW=$(date -u +%s)
PUB=$(date -j -f "%Y-%m-%dT%H:%M:%S.000Z" "$PUB_DATE" +%s 2>/dev/null)
AGE_DAYS=$(( (NOW - PUB) / 86400 ))
if [ "$AGE_DAYS" -lt 7 ]; then
  echo "AWAITING-SOAK: <pkg>@<patched> published $AGE_DAYS days ago"
  # Per-package exception requires the canonical
  #   `# published: YYYY-MM-DD | removable: YYYY-MM-DD`
  # annotation in pnpm-workspace.yaml `minimumReleaseAgeExclude[]`.
  # Don't auto-add — emergency CVE patches need explicit user signoff
  # (CLAUDE.md _Tooling_ § minimumReleaseAge).
fi
```

If the alert is critical AND patched <7 days ago, surface to the
user via `AskUserQuestion` with the canonical bypass-phrase prompt
(`Allow minimumReleaseAge bypass`).

## Override-fix shape

For transitive deps, edit `package.json`:

```jsonc
{
  "pnpm": {
    "overrides": {
      // CVE-2026-45149 — DoS via numeric range. Patched 5.0.6.
      "brace-expansion": "^5.0.6",
      // CVE-2026-41305 — XSS via unescaped </style>. Patched 8.5.10.
      "postcss": "^8.5.10",
    },
  },
}
```

Then:

```bash
pnpm install
```

The lockfile updates to pin every transitive `brace-expansion` /
`postcss` to the patched range. The CVE clears on the next
Dependabot rescan (typically minutes after push).

## Direct-fix shape

```bash
pnpm update "<pkg>@^<first-patched-version>"
```

If `pnpm update` doesn't take the requested version (e.g. because
the version range in package.json caps below the patch), edit
`package.json` directly:

```bash
node -e '
  const fs = require("node:fs")
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"))
  for (const section of ["dependencies", "devDependencies", "peerDependencies"]) {
    if (pkg[section]?.["<pkg>"]) {
      pkg[section]["<pkg>"] = "^<first-patched-version>"
    }
  }
  fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n")
'
pnpm install
```

## Commit shapes

```text
chore(security): bump brace-expansion to 5.0.6 (GHSA-jxxr-4gwj-5jf2)

CVE-2026-45149 — DoS via large numeric range. Direct dep upgrade
from <pre> to 5.0.6 (the first-patched version per GitHub's
advisory). pnpm-lock.yaml regenerated.
```

```text
chore(security): override postcss ~> 8.5.10 (GHSA-qx2v-qp2m-jg93)

CVE-2026-41305 — XSS via unescaped </style> in CSS stringify.
Transitive dependency; added to pnpm.overrides in package.json to
pin every consumer to the patched range. Lockfile refreshed.
```

```text
chore(security): dismiss vue-component-meta alert (GHSA-...)

GHSA-... — vulnerability requires user-supplied `.vue` files at
build time; we don't accept user-uploaded source. Dismissed as
`tolerable_risk` per CLAUDE.md _Token hygiene_ /
_Public-surface hygiene_ guidance — no exposure surface.
```

## Validation

Same gate as the rest of the fleet:

```bash
pnpm run check --all
```

If any commit fails the check, roll back THAT commit and continue
to the next alert. Don't `git reset --hard` the whole chain —
treat each fix as independent.

## Push policy

Per CLAUDE.md _Commits & PRs_ → "Push policy: push, fall back to
PR":

```bash
git push origin "$BASE" || gh pr create --title "chore(security): clear N alerts" --body-file <path>
```

NEVER force-push for security fixes. The chain of per-alert commits
is intentional history.

## Verify resolution

After push lands, re-query the alerts:

```bash
gh api "repos/$SLUG/dependabot/alerts?state=open" > /tmp/dependabot-alerts-after.json
```

Compare counts; alerts we fixed should be missing (Dependabot
auto-dismisses on detection of patched version). Alerts still open
should match the AWAITING-SOAK / DISMISS sets we tracked above.

## GitHub API references

- List alerts: `GET repos/{owner}/{repo}/dependabot/alerts`
- Read one: `GET repos/{owner}/{repo}/dependabot/alerts/{number}`
- Dismiss: `PATCH repos/{owner}/{repo}/dependabot/alerts/{number}`
  with body `{ "state": "dismissed", "dismissed_reason": "...",
"dismissed_comment": "..." }`

Documented at:
<https://docs.github.com/en/rest/dependabot/alerts>

## Dismissal-reason taxonomy

GitHub accepts exactly these values for `dismissed_reason`:

| Value            | When to use                                                                 |
| ---------------- | --------------------------------------------------------------------------- |
| `fix_started`    | A PR resolving the alert is already open in this repo.                      |
| `inaccurate`     | The advisory mis-classifies our usage (e.g. server-only dep on a CLI repo). |
| `no_bandwidth`   | Known, accepted, will revisit later — typical for low-severity transitives. |
| `not_used`       | Dep is in the lockfile but not actually loaded at runtime.                  |
| `tolerable_risk` | Risk is understood and accepted; no remediation planned.                    |

Pick the most precise one; fleet convention prefers `inaccurate` /
`not_used` (factual) over `tolerable_risk` (judgmental) when both
fit.

## Failure recovery

- **`gh api` 401/403** — token scope missing. Re-run
  `gh auth refresh -s repo,security_events`.
- **`pnpm install` resolution conflict** — usually a peerDep
  upper-bound. Bump the peer alongside the override.
- **Soak guard refuses** — emergency CVE patches need
  `Allow minimumReleaseAge bypass` typed verbatim by the user.
- **Check fails after fix** — revert that one commit
  (`git reset --soft HEAD~1`, undo edits in `package.json`), log
  the regression, continue to next alert.
