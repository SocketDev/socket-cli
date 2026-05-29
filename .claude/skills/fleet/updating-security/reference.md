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
  → DIRECT-FIX:   bump the catalog pin (or package.json) to the
                  resolved pin version (see "Pin target" below)

relationship == "transitive" && first_patched_version != null
  → OVERRIDE-FIX: add an EXACT pin to `overrides:` in
                  pnpm-workspace.yaml (see "Pin target" below)

first_patched_version == null
  → DISMISS:      gh api .../alerts/N -X PATCH \
                    -f state=dismissed -f dismissed_reason=no_bandwidth \
                    -f dismissed_comment="<one-liner>"

soak gate hits the pin version
  → AWAITING-SOAK: skip; report in summary; do NOT modify
```

## Pin target — highest soaked, same major as first_patched

### Sources & precedence

When figuring out what's patched and what else changed, the sources
rank — they routinely disagree:

1. **GitHub Security Advisory** (`gh api securityAdvisory(ghsaId:…)` or
   the alert's `security_vulnerability.first_patched_version`) — ground
   truth for WHICH versions clear the CVE. Maintainers backport across
   several release lines; trust this list of patched versions.
2. **Per-version GitHub Releases / git tags** — what shipped in a
   specific version, even one the CHANGELOG skipped.
3. **CHANGELOG.md / HISTORY.md** — narrative of changes, but written on
   `main`; a backport cut on a maintenance branch may be absent.

**Why this order (real incident, uuid GHSA-w5hq-g745-h8pq):** the
advisory listed three backported patched lines — 11.1.1, 12.0.1,
13.0.1 — but the `main` CHANGELOG jumped 11.1.0 → 12.0.0 and only
documented the fix under 14.0.0. A reader trusting the CHANGELOG alone
would have concluded the only fix was in 14.x and needlessly crossed
two majors. The advisory said `first_patched = 11.1.1` for our range,
and that's what we pinned.

### Resolve the pin

🚨 Do NOT pin to `^<first_patched>` or `>=<first_patched>`. The fleet
pins EXACT versions everywhere (`uuid: 11.1.1`, never `^11.1.1`) —
ranges let a non-frozen `pnpm install` slide to an un-soaked release,
defeating both determinism and the malware soak. Resolve the pin like
this:

1. Take `first_patched_version` (e.g. `11.1.1`). Note its major (`11`).
2. Keep only stable releases ≥ `first_patched_version` in that major
   AND past the 7-day soak (publish date ≥ 7 days ago — see "Soak-gate
   interaction"). Pre-releases (`-rc`, `-beta`, `-alpha`, `-next`,
   `-canary`) are NEVER pin targets; a security pin lands on a stable
   line only.
3. Pin to the HIGHEST survivor. Usually that's `first_patched` itself;
   it's higher only when a newer in-major patch has since soaked.
4. **If no stable in-major target exists** (the fix shipped only in a
   higher major, so the in-major filter is empty), the major bump IS
   the path — not an exception to dodge. Run the AI benignity check
   below; if it returns BENIGN, pin to the highest stable release in
   the target major and announce it. Only a BREAKING / unavailable /
   ambiguous verdict falls back to asking the user.

🚨 Do the semver work with socket-lib's `versions/*` helpers, never
hand-rolled regex or `sort -V` (off-by-one on pre-release / build
metadata is the classic bug). `filterVersions` drops pre-releases by
default, so a pin can never land on an `-rc`. socket-lib ships the
full set: `@socketsecurity/lib/versions/parse` (`getMajorVersion`,
`parseVersion`, `isValidVersion`, `coerceVersion`),
`@socketsecurity/lib/versions/range` (`filterVersions`, `maxVersion`,
`minVersion`, `satisfiesVersion`), `@socketsecurity/lib/versions/compare`
(`gt`/`gte`/`sort`/`rsort`). It does NOT ship a registry-version
fetcher — get the candidate list with `npm view <pkg> versions --json`
(or `httpJson` to the registry), then resolve in code:

```ts
import { getMajorVersion } from '@socketsecurity/lib/versions/parse'
import { filterVersions, maxVersion } from '@socketsecurity/lib/versions/range'

// `published` = registry versions (npm view) already filtered to
// publish-date ≥ 7 days ago (the soak gate). filterVersions also
// drops pre-releases, so `-rc`/`-beta` can never be selected.
const major = getMajorVersion(firstPatched) // 11
const inMajor = filterVersions(published, `>=${firstPatched} <${major + 1}.0.0`)
let pinTarget = maxVersion(inMajor)
if (!pinTarget) {
  // No stable in-major fix. Run the AI benignity check (next section);
  // on BENIGN, take the highest stable release ≥ first_patched in the
  // higher major where the fix shipped.
  const crossMajor = filterVersions(published, `>=${firstPatched}`)
  pinTarget = maxVersion(crossMajor) ?? firstPatched
}
```

`filterVersions` drops pre-releases and applies the range; `maxVersion`
picks the highest. The `<${major + 1}.0.0` upper bound is what keeps
the pin in-major — crossing a major is the separate gated path below.

5. **Crossing a major needs an AI benignity check + a user notice.**
   If no in-major patched release exists (the fix lives only in a
   higher major — e.g. the dep's `9.x`/`10.x` lines were never
   patched and only `11.x+` carries the fix), classify the bump with
   socket-lib's locked-down AI helper before crossing:

   ```ts
   import { spawnAiAgent } from '@socketsecurity/lib-stable/ai/spawn'

   // Lockdown per CLAUDE.md "Programmatic Claude calls": all four
   // flags set, never `default`/`bypassPermissions`.
   const res = await spawnAiAgent({
     prompt:
       `Determine what changed in npm package "${pkg}" between major ` +
       `${fromMajor} and the patched version ${target}. Consult, in ` +
       `this order: (1) the GitHub Security Advisory for the CVE — it ` +
       `is the ground truth for WHICH versions are patched (maintainers ` +
       `often backport a fix to several release lines, and the main ` +
       `CHANGELOG may only mention the latest); (2) the per-version ` +
       `GitHub Releases pages; (3) the repo CHANGELOG.md / HISTORY.md. ` +
       `If the CHANGELOG skips the patched version (it was a backport ` +
       `cut on a maintenance branch), trust the advisory + the git tag ` +
       `for that version, not the CHANGELOG's omission. Our consumer ` +
       `calls only: ${apiSurfaceUsed}.\n\n` +
       `Our runtime floor is Node ${nodeFloor} (from package.json ` +
       `engines.node). The bar for whether a Node-floor change is ` +
       `breaking is the official release schedule at ` +
       `https://nodejs.org/en/about/previous-releases — a dep dropping ` +
       `Node versions that are already EOL (past their Maintenance ` +
       `window) is benign by definition; what matters is whether the ` +
       `dep's NEW floor is still within a Node line that is Active LTS, ` +
       `Maintenance, or Current AND <= the Node WE run.\n\n` +
       `Classify the breaking changes. Answer STRICTLY one word on the ` +
       `first line:\n` +
       `  BENIGN  — every breaking-change bullet is one of: a Node-floor ` +
       `raise whose new floor is STILL AT OR BELOW the Node we run AND ` +
       `is a currently-supported line per the schedule above (dropping ` +
       `already-EOL Node is always benign); ESM-only packaging, ` +
       `"remove CommonJS support", or "make browser exports default" ` +
       `(on Node >=22 the unflagged require(esm) support loads the ESM ` +
       `build transparently, so CJS removal does not break a require() ` +
       `caller); a TypeScript port; or removed deep-import subpaths. ` +
       `New methods added = additive, not breaking. A SECURITY FIX is ` +
       `never breaking — hardening input validation (e.g. now throwing ` +
       `on an out-of-bounds / malformed input that previously corrupted ` +
       `silently) only rejects inputs that were already exploiting the ` +
       `bug; correct callers are unaffected. NONE of the methods we ` +
       `call had a break in PREVIOUSLY-CORRECT usage.\n` +
       `  BREAKING — a bullet changes the signature, return type, or ` +
       `documented behavior of a method we call in a way that breaks ` +
       `code that was already CORRECT (NOT counting the security fix ` +
       `itself); OR it raises the Node floor ABOVE the Node we run; OR ` +
       `removes CJS while our floor is Node <22; OR you cannot find the ` +
       `release notes to be sure.\n\n` +
       `Then ONE line of justification quoting the deciding bullet(s). ` +
       `When uncertain, choose BREAKING — a wrong BENIGN ships a silent ` +
       `behavior change; a wrong BREAKING just asks the user.`,
     disallow: ['Edit', 'Write', 'Bash'], // read-only classification
     allow: ['WebFetch', 'WebSearch'],
     permissionMode: 'dontAsk',
   })
   ```

   `apiSurfaceUsed` = the methods the consuming code actually imports
   (grep the transitive consumer, e.g. gaxios → `uuid.v4`). Narrowing
   the surface lets the classifier ignore a breaking change in a
   method nobody calls.

   `nodeFloor` = our `engines.node` (the fleet floors at `>=26.0.0`).
   This is what makes "remove CommonJS support" benign: Node ≥22 ships
   unflagged `require(esm)` (synchronous `require()` of an ESM module),
   so a CJS-removing major still loads via `require('pkg')`. CJS
   removal is only BREAKING when the floor is Node <22.
   - `BENIGN` → cross the major, pin to the highest soaked release in
     the TARGET major, and **report it in the Phase-8 summary**
     ("crossed uuid 9.x→11.x — AI-classified ESM-only, no API break").
     The user sees it landed; they did not have to approve it inline.
   - `BREAKING` (or the AI is unavailable / ambiguous) → do NOT cross.
     Surface via `AskUserQuestion` for explicit human signoff.

   Never cross a major silently — a BENIGN cross is auto-applied but
   always announced; a BREAKING cross always asks first.

### Worked example — uuid, and why the classification is per-consumer

`uuid` shows that "benign across majors" is **conditional**, not a
blanket. The advisory (GHSA-w5hq-g745-h8pq) has THREE patched lines —
the fix was backported, not landed only on latest:

| Vulnerable range      | First patched |
| --------------------- | ------------- |
| `< 11.1.1`            | `11.1.1`      |
| `>= 12.0.0, < 12.0.1` | `12.0.1`      |
| `>= 13.0.0, < 13.0.1` | `13.0.1`      |

(and 14.0.0 ships it too). Our 9.0.1 falls in the `< 11.1.1` range,
so `first_patched = 11.1.1` and the resolver pins there — no major
cross needed at all.

The CVE fix itself is a **behavior change to `v3()`/`v5()`/`v6()`**:
they used to silently write out of a too-small caller buffer; now they
throw `RangeError`. That guard is in EVERY patched release
(11.1.1 / 12.0.1 / 13.0.1 / 14.0.0). **It is a fix, not a breaking
change** — and that distinction is the important one for the
classifier:

- The OLD behavior (silent out-of-bounds write) WAS the vulnerability.
  A legitimate caller that passes a correctly-sized buffer never hit
  it and sees no change. The only callers that now get a `RangeError`
  are the ones that were already triggering the memory-corruption bug
  — i.e. were already broken. Making invalid input fail loudly instead
  of corrupting memory does not break correct code; it is the point of
  the advisory.
- So a security fix that hardens input validation is NEVER counted as
  a breaking change, regardless of which method it touches or whether
  you call that method. Don't put it in the major-cross BREAKING
  column. The classifier's question is strictly: does crossing a major
  introduce a break in code that was previously CORRECT?
- (Our path is gaxios → `uuid.v4()`, which the guard doesn't even
  touch — but the point stands for v3/v5/v6 callers too.)

The per-major breaking surface, scored for a Node-26, `v4()`-only
consumer (CHANGELOG bullets verified against
`raw.githubusercontent.com/uuidjs/uuid/main/CHANGELOG.md`):

| Major  | "Breaking" bullets (from CHANGELOG)              | Adds a break BEYOND the CVE fix, for v4()-only on Node 26?                    |
| ------ | ------------------------------------------------ | ----------------------------------------------------------------------------- |
| 10.0.0 | drop node@12/14                                  | No — floor drop ≤ ours; v6/v7/v8 additive                                     |
| 11.0.0 | drop node@16, TS port, ESM (dual CJS)            | No                                                                            |
| 12.0.0 | drop node@16, **remove CommonJS**                | No — Node ≥22 `require(esm)` loads the ESM build                              |
| 13.0.0 | make browser exports default                     | No — packaging priority only                                                  |
| 14.0.0 | drop node@18, `crypto` must be global (node@20+) | No — floor drop ≤ ours. (The RangeError guard is the CVE fix, never a break.) |

Three things this teaches the classifier:

1. **Node-floor changes are measured against the Node release
   schedule AND our floor.** Use
   [nodejs.org/en/about/previous-releases](https://nodejs.org/en/about/previous-releases)
   as the bar: dropping an already-EOL Node line is always benign;
   what matters is whether the dep's NEW floor is a still-supported
   line (Active LTS / Maintenance / Current) AND ≤ the Node we run.
   All uuid majors here drop Node lines at or below our floor — fine.
   A major that required a Node newer than ours, or that's not yet a
   released line, would be BREAKING for us.
2. **"Remove CommonJS" is benign on Node ≥22** (unflagged
   `require(esm)`), which is the whole fleet. It would be BREAKING on
   an older floor.
3. **A security fix is never a breaking change.** Hardening input
   validation (uuid's silent-write → `RangeError` on a bad buffer)
   only rejects inputs that were already exploiting the bug; correct
   callers are unaffected. Don't weigh the fix itself as a break — the
   major-cross question is solely whether crossing introduces a break
   in PREVIOUSLY-CORRECT code. Still pass `apiSurfaceUsed` so the
   classifier ignores genuine breaks in methods nobody calls.

For THIS alert the resolver pins `11.1.1` (first_patched's major is
11; the resolver never looks past it), so none of the 12/13/14
nuance even comes into play — the cross-major AI check only fires
when NO in-major patched release exists. The table is here to show
the classifier what the benign-vs-breaking line looks like in
practice.

Resolver (paste-ready):

```bash
PKG=uuid; FIRST_PATCHED=11.1.1
MAJOR="${FIRST_PATCHED%%.*}"
npm view "$PKG" time --json | python3 -c "
import sys,json,datetime
t=json.load(sys.stdin); now=datetime.datetime.now(datetime.timezone.utc)
fp='$FIRST_PATCHED'; major='$MAJOR'
def key(v): return [int(x) for x in v.split('.')]
ok=[]
for v,ts in t.items():
    if not v.split('.')[0].isdigit() or v.split('.')[0]!=major or '-' in v: continue
    if key(v) < key(fp): continue
    age=(now-datetime.datetime.fromisoformat(ts.replace('Z','+00:00'))).days
    if age>=7: ok.append((key(v),v))
print(sorted(ok)[-1][1] if ok else 'NONE-IN-MAJOR-SOAKED')
"
```

`NONE-IN-MAJOR-SOAKED` → either the only fix is in a higher major
(human signoff) or the in-major fix is still soaking (AWAITING-SOAK).

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

🚨 Fleet overrides live in **`pnpm-workspace.yaml`** under the
top-level `overrides:` key — NOT `package.json` `pnpm.overrides`. And
they are **exact pins**, not ranges (see "Pin target" above). Add a
`# Security: GHSA-… — <one-line why> … <relationship/path>` comment
above each entry so the next reader knows why it's there and when it
can be removed (CVE fixed upstream → consumer bumps → override is dead
weight):

```yaml
overrides:
  '@socketsecurity/lib': 'catalog:'
  vite: 'catalog:'
  # Security: GHSA-w5hq-g745-h8pq (medium) — uuid <11.1.1 missing
  # buffer-bounds check in v3/v5/v6. Transitive via gaxios (dev-only).
  # Exact pin per fleet convention; v4() API unchanged 9→11.
  uuid: 11.1.1
```

Then:

```bash
pnpm install                 # refreshes the lockfile
pnpm install --frozen-lockfile   # confirms the lockfile is consistent
```

The lockfile updates to pin every transitive consumer to the exact
patched version. The CVE clears on the next Dependabot rescan
(typically minutes after push).

> **The override is temporary.** Once the direct consumer (`gaxios` in
> the uuid case) bumps its own dependency past the vulnerable range,
> the override is dead weight. `taze` understands `pnpm-workspace.yaml`
> overrides and will offer to bump or surface them during the weekly
> `updating` run — use `taze minor` so a stale override doesn't get
> floated across a major. Re-audit overrides periodically and drop the
> ones whose underlying CVE is resolved upstream.

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
chore(security): override postcss to 8.5.10 (GHSA-qx2v-qp2m-jg93)

CVE-2026-41305 — XSS via unescaped </style> in CSS stringify.
Transitive dependency; added an exact pin to `overrides:` in
pnpm-workspace.yaml (highest soaked 8.x — no major cross). Lockfile
refreshed.
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
