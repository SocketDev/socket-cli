#!/usr/bin/env bash
# Builds the socket-facts-dotnet tool into ./publish, which the rollup dist
# build copies to dist/manifest-scripts/dotnet-tool. Requires a .NET 8+ SDK.
set -euo pipefail

cd "$(dirname "$0")"
# Publish into a fresh dir and swap, so stale artifacts never linger in
# publish/ without recursive deletes; the displaced old dir parks in the
# system temp dir, where the OS reclaims it.
staging="$(mktemp -d "${TMPDIR:-/tmp}/socket-facts-dotnet.XXXXXX")"
dotnet publish socket-facts-dotnet.csproj -c Release -o "$staging" --nologo -v quiet
if [ -d publish ]; then
  mv publish "$staging.old"
fi
mv "$staging" publish
# Trim non-runtime publish artifacts.
rm -f publish/*.pdb
echo "socket-facts-dotnet tool: $(pwd)/publish/socket-facts-dotnet.dll"
