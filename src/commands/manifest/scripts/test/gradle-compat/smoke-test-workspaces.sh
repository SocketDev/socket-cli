#!/usr/bin/env bash
# Run socket-workspaces.init.gradle (the lightweight workspace-enumeration sibling of
# socket-facts.init.gradle) against the smoke project and assert it emits exactly the expected
# project record - no dependency resolution, no node/root/file records at all. Guards, across the
# same Gradle compat matrix as the facts script, that the socketWorkspaces task registers and runs
# cleanly.
#
# Usage: smoke-test-workspaces.sh /path/to/gradle
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
GRADLE="${1:?usage: smoke-test-workspaces.sh <path-to-gradle-binary>}"
INIT="$HERE/../../socket-workspaces.init.gradle"
PROJECT="$HERE/project"
GUH="$HERE/.gradle-home"   # isolated Gradle user home -> hermetic, no global init scripts
RECORDS="$PROJECT/workspaces-records.tsv"

rm -rf "$GUH" "$RECORDS" "$PROJECT/.gradle" "$PROJECT/build"

echo "+ $("$GRADLE" --version 2>/dev/null | sed -n 's/^Gradle //p' | head -1) (workspaces)"
( cd "$PROJECT" && "$GRADLE" --no-daemon --offline -g "$GUH" \
    --init-script "$INIT" -Psocket.recordsFile="$RECORDS" socketWorkspaces -q )

python3 - "$RECORDS" <<'PY'
import sys
rows = [l.rstrip('\n').split('\t') for l in open(sys.argv[1]) if l.strip()]
errors = []
tool = None
projects = []
for r in rows:
    if r[0] == 'meta':
        tool = r[1]
    elif r[0] == 'project':
        projects.append(r)
    else:
        errors.append(f"unexpected record kind {r[0]!r} - workspaces must never resolve dependencies")

if tool != 'gradle':
    errors.append(f"meta tool {tool!r} != 'gradle'")
if len(projects) != 1:
    errors.append(f"expected exactly 1 project record, got {len(projects)}: {projects}")
else:
    _, path, group, name, _version, dir_ = projects[0]
    if path != ':': errors.append(f"root project path {path!r} != ':'")
    if group != 'demo': errors.append(f"root project group {group!r} != 'demo'")
    if name != 'gradle-compat-smoke': errors.append(f"root project name {name!r} != 'gradle-compat-smoke'")
    if dir_ != '.': errors.append(f"root project dir {dir_!r} != '.'")

if errors:
    print("FAIL:")
    for e in errors: print("  -", e)
    sys.exit(1)
print("PASS: tool=gradle; 1 project record, no dependency-resolution records")
PY
