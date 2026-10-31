# shellcheck shell=bash
# Sourced by the dotnet smoke tests after they set HERE and DOTNET.
REPO="$(cd "$HERE/../../../../../.." && pwd)"
TOOL="$REPO/dist/manifest-scripts/dotnet-tool/socket-facts-dotnet.dll"
export DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1 DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1

if [ ! -f "$TOOL" ]; then
  echo "dotnet tool not built: run pnpm run build:dotnet-tool && pnpm build:dist:src" >&2
  exit 1
fi

# Copies the fixture paths $2... (relative to HERE) into $1, without restore
# and build output, so every run starts unrestored.
copy_fixture() {
  ( cd "$HERE" && find "${@:2}" -type f \
      -not -path '*/obj/*' -not -path '*/bin/*' -not -path './stub-feed/*' \
      -not -name '*.socket.facts.json' -not -name 'packages.lock.json' \
      -exec sh -c 'mkdir -p "$1/$(dirname "$2")" && cp "$2" "$1/$2"' _ "$1" {} \; )
}

# Pins SDK version $2 (if any) with a global.json in $1, as a project would,
# and sets SDK_VERSION to the SDK dotnet then selects there.
pin_sdk() {
  if [ -n "${2:-}" ]; then
    printf '{"sdk": {"version": "%s", "rollForward": "disable"}}\n' "$2" > "$1/global.json"
  fi
  SDK_VERSION="$(cd "$1" && "$DOTNET" --version)"
}

# Runs the tool from directory $1 with the remaining arguments.
run_tool() {
  # A preview SDK's MSBuild needs a preview runtime (see run.mts).
  ( cd "$1" && case "$SDK_VERSION" in *-*) export DOTNET_ROLL_FORWARD_TO_PRERELEASE=1 ;; esac
    "$DOTNET" "$TOOL" --dotnet "$DOTNET" "${@:2}" >/dev/null )
}
