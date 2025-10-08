# Build System

This directory contains the build scripts for Socket CLI, including the creation of standalone executables (SEA/stub) using yao-pkg.

## Directory Structure

```
scripts/build/
├── build-cli-with-sentry.mjs     # Build @socketsecurity/cli with Sentry
├── build-socket-package.mjs      # Build socket package
├── build-socketsecurity-cli.mjs  # Build @socketsecurity/cli package
├── build-stub.mjs                 # Create SEA/stub executables
├── build-tiny-node.mjs            # Build custom Node.js for pkg
├── check-build-deps.mjs           # Verify build dependencies
├── ensure-node-in-cache.mjs       # Manage pkg cache
└── stub/
    ├── patches/
    │   ├── socket/                # Custom Socket patches
    │   └── yao/                   # yao-pkg patches (auto-synced)
    ├── fetch-patches.mjs          # Download patches from yao-pkg
    ├── sync-yao-patches.mjs       # Smart sync with TTL caching
    └── README.md                  # Stub/SEA documentation
```

## Build Outputs

```
build/
├── stub/                          # SEA executables (socket-macos-arm64, etc.)
└── tiny-node/                     # Node.js source and compilation
    └── node-v24.9.0-custom/
        └── out/Release/node[.exe] # Custom Node.js binary
```

## Main Build Scripts

### `build-stub.mjs`
Creates self-contained executables using yao-pkg.

```bash
node scripts/build/build-stub.mjs [options]
  --platform=PLATFORM   Target platform (darwin, linux, win32)
  --arch=ARCH          Target architecture (x64, arm64)
  --node-version=VER   Node.js version (default: v24.9.0)
  --minify             Minify the build
  --quiet              Suppress output
```

### `build-tiny-node.mjs`
Builds a custom Node.js binary with patches for pkg compatibility.

```bash
node scripts/build/build-tiny-node.mjs [options]
  --version=VERSION    Node.js version to build (default: v24.9.0)
  --skip-download      Skip downloading if source already exists
  --skip-yao-patch     Skip applying yao-pkg patches
  --custom-patches     Apply custom patches
  --skip-code-mods     Skip V8 flags and node-gyp modifications
```

## Cross-Platform Requirements

### Windows
- Visual Studio Build Tools or full Visual Studio
- Python 3.x (auto-downloaded if not present)
- PowerShell (for Python extraction, included in Windows)
- Uses MSBuild/vcbuild.bat instead of make

### macOS
- Xcode Command Line Tools
- codesign for ARM64 binaries (automatic)

### Linux
- build-essential package
- python3
- gcc/g++ compiler

### All Platforms
- Node.js 18+ to run build scripts
- 10GB+ free disk space for Node.js compilation
- pnpm package manager

## Build Flow

1. **Custom Node.js Build** (one-time, ~30-60 minutes)
   ```bash
   node scripts/build/build-tiny-node.mjs --version=v24.9.0
   ```
   - Downloads Node.js source
   - Applies yao-pkg patches for pkg compatibility
   - Applies custom Socket patches (V8 flags, static linking)
   - Compiles Node.js
   - Places binary in pkg cache

2. **SEA/Stub Build** (each release, ~1-2 minutes)
   ```bash
   node scripts/build/build-stub.mjs --platform=darwin --arch=arm64
   ```
   - Syncs latest yao-pkg patches (cached 24h)
   - Builds distribution JavaScript if needed
   - Ensures custom Node exists in cache
   - Creates self-contained executable

## Patch System

### yao-pkg Patches (`stub/patches/yao/`)
- Downloaded from https://github.com/yao-pkg/pkg-fetch
- Auto-synced with 24-hour TTL cache
- Required for pkg compatibility

### Socket Patches (`stub/patches/socket/`)
- `001-v8-flags-harmony-dynamic-import.patch` - V8 compatibility
- `002-node-gyp-static-linking.patch` - Force static linking
- Custom modifications specific to Socket CLI

## Helper Scripts

### `ensure-node-in-cache.mjs`
Manages the pkg cache directory (`~/.pkg-cache/v3.5/`), ensuring the custom Node.js binary is available for pkg to use.

### `check-build-deps.mjs`
Verifies that all build dependencies are installed and provides helpful error messages if something is missing.

## Common Issues

### Windows Build Failures
- Ensure Visual Studio Build Tools are installed
- Check Python 3.x is in PATH
- For older Windows, install tar separately

### macOS Code Signing
- ARM64 binaries are automatically signed
- May prompt for keychain access

### Large Build Size
- First build downloads ~300MB Node.js source
- Compilation creates ~5GB of build artifacts
- Final binary is ~80-120MB (before compression)
- Use `scripts/cleanup-builds.mjs` to clean old builds

## Cleanup

```bash
# Clean old Node.js builds (keeps current)
node scripts/cleanup-builds.mjs --node

# Clean all build artifacts
node scripts/cleanup-builds.mjs --full

# Clean specific directories
node scripts/cleanup-builds.mjs --pkg   # Clean build/stub/
node scripts/cleanup-builds.mjs --dist  # Clean dist/
```

## Development Tips

1. **Incremental Builds**: After initial Node.js build, rebuilds are much faster (~5-10 minutes)

2. **Parallel Builds**: The build system uses all available CPU cores

3. **Cross-Compilation**: You can build for different platforms, but the custom Node.js must be built on the target platform

4. **Testing Binaries**: Always test the final executable on the target platform

5. **Cache Management**: The pkg cache (`~/.pkg-cache/`) can grow large; periodically clean old versions

## Troubleshooting

### "Custom Node.js binary not found"
Run `node scripts/build/build-tiny-node.mjs` to build the custom Node.js first.

### "tar command not found" (Windows)
Update to Windows 10+ or install a tar utility separately.

### Build takes forever
Normal for first build. Subsequent builds use cached objects and are much faster.

### Binary doesn't run on target system
Ensure you're building with matching architecture and platform flags.