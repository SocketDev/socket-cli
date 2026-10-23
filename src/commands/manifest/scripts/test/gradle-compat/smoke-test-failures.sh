#!/usr/bin/env bash
# Run socket-facts.init.gradle against the `failures` project, whose configurations each fail to
# resolve in one way, and assert every failure is reported and no partial or fabricated component
# is emitted:
#  - a forced version that doesn't exist is reported as that version, not the one requested;
#  - a failed project dependency, and an external module sharing a project's group:name, are reported;
#  - an artifact failing dependency verification (Gradle 6.2+) is reported and has no file, a missing
#    checksum as non-blocking and a mismatch as blocking, and one whose report names no artifact
#    leaves the configuration unscannable but keeps its graph, without files;
#  - a module whose artifact can't be selected is reported with no component, with or without
#    --with-files;
#  - a walk that throws midway leaves no resolution root, only an unscannable configuration;
#  - a file that can't be read with an empty message is reported like any other.
#
# Usage: smoke-test-failures.sh /path/to/gradle
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
GRADLE="${1:?usage: smoke-test-failures.sh <path-to-gradle-binary>}"
INIT="$HERE/../../socket-facts.init.gradle"
CLASSIFY="$HERE/../../resolution-report-gradle.mts"
PROJECT="$HERE/failures"
RECORDS="$PROJECT/records.tsv"
# shellcheck source=SCRIPTDIR/../compat-cache.sh
. "$HERE/../compat-cache.sh"
GUH="$SOCKET_COMPAT_CACHE/gradle-home"

bash "$HERE/../make-stub-repo.sh" "$PROJECT/localrepo" \
  'demo:a:1.0+demo:c:1.0' 'demo:c:1.0' 'demo:boom:1.0+demo:c:1.0' 'demo:quiet:1.0' 'demo:tampered:1.0' 'demo:unlisted:1.0'

run() {
  rm -rf "$GUH" "$RECORDS" "$PROJECT/.gradle" "$PROJECT/build" "$PROJECT/lib/build" "$PROJECT/app/build"
  ( cd "$PROJECT" && "$GRADLE" --no-daemon --offline -g "$GUH" \
      --init-script "$INIT" -Porg.gradle.dependency.verification.console=verbose \
      -Psocket.recordsFile="$RECORDS" "$@" socketFacts -q ) > /dev/null
}

# The category the Socket CLI gives each failure record, as "config<TAB>coord<TAB>category" lines.
categories() {
  node --input-type=module -e '
    import { readFileSync } from "node:fs"
    import { classifyGradleFailure } from "'"$CLASSIFY"'"
    const unescape = v => v.replace(/\\(.)/g, (_, c) => ({ n: "\n", t: "\t", r: "\r" })[c] ?? c)
    for (const line of readFileSync(process.argv[1], "utf8").split("\n")) {
      const f = line.split("\t").map(unescape)
      if (f[0] === "failure") console.log([f[3], f[1], classifyGradleFailure(f[2])].join("\t"))
    }' "$RECORDS"
}

echo "+ $("$GRADLE" --version 2>/dev/null | sed -n 's/^Gradle //p' | head -1) (failures)"
for files in true false; do
  run -Psocket.withFiles="$files"
  categories > "$PROJECT/categories.tsv"
  python3 - "$RECORDS" "$files" "$PROJECT/categories.tsv" <<'PY'
import sys
rows = [l.rstrip('\n').split('\t') for l in open(sys.argv[1]) if l.strip()]
with_files = sys.argv[2] == 'true'
categories = {}
for l in open(sys.argv[3]):
    if l.strip():
        config, coord, category = l.rstrip('\n').split('\t')
        categories.setdefault((config, coord), set()).add(category)
version = next(r[2] for r in rows if r[0] == 'meta')
modern = tuple(int(p) for p in version.split('.')[:2]) >= (6, 2)
roots = {r[1]: r[3] for r in rows if r[0] == 'root'}
nodes = {(roots[r[1]], r[2]): r for r in rows if r[0] == 'node'}
files = {(roots[r[1]], r[2]) for r in rows if r[0] == 'file'}
unfetched = {(roots[r[1]], r[2]) for r in rows if r[0] == 'unfetched'}
failures = {(r[3], r[1]) for r in rows if r[0] == 'failure'}
unscannable = {r[1] for r in rows if r[0] == 'unscannable'}
errors = []

def expect(cond, msg):
    if not cond:
        errors.append(msg)

expect(('forced', 'demo:c:9.9') in failures, f"forced: missing failure for the forced demo:c:9.9: {sorted(failures)}")
expect(('forced', 'demo:c:1.0') not in failures, "forced: failure names the requested demo:c:1.0, not the attempted 9.9")
# Old Gradle fails the whole configuration instead of the one dependency.
expect(('projectFail', 'demo:lib:3.0') in failures or 'projectFail' in unscannable,
       f"projectFail: failed project dependency not reported: {sorted(failures)}")
expect(('shadowing', 'demo:lib:7.7') in failures, f"shadowing: external module sharing :lib's group:name not reported: {sorted(failures)}")
expect(not [n for n in nodes.values() if not n[6]], f"ext-less component emitted: {[n[2] for n in nodes.values() if not n[6]]}")
expect('walkAborted' in unscannable, f"walkAborted: walk that threw not reported unscannable: {sorted(unscannable)}")
expect('walkAborted' not in roots.values(), "walkAborted: partial tree of a walk that threw was emitted")
if modern:
    # Only some Gradle versions select legacy-API artifacts through the transforms; the others return
    # the untransformed jar. Either way, a module is emitted with an artifact or reported, never both.
    ambiguous = [k for k in nodes if k[0] == 'ambiguous']
    reported = ('ambiguous', 'demo:a:1.0') in failures
    expect(reported != bool(ambiguous), f"ambiguous: components {ambiguous}, reported={reported}")
    if reported:
        expect(categories[('ambiguous', 'demo:a:1.0')] == {'variant-ambiguity'},
               f"ambiguous: classified {categories[('ambiguous', 'demo:a:1.0')]}, not variant-ambiguity")

tampered = ('verified', 'demo:tampered:jar:1.0')
unlisted = ('verified', 'demo:unlisted:jar:1.0')
if with_files:
    expect(('quiet', 'demo:quiet:1.0') in failures, f"quiet: unreadable file not reported: {sorted(failures)}")
    expect(('quiet', 'demo:quiet:jar:1.0') in unfetched, f"quiet: unreadable file not marked unfetched: {sorted(unfetched)}")
    expect('quiet' not in unscannable, "quiet: unreadable file sank the whole configuration")
    expect(('verified', 'demo:a:jar:1.0') in files, f"verified: trusted demo:a has no file: {sorted(files)}")
    if modern:
        expect(('verified', 'demo:tampered:1.0') in failures, f"verified: verification failure not reported: {sorted(failures)}")
        expect(tampered in unfetched, f"verified: tampered jar not marked unfetched: {sorted(unfetched)}")
        expect(tampered not in files, "verified: tampered jar emitted as a file")
        expect(categories.get(('verified', 'demo:tampered:1.0')) == {'other'},
               f"verified: checksum mismatch not blocking: {categories.get(('verified', 'demo:tampered:1.0'))}")
        expect(unlisted in unfetched and unlisted not in files, "verified: unlisted jar not marked unfetched")
        expect(categories.get(('verified', 'demo:unlisted:1.0')) == {'checksum-missing'},
               f"verified: missing checksum not non-blocking: {categories.get(('verified', 'demo:unlisted:1.0'))}")
        expect('unparsed' in unscannable, f"unparsed: unparseable verification failure not reported: {sorted(unscannable)}")
        expect(('unparsed', 'demo:a:jar:1.0') in nodes, "unparsed: graph dropped for an unparseable verification failure")
        expect(('unparsed', 'demo:a:jar:1.0') in unfetched and ('unparsed', 'demo:a:jar:1.0') not in files,
               "unparsed: files kept despite an unparseable verification failure")
    else:
        expect(tampered in files, "verified: no verification before Gradle 6.2, so the jar must materialize")
else:
    expect(not files and not unfetched, "file or unfetched record emitted without --with-files")

if errors:
    print("FAIL:")
    for e in errors: print("  -", e)
    sys.exit(1)
print(f"PASS (failures, withFiles={sys.argv[2]}): every failure reported, no partial or fabricated component")
PY
  python3 "$HERE/../assert-reachability.py" "$RECORDS"
done
