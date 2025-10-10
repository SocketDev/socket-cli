# Stub Build Patches

This directory contains patches used when building custom Node.js binaries for @yao-pkg/pkg packaging.

## Structure

```
stub/
├── patches/
│   ├── yao/              # Patches from @yao-pkg/pkg (cached in version control)
│   └── socket/           # Socket custom patches
└── README.md
```

## Patches Organization

### Yao Patches (`patches/yao/`)
- Downloaded from: https://github.com/yao-pkg/pkg-fetch/tree/main/patches
- Cached in version control for reproducible builds
- Contains official @yao-pkg/pkg compatibility patches
- Last synced: See `.sync-cache.json`

### Socket Patches (`patches/socket/`)
- Custom Socket-specific modifications:
  - `001-v8-flags-harmony-dynamic-import.patch` - V8 flag modifications
  - `002-node-gyp-static-linking.patch` - Force static linking
  - `003-fix-v8-include-paths-v24.patch` - Fix V8 include paths for v24

## Patch Management

### Syncing Yao Patches
```bash
# Force sync from upstream (built into build-stub)
node scripts/build/build-stub.mjs --sync-yao-patches

# Or use the standalone script
node scripts/build/fetch-yao-patches.mjs
```

## Building

See the main build scripts in `scripts/build/`:
- `build-stub.mjs` - Build standalone executables
- `build-socket-node.mjs` - Build custom Node.js binaries
- `fetch-yao-patches.mjs` - Update yao patches from upstream

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
4. Node.js is configured and built with flags from `.config/build-config.json5`

## Configuration

All build configuration is centralized in `.config/build-config.json5`:
- Node.js versions and their patches
- Configure flags for size optimization
- @yao-pkg/pkg settings
- Build paths and directories