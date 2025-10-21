# CI Setup for yao-pkg Binary Builds

This document covers setting up Continuous Integration (CI) for building Socket CLI yao-pkg binaries across multiple platforms.

## Overview

Building yao-pkg binaries in CI requires:
1. **Platform-specific runners** (macOS, Linux, Windows)
2. **Build tools** (compilers, make, python)
3. **UPX** (optional, for compression on Linux/Windows)
4. **Node.js** v22+ (for building Socket CLI)
5. **pnpm** v9+
6. **~10GB disk space** per platform
7. **30-60 minutes** build time per platform

## GitHub Actions Setup

### Matrix Strategy

Use a matrix strategy to build for multiple platforms:

```yaml
name: Build yao-pkg Binaries

on:
  push:
    branches: [main]
  release:
    types: [created]

jobs:
  build-node:
    name: Build Custom Node.js
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        include:
          - os: macos-13
            target: macos-arm64
            node_arch: arm64
          - os: macos-13
            target: macos-x64
            node_arch: x64
          - os: ubuntu-latest
            target: linux-x64
            node_arch: x64
          - os: ubuntu-latest
            target: linux-arm64
            node_arch: arm64
          - os: windows-latest
            target: win-x64
            node_arch: x64

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Install pnpm
        uses: pnpm/action-setup@v2
        with:
          version: 9

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Install build tools (Linux)
        if: runner.os == 'Linux'
        run: |
          sudo apt-get update
          sudo apt-get install -y build-essential python3 upx-ucl

      - name: Install build tools (macOS)
        if: runner.os == 'macOS'
        run: |
          # Xcode Command Line Tools are pre-installed
          # UPX not needed on macOS (code signing incompatible)
          echo "Build tools ready"

      - name: Install build tools (Windows)
        if: runner.os == 'Windows'
        run: |
          choco install upx -y

      - name: Build custom Node.js
        run: pnpm run build:yao-pkg:node
        env:
          TARGET_ARCH: ${{ matrix.node_arch }}

      - name: Upload Node.js binary
        uses: actions/upload-artifact@v4
        with:
          name: node-${{ matrix.target }}
          path: .custom-node-build/node-yao-pkg/out/Release/node
          retention-days: 7

  build-cli:
    name: Build CLI Binary
    needs: build-node
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        include:
          - os: macos-13
            target: macos-arm64
          - os: macos-13
            target: macos-x64
          - os: ubuntu-latest
            target: linux-x64
          - os: ubuntu-latest
            target: linux-arm64
          - os: windows-latest
            target: win-x64

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Install pnpm
        uses: pnpm/action-setup@v2
        with:
          version: 9

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Download Node.js binary
        uses: actions/download-artifact@v4
        with:
          name: node-${{ matrix.target }}
          path: .custom-node-build/node-yao-pkg/out/Release/

      - name: Build CLI distribution
        run: pnpm run build:dist:src

      - name: Build pkg binary
        run: pnpm run build:yao-pkg

      - name: Upload CLI binary
        uses: actions/upload-artifact@v4
        with:
          name: socket-${{ matrix.target }}
          path: pkg-binaries/socket-*
          retention-days: 30
```

## Platform-Specific Setup

### macOS

**Pre-installed on GitHub Actions:**
- ✅ Xcode Command Line Tools
- ✅ Build essentials (clang, make, python3)

**Additional setup:**
```bash
# No additional setup needed
# UPX is not used on macOS (incompatible with code signing)
```

**Notes:**
- Ad-hoc code signing is automatic in build script
- For distribution, use Developer ID certificate via secrets

### Linux (Ubuntu/Debian)

**Install build tools:**
```bash
sudo apt-get update
sudo apt-get install -y \
  build-essential \
  python3 \
  python3-pip \
  upx-ucl
```

**Notes:**
- `build-essential` includes gcc, g++, make
- `upx-ucl` is the official UPX package
- UPX will compress binary by ~30-50%

### Linux (RHEL/Fedora/CentOS)

**Install build tools:**
```bash
sudo dnf install -y \
  gcc \
  gcc-c++ \
  make \
  python3 \
  upx
```

### Windows

**Install build tools via Chocolatey:**
```powershell
choco install -y visualstudio2022buildtools
choco install -y upx
```

**Or use WSL2 (recommended):**
```bash
# Use Ubuntu setup from above
wsl --install -d Ubuntu
```

**Notes:**
- Visual Studio Build Tools required for node-gyp
- UPX provides ~30-50% compression
- WSL2 is recommended for consistent builds

## UPX Compression

### What is UPX?

UPX (Ultimate Packer for eXecutables) is a free executable compressor that:
- Reduces binary size by 30-50% (typical)
- Decompresses automatically at runtime (~50ms overhead)
- Works on Linux, Windows (not used on macOS due to code signing)

### Installation by Platform

**Ubuntu/Debian:**
```bash
sudo apt-get install upx-ucl
```

**RHEL/Fedora/CentOS:**
```bash
sudo dnf install upx
```

**macOS (not recommended):**
```bash
# UPX is available but incompatible with code signing
# brew install upx
```

**Windows:**
```powershell
choco install upx
```

**Manual installation:**
- Download from: https://upx.github.io/
- Extract to PATH or `/usr/local/bin`

### Verifying UPX Installation

```bash
upx --version
# Output: upx 4.2.1

which upx
# Output: /usr/bin/upx (or similar)
```

### Build Script Behavior

The `scripts/build-yao-pkg-node.mjs` script:
- ✅ **Attempts UPX** on Linux/Windows
- ✅ **Skips gracefully** if UPX not found
- ✅ **Never fails** the build
- ✅ **Logs warning** if UPX unavailable

```javascript
if (!IS_MACOS) {
  try {
    await exec('upx', ['--best', '--lzma', nodeBinary])
    console.log('✅ UPX compression complete')
  } catch (error) {
    console.log('⚠️  UPX not available, skipping compression')
  }
}
```

### Expected Binary Sizes

| Platform | Unoptimized | Stripped | UPX Compressed |
|----------|-------------|----------|----------------|
| macOS ARM64 | ~95MB | ~44MB | N/A (code signed) |
| macOS x64 | ~95MB | ~44MB | N/A (code signed) |
| Linux x64 | ~95MB | ~44MB | ~22-31MB |
| Linux ARM64 | ~95MB | ~44MB | ~22-31MB |
| Windows x64 | ~95MB | ~44MB | ~22-31MB |

## Caching Strategies

### Cache Node.js Source

Cache the Node.js source to avoid re-downloading:

```yaml
- name: Cache Node.js source
  uses: actions/cache@v4
  with:
    path: .custom-node-build/node-yao-pkg
    key: node-source-v24.10.0-${{ runner.os }}-${{ runner.arch }}
```

### Cache Node.js Build

Cache the compiled Node.js binary to avoid rebuilding:

```yaml
- name: Cache Node.js build
  uses: actions/cache@v4
  with:
    path: .custom-node-build/node-yao-pkg/out/Release/node
    key: node-binary-v24.10.0-${{ runner.os }}-${{ runner.arch }}-${{ hashFiles('scripts/build-yao-pkg-node.mjs') }}
```

### Cache pnpm Store

Cache pnpm dependencies:

```yaml
- name: Get pnpm store directory
  shell: bash
  run: echo "STORE_PATH=$(pnpm store path --silent)" >> $GITHUB_ENV

- name: Cache pnpm store
  uses: actions/cache@v4
  with:
    path: ${{ env.STORE_PATH }}
    key: pnpm-${{ runner.os }}-${{ hashFiles('pnpm-lock.yaml') }}
    restore-keys: |
      pnpm-${{ runner.os }}-
```

## Storage and Distribution

### Artifact Upload

Upload binaries as artifacts:

```yaml
- name: Upload binary
  uses: actions/upload-artifact@v4
  with:
    name: socket-${{ matrix.target }}
    path: pkg-binaries/socket-*
    retention-days: 30
```

### Release Assets

Attach binaries to GitHub releases:

```yaml
- name: Upload to release
  if: github.event_name == 'release'
  uses: actions/upload-release-asset@v1
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  with:
    upload_url: ${{ github.event.release.upload_url }}
    asset_path: ./pkg-binaries/socket-${{ matrix.target }}
    asset_name: socket-${{ matrix.target }}
    asset_content_type: application/octet-stream
```

## Environment Variables

### Build Configuration

```bash
# Target architecture (for cross-compilation)
export TARGET_ARCH=arm64  # or x64

# Skip UPX compression (for testing)
export SKIP_UPX=1

# PKG_EXECPATH (for testing patched Node.js)
export PKG_EXECPATH=PKG_INVOKE_NODEJS
```

### GitHub Secrets (Optional)

For signed macOS releases:

```yaml
env:
  APPLE_CERTIFICATE_BASE64: ${{ secrets.APPLE_CERTIFICATE_BASE64 }}
  APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
  APPLE_KEYCHAIN_PASSWORD: ${{ secrets.APPLE_KEYCHAIN_PASSWORD }}
```

## Troubleshooting

### UPX Not Found

**Symptom:**
```
⚠️  UPX not available or failed, skipping compression
```

**Solution:**
- Install UPX via package manager (see above)
- Verify with `upx --version`
- Check PATH includes UPX location
- Build continues without compression (larger binary)

### Node.js Build Timeout

**Symptom:**
```
Error: The operation was canceled.
```

**Solution:**
- Increase timeout in workflow:
  ```yaml
  timeout-minutes: 90
  ```
- Use cached build artifacts
- Split build into separate jobs

### Disk Space Issues

**Symptom:**
```
No space left on device
```

**Solution:**
- Clean up before build:
  ```bash
  df -h
  sudo apt-get clean
  docker system prune -af
  ```
- Use larger runner (GitHub Actions: `ubuntu-latest-8-cores`)

### Code Signing Fails (macOS)

**Symptom:**
```
Error: codesign failed with exit code 1
```

**Solution:**
- Verify Xcode Command Line Tools: `xcode-select --version`
- For ad-hoc signing, use `codesign --sign -`
- For distribution, provide valid certificate

## Performance Tips

1. **Parallel builds**: Build different platforms in parallel jobs
2. **Cache aggressively**: Cache Node.js source, build, and pnpm store
3. **Artifact compression**: GitHub automatically compresses artifacts
4. **Matrix strategy**: Use `fail-fast: false` to continue other builds if one fails
5. **Separate jobs**: Split Node.js build and pkg build into separate jobs

## Cost Optimization

For self-hosted runners:
- **Reuse runners**: Keep runners warm between builds
- **Local cache**: Persistent cache for Node.js source/builds
- **Incremental builds**: Only rebuild when patches change

For GitHub Actions:
- **Cache everything**: Reduces build time and GitHub Actions minutes
- **On-demand builds**: Only build on release tags
- **Manual triggers**: Use `workflow_dispatch` for testing

## References

- [UPX Official Site](https://upx.github.io/)
- [GitHub Actions: actions/upload-artifact](https://github.com/actions/upload-artifact)
- [GitHub Actions: actions/cache](https://github.com/actions/cache)
- [yao-pkg Documentation](https://github.com/yao-pkg/pkg)
- Socket CLI: `docs/YAO_PKG_BUILD.md`
