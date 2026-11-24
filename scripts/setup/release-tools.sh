#!/usr/bin/env bash
# Install checksum-verified tools into a private runner directory. Compatibility
# test jobs select their matrix Node before calling this with --keep-node.
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
cd "$root"
node_version=$(tr -d '\r\n' < src/sea/.node-version)
# Windows jq can emit CRLF when invoked from Git Bash.
read_setting() { jq -er "$@" | tr -d '\r'; }
pnpm_version=$(read_setting '.packageManager | capture("^pnpm@(?<v>[0-9]+\\.[0-9]+\\.[0-9]+)$").v' package.json)
npm_version=$(read_setting '.npm.version' .config/release-tools.json)
[[ "$node_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.-]+)?$ ]]
[[ "$npm_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
case "${RUNNER_OS:?}" in
  Linux) os=linux ;;
  macOS) os=darwin ;;
  Windows) os=win32 ;;
  *) exit 1 ;;
esac
temp=${RUNNER_TEMP:?}
if [[ "$os" == win32 ]]; then temp=$(cygpath -u "$temp"); fi
dir=$(mktemp -d "$temp/socket-tools.XXXXXX")
bin="$dir/bin"
mkdir "$bin"
arch=$(echo "${RUNNER_ARCH:?}" | tr '[:upper:]' '[:lower:]')
check_sha256() {
  if command -v sha256sum >/dev/null; then sha256sum -c -; else shasum -a 256 -c -; fi
}
if [[ "${1:-}" != --keep-node ]]; then
  base="https://nodejs.org/dist/v$node_version"
  if [[ "$os" == win32 ]]; then archive="node-v$node_version-win-$arch.zip"; else archive="node-v$node_version-$os-$arch.tar.xz"; fi
  curl -fsSL "$base/SHASUMS256.txt" -o "$dir/sums"
  curl -fsSL "$base/$archive" -o "$dir/$archive"
  (cd "$dir" && awk -v file="$archive" '$2 == file { print; found++ } END { if (found != 1) exit 1 }' sums | check_sha256)
  if [[ "$os" == win32 ]]; then
    unzip -q "$dir/$archive" -d "$dir"
    node_bin="$dir/node-v$node_version-win-$arch"
  else
    tar -xJf "$dir/$archive" -C "$dir"
    node_bin="$dir/node-v$node_version-$os-$arch/bin"
  fi
  export PATH="$node_bin:$PATH"
  [[ "$(node -p 'process.versions.node' | tr -d '\r')" == "$node_version" ]]
fi
target="$os-$arch"
if [[ "$os" == win32 ]]; then ext=zip; else ext=tar.gz; fi
asset="pnpm-$target.$ext"
curl -fsSL "https://github.com/pnpm/pnpm/releases/download/v$pnpm_version/$asset" -o "$dir/$asset"
expected=$(read_setting --arg target "$target" '.pnpm[$target]' .config/release-tools.json)
(cd "$dir" && echo "$expected  $asset" | check_sha256)
if [[ "$os" == win32 ]]; then unzip -q "$dir/$asset" -d "$bin"; else tar -xzf "$dir/$asset" -C "$bin"; fi
curl -fsSL "https://registry.npmjs.org/npm/-/npm-$npm_version.tgz" -o "$dir/npm.tgz"
expected=$(read_setting '.npm.integrity' .config/release-tools.json)
actual=$(openssl dgst -sha512 -binary "$dir/npm.tgz" | openssl base64 -A)
[[ "sha512-$actual" == "$expected" ]]
mkdir "$bin/npm-cli"
tar -xzf "$dir/npm.tgz" --strip-components=1 -C "$bin/npm-cli"
for command in npm npx; do
  printf '#!/bin/sh\nexec node "$(dirname "$0")/npm-cli/bin/%s-cli.js" "$@"\n' "$command" > "$bin/$command"
  chmod +x "$bin/$command"
  if [[ "$os" == win32 ]]; then
    printf '%s\r\n' '@echo off' "node \"%~dp0npm-cli/bin/$command-cli.js\" %*" > "$bin/$command.cmd"
  fi
done
export PATH="$bin:$PATH"
[[ "$(pnpm --version | tr -d '\r')" == "$pnpm_version" && "$(npm --version | tr -d '\r')" == "$npm_version" ]]
runner_path() {
  if [[ "$os" == win32 ]]; then cygpath -w "$1"; else echo "$1"; fi
}
if [[ -n "${node_bin:-}" ]]; then runner_path "$node_bin" >> "$GITHUB_PATH"; fi
runner_path "$bin" >> "$GITHUB_PATH"
echo "Release tools: $(node --version), pnpm $pnpm_version, npm $npm_version"
