#!/usr/bin/env bash
# Runs the built CLI's `socket manifest dotnet` over the fixtures with one .NET
# SDK and checks the facts against `dotnet list package` and assert-facts.py.
#
# Usage: smoke-test.sh <dotnet> [sdk-version]
#   sdk-version pins the SDK with a global.json, as a project would.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DOTNET="${1:?usage: smoke-test.sh <dotnet> [sdk-version]}"
SDK="${2:-}"
REPO="$(cd "$HERE/../../../../../.." && pwd)"
CLI="$REPO/bin/cli.js"
TOOL="$REPO/dist/manifest-scripts/dotnet-tool/socket-facts-dotnet.dll"
# shellcheck source=SCRIPTDIR/../compat-cache.sh
. "$HERE/../compat-cache.sh"

if [ ! -f "$TOOL" ]; then
  echo "dotnet tool not built: run pnpm run build:dotnet-tool && pnpm build:dist:src" >&2
  exit 1
fi

export NUGET_PACKAGES="$SOCKET_COMPAT_CACHE/nuget-packages"
export NUGET_HTTP_CACHE_PATH="$SOCKET_COMPAT_CACHE/nuget-http"
export DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1 DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1
# Stubs are regenerated per run under the same versions, so no stale copy
# may survive in the package folder.
rm -rf "$NUGET_PACKAGES"/demo.* "$NUGET_PACKAGES"/runtime.win-x64.demo.*

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
# A copy per run keeps obj/, lock files and global.json out of the source tree.
( cd "$HERE" && find . -type f \
    -not -path '*/obj/*' -not -path '*/bin/*' -not -path './stub-feed/*' \
    -not -name '*.socket.facts.json' -not -name 'packages.lock.json' \
    -exec sh -c 'mkdir -p "$1/$(dirname "$2")" && cp "$2" "$1/$2"' _ "$WORK" {} \; )
python3 "$HERE/make-stub-feed.py" "$WORK/stub-feed" \
  'Demo.Ext.Tool:1.0.0+Demo.Ext.Shared:1.0.0' \
  'Demo.Ext.Shared:1.0.0' \
  'Demo.Ext.Shared:2.0.0' \
  'Demo.Ext.Logging:1.0.0+Demo.Ext.Shared:1.0.0' \
  'Demo.Ext.Harness:1.0.0+Demo.Ext.HarnessCore:1.0.0' \
  'Demo.Ext.Harness:1.1.0+Demo.Ext.HarnessCore:1.0.0' \
  'Demo.Ext.HarnessCore:1.0.0' \
  'Demo.Ext.TestSdk:1.0.0#test' \
  'Demo.Ext.Analyzer:1.0.0#analyzer' \
  'Demo.Ext.Payload:1.0.0#payload' \
  'Demo.Ext.BuildTool:1.0.0#buildtool' \
  'Demo.Ext.Floating:1.0.0' \
  'Demo.Ext.Floating:1.1.0' \
  'Demo.Ext.Native:1.0.0#runtime=win-x64' \
  'runtime.win-x64.Demo.Ext.Native:1.0.0#rid=win-x64'
if [ -n "$SDK" ]; then
  printf '{"sdk": {"version": "%s", "rollForward": "disable"}}\n' "$SDK" > "$WORK/global.json"
fi
SDK_VERSION="$(cd "$WORK" && "$DOTNET" --version)"
echo "+ dotnet SDK $SDK_VERSION"

socket_dotnet() {
  node "$CLI" manifest dotnet --bin "$DOTNET" "$@"
}
expect_fail() {
  local log="$WORK/fail.log"
  if socket_dotnet "$@" >"$log" 2>&1; then
    cat "$log"
    echo "expected failure: socket manifest dotnet $*" >&2
    exit 1
  fi
  cat "$log"
}

# .slnx needs SDK 9.0.200; older SDKs build the solution's top project.
CPM_ENTRY="cpm/Cpm.slnx"
python3 -c 'import sys; v=[int(x) for x in sys.argv[1].split("-")[0].split(".")]; sys.exit(0 if (v[0], v[2]) >= (9, 200) else 1)' "$SDK_VERSION" \
  || CPM_ENTRY="cpm/src/Api/Api.csproj"

socket_dotnet "$WORK/basic"
socket_dotnet "$WORK/$CPM_ENTRY"
# The lock files the first restore wrote now pin the second.
socket_dotnet "$WORK/$CPM_ENTRY" --dotnet-opts=--locked-mode
socket_dotnet "$WORK/rid"
socket_dotnet "$WORK/packages-config"
socket_dotnet "$WORK/langs/Vb/Vb.vbproj"
socket_dotnet "$WORK/multi"
socket_dotnet "$WORK/pair"
socket_dotnet "$WORK/dev"
# Recursive discovery, configured through socket.json: a solution in a
# sibling folder covers its projects.
printf '{"version": 1, "defaults": {"manifest": {"dotnet": {"bin": "%s"}}}}\n' "$DOTNET" > "$WORK/sibling/socket.json"
node "$CLI" manifest dynamic-sbom-inference "$WORK/sibling"
expect_fail "$WORK/failures/missing" > "$WORK/missing.log"
expect_fail "$WORK/failures/broken" > "$WORK/broken.log"
python3 "$HERE/assert-facts.py" "$WORK" "$SDK_VERSION" "$CPM_ENTRY"

if python3 -c 'import sys; v=[int(x) for x in sys.argv[1].split("-")[0].split(".")]; sys.exit(0 if (v[0], v[2]) >= (7, 200) else 1)' "$SDK_VERSION"; then
  # `dotnet list package` reports no runtime-specific targets.
  for entry in basic/Basic.sln "$CPM_ENTRY" langs/Vb/Vb.vbproj multi/One.sln multi/Two.sln multi/Stray.csproj; do
    socket_dotnet "$WORK/$entry" --exclude-configs '*/*' >/dev/null 2>&1
    ( cd "$WORK" && python3 "$HERE/assert-dotnet-list.py" "$entry.socket.facts.json" "$entry" "$DOTNET" )
  done
fi

# Option handling, on fresh copies of the facts.
socket_dotnet "$WORK/basic" --exclude-paths test
python3 "$HERE/assert-facts.py" "$WORK" "$SDK_VERSION" "$CPM_ENTRY" exclude-paths
socket_dotnet "$WORK/basic" --include-configs net6.0
python3 "$HERE/assert-facts.py" "$WORK" "$SDK_VERSION" "$CPM_ENTRY" include-configs
socket_dotnet "$WORK/failures/missing" --ignore-unresolved
python3 "$HERE/assert-facts.py" "$WORK" "$SDK_VERSION" "$CPM_ENTRY" ignore-unresolved

# --with-files: the records the reachability sidecar is built from.
records() {
  # A preview SDK's MSBuild needs a preview runtime (see run.mts).
  ( cd "$(dirname "$1")" && case "$SDK_VERSION" in *-*) export DOTNET_ROLL_FORWARD_TO_PRERELEASE=1 ;; esac
    "$DOTNET" "$TOOL" --records "$2" --entry "$1" --dotnet "$DOTNET" --with-files >/dev/null )
}
records "$WORK/basic/Basic.sln" "$WORK/basic.tsv"
records "$WORK/langs/Vb/Vb.vbproj" "$WORK/langs.tsv"
records "$WORK/failures/designtime/DesignTime.csproj" "$WORK/designtime.tsv"
records "$WORK/packages-config/Mixed.sln" "$WORK/pc-missing.tsv"
# What `nuget restore` lays out for packages.config: <Id>.<Version as written>.
python3 - "$WORK" <<'PY'
import os, sys, zipfile
work = sys.argv[1]
for pkg_id, version, folder in (('Demo.Ext.Tool', '1.0.0', '1.0.0'), ('Demo.Ext.Shared', '1.0.0', '1.0'), ('Demo.Ext.Analyzer', '1.0.0', '1.0.0')):
    nupkg = os.path.join(work, 'stub-feed', f'{pkg_id.lower()}.{version}.nupkg')
    zipfile.ZipFile(nupkg).extractall(os.path.join(work, 'packages-config', 'packages', f'{pkg_id}.{folder}'))
PY
records "$WORK/packages-config/Mixed.sln" "$WORK/pc-present.tsv"
python3 "$HERE/assert-facts.py" "$WORK" "$SDK_VERSION" "$CPM_ENTRY" records

echo "dotnet compat smoke test passed: SDK $SDK_VERSION"
