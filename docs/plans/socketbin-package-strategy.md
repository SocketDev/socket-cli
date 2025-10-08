# @socketbin/* Binary Package Strategy

This document outlines the strategy for distributing Socket binary tools through npm using the `@socketbin` scope.

## Overview

The `@socketbin` npm scope is used for distributing platform-specific binaries for Socket tools. This approach eliminates postinstall scripts, improves reliability, and simplifies distribution.

## Scope Setup & Security

### 1. Create NPM Organization

```bash
# Create the @socketbin organization on npmjs.com
npm org create socketbin
```

### 2. Configure Organization Settings

- **Visibility**: Public packages only
- **2FA**: Required for all members
- **Package Creation**: Restricted to owners only

### 3. Add Trusted Publishers (Provenance)

For supply chain security, all `@socketbin` packages are published with npm provenance from GitHub Actions:

```yaml
# .github/workflows/publish-binaries.yml
jobs:
  publish:
    permissions:
      contents: read
      id-token: write  # Required for provenance

    steps:
      - uses: actions/setup-node@v4
        with:
          registry-url: 'https://registry.npmjs.org'

      - run: npm publish --provenance --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

### 4. Configure Trusted Publishers

In npm organization settings, add GitHub repository as trusted publisher:

1. Go to npmjs.com → Organization Settings → Publishing
2. Add trusted publisher:
   - **Repository**: `SocketDev/socket-cli`
   - **Workflow**: `.github/workflows/publish-binaries.yml`
   - **Environment**: `production` (optional)
3. Enable "Require provenance for all packages"

This ensures all packages show the green checkmark ✓ indicating verified provenance.

## Package Naming Convention

```
@socketbin/{tool}-{platform}-{arch}
```

### Current Tools

#### Socket CLI
```
@socketbin/cli-darwin-arm64
@socketbin/cli-darwin-x64
@socketbin/cli-linux-arm64
@socketbin/cli-linux-x64
@socketbin/cli-win32-arm64
@socketbin/cli-win32-x64
```

#### Future Tools (Example: SFS)
```
@socketbin/sfs-darwin-arm64
@socketbin/sfs-darwin-x64
@socketbin/sfs-linux-arm64
@socketbin/sfs-linux-x64
@socketbin/sfs-win32-arm64
@socketbin/sfs-win32-x64
```

## Package Structure

### Binary Package (`@socketbin/cli-darwin-arm64`)

```
@socketbin/cli-darwin-arm64/
├── package.json
├── README.md
└── bin/
    └── cli          # The actual binary (no extension on Unix)
```

**package.json**:
```json
{
  "name": "@socketbin/cli-darwin-arm64",
  "version": "1.1.24",
  "description": "Socket CLI binary for macOS ARM64",
  "keywords": ["socket", "cli", "binary", "darwin", "arm64", "macos"],
  "os": ["darwin"],
  "cpu": ["arm64"],
  "bin": {
    "socket-cli-binary": "bin/cli"
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/SocketDev/socket-cli.git",
    "directory": "packages/binaries/cli-darwin-arm64"
  },
  "publishConfig": {
    "provenance": true
  }
}
```

### Main Package (`socket`)

```
socket/
├── package.json
├── README.md
└── bin/
    └── socket.js    # Platform dispatcher
```

**package.json**:
```json
{
  "name": "socket",
  "version": "1.1.24",
  "description": "Socket CLI - Security analysis for your dependencies",
  "bin": {
    "socket": "bin/socket.js"
  },
  "optionalDependencies": {
    "@socketbin/cli-darwin-arm64": "1.1.24",
    "@socketbin/cli-darwin-x64": "1.1.24",
    "@socketbin/cli-linux-arm64": "1.1.24",
    "@socketbin/cli-linux-x64": "1.1.24",
    "@socketbin/cli-win32-arm64": "1.1.24",
    "@socketbin/cli-win32-x64": "1.1.24"
  }
}
```

**bin/socket.js**:
```javascript
#!/usr/bin/env node
'use strict'

const { spawn } = require('node:child_process')
const { realpathSync } = require('node:fs')
const path = require('node:path')
const os = require('node:os')

// Detect platform and architecture
const platform = os.platform()
const arch = os.arch()
const ext = platform === 'win32' ? '.exe' : ''

// Build package name
const packageName = `@socketbin/cli-${platform}-${arch}`

// Resolve binary path
let binaryPath
try {
  // Try to resolve the binary package
  const packagePath = require.resolve(`${packageName}/package.json`)
  const packageDir = path.dirname(packagePath)
  binaryPath = path.join(packageDir, 'bin', `cli${ext}`)

  // Resolve symlinks to get actual binary
  binaryPath = realpathSync(binaryPath)
} catch (error) {
  console.error(`Socket CLI binary not found for ${platform}-${arch}`)
  console.error(`Please ensure ${packageName} is installed`)
  console.error('')
  console.error('You can try:')
  console.error('  1. Reinstalling: npm install -g socket')
  console.error('  2. Installing from source: npm install -g @socketsecurity/cli')
  process.exit(1)
}

// Spawn the binary with all arguments
const child = spawn(binaryPath, process.argv.slice(2), {
  stdio: 'inherit',
  env: process.env,
  cwd: process.cwd()
})

// Handle exit
child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
  } else {
    process.exit(code ?? 0)
  }
})

// Handle errors
child.on('error', error => {
  console.error('Failed to start Socket CLI:', error.message)
  process.exit(1)
})
```

## Publishing Workflow

### CI/CD Pipeline

```yaml
# .github/workflows/publish-binaries.yml
name: Publish Binary Packages

on:
  release:
    types: [published]

jobs:
  build-and-publish:
    strategy:
      matrix:
        include:
          - platform: darwin
            arch: arm64
            os: macos-latest
          # ... other platforms

    runs-on: ${{ matrix.os }}

    permissions:
      contents: read
      id-token: write  # For provenance

    steps:
      - uses: actions/checkout@v4

      - name: Build binary
        run: |
          pnpm run build:sea -- \
            --platform=${{ matrix.platform }} \
            --arch=${{ matrix.arch }}

      - name: Prepare package
        run: |
          # Create package directory
          mkdir -p packages/binaries/cli-${{ matrix.platform }}-${{ matrix.arch }}/bin

          # Copy binary
          cp dist/sea/socket-* packages/binaries/cli-${{ matrix.platform }}-${{ matrix.arch }}/bin/cli

          # Generate package.json
          node scripts/generate-binary-package.mjs \
            --platform=${{ matrix.platform }} \
            --arch=${{ matrix.arch }} \
            --version=${{ github.event.release.tag_name }}

      - name: Publish to npm
        working-directory: packages/binaries/cli-${{ matrix.platform }}-${{ matrix.arch }}
        run: npm publish --provenance --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

  publish-main:
    needs: build-and-publish
    runs-on: ubuntu-latest

    permissions:
      contents: read
      id-token: write

    steps:
      - uses: actions/checkout@v4

      - name: Prepare main package
        run: |
          # Update version in socket package
          cd src/sea/npm-package
          npm version ${{ github.event.release.tag_name }}

      - name: Publish socket package
        working-directory: src/sea/npm-package
        run: npm publish --provenance --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

## Benefits of This Approach

### 1. Reliability
- **No postinstall failures**: Binary is already in the package
- **No network dependencies**: Works offline after install
- **No GitHub rate limits**: npm CDN handles distribution

### 2. Performance
- **Faster installs**: npm CDN is optimized for package delivery
- **Better caching**: Works with npm, yarn, pnpm caches
- **Parallel downloads**: npm handles concurrent downloads

### 3. Security
- **Provenance**: Green checkmark shows verified build source
- **Signed packages**: npm handles package signing
- **Integrity checks**: Automatic SHA verification

### 4. Simplicity
- **No install.js**: No complex postinstall logic
- **Standard npm flow**: Users already understand it
- **Single command**: `npm install -g socket` just works

## Platform Detection

The dispatcher handles platform detection automatically:

| Node.js Platform | Node.js Arch | Binary Package |
|-----------------|--------------|----------------|
| `darwin` | `arm64` | `@socketbin/cli-darwin-arm64` |
| `darwin` | `x64` | `@socketbin/cli-darwin-x64` |
| `linux` | `arm64` | `@socketbin/cli-linux-arm64` |
| `linux` | `x64` | `@socketbin/cli-linux-x64` |
| `win32` | `arm64` | `@socketbin/cli-win32-arm64` |
| `win32` | `x64` | `@socketbin/cli-win32-x64` |

## Version Management

All binary packages share the same version as the main `socket` package:

1. **Release created**: Tag `v1.1.24`
2. **Binaries built**: All 6 platforms
3. **Binary packages published**: All with version `1.1.24`
4. **Main package published**: References all binaries at `1.1.24`

This ensures version consistency across all packages.

## Migration Path

### Phase 1: Setup (One-time)
1. Create `@socketbin` organization
2. Configure trusted publishers
3. Set up GitHub Actions workflow

### Phase 2: Parallel Publishing
1. Continue publishing to GitHub releases
2. Also publish to `@socketbin/*` packages
3. Main `socket` package uses postinstall initially

### Phase 3: Switch Over
1. Update `socket` package to use `optionalDependencies`
2. Remove `install.js` postinstall script
3. Monitor for issues

### Phase 4: Cleanup
1. Archive old GitHub releases
2. Update documentation
3. Remove postinstall code

## Monitoring & Analytics

Track adoption through:
- npm download stats for each `@socketbin/*` package
- Platform distribution analytics
- Install success rates (no more postinstall failures to track!)

## Future Enhancements

### 1. Minimal Fallback
For unsupported platforms, provide a JavaScript fallback:
```javascript
if (!binaryExists) {
  require('@socketsecurity/cli/cli')
}
```

### 2. Binary Optimization
- Use UPX compression for smaller binaries
- Strip debug symbols in production
- Platform-specific optimizations

### 3. Incremental Updates
- Delta updates for binary patches
- Separate data files from binary

## Comparison with Current Approach

| Aspect | Current (GitHub + postinstall) | New (@socketbin) |
|--------|--------------------------------|------------------|
| Install Reliability | Can fail on network issues | Always works |
| Install Speed | Depends on GitHub | Fast (npm CDN) |
| Offline Support | No | Yes (after first install) |
| Package Size | ~50KB | ~50MB per platform |
| Total npm Storage | ~50KB | ~300MB (all platforms) |
| Complexity | Medium (install.js) | Low (simple dispatcher) |
| Security | Manual verification | npm provenance ✓ |

## Conclusion

The `@socketbin` approach trades npm storage space (300MB total) for significant improvements in reliability, security, and user experience. Since the stub rarely changes, this one-time download cost is acceptable for the benefits gained.

---

*Document created: 2025-10-07*