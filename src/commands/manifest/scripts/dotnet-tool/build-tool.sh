#!/usr/bin/env bash
# Builds the socket-facts-dotnet tool into ./publish, which the rollup dist
# build copies to dist/manifest-scripts/dotnet-tool. Requires a .NET 8+ SDK.
set -euo pipefail

cd "$(dirname "$0")"
# Publish into a fresh dir and swap it in, so no stale file survives.
staging="$(mktemp -d "${TMPDIR:-/tmp}/socket-facts-dotnet.XXXXXX")"
dotnet restore socket-facts-dotnet.csproj --locked-mode --nologo -v quiet
dotnet publish socket-facts-dotnet.csproj -c Release -o "$staging" --no-restore --nologo -v quiet
rm -f "$staging"/*.pdb
if [ -d publish ]; then
  mv publish "$staging.old"
fi
mv "$staging" publish
echo "socket-facts-dotnet tool: $(pwd)/publish/socket-facts-dotnet.dll"
