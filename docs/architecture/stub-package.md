# Socket CLI Stub Package & Binary Distribution Flow

This document describes how Socket CLI handles platform-specific binary distribution through the `socket` npm package, from CI/CD generation to installation on user machines.

## Overview

The Socket CLI uses a two-tier distribution model:
1. **`socket` npm package**: Lightweight npm package that downloads platform-specific binaries
2. **`@socketsecurity/cli` npm package**: Full CLI implementation (JavaScript/TypeScript)

The binaries are built using yao-pkg (enhanced fork of vercel/pkg), not Node.js native SEA.

## Architecture Components

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Binary Distribution Flow                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  1. CI/CD Build           2. GitHub Releases      3. NPM Package        │
│  ┌──────────────┐        ┌────────────────┐     ┌──────────────┐      │
│  │ Build Matrix │───────>│  Binary Assets  │<────│ socket@1.x  │       │
│  │ (6 platforms)│        │  socket-*.exe   │     │  install.js  │       │
│  └──────────────┘        └────────────────┘     └──────────────┘      │
│                                                          │               │
│                                                          ↓               │
│                                                   ┌──────────────┐      │
│                                                   │ User Machine │      │
│                                                   │ npm install  │      │
│                                                   └──────────────┘      │
└─────────────────────────────────────────────────────────────────────────┘
```

## 1. CI/CD Binary Generation

### Build Matrix

The GitHub Actions workflow (`release-sea.yml`) builds binaries for 6 platform/architecture combinations:

```yaml
matrix:
  include:
    # Linux builds
    - os: ubuntu-latest
      platform: linux
      arch: x64
    - os: ubuntu-latest
      platform: linux
      arch: arm64    # Cross-compilation

    # macOS builds (native compilation)
    - os: macos-latest
      platform: darwin
      arch: x64
    - os: macos-latest
      platform: darwin
      arch: arm64

    # Windows builds
    - os: windows-latest
      platform: win32
      arch: x64
    - os: windows-2022-arm64
      platform: win32
      arch: arm64    # Native ARM64 runner
```

### Build Process

Each platform build follows these steps:

1. **Build Stub**: Compile TypeScript stub to CommonJS
   ```bash
   pnpm run build:sea:stub
   # Outputs: dist/sea/stub.cjs
   ```

2. **Package with yao-pkg**: Create single executable
   - Uses yao-pkg (enhanced fork of vercel/pkg)
   - Not Node.js 24's native SEA feature
   - Embeds Node.js runtime + stub code
   - Configures platform-specific settings

3. **Platform Post-Processing**:
   - **Windows**: Sign with certificate (if available)
   - **macOS**: Remove quarantine attributes, ad-hoc sign
   - **Linux**: Set executable permissions

### Binary Naming Convention

Binaries follow a consistent naming pattern:
```
socket-{platform}-{arch}{extension}

Examples:
- socket-linux-x64
- socket-darwin-arm64
- socket-win32-x64.exe
```

Platform mapping:
- `darwin` → `macos` (in download URLs)
- `win32` → `win` (in download URLs)

## 2. GitHub Release Storage

### Release Structure

Binaries are uploaded to GitHub releases with this structure:
```
https://github.com/SocketDev/socket-cli/releases/download/v{version}/
├── socket-linux-x64
├── socket-linux-arm64
├── socket-darwin-x64
├── socket-darwin-arm64
├── socket-win32-x64.exe
└── socket-win32-arm64.exe
```

### Release Workflow

1. **Trigger**: Manual workflow dispatch or GitHub release creation
2. **Build**: All platforms built in parallel
3. **Upload**: Binaries uploaded to release assets
4. **Draft**: Releases created as drafts for manual review
5. **Publish**: Manual step to make release public

### Versioning

- Release tags follow semver: `v1.1.24`
- Binary URLs are deterministic based on version
- Fallback to latest release if specific version not found

## 3. NPM Package Structure

### Package Contents

The `socket` npm package (`src/sea/npm-package/`) contains:

```
socket/
├── package.json      # Package metadata & postinstall script
├── install.js        # Platform detection & binary download
├── socket           # Fallback shim (replaced by binary)
└── README.md        # Usage instructions
```

### Package.json Configuration

```json
{
  "name": "socket",
  "version": "1.1.24",
  "bin": {
    "socket": "socket"
  },
  "scripts": {
    "postinstall": "node install.js"
  },
  "preferGlobal": true,
  "engines": {
    "node": ">=18.18.0"
  }
}
```

## 4. Installation Flow

### Platform Detection

The `install.js` script detects the current platform:

```javascript
function getBinaryName() {
  const platform = PLATFORM_MAP[os.platform()]
  const arch = ARCH_MAP[os.arch()]

  if (!platform || !arch) {
    throw new Error(`Unsupported platform: ${os.platform()} ${os.arch()}`)
  }

  const extension = os.platform() === 'win32' ? '.exe' : ''
  return `socket-${platform}-${arch}${extension}`
}
```

### Platform Mappings

```javascript
const PLATFORM_MAP = {
  darwin: 'macos',   // macOS
  linux: 'linux',
  win32: 'win'       // Windows
}

const ARCH_MAP = {
  arm64: 'arm64',    // ARM 64-bit (Apple Silicon, etc.)
  x64: 'x64'         // Intel/AMD 64-bit
}
```

### Download Process

```
npm install -g socket
         ↓
┌──────────────────────────────────────────────────────────┐
│ Postinstall Script (install.js)                          │
│                                                          │
│ 1. Detect Platform:                                      │
│    os.platform() + os.arch() → socket-linux-x64         │
│                                                          │
│ 2. Construct Download URL:                               │
│    https://github.com/.../v1.1.24/socket-linux-x64      │
│                                                          │
│ 3. Download Binary:                                      │
│    HTTPS GET with redirects → temp file                  │
│                                                          │
│ 4. Set Permissions:                                      │
│    chmod 755 (Unix) or no-op (Windows)                   │
│                                                          │
│ 5. Replace Shim:                                         │
│    Atomic rename from temp to 'socket'                   │
└──────────────────────────────────────────────────────────┐
```

### Error Handling

The installation is designed to be resilient:

```javascript
try {
  // Download and install binary
} catch (error) {
  console.error('Failed to install Socket CLI binary:', error.message)
  console.error('You may need to install from source: npm install @socketsecurity/cli')
  // Don't fail the install - allow fallback
}
```

Fallback options:
1. Keep shim script that shows error message
2. User can install `@socketsecurity/cli` directly
3. Manual binary download from GitHub releases

## 5. Binary Execution Flow

Once installed, the binary execution follows this flow:

```
$ socket scan
      ↓
┌──────────────────────────────────────────┐
│ Platform Binary (socket-linux-x64)        │
│                                           │
│ 1. Stub Code Executes                     │
│ 2. Check ~/.socket/_cli/package/          │
│ 3. Download @socketsecurity/cli if needed │
│ 4. Spawn Node.js with CLI                 │
└──────────────────────────────────────────┘
```

## 6. Update Mechanism

The stub package has a dual update mechanism:

### Stub Updates (Binary)

When running `socket self-update` as a SEA binary:
1. Check npm registry for `socket` package version
2. Compare with embedded version
3. Download new binary from GitHub if available
4. Atomic replacement with backup

### CLI Updates (JavaScript)

The actual CLI code updates independently:
1. Check npm registry for `@socketsecurity/cli` version
2. Download and extract new tarball to `~/.socket/_cli/package/`
3. Next execution uses new CLI code

## 7. Platform Support

### Fully Supported (CI builds)
- Linux x64
- Linux ARM64
- macOS x64 (Intel)
- macOS ARM64 (Apple Silicon)
- Windows x64
- Windows ARM64

### Unsupported Platforms
For unsupported platforms, users must:
1. Install Node.js v22+
2. Install `@socketsecurity/cli` directly
3. Use `npx @socketsecurity/cli` or global install

## 8. Security Considerations

### Binary Integrity
- Binaries built in GitHub Actions (auditable)
- SHA256 checksums in release notes
- npm provenance for package publishing

### Download Security
- HTTPS only for downloads
- GitHub releases as trusted source
- Fallback to error rather than insecure operation

### Platform Security
- **macOS**: Quarantine attributes cleared, ad-hoc signed
- **Windows**: Optional code signing with certificate
- **Linux**: Standard executable permissions

## 9. Local Development

### Building Binaries Locally

```bash
# Build for current platform
pnpm run build --sea

# Build for specific platform
pnpm run build --sea -- --platform=darwin --arch=arm64

# Build all platforms (requires cross-compilation setup)
pnpm run build --sea -- --all
```

### Testing Installation

```bash
# Test install.js locally
cd src/sea/npm-package
npm_config_global=true node install.js

# Test with specific version
SOCKET_VERSION=1.1.24 node install.js
```

### Publishing Flow

```bash
# Build all binaries
pnpm run build --sea

# Upload to GitHub (requires gh CLI)
pnpm run publish:sea:github

# Publish npm package
cd src/sea/npm-package
npm publish --access public
```

## 10. Troubleshooting

### Common Issues

1. **"Unsupported platform" error**
   - Platform/arch combination not in matrix
   - Solution: Install `@socketsecurity/cli` directly

2. **Download fails during install**
   - Network issues or GitHub rate limiting
   - Solution: Manual download from releases page

3. **Permission denied on Unix**
   - Binary not marked executable
   - Solution: `chmod +x $(which socket)`

4. **Windows Defender blocks execution**
   - Unsigned binary flagged
   - Solution: Add exception or build signed binary

### Debug Environment Variables

```bash
# Enable debug output
DEBUG=1 npm install -g socket

# Skip binary download (keep shim)
SKIP_BINARY_DOWNLOAD=1 npm install -g socket

# Use specific Node.js version for SEA
SOCKET_CLI_SEA_NODE_VERSION=24.8.0 pnpm run build --sea
```

---

*Document created: 2025-10-07*