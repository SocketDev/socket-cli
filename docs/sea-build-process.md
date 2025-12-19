# SEA Build Process

Socket CLI uses Node.js Single Executable Application (SEA) format for platform binaries.

## Quick Build

```bash
# Build SEA for current platform
pnpm build --force

# Build SEA for all platforms
pnpm build:sea
```

## Architecture

Each platform binary = node-smol binary + CLI blob (injected with binject).

## Platform Binaries

- `socket-darwin-arm64` (macOS Apple Silicon)
- `socket-darwin-x64` (macOS Intel)
- `socket-linux-arm64` (Linux ARM64)
- `socket-linux-x64` (Linux x64)
- `socket-linux-arm64-musl` (Alpine ARM64)
- `socket-linux-x64-musl` (Alpine x64)
- `socket-win-arm64.exe` (Windows ARM64)
- `socket-win-x64.exe` (Windows x64)

## Build Steps

1. **Download node-smol binary** (from socket-btm releases)
2. **Build CLI bundle** (`packages/cli/build/cli.js`)
3. **Generate SEA blob** (`node --experimental-sea-config`)
4. **Inject blob** (using binject from socket-btm)
5. **Output** (`packages/cli/dist/sea/socket-<platform>-<arch>`)

## Implementation

See `packages/cli/src/utils/sea/build.mts` for build logic.
