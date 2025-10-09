# Stub/SEA Build System

This directory contains the build system for creating standalone executable applications (stubs/SEA) using yao-pkg.

## Structure

```
stub/
├── patches/
│   ├── yao/              # Patches from yao-pkg (auto-synced)
│   └── socket/           # Socket custom patches
├── build-stub.mjs        # Main stub build script
├── fetch-patches.mjs     # Download patches from yao-pkg
├── sync-yao-patches.mjs  # Auto-sync with caching
└── README.md
```

## Patches Organization

### Yao Patches (`patches/yao/`)
- Downloaded from: https://github.com/yao-pkg/pkg-fetch/tree/main/patches
- Auto-synced during builds with 24-hour TTL cache
- Contains official pkg compatibility patches

### Socket Patches (`patches/socket/`)
- Custom Socket-specific modifications:
  - `001-v8-flags-harmony-dynamic-import.patch` - V8 flag modifications
  - `002-node-gyp-static-linking.patch` - Force static linking

## Patch Management

### Automatic Sync
Patches are automatically synced during builds:
```bash
# Runs automatically, but can be forced:
node scripts/build/stub/sync-yao-patches.mjs --force
```

### Manual Download
```bash
# Download specific versions
node scripts/build/stub/fetch-patches.mjs v24.9.0 v22.19.0
```

### Cache Control
```bash
# Set custom TTL (in hours)
node scripts/build/stub/sync-yao-patches.mjs --ttl=1

# Force refresh
node scripts/build/stub/sync-yao-patches.mjs --force
```

## Building

### Build Stub/SEA Binary
```bash
# Build for current platform
node scripts/build/stub/build-stub.mjs

# Build for specific platform
node scripts/build/stub/build-stub.mjs --platform=linux --arch=x64

# Build with specific Node version
node scripts/build/stub/build-stub.mjs --node-version=v24.9.0
```

### Build Custom Node
```bash
# Download, patch, and build Node.js
pnpm run build --node
# Or directly:
node scripts/build/build-tiny-node.mjs --version=v24.9.0
```

## Creating Custom Patches

To create a patch for Node.js modifications:

1. Make your changes in the Node source directory (`build/socket-node/node-*`)
2. Generate a patch:
   ```bash
   cd build/socket-node/node-v24.9.0-custom
   git diff > ../../scripts/build/stub/patches/socket/003-my-custom-change.patch
   ```

## Patch Application Flow

1. Node.js source is downloaded
2. Yao-pkg patches are applied from `patches/yao/`
3. Socket patches are applied from `patches/socket/`
4. Node.js is configured and built

## Troubleshooting

If a patch fails to apply:
- Check if the patch was already applied
- Verify the patch is compatible with the Node.js version
- The build system now uses JavaScript-based patching (cross-platform)

## Output

Built binaries are placed in:
- `binaries/stub/` - Final SEA executables
- `binaries/socket-node/` - Custom Node.js binaries
- `build/socket-node/` - Node.js source and compilation