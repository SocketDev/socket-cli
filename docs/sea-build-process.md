# SEA Build Process for Socket CLI

This document describes how the 8 platform binaries for Socket CLI are built using the Node.js Single Executable Application (SEA) format.

## Architecture Overview

Each of the 8 platform binaries (`@socketbin/cli-*-*`) is composed of:

1. **Premade Node.js Binary** (per platform/arch)
2. **SEA Blob** (fused via postject with `--fuse`)

```
┌─────────────────────────────────────────────┐
│  Platform Binary (e.g., cli-darwin-arm64)   │
│                                              │
│  ┌──────────────────────────────────────┐   │
│  │  Premade Node.js Binary              │   │
│  │  - Official Node.js v24.10.0 build   │   │
│  │  - OR Custom smol build              │   │
│  └──────────────────────────────────────┘   │
│                   +                          │
│  ┌──────────────────────────────────────┐   │
│  │  SEA Blob (via postject --fuse)      │   │
│  │  - Full CLI bundle                   │   │
│  │  - Generated from cli-dispatch.mts   │   │
│  │  - Includes all dependencies         │   │
│  └──────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

## The 8 Platform Binaries

Each binary targets a specific platform and architecture:

- `@socketbin/cli-darwin-arm64` (macOS Apple Silicon)
- `@socketbin/cli-darwin-x64` (macOS Intel)
- `@socketbin/cli-linux-arm64` (Linux ARM64 with glibc)
- `@socketbin/cli-linux-x64` (Linux x64 with glibc)
- `@socketbin/cli-alpine-arm64` (Linux ARM64 with musl)
- `@socketbin/cli-alpine-x64` (Linux x64 with musl)
- `@socketbin/cli-win32-arm64` (Windows ARM64)
- `@socketbin/cli-win32-x64` (Windows x64)

## Build Process

### Step 1: Choose Node.js Binary Source

**Default: Official Node.js Binaries**

By default, use official prebuilt Node.js v24.10.0 binaries from https://nodejs.org/download/release/:

```bash
# Download is handled by src/utils/sea/build.mts:downloadNodeBinary()
# URL format: https://nodejs.org/download/release/v24.10.0/node-v24.10.0-{platform}-{arch}.tar.gz
```

**Alternative: Custom Smol Binaries**

For custom Node.js builds (smol), reference binaries from GitHub releases:

```bash
# Custom binary location (if provided)
SOCKET_CLI_NODE_BINARY_URL="https://github.com/SocketDev/socket-btm/releases/download/node-smol-v1.2.0/node-smol-darwin-arm64.tar.gz"
```

See "Custom Binary System" section below for how to upload and reference custom builds.

### Step 2: Generate SEA Blob

Use Node.js SEA config to generate the blob:

```bash
# 1. Build the CLI bundle
pnpm build:dist:src  # Creates dist/index.js

# 2. Generate SEA config (done by src/utils/sea/build.mts:generateSeaConfig())
cat > sea-config.json << EOF
{
  "main": "dist/index.js",
  "output": "sea-blob.blob",
  "disableExperimentalSEAWarning": true,
  "useCodeCache": true,
  "useSnapshot": false,
  "assets": {}
}
EOF

# 3. Generate blob with Node.js
node --experimental-sea-config sea-config.json
# Output: sea-blob.blob
```

### Step 3: Inject SEA Blob with Postject

Use postject to fuse the blob into the Node binary:

```bash
# Copy the Node binary
cp /path/to/node ./socket

# Inject the SEA blob
npx postject ./socket NODE_SEA_BLOB sea-blob.blob \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2

# Platform-specific signing (macOS)
codesign --remove-signature ./socket  # Before injection
npx postject ./socket NODE_SEA_BLOB sea-blob.blob \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 \
  --macho-segment-name NODE_SEA
codesign --sign - ./socket  # After injection

# Make executable
chmod +x ./socket
```

This is handled by `src/utils/sea/build.mts:injectSeaBlob()`.

### Step 4: Publish to npm

Each platform binary is published as a separate optional dependency:

```json
{
  "name": "@socketbin/cli-darwin-arm64",
  "version": "2.1.0",
  "bin": {
    "socket": "./bin/socket"
  },
  "files": ["bin/socket"]
}
```

The main `socket` package references them:

```json
{
  "name": "socket",
  "optionalDependencies": {
    "@socketbin/cli-darwin-arm64": "2.1.0",
    "@socketbin/cli-darwin-x64": "2.1.0",
    "@socketbin/cli-linux-arm64": "2.1.0",
    "@socketbin/cli-linux-x64": "2.1.0",
    "@socketbin/cli-alpine-arm64": "2.1.0",
    "@socketbin/cli-alpine-x64": "2.1.0",
    "@socketbin/cli-win32-arm64": "2.1.0",
    "@socketbin/cli-win32-x64": "2.1.0"
  }
}
```

## Node.js Version

**Default**: v24.10.0

Controlled by:
- Environment variable: `SOCKET_CLI_SEA_NODE_VERSION`
- Fallback: `src/utils/sea/build.mts:getLatestCurrentRelease()`

```bash
# Override Node.js version
SOCKET_CLI_SEA_NODE_VERSION="24.10.0" pnpm build --target sea
```

## Custom Binary System

For custom Node.js builds (e.g., smol binaries), use GitHub releases to host and reference binaries.

### Upload Custom Binaries to GitHub

In the `SocketDev/socket-btm` repository:

```bash
# 1. Build custom Node.js binary
cd packages/node-smol-builder
pnpm build --prod

# 2. Create GitHub release
gh release create node-smol-v1.2.0 \
  --title "Node.js Smol v1.2.0" \
  --notes "Custom Node.js v24.10.0 with smol optimizations"

# 3. Upload platform binaries
for platform in darwin linux linux-musl win32; do
  for arch in arm64 x64; do
    gh release upload node-smol-v1.2.0 \
      "build/out/Final/node-smol-${platform}-${arch}.tar.gz"
  done
done
```

### Reference Custom Binaries in Build

Set environment variable to use custom binaries:

```bash
# Single platform
SOCKET_CLI_NODE_BINARY_URL="https://github.com/SocketDev/socket-btm/releases/download/node-smol-v1.2.0/node-smol-darwin-arm64.tar.gz" \
  pnpm build --target darwin-arm64

# All platforms (in CI)
# Modify src/utils/sea/build.mts:downloadNodeBinary() to check:
# - ENV.SOCKET_CLI_NODE_BINARY_URL (single binary)
# - ENV.SOCKET_CLI_NODE_BINARY_BASE_URL (base URL for all platforms)
```

**Example Base URL Usage:**

```bash
SOCKET_CLI_NODE_BINARY_BASE_URL="https://github.com/SocketDev/socket-btm/releases/download/node-smol-v1.2.0" \
  pnpm build --platforms

# Downloads:
# ${BASE_URL}/node-smol-darwin-arm64.tar.gz
# ${BASE_URL}/node-smol-darwin-x64.tar.gz
# ${BASE_URL}/node-smol-linux-arm64.tar.gz
# ... etc
```

## Build Automation

### CI/CD Workflow

```yaml
name: Build Platform Binaries

on:
  push:
    tags:
      - 'v*'

jobs:
  build:
    strategy:
      matrix:
        include:
          - platform: darwin
            arch: arm64
          - platform: darwin
            arch: x64
          - platform: linux
            arch: arm64
          - platform: linux
            arch: x64
          - platform: alpine
            arch: arm64
          - platform: alpine
            arch: x64
          - platform: win32
            arch: arm64
          - platform: win32
            arch: x64

    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Install dependencies
        run: pnpm install

      - name: Build platform binary
        run: pnpm build --platform ${{ matrix.platform }} --arch ${{ matrix.arch }}
        env:
          SOCKET_CLI_SEA_NODE_VERSION: '24.10.0'

      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: socket-${{ matrix.platform }}-${{ matrix.arch }}
          path: packages/socketbin-cli-${{ matrix.platform }}-${{ matrix.arch }}/bin/socket*
```

## Existing Implementation

The Socket CLI repository already has SEA build utilities in `packages/cli/src/utils/sea/build.mts`:

- `downloadNodeBinary()` - Downloads official Node.js binaries (or can be modified for custom URLs)
- `generateSeaConfig()` - Creates proper SEA configuration
- `buildSeaBlob()` - Runs `node --experimental-sea-config` to generate blob
- `injectSeaBlob()` - Uses postject to inject blob with platform-specific flags
- `buildTarget()` - Orchestrates the entire process for one platform
- `getBuildTargets()` - Returns all 8 platform configurations

## Next Steps

1. **Modify `downloadNodeBinary()`** to support custom binary URLs via environment variables
2. **Add GitHub release workflow** to socket-btm for uploading custom binaries
3. **Document the custom binary upload process** in socket-btm README
4. **Update CI/CD** to reference custom binaries when available
