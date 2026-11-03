#!/usr/bin/env bash
# Runs the dotnet tool's listing modes on the basic solution with one .NET SDK
# and asserts they evaluate projects without restoring anything: --workspaces
# lists the solution's built members and the projects they reference (an inner
# build's too), --members only the built members, minus --exclude-paths.
#
# Usage: smoke-test-workspaces.sh <dotnet> [sdk-version]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DOTNET="${1:?usage: smoke-test-workspaces.sh <dotnet> [sdk-version]}"
SDK="${2:-}"
# shellcheck source=SCRIPTDIR/lib.sh
. "$HERE/lib.sh"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
copy_fixture "$WORK" basic
pin_sdk "$WORK" "$SDK"
echo "+ dotnet SDK $SDK_VERSION (workspaces)"

tool() {
  run_tool "$WORK/basic" --records "$WORK/$1.tsv" --entry Basic.sln "${@:2}"
}
tool workspaces --workspaces
tool members --members
tool members-excluded --members --exclude-paths '^(?:test)(?:/.*)?$'

python3 - "$WORK" <<'PY'
import os, sys
work = sys.argv[1]
errors = []
def rows(name):
    return [l.rstrip('\n').split('\t') for l in open(os.path.join(work, name + '.tsv')) if l.strip()]
def check(name, allowed, kind, expected):
    got = []
    for r in rows(name):
        if r[0] not in allowed:
            errors.append(f"{name}: unexpected record kind {r[0]!r}; listing never restores")
        elif r[0] == kind:
            got.append(r[1] if kind == 'member' else (r[1], r[3]))
    if sorted(got) != sorted(expected):
        errors.append(f"{name}: {kind} records {sorted(got)} != {sorted(expected)}")

# Nuke is in the solution but not built by its active configuration.
check('workspaces', {'meta', 'buildRoot', 'entry', 'project', 'projectBuild'}, 'project', [
    ('src/App/App.csproj', 'App'),
    ('src/Lib/Lib.csproj', 'Acme.Lib'),
    ('test/App.Tests/App.Tests.csproj', 'App.Tests'),
    # Referenced only by Lib's net6.0 inner build.
    ('src/Extra/Extra.csproj', 'Extra'),
])
builds = {(r[1], r[2]) for r in rows('workspaces') if r[0] == 'projectBuild'}
for key in ('src/App/App.csproj', 'src/Lib/Lib.csproj', 'test/App.Tests/App.Tests.csproj', 'src/Extra/Extra.csproj'):
    if (key, key) not in builds:
        errors.append(f"workspaces: {key} has no projectBuild record of its own file")
check('members', {'meta', 'buildRoot', 'entry', 'member'}, 'member',
      ['src/App/App.csproj', 'src/Lib/Lib.csproj', 'test/App.Tests/App.Tests.csproj'])
check('members-excluded', {'meta', 'buildRoot', 'entry', 'member'}, 'member',
      ['src/App/App.csproj', 'src/Lib/Lib.csproj'])
if any('obj' in dirs for _, dirs, _ in os.walk(os.path.join(work, 'basic'))):
    errors.append("an obj/ directory was written; listing must not restore")

if errors:
    print("FAIL:")
    for e in errors: print("  -", e)
    sys.exit(1)
print("PASS: listings evaluate the solution's built projects without restoring")
PY
