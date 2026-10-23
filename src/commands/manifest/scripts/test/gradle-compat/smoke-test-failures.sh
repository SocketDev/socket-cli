#!/usr/bin/env bash
# Run socket-facts.init.gradle against the `failures` project, whose configurations each fail to
# resolve in one way, and assert every failure is reported and no partial or fabricated component
# is emitted:
#  - a forced version that doesn't exist is reported as that version, not the one requested;
#  - a failed project dependency, and an external module sharing a project's group:name, are reported;
#  - an artifact failing dependency verification (Gradle 6.2+) is reported and has no file;
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
PROJECT="$HERE/failures"
RECORDS="$PROJECT/records.tsv"
# shellcheck source=SCRIPTDIR/../compat-cache.sh
. "$HERE/../compat-cache.sh"
GUH="$SOCKET_COMPAT_CACHE/gradle-home"

bash "$HERE/../make-stub-repo.sh" "$PROJECT/localrepo" \
  'demo:a:1.0+demo:c:1.0' 'demo:c:1.0' 'demo:boom:1.0+demo:c:1.0' 'demo:quiet:1.0' 'demo:tampered:1.0'

run() {
  rm -rf "$GUH" "$RECORDS" "$PROJECT/.gradle" "$PROJECT/build" "$PROJECT/lib/build" "$PROJECT/app/build"
  ( cd "$PROJECT" && "$GRADLE" --no-daemon --offline -g "$GUH" \
      --init-script "$INIT" -Psocket.recordsFile="$RECORDS" "$@" socketFacts -q ) > /dev/null
}

echo "+ $("$GRADLE" --version 2>/dev/null | sed -n 's/^Gradle //p' | head -1) (failures)"
for files in true false; do
  run -Psocket.withFiles="$files"
  python3 - "$RECORDS" "$files" <<'PY'
import sys
rows = [l.rstrip('\n').split('\t') for l in open(sys.argv[1]) if l.strip()]
with_files = sys.argv[2] == 'true'
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

tampered = ('verified', 'demo:tampered:jar:1.0')
if with_files:
    expect(('quiet', 'demo:quiet:1.0') in failures, f"quiet: unreadable file not reported: {sorted(failures)}")
    expect(('quiet', 'demo:quiet:jar:1.0') in unfetched, f"quiet: unreadable file not marked unfetched: {sorted(unfetched)}")
    expect('quiet' not in unscannable, "quiet: unreadable file sank the whole configuration")
    expect(('verified', 'demo:a:jar:1.0') in files, f"verified: trusted demo:a has no file: {sorted(files)}")
    if modern:
        expect(('verified', 'demo:tampered:1.0') in failures, f"verified: verification failure not reported: {sorted(failures)}")
        expect(tampered in unfetched, f"verified: tampered jar not marked unfetched: {sorted(unfetched)}")
        expect(tampered not in files, "verified: tampered jar emitted as a file")
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
