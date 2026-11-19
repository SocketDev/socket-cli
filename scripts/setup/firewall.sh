#!/usr/bin/env bash
# Install the verified Socket Firewall and wrap the package managers present on this runner.
set -euo pipefail

version=1.16.0
commands=(npm yarn pnpm pip uv cargo)
if [[ -n "${SOCKET_API_KEY:-}" ]]; then
  repo=SocketDev/firewall-release
  prefix=sfw
  commands+=(gem bundler nuget)
  [[ "$RUNNER_OS" != Linux ]] || commands+=(go)
else
  repo=SocketDev/sfw-free
  prefix=sfw-free
fi

case "$RUNNER_OS-$RUNNER_ARCH" in
  Linux-X64) target=linux-x86_64 ;;
  Linux-ARM64) target=linux-arm64 ;;
  macOS-X64) target=macos-x86_64 ;;
  macOS-ARM64) target=macos-arm64 ;;
  Windows-X64) target=windows-x86_64.exe ;;
  *) echo "Unsupported Socket Firewall target: $RUNNER_OS-$RUNNER_ARCH" >&2; exit 1 ;;
esac
asset="$prefix-$target"
case "$asset" in
  sfw-linux-x86_64) digest=9c5e77a2c08683c3cca7c5fba9d380c7acca7ed6ea71c0d3919b2a723bea34b3 ;;
  sfw-linux-arm64) digest=945708d9907f4702d91d341647576aae667ad0c411cd9c02a4f56b130512695c ;;
  sfw-macos-x86_64) digest=9b6faa3c4cb5d2cbbea7bad5c7a47a4a9f179a8a75f1ce2993ac0c50e5e040cf ;;
  sfw-macos-arm64) digest=16fbe362a24af30b75938667e7bff00ed79df24e17a8e2d0abf3ae53d5739e92 ;;
  sfw-windows-x86_64.exe) digest=e8ecd768aebabc365d91306e0b5ef8b66c16b4816496934ff4998cda60590e3c ;;
  sfw-free-linux-x86_64) digest=1f24d2628aeb3995f1f2651509e37641c7c41d07749ac68594ecb5bb2dd44d8a ;;
  sfw-free-linux-arm64) digest=474cdb684e42d33d4b697dedd7d90c159d71380be0e53c496f0e7097c3617a6c ;;
  sfw-free-macos-x86_64) digest=b574931bc2b3c36a9bf07ac07b9c07894f8cd314efc91bc5e4fe1c371b56adca ;;
  sfw-free-macos-arm64) digest=29df049df2ef705a8ce726c6c41fe73a6034f6b1cd0d87f3f15a780d074b6d83 ;;
  sfw-free-windows-x86_64.exe) digest=fafcb65a0349ff21af4feeda170f669053efa68acb55e1b935f7ed1b2ac93ca7 ;;
esac

temp=$RUNNER_TEMP
if [[ "$RUNNER_OS" == Windows ]]; then temp=$(cygpath -u "$temp"); fi
dir=$(mktemp -d "$temp/socket-firewall.XXXXXX")
bin="$dir/sfw"
if [[ "$RUNNER_OS" == Windows ]]; then bin+=.exe; fi
url=$(gh api "repos/$repo/releases/tags/v$version" --jq ".assets[] | select(.name == \"$asset\") | .browser_download_url")
curl -fsSL "$url" -o "$bin"
if command -v sha256sum >/dev/null; then checksum=(sha256sum); else checksum=(shasum -a 256); fi
(cd "$dir" && echo "$digest  ${bin##*/}" | "${checksum[@]}" -c -)
chmod +x "$bin"

shims="$dir/shims"
mkdir "$shims"
for command in "${commands[@]}"; do
  real=$(command -v "$command") || continue
  {
    echo '#!/usr/bin/env bash'
    # Nested package-manager invocations must reach the original tools.
    printf 'shims=%q\n' "$shims"
    cat <<'SH'
path=:$PATH:
path=${path//:"$shims":/:}
path=${path#:}
export PATH=${path%:}
SH
    printf 'exec %q %q "$@"\n' "$bin" "$real"
  } > "$shims/$command"
  chmod +x "$shims/$command"
  if [[ "$RUNNER_OS" == Windows ]]; then
    printf '@echo off\r\nset "PATH=;%%PATH%%;"\r\nset "PATH=%%PATH:;%s;=;%%"\r\nset "PATH=%%PATH:~1,-1%%"\r\n"%s" "%s" %%*\r\n' \
      "$(cygpath -w "$shims")" "$(cygpath -w "$bin")" "$(cygpath -w "$real")" > "$shims/$command.cmd"
  fi
done
if [[ "$RUNNER_OS" == Windows ]]; then shims=$(cygpath -w "$shims"); fi
echo "$shims" >> "$GITHUB_PATH"
if [[ "$prefix" == sfw ]]; then echo "SOCKET_API_KEY=$SOCKET_API_KEY" >> "$GITHUB_ENV"; fi
